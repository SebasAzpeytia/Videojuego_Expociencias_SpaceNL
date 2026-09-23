"""
Camera Processor — Captures webcam via OpenCV, runs MediaPipe Pose in a
daemon thread, and exposes the shoulder-tilt angle + annotated JPEG frame.
"""

import math
import threading
import base64
import time

import cv2
import mediapipe as mp


class CameraProcessor:
    """Thread-safe camera + pose detector.

    Properties (thread-safe reads):
        user_angle  – shoulder tilt in degrees (amplified ×3, clamped ±30)
        active      – True once pose landmarks are being detected
    """

    _CAP_W = 320
    _CAP_H = 240
    _JPEG_Q = 45          # JPEG quality for the PiP base64 frame
    _PIP_EVERY = 3        # encode a frame every N captures  (→ ~10 FPS)

    def __init__(self):
        self._mp_pose_mod = mp.solutions.pose
        self._pose = self._mp_pose_mod.Pose(
            model_complexity=1,
            smooth_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._mp_draw = mp.solutions.drawing_utils

        self._cap: cv2.VideoCapture | None = None
        self._lock = threading.Lock()
        self._running = False

        # Public state (guarded by _lock)
        self.user_angle: float = 0.0
        self.frame_b64: str | None = None
        self.active: bool = False

    # ── lifecycle ────────────────────────────────────────────────────
    def start(self) -> bool:
        """Open the default webcam and launch the processing thread."""
        with self._lock:
            if self._running:
                return True

        try:
            cap = cv2.VideoCapture(0)
            if not cap.isOpened():
                return False
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._CAP_W)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._CAP_H)
            cap.set(cv2.CAP_PROP_FPS, 30)
            
            self._cap = cap
            self._running = True
            threading.Thread(target=self._loop, daemon=True).start()
            return True
        except Exception:
            return False

    def stop(self):
        self._running = False
        # We don't release self._cap here to avoid thread-crash with OpenCV.
        # It is released safely at the end of _loop().

    # ── main loop (runs in daemon thread) ────────────────────────────
    def _loop(self):
        if self._cap is None:
            return
            
        n = 0
        while self._running:
            ok, frame = self._cap.read()
            if not ok:
                time.sleep(0.01)
                continue

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb.flags.writeable = False
            results = self._pose.process(rgb)

            angle = 0.0
            pose_landmarks = getattr(results, 'pose_landmarks', None)
            is_active = False

            if pose_landmarks:
                is_active = True
                lms = pose_landmarks.landmark
                lsh, rsh = lms[11], lms[12]          # left / right shoulder
                dy = rsh.y - lsh.y
                dx = rsh.x - lsh.x
                raw = math.atan2(dy, dx) * (180.0 / math.pi)
                # Normalize so that horizontal shoulders give 0 degrees
                if raw > 90:
                    raw -= 180
                elif raw < -90:
                    raw += 180
                
                # raw is now ~0 when standing upright.
                # If raw is positive, right shoulder is lower (tilting right)
                angle = max(-30.0, min(30.0, raw * 3.0))

                # Draw skeleton on the BGR frame for PiP
                self._mp_draw.draw_landmarks(
                    frame,
                    pose_landmarks,
                    list(self._mp_pose_mod.POSE_CONNECTIONS),
                    landmark_drawing_spec=self._mp_draw.DrawingSpec(
                        color=(0, 255, 136), thickness=1, circle_radius=2,
                    ),
                    connection_drawing_spec=self._mp_draw.DrawingSpec(
                        color=(255, 102, 0), thickness=2,
                    ),
                )

            with self._lock:
                self.user_angle = angle
                self.active = is_active

            # Encode annotated frame every N captures → ~10 FPS PiP
            n += 1
            if n % self._PIP_EVERY == 0:
                flipped = cv2.flip(frame, 1)            # mirror for natural feedback
                _, buf = cv2.imencode(
                    ".jpg", flipped,
                    [cv2.IMWRITE_JPEG_QUALITY, self._JPEG_Q],
                )
                with self._lock:
                    self.frame_b64 = base64.b64encode(buf.tobytes()).decode("ascii")

        # Safely release the camera when the loop terminates
        if self._cap:
            self._cap.release()
            self._cap = None

    # ── thread-safe accessors ────────────────────────────────────────
    def get_angle(self) -> float:
        with self._lock:
            return self.user_angle

    def consume_frame(self) -> str | None:
        """Return and clear the latest base64 JPEG (or None)."""
        with self._lock:
            b64 = self.frame_b64
            self.frame_b64 = None
            return b64
