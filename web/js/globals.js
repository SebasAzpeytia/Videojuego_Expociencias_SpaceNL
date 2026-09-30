/* ═══════════════════════════════════════════════════════════════════════
   Weathercocking Simulator — Frontend Application
   Canvas rendering · WebSocket IPC · Game loop
   All vision (camera + MediaPipe) runs in the Python backend.
   ═══════════════════════════════════════════════════════════════════════ */

"use strict";

// ── Configuration ──────────────────────────────────────────────────────
const WS_URL = "ws://127.0.0.1:8766";
const GAME_DURATION = 15.0;
const STAR_COUNT = 200;
const PARTICLE_MAX = 40;

// ── Global state ───────────────────────────────────────────────────────
let ws = null;
let socket = null;
let gameState = "splash";          // splash | countdown | playing | results
let keyboardAngle = 0;                 // degrees (keyboard fallback)
let cameraActive = false;             // set by backend's "camera_active" flag
let keysDown = {};
let mode = "PID";
let stars = Array.from({ length: STAR_COUNT }, () => ({
  x: Math.random(), y: Math.random(),
  r: Math.random() * 1.4 + 0.3,
  speed: Math.random() * 0.4 + 0.1,
  brightness: Math.random() * 0.6 + 0.4,
}));
let particles = [];
let cfdDashOffset = 0;
let landingOverlayTimeout = null;
let pidStartTimeout = null;
let currentRocketData = null;
let customModelDataURL = null;
let map = null;
let mapMarker = null;
let replayData = null;
let replayIndex = 0;
let replayFrameCounter = 0;
let currentCrashAngle = 45.0;
let currentCrashEnabled = true;

const rocket = {
  angle: 0, angularVelocity: 0,
  altitude: 0, lateralPos: 0,
  windForce: 0, windSpeedKmh: 0,
  userAngle: 0, time: 0,
  candy: 0, accDev: 0, mass: 0,
  cfd: null,
  path: []
};

// ── DOM refs ───────────────────────────────────────────────────────────
const $splash = document.getElementById("splash-screen");
const $countdown = document.getElementById("countdown-overlay");
const $game = document.getElementById("game-screen");
const $results = document.getElementById("results-screen");
const $canvas = document.getElementById("rocket-canvas");
// Three.js globals
let scene, camera, renderer, rocketGroup, cfdParticleSystem, groundMesh, starsGroup;
let minimapScene, minimapCamera, minimapRenderer, minimapRocket;
let confScene, confCamera, confRenderer, confRocketGroup;
let canards = [];
const $camFrame = document.getElementById("camera-frame");
const $pipPlace = document.getElementById("pip-placeholder");
const $btnStart = document.getElementById("btn-start");
const $btnRestart = document.getElementById("btn-restart");
const $btnConfig = document.getElementById("btn-config");
const $configScreen = document.getElementById("config-screen");
const $btnSaveConfig = document.getElementById("btn-save-config");
const $btnPause = document.getElementById("btn-pause");
const $btnSkip = document.getElementById("btn-skip");
const $warningBanner = document.getElementById("warning-banner");

const confInputs = {
  mass: document.getElementById("conf-mass"),
  height: document.getElementById("conf-height"),
  width: document.getElementById("conf-width"),
  candy: document.getElementById("conf-candy"),
  angle: document.getElementById("conf-angle"),

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
