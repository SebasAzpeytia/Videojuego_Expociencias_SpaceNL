import math
from physics_engine import RocketSimulator

class DummyConfig:
    def get(self, key, default):
        return {
            "mass": 0.5,
            "candy": 0.25,
            "width": 0.04,
            "height": 0.5
        }.get(key, default)

sim = RocketSimulator(DummyConfig())
sim.angle = math.radians(45)

dt = 1/60.0
for i in range(150):
    sim.update(0)
    print(f"t={sim.time:.2f} h={sim.altitude:.1f} v_y={sim.vertical_velocity:.1f} v_x={sim.lateral_velocity:.1f} drag={0.5 * 1.225 * (sim.vertical_velocity**2 + sim.lateral_velocity**2) * 0.75 * sim.a_frontal:.1f} T_y={138.56 * 0.707 if sim.candy > 0 else 0:.1f}")
    if sim.altitude < 0 and sim.time > 1.0:
        break
