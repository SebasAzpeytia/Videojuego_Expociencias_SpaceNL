// --- SCREEN MANAGEMENT ---

function showScreen(id) {
  [$splash, $configScreen, $countdown, $game, $results].forEach(s => s && s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// GLB File Drag and Drop globals
const dropZone = document.getElementById('drop-zone');
const glbInput = document.getElementById('conf-glb');
const fileNameDisplay = document.getElementById('file-name');

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, preventDefaults, false);
});
function preventDefaults(e) {
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
glbInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

function handleDrop(e) {
  let dt = e.dataTransfer;
  let files = dt.files;
  if (files.length) handleFile(files[0]);
}

function handleFile(file) {
  if (file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf')) {
    fileNameDisplay.textContent = file.name;
    const reader = new FileReader();
    reader.onload = function (e) {
      customModelDataURL = e.target.result;
      renderConfigRocket(); // Update the previewer
      if (typeof updateMainRocketModel === 'function') updateMainRocketModel(); // Update main scene
    };
    reader.readAsDataURL(file);
  } else {
    fileNameDisplay.textContent = 'Formato inválido (solo .glb o .gltf)';
    customModelDataURL = null;
    renderConfigRocket();
    if (typeof updateMainRocketModel === 'function') updateMainRocketModel();
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

// --- HUD UPDATE ---

function updateHUD() {
  const dev = Math.abs(rocket.angle);
  const $dev = document.getElementById("hud-deviation");
  $dev.textContent = rocket.angle.toFixed(1) + "°";
  $dev.className = "hud-value " + (dev < 5 ? "green" : dev < 15 ? "yellow" : "red");

  document.getElementById("hud-user-angle").textContent = rocket.userAngle.toFixed(1) + "°";

  const $accDev = document.getElementById("hud-acc-dev");
  if ($accDev) $accDev.textContent = rocket.accDev.toFixed(1) + "°s";

  document.getElementById("hud-wind").textContent = rocket.windForce.toFixed(1) + " N";
  document.getElementById("hud-altitude").textContent = Math.round(rocket.altitude) + " m";
  document.getElementById("hud-angvel").textContent = rocket.angularVelocity.toFixed(1) + " °/s";
  document.getElementById("hud-windspeed").textContent = rocket.windSpeedKmh.toFixed(1);
  const massHUD = document.getElementById("hud-mass");
  if (massHUD) massHUD.textContent = (rocket.mass || 0).toFixed(1) + " kg";

  // Candy Gauge
  const $candyVal = document.getElementById("hud-candy-val");
  if ($candyVal) $candyVal.textContent = Math.max(0, rocket.candy).toFixed(1) + " kg";

  const $candyBar = document.getElementById("candy-bar");
  const $hudCandyVal = document.getElementById("hud-candy-val");
  if ($candyBar) {
    const p = Math.max(0, Math.min(100, (rocket.candy / initialCandy) * 100));
    $candyBar.style.width = p + "%";
    if (p < 20) $candyBar.style.backgroundColor = "var(--red)";
    else if (p < 50) $candyBar.style.backgroundColor = "var(--yellow)";
    else $candyBar.style.backgroundColor = "var(--green)";
  }

  // Target Indicator
  const targetIndicator = document.getElementById("target-indicator");
  if (targetIndicator && rocket.targetX !== undefined) {
    const dist = rocket.targetX - rocket.lateralPos;
    if (Math.abs(dist) > 5) {
      targetIndicator.classList.remove("hidden");
      if (dist > 0) {
        targetIndicator.innerText = "OBJETIVO A " + Math.abs(dist).toFixed(0) + "m ➔";
      } else {
        targetIndicator.innerText = "⬅ OBJETIVO A " + Math.abs(dist).toFixed(0) + "m";
      }
    } else {
      targetIndicator.classList.remove("hidden");
      targetIndicator.innerText = "🎯 ¡SOBRE EL OBJETIVO! 🎯";
    }
  }
}

// --- CANVAS RENDERING ---


// --- RESULTS ---

function showResults(data) {
  showScreen("results-screen");
  const gs = document.getElementById("game-screen");
  if (gs) gs.classList.remove("pid-filter");

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

  const target = rocket.targetX || 0;

  const hLast = data.human_trajectory && data.human_trajectory.length > 0 ? data.human_trajectory[data.human_trajectory.length - 1].lateral_pos : 0;
  const hDist = Math.abs(hLast - target);
  const elHDist = document.getElementById("h-dist");
  if (elHDist) elHDist.textContent = hDist.toFixed(1) + " m";

  const pLast = data.pid_trajectory && data.pid_trajectory.length > 0 ? data.pid_trajectory[data.pid_trajectory.length - 1].lateral_pos : 0;
  const pDist = Math.abs(pLast - target);
  const elPDist = document.getElementById("p-dist");
  if (elPDist) elPDist.textContent = pDist.toFixed(1) + " m";
  drawTrajectory("human-traj-canvas", data.human_trajectory, "#ff6600", s.human_max_deviation);
  drawTrajectory("pid-traj-canvas", data.pid_trajectory, "#00ff88", Math.max(s.pid_max_deviation, 1));
  drawCombined(data);
}

function drawTrajectory(canvasId, traj, color, yMax) {
  const c = document.getElementById(canvasId);
  const cx = c.getContext("2d");
  const W = c.width, H = c.height;
  cx.clearRect(0, 0, W, H);
  if (!traj || traj.length < 2) return;

  const pad = 30, midY = H / 2;
  cx.strokeStyle = "rgba(200,220,255,0.12)"; cx.lineWidth = 1;
  cx.beginPath(); cx.moveTo(pad, pad); cx.lineTo(pad, H - pad); cx.lineTo(W - pad, H - pad); cx.stroke();
  cx.strokeStyle = "rgba(200,220,255,0.08)"; cx.setLineDash([4, 4]);
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
  const c = document.getElementById("combined-canvas");
  const cx = c.getContext("2d");
  const W = c.width, H = c.height;
  cx.clearRect(0, 0, W, H);

  const pad = 35, midY = H / 2;
  const hT = data.human_trajectory || [], pT = data.pid_trajectory || [];
  if (hT.length < 2) return;

  const maxT = Math.max(hT[hT.length - 1].time, pT.length ? pT[pT.length - 1].time : 0);
  const all = [...hT.map(p => Math.abs(p.dev)), ...pT.map(p => Math.abs(p.dev))];
  const yM = Math.max(...all, 2) * 1.15;

  cx.strokeStyle = "rgba(200,220,255,0.08)"; cx.lineWidth = 1;
  cx.beginPath(); cx.moveTo(pad, pad); cx.lineTo(pad, H - pad); cx.lineTo(W - pad, H - pad); cx.stroke();
  cx.setLineDash([4, 4]);
  cx.beginPath(); cx.moveTo(pad, midY); cx.lineTo(W - pad, midY); cx.stroke(); cx.setLineDash([]);

  function plot(traj, col, lw) {
    cx.strokeStyle = col; cx.lineWidth = lw; cx.shadowColor = col; cx.shadowBlur = 3;
    cx.beginPath();
    for (let i = 0; i < traj.length; i++) {
      const px = pad + (traj[i].time / maxT) * (W - 2 * pad);
      const py = midY - (traj[i].dev / yM) * (H / 2 - pad);
      if (i === 0) cx.moveTo(px, py); else cx.lineTo(px, py);
    }
    cx.stroke(); cx.shadowBlur = 0;
  }
  plot(hT, "#ff6600", 2);
  plot(pT, "#00ff88", 2);

  cx.fillStyle = "rgba(200,220,255,0.35)"; cx.font = "10px 'JetBrains Mono', monospace";
  cx.fillText("0s", pad, H - pad + 14);
  cx.fillText(maxT.toFixed(0) + "s", W - pad - 16, H - pad + 14);
  cx.fillText("0°", pad - 22, midY + 4);
  cx.fillText("+" + yM.toFixed(0) + "°", pad - 28, pad + 4);
  cx.fillText("-" + yM.toFixed(0) + "°", pad - 28, H - pad + 2);
}

// --- COUNTDOWN ---

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
    crash_angle: 45.0,
    crash_enabled: true,
    inertia_mult: confInputs.inertiaMult.value,
    damping: confInputs.damping.value,
    naca_profile: confInputs.naca.value,
    ork_file: orkFileData,
    input_mode: document.getElementById('input-mode-select') ? document.getElementById('input-mode-select').value : 'camera',
    target_min: document.getElementById('conf-target-min').value,
    target_max: document.getElementById('conf-target-max').value
  };
  initialCandy = parseFloat(confInputs.candy.value) || 0.25;
  currentCrashAngle = 45.0;
  currentCrashEnabled = true;

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

// --- GAME LOOP (≈ 60 FPS) ---

function loop() {
  cfdDashOffset -= 1.5; // Animate CFD dashed lines backwards to simulate flow

  if (gameState === "playing" || gameState === "playing_pid") {
    pollKeyboard();
    // Always send keyboard_angle; backend decides which source to use
    wsSend({ action: "update", keyboard_angle: keyboardAngle });
    renderGame();
  } else if (gameState === "replay-intro" || gameState === "paused" || gameState === "paused_pid") {
    // Keep rendering the scene (CFD + rocket) during intro/pause overlays
    renderGame();
  }
  requestAnimationFrame(loop);
}

function skipReplay() {
  if (landingOverlayTimeout) clearTimeout(landingOverlayTimeout);
  if (pidStartTimeout) clearTimeout(pidStartTimeout);
  
  if (gameState === "playing_pid" || gameState === "paused_pid" || gameState === "replay-intro") {
    const overlay = document.getElementById("replay-overlay");
    const landingOverlay = document.getElementById("landing-overlay");
    if (overlay) overlay.classList.add("hidden");
    if (landingOverlay) landingOverlay.classList.add("hidden");
    
    if ($btnSkip) $btnSkip.style.display = "none";
    
    wsSend({ action: "skip_pid" });
  }
}

// --- INIT ---

function init() {
  initThreeJS();
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

          mapMarker = L.marker([25.6866, -100.3161], { draggable: true }).addTo(map);
          mapMarker.on('dragend', function (event) {
            const pos = event.target.getLatLng();
            document.getElementById('conf-lat').value = pos.lat.toFixed(4);
            document.getElementById('conf-lon').value = pos.lng.toFixed(4);
          });
          map.on('click', function (e) {
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
      updateMainRocketModel();
      showScreen("splash-screen");
    });
  }


  $btnStart.addEventListener("click", () => {
    $btnStart.disabled = true;
    if (typeof audioListener !== 'undefined' && audioListener.context.state === 'suspended') {
      audioListener.context.resume();
    }
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
    } else if (gameState === "playing_pid") {
      gameState = "paused_pid";
      $btnPause.textContent = "▶ REANUDAR (Espacio)";
      $btnPause.classList.add("paused");
    } else if (gameState === "paused_pid") {
      gameState = "playing_pid";
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

  if ($btnSkip) {
    $btnSkip.addEventListener("click", () => {
      skipReplay();
      $btnSkip.blur();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && ["playing", "paused", "playing_pid", "paused_pid"].includes(gameState)) {
      e.preventDefault();
      togglePause();
    }
    if (e.code === "KeyS" && (gameState === "playing_pid" || gameState === "paused_pid" || gameState === "replay-intro")) {
      e.preventDefault();
      skipReplay();
    }
  });

  function resetGame() {
    if (typeof thrustSound !== 'undefined' && thrustSound) {
      if (thrustSound.isPlaying) thrustSound.stop();
      thrustSound.hasPlayed = false;
    }
    if (landingOverlayTimeout) clearTimeout(landingOverlayTimeout);
    if (pidStartTimeout) clearTimeout(pidStartTimeout);
    
    showScreen("splash-screen");
    const gs = document.getElementById("game-screen");
    if (gs) gs.classList.remove("pid-filter");

    const overlay = document.getElementById("replay-overlay");
    const landingOverlay = document.getElementById("landing-overlay");
    if (overlay) overlay.classList.add("hidden");
    if (landingOverlay) landingOverlay.classList.add("hidden");

    gameState = "splash";
    if ($btnSkip) $btnSkip.style.display = "none";
    if ($btnPause) {
      $btnPause.textContent = "⏸ PAUSA (Espacio)";
      $btnPause.classList.remove("paused");
    }
    keyboardAngle = 0;
    Object.assign(rocket, {
      angle: 0, angularVelocity: 0, altitude: 0,
      lateralPos: 0, windForce: 0, windSpeedKmh: 0,
      userAngle: 0, time: 0, candy: 0, velocity: 0, accDev: 0, path: []
    });
    particles.length = 0;
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
