"""python -m pomo [--preview] [--hz 2] [--port 8000] [--no-camera]

One app: serves the dashboard on http://localhost:<port> and runs the webcam
focus tracker while a study session is running.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time

from .focus import FocusConfig, FocusEngine, FocusResult
from .server import Hub
from .signals import VisionSignals
from .windows import StubWindowSource, WindowSource


def _preview(cv2, frame, res: FocusResult, sig: VisionSignals, ear_closed: float) -> int:
    from .preview import draw_overlay

    draw_overlay(frame, sig, res.state, ear_closed)
    lines = [
        f"focus {res.score}  {res.state}",
        f"reason: {res.reason}",
    ]
    if res.state == "calibrating":
        lines.append("calibrating: look at the screen")
    for i, text in enumerate(lines):
        cv2.putText(frame, text, (10, 25 + 24 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
    cv2.imshow("pomo", frame)  # shown on screen only, never saved
    return cv2.waitKey(1) & 0xFF


def _track(args, hub: Hub, camera_on: threading.Event) -> str:
    """Run one camera session until the page switches it off. Returns 'quit' or 'idle'."""
    import cv2

    from .capture import Webcam
    from .vision import FaceTracker

    if os.path.isfile(args.config):
        engine = FocusEngine(FocusConfig.from_yaml(args.config))
    else:
        engine = FocusEngine()
    windows: WindowSource = StubWindowSource()
    period = 1.0 / args.hz
    next_emit = 0.0
    misses = 0

    try:
        with Webcam(args.camera) as cam, FaceTracker() as tracker:
            while camera_on.is_set():
                frame = cam.read()
                if frame is None:
                    misses += 1
                    if misses >= 50:
                        raise RuntimeError("camera stopped returning frames")
                    continue
                misses = 0

                now = time.monotonic()
                sig = tracker.process(frame)
                category = windows.category()
                res = engine.update(sig, category, now)

                if now >= next_emit:
                    next_emit = now + period
                    tick = {
                        "t": "focus",
                        "ts": round(time.time(), 2),
                        "focus": res.score,
                        "state": res.state,
                        "reason": res.reason,
                        "window": category,
                        "yaw": round(sig.yaw_deg, 1),
                        "pitch": round(sig.pitch_deg, 1),
                        "ear": round(sig.ear, 3),
                    }
                    hub.publish(tick)
                    if args.stdout:
                        print(json.dumps(tick), flush=True)

                if args.preview:
                    key = _preview(cv2, frame, res, sig, engine.cfg.ear_closed)
                    if key == ord("q"):
                        return "quit"
                    if key == ord("c"):
                        engine.recalibrate()
    except RuntimeError as e:
        camera_on.clear()
        print(f"error: {e}", file=sys.stderr)
        hub.publish({"t": "camera_error", "message": str(e)})
    finally:
        if args.preview:
            cv2.destroyAllWindows()
    return "idle"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pomo")
    parser.add_argument("--port", type=int, default=8000, help="dashboard port (default 8000)")
    parser.add_argument("--ws-port", type=int, default=8765, help="focus feed port (default 8765; the dashboard expects this)")
    parser.add_argument("--no-camera", action="store_true", help="serve the dashboard only (use the demo controls)")
    parser.add_argument("--preview", action="store_true", help="show camera with overlay (q quit, c recalibrate)")
    parser.add_argument("--stdout", action="store_true", help="also print focus ticks as JSON lines")
    parser.add_argument("--hz", type=float, default=2.0, help="focus ticks per second")
    parser.add_argument("--camera", type=int, default=0, help="camera index")
    parser.add_argument(
        "--config",
        type=str,
        default="config/focus.yaml",
        help="YAML file overriding FocusConfig thresholds (default config/focus.yaml)",
    )
    args = parser.parse_args(argv)

    camera_on = threading.Event()

    def on_camera(on: bool) -> None:
        if args.no_camera:
            return
        camera_on.set() if on else camera_on.clear()

    hub = Hub(on_camera, http_port=args.port, ws_port=args.ws_port)
    try:
        hub.start()
    except OSError as e:
        print(f"error: could not start the server ({e}). Is another copy already running?", file=sys.stderr)
        return 1

    print(f"Study Buddy: http://localhost:{args.port}  (open in Chrome or Edge)")
    print("Camera: " + ("off (--no-camera)" if args.no_camera else "starts when you begin a session, stops when it ends"))
    print("Ctrl+C to quit.")

    try:
        while True:
            if camera_on.is_set():
                if _track(args, hub, camera_on) == "quit":
                    break
            else:
                time.sleep(0.1)
    except KeyboardInterrupt:
        pass
    finally:
        hub.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
