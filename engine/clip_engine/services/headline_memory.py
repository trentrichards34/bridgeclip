"""Create (Automatic) keeps its clip headlines from run to run.

Running Create again on the same video picks its clips afresh, so the same moment can come out a little longer or
shorter, and the planner writes a new headline for it every time. CreatorClips (main, hook-memory.ts) saves each run's
clip ranges and headlines under the video's fingerprint and hands them back as ``kept_headlines``. A planned clip that
covers at least 60% of a saved clip (and the saved clip at least 60% of it) takes the saved headline again, as long as
that headline still fits what is said in the new clip: every number in it is said there, and at least one of its
words is. Otherwise the planner's new headline stays.
"""
from __future__ import annotations

import re
from typing import Any, Optional, Sequence

from clip_engine.services.edit_recording import norm, unsupported_numbers
from clip_engine.services.intelligence_planner import clean_headline

MAX_KEPT_HEADLINES = 60
MIN_OVERLAP = 0.6
MAX_HEADLINE_CHARS = 120
# Words too common to tie a headline to a clip.
_COMMON = frozenset("""a an and are as at be but by for from has have he her his how i if in into is it its just me my
not of on or our she so that the their them they this to was we were what when who why will with you your""".split())


def clean_kept_headlines(raw: Any) -> list[dict]:
    """The saved headlines as given: [{start_ms, end_ms, headline}], malformed items dropped (at most 60)."""
    kept: list[dict] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        start, end, text = item.get("start_ms"), item.get("end_ms"), item.get("headline")
        if type(start) is not int or type(end) is not int or not 0 <= start < end:
            continue
        if not isinstance(text, str) or len(text) > MAX_HEADLINE_CHARS or "\0" in text:
            continue
        headline = clean_headline(text)
        if headline:
            kept.append({"start_ms": start, "end_ms": end, "headline": headline})
        if len(kept) >= MAX_KEPT_HEADLINES:
            break
    return kept


def range_overlap(a: Sequence[int], b: Sequence[int]) -> float:
    """How much two ranges share, as a share of the longer one (0-1): both must cover most of each other."""
    shared = min(a[1], b[1]) - max(a[0], b[0])
    longest = max(a[1] - a[0], b[1] - b[0])
    return max(0.0, shared) / longest if longest > 0 else 0.0


def matching_kept(start_ms: int, end_ms: int, kept: Sequence[dict]) -> Optional[dict]:
    """The saved clip this range overlaps most, when that is at least MIN_OVERLAP; else None."""
    best, score = None, 0.0
    for item in kept:
        share = range_overlap((start_ms, end_ms), (item["start_ms"], item["end_ms"]))
        if share > score:
            best, score = item, share
    return best if best is not None and score >= MIN_OVERLAP else None


def _keys(text: str) -> set[str]:
    return {norm(t) for t in re.split(r"[\s\-–—/]+", text) if t} - {""}


def fits_clip(headline: str, said: str) -> bool:
    """A kept headline still fits a clip: every number in it is said in the clip, and one of its words is."""
    if unsupported_numbers(headline, said):
        return False
    heard = _keys(said)
    for key in _keys(headline):
        if key in _COMMON or len(key) < 3 or key.isdigit():
            continue
        if {key, key.rstrip("s"), key + "s", key + "es"} & heard:
            return True
    return False


def kept_headline(start_ms: int, end_ms: int, kept: Sequence[dict], said: str) -> Optional[str]:
    """The saved headline for a planned clip (its range and the words said in it), or None to keep the new one."""
    match = matching_kept(start_ms, end_ms, kept)
    if match is None:
        return None
    return match["headline"] if fits_clip(match["headline"], said) else None
