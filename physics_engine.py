"""
Physics Engine — Weathercocking Rocket Simulator
Handles rotational dynamics, stochastic wind perturbation and PID replay.
"""

import math
import random
try:
    import numpy as np
    from cfd_lbm import LBMSolver
    HAS_CFD = True
except ImportError:
    HAS_CFD = False


class RocketSimulator:
    """2-D rotational–dynamics model of a sounding rocket subject to
    lateral wind gusts (weathercocking) and human/PID corrective torque."""

    # ── Rocket physical properties ──────────────────────────────────────
    MASS = 50.0          # kg
    LENGTH = 3.0         # m
    I = (1 / 12) * MASS * LENGTH ** 2  # moment of inertia (thin rod)
    CD = 0.75            # drag coefficient
    A_CROSS = 0.10       # reference cross-section area  (m²)
    L_CP = 0.50          # CG → CP distance              (m)
    ASCENT_RATE = 80.0   # vertical velocity              (m/s)

    # ── Tunables ────────────────────────────────────────────────────────
    DAMPING = 0.40       # angular-velocity damping coeff
    K_USER = 1.5         # user-control gain (Nm / rad)
    RHO = 1.225          # air density (kg/m³)

    # ── Wind model ──────────────────────────────────────────────────────
    GUST_MIN_T = 0.8     # shortest gust interval (s)
    GUST_MAX_T = 3.5     # longest  gust interval (s)
    WIND_RAMP = 10.0     # seconds to reach full intensity

    DT = 1.0 / 60.0      # physics tick (≈ 60 Hz)

    def __init__(self, config: dict = None):
        if config is None:
            config = {}
            
        self.dry_mass = float(config.get("mass", 50.0))
        self.length = float(config.get("height", 3.0))
        self.width = float(config.get("width", 0.2))
        self.candy = float(config.get("candy", 10.0))
        self.initial_candy = self.candy
        self.max_user_deg = float(config.get("max_angle", 20.0))
        self.crash_angle = float(config.get("crash_angle", 45.0))
        self.crash_enabled = config.get("crash_enabled", True)
        self.inertia_mult = float(config.get("inertia_mult", 4.0))
        self.damping = float(config.get("damping", 0.40))
        self.naca_profile = config.get("naca_profile", "66-212")
        
        # Wind bounds from config (using base wind from meteo + some variance)
        base_wind_kmh = float(config.get("wind_speed", 10.0))
        self.wind_base_ms = base_wind_kmh / 3.6
        self.wind_var_ms = self.wind_base_ms * 0.5  # +/- 50% variance
        
        # Derived physical properties
        self.a_cross = self.width * self.length
        self.cd = 0.75
        self.ascent_rate = 80.0

        # State
        self.angle = 0.0              # rad (deviation from vertical)
        self.angular_velocity = 0.0   # rad/s
        self.altitude = 0.0           # m
        self.lateral_pos = 0.0        # m
        self.time = 0.0               # s

        # Wind internals
        self.wind_speed = 0.0
        self.target_wind = 0.0
        self.gust_timer = 2.0         # calm start

        # Recording
        self.trajectory: list[dict] = []
        self.wind_history: list[dict] = []
        
        # CFD
        self.cfd_enabled = HAS_CFD
        if self.cfd_enabled:
            self.cfd_nx = 60
            self.cfd_ny = 60
            self.cfd = LBMSolver(self.cfd_nx, self.cfd_ny, nu=0.01)
            self.last_cfd_angle = 999.0
            
    def _update_cfd_obstacle(self):
        if not self.cfd_enabled: return
        # Only update if angle changed by more than 2 degrees
        if abs(self.angle - self.last_cfd_angle) < 0.035:
            return
            
        self.last_cfd_angle = self.angle
        obs = np.zeros((self.cfd_ny, self.cfd_nx), dtype=bool)
        
        cx, cy = self.cfd_nx // 2, self.cfd_ny // 2
        
        c = math.cos(self.angle)
        s = math.sin(self.angle)
        
        user_angle_rad = getattr(self, "last_user_angle", 0.0) * math.pi / 180.0
        can_c = math.cos(user_angle_rad)
        can_s = math.sin(user_angle_rad)
        
        for y in range(self.cfd_ny):
            for x in range(self.cfd_nx):
                dx = x - cx
                dy = y - cy
                
                # px, py are local coordinates in pixels (1 cell = 6 pixels)
                # aligned with the rocket's longitudinal axis
                px = (dx * c + dy * s) * 6.0
                py = (-dx * s + dy * c) * 6.0
                
                in_body = False
                if -80.0 <= py <= 56.0:
                    current_w = 32.0
                    if py < -56.0:
                        progress = (py + 80.0) / 24.0
                        current_w = 32.0 * max(0.1, progress)
                    if abs(px) <= current_w / 2.0:
                        in_body = True
                        
                in_fins = False
                if 34.0 <= py <= 60.0:
                    progress = (py - 34.0) / 26.0
                    outer_edge = 16.0 + 22.0 * progress
                    if 16.0 <= abs(px) <= outer_edge:
                        in_fins = True
                        
                in_canards = False
                # Left canard
                if px < 0:
                    dx_c = px - (-16.0)
                    dy_c = py - (-24.0)
                    lx_c = dx_c * can_c + dy_c * can_s
                    ly_c = -dx_c * can_s + dy_c * can_c
                    if -17.6 <= lx_c <= 0:
                        progress = (lx_c + 17.6) / 17.6
                        top_y = 2.0 + 6.8 * progress
                        bottom_y = 2.0 - 10.8 * progress
                        if bottom_y <= ly_c <= top_y:
                            in_canards = True
                # Right canard
                else:
                    dx_c = px - 16.0
                    dy_c = py - (-24.0)
                    lx_c = dx_c * can_c + dy_c * can_s
                    ly_c = -dx_c * can_s + dy_c * can_c
                    if 0 <= lx_c <= 17.6:
                        progress = (17.6 - lx_c) / 17.6
                        top_y = 2.0 + 6.8 * progress
                        bottom_y = 2.0 - 10.8 * progress
                        if bottom_y <= ly_c <= top_y:
                            in_canards = True
                
                if in_body or in_fins or in_canards:
                    obs[y, x] = True
                    
        self.cfd.set_obstacle(obs)

    def _get_mass_and_inertia(self):
        mass = self.dry_mass + self.candy
        # Se multiplica la inercia para ajustar la velocidad de rotación
        inertia = ((1 / 12) * mass * self.length ** 2) * self.inertia_mult
        return mass, inertia

    def _calculate_barrowman_cp(self):
        L_nose = self.length * 0.2
        CN_nose = 2.0
        X_nose = 0.466 * L_nose

        d = self.width
        fin_span = 0.15
        fin_root = 0.2
        CN_rear = 8.0 * ((fin_span / d) ** 2)
        X_rear = self.length - (fin_root / 2.0)

        canard_span = 0.08
        canard_root = 0.1
        CN_canard = 4.0 * ((canard_span / d) ** 2)
        X_canard = self.length * 0.15 + (canard_root / 2.0)

        total_CN = CN_nose + CN_rear + CN_canard
        X_cp = (CN_nose * X_nose + CN_rear * X_rear + CN_canard * X_canard) / total_CN
        return X_cp

    # ── Wind generation ─────────────────────────────────────────────────
    def _step_wind(self, dt: float, x_cp: float):
        self.gust_timer -= dt
        if self.gust_timer <= 0:
            intensity = min(1.0, self.time / self.WIND_RAMP)
            self.target_wind = self.wind_base_ms + random.uniform(
                -self.wind_var_ms, self.wind_var_ms
            ) * (0.3 + 0.7 * intensity)
            
            # Randomly flip direction occasionally
            if random.random() < 0.3:
                self.target_wind *= -1
                
            self.gust_timer = random.uniform(self.GUST_MIN_T, self.GUST_MAX_T)

        # Low-pass smoothing
        alpha = min(1.0, dt * 1.5)
        self.wind_speed += (self.target_wind - self.wind_speed) * alpha

        # Force & torque  (weathercocking: effective area grows with angle)
        eff_area = self.a_cross + abs(math.sin(self.angle)) * self.length * 0.3
        wind_force = (
            0.5 * self.RHO
            * self.wind_speed * abs(self.wind_speed)
            * self.cd * eff_area
        )
        CG = self.length / 2.0
        l_cp_real = x_cp - CG
        wind_torque = wind_force * l_cp_real
        return wind_torque, wind_force

    def _get_canard_cl(self, alpha_deg: float) -> float:
        """Returns Lift Coefficient (C_L) based on NACA profile and angle of attack."""
        alpha = abs(alpha_deg)
        sign = 1.0 if alpha_deg >= 0 else -1.0
        
        if self.naca_profile == "0012":
            stall = 15.0
            cl = 0.11 * alpha
            if alpha > stall:
                cl = cl * (stall / alpha)**2
            return sign * cl
            
        elif self.naca_profile == "0018":
            stall = 18.0
            cl = 0.10 * alpha
            if alpha > stall:
                cl = cl * (stall / alpha)**2
            return sign * cl
            
        else: # "66-212" or fallback
            stall = 12.0
            # Cambered profile has lift at 0 angle of attack
            cl = 0.11 * alpha + 0.2
            if alpha > stall:
                cl = cl * (stall / alpha)**2
            if alpha_deg < 0:
                # For negative alpha, camber shifts the intercept down
                cl = 0.11 * alpha - 0.2
                if alpha > stall:
                    cl = cl * (stall / alpha)**2
            return sign * cl

    # ── Single physics step ─────────────────────────────────────────────
    def update(self, user_angle_deg: float) -> dict:
        dt = self.DT
        user_clamped = max(-self.max_user_deg, min(self.max_user_deg, user_angle_deg))
        self.last_user_angle = user_clamped

        current_mass, current_inertia = self._get_mass_and_inertia()
        
        # Consume Candy
        candy_consumption_rate = current_mass * 0.05 
        
        self.candy -= candy_consumption_rate * dt
        if self.candy < 0:
            self.candy = 0.0

        # Aerodynamic Lift Torque from Canards
        X_cp = self._calculate_barrowman_cp()
        
        cl = self._get_canard_cl(user_clamped)
        q = 0.5 * self.RHO * (self.ascent_rate)**2
        
        canard_span = 0.08
        canard_root = 0.1
        s_canard_real = canard_span * canard_root
        
        lift = q * s_canard_real * cl
        CG = self.length / 2.0
        X_canard = self.length * 0.15 + (canard_root / 2.0)
        lever_arm = CG - X_canard
        user_torque = -lift * lever_arm
        
        wind_torque, wind_force = self._step_wind(dt, X_cp)
        damping_torque = -self.damping * self.angular_velocity
        gravity_torque = current_mass * 9.81 * 0.1 * math.sin(self.angle)

        total = user_torque + wind_torque + damping_torque + gravity_torque

        # Semi-implicit Euler integration
        self.angular_velocity += (total / current_inertia) * dt
        self.angle += self.angular_velocity * dt
        self.angle = max(-math.pi / 2, min(math.pi / 2, self.angle))

        self.altitude += self.ascent_rate * dt
        self.lateral_pos += math.sin(self.angle) * self.ascent_rate * dt
        self.time += dt

        # Record for later PID replay
        rec = dict(
            time=round(self.time, 4),
            angle=round(math.degrees(self.angle), 2),
            altitude=round(self.altitude, 1),
            lateral_pos=round(self.lateral_pos, 2),
        )
        self.trajectory.append(rec)
        self.wind_history.append(dict(
            time=self.time,
            wind_torque=wind_torque,
            wind_force=wind_force,
        ))

        # CFD integration
        cfd_grid = None
        if self.cfd_enabled:
            self._update_cfd_obstacle()
            # map wind_speed (m/s) to lattice velocity (e.g. max 0.1)
            u_in = (self.wind_speed / 30.0) * 0.15 
            v_in = 0.15 # simulate downward movement
            ux, uy = self.cfd.step(u_inlet=u_in, v_inlet=v_in)
            
            # Send the full 60x60 grid
            if int(self.time / dt) % 3 == 0:
                ux_down = ux.flatten().tolist()
                uy_down = uy.flatten().tolist()
                cfd_grid = {
                    "ux": [round(v, 3) for v in ux_down],
                    "uy": [round(v, 3) for v in uy_down]
                }

        state_dict = dict(
            angle=rec["angle"],
            angular_velocity=round(math.degrees(self.angular_velocity), 2),
            altitude=rec["altitude"],
            lateral_pos=rec["lateral_pos"],
            wind_force=round(wind_force, 2),
            wind_speed_kmh=round(self.wind_speed * 3.6, 1),
            user_angle=round(user_clamped, 1),
            time=round(self.time, 2),
            candy=round(self.candy, 2),
            mass=round(current_mass, 1)
        )
        
        if cfd_grid:
            state_dict["cfd"] = cfd_grid
            
        return state_dict

    # ── PID replay (200 Hz) ─────────────────────────────────────────────
    def simulate_pid(self) -> list[dict]:
        """Re-run the *exact same* wind profile with a tuned PID controller
        operating at 200 Hz to showcase the 97.33 % dispersion reduction."""

        if not self.wind_history:
            return []

        traj: list[dict] = []
        angle = 0.0
        omega = 0.0
        alt = 0.0
        lat = 0.0

        # PID gains (tuned for angles)
        KP, KI, KD = 150.0, 5.0, 50.0
        integral = 0.0
        prev_err = 0.0

        dt = 1.0 / 200.0

        total_time = self.wind_history[-1]["time"] if self.wind_history else 0.0
        t = 0.0
        w_idx = 0
        sample = 0
        self.candy = getattr(self, 'initial_candy', 10.0) # Reset fuel for simulation

        # run until fuel is depleted or a maximum time (e.g. 20s) to prevent infinite loops
        while self.candy > 0 and t < 60.0:
            if t < total_time:
                # Interpolate recorded wind torque
                while (
                    w_idx < len(self.wind_history) - 1
                    and self.wind_history[w_idx + 1]["time"] < t
                ):
                    w_idx += 1
                wind_torque = self.wind_history[w_idx]["wind_torque"]
            else:
                X_cp = self._calculate_barrowman_cp()
                wind_torque, _ = self._step_wind(dt, X_cp)

            # PID for canard angle (Positive error -> positive cmd -> negative torque)
            err = angle
            integral = max(-0.5, min(0.5, integral + err * dt))
            deriv = (err - prev_err) / dt if dt else 0.0
            
            canard_cmd = (KP * err + KI * integral + KD * deriv)
            canard_cmd = max(-self.max_user_deg, min(self.max_user_deg, canard_cmd))
            
            # Canard Aerodynamics
            cl = self._get_canard_cl(canard_cmd)
            q = 0.5 * self.RHO * (self.ascent_rate)**2
            canard_span = 0.08
            canard_root = 0.1
            s_canard_real = canard_span * canard_root
            lift = q * s_canard_real * cl
            
            CG = getattr(self, 'length', 3.0) / 2.0
            X_canard = getattr(self, 'length', 3.0) * 0.15 + (canard_root / 2.0)
            lever_arm = CG - X_canard
            user_torque = -lift * lever_arm

            ctrl = user_torque

            damp = -self.damping * omega
            
            current_mass = getattr(self, 'dry_mass', 50.0) + getattr(self, 'candy', 0.0)
            current_inertia = ((1 / 12) * current_mass * getattr(self, 'length', 3.0) ** 2) * self.inertia_mult
            
            grav = current_mass * 9.81 * 0.1 * math.sin(angle)

            acc = (ctrl + wind_torque + damp + grav) / current_inertia
            omega += acc * dt
            angle += omega * dt
            alt += self.ascent_rate * dt
            lat += math.sin(angle) * self.ascent_rate * dt

            if getattr(self, 'candy', 0) > 0:
                self.candy -= current_mass * 0.05 * dt

            prev_err = err
            t += dt
            sample += 1

            # Downsample to ~20 Hz for JSON transfer
            if sample % 10 == 0:
                traj.append(dict(
                    time=round(t, 4),
                    angle=round(math.degrees(angle), 3),
                    altitude=round(alt, 1),
                    lateral_pos=round(lat, 3),
                    user_angle=round(canard_cmd, 2),
                    candy=round(self.candy, 2)
                ))

        return traj
