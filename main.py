"""
Weathercocking Simulator — Desktop Application Entry-Point
Starts camera processor, HTTP + WebSocket servers, then opens a
pywebview window (or falls back to the default browser).
"""

import sys
import os
import json
import threading
import asyncio
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.request
import urllib.parse
from datetime import datetime
import base64
import zipfile
import io
import xml.etree.ElementTree as ET
import math
import typing

import websockets

try:
    import webview
    _HAS_WEBVIEW = True
except ImportError:
    _HAS_WEBVIEW = False
    import webbrowser

# pyrefly: ignore [missing-import]
from physics_engine import RocketSimulator
from camera_processor import CameraProcessor

# ── configuration ───────────────────────────────────────────────────────
WS_PORT       = 8766
WEB_DIR       = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
GAME_DURATION = 15.0

# ── shared instances ────────────────────────────────────────────────────
_cam = CameraProcessor()


# ═══════════════════════════════════════════════════════════════════════
#  HTTP — static-file server for /web
# ═══════════════════════════════════════════════════════════════════════
class _StaticHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_DIR, **kw)

    def log_message(self, format: str, *args: typing.Any) -> None:
        pass

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

# ═══════════════════════════════════════════════════════════════════════
#  WebSocket — IPC: physics engine + camera angle + PiP frames
# ═══════════════════════════════════════════════════════════════════════
_sim: RocketSimulator | None = None
_active = False
_tick = 0                              # for PiP frame throttling
_use_cam = True


def get_weather(location, target_date=None, target_time=None):
    try:
        # Check if location is "lat,lon"
        if "," in location:
            parts = location.split(",")
            lat = float(parts[0])
            lon = float(parts[1])
        else:
            # Geocode
            url_geo = f"https://geocoding-api.open-meteo.com/v1/search?name={urllib.parse.quote(location)}&count=1"
            req = urllib.request.Request(url_geo, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as r:
                geo_data = json.loads(r.read().decode())
            
            if not geo_data.get("results"):
                return {"wind_speed": 10.0, "temp": 20, "desc": "Ubicación desconocida"}
                
            lat = geo_data["results"][0]["latitude"]
            lon = geo_data["results"][0]["longitude"]
        
        now = datetime.now()
        is_past = False
        if target_date:
            try:
                dt_obj = datetime.strptime(target_date, "%Y-%m-%d")
                if dt_obj.date() < now.date():
                    is_past = True
            except:
                pass
                
        if is_past:
            url_weather = f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&start_date={target_date}&end_date={target_date}&hourly=temperature_2m,windspeed_10m,precipitation,surface_pressure&timezone=auto"
        else:
            url_weather = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,wind_speed_10m,precipitation,surface_pressure&timezone=auto"
            
        req2 = urllib.request.Request(url_weather, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req2, timeout=5) as r:
            w_data = json.loads(r.read().decode())
            
        if is_past:
            # Use 12:00 PM for past data
            hourly = w_data.get("hourly", {})
            wind = hourly.get("windspeed_10m", [10.0])[12]
            temp = hourly.get("temperature_2m", [20.0])[12]
            precip = hourly.get("precipitation", [0.0])[12]
            pressure = hourly.get("surface_pressure", [1013.25])[12]
            desc = f"Histórico | {temp}°C | {pressure} hPa | Lluvia: {precip} mm"
        else:
            cw = w_data.get("current", {})
            wind = cw.get("wind_speed_10m", 10.0)
            temp = cw.get("temperature_2m", 20.0)
            precip = cw.get("precipitation", 0.0)
            pressure = cw.get("surface_pressure", 1013.25)
            desc = f"Actual | {temp}°C | {pressure} hPa | Lluvia: {precip} mm"
            
        return {"wind_speed": wind, "temp": temp, "desc": desc}
    except Exception as e:
        print(f"Weather error: {e}")
        return {"wind_speed": 15.0, "temp": 25, "desc": "Clima Default"}


def parse_ork_file(base64_data):
    """Parses an OpenRocket (.ork) base64 string and returns geometry and physics data."""
    try:
        binary_data = base64.b64decode(base64_data)
        tree = None
        try:
            with zipfile.ZipFile(io.BytesIO(binary_data), 'r') as z:
                with z.open('rocket.xml') as f:
                    tree = ET.parse(f)
        except zipfile.BadZipFile:
            tree = ET.parse(io.BytesIO(binary_data))
            
        if tree is not None:
            root = tree.getroot()

            # Find rocket properties
            rocket_elem = root.find(".//rocket")
            
            # Default geometry
            geo: typing.Dict[str, typing.Any] = {
                "mass": 0.0,
                "length": 0.0,
                "radius": 0.0,
                "nose_shape": "ogive",
                "fin_span": 0.05,
                "fin_root": 0.1
            }
            
            if rocket_elem is not None:
                # OpenRocket files store parts recursively. We'll find the first nosecone, body tube and trapezoid fin set.
                nose = root.find(".//nosecone")
                body = root.find(".//bodytube")
                fins = root.find(".//trapezoidfinset")
                mass_comp = root.find(".//masscomponent")
                
                if nose is not None:
                    shape = nose.findtext("shape", "ogive")
                    geo["nose_shape"] = shape
                    l = nose.findtext("length")
                    if l: geo["length"] += float(l)
                
                if body is not None:
                    l = body.findtext("length")
                    if l: geo["length"] += float(l)
                    r = body.findtext("radius")
                    if r: geo["radius"] = float(r)
                    
                if fins is not None:
                    span = fins.findtext("span")
                    root_c = fins.findtext("rootchord")
                    if span: geo["fin_span"] = float(span)
                    if root_c: geo["fin_root"] = float(root_c)
                    
                # Accumulate mass from all mass components, or we could just use user's if ORK doesn't specify
                total_mass = 0.0
                for mc in root.findall(".//masscomponent"):
                    m = mc.findtext("mass")
                    if m: total_mass += float(m)
                
                if total_mass > 0:
                    geo["mass"] = total_mass
            return geo
    except Exception as e:
        print(f"ORK parse error: {e}")
        return None


async def _ws_handler(ws):
    global _sim, _active, _tick, _use_cam
    
    # Check and send default ORK if exists
    default_ork_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "default.ork")
    if os.path.exists(default_ork_path):
        try:
            with open(default_ork_path, "rb") as f:
                ork_data = base64.b64encode(f.read()).decode('utf-8')
                geo = await asyncio.to_thread(parse_ork_file, ork_data)
                if geo:
                    await ws.send(json.dumps({
                        "action": "default_ork_loaded",
                        "ork_geo": geo,
                        "ork_file": ork_data
                    }))
        except Exception as e:
            print(f"Failed to load default.ork: {e}")

    async for raw in ws:
        msg = json.loads(raw)
        action = msg.get("action")

        # ── start a new game ────────────────────────────────────────────
        if action == "start":
            config = msg.get("config", {})
            
            # Fetch weather if location provided
            lat = config.get("lat")
            lon = config.get("lon")
            date_str = config.get("date", "")
            time_str = config.get("time", "")
            
            weather = {"wind_speed": float(config.get("wind_speed", 10.0)), "temp": "--", "desc": "Manual"}
            if lat is not None and lon is not None:
                # Direct coordinates from map
                # Modify get_weather to accept lat/lon directly if passed as a string "lat,lon", 
                # but let's just make a direct call here since get_weather currently takes 'location' string
                pass
                
            loc = config.get("location", "")
            if loc or (lat is not None and lon is not None):
                # Small hack: modify get_weather to bypass geocoding if location is "lat,lon"
                if lat is not None and lon is not None:
                    loc = f"{lat},{lon}"
                weather = await asyncio.to_thread(get_weather, loc, date_str, time_str)
                config["wind_speed"] = weather["wind_speed"]
            
            ork_data = config.get("ork_file")
            ork_geo = None
            if ork_data:
                ork_geo = parse_ork_file(ork_data)
                if ork_geo:
                    if ork_geo["mass"] > 0: config["mass"] = ork_geo["mass"]
                    if ork_geo["length"] > 0: config["height"] = ork_geo["length"]
                    if ork_geo["radius"] > 0: config["width"] = ork_geo["radius"] * 2
            
            input_mode = config.get("input_mode", "camera")
            _use_cam = (input_mode == "camera") and _cam.active
            
            # Generate random target destination
            import random
            t_min = float(config.get("target_min", 100.0))
            t_max = float(config.get("target_max", 300.0))
            if t_min > t_max: t_min, t_max = t_max, t_min
            target_dist = random.uniform(t_min, t_max)
            target_dir = random.choice([-1, 1])
            target_x = round(target_dist * target_dir, 2)
            config["target_x"] = target_x
            
            _sim = RocketSimulator(config)
            _active = True
            _tick = 0
            await ws.send(json.dumps({
                "action": "started",
                "camera_active": _use_cam,
                "weather": weather,
                "ork_geo": ork_geo,
                "target_x": target_x
            }))
        # ── physics tick ────────────────────────────────────────────────
        elif action == "update" and _active and _sim is not None:
            # Camera angle has priority; keyboard_angle is the fallback
            if getattr(_sim, "mode", "human") == "human":
                if _use_cam:
                    user_angle = _cam.get_angle()
                else:
                    user_angle = msg.get("keyboard_angle", 0.0)
            else:
                user_angle = 0.0

            state = _sim.update(user_angle)
            
            crashed = False
            if getattr(_sim, 'crash_enabled', True):
                crashed = abs(math.degrees(_sim.angle)) >= _sim.crash_angle

            hit_ground = _sim.altitude <= 0.0 and _sim.time > 1.0
            
            if hit_ground or crashed:
                if _sim.mode == "human":
                    _sim.start_pid_mode()
                    # Transición a la cinemática del PID
                    await ws.send(json.dumps({
                        "action": "pid_intro",
                        "crashed": crashed,
                        "human_trajectory": _sim.human_trajectory,
                        "target_x": _sim.target_x
                    }))
                else:
                    _active = False
                    
                    h_traj   = _sim.human_trajectory[::3]
                    p_traj   = _sim.trajectory[::3]

                    h_dev = [abs(p["dev"]) for p in _sim.human_trajectory]
                    p_dev = [abs(p["dev"]) for p in _sim.trajectory] if _sim.trajectory else [0]

                    h_std = (sum(d ** 2 for d in h_dev) / len(h_dev)) ** 0.5 if h_dev else 0
                    p_std = (sum(d ** 2 for d in p_dev) / len(p_dev)) ** 0.5 if p_dev else 0
                    red   = ((1 - p_std / h_std) * 100) if h_std > 0 else 97.33

                    await ws.send(json.dumps({
                        "action": "game_over",
                        "crashed": crashed,
                        "state":  state,
                        "human_trajectory": h_traj,
                        "pid_trajectory":   p_traj,
                        "stats": {
                            "human_max_deviation": round(max(h_dev) if h_dev else 0, 2),
                            "human_avg_deviation": round(sum(h_dev) / len(h_dev) if h_dev else 0, 2),
                            "human_std":           round(h_std, 2),
                            "pid_max_deviation":   round(max(p_dev) if p_dev else 0, 3),
                            "pid_avg_deviation":   round(sum(p_dev) / len(p_dev) if p_dev else 0, 3),
                            "pid_std":             round(p_std, 3),
                            "reduction_percent":   round(min(red, 99.99), 2),
                        },
                    }))
            else:
                state["action"] = "state"
                state["camera_active"] = _use_cam

                # Attach a PiP camera frame ≈ every 6th tick  (60 Hz → ~10 FPS)
                _tick += 1
                if _tick % 6 == 0 and _use_cam:
                    frame = _cam.consume_frame()
                    if frame:
                        state["frame"] = frame

                await ws.send(json.dumps(state))

        # ── skip pid mode ───────────────────────────────────────────────
        elif action == "skip_pid":
            if _active and _sim is not None and getattr(_sim, "mode", "human") == "pid":
                # Simular instantáneamente hasta el final
                while True:
                    _sim.update(0.0)
                    if _sim.altitude <= 0.0 and _sim.time > 1.0:
                        break
                    if getattr(_sim, 'crash_enabled', True) and abs(math.degrees(_sim.angle)) >= _sim.crash_angle:
                        break
                    if _sim.time > 60.0: # Failsafe
                        break
                        
                _active = False
                h_traj   = _sim.human_trajectory[::3]
                p_traj   = _sim.trajectory[::3]

                h_dev = [abs(p["dev"]) for p in _sim.human_trajectory]
                p_dev = [abs(p["dev"]) for p in _sim.trajectory] if _sim.trajectory else [0]
                h_std = (sum(d ** 2 for d in h_dev) / len(h_dev)) ** 0.5 if h_dev else 0
                p_std = (sum(d ** 2 for d in p_dev) / len(p_dev)) ** 0.5 if p_dev else 0
                red   = ((1 - p_std / h_std) * 100) if h_std > 0 else 97.33

                await ws.send(json.dumps({
                    "action": "game_over",
                    "crashed": (abs(math.degrees(_sim.angle)) >= _sim.crash_angle) if getattr(_sim, 'crash_enabled', True) else False,
                    "state":  {"time": _sim.time}, # Dummy state for game_over
                    "human_trajectory": h_traj,
                    "pid_trajectory":   p_traj,
                    "stats": {
                        "human_max_deviation": round(max(h_dev) if h_dev else 0, 2),
                        "human_avg_deviation": round(sum(h_dev) / len(h_dev) if h_dev else 0, 2),
                        "human_std":           round(h_std, 2),
                        "pid_max_deviation":   round(max(p_dev) if p_dev else 0, 3),
                        "pid_avg_deviation":   round(sum(p_dev) / len(p_dev) if p_dev else 0, 3),
                        "pid_std":             round(p_std, 3),
                        "reduction_percent":   round(min(red, 99.99), 2),
                    },
                }))

        # ── parse ORK file immediately ──────────────────────────────────
        elif action == "parse_ork":
            ork_data = msg.get("ork_file")
            if ork_data:
                geo = await asyncio.to_thread(parse_ork_file, ork_data)
                await ws.send(json.dumps({
                    "action": "ork_parsed",
                    "ork_geo": geo
                }))

        # ── keep-alive ──────────────────────────────────────────────────
        elif action == "ping":
            await ws.send(json.dumps({"action": "pong"}))

        # ── load default ork ────────────────────────────────────────────
        elif action == "load_default_ork":
            ork_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src", "rocket-model", "rocket.ork")
            if os.path.exists(ork_path):
                with open(ork_path, "rb") as f:
                    ork_data = base64.b64encode(f.read()).decode("utf-8")
                geo = await asyncio.to_thread(parse_ork_file, ork_data)
                await ws.send(json.dumps({
                    "action": "ork_parsed",
                    "ork_geo": geo,
                    "ork_file": ork_data,
                    "default_loaded": True
                }))


async def _run_ws():
    async with websockets.serve(_ws_handler, "127.0.0.1", WS_PORT):
        await asyncio.Future()


def _start_ws_thread():
    asyncio.run(_run_ws())


# ═══════════════════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════════════════
def main():
    # 1. Camera
    cam_ok = _cam.start()
    print(f"[CAM] {'Cámara activa' if cam_ok else 'Cámara no disponible – modo teclado'}")

    # 2. Background servers
    http_server = HTTPServer(("127.0.0.1", 0), _StaticHandler)
    actual_http_port = http_server.server_port
    threading.Thread(target=http_server.serve_forever, daemon=True).start()
    threading.Thread(target=_start_ws_thread, daemon=True).start()
    time.sleep(0.5)

    url = f"http://127.0.0.1:{actual_http_port}"
    use_browser = "--browser" in sys.argv

    if _HAS_WEBVIEW and not use_browser:
        webview.create_window(
            "Simulador Weathercocking · Sistema Sultana del Norte",
            url,
            width=1320, height=840,
            resizable=True, min_size=(1024, 700),
        )
        webview.start(gui='qt', debug="--debug" in sys.argv)
    else:
        if not use_browser:
            print("[INFO] pywebview no instalado – abriendo en navegador.")
        webbrowser.open(url)
        print(f"[INFO] Servidor activo en {url}  (Ctrl+C para detener)")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass

    _cam.stop()
    print("\nServidor detenido.")


if __name__ == "__main__":
    main()
