# Study Buddy (Pomo)

One app on your laptop: the Study Buddy dashboard plus the webcam focus tracker.
It was two repos (`Frontend-Pomo`, `ML-Server-Pomo`); now one Python process serves the dashboard and feeds it focus data.

Frames from the webcam are processed in memory only, never saved or sent anywhere.
The camera only runs while a study session is running.

## Setup
Windows (Python 3.10–3.12; mediapipe 0.10.21 has no 3.13 wheels):

    py -3.11 -m venv .venv
    .venv\Scripts\python -m pip install -e ".[dev]"

Fedora:

    sudo dnf install uv
    uv venv --python 3.12
    uv pip install -e ".[dev]"

## Run
    .venv\Scripts\python -m pomo     # Windows
    uv run python -m pomo            # Fedora

Then open **http://localhost:8000** in **Chrome or Edge** (Web Serial and Idle Detection are Chromium-only).

Begin a session on the dashboard and the camera starts; the first 5 s are calibration, so look at the screen and sit normally. When the session ends the camera stops.

| Flag | What |
|---|---|
| `--no-camera` | Dashboard only. Use the demo controls (`Y`, `I`, `F`, `S`, `E`, `Space`). |
| `--preview` | Also show the camera with an overlay (`q` quits the app, `c` recalibrates). |
| `--stdout` | Also print each focus tick as a JSON line. |
| `--port 8000` | Dashboard port. The focus feed is on 8765, which the page expects. |
| `--hz 2` | Focus ticks per second. |
| `--camera 0` | Camera index. |
| `--config path.yaml` | Override focus thresholds (see below). |

Tests: `uv run pytest` (Windows: `.venv\Scripts\python -m pytest`)

## How the pieces fit

    webcam -> pomo.vision -> pomo.focus -> pomo.main (tick loop)
                                             |
                                       pomo.server.Hub
                                  http://localhost:8000   dashboard (src/pomo/web)
                                  ws://localhost:8765     focus ticks, camera on/off

- The dashboard sends `{"t":"camera","on":true}` when a session starts and `false` when it ends. If the page is closed, the camera stops.
- Each tick is `{"t":"focus","ts","focus":0-100,"state","reason","window","yaw","pitch","ear"}`. The dashboard turns a `drifting` or `unfocused` state with a reason into a named drift ("Looking away 0:12"), ends it when the state returns to `focused`, and forwards every tick to the ESP32 pet over USB serial. Expect a few seconds of lag before a drift shows, because the score is smoothed.
- If the camera can't open, the dashboard shows a notice and the session carries on without it.
- Both ports bind to 127.0.0.1 only, and the focus feed only accepts connections from the dashboard's own page, so other websites can't read it or turn the camera on.

## Dashboard
Plain HTML/CSS/JS in `src/pomo/web`, no build step. Feature list: `docs/FEATURES.md`. Device protocol: `src/pomo/web/schema/pomo-device.schema.json`. The rules (breaks, XP, hearts) and the device protocol are documented in the original frontend README; they are unchanged.

## Focus helper extension
A small Chrome extension in `extension/` tells the dashboard which tab you are on, so visiting a distracting site (the dashboard's `DISTRACTING` list) counts as a drift. Optional; the dashboard works without it.

1. Run the app (`python -m pomo`) and open Chrome (or Edge) at `chrome://extensions`.
2. Turn on **Developer mode** (top right), choose **Load unpacked**, and pick this repo's `extension` folder.
3. Keep the dashboard open. The extension connects by itself; reload it from `chrome://extensions` if you restart the app and it does not reconnect within a few seconds.

It sends only the URL and title of the tab you are looking at (or "other" when Chrome is not the focused window), and only to `ws://localhost:8765`, which is the Pomo app on your own laptop. Nothing is stored or sent anywhere else. The app accepts it because the extension's id is fixed by the `key` in `extension/manifest.json`; other extensions are refused.

## Focus tracking
- state: calibrating | focused | drifting | unfocused
- reason: absent | drowsy | looking_away | slouching | bad_window | null
- Score starts at 100, penalties apply while a condition holds for its duration, then an EMA (alpha 0.2) smooths it.
- Thresholds live in `FocusConfig` in `src/pomo/focus.py`; override them in `config/focus.yaml`. Only keys present in the file change, and unknown keys raise an error.

## Assumptions / not done yet
- `mediapipe` is pinned to 0.10.21: newer releases removed the `mp.solutions` API this code uses. We depend on `opencv-contrib-python` (what mediapipe pulls in) so two cv2 packages don't clash.
- Posture is a proxy: face size and vertical position vs baseline (no pose model).
- EAR threshold 0.20 is a guess; tune it with `--preview` if your eyes read differently.
- Window tracking is still a stub that always returns "neutral". Distracting sites come from the dashboard's own `DISTRACTING` list when a helper sends `{"t":"active"}`; `classify()` and `config/windows.yaml` are ready for a real `WindowSource`.
- The camera reader tries DirectShow then Media Foundation on Windows, AVFoundation on macOS, V4L2 on Linux.
- If port 8000 is taken (e.g. by another local app), start with `--port 8001` and open that port instead.
