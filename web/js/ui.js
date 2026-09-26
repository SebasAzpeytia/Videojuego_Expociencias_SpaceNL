// --- CAMERA STATUS ---

function setCameraStatus(state, text) {
  const dot = document.querySelector(".status-dot");
  dot.className = "status-dot " + state;
  document.getElementById("status-text").textContent = text;
}

// --- KEYBOARD FALLBACK ---

document.addEventListener("keydown", e => { keysDown[e.key] = true; });
document.addEventListener("keyup", e => { keysDown[e.key] = false; });

function pollKeyboard() {
  const speed = 2.0; // Faster speed for noticeable control
  if (keysDown["ArrowLeft"] || keysDown["a"]) keyboardAngle = Math.max(-45, keyboardAngle - speed);
  else if (keysDown["ArrowRight"] || keysDown["d"]) keyboardAngle = Math.min(45, keyboardAngle + speed);
  else keyboardAngle *= 0.85; // Faster decay to return to center
}
