"""Active-window categorisation. Only the category ever leaves this module."""
from __future__ import annotations

from pathlib import Path
from typing import Protocol

import yaml


class WindowSource(Protocol):
    def category(self) -> str:
        """Return 'study', 'neutral' or 'distraction'."""
        ...


class StubWindowSource:
    """Placeholder until real window reading is implemented."""

    def category(self) -> str:
        return "neutral"


def load_rules(path: str | Path = "config/windows.yaml") -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def classify(app: str, title: str, rules: dict) -> str:
    """Case-insensitive substring match. Study is checked first so you can
    whitelist a title (e.g. 'lecture') that would otherwise look like a distraction."""
    app, title = app.lower(), title.lower()
    for category in ("study", "distraction"):
        block = rules.get(category) or {}
        if any(a.lower() in app for a in block.get("apps") or []):
            return category
        if any(t.lower() in title for t in block.get("titles") or []):
            return category
    return "neutral"
