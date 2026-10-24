"""Dashboard + focus feed in one process.

- HTTP serves the bundled dashboard (src/pomo/web).
- A WebSocket pushes focus ticks to the page and lets the page switch the camera
  on and off, so the webcam only runs while a study session is running.

Everything binds to 127.0.0.1, and the WebSocket only accepts connections from
the dashboard's own origin, so other websites can't read the feed or turn the
camera on.
"""
from __future__ import annotations

import asyncio
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable

from websockets.asyncio.server import broadcast, serve

WEB_DIR = Path(__file__).resolve().parent / "web"
HOST = "127.0.0.1"


class _QuietHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args) -> None:  # keep the terminal for focus output
        pass


class Hub:
    """Serves the dashboard and fans focus ticks out to connected pages."""

    def __init__(self, on_camera: Callable[[bool], None], http_port: int = 8000, ws_port: int = 8765):
        self.http_port = http_port
        self.ws_port = ws_port
        self._on_camera = on_camera
        self._clients: set = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._httpd: ThreadingHTTPServer | None = None
        self._error: BaseException | None = None
        self._stop_event: asyncio.Event | None = None
        self._ws_thread: threading.Thread | None = None

    # ---- lifecycle -------------------------------------------------------
    def start(self) -> None:
        ready = threading.Event()
        self._ws_thread = threading.Thread(target=self._run_ws, args=(ready,), daemon=True)
        self._ws_thread.start()
        ready.wait(10)
        if self._error is not None:
            raise self._error
        handler = partial(_QuietHandler, directory=str(WEB_DIR))
        self._httpd = ThreadingHTTPServer((HOST, self.http_port), handler)
        threading.Thread(target=self._httpd.serve_forever, daemon=True).start()

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
        loop, stop = self._loop, self._stop_event
        if loop is not None and stop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(stop.set)
        if self._ws_thread is not None:
            self._ws_thread.join(timeout=5)

    # ---- publishing (safe to call from any thread) ------------------------
    def publish(self, obj: dict) -> None:
        loop = self._loop
        if loop is None or not self._clients:
            return
        data = json.dumps(obj)
        loop.call_soon_threadsafe(lambda: broadcast(set(self._clients), data))

    # ---- websocket side --------------------------------------------------
    def _run_ws(self, ready: threading.Event) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop

        async def main() -> None:
            self._stop_event = asyncio.Event()
            origins = [f"http://localhost:{self.http_port}", f"http://127.0.0.1:{self.http_port}"]
            try:
                async with serve(self._handle, HOST, self.ws_port, origins=origins):
                    ready.set()
                    await self._stop_event.wait()
            except OSError as e:
                self._error = e
                ready.set()

        try:
            loop.run_until_complete(main())
        finally:
            loop.close()

    async def _handle(self, ws) -> None:
        self._clients.add(ws)
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(msg, dict) and msg.get("t") == "camera":
                    self._on_camera(bool(msg.get("on")))
        finally:
            self._clients.discard(ws)
            if not self._clients:  # page closed: never leave the camera running
                self._on_camera(False)
