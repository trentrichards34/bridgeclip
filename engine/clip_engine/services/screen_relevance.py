"""Clip-level screen relevance for screen share + webcam sources.

Each clip from a screen share gets one decision, which the layout analyzer
turns into framing (see layout_analyzer.apply_screen_focus):

    presenter  the point stands without the screen -> the webcam fills the frame
    screen     the screen is the point (a walkthrough, demo or chart) -> split
               screen, cutting to the presenter only for long stretches where
               the screen sits still
    mixed      mostly the presenter, the screen at specific moments -> start on
               the presenter and cut to the split only on a real page/slide
               change or when the speech points at the screen

In Smart mode the planner gives the decision with a one-line reason (it reads
the clip's transcript); without it (older models, visual-only planning) a
cheap fallback reads how much of the clip's speech points at the screen. The
member can also choose one style for every clip ("split" or "presenter").
Sources without a screen share are never affected.
"""

from dataclasses import dataclass
from typing import Any, Optional

PRESENTER = "presenter"
SCREEN = "screen"
MIXED = "mixed"
DECISIONS = (PRESENTER, SCREEN, MIXED)

# The member's choice on Create ("Screen share clips").
MODE_SMART = "smart"
MODE_SPLIT = "split"
MODE_PRESENTER = "presenter"
MODES = (MODE_SMART, MODE_SPLIT, MODE_PRESENTER)

MAX_REASON_CHARS = 160

# Words and phrases that refer to something on the screen. Weaker than the
# layout analyzer's SCREEN_CUE_PHRASES (which cut to the split on their own):
# here they are only counted, and only a high density means the screen matters.
SCREEN_REFERENCE_WORDS = frozenset((
    "screen", "page", "slide", "slides", "chart", "graph", "click", "clicking", "clicked", "button", "dashboard",
    "tab", "scroll", "scrolling", "menu", "dropdown", "spreadsheet", "column", "cursor", "highlighted", "paste",
    "upload", "zoom", "browser", "settings", "demo",
))
SCREEN_REFERENCE_PHRASES = (
    "you can see", "you'll see", "see here", "see this", "look at", "right here", "over here", "up here",
    "down here", "this one", "this button", "this part", "on the left", "on the right", "at the top", "at the bottom",
)

# Fallback thresholds: cue phrases count double; per minute of the clip.
FALLBACK_SCREEN_DENSITY = 18.0
FALLBACK_MIXED_SCORE = 2


@dataclass(frozen=True)
class ScreenFocus:
    """A clip's screen relevance and where it came from."""

    decision: str
    reason: str
    # planner | speech (fallback heuristic) | mode (the member's choice) | default (nothing to judge by)
    source: str
    mode: str = MODE_SMART

    def to_dict(self) -> dict:
        return {"decision": self.decision, "reason": self.reason, "source": self.source, "mode": self.mode}


def clean_decision(value: Any) -> Optional[str]:
    """A valid decision from model output, or None."""
    if not isinstance(value, str):
        return None
    value = value.strip().lower()
    return value if value in DECISIONS else None


def clean_reason(value: Any) -> str:
    """One short line of model text (no newlines, bounded)."""
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:MAX_REASON_CHARS]


def clean_mode(value: Any) -> str:
    return value if value in MODES else MODE_SMART


def _norm(word: str) -> str:
    return "".join(ch for ch in word.lower().replace("’", "'") if ch.isalnum() or ch == "'")


def speech_screen_signals(segments, window_start_ms: int, window_ms: int) -> tuple[int, int]:
    """(screen references, words) spoken inside the window."""
    words = [_norm(w.word) for s in segments or [] for w in (getattr(s, "words", None) or [])
             if window_start_ms <= w.start_time_ms < window_start_ms + window_ms]
    words = [w for w in words if w]
    refs = sum(1 for w in words if w in SCREEN_REFERENCE_WORDS)
    phrases = [tuple(_norm(p) for p in phrase.split()) for phrase in SCREEN_REFERENCE_PHRASES]
    for i in range(len(words)):
        refs += sum(1 for phrase in phrases if tuple(words[i:i + len(phrase)]) == phrase)
    return refs, len(words)


def fallback_decision(cue_count: int, refs: int, words: int, window_ms: int) -> tuple[str, str, str]:
    """(decision, reason, source) from how much of the speech points at the screen."""
    if words == 0:
        return MIXED, "No speech to judge by, so it cuts to the screen when it changes", "default"
    score = 2 * cue_count + refs
    minutes = max(0.25, window_ms / 60000)
    if score / minutes >= FALLBACK_SCREEN_DENSITY:
        return SCREEN, "The speech keeps pointing at the screen", "speech"
    if score >= FALLBACK_MIXED_SCORE:
        return MIXED, "The speech points at the screen at a few moments", "speech"
    return PRESENTER, "The speech makes its point without the screen", "speech"


def resolve_screen_focus(mode: Any, planned: Any = None, planned_reason: Any = None, cue_count: int = 0,
                         refs: int = 0, words: int = 0, window_ms: int = 0) -> ScreenFocus:
    """The clip's decision: the member's single style, else the planner's, else the fallback."""
    mode = clean_mode(mode)
    if mode == MODE_SPLIT:
        return ScreenFocus(SCREEN, "Split screen chosen for screen share clips", "mode", mode)
    if mode == MODE_PRESENTER:
        return ScreenFocus(PRESENTER, "Presenter only chosen for screen share clips", "mode", mode)
    decision = clean_decision(planned)
    if decision:
        return ScreenFocus(decision, clean_reason(planned_reason), "planner", mode)
    decision, reason, source = fallback_decision(cue_count, refs, words, window_ms)
    return ScreenFocus(decision, reason, source, mode)
