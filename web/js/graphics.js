// --- THREE.JS RENDERING ---


function initThreeJS() {
  renderer = new THREE.WebGLRenderer({ canvas: $canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(60, $canvas.clientWidth / $canvas.clientHeight, 1.0, 20000);
  camera.position.z = 10;
  camera.position.y = 0;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.camera.left = -20;
  dirLight.shadow.camera.right = 20;
  dirLight.shadow.camera.top = 20;
  dirLight.shadow.camera.bottom = -20;
  scene.add(dirLight);

  // Load rocket model (GLB or Procedural)
  loadRocketModel((modelGroup) => {
    rocketGroup = modelGroup;
    scene.add(rocketGroup);
  }, true);

  // Ground mesh for visual context during liftoff
  const groundGroup = new THREE.Group();
  
  const groundSolid = new THREE.Mesh(
    new THREE.BoxGeometry(8000, 200, 8000),
    new THREE.MeshStandardMaterial({ color: 0x1a2118, roughness: 0.9, metalness: 0.1 })
  );
  groundSolid.receiveShadow = true;
  groundSolid.position.y = -102.8; // Top of the box is at -2.8
  groundGroup.add(groundSolid);
  
  const gridHelper = new THREE.GridHelper(8000, 1000, 0x445544, 0x223322);
  gridHelper.position.y = -2.79; // Just above the box (box top is at -2.8)
  groundGroup.add(gridHelper);

  // Target landing pad
  const padGeo = new THREE.CylinderGeometry(8, 8, 0.5, 32);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.5 });
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.position.y = -2.54; // Sit on top of the box
  pad.name = "mainTargetMarker";
  
  const ringGeo = new THREE.RingGeometry(4, 6, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4444, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.26; // slightly above pad
  pad.add(ring);
  
  const beaconGeo = new THREE.CylinderGeometry(3, 3, 20000, 32);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.2, depthWrite: false });
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.position.y = 10000;
  pad.add(beacon);

  groundGroup.add(pad);

  groundMesh = groundGroup;
  scene.add(groundMesh);

  // CFD Continuous Streamlines (Professional VWT Style)
  const streamCount = 28;
  const segments = 80;

  cfdParticleSystem = new THREE.Group();
  
  // Stars for background and parallax effect
  const starGeo = new THREE.BufferGeometry();
  const starVertices = [];
  for (let i = 0; i < 600; i++) {
    const x = (Math.random() - 0.5) * 800;
    const y = (Math.random() - 0.5) * 800;
    const z = - (Math.random() * 200 + 60);
    starVertices.push(x, y, z);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
  
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.6,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    sizeAttenuation: true
  });
  
  starsGroup = new THREE.Group();
  const starMesh1 = new THREE.Points(starGeo, starMat);
  starMesh1.renderOrder = -10;
  const starMesh2 = new THREE.Points(starGeo, starMat);
  starMesh2.renderOrder = -10;
  starMesh2.position.y = 800;
  starsGroup.add(starMesh1);
  starsGroup.add(starMesh2);
  
  scene.add(starsGroup);
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

    // Reuse procedural or GLB rocket for map visibility
    loadRocketModel((modelGroup) => {
      minimapRocket = modelGroup;
      minimapRocket.scale.set(2.344, 2.344, 2.344);
      minimapScene.add(minimapRocket);
    });

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

function loadRocketModel(callback, isMain = false) {
  if (customModelDataURL) {
    const loader = new THREE.GLTFLoader();
    loader.load(customModelDataURL, (gltf) => {
      const model = gltf.scene;
      
      // Try to find canards in the GLB to animate them
      let tempCanards = [];
      const canardNames = ["canard_1", "canard_2", "canard_3", "canard_4"]; // adjust names as needed
      model.traverse((child) => {
        if (child.isMesh && canardNames.includes(child.name.toLowerCase())) {
          tempCanards.push(child);
        }
      });
      // Fallback: if not exactly 4 canards found by name, just leave empty
      if (tempCanards.length !== 4) {
        tempCanards = [];
      }
      if (isMain) {
        canards = tempCanards;
      }

      // Center and scale the model automatically
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 7.8 / maxDim; // Adjust to match procedural rocket size (~7.8 units height)
      
      model.position.sub(center);
      model.scale.set(scale, scale, scale);
      
      const wrapper = new THREE.Group();
      wrapper.add(model);
      callback(wrapper);
    }, undefined, (error) => {
      console.error("Failed to load GLB:", error);
      callback(buildProceduralRocket(isMain));
    });
  } else {
    callback(buildProceduralRocket(isMain));
  }
}

function buildProceduralRocket(isMain = false) {
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
  let tempCanards = [];
  
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
    tempCanards.push(canardPivot);
  }
  
  if (isMain) {
    canards = tempCanards;
  }

  group.traverse(function(child) {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  group.scale.set(0.75, 0.75, 0.75);
  return group;
}

let explosions = [];
let screenShake = 0;

function createExplosion(x, y, z) {
  const fireGeo = new THREE.SphereGeometry(1, 32, 32);
  const fireMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 1, depthWrite: false });
  const fireball = new THREE.Mesh(fireGeo, fireMat);
  fireball.position.set(x, y, z);
  scene.add(fireball);

  const particleCount = 100;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(particleCount * 3);
  const pVel = [];
  for(let i=0; i<particleCount; i++) {
    pPos[i*3] = x;
    pPos[i*3+1] = y;
    pPos[i*3+2] = z;
    pVel.push(new THREE.Vector3(
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 20
    ));
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0xff4400, size: 0.8, transparent: true, opacity: 1, depthWrite: false });
  const pSystem = new THREE.Points(pGeo, pMat);
  scene.add(pSystem);

  explosions.push({
    fireball: fireball,
    particles: pSystem,
    velocities: pVel,
    age: 0,
    maxAge: 60
  });

  screenShake = 15;
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
  if (starsGroup) {
    starsGroup.position.y = - (rocket.altitude / 15.0) % 800;
  }

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

  if (groundMesh) {
    // 1 unit in 3D ≈ 1.5 meters of altitude (scale factor)
    groundMesh.position.y = -5.5 - (rocket.altitude / 1.5);
    groundMesh.position.x = - (rocket.lateralPos / 1.5);

    const targetMarker = groundMesh.getObjectByName("mainTargetMarker");
    if (targetMarker && rocket.targetX !== undefined) {
      targetMarker.position.x = rocket.targetX / 1.5;
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

        // Animación del flujo a lo largo de las streamlines
        const timeOffset = performance.now() * 0.015;
        const phase = s * 0.3 - timeOffset;
        const pulse = 0.15 + 0.85 * Math.max(0, Math.sin(phase)); // Pulsos de flujo

        col[s * 3] = r * pulse; col[s * 3 + 1] = g * pulse; col[s * 3 + 2] = b * pulse;

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

  if (screenShake > 0) {
    camera.position.x = (Math.random() - 0.5) * screenShake * 0.1;
    camera.position.y = (Math.random() - 0.5) * screenShake * 0.1;
    screenShake -= 0.5;
  } else {
    camera.position.x = 0;
    camera.position.y = 0;
  }

  for(let i=explosions.length-1; i>=0; i--) {
    let exp = explosions[i];
    exp.age++;
    
    const scale = 1 + exp.age * 0.8;
    exp.fireball.scale.set(scale, scale, scale);
    exp.fireball.material.opacity = 1 - (exp.age / exp.maxAge);
    
    const positions = exp.particles.geometry.attributes.position.array;
    for(let p=0; p<positions.length/3; p++) {
      positions[p*3] += exp.velocities[p].x * 0.1;
      positions[p*3+1] += exp.velocities[p].y * 0.1;
      positions[p*3+2] += exp.velocities[p].z * 0.1;
    }
    exp.particles.geometry.attributes.position.needsUpdate = true;
    exp.particles.material.opacity = 1 - (exp.age / exp.maxAge);

    if (exp.age >= exp.maxAge) {
      scene.remove(exp.fireball);
      scene.remove(exp.particles);
      explosions.splice(i, 1);
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

  // Bounding box of the entire flight area: Launchpad (0,0), Target (tx,0), Rocket (rx,ry)
  const minX = Math.min(0, tx, rx);
  const maxX = Math.max(0, tx, rx);
  const minY = Math.min(0, ry);
  const maxY = Math.max(0, ry);

  // Centers
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Spans with margin
  const spanX = (maxX - minX) + 60; // horizontal margin
  const spanY = (maxY - minY) + 60; // vertical margin

  // Compute required camera distance based on vertical and horizontal FOV
  const aspect = minimapCamera.aspect || (minimapRenderer.domElement.clientWidth / minimapRenderer.domElement.clientHeight);
  const fovRad = minimapCamera.fov * Math.PI / 180;
  
  const distY = (spanY / 2) / Math.tan(fovRad / 2);
  const distX = (spanX / 2) / Math.tan(fovRad / 2) / aspect;

  const camZ = Math.max(distY, distX, 80); // minimum distance

  minimapCamera.position.set(cx, cy, camZ);
  minimapCamera.lookAt(cx, cy, 0);

  minimapRenderer.render(minimapScene, minimapCamera);
}

let configRenderer, configScene, configCamera, configRocketGroup;
let configAnimationId = null;

function renderConfigRocket() {
  const cCanvas = document.getElementById("config-rocket-canvas");
  if (!cCanvas) return;
  
  if (!configRenderer) {
    configRenderer = new THREE.WebGLRenderer({ canvas: cCanvas, antialias: true, alpha: true });
    configRenderer.setPixelRatio(window.devicePixelRatio);
    
    configScene = new THREE.Scene();
    
    configCamera = new THREE.PerspectiveCamera(50, cCanvas.width / cCanvas.height, 0.1, 100);
    configCamera.position.set(0, 1, 12);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    configScene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 5);
    configScene.add(dirLight);
    
    const animateConfig = function() {
      configAnimationId = requestAnimationFrame(animateConfig);
      if (configRocketGroup) {
        configRocketGroup.rotation.y += 0.015;
      }
      configRenderer.render(configScene, configCamera);
    };
    animateConfig();
  }
  
  updateConfigModel();
}

function updateConfigModel() {
  if (configRocketGroup) {
    configScene.remove(configRocketGroup);
  }
  
  loadRocketModel((modelGroup) => {
    configRocketGroup = modelGroup;
    configScene.add(configRocketGroup);
  }, false);
}

function updateMainRocketModel() {
  if (rocketGroup) {
    scene.remove(rocketGroup);
  }
  if (minimapRocket) {
    minimapScene.remove(minimapRocket);
  }
  
  loadRocketModel((modelGroup) => {
    rocketGroup = modelGroup;
    scene.add(rocketGroup);
  }, true);
  
  loadRocketModel((modelGroup) => {
    minimapRocket = modelGroup;
    minimapRocket.scale.set(2.344, 2.344, 2.344);
    minimapScene.add(minimapRocket);
  });
}
