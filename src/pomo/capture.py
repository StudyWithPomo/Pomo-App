"""Webcam capture. Frames stay in memory; nothing is ever written to disk."""
from __future__ import annotations

import sys
import time

import cv2


def _backends() -> list[int]:
    """Camera backends to try, best first, for this OS. CAP_ANY is the last resort."""
    if sys.platform.startswith("win"):
        # DirectShow opens fastest and honours width/height/fps on most laptop webcams;
        # Media Foundation is the newer Windows API and catches cameras DirectShow misses.
        return [cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY]
    if sys.platform == "darwin":
        return [cv2.CAP_AVFOUNDATION, cv2.CAP_ANY]
    return [cv2.CAP_V4L2, cv2.CAP_ANY]


class Webcam:
    def __init__(self, index: int = 0, width: int = 640, height: int = 480, fps: int = 15):
        self._index = index
        self._width = width
        self._height = height
        self._fps = fps
        self._min_dt = 1.0 / fps
        self._last = 0.0
        self._cap: cv2.VideoCapture | None = None

    def __enter__(self) -> "Webcam":
        cap = None
        for backend in _backends():
            cap = cv2.VideoCapture(self._index, backend)
            if cap.isOpened():
                break
            cap.release()
            cap = None
        if cap is None:
            where = f"/dev/video{self._index}" if sys.platform.startswith("linux") else f"index {self._index}"
            raise RuntimeError(
                f"Could not open camera {self._index} ({where}). "
                "Is another app (Zoom, Teams, the Camera app) using it? "
                "On Windows, also check Settings > Privacy & security > Camera."
            )
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
        cap.set(cv2.CAP_PROP_FPS, self._fps)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self._cap = cap
        return self

    def __exit__(self, *exc) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    def read(self):
        """Return the next BGR frame (capped to ~fps), or None if the read failed."""
        wait = self._min_dt - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        ok, frame = self._cap.read()
        self._last = time.monotonic()
        return frame if ok else None
