"""
Physics Engine — Weathercocking Rocket Simulator
Handles rotational dynamics, stochastic wind perturbation and PID replay.
"""

import math
import random
from typing import Any
try:
    import numpy as np
    from cfd_lbm import LBMSolver
    HAS_CFD = True
except ImportError:
    HAS_CFD = False


class RocketSimulator:
    """2-D rotational–dynamics model of a sounding rocket subject to
    lateral wind gusts (weathercocking) and human/PID corrective torque."""

    RHO = 1.225          # air density (kg/m³)

    # ── Wind model ──────────────────────────────────────────────────────
    GUST_MIN_T = 0.8     # shortest gust interval (s)
    GUST_MAX_T = 3.5     # longest  gust interval (s)
    WIND_RAMP = 10.0     # seconds to reach full intensity

    DT = 1.0 / 60.0      # physics tick (≈ 60 Hz)

    def __init__(self, config: dict | None = None):
        if config is None:
            config = {}
            
        self.dry_mass = float(config.get("mass", 0.4))
        self.length = float(config.get("height", 3.0))
        self.width = float(config.get("width", 0.2))
        self.candy = float(config.get("candy", 0.25))
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
        self.target_x = float(config.get("target_x", 0.0))
        self.wind_var_ms = self.wind_base_ms * 0.5  # +/- 50% variance
        
        # Derived physical properties
        self.a_cross = self.width * self.length
        self.a_frontal = math.pi * (self.width / 2.0)**2
        self.cd = 0.75
        self.ascent_rate = 0.0

        # State
        self.angle = 0.0              # rad (deviation from vertical)
        self.angular_velocity = 0.0   # rad/s
        self.altitude = 0.0           # m
        self.vertical_velocity = 0.0  # m/s
        self.lateral_velocity = 0.0   # m/s
        self.lateral_pos = 0.0        # m
        self.time = 0.0               # s

        self.mode = "human"
        self.human_trajectory = []
        self.integral = 0.0
        self.prev_err = 0.0

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
            self.cfd_nx = 48
            self.cfd_ny = 48
            self.cfd = LBMSolver(self.cfd_nx, self.cfd_ny, nu=0.05)
            self.last_cfd_angle = 999.0

    def start_pid_mode(self):
        self.human_trajectory = list(self.trajectory)
        self.mode = "pid"
        self.altitude = 0.0
        self.lateral_pos = 0.0
        self.angle = 0.0
        self.angular_velocity = 0.0
        self.vertical_velocity = 0.0
        self.lateral_velocity = 0.0
        self.time = 0.0
        self.trajectory = []
        self.candy = getattr(self, 'initial_candy', 0.25)
        self.integral = 0.0
        self.prev_err = 0.0
        if self.cfd_enabled:
            self.cfd = LBMSolver(self.cfd_nx, self.cfd_ny, nu=0.05)
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
                
                # px, py are local coordinates in pixels (1 cell = 10 pixels)
                # aligned with the rocket's longitudinal axis
                px = (dx * c + dy * s) * 10.0
                py = (-dx * s + dy * c) * 10.0
                
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
        
        if getattr(self, "mode", "human") == "pid":
            # Usar viento del historial
            if self.wind_history:
                t = self.time
                idx = 0
                while idx < len(self.wind_history) - 1 and self.wind_history[idx+1]["time"] < t:
                    idx += 1
                wind_torque = self.wind_history[idx]["wind_torque"]
                wind_force = self.wind_history[idx]["wind_force"]
            else:
                wind_torque = 0.0
                wind_force = 0.0
                
            # Calcular controlador
            pos_err = getattr(self, 'target_x', 0.0) - self.lateral_pos
            desired_lat_vel = max(-150.0, min(150.0, pos_err * 0.75))
            vel_err = desired_lat_vel - self.lateral_velocity
            
            base_target = 0.0 if self.vertical_velocity >= 0 else math.pi
            if self.vertical_velocity >= 0:
                tilt = max(-math.pi/4, min(math.pi/4, vel_err * 0.03))
            else:
                tilt = -max(-math.pi/4, min(math.pi/4, vel_err * 0.03))
                
            target = (base_target + tilt + math.pi) % (2 * math.pi) - math.pi
            dev_rad = (self.angle - target + math.pi) % (2 * math.pi) - math.pi
            err = dev_rad
            
            KP, KI, KD = 150.0, 5.0, 50.0
            self.integral = max(-0.5, min(0.5, self.integral + err * dt))
            deriv = (err - self.prev_err) / dt if dt else 0.0
            
            canard_cmd = (KP * err + KI * self.integral + KD * deriv)
            user_clamped = max(-self.max_user_deg, min(self.max_user_deg, canard_cmd))
            
            self.prev_err = err
        else:
            user_clamped = max(-self.max_user_deg, min(self.max_user_deg, user_angle_deg))
            X_cp = self._calculate_barrowman_cp()
            wind_torque, wind_force = self._step_wind(dt, X_cp)

        self.last_user_angle = user_clamped

        current_mass, current_inertia = self._get_mass_and_inertia()
        
        # Consume Candy & Thrust
        burn_rate = 0.125
        thrust = 0.0
        if self.candy > 0:
            self.candy -= burn_rate * dt
            thrust = 138.56
            if self.candy < 0:
                self.candy = 0.0

        # Aerodynamic Lift Torque from Canards
        cl = self._get_canard_cl(user_clamped)
        v_air = max(1.0, abs(self.vertical_velocity))
        q = 0.5 * self.RHO * (v_air)**2
        
        canard_span = 0.08
        canard_root = 0.1
        s_canard_real = canard_span * canard_root
        
        lift = q * s_canard_real * cl
        CG = self.length / 2.0
        X_canard = self.length * 0.15 + (canard_root / 2.0)
        lever_arm = CG - X_canard
        user_torque = -lift * lever_arm
        damping_torque = -self.damping * self.angular_velocity
        gravity_torque = current_mass * 9.81 * 0.1 * math.sin(self.angle)

        total = user_torque + wind_torque + damping_torque + gravity_torque

        # Semi-implicit Euler integration
        self.angular_velocity += (total / current_inertia) * dt
        self.angle += self.angular_velocity * dt
        while self.angle > math.pi: self.angle -= 2 * math.pi
        while self.angle < -math.pi: self.angle += 2 * math.pi

        # Full 2D integration
        thrust_y = thrust * math.cos(self.angle)
        thrust_x = thrust * math.sin(self.angle)
        
        v_mag = math.sqrt(self.vertical_velocity**2 + self.lateral_velocity**2)
        drag_mag = 0.5 * self.RHO * (v_mag**2) * self.cd * self.a_frontal
        
        drag_y = drag_mag * (self.vertical_velocity / v_mag) if v_mag > 0 else 0.0
        drag_x = drag_mag * (self.lateral_velocity / v_mag) if v_mag > 0 else 0.0
        
        # --- Body Lift ---
        v_angle = math.atan2(self.lateral_velocity, self.vertical_velocity) if v_mag > 0.1 else (0.0 if self.vertical_velocity >= 0 else math.pi)
        aoa = (self.angle - v_angle + math.pi) % (2 * math.pi) - math.pi
        lift_mag = 0.5 * self.RHO * (v_mag**2) * self.a_frontal * 2.0 * math.sin(aoa)
        lift_x = lift_mag * math.cos(v_angle)
        lift_y = lift_mag * -math.sin(v_angle)
        
        vacc = (thrust_y + lift_y - current_mass * 9.81 - drag_y) / current_mass
        lacc = (thrust_x + lift_x - drag_x) / current_mass
        
        self.vertical_velocity += vacc * dt
        self.lateral_velocity += lacc * dt
        
        self.altitude += self.vertical_velocity * dt
        self.lateral_pos += self.lateral_velocity * dt
        self.time += dt

        # Record for later PID replay
        target = 0.0 if self.vertical_velocity >= 0 else math.pi
        dev_rad = (self.angle - target + math.pi) % (2 * math.pi) - math.pi
        
        rec = dict(
            time=round(self.time, 2),
            angle=round(math.degrees(self.angle), 2),
            dev=round(math.degrees(dev_rad), 2),
            altitude=round(self.altitude, 2),
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
            # Always flow top→bottom for consistent visual; scale by flight speed
            speed_factor = min(abs(self.vertical_velocity) / 50.0, 1.0)
            v_in = 0.05 + speed_factor * 0.10  # range [0.05 .. 0.15]
            ux, uy = self.cfd.step(u_inlet=u_in, v_inlet=v_in)
            
            # Send the full grid
            if int(self.time / dt) % 3 == 0:
                ux_down = np.round(ux, 3).flatten().tolist()
                uy_down = np.round(uy, 3).flatten().tolist()
                cfd_grid = {
                    "ux": ux_down,
                    "uy": uy_down
                }

        state_dict: dict[str, Any] = dict(
            angle=rec["angle"],
            angular_velocity=round(math.degrees(self.angular_velocity), 2),
            altitude=rec["altitude"],
            vertical_velocity=round(self.vertical_velocity, 1),
            lateral_pos=rec["lateral_pos"],
            is_falling=(self.vertical_velocity < 0),
            wind_force=round(wind_force, 2),
            wind_speed_kmh=round(self.wind_speed * 3.6, 1),
            user_angle=round(user_clamped, 1),
            time=round(self.time, 2),
            candy=round(self.candy, 2),
            mass=round(current_mass, 1),
            velocity=round(self.vertical_velocity, 1)
        )
        
        if cfd_grid:
            state_dict["cfd"] = cfd_grid
            
        return state_dict


