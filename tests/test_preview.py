import numpy as np

from pomo.preview import draw_overlay
from pomo.signals import FaceOverlay, VisionSignals

WIDTH, HEIGHT = 640, 480


def blank() -> np.ndarray:
    return np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)


def synthetic_sig(ear: float = 0.3, yaw_deg: float = 10.0, pitch_deg: float = -5.0) -> VisionSignals:
    return VisionSignals(
        face_present=True,
        yaw_deg=yaw_deg,
        pitch_deg=pitch_deg,
        ear=ear,
        overlay=FaceOverlay(
            bbox=(200, 100, 440, 380),
            nose=(320, 250),
            left_eye=((280, 210), (282, 205), (285, 200), (288, 205), (291, 210), (284, 218)),
            right_eye=((360, 210), (358, 205), (355, 200), (352, 205), (349, 210), (356, 218)),
        ),
    )


def test_draw_overlay_changes_pixels():
    frame = blank()
    sig = synthetic_sig()
    draw_overlay(frame, sig, "focused", 0.2)
    assert frame.dtype == np.uint8
    assert frame.shape == (HEIGHT, WIDTH, 3)
    assert bool(frame.any())


def test_draw_overlay_all_states():
    for state in ("focused", "drifting", "unfocused", "calibrating"):
        frame = blank()
        sig = synthetic_sig()
        draw_overlay(frame, sig, state, 0.2)
        assert bool(frame.any())


def test_draw_overlay_no_face():
    frame = blank()
    sig = VisionSignals(face_present=False)  # overlay is None
    draw_overlay(frame, sig, "focused", 0.2)
    assert bool(frame.any())
