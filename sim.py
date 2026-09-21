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

def run_sim():
    sim = RocketSimulator(DummyConfig())
    # Force diagonal launch
    sim.angle = math.radians(45)
    
    dt = 1/60.0
    while True:
        sim.update(0) # hold 0 input
        if sim.altitude < 0 and sim.time > 1.0:
            break
        if sim.time > 100:
            break
            
    print(f"Total time: {sim.time:.2f} s")
    print(f"Max altitude: {max(p['altitude'] for p in sim.trajectory):.2f} m")

if __name__ == "__main__":
    run_sim()
