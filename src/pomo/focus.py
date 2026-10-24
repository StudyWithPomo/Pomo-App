"""Focus scoring. Pure logic (no cv2), so it is easy to test and tune."""
from __future__ import annotations

from dataclasses import dataclass, fields

from .signals import VisionSignals

# Highest priority first.
REASON_PRIORITY = ("absent", "drowsy", "looking_away", "slouching", "bad_window")


@dataclass
class FocusConfig:
    calibration_s: float = 5.0
    min_calibration_samples: int = 5
    absent_after_s: float = 3.0
    ear_closed: float = 0.20
    drowsy_after_s: float = 1.5
    yaw_max_deg: float = 25.0
    pitch_max_deg: float = 20.0
    away_after_s: float = 2.0
    size_ratio_max: float = 1.25
    face_y_max_delta: float = 0.12
    slouch_after_s: float = 5.0
    penalty_drowsy: float = 50.0
    penalty_away: float = 40.0
    penalty_slouch: float = 20.0
    penalty_bad_window: float = 50.0
    ema_alpha: float = 0.2
    focused_at: float = 70.0     # focused: >= 70
    drifting_at: float = 40.0    # drifting: 40-69, unfocused: < 40
    hysteresis: float = 5.0

    @classmethod
    def from_yaml(cls, path: str) -> "FocusConfig":
        """Load thresholds from a YAML mapping; overrides only known fields."""
        import yaml

        with open(path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        if not data:
            return cls()
        if not isinstance(data, dict):
            raise ValueError("config must be a mapping")
        known = {f.name for f in fields(cls)}
        unknown = sorted(set(data) - known)
        if unknown:
            raise ValueError(f"unknown config key(s): {', '.join(unknown)}")
        return cls(**data)


@dataclass(frozen=True)
class FocusResult:
    score: int
    state: str            # calibrating | focused | drifting | unfocused
    reason: str | None


@dataclass
class _Baseline:
    yaw: float
    pitch: float
    face_size: float
    face_y: float


class _Hold:
    """Tracks how long a condition has been continuously true."""

    def __init__(self) -> None:
        self._since: float | None = None

    def held(self, cond: bool, now: float) -> float:
        if not cond:
            self._since = None
            return 0.0
        if self._since is None:
            self._since = now
        return now - self._since


def next_state(current: str, score: float, cfg: FocusConfig | None = None) -> str:
    """Three-state classifier with hysteresis around each threshold."""
    cfg = cfg or FocusConfig()
    hi, lo, h = cfg.focused_at, cfg.drifting_at, cfg.hysteresis
    state = current
    if state == "focused" and score < hi - h:
        state = "drifting"
    elif state == "unfocused" and score >= lo + h:
        state = "drifting"
    if state == "drifting":
        if score >= hi + h:
            return "focused"
        if score < lo - h:
            return "unfocused"
    return state


class FocusEngine:
    def __init__(self, cfg: FocusConfig | None = None) -> None:
        self.cfg = cfg or FocusConfig()
        self.recalibrate()

    def recalibrate(self) -> None:
        self._base: _Baseline | None = None
        self._samples: list[VisionSignals] = []
        self._cal_start: float | None = None
        self._ema = 100.0
        self._state = "calibrating"
        self._holds = {k: _Hold() for k in ("absent", "drowsy", "away", "slouch")}

    def update(self, sig: VisionSignals, window: str, now: float) -> FocusResult:
        if self._base is None:
            return self._calibrate(sig, now)

        cfg, base = self.cfg, self._base
        active: set[str] = set()

        absent_for = self._holds["absent"].held(not sig.face_present, now)
        if not sig.face_present:
            for k in ("drowsy", "away", "slouch"):
                self._holds[k].held(False, now)
            if absent_for > cfg.absent_after_s:
                active.add("absent")
        else:
            drowsy_for = self._holds["drowsy"].held(sig.ear < cfg.ear_closed, now)
            away = (
                abs(sig.yaw_deg - base.yaw) > cfg.yaw_max_deg
                or abs(sig.pitch_deg - base.pitch) > cfg.pitch_max_deg
            )
            away_for = self._holds["away"].held(away, now)
            slouch = (
                sig.face_size > base.face_size * cfg.size_ratio_max
                or sig.face_y > base.face_y + cfg.face_y_max_delta
            )
            slouch_for = self._holds["slouch"].held(slouch, now)

            if drowsy_for > cfg.drowsy_after_s:
                active.add("drowsy")
            if away_for > cfg.away_after_s:
                active.add("looking_away")
            if slouch_for > cfg.slouch_after_s:
                active.add("slouching")

        if window == "distraction":
            active.add("bad_window")

        if "absent" in active:
            raw = 0.0
        else:
            penalties = {
                "drowsy": cfg.penalty_drowsy,
                "looking_away": cfg.penalty_away,
                "slouching": cfg.penalty_slouch,
                "bad_window": cfg.penalty_bad_window,
            }
            raw = max(0.0, 100.0 - sum(penalties[r] for r in active))

        self._ema += cfg.ema_alpha * (raw - self._ema)
        self._state = next_state(self._state, self._ema, cfg)
        reason = next((r for r in REASON_PRIORITY if r in active), None)
        return FocusResult(round(self._ema), self._state, reason)

    def _calibrate(self, sig: VisionSignals, now: float) -> FocusResult:
        cfg = self.cfg
        if self._cal_start is None:
            self._cal_start = now
        if sig.face_present:
            self._samples.append(sig)
        if now - self._cal_start >= cfg.calibration_s and len(self._samples) >= cfg.min_calibration_samples:
            n = len(self._samples)
            self._base = _Baseline(
                yaw=sum(s.yaw_deg for s in self._samples) / n,
                pitch=sum(s.pitch_deg for s in self._samples) / n,
                face_size=sum(s.face_size for s in self._samples) / n,
                face_y=sum(s.face_y for s in self._samples) / n,
            )
            self._state = "focused"
            self._samples = []
        return FocusResult(100, "calibrating", None)
