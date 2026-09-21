import math
from physics_engine import RocketSimulator

class DummyConfig:
    def get(self, key, default):
        return {
            "mass": 0.5,
            "candy": 0.25,
            "width": 0.04,
            "height": 0.5,
            "target_x": 300.0
        }.get(key, default)

sim = RocketSimulator(DummyConfig())
# simulate a flight straight up
sim.wind_history = [{"time": 0.0, "wind_torque": 0.0}]

res = sim.simulate_pid()
if res:
    last = res[-1]
    print(f"Final lateral_pos: {last['lateral_pos']:.2f}, Target: {sim.target_x}")
    print(f"Final time: {last['time']}, alt: {last['altitude']:.2f}")
else:
    print("No result")

