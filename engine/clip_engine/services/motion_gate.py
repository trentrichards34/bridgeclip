"""
Motion gate: does a draft video move enough to hold a viewer?

The draft is decoded at 10 fps and shrunk to 108x192 grayscale. For each 0.1 s step we take the mean absolute pixel
difference from the previous frame, then report:

  motion        mean step difference (0-255 scale)
  big/s         steps whose difference exceeds 12, per second of video
  flat share    share of 1.5 s rolling windows whose mean difference is under the style's threshold
  flat stretches  those windows merged into time ranges, each with the words spoken in it (when a word list is given),
                  so the next pass knows exactly which lines need a build-up, a camera move or secondary motion

Targets depend on the style (see STYLE_TARGETS). A mask rectangle (fractions of the frame) leaves out a region such as
a presenter corner, whose constant small motion would otherwise hide a dead background.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np

from clip_engine.services.media_process import MediaProcessError, media_process

FPS = 10
WIDTH, HEIGHT = 108, 192
BIG_STEP = 12.0
WINDOW_S = 1.5
# A step counts as "changing" above this (informational: reference reels change on almost every step).
CHANGE_STEP = 0.5
VIDEO_GUARD = ["-protocol_whitelist", "file,pipe,fd", "-format_whitelist", "mov,matroska,webm,avi,flv,mpegts"]
MAX_SECONDS = 15 * 60


@dataclass(frozen=True)
class StyleTarget:
    motion: float          # minimum mean step difference
    big_per_s: float       # minimum big steps per second
    flat_share: float      # maximum share of flat windows (0-1)
    window_floor: float    # a 1.5 s window under this mean is flat


STYLE_TARGETS: dict[str, StyleTarget] = {
    "2d": StyleTarget(motion=4.8, big_per_s=0.65, flat_share=0.27, window_floor=2.0),
    "explainer": StyleTarget(motion=11.0, big_per_s=3.5, flat_share=0.08, window_floor=3.0),
    "voxel": StyleTarget(motion=16.0, big_per_s=5.0, flat_share=0.05, window_floor=5.0),
}


class MotionGateError(RuntimeError):
    """The draft could not be decoded."""


@dataclass
class FlatStretch:
    start: float
    end: float
    words: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"start": round(self.start, 2), "end": round(self.end, 2), "words": self.words}


@dataclass
class MotionReport:
    style: str
    duration: float
    motion: float
    big_per_s: float
    flat_share: float
    changing_share: float
    flat_stretches: list[FlatStretch]
    passed: bool
    reasons: list[str]

    def to_dict(self) -> dict:
        return {"style": self.style, "duration": round(self.duration, 2), "motion": round(self.motion, 2),
                "big_per_s": round(self.big_per_s, 2), "flat_share": round(self.flat_share, 3),
                "changing_share": round(self.changing_share, 3), "passed": self.passed, "reasons": self.reasons,
                "flat_stretches": [s.to_dict() for s in self.flat_stretches]}

    def summary(self) -> str:
        lines = [f"motion {self.motion:.2f}  big/s {self.big_per_s:.2f}  flat {self.flat_share:.0%}  "
                 f"({self.style}: {'PASS' if self.passed else 'FAIL'})"]
        lines += [f"  - {r}" for r in self.reasons]
        for s in self.flat_stretches:
            spoken = f'  "{" ".join(s.words)}"' if s.words else ""
            lines.append(f"  flat {s.start:6.2f}-{s.end:6.2f}s{spoken}")
        return "\n".join(lines)


def _mask_box(mask: Optional[Sequence[float]]) -> Optional[tuple[int, int, int, int]]:
    """(x, y, w, h) as fractions of the frame -> pixel box (x0, y0, x1, y1) in the 108x192 frame."""
    if not mask:
        return None
    x, y, w, h = (min(1.0, max(0.0, float(v))) for v in mask)
    x0, y0 = int(round(x * WIDTH)), int(round(y * HEIGHT))
    x1, y1 = int(round(min(1.0, x + w) * WIDTH)), int(round(min(1.0, y + h) * HEIGHT))
    if x1 <= x0 or y1 <= y0:
        return None
    if (x1 - x0) * (y1 - y0) >= WIDTH * HEIGHT:
        raise ValueError("The mask covers the whole frame.")
    return x0, y0, x1, y1


def step_differences(video: str, mask: Optional[Sequence[float]] = None) -> np.ndarray:
    """Mean absolute difference between consecutive 0.1 s frames (masked region left out)."""
    frame_bytes = WIDTH * HEIGHT
    keep = np.ones((HEIGHT, WIDTH), dtype=bool)
    box = _mask_box(mask)
    if box:
        x0, y0, x1, y1 = box
        keep[y0:y1, x0:x1] = False
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", *VIDEO_GUARD, "-i", video, "-t", str(MAX_SECONDS),
           "-an", "-vf", f"fps={FPS},scale={WIDTH}:{HEIGHT}:flags=area,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    diffs: list[float] = []
    prev: Optional[np.ndarray] = None
    try:
        with media_process(cmd, timeout=1800) as (process, _stderr):
            while True:
                buf = process.stdout.read(frame_bytes)
                if len(buf) < frame_bytes:
                    break
                frame = np.frombuffer(buf, dtype=np.uint8).reshape(HEIGHT, WIDTH).astype(np.int16)
                if prev is not None:
                    diffs.append(float(np.abs(frame - prev)[keep].mean()))
                prev = frame
            process.wait()
            code = process.returncode
    except MediaProcessError:
        raise MotionGateError("The draft video could not be decoded.") from None
    if code != 0 or prev is None:
        raise MotionGateError("The draft video could not be decoded.")
    return np.asarray(diffs, dtype=np.float64)


def _words_in(words: Optional[list[dict]], start: float, end: float) -> list[str]:
    if not words:
        return []
    return [str(w["word"]) for w in words if float(w["start"]) < end and float(w["end"]) > start]


def score_differences(diffs: np.ndarray, style: str = "2d", words: Optional[list[dict]] = None,
                      targets: Optional[StyleTarget] = None) -> MotionReport:
    """The gate's verdict from per-step differences (step i covers i/FPS .. (i+1)/FPS seconds)."""
    target = targets or STYLE_TARGETS.get(style)
    if target is None:
        raise ValueError(f"Unknown style {style!r}; expected one of {', '.join(STYLE_TARGETS)}.")
    diffs = np.asarray(diffs, dtype=np.float64)
    n = len(diffs)
    if n == 0:
        return MotionReport(style, 0.0, 0.0, 0.0, 1.0, 0.0, [], False, ["The draft is too short to measure."])
    duration = n / FPS
    motion = float(diffs.mean())
    big_per_s = float((diffs > BIG_STEP).sum()) / duration
    changing = float((diffs > CHANGE_STEP).mean())

    win = int(round(WINDOW_S * FPS))
    if n <= win:
        means, win = np.array([motion]), n
    else:
        sums = np.cumsum(np.concatenate([[0.0], diffs]))
        means = (sums[win:] - sums[:-win]) / win
    flat = means < target.window_floor
    flat_share = float(flat.mean())

    spans: list[list[float]] = []
    for i in np.flatnonzero(flat):
        a, b = i / FPS, (i + win) / FPS
        if spans and a <= spans[-1][1] + 1e-9:
            spans[-1][1] = b
        else:
            spans.append([a, b])
    stretches = [FlatStretch(a, b, _words_in(words, a, b)) for a, b in spans]

    reasons = []
    if motion < target.motion:
        reasons.append(f"motion {motion:.2f} is under {target.motion}")
    if big_per_s < target.big_per_s:
        reasons.append(f"big steps {big_per_s:.2f}/s are under {target.big_per_s}/s")
    if flat_share > target.flat_share:
        reasons.append(f"{flat_share:.0%} of the video is flat (allowed {target.flat_share:.0%})")
    return MotionReport(style, duration, motion, big_per_s, flat_share, changing, stretches, not reasons, reasons)


def score_video(video: str, style: str = "2d", mask: Optional[Sequence[float]] = None,
                words: Optional[list[dict]] = None) -> MotionReport:
    """Decode and score a draft. `mask` is (x, y, w, h) in frame fractions; `words` is [{word, start, end}]."""
    if style not in STYLE_TARGETS:
        raise ValueError(f"Unknown style {style!r}; expected one of {', '.join(STYLE_TARGETS)}.")
    return score_differences(step_differences(video, mask), style, words)
