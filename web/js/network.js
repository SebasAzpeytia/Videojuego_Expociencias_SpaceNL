// --- WEBSOCKET ---

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
      rocket.targetX = d.target_x || 0;
      if (typeof rocketGroup !== 'undefined' && rocketGroup) rocketGroup.visible = true;
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
      if (gameState !== "replay-intro") {
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
          mass: d.mass,
          velocity: d.velocity
        });
        if (d.cfd) {
          rocket.cfd = d.cfd;
          console.log("[CFD] Received grid:", d.cfd.ux.length, "cells, sample ux[0]:", d.cfd.ux[0], "uy[0]:", d.cfd.uy[0]);
        }
        rocket.accDev += Math.abs(d.angle) * (1 / 60);
        rocket.path.push({ x: d.lateral_pos, y: d.altitude });
      }
      if (d.camera_active !== undefined) cameraActive = d.camera_active;
      // Update PiP if a frame was included
      if (d.frame) {
        $camFrame.src = "data:image/jpeg;base64," + d.frame;
        $camFrame.style.display = "block";
        $pipPlace.style.display = "none";
      }
      if (gameState !== "replay-intro") {
        updateHUD();
      }
    }

    else if (d.action === "pid_intro") {
      gameState = "replay-intro";
      rocket.path = []; // Reset minimap trace

      const overlay = document.getElementById("replay-overlay");
      const landingOverlay = document.getElementById("landing-overlay");

      const hLast = d.human_trajectory && d.human_trajectory.length > 0 ? d.human_trajectory[d.human_trajectory.length - 1].lateral_pos : 0;
      const targetX = d.target_x || 0;
      const dist = Math.abs(hLast - targetX);
      
      let hue = Math.max(0, 120 - (dist / 40) * 120);
      let distColor = `hsl(${hue}, 100%, 50%)`;
      
      let msg = "";
      let color = distColor;
      let subtitle = `Aterrizaste a ${dist.toFixed(1)} metros del objetivo`;

      if (dist <= 5) {
        msg = "¡ATERRIZAJE PERFECTO!";
        subtitle = `¡En el blanco! A solo ${dist.toFixed(1)} metros.`;
      } else if (dist <= 25) {
        msg = "¡BUEN INTENTO!";
        subtitle = `Llegaste a ${dist.toFixed(1)} metros del centro.`;
      } else {
        msg = "MISIÓN FALLIDA";
        subtitle = `Demasiado lejos. Te faltaron ${dist.toFixed(1)} metros.`;
      }

      if (d.crashed) {
        msg += " (CHOQUE)";
        subtitle += " ¡Pero la nave se destruyó al impactar!";
        if (typeof createExplosion === 'function') {
          createExplosion(0, 0, 0);
          if (typeof rocketGroup !== 'undefined' && rocketGroup) rocketGroup.visible = false;
        }
      }

      const startPID = () => {
        const gs = document.getElementById("game-screen");
        if (gs) gs.classList.add("pid-filter");
        
        if (overlay) overlay.classList.add("hidden");
        gameState = "playing_pid";
        
        // Reset rocket visually
        rocket.angle = 0;
        rocket.altitude = 0;
        rocket.lateralPos = 0;
        if (typeof rocketGroup !== 'undefined' && rocketGroup) rocketGroup.visible = true;

        if ($btnSkip) $btnSkip.style.display = "inline-block";
        const banner = document.getElementById("warning-banner");
        if (banner) {
          banner.textContent = "SIMULACIÓN - SISTEMA PID";
          banner.className = "warning-banner replay-banner";
        }
        const label = document.getElementById("hud-user-label");
        if (label) label.textContent = "INCLINACIÓN PID (CANARDS)";
      };

      if (landingOverlay) {
        const tTitle = document.getElementById("landing-title");
        const tSub = document.getElementById("landing-subtitle");
        if (tTitle) {
          tTitle.textContent = msg;
          tTitle.style.color = color;
          tTitle.style.textShadow = `0 0 30px ${color}`;
        }
        if (tSub) {
          tSub.textContent = subtitle;
          tSub.style.color = (color === "#ffcc00") ? "#ffffff" : color;
        }

        landingOverlayTimeout = setTimeout(() => {
          landingOverlay.classList.remove("hidden");
          landingOverlayTimeout = setTimeout(() => {
            landingOverlay.classList.add("hidden");
            if (overlay) overlay.classList.remove("hidden");
            pidStartTimeout = setTimeout(startPID, 2500);
          }, 2500);
        }, 1200);
      } else {
        if (overlay) overlay.classList.remove("hidden");
        pidStartTimeout = setTimeout(startPID, 2500);
      }
    }

    else if (d.action === "game_over") {
      if (d.crashed) {
        if (typeof createExplosion === 'function') {
          createExplosion(0, 0, 0);
          if (typeof rocketGroup !== 'undefined' && rocketGroup) rocketGroup.visible = false;
        }
        setTimeout(() => {
          gameState = "results";
          showResults(d);
        }, 1500);
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

    else if (d.action === "default_ork_loaded") {
      orkFileData = d.ork_file;
      const geo = d.ork_geo;
      if (geo && geo.mass > 0) confInputs.mass.value = geo.mass.toFixed(1);
      if (geo && geo.length > 0) confInputs.height.value = geo.length.toFixed(2);
      if (geo && geo.radius > 0) confInputs.width.value = (geo.radius * 2).toFixed(2);
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
