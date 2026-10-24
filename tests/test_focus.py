import pytest
from dataclasses import replace

from pomo.focus import FocusConfig, FocusEngine, next_state
from pomo.signals import NO_FACE, VisionSignals

BASE = VisionSignals(True, yaw_deg=2.0, pitch_deg=-3.0, ear=0.30, face_size=0.40, face_y=0.50)
FPS = 10


def run(engine, sig, seconds, t, window="study"):
    res = None
    for _ in range(int(seconds * FPS)):
        t += 1.0 / FPS
        res = engine.update(sig, window, t)
    return res, t


def calibrated(sig=BASE):
    engine = FocusEngine()
    _, t = run(engine, sig, 6, 0.0)
    return engine, t


def test_calibrating_then_focused():
    engine = FocusEngine()
    res, t = run(engine, BASE, 4, 0.0)
    assert res.state == "calibrating"
    res, t = run(engine, BASE, 3, t)
    assert res.state == "focused" and res.score >= 95 and res.reason is None


def test_focused_steady():
    engine, t = calibrated()
    res, _ = run(engine, BASE, 10, t)
    assert res.state == "focused" and res.score == 100 and res.reason is None


def test_baseline_is_relative():
    sideways = replace(BASE, yaw_deg=20.0)
    engine, t = calibrated(sideways)
    res, _ = run(engine, sideways, 8, t)
    assert res.reason is None and res.state == "focused"


def test_looking_away():
    engine, t = calibrated()
    res, _ = run(engine, replace(BASE, yaw_deg=40.0), 6, t)
    assert res.reason == "looking_away"
    assert res.state == "drifting" and 55 <= res.score <= 65


def test_brief_glance_is_ignored():
    engine, t = calibrated()
    _, t = run(engine, replace(BASE, yaw_deg=40.0), 1.5, t)
    res, _ = run(engine, BASE, 3, t)
    assert res.reason is None and res.state == "focused" and res.score == 100


def test_drowsy():
    engine, t = calibrated()
    res, _ = run(engine, replace(BASE, ear=0.1), 6, t)
    assert res.reason == "drowsy" and res.state == "drifting"


def test_absent():
    engine, t = calibrated()
    res, _ = run(engine, NO_FACE, 7, t)
    assert res.reason == "absent" and res.state == "unfocused" and res.score <= 5


def test_slouching():
    engine, t = calibrated()
    res, _ = run(engine, replace(BASE, face_size=0.52), 8, t)
    assert res.reason == "slouching" and 78 <= res.score <= 82 and res.state == "focused"


def test_bad_window():
    engine, t = calibrated()
    res, _ = run(engine, BASE, 6, t, window="distraction")
    assert res.reason == "bad_window" and res.state == "drifting"
    engine, t = calibrated()
    res, _ = run(engine, BASE, 6, t, window="neutral")
    assert res.reason is None and res.score == 100


def test_reason_priority():
    engine, t = calibrated()
    res, _ = run(engine, replace(BASE, ear=0.1, yaw_deg=40.0), 6, t)
    assert res.reason == "drowsy" and res.state == "unfocused"


def test_hysteresis():
    assert next_state("focused", 68) == "focused"
    assert next_state("focused", 64) == "drifting"
    assert next_state("drifting", 72) == "drifting"
    assert next_state("drifting", 75) == "focused"
    assert next_state("drifting", 36) == "drifting"
    assert next_state("drifting", 34) == "unfocused"
    assert next_state("unfocused", 42) == "unfocused"
    assert next_state("unfocused", 45) == "drifting"
    assert next_state("focused", 20) == "unfocused"
    assert next_state("unfocused", 90) == "focused"


def test_from_yaml_override(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text("ear_closed: 0.3\n")
    cfg = FocusConfig.from_yaml(str(p))
    assert cfg.ear_closed == 0.3
    assert cfg.calibration_s == 5.0
    assert cfg.yaw_max_deg == 25.0
    assert cfg.focused_at == 70.0


def test_from_yaml_unknown_key(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text("bogus: 1\n")
    with pytest.raises(ValueError, match="bogus"):
        FocusConfig.from_yaml(str(p))
