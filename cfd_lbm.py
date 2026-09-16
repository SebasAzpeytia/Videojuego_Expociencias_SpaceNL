import numpy as np

class LBMSolver:
    def __init__(self, nx, ny, nu=0.01):
        self.nx = nx
        self.ny = ny
        self.nu = nu
        self.omega = 1.0 / (3 * nu + 0.5)
        
        # D2Q9 directions and weights
        self.idxs = np.arange(9)
        self.cxs = np.array([0, 1, 0, -1,  0, 1, -1, -1,  1])
        self.cys = np.array([0, 0, 1,  0, -1, 1,  1, -1, -1])
        self.weights = np.array([4/9, 1/9, 1/9, 1/9, 1/9, 1/36, 1/36, 1/36, 1/36])
        
        # Initialize distribution function
        self.F = np.ones((ny, nx, 9))
        
        # Obstacle mask (boolean array)
        self.obstacle = np.zeros((ny, nx), dtype=bool)
        
    def set_obstacle(self, mask):
        self.obstacle = mask
        
    def step(self, u_inlet=0.0, v_inlet=0.0):
        # 1. Rightward drift (Drift / Streaming)
        for i, cx, cy in zip(self.idxs, self.cxs, self.cys):
            self.F[:,:,i] = np.roll(self.F[:,:,i], cx, axis=1)
            self.F[:,:,i] = np.roll(self.F[:,:,i], cy, axis=0)
            
        # Bounce back at obstacle boundaries
        # Find indices of opposite directions
        # 0:0, 1:3, 2:4, 3:1, 4:2, 5:7, 6:8, 7:5, 8:6
        opp = [0, 3, 4, 1, 2, 7, 8, 5, 6]
        bndryF = self.F[self.obstacle, :]
        bndryF = bndryF[:, opp]
        
        # Calculate fluid variables
        rho = np.sum(self.F, axis=2)
        # Avoid division by zero and negative densities
        rho = np.clip(rho, 0.1, 2.0)
        
        ux = np.sum(self.F * self.cxs, axis=2) / rho
        uy = np.sum(self.F * self.cys, axis=2) / rho
        
        # Apply inlet boundary conditions (top wall)
        ux[0, :] = u_inlet
        uy[0, :] = v_inlet
        
        # Clamp velocity to stay within LBM stability limits (Mach < ~0.3)
        ux = np.clip(ux, -0.2, 0.2)
        uy = np.clip(uy, -0.2, 0.2)
        # Also top/bottom walls open or slip? Let's just wrap around since we used np.roll
        
        # Apply obstacle
        ux[self.obstacle] = 0
        uy[self.obstacle] = 0
        
        # Collision
        Feq = np.zeros_like(self.F)
        for i, cx, cy, w in zip(self.idxs, self.cxs, self.cys, self.weights):
            cu = 3 * (cx * ux + cy * uy)
            Feq[:, :, i] = rho * w * (1 + cu + 0.5 * cu**2 - 1.5 * (ux**2 + uy**2))
            
        self.F += -self.omega * (self.F - Feq)
        
        # Re-apply bounce back
        self.F[self.obstacle, :] = bndryF
        
        return ux, uy
