/* ═══════════════════════════════════════════════════════════════════════
   Weathercocking Simulator — Frontend Application
   Canvas rendering · WebSocket IPC · Game loop
   All vision (camera + MediaPipe) runs in the Python backend.
   ═══════════════════════════════════════════════════════════════════════ */

"use strict";

// ── Configuration ──────────────────────────────────────────────────────
const WS_URL        = "ws://127.0.0.1:8765";
const GAME_DURATION = 15.0;
const STAR_COUNT    = 200;
const PARTICLE_MAX  = 40;

// ── Global state ───────────────────────────────────────────────────────
let ws              = null;
let socket          = null;
let gameState       = "splash";          // splash | countdown | playing | results
let keyboardAngle   = 0;                 // degrees (keyboard fallback)
let cameraActive    = false;             // set by backend's "camera_active" flag
let keysDown        = {};
let mode            = "PID";
let stars           = Array.from({ length: STAR_COUNT }, () => ({
  x: Math.random(), y: Math.random(),
  r: Math.random() * 1.4 + 0.3,
  speed: Math.random() * 0.4 + 0.1,
  brightness: Math.random() * 0.6 + 0.4,
}));
let particles       = [];
let cfdParticles    = []; // For visualizing wind
let currentRocketData = null;
let orkFileData     = null;
let map             = null;
let mapMarker       = null;
let replayData      = null;
let replayIndex     = 0;
let replayFrameCounter = 0;
let currentCrashAngle = 45.0;
let currentCrashEnabled = true;

const rocket = {
  angle: 0, angularVelocity: 0,
  altitude: 0, lateralPos: 0,
  windForce: 0, windSpeedKmh: 0,
  userAngle: 0, time: 0,
  candy: 0, accDev: 0,
  path: []
};

// ── DOM refs ───────────────────────────────────────────────────────────
const $splash     = document.getElementById("splash-screen");
const $countdown  = document.getElementById("countdown-overlay");
const $game       = document.getElementById("game-screen");
const $results    = document.getElementById("results-screen");
const $canvas     = document.getElementById("rocket-canvas");
const ctx         = $canvas.getContext("2d");
const $camFrame   = document.getElementById("camera-frame");
const $pipPlace   = document.getElementById("pip-placeholder");
const $btnStart   = document.getElementById("btn-start");
const $btnRestart = document.getElementById("btn-restart");
const $btnConfig  = document.getElementById("btn-config");
const $configScreen = document.getElementById("config-screen");
const $btnSaveConfig = document.getElementById("btn-save-config");
const $btnPause   = document.getElementById("btn-pause");
const $warningBanner = document.getElementById("warning-banner");

const confInputs = {
  mass: document.getElementById("conf-mass"),
  height: document.getElementById("conf-height"),
  width: document.getElementById("conf-width"),
  candy: document.getElementById("conf-candy"),
  angle: document.getElementById("conf-angle"),
  crash: document.getElementById("conf-crash"),
  loc: document.getElementById("conf-loc"),
  date: document.getElementById("conf-date"),
  time: document.getElementById("conf-time"),
  inertiaMult: document.getElementById("conf-inertia-mult"),
  damping: document.getElementById("conf-damping"),
  naca: document.getElementById("conf-naca"),
};

let initialCandy = 0.250;

// ── Star field and Exhaust particles are already declared in global state ──
function spawnParticle(cx, cy, angle) {
  if (particles.length >= PARTICLE_MAX) particles.shift();
  const spread = (Math.random() - 0.5) * 0.6;
  particles.push({
    x: cx, y: cy,
    vx: Math.sin(angle + spread) * (Math.random() * 2 + 2),
    vy: Math.cos(angle + spread) * (Math.random() * 3 + 4),
    life: 1.0,
    size: Math.random() * 3 + 2,
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  SCREEN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════
function showScreen(id) {
  [$splash, $configScreen, $countdown, $game, $results].forEach(s => s && s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ORK File Drag and Drop globals
const dropZone = document.getElementById('drop-zone');
const orkInput = document.getElementById('conf-ork');
const fileNameDisplay = document.getElementById('file-name');

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, preventDefaults, false);
});
function preventDefaults (e) {
  e.preventDefault();
  e.stopPropagation();
}
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
});
['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
});
dropZone.addEventListener('drop', handleDrop, false);
orkInput.addEventListener('change', (e) => {
  if(e.target.files.length) handleFile(e.target.files[0]);
});

function handleDrop(e) {
  let dt = e.dataTransfer;
  let files = dt.files;
  if (files.length) handleFile(files[0]);
}

function handleFile(file) {
  if (file.name.endsWith('.ork')) {
    fileNameDisplay.textContent = file.name;
    const reader = new FileReader();
    reader.onload = function(e) {
      const base64 = e.target.result.split(',')[1];
      orkFileData = base64;
      wsSend({ action: "parse_ork", ork_file: base64 });
    };
    reader.readAsDataURL(file);
  } else {
    fileNameDisplay.textContent = 'Formato inválido (solo .ork)';
    orkFileData = null;
  }
}

// Hook inputs to redraw rocket preview
confInputs.height.addEventListener("input", renderConfigRocket);
confInputs.width.addEventListener("input", renderConfigRocket);
if (confInputs.naca) {
  confInputs.naca.addEventListener("change", renderConfigRocket);
}

// Initial render
setTimeout(renderConfigRocket, 500);

// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
//  WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════
function connectWS() {
  ws = new WebSocket(WS_URL);
  socket = ws;

  ws.onopen = () => {
    console.log("[WS] connected");
    setCameraStatus("ok", "Backend conectado");
    $btnStart.disabled = false;
    
    // Request default ork model
    wsSend({ action: "load_default_ork" });
  };

  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);

    if (d.action === "started") {
      cameraActive = !!d.camera_active;
      gameState = "playing";
      showScreen("game-screen");
      resizeCanvas();
      
      if (d.weather) {
        document.getElementById("meteo-desc").innerHTML = d.weather.desc;
      }
      
      if (d.ork_geo) {
        currentRocketData = d.ork_geo;
      } else {
        currentRocketData = null;
      }

      // Show or hide PiP placeholder
      if (!cameraActive) {
        $pipPlace.style.display = "flex";
        $camFrame.style.display = "none";
      } else {
        $pipPlace.style.display = "none";
        $camFrame.style.display = "block";
      }
    }

    else if (d.action === "state") {
      Object.assign(rocket, {
        angle: d.angle,
        angularVelocity: d.angular_velocity,
        altitude: d.altitude,
        verticalVelocity: d.vertical_velocity,
        isFalling: d.is_falling,
        lateralPos: d.lateral_pos,
        windForce: d.wind_force,
        windSpeedKmh: d.wind_speed_kmh,
        userAngle: d.user_angle,
        time: d.time,
        candy: d.candy,
        cfd: d.cfd !== undefined ? d.cfd : rocket.cfd
      });
      rocket.accDev += Math.abs(d.angle) * (1/60);
      rocket.path.push({x: d.lateral_pos, y: d.altitude});
      if (d.camera_active !== undefined) cameraActive = d.camera_active;
      // Update PiP if a frame was included
      if (d.frame) {
        $camFrame.src = "data:image/jpeg;base64," + d.frame;
        $camFrame.style.display = "block";
        $pipPlace.style.display = "none";
      }
      updateHUD();
    }

    else if (d.action === "game_over") {
      Object.assign(rocket, d.state);
      
      if (d.pid_trajectory && d.pid_trajectory.length > 0) {
        gameState = "replay-intro";
        replayData = d;
        replayIndex = 0;
        replayFrameCounter = 0;
        
        const overlay = document.getElementById("replay-overlay");
        if (overlay) overlay.classList.remove("hidden");

        setTimeout(() => {
          if (overlay) overlay.classList.add("hidden");
          gameState = "replay";
          const banner = document.getElementById("warning-banner");
          if (banner) {
            banner.textContent = "REPETICIÓN - SISTEMA PID";
            banner.className = "warning-banner replay-banner";
          }
          const label = document.getElementById("hud-user-label");
          if (label) label.textContent = "INCLINACIÓN PID (CANARDS)";
        }, 2500);
        
      } else {
        gameState = "results";
        showResults(d);
      }
    }
    
    else if (d.action === "ork_parsed") {
      if (d.ork_geo) {
        if (d.ork_geo.mass > 0) confInputs.mass.value = d.ork_geo.mass.toFixed(1);
        if (d.ork_geo.length > 0) confInputs.height.value = d.ork_geo.length.toFixed(2);
        if (d.ork_geo.radius > 0) confInputs.width.value = (d.ork_geo.radius * 2).toFixed(2);
        
        if (d.ork_file) {
          orkFileData = d.ork_file;
        }

        if (d.default_loaded) {
          fileNameDisplay.textContent = "rocket.ork (Modelo por defecto)";
        }
        
        // Trigger a render update for the preview
        renderConfigRocket();
      } else {
        fileNameDisplay.textContent += " (Error de formato)";
      }
    }
  };

  ws.onerror = () => setTimeout(connectWS, 1200);
  ws.onclose = () => {
    if (gameState !== "results") setTimeout(connectWS, 1200);
  };
}

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ═══════════════════════════════════════════════════════════════════════
//  CAMERA STATUS
// ═══════════════════════════════════════════════════════════════════════
function setCameraStatus(state, text) {
  const dot = document.querySelector(".status-dot");
  dot.className = "status-dot " + state;
  document.getElementById("status-text").textContent = text;
}

// ═══════════════════════════════════════════════════════════════════════
//  KEYBOARD FALLBACK
// ═══════════════════════════════════════════════════════════════════════
document.addEventListener("keydown", e => { keysDown[e.key] = true; });
document.addEventListener("keyup",   e => { keysDown[e.key] = false; });

function pollKeyboard() {
  const speed = 0.35; // Slower speed for finer control
  if (keysDown["ArrowLeft"]  || keysDown["a"]) keyboardAngle = Math.max(-25, keyboardAngle - speed);
  else if (keysDown["ArrowRight"] || keysDown["d"]) keyboardAngle = Math.min(25, keyboardAngle + speed);
  else keyboardAngle *= 0.95; // Slower decay so it doesn't snap back to 0 instantly
}

// ═══════════════════════════════════════════════════════════════════════
//  HUD UPDATE
// ═══════════════════════════════════════════════════════════════════════
function updateHUD() {
  const dev = Math.abs(rocket.angle);
  const $dev = document.getElementById("hud-deviation");
  $dev.textContent = rocket.angle.toFixed(1) + "°";
  $dev.className = "hud-value " + (dev < 5 ? "green" : dev < 15 ? "yellow" : "red");

  document.getElementById("hud-user-angle").textContent  = rocket.userAngle.toFixed(1) + "°";
  
  const $accDev = document.getElementById("hud-acc-dev");
  if ($accDev) $accDev.textContent = rocket.accDev.toFixed(1) + "°s";
  
  document.getElementById("hud-wind").textContent         = rocket.windForce.toFixed(1) + " N";
  document.getElementById("hud-altitude").textContent     = Math.round(rocket.altitude) + " m";
  document.getElementById("hud-angvel").textContent       = rocket.angularVelocity.toFixed(1) + " °/s";
  document.getElementById("hud-windspeed").textContent    = rocket.windSpeedKmh.toFixed(1);

  // Candy Gauge
  const $candyVal = document.getElementById("hud-candy-val");
  if ($candyVal) $candyVal.textContent = Math.max(0, rocket.candy).toFixed(1) + " kg";
  
  const $candyBar = document.getElementById("candy-bar");
  if ($candyBar) {
    const p = Math.max(0, Math.min(100, (rocket.candy / initialCandy) * 100));
    $candyBar.style.width = p + "%";
    if (p < 20) $candyBar.style.backgroundColor = "var(--red)";
    else if (p < 50) $candyBar.style.backgroundColor = "var(--yellow)";
    else $candyBar.style.backgroundColor = "var(--green)";
  }

  // Guidance Indicator removed per user request
}

// ═══════════════════════════════════════════════════════════════════════
//  CANVAS RENDERING
// ═══════════════════════════════════════════════════════════════════════
function resizeCanvas() {
  $canvas.width  = $canvas.clientWidth  * devicePixelRatio;
  $canvas.height = $canvas.clientHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
window.addEventListener("resize", resizeCanvas);

function renderGame() {
  const W = $canvas.clientWidth;
  const H = $canvas.clientHeight;
  ctx.clearRect(0, 0, W, H);

  // ── Background gradient ──────────────────────────────────────────
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#020410");
  grad.addColorStop(0.6, "#0a0e1a");
  grad.addColorStop(1, "#0d1220");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // ── Stars ────────────────────────────────────────────────────────
  const scrollOffY = (rocket.altitude * 1.5) % H;
  const scrollOffX = (-rocket.lateralPos * 1.5) % W;
  for (const s of stars) {
    const sy = ((s.y * H + scrollOffY * s.speed) % H + H) % H;
    const sx = ((s.x * W + scrollOffX * s.speed) % W + W) % W;
    ctx.beginPath();
    ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,220,255,${s.brightness})`;
    ctx.fill();
  }

  // Warning Banner Logic removed during gameplay per user request

  // ── Grid lines ───────────────────────────────────────────────────
  ctx.strokeStyle = "rgba(0,212,255,0.06)";
  ctx.lineWidth = 1;
  const cx = W / 2;
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const x = cx + i * 80;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

  // ── Rocket ───────────────────────────────────────────────────────
  let rLen = 160, rW = 32;
  let finSpan = 22, finRoot = 22;
  if (currentRocketData && currentRocketData.length > 0) {
    // Scale length down to fit screen (e.g. 160px = original length)
    const scale = 160 / currentRocketData.length;
    rLen = currentRocketData.length * scale || 160;
    rW = (currentRocketData.radius * 2 * scale * 2.0) || 32; 
    finSpan = (currentRocketData.fin_span * scale * 2.5) || 22;
    finRoot = (currentRocketData.fin_root * scale * 2.0) || 22;
  }
  
  const ry   = H * 0.48;
  const rx   = cx;
  let ang  = (rocket.angle * Math.PI) / 180;

  // ── Ground ────────────────────────────────────────────────────────
  const groundY = ry + rLen / 2 + rocket.altitude * 1.5;
  if (groundY < H) {
    ctx.fillStyle = "#1a2436";
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.strokeStyle = "#2a3b59";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(W, groundY);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(rx, ry);
  ctx.rotate(ang);

  // Body
  ctx.fillStyle = "#c0c8d4";
  ctx.beginPath();
  ctx.moveTo(-rW / 2,  rLen * 0.35);
  ctx.lineTo(-rW / 2, -rLen * 0.35);
  
  if (currentRocketData && currentRocketData.nose_shape === "conical") {
    ctx.lineTo(0, -rLen / 2);
  } else {
    // ogive or default
    ctx.quadraticCurveTo(-rW/2, -rLen * 0.45, 0, -rLen / 2);
    ctx.quadraticCurveTo(rW/2, -rLen * 0.45, rW / 2, -rLen * 0.35);
  }
  
  ctx.lineTo( rW / 2, -rLen * 0.35);
  ctx.lineTo( rW / 2,  rLen * 0.35);
  ctx.closePath();
  ctx.fill();

  // Accent stripe
  ctx.fillStyle = "#ff6600";
  ctx.fillRect(-rW / 2 + 2, -rLen * 0.15, rW - 4, 8);

  // Fins
  ctx.fillStyle = "#3a4455";
  ctx.beginPath();
  ctx.moveTo(-rW / 2,           rLen * 0.35);
  ctx.lineTo(-rW / 2 - finSpan, rLen * 0.35 + 4);
  ctx.lineTo(-rW / 2,           rLen * 0.35 - finRoot);
  ctx.closePath(); ctx.fill();
  
  ctx.beginPath();
  ctx.moveTo( rW / 2,           rLen * 0.35);
  ctx.lineTo( rW / 2 + finSpan, rLen * 0.35 + 4);
  ctx.lineTo( rW / 2,           rLen * 0.35 - finRoot);
  ctx.closePath(); ctx.fill();

  // Canards (Active Stabilization)
  const canardSpan = finSpan * 0.8;
  const canardRoot = finRoot * 0.8;
  const canardY = -rLen * 0.15; // Placed near the nose
  const canardAngle = (rocket.userAngle * Math.PI) / 180;

  ctx.fillStyle = "#ff6600";
  // Left canard
  ctx.save();
  ctx.translate(-rW / 2, canardY);
  ctx.rotate(canardAngle);
  ctx.beginPath();
  ctx.moveTo(0, canardRoot / 2);
  ctx.lineTo(-canardSpan, 2);
  ctx.lineTo(0, -canardRoot / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Right canard
  ctx.save();
  ctx.translate(rW / 2, canardY);
  ctx.rotate(canardAngle);
  ctx.beginPath();
  ctx.moveTo(0, canardRoot / 2);
  ctx.lineTo(canardSpan, 2);
  ctx.lineTo(0, -canardRoot / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Window
  ctx.fillStyle = "#00d4ff";
  ctx.shadowColor = "#00d4ff";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(0, -rLen * 0.18, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Exhaust flame
  if (rocket.candy > 0) {
    const flicker = Math.random() * 8 + 18;
    const fg = ctx.createLinearGradient(0, rLen * 0.35, 0, rLen * 0.35 + flicker);
    fg.addColorStop(0,   "rgba(255,140,0,0.95)");
    fg.addColorStop(0.4, "rgba(255,60,0,0.7)");
    fg.addColorStop(1,   "rgba(255,30,0,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(-rW / 3, rLen * 0.35);
    ctx.quadraticCurveTo(-rW / 5, rLen * 0.35 + flicker * 0.6, 0, rLen * 0.35 + flicker);
    ctx.quadraticCurveTo( rW / 5, rLen * 0.35 + flicker * 0.6, rW / 3, rLen * 0.35);
    ctx.closePath();
    ctx.fill();

    spawnParticle(rx, ry + rLen * 0.35, ang);
  }
  ctx.restore();

  // ── Particles ────────────────────────────────────────────────────
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.life -= 0.035;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,120,30,${p.life * 0.5})`;
    ctx.fill();
  }
  
  // ── CFD Wind Particles ───────────────────────────────────────────
  if (rocket.cfd && rocket.cfd.ux) {
    const nx = 60, ny = 60; // Full grid size
    const gridPx = 360; // Visual size of the CFD grid around rocket (matches 60px/m * 6m)
    const startX = rx - gridPx/2;
    const startY = ry - gridPx/2;
    
    // Spawn new CFD particles
    for (let j = 0; j < 3; j++) {
      cfdParticles.push({
        x: startX + Math.random() * gridPx,
        y: rocket.isFalling ? startY + gridPx + 20 : startY - 20,
        life: 1.0 + Math.random() * 0.5,
        speedFactor: 25 + Math.random()*20, // Scale lattice velocity to pixel velocity
        size: 1.5 + Math.random()*2.5
      });
    }
    for (let i = cfdParticles.length - 1; i >= 0; i--) {
      const cp = cfdParticles[i];
      cp.life -= 0.01;
      
      // Map to grid coords
      const gx = Math.floor(((cp.x - startX) / gridPx) * nx);
      const gy = Math.floor(((cp.y - startY) / gridPx) * ny);
      
      let vx = rocket.windForce * 0.2; // base lateral wind
      let vy = rocket.isFalling ? -12 : 12; // base upward/downward drift
      
      // If inside CFD grid, use CFD velocity
      if (gx >= 0 && gx < nx && gy >= 0 && gy < ny) {
        const idx = gy * nx + gx;
        if (idx < rocket.cfd.ux.length) {
           vx = rocket.cfd.ux[idx] * cp.speedFactor;
           vy = rocket.cfd.uy[idx] * cp.speedFactor;
        }
      }
      
      cp.x += vx;
      cp.y += vy;
      
      if (cp.life <= 0 || (rocket.isFalling ? cp.y < startY - 50 : cp.y > startY + gridPx + 50)) {
        cfdParticles.splice(i, 1);
        continue;
      }
      
      const dist = Math.hypot(cp.x - rx, cp.y - ry);
      // Heatmap: H=0 is red, H=120 is green.
      // Closer than 40px is fully red. Further than 150px is fully green.
      let hue = ((dist - 40) / 110) * 120;
      hue = Math.max(0, Math.min(120, hue));
      
      ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${0.2 + 0.5 * cp.life})`;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, cp.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Drift trail ──────────────────────────────────────────────────
  ctx.strokeStyle = "rgba(255,102,0,0.15)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 6]);
  ctx.beginPath(); ctx.moveTo(rx, ry + rLen / 2 + 20); ctx.lineTo(rx, H);
  ctx.stroke();
  ctx.setLineDash([]);
  
  renderMinimap();
}

function renderMinimap() {
  const mCanvas = document.getElementById("minimap-canvas");
  if (!mCanvas) return;
  const mCtx = mCanvas.getContext("2d");
  const W = mCanvas.width, H = mCanvas.height;
  mCtx.clearRect(0, 0, W, H);
  
  mCtx.strokeStyle = "rgba(0, 212, 255, 0.2)";
  mCtx.beginPath();
  mCtx.moveTo(W/2, 0); mCtx.lineTo(W/2, H);
  mCtx.stroke();
  
  if (rocket.path.length === 0) return;
  
  const maxAlt = Math.max(50, rocket.altitude);
  const maxLat = 20;
  
  mCtx.strokeStyle = "#00ff88";
  mCtx.lineWidth = 2;
  mCtx.beginPath();
  for (let i = 0; i < rocket.path.length; i++) {
    const pt = rocket.path[i];
    const px = W/2 + (pt.x / maxLat) * (W/2);
    const py = H - (pt.y / maxAlt) * H;
    if (i === 0) mCtx.moveTo(px, py);
    else mCtx.lineTo(px, py);
  }
  mCtx.stroke();
  
  const last = rocket.path[rocket.path.length-1];
  const px = W/2 + (last.x / maxLat) * (W/2);
  const py = H - (last.y / maxAlt) * H;
  
  // Draw mini rocket at tip of minimap
  mCtx.save();
  mCtx.translate(px, py);
  mCtx.rotate(rocket.angle * Math.PI / 180);
  mCtx.fillStyle = "#ff6600";
  mCtx.beginPath();
  mCtx.moveTo(0, -6);
  mCtx.lineTo(4, 6);
  mCtx.lineTo(-4, 6);
  mCtx.closePath();
  mCtx.fill();
  mCtx.restore();
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
  cCtx.moveTo(-rW / 2,  rLen * 0.35);
  cCtx.lineTo(-rW / 2, -rLen * 0.35);
  cCtx.quadraticCurveTo(-rW/2, -rLen * 0.45, 0, -rLen / 2);
  cCtx.quadraticCurveTo(rW/2, -rLen * 0.45, rW / 2, -rLen * 0.35);
  cCtx.lineTo( rW / 2, -rLen * 0.35);
  cCtx.lineTo( rW / 2,  rLen * 0.35);
  cCtx.closePath();
  cCtx.fill();

  // Accent stripe
  cCtx.fillStyle = "#ff6600";
  cCtx.fillRect(-rW / 2 + 2, -rLen * 0.15, rW - 4, 8);

  // Fins
  cCtx.fillStyle = "#3a4455";
  cCtx.beginPath();
  cCtx.moveTo(-rW / 2,           rLen * 0.35);
  cCtx.lineTo(-rW / 2 - finSpan, rLen * 0.35 + 4);
  cCtx.lineTo(-rW / 2,           rLen * 0.35 - finRoot);
  cCtx.closePath(); cCtx.fill();
  
  cCtx.beginPath();
  cCtx.moveTo( rW / 2,           rLen * 0.35);
  cCtx.lineTo( rW / 2 + finSpan, rLen * 0.35 + 4);
  cCtx.lineTo( rW / 2,           rLen * 0.35 - finRoot);
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
  cCtx.arc(0, -rLen/2 + X_cp, d * 0.4, 0, Math.PI * 2);
  cCtx.fill();
  cCtx.stroke();
  cCtx.setLineDash([]);
  
  // Draw CP symbol cross
  cCtx.beginPath();
  cCtx.moveTo(-d*0.4, -rLen/2 + X_cp);
  cCtx.lineTo(d*0.4, -rLen/2 + X_cp);
  cCtx.moveTo(0, -rLen/2 + X_cp - d*0.4);
  cCtx.lineTo(0, -rLen/2 + X_cp + d*0.4);
  cCtx.stroke();

  cCtx.restore();
}

// ═══════════════════════════════════════════════════════════════════════
//  RESULTS
// ═══════════════════════════════════════════════════════════════════════
function showResults(data) {
  showScreen("results-screen");
  
  const $title = document.getElementById("results-title");
  if (data.crashed) {
    $title.textContent = "MISIÓN FALLIDA - DESINTEGRACIÓN";
    $title.style.color = "#ff4444";
    $title.style.textShadow = "0 0 20px rgba(255,0,0,0.6)";
  } else {
    $title.textContent = "MISIÓN COMPLETADA";
    $title.style.color = ""; // fallback to css
    $title.style.textShadow = "";
  }

  const s = data.stats;
  document.getElementById("stat-h-max").textContent = s.human_max_deviation.toFixed(1) + "°";
  document.getElementById("stat-h-avg").textContent = s.human_avg_deviation.toFixed(1) + "°";
  document.getElementById("stat-h-std").textContent = s.human_std.toFixed(2) + "°";
  document.getElementById("stat-p-max").textContent = s.pid_max_deviation.toFixed(2) + "°";
  document.getElementById("stat-p-avg").textContent = s.pid_avg_deviation.toFixed(2) + "°";
  document.getElementById("stat-p-std").textContent = s.pid_std.toFixed(3) + "°";
  document.getElementById("stat-reduction").textContent = s.reduction_percent.toFixed(2) + "%";

  drawTrajectory("human-traj-canvas", data.human_trajectory, "#ff6600", s.human_max_deviation);
  drawTrajectory("pid-traj-canvas",   data.pid_trajectory,   "#00ff88", Math.max(s.pid_max_deviation, 1));
  drawCombined(data);
}

function drawTrajectory(canvasId, traj, color, yMax) {
  const c  = document.getElementById(canvasId);
  const cx = c.getContext("2d");
  const W  = c.width, H = c.height;
  cx.clearRect(0, 0, W, H);
  if (!traj || traj.length < 2) return;

  const pad = 30, midY = H / 2;
  cx.strokeStyle = "rgba(200,220,255,0.12)"; cx.lineWidth = 1;
  cx.beginPath(); cx.moveTo(pad, pad); cx.lineTo(pad, H - pad); cx.lineTo(W - pad, H - pad); cx.stroke();
  cx.strokeStyle = "rgba(200,220,255,0.08)"; cx.setLineDash([4,4]);
  cx.beginPath(); cx.moveTo(pad, midY); cx.lineTo(W - pad, midY); cx.stroke(); cx.setLineDash([]);

  const maxT = traj[traj.length - 1].time;
  const effMax = Math.max(yMax, 2) * 1.2;
  cx.strokeStyle = color; cx.lineWidth = 2; cx.shadowColor = color; cx.shadowBlur = 4;
  cx.beginPath();
  for (let i = 0; i < traj.length; i++) {
    const px = pad + (traj[i].time / maxT) * (W - 2 * pad);
    const py = midY - (traj[i].dev / effMax) * (H / 2 - pad);
    if (i === 0) cx.moveTo(px, py); else cx.lineTo(px, py);
  }
  cx.stroke(); cx.shadowBlur = 0;

  cx.fillStyle = "rgba(200,220,255,0.4)"; cx.font = "9px 'JetBrains Mono', monospace";
  cx.fillText("0s", pad, H - pad + 12);
  cx.fillText(maxT.toFixed(0) + "s", W - pad - 14, H - pad + 12);
  cx.fillText("0°", pad - 18, midY + 3);
}

function drawCombined(data) {
  const c  = document.getElementById("combined-canvas");
  const cx = c.getContext("2d");
  const W  = c.width, H = c.height;
  cx.clearRect(0, 0, W, H);

  const pad = 35, midY = H / 2;
  const hT = data.human_trajectory || [], pT = data.pid_trajectory || [];
  if (hT.length < 2) return;

  const maxT = Math.max(hT[hT.length-1].time, pT.length ? pT[pT.length-1].time : 0);
  const all  = [...hT.map(p=>Math.abs(p.dev)), ...pT.map(p=>Math.abs(p.dev))];
  const yM   = Math.max(...all, 2) * 1.15;

  cx.strokeStyle = "rgba(200,220,255,0.08)"; cx.lineWidth = 1;
  cx.beginPath(); cx.moveTo(pad,pad); cx.lineTo(pad,H-pad); cx.lineTo(W-pad,H-pad); cx.stroke();
  cx.setLineDash([4,4]);
  cx.beginPath(); cx.moveTo(pad,midY); cx.lineTo(W-pad,midY); cx.stroke(); cx.setLineDash([]);

  function plot(traj, col, lw) {
    cx.strokeStyle = col; cx.lineWidth = lw; cx.shadowColor = col; cx.shadowBlur = 3;
    cx.beginPath();
    for (let i = 0; i < traj.length; i++) {
      const px = pad + (traj[i].time / maxT) * (W - 2*pad);
      const py = midY - (traj[i].dev / yM) * (H/2 - pad);
      if (i === 0) cx.moveTo(px,py); else cx.lineTo(px,py);
    }
    cx.stroke(); cx.shadowBlur = 0;
  }
  plot(hT, "#ff6600", 2);
  plot(pT, "#00ff88", 2);

  cx.fillStyle = "rgba(200,220,255,0.35)"; cx.font = "10px 'JetBrains Mono', monospace";
  cx.fillText("0s", pad, H-pad+14);
  cx.fillText(maxT.toFixed(0)+"s", W-pad-16, H-pad+14);
  cx.fillText("0°", pad-22, midY+4);
  cx.fillText("+"+yM.toFixed(0)+"°", pad-28, pad+4);
  cx.fillText("-"+yM.toFixed(0)+"°", pad-28, H-pad+2);
}

// ═══════════════════════════════════════════════════════════════════════
//  COUNTDOWN
// ═══════════════════════════════════════════════════════════════════════
function runCountdown() {
  gameState = "countdown";
  showScreen("countdown-overlay");
  const $n = document.getElementById("countdown-number");
  let n = 3;
  $n.textContent = n;
  
  const configPayload = {
    mass: confInputs.mass.value,
    height: confInputs.height.value,
    width: confInputs.width.value,
    candy: confInputs.candy.value,
    max_angle: confInputs.angle.value,
    lat: parseFloat(document.getElementById('conf-lat').value),
    lon: parseFloat(document.getElementById('conf-lon').value),
    date: confInputs.date.value,
    time: confInputs.time.value,
    crash_angle: confInputs.crash.value,
    crash_enabled: document.getElementById('conf-crash-enabled').checked,
    inertia_mult: confInputs.inertiaMult.value,
    damping: confInputs.damping.value,
    naca_profile: confInputs.naca.value,
    ork_file: orkFileData,
    input_mode: document.getElementById('input-mode-select') ? document.getElementById('input-mode-select').value : 'camera'
  };
  initialCandy = parseFloat(confInputs.candy.value) || 10.0;
  currentCrashAngle = parseFloat(confInputs.crash.value);
  currentCrashEnabled = document.getElementById('conf-crash-enabled').checked;

  const iv = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(iv);
      wsSend({ action: "start", config: configPayload });
    } else {
      $n.textContent = n;
      $n.style.animation = "none";
      void $n.offsetHeight;
      $n.style.animation = "";
    }
  }, 900);
}

// ═══════════════════════════════════════════════════════════════════════
//  GAME LOOP (≈ 60 FPS)
// ═══════════════════════════════════════════════════════════════════════
function loop() {
  if (gameState === "playing") {
    pollKeyboard();
    // Always send keyboard_angle; backend decides which source to use
    wsSend({ action: "update", keyboard_angle: keyboardAngle });
    renderGame();
  } else if (gameState === "replay") {
    if (replayData && replayIndex < replayData.pid_trajectory.length) {
      replayFrameCounter++;
      // Since PID trajectory is at 20Hz and loop is 60Hz, step every 3 frames
      if (replayFrameCounter % 3 === 0) {
        const point = replayData.pid_trajectory[replayIndex];
        rocket.angle = point.angle;
        rocket.altitude = point.altitude;
        rocket.lateralPos = point.lateral_pos;
        rocket.userAngle = point.user_angle || 0;
        rocket.candy = point.candy !== undefined ? point.candy : rocket.candy;
        rocket.time = point.time;
        // HUD is updated inside loop directly
        updateHUD();
        renderGame();
        replayIndex++;
      }
    } else {
      gameState = "results";
      const banner = document.getElementById("warning-banner");
      if (banner) banner.className = "warning-banner hidden";
      const label = document.getElementById("hud-user-label");
      if (label) label.textContent = "INCLINACIÓN USUARIO (CANARDS)";
      showResults(replayData);
    }
  }
  requestAnimationFrame(loop);
}

// ═══════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════
function init() {
  resizeCanvas();
  connectWS();

  if ($btnConfig) {
    $btnConfig.addEventListener("click", () => {
      showScreen("config-screen");
      renderConfigRocket();
      // Initialize map if not already done
      if (!map) {
        setTimeout(() => {
          map = L.map('map').setView([25.6866, -100.3161], 10);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
          }).addTo(map);
          
          mapMarker = L.marker([25.6866, -100.3161], {draggable: true}).addTo(map);
          mapMarker.on('dragend', function(event) {
            const pos = event.target.getLatLng();
            document.getElementById('conf-lat').value = pos.lat.toFixed(4);
            document.getElementById('conf-lon').value = pos.lng.toFixed(4);
          });
          map.on('click', function(e) {
            mapMarker.setLatLng(e.latlng);
            document.getElementById('conf-lat').value = e.latlng.lat.toFixed(4);
            document.getElementById('conf-lon').value = e.latlng.lng.toFixed(4);
          });
        }, 200);
      }
    });
  }
  
  if ($btnSaveConfig) {
    $btnSaveConfig.addEventListener("click", () => {
      showScreen("splash-screen");
    });
  }

  const $crashEnabled = document.getElementById('conf-crash-enabled');
  if ($crashEnabled) {
    $crashEnabled.addEventListener('change', (e) => {
      confInputs.crash.disabled = !e.target.checked;
      document.getElementById('conf-crash-label').style.opacity = e.target.checked ? '1' : '0.5';
    });
  }

  $btnStart.addEventListener("click", () => {
    $btnStart.disabled = true;
    runCountdown();
  });

  function togglePause() {
    if (gameState === "playing") {
      gameState = "paused";
      $btnPause.textContent = "▶ REANUDAR (Espacio)";
      $btnPause.classList.add("paused");
    } else if (gameState === "paused") {
      gameState = "playing";
      $btnPause.textContent = "⏸ PAUSA (Espacio)";
      $btnPause.classList.remove("paused");
    }
  }

  if ($btnPause) {
    $btnPause.addEventListener("click", () => {
      togglePause();
      // To prevent spacebar from triggering the button again if focused
      $btnPause.blur();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && (gameState === "playing" || gameState === "paused")) {
      e.preventDefault();
      togglePause();
    }
  });

  function resetGame() {
    showScreen("splash-screen");
    gameState = "splash";
    keyboardAngle = 0;
    Object.assign(rocket, {
      angle: 0, angularVelocity: 0, altitude: 0,
      lateralPos: 0, windForce: 0, windSpeedKmh: 0,
      userAngle: 0, time: 0, candy: 0, accDev: 0, path: []
    });
    particles.length = 0;
    cfdParticles.length = 0;
    $btnStart.disabled = false;
  }

  $btnRestart.addEventListener("click", resetGame);
  const $btnRestartGame = document.getElementById("btn-restart-game");
  if ($btnRestartGame) {
    $btnRestartGame.addEventListener("click", resetGame);
  }

  requestAnimationFrame(loop);
}

window.addEventListener("DOMContentLoaded", init);
