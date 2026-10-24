"""cv2 overlay drawing for --preview. Draws in place on the frame."""
from __future__ import annotations

import cv2
import numpy as np

from .signals import VisionSignals

_STATE_COLORS = {
    "focused": (0, 200, 0),
    "drifting": (0, 220, 255),
    "unfocused": (0, 0, 255),
    "calibrating": (160, 160, 160),
}
_GREEN = (0, 200, 0)
_RED = (0, 0, 255)
_WHITE = (255, 255, 255)


def draw_overlay(frame, sig: VisionSignals, state: str, ear_closed: float) -> None:
    if sig.overlay is None:
        cv2.putText(
            frame,
            "NO FACE",
            (max(0, (frame.shape[1] - 70) // 2), max(25, frame.shape[0] // 4)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            _RED,
            1,
            cv2.LINE_AA,
        )
        return

    x0, y0, x1, y1 = sig.overlay.bbox
    nx, ny = sig.overlay.nose

    box_col = _STATE_COLORS.get(state, _GREEN)
    cv2.rectangle(frame, (x0, y0), (x1, y1), box_col, 2)

    eye_col = _GREEN if sig.ear >= ear_closed else _RED
    left = np.array(list(sig.overlay.left_eye), dtype=np.int32)
    right = np.array(list(sig.overlay.right_eye), dtype=np.int32)
    cv2.polylines(frame, [left, right], True, eye_col, 1)

    cv2.circle(frame, (nx, ny), 3, _WHITE, -1)
    end_x = int(nx - 3 * sig.yaw_deg)
    end_y = int(ny + 3 * sig.pitch_deg)
    cv2.line(frame, (nx, ny), (end_x, end_y), _WHITE, 2, cv2.LINE_AA)

    top_y = y0 + 20 if y0 < 20 else y0 - 8
    cv2.putText(
        frame,
        f"yaw {sig.yaw_deg:+.0f}  pitch {sig.pitch_deg:+.0f}",
        (x0, top_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        _WHITE,
        1,
        cv2.LINE_AA,
    )

    ear_col = _RED if sig.ear < ear_closed else _GREEN
    cv2.putText(
        frame,
        f"EAR {sig.ear:.2f}",
        (x0, y1 + 15),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        ear_col,
        1,
        cv2.LINE_AA,
    )
    return None
