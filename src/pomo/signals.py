"""Plain data passed from the vision module to the focus logic (no cv2 here)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FaceOverlay:
    bbox: tuple[int, int, int, int]  # x0, y0, x1, y1 in pixels
    nose: tuple[int, int]
    left_eye: tuple[tuple[int, int], ...]   # 6 points
    right_eye: tuple[tuple[int, int], ...]  # 6 points


@dataclass(frozen=True)
class VisionSignals:
    face_present: bool
    yaw_deg: float = 0.0
    pitch_deg: float = 0.0
    ear: float = 0.30          # average eye aspect ratio
    face_size: float = 0.0     # face bbox height / frame height
    face_y: float = 0.0        # face bbox center y / frame height
    overlay: FaceOverlay | None = None


NO_FACE = VisionSignals(face_present=False)
