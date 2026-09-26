// --- THREE.JS RENDERING ---


function initThreeJS() {
  renderer = new THREE.WebGLRenderer({ canvas: $canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(60, $canvas.clientWidth / $canvas.clientHeight, 0.1, 1000);
  camera.position.z = 10;
  camera.position.y = 0;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);

  rocketGroup = buildProceduralRocket();
  scene.add(rocketGroup);

  // CFD Continuous Streamlines (Professional VWT Style)
  const streamCount = 28;
  const segments = 80;

  cfdParticleSystem = new THREE.Group();
  for (let i = 0; i < streamCount; i++) {
    let geo = new THREE.BufferGeometry();
    let pos = new Float32Array(segments * 3);
    let col = new Float32Array(segments * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    let mat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 3, transparent: true, opacity: 1.0, depthTest: false });
    let line = new THREE.Line(geo, mat);
    line.renderOrder = 10; // Render on top of rocket
    line.frustumCulled = false; // Prevent culling when updating dynamically
    cfdParticleSystem.add(line);
  }
  scene.add(cfdParticleSystem);

  // Minimap 3D
  const mCanvas = document.getElementById("minimap-canvas");
  if (mCanvas) {
    minimapRenderer = new THREE.WebGLRenderer({ canvas: mCanvas, antialias: true, alpha: true });
    minimapRenderer.setSize(mCanvas.clientWidth, mCanvas.clientHeight, false);
    minimapScene = new THREE.Scene();
    minimapCamera = new THREE.PerspectiveCamera(50, mCanvas.clientWidth / mCanvas.clientHeight, 0.1, 1000);
    minimapCamera.position.set(0, 0, 150); // Look at XY plane from Z
    minimapCamera.lookAt(0, 0, 0);

    // Reuse procedural rocket but scale it up for map visibility
    minimapRocket = buildProceduralRocket();
    minimapRocket.scale.set(1.5, 1.5, 1.5);
    minimapScene.add(minimapRocket);

    const mAmbient = new THREE.AmbientLight(0xffffff, 0.8);
    minimapScene.add(mAmbient);

    const mGrid = new THREE.GridHelper(2000, 100, 0x00d4ff, 0x00d4ff);
    mGrid.rotation.x = Math.PI / 2; // Make grid in XY plane
    mGrid.material.opacity = 0.15;
    mGrid.material.transparent = true;
    minimapScene.add(mGrid);

    // Add target beacon
    const targetGeo = new THREE.BoxGeometry(20, 2, 2);
    const targetMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    const targetMesh = new THREE.Mesh(targetGeo, targetMat);
    targetMesh.name = "targetBeacon";
    minimapScene.add(targetMesh);
  }
}

function buildProceduralRocket() {
  const group = new THREE.Group();

  // Body (Black, long)
  const bodyRadius = 0.3;
  const bodyHeight = 6.0;
  const bodyGeo = new THREE.CylinderGeometry(bodyRadius, bodyRadius, bodyHeight, 32);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.2 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // Nose (Orange/Brown, pointed)
  const noseHeight = 1.8;
  const noseGeo = new THREE.ConeGeometry(bodyRadius, noseHeight, 32);
  const noseMat = new THREE.MeshStandardMaterial({ color: 0xc05a20, roughness: 0.4 });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.y = bodyHeight / 2 + noseHeight / 2;
  group.add(nose);

  // Create Fin Shape
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0, 1.5); // Root length
  finShape.lineTo(1.0, 0.5); // Swept leading edge
  finShape.lineTo(1.0, 0); // Tip length
  finShape.lineTo(0, 0); // Flat trailing edge

  const finExtrude = { depth: 0.05, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.02, bevelThickness: 0.02 };
  const finGeo = new THREE.ExtrudeGeometry(finShape, finExtrude);
  const finMat = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.5 }); // White/Cream

  for (let i = 0; i < 4; i++) {
    const finPivot = new THREE.Group();
    finPivot.position.y = -bodyHeight / 2; // Bottom of body
    finPivot.rotation.y = i * Math.PI / 2;

    const fin = new THREE.Mesh(finGeo, finMat);
    fin.position.x = bodyRadius - 0.05; // Slightly sink into body
    fin.position.z = -0.025; // Center thickness
    finPivot.add(fin);
    group.add(finPivot);
  }

  // Canards (Orange, smaller swept shapes)
  canards = []; // reset
  const canardShape = new THREE.Shape();
  canardShape.moveTo(0, 0);
  canardShape.lineTo(0, 0.7);
  canardShape.lineTo(0.5, 0.2);
  canardShape.lineTo(0.5, 0);
  canardShape.lineTo(0, 0);

  const canardExtrude = { depth: 0.04, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.01, bevelThickness: 0.01 };
  const canardGeo = new THREE.ExtrudeGeometry(canardShape, canardExtrude);
  const canardMat = new THREE.MeshStandardMaterial({ color: 0xc05a20, roughness: 0.4 });

  for (let i = 0; i < 4; i++) {
    const canardPivot = new THREE.Group();
    // Positioned near the upper part of the body
    canardPivot.position.y = bodyHeight / 2 - 1.2;
    canardPivot.rotation.y = i * Math.PI / 2;

    // The visual mesh that is attached to the pivot
    const canardMesh = new THREE.Mesh(canardGeo, canardMat);
    canardMesh.position.x = bodyRadius - 0.05;
    canardMesh.position.z = -0.02; // Center thickness

    // We add the mesh to an intermediate group so the pivot is purely for pitching
    const canardWrapper = new THREE.Group();
    canardWrapper.add(canardMesh);

    canardPivot.add(canardWrapper);
    group.add(canardPivot);

    // Store the wrapper or pivot to animate it?
    // Animate the pitch: local Z axis rotation for the profile?
    // ExtrudeGeometry builds shapes on the XY plane.
    // So the canard is flat on XY, with thickness along Z.
    // When we rotate around X, it pitches.
    canards.push(canardPivot);
  }

  group.scale.set(0.75, 0.75, 0.75);
  return group;
}

function resizeCanvas() {
  $canvas.width = $canvas.clientWidth * devicePixelRatio;
  $canvas.height = $canvas.clientHeight * devicePixelRatio;
  if (renderer) {
    renderer.setSize($canvas.clientWidth, $canvas.clientHeight, false);
    camera.aspect = $canvas.clientWidth / $canvas.clientHeight;
    camera.updateProjectionMatrix();
  }
  const mCanvas = document.getElementById("minimap-canvas");
  if (minimapRenderer && mCanvas) {
    minimapRenderer.setSize(mCanvas.clientWidth, mCanvas.clientHeight, false);
    if (minimapCamera) {
      minimapCamera.aspect = mCanvas.clientWidth / mCanvas.clientHeight;
      minimapCamera.updateProjectionMatrix();
    }
  }
}
window.addEventListener("resize", resizeCanvas);

function renderGame() {
  if (rocketGroup) {
    rocketGroup.rotation.z = -(rocket.angle * Math.PI / 180);

    // Animate the 4 canards based on user input
    const uRad = (rocket.userAngle * Math.PI / 180);
    if (canards.length === 4) {
      canards[0].rotation.x = -uRad; // Right
      canards[2].rotation.x = uRad;  // Left

      // Make front/back canards move slightly for a more dynamic feel
      canards[1].rotation.x = uRad * 0.5;
      canards[3].rotation.x = -uRad * 0.5;
    }
  }

  // ── CFD Streamline Visualization ──────────────────────────────────────
  if (cfdParticleSystem && rocket.cfd && rocket.cfd.ux) {
    const uxArr = rocket.cfd.ux;
    const uyArr = rocket.cfd.uy;
    const nx = Math.round(Math.sqrt(uxArr.length));
    const ny = nx;
    if (nx < 2) return; // safety

    // Calculate the visible area of the scene at z=0 (where the rocket is)
    // Camera is at z=10, FOV=60°, so half-height = 10 * tan(30°) ≈ 5.77
    const camDist = camera.position.z;
    const vFov = camera.fov * Math.PI / 180;
    const visH = 2 * camDist * Math.tan(vFov / 2); // total visible height ~11.5
    const visW = visH * camera.aspect;

    // Map grid coordinates [0..nx] → [-visW/2..+visW/2] in world X
    // Map grid coordinates [0..ny] → [+visH/2..-visH/2] in world Y (top→bottom)
    function gridToWorld(gx, gy) {
      return {
        wx: (gx / nx - 0.5) * visW,
        wy: (0.5 - gy / ny) * visH
      };
    }

    // Bilinear interpolation of velocity at fractional grid coords
    function getVel(gx, gy) {
      if (gx < 0 || gx >= nx - 1 || gy < 0 || gy >= ny - 1) return { vx: 0, vy: 0 };
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const tx = gx - x0, ty = gy - y0;
      const i00 = y0 * nx + x0;
      const i10 = i00 + 1;
      const i01 = i00 + nx;
      const i11 = i01 + 1;
      const vx = uxArr[i00] * (1 - tx) * (1 - ty) + uxArr[i10] * tx * (1 - ty)
               + uxArr[i01] * (1 - tx) * ty        + uxArr[i11] * tx * ty;
      const vy = uyArr[i00] * (1 - tx) * (1 - ty) + uyArr[i10] * tx * (1 - ty)
               + uyArr[i01] * (1 - tx) * ty        + uyArr[i11] * tx * ty;
      return { vx, vy };
    }

    const streamCount = cfdParticleSystem.children.length; // 28
    const segments = 80;
    const stepSize = 0.6;  // grid cells per integration step
    const maxMag = 0.15;   // matches LBM max velocity for color mapping

    for (let i = 0; i < streamCount; i++) {
      const line = cfdParticleSystem.children[i];
      const pos = line.geometry.attributes.position.array;
      const col = line.geometry.attributes.color.array;

      // Seed points: spread evenly across top edge
      let gx = (i + 0.5) * (nx / streamCount);
      let gy = 0.5;

      for (let s = 0; s < segments; s++) {
        const v = getVel(gx, gy);
        const mag = Math.sqrt(v.vx * v.vx + v.vy * v.vy);

        // Convert grid position to world coordinates
        const w = gridToWorld(gx, gy);
        pos[s * 3]     = w.wx;
        pos[s * 3 + 1] = w.wy;
        pos[s * 3 + 2] = 1.0; // slightly in front of rocket

        // Color: blue (slow) → cyan → green → yellow → red (fast)
        const t = Math.min(mag / maxMag, 1.0);
        const hue = (1.0 - t) * 240; // 240=blue → 0=red
        let r = 0, g = 0, b = 0;
        if (hue > 180)      { r = 0; g = (240 - hue) / 60; b = 1; }
        else if (hue > 120) { r = 0; g = 1; b = (hue - 120) / 60; }
        else if (hue > 60)  { r = (120 - hue) / 60; g = 1; b = 0; }
        else                { r = 1; g = hue / 60; b = 0; }
        col[s * 3] = r; col[s * 3 + 1] = g; col[s * 3 + 2] = b;

        // Advance the streamline using Euler integration
        if (mag > 0.0005) {
          // Normalize and step a fixed distance in grid space
          const invMag = stepSize / mag;
          gx += v.vx * invMag;
          gy += v.vy * invMag;
        } else {
          // Dead zone (inside obstacle or stagnation): push downward
          gy += stepSize;
        }

        // Clamp to grid bounds
        gx = Math.max(0, Math.min(nx - 1, gx));
        gy = Math.max(0, Math.min(ny - 1, gy));
      }

      line.geometry.attributes.position.needsUpdate = true;
      line.geometry.attributes.color.needsUpdate = true;
    }
  }

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }

  renderMinimap();
}

function renderMinimap() {
  if (!minimapRenderer || !minimapScene || !minimapCamera) return;

  // Scale: 1 meter = 0.5 world units
  const s = 0.5;
  const rx = rocket.lateralPos * s;
  const ry = rocket.altitude * s;

  if (minimapRocket) {
    minimapRocket.position.x = rx;
    minimapRocket.position.y = ry;
    minimapRocket.rotation.z = -(rocket.angle * Math.PI / 180);
  }

  const targetBeacon = minimapScene.getObjectByName("targetBeacon");
  const tx = rocket.targetX !== undefined ? rocket.targetX * s : 0;
  if (targetBeacon) {
    targetBeacon.position.x = tx;
    targetBeacon.position.y = 0;
  }

  // Camera: frame both the rocket and the target with margin
  // Center X between rocket and target
  const cx = (rx + tx) / 2;
  // Center Y: show from ground (0) to above the rocket
  const cy = Math.max(ry / 2, 10);

  // Zoom: distance from camera so both points fit in view
  // Compute the bounding box we need to show
  const spanX = Math.abs(rx - tx) + 40;  // horizontal span + margin
  const spanY = Math.max(ry + 20, 40);   // vertical span (ground to rocket + margin)
  const span = Math.max(spanX, spanY);

  // Distance needed to fit 'span' units in view with FOV 50°
  const fovRad = minimapCamera.fov * Math.PI / 180;
  const dist = (span / 2) / Math.tan(fovRad / 2);
  const camZ = Math.max(dist, 60); // minimum distance

  minimapCamera.position.set(cx, cy, camZ);
  minimapCamera.lookAt(cx, cy, 0);

  minimapRenderer.render(minimapScene, minimapCamera);
}

function renderConfigRocket() {
  const cCanvas = document.getElementById("config-rocket-canvas");
  if (!cCanvas) return;
  const cCtx = cCanvas.getContext("2d");
  const W = cCanvas.width, H = cCanvas.height;
  cCtx.clearRect(0, 0, W, H);

  // Background
  const grad = cCtx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#020410");
  grad.addColorStop(1, "#0d1220");
  cCtx.fillStyle = grad;
  cCtx.fillRect(0, 0, W, H);

  let rLen = 140, rW = 28;
  let finSpan = 20, finRoot = 20;

  const mH = parseFloat(confInputs.height.value) || 3.0;
  const mW = parseFloat(confInputs.width.value) || 0.2;
  const scale = 140 / mH;
  rLen = mH * scale;
  rW = mW * scale * 2.0;

  if (currentRocketData && currentRocketData.length > 0) {
    const s = 140 / currentRocketData.length;
    rLen = currentRocketData.length * s;
    rW = currentRocketData.radius * 2 * s * 2.0;
    finSpan = currentRocketData.fin_span * s * 2.5;
    finRoot = currentRocketData.fin_root * s * 2.0;
  }

  const cx = W / 2;
  const cy = H / 2 + rLen / 10;

  cCtx.save();
  cCtx.translate(cx, cy);

  // Body
  cCtx.fillStyle = "#c0c8d4";
  cCtx.beginPath();
  cCtx.moveTo(-rW / 2, rLen * 0.35);
  cCtx.lineTo(-rW / 2, -rLen * 0.35);
  cCtx.quadraticCurveTo(-rW / 2, -rLen * 0.45, 0, -rLen / 2);
  cCtx.quadraticCurveTo(rW / 2, -rLen * 0.45, rW / 2, -rLen * 0.35);
  cCtx.lineTo(rW / 2, -rLen * 0.35);
  cCtx.lineTo(rW / 2, rLen * 0.35);
  cCtx.closePath();
  cCtx.fill();

  // Accent stripe
  cCtx.fillStyle = "#ff6600";
  cCtx.fillRect(-rW / 2 + 2, -rLen * 0.15, rW - 4, 8);

  // Fins
  cCtx.fillStyle = "#3a4455";
  cCtx.beginPath();
  cCtx.moveTo(-rW / 2, rLen * 0.35);
  cCtx.lineTo(-rW / 2 - finSpan, rLen * 0.35 + 4);
  cCtx.lineTo(-rW / 2, rLen * 0.35 - finRoot);
  cCtx.closePath(); cCtx.fill();

  cCtx.beginPath();
  cCtx.moveTo(rW / 2, rLen * 0.35);
  cCtx.lineTo(rW / 2 + finSpan, rLen * 0.35 + 4);
  cCtx.lineTo(rW / 2, rLen * 0.35 - finRoot);
  cCtx.closePath(); cCtx.fill();

  // Canards (Active Stabilization) based on NACA profile
  const naca = confInputs.naca ? confInputs.naca.value : "66-212";
  const canardSpan = finSpan * 0.8;
  const canardRoot = finRoot * 0.8;
  const canardY = -rLen * 0.15;

  cCtx.fillStyle = "#ff6600";

  // Left canard
  cCtx.save();
  cCtx.translate(-rW / 2, canardY);
  cCtx.rotate(Math.PI / 8); // Tilt to show profile
  cCtx.beginPath();
  cCtx.moveTo(0, canardRoot / 2);

  if (naca === "0012") {
    // Thin symmetric
    cCtx.lineTo(-canardSpan, 1);
    cCtx.lineTo(0, -canardRoot / 2);
  } else if (naca === "0018") {
    // Thick symmetric
    cCtx.lineTo(-canardSpan, 4);
    cCtx.lineTo(0, -canardRoot / 2);
  } else if (naca === "66-212") {
    // Cambered (curved)
    cCtx.quadraticCurveTo(-canardSpan / 2, 8, -canardSpan, 2);
    cCtx.lineTo(0, -canardRoot / 2);
  } else {
    cCtx.lineTo(-canardSpan, 2);
    cCtx.lineTo(0, -canardRoot / 2);
  }
  cCtx.closePath();
  cCtx.fill();
  cCtx.restore();

  // Right canard
  cCtx.save();
  cCtx.translate(rW / 2, canardY);
  cCtx.rotate(Math.PI / 8);
  cCtx.beginPath();
  cCtx.moveTo(0, canardRoot / 2);
  if (naca === "0012") {
    cCtx.lineTo(canardSpan, 1);
    cCtx.lineTo(0, -canardRoot / 2);
  } else if (naca === "0018") {
    cCtx.lineTo(canardSpan, 4);
    cCtx.lineTo(0, -canardRoot / 2);
  } else if (naca === "66-212") {
    cCtx.quadraticCurveTo(canardSpan / 2, -4, canardSpan, 2);
    cCtx.lineTo(0, -canardRoot / 2);
  } else {
    cCtx.lineTo(canardSpan, 2);
    cCtx.lineTo(0, -canardRoot / 2);
  }
  cCtx.closePath();
  cCtx.fill();
  cCtx.restore();

  // Barrowman CP Calculation
  const L_nose = rLen * 0.2;
  const CN_nose = 2.0;
  const X_nose = 0.466 * L_nose;

  const d = rW;
  const CN_rear = 8.0 * Math.pow(finSpan / d, 2);
  const X_rear = rLen - (finRoot / 2.0);

  const CN_canard = 4.0 * Math.pow(canardSpan / d, 2);
  const X_canard = rLen * 0.15 + (canardRoot / 2.0);

  const total_CN = CN_nose + CN_rear + CN_canard;
  const X_cp = (CN_nose * X_nose + CN_rear * X_rear + CN_canard * X_canard) / total_CN;

  // Draw CP Indicator (Green dotted circle)
  cCtx.fillStyle = "rgba(0, 255, 0, 0.4)";
  cCtx.strokeStyle = "#00ff00";
  cCtx.lineWidth = 1;
  cCtx.setLineDash([2, 2]);
  cCtx.beginPath();
  cCtx.arc(0, -rLen / 2 + X_cp, d * 0.4, 0, Math.PI * 2);
  cCtx.fill();
  cCtx.stroke();
  cCtx.setLineDash([]);

  // Draw CP symbol cross
  cCtx.beginPath();
  cCtx.moveTo(-d * 0.4, -rLen / 2 + X_cp);
  cCtx.lineTo(d * 0.4, -rLen / 2 + X_cp);
  cCtx.moveTo(0, -rLen / 2 + X_cp - d * 0.4);
  cCtx.lineTo(0, -rLen / 2 + X_cp + d * 0.4);
  cCtx.stroke();

  cCtx.restore();
}
