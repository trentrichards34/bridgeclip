"""Color grade: one look for the footage only (src/shared/color-grade.ts has the same ids).

The grade is an FFmpeg filter put on the video layer right after it is framed (and after b-roll or a gameplay
background is laid in), before anything is drawn over it: the headline bar, stage scenes, captions, hook text,
extras and the motion graphics all come after, so they keep their own colors.
"""
from __future__ import annotations

from typing import Optional

GRADES = ("none", "warm", "cinematic", "film", "cool", "mono")

# Each grade's filter chain (works on any pixel format FFmpeg can convert; output is the same size and rate).
GRADE_FILTERS = {
    "warm": "colorbalance=rs=0.06:gs=0.01:bs=-0.06:rm=0.04:bm=-0.04,eq=saturation=1.08",
    "cinematic": "colorbalance=rs=-0.04:bs=0.06:rh=0.06:bh=-0.05,eq=contrast=1.08:saturation=0.92",
    "film": "curves=all='0/0.05 0.5/0.5 1/0.95',colorbalance=rm=0.03:bm=-0.03,eq=saturation=0.84",
    "cool": "colorbalance=rs=-0.05:bs=0.07:rm=-0.03:bm=0.04,eq=saturation=0.97",
    "mono": "hue=s=0,eq=contrast=1.06",
}


def parse_grade(value) -> Optional[str]:
    """A grade id from a request: None (or 'none') for no grade; raises ValueError for anything else."""
    if value is None or value == "none":
        return None
    if value not in GRADE_FILTERS:
        raise ValueError("Invalid color grade")
    return value


def grade_filter(grade: Optional[str]) -> str:
    """The FFmpeg filter chain for a grade ('' for none)."""
    grade = parse_grade(grade)
    return GRADE_FILTERS[grade] if grade else ""


def with_grade(graph: str, grade: Optional[str], label: str = "base") -> str:
    """The filter graph with the grade on its single [label] video output (unchanged for none)."""
    chain = grade_filter(grade)
    if not chain:
        return graph
    tag = f"[{label}]"
    if graph.count(tag) != 1:
        raise ValueError("The graph must end its video in one label")
    return graph.replace(tag, f"[{label}_ungraded]") + f";[{label}_ungraded]{chain}{tag}"
