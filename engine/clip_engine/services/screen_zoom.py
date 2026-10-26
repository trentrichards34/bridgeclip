"""Screen-aware zoom: smooth zoom-ins on where a screen recording is busy (Screen Studio style).

Three parts, each usable alone:

- activity (read_activity): every STEP_MS, where the screen changes (frame differencing on a small gray copy of the
  screen area), as a coarse grid of changed pixels; a change over most of the screen (a scroll, a cut, a window
  switch) is marked as a cut, tiny noise is dropped, and spots that change most of the time (a webcam inside the
  recording, a playing video, a clock) are left out. Kept in a small cache file per source and area.
- focus regions (focus_regions): the samples smoothed into stretches where the activity stays in one place long
  enough (dwell), each with its box and the path its center takes.
- zoom moves (plan_zooms, crop_at): for long screen stretches, a zoom toward each region (eased in over EASE_IN_MS,
  decelerating; held while the activity stays; a gentle pan when it moves; eased out when it spreads, ends or the hold
  cap is reached), scaled 1.4-2.2x so the region fills about FILL of the frame, never beyond what the source's
  resolution can show sharply (`max_scale`). The same math runs in the editor's preview (src/shared/screen-zoom.ts).
- the bake (apply_zooms): each move's frames zoomed in Python (OpenCV, sub-pixel), the area's rounded corners and the
  webcam card kept as they were, then laid over the video in one FFmpeg pass.

Shares: boxes are [x, y, w, h] shares of the zoom area (the screen's place in the frame); keys are
[t_ms, cx, cy, scale] (cx, cy: the crop's center in shares of the area).
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import subprocess
import tempfile
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Sequence

logger = logging.getLogger(__name__)

ACTIVITY_VERSION = 1
STEP_MS = 250
# The analysis copy of the screen area and its coarse grid (CELL x CELL pixels per cell).
GRID_W, GRID_H, CELL = 192, 108, 4
COLS, ROWS = GRID_W // CELL, GRID_H // CELL
# A pixel counts as changed past this gray difference (after a light blur: compression noise stays under it).
PIXEL_DIFF = 18
# A cell counts as active with at least this many changed pixels (of CELL * CELL).
CELL_MIN = 2
# More than this share of the area changing at once is a cut, a scroll or a window switch: no focus there.
WHOLE_SHARE = 0.3
# More than this share of the cells active, spread over most of the area: a scroll (a cut too).
SPREAD_CELLS = 0.08
# A cell active in more than this share of the samples is always busy (a webcam, a video, a clock): left out.
PERSISTENT_SHARE = 0.3
PERSISTENT_MIN_SAMPLES = 40

# Focus regions.
GAP_MS = 1000          # idle time a region bridges
FAR_SAMPLES = 3        # samples elsewhere in a row before the focus moves on
MIN_DWELL_MS = 1200    # a region at least this long
MIN_SAMPLES = 3
NEAR_PAD = 0.12        # a sample this close (share of the area) to the region's recent box is still in it
RECENT_SAMPLES = 6     # the region's recent box: its last samples
GROUP_GAP = 0.25       # groups of changes this close (share of the area) to the busiest are one activity
GROUP_WEIGHT = 0.25    # unless they are much smaller than it
TRAVEL = 0.05          # a sample's center this far (share of the area) from the one before: the cursor travelling

# Zoom moves.
EASE_IN_MS = 600
EASE_OUT_MS = 500
PAN_MS = 800
FILL = 0.68            # the region fills about this share of the frame (60-75%)
MIN_SCALE, MAX_SCALE = 1.4, 2.2
GENTLE_SCALE = 1.2     # with a soft source, a zoom this gentle is still allowed (below it: none)
UPSCALE_SLACK = 1.25   # how far past the source's own pixels a zoom may go and stay sharp enough
MAX_SPREAD = 0.62      # a region wider or taller than this share of the area is spread out: no zoom
LEAD_MS = 250          # the zoom starts this long before the activity
TAIL_MS = 500          # and holds this long after it
HOLD_CAP_MS = 9000     # a zoom holds at most this long (then eases out)
COLD_HOLD_CAP_MS = 5000
MIN_MOVE_MS = 1800
FOLLOW_MS = 1200       # a followed region gets a new pan target at most this often
MERGE_GAP_MS = 1500    # a region starting this soon after a zoom's end is panned to instead
BODY_GAP_MS = 8000     # between two zooms' starts after the cold open
COLD_GAP_MS = 4000     # and in the cold open
AFTER_GRAPHIC_MS = 3000  # a zoom starts at least this long after a graphic starts
MAX_ZOOMS = 120
INTENSITY = (0.5, 1.5)
GLOW_MS = 2400         # the glowing box stays this long after the word


# ---------------------------------------------------------------------------
# Activity
# ---------------------------------------------------------------------------

@dataclass
class Activity:
    """Where the screen changes: one coarse grid (ROWS x COLS, changed pixels per cell) per STEP_MS sample."""
    step_ms: int
    start_ms: int
    grids: Any                      # np.ndarray uint8 [n, ROWS, COLS]
    cuts: Any                       # np.ndarray bool [n]
    persistent: Any = None          # np.ndarray bool [ROWS, COLS]

    def __post_init__(self) -> None:
        if self.persistent is None:
            self.persistent = persistent_cells(self.grids, self.cuts)

    @property
    def count(self) -> int:
        return int(self.grids.shape[0])

    def at(self, i: int) -> int:
        return self.start_ms + i * self.step_ms


def persistent_cells(grids, cuts):
    """Cells active in most samples (not counting cuts): a webcam in the recording, a playing video, a clock."""
    import numpy as np
    import cv2
    keep = ~np.asarray(cuts, bool)
    if grids.shape[0] == 0 or keep.sum() < PERSISTENT_MIN_SAMPLES:
        return np.zeros((ROWS, COLS), bool)
    share = (grids[keep] >= CELL_MIN).mean(axis=0)
    # With a cell around each (a moving face's edges change most, its middle less).
    return cv2.dilate((share > PERSISTENT_SHARE).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)


def grid_of(prev, cur) -> tuple[Any, bool]:
    """One sample from two analysis frames (gray, GRID_H x GRID_W, already blurred): changed pixels per cell, and
    whether most of the area changed at once (a cut)."""
    import numpy as np
    changed = np.abs(cur.astype(np.int16) - prev.astype(np.int16)) > PIXEL_DIFF
    share = float(changed.mean())
    grid = changed.reshape(ROWS, CELL, COLS, CELL).sum(axis=(1, 3)).astype(np.uint8)
    if share > WHOLE_SHARE:
        return grid, True
    # A scroll on a sparse page changes little ink, but all over: many active cells spread across most of the area.
    active = grid >= CELL_MIN
    if active.mean() > SPREAD_CELLS:
        ys, xs = np.nonzero(active)
        if (xs.max() - xs.min() + 1) / COLS > 0.6 and (ys.max() - ys.min() + 1) / ROWS > 0.6:
            return grid, True
    return grid, False


def _cache_key(video: str, area: Optional[Sequence[int]], start_ms: int, end_ms: Optional[int], step_ms: int) -> str:
    st = os.stat(video)
    raw = json.dumps([os.path.realpath(video), st.st_size, int(st.st_mtime), list(area) if area else None, start_ms, end_ms, step_ms,
                      ACTIVITY_VERSION, GRID_W, GRID_H, PIXEL_DIFF])
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def read_activity(video: str, area: Optional[Sequence[int]] = None, start_ms: int = 0, end_ms: Optional[int] = None,
                  step_ms: int = STEP_MS, cache_dir: Optional[str] = None, timeout: float = 3600) -> Activity:
    """The activity of `video` inside `area` (x, y, w, h px; None: the whole frame) from start_ms to end_ms, one
    sample per step_ms. One fast pass (FFmpeg crops, samples and shrinks; only small gray frames reach Python), kept in
    `cache_dir` under the file, the area and the window, so the same source is read once."""
    import numpy as np
    from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS, media_process
    path = None
    if cache_dir:
        try:
            os.makedirs(cache_dir, mode=0o700, exist_ok=True)
            path = os.path.join(cache_dir, f"activity-{_cache_key(video, area, start_ms, end_ms, step_ms)}.npz")
            if os.path.isfile(path) and not os.path.islink(path):
                with np.load(path) as data:
                    return Activity(step_ms, start_ms, data["grids"], data["cuts"])
        except (OSError, ValueError, KeyError):
            path = None
    crop = f"crop={int(area[2])}:{int(area[3])}:{int(area[0])}:{int(area[1])}," if area else ""
    seek = ["-ss", f"{start_ms / 1000:.3f}"] if start_ms > 0 else []
    length = ["-t", f"{(end_ms - start_ms) / 1000:.3f}"] if end_ms is not None else []
    cmd = ["ffmpeg", "-nostdin", "-v", "error", *MEDIA_INPUT_OPTIONS, *seek, "-i", video, *length, "-map", "0:v:0", "-an", "-sn", "-dn",
           "-vf", f"{crop}fps={1000 / step_ms:.5f},scale={GRID_W}:{GRID_H}:flags=area,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    import cv2
    size = GRID_W * GRID_H
    grids: list = []
    cuts: list[bool] = []
    prev = None
    with media_process(cmd, timeout=timeout) as (reader, _stderr):
        while True:
            raw = reader.stdout.read(size)
            if len(raw) < size:
                break
            frame = cv2.GaussianBlur(np.frombuffer(raw, np.uint8).reshape(GRID_H, GRID_W), (3, 3), 0)
            if prev is None:
                grids.append(np.zeros((ROWS, COLS), np.uint8))
                cuts.append(False)
            else:
                grid, cut = grid_of(prev, frame)
                grids.append(grid)
                cuts.append(cut)
            prev = frame
    act = Activity(step_ms, start_ms, np.array(grids, np.uint8).reshape(-1, ROWS, COLS), np.array(cuts, bool))
    if path:
        try:
            fd, tmp = tempfile.mkstemp(prefix=".activity-", suffix=".npz", dir=cache_dir)
            with os.fdopen(fd, "wb") as handle:
                np.savez_compressed(handle, grids=act.grids, cuts=act.cuts)
            os.replace(tmp, path)
        except OSError:
            pass
    return act


# ---------------------------------------------------------------------------
# Focus regions
# ---------------------------------------------------------------------------

@dataclass
class Region:
    """A stretch where the activity stays in one place: [start_ms, end_ms), its box (shares of the area), the
    smoothed path of its center [(ms, cx, cy)] and its usual size at any moment (`local`: w, h shares; a card sliding
    across the screen is small at any moment though its box is wide)."""
    start_ms: int
    end_ms: int
    box: tuple[float, float, float, float]
    path: list[tuple[int, float, float]] = field(default_factory=list)
    samples: int = 0
    local: tuple[float, float] = (0.0, 0.0)


def sample_box(grid, persistent) -> Optional[tuple[float, float, float, float]]:
    """Where one sample's activity is (x0, y0, x1, y1 shares), or None when it is idle: the busiest group of active
    cells, with the other groups close to it (a moving window's two edges, a cursor by the text it types) joined in,
    always-busy cells left out, so a far-off clock tick doesn't make one huge box."""
    import cv2
    import numpy as np
    active = (grid >= CELL_MIN) & ~persistent
    if not active.any():
        return None
    joined = cv2.dilate(active.astype(np.uint8), np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(joined, connectivity=8)
    weights = grid.astype(np.float32) * active
    parts = []
    for k in range(1, count):
        w = float(weights[labels == k].sum())
        if w > 0:
            x, y, bw, bh = (int(v) for v in stats[k][:4])
            parts.append((w, [x / COLS, y / ROWS, (x + bw) / COLS, (y + bh) / ROWS], k))
    if not parts:
        return None
    parts.sort(key=lambda p: -p[0])
    box, keep = list(parts[0][1]), [parts[0][2]]
    grown = True
    while grown:
        grown = False
        for w, b, k in parts[1:]:
            if k in keep or w < parts[0][0] * GROUP_WEIGHT:
                continue
            gap = max(b[0] - box[2], box[0] - b[2], b[1] - box[3], box[1] - b[3])
            if gap <= GROUP_GAP:
                box = [min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])]
                keep.append(k)
                grown = True
    ys, xs = np.nonzero(np.isin(labels, keep) & active)
    return float(xs.min() / COLS), float(ys.min() / ROWS), float((xs.max() + 1) / COLS), float((ys.max() + 1) / ROWS)


def _near(box: Sequence[float], s: Sequence[float]) -> bool:
    cx, cy = (s[0] + s[2]) / 2, (s[1] + s[3]) / 2
    return box[0] - NEAR_PAD <= cx <= box[2] + NEAR_PAD and box[1] - NEAR_PAD <= cy <= box[3] + NEAR_PAD


def _percentile(values: Sequence[float], q: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    k = min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))
    return ordered[k]


def _settled(items: list[tuple[int, tuple[float, float, float, float]]]) -> list[tuple[int, tuple[float, float, float, float]]]:
    """The samples where the activity stays put: a sample whose center jumped more than TRAVEL from the one before
    (a cursor gliding across the screen) is travel, not where to zoom."""
    out = []
    for i, (t, b) in enumerate(items):
        if i:
            p = items[i - 1][1]
            if math.hypot((b[0] + b[2] - p[0] - p[2]) / 2, (b[1] + b[3] - p[1] - p[3]) / 2) > TRAVEL:
                continue
        out.append((t, b))
    return out


def _region(items: list[tuple[int, tuple[float, float, float, float]]], end_ms: int) -> Optional[Region]:
    settled = _settled(items)
    # Where it settles: travel before it is left out (the zoom starts when the activity stays).
    while len(settled) > 1 and settled[1][0] - settled[0][0] > 2 * STEP_MS:
        settled = settled[1:]
    if len(settled) >= MIN_SAMPLES:
        items = [x for x in items if x[0] >= settled[0][0]]
    else:
        settled = items
    if len(items) < MIN_SAMPLES or end_ms - items[0][0] < MIN_DWELL_MS:
        return None
    path_items = items
    items = settled
    x0 = _percentile([b[0] for _, b in items], 0.1)
    y0 = _percentile([b[1] for _, b in items], 0.1)
    x1 = _percentile([b[2] for _, b in items], 0.9)
    y1 = _percentile([b[3] for _, b in items], 0.9)
    # The center's path, smoothed over about a second.
    centers = [(t, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2) for t, b in path_items]
    path = []
    for i, (t, _, _) in enumerate(centers):
        near = centers[max(0, i - 2):i + 3]
        path.append((t, sum(c[1] for c in near) / len(near), sum(c[2] for c in near) / len(near)))
    # Its usual size at a moment: the median of what about a second and a half of it covers.
    spans = []
    for i in range(len(items)):
        near = [b for _, b in items[max(0, i - RECENT_SAMPLES + 1):i + 1]]
        spans.append((max(b[2] for b in near) - min(b[0] for b in near), max(b[3] for b in near) - min(b[1] for b in near)))
    local = (sorted(w for w, _ in spans)[len(spans) // 2], sorted(h for _, h in spans)[len(spans) // 2])
    return Region(path_items[0][0], end_ms, (x0, y0, max(x1 - x0, 1 / COLS), max(y1 - y0, 1 / ROWS)), path, len(items),
                  (max(local[0], 1 / COLS), max(local[1], 1 / ROWS)))


def focus_regions(act: Activity, windows: Optional[Sequence[tuple[int, int]]] = None) -> list[Region]:
    """The activity smoothed into focus regions: samples that stay near each other (with idle gaps up to GAP_MS and
    a few stray samples elsewhere) make a region; a cut ends one; a region needs MIN_DWELL_MS and MIN_SAMPLES.
    `windows` (ms): only samples inside them count (screen stretches)."""
    regions: list[Region] = []
    items: list[tuple[int, tuple[float, float, float, float]]] = []
    far: list[tuple[int, tuple[float, float, float, float]]] = []
    box: Optional[list[float]] = None
    last = -10**9

    def close(end: int) -> None:
        nonlocal items, far, box
        r = _region(items, end)
        if r:
            regions.append(r)
        items, far, box = [], [], None

    for i in range(act.count):
        t = act.at(i)
        if windows is not None and not any(a <= t < b for a, b in windows):
            if items:
                close(last + act.step_ms)
            continue
        if act.cuts[i]:
            if items:
                close(last + act.step_ms)
            continue
        s = sample_box(act.grids[i], act.persistent)
        if s is None:
            if items and t - last > GAP_MS:
                close(last + act.step_ms)
            continue
        if items and t - last > GAP_MS:
            close(last + act.step_ms)
        if not items:
            items, box, far = [(t, s)], list(s), []
            last = t
            continue
        if _near(box, s):
            items.extend(far if far and _near(box, far[-1][1]) else [])
            far = []
            items.append((t, s))
            # Compared with where the activity has been lately (not all along), so a region follows a slow move but
            # never swallows the whole screen.
            recent = [b for _, b in items[-RECENT_SAMPLES:]]
            box = [min(b[0] for b in recent), min(b[1] for b in recent), max(b[2] for b in recent), max(b[3] for b in recent)]
            last = t
            continue
        far.append((t, s))
        if len(far) >= FAR_SAMPLES:
            moved = far
            close(far[0][0])
            items = list(moved)
            box = [min(b[0] for _, b in moved), min(b[1] for _, b in moved), max(b[2] for _, b in moved), max(b[3] for _, b in moved)]
            last = moved[-1][0]
    if items:
        close(last + act.step_ms)
    return regions


# ---------------------------------------------------------------------------
# Zoom moves
# ---------------------------------------------------------------------------

def scale_limit(native_px: float, shown_px: float) -> float:
    """The most a zoom may scale and stay sharp: the source's own pixels over the pixels it is shown at, with a little
    slack, within MAX_SCALE (1.0: no zoom)."""
    if native_px <= 0 or shown_px <= 0:
        return 1.0
    return round(max(1.0, min(MAX_SCALE, native_px / shown_px * UPSCALE_SLACK)), 3)


def scale_for(box: Sequence[float], max_scale: float, fill: float = FILL) -> Optional[float]:
    """The zoom for a region box (shares): it fills about `fill` of the frame, 1.4-2.2x, never past `max_scale`; None
    when the region is too spread out or the source too soft for even a gentle zoom."""
    w, h = box[2], box[3]
    if max(w, h) > MAX_SPREAD or max_scale < GENTLE_SCALE:
        return None
    s = fill / max(w, h, 1e-3)
    s = max(MIN_SCALE, min(MAX_SCALE, s))
    return round(min(s, max_scale), 3)


def _clamp_center(c: float, s: float) -> float:
    half = 0.5 / s
    return min(1 - half, max(half, c))


def _inside(t: int, windows: Sequence[tuple[int, int]]) -> Optional[tuple[int, int]]:
    return next(((a, b) for a, b in windows if a <= t < b), None)


def plan_zooms(regions: Sequence[Region], allowed: Sequence[tuple[int, int]], max_scale: float, *,
               blocked: Sequence[tuple[int, int]] = (), graphic_starts: Sequence[int] = (), cold_ms: int = 0,
               body_gap_ms: int = BODY_GAP_MS, cold_gap_ms: int = COLD_GAP_MS, limit: int = MAX_ZOOMS) -> list[dict]:
    """Zoom moves for the focus regions inside `allowed` (ms: the long screen stretches), clear of `blocked` (a
    full-screen card, a punch-in) and paced: a zoom starts AFTER_GRAPHIC_MS after a graphic starts, and at least
    cold_gap / body_gap after the zoom before. A region starting soon after a zoom's hold is panned to (one move,
    two keys) when it fits at a similar scale. Returns [{at_ms, end_ms, keys: [[t, cx, cy, scale], ...], max}]."""
    if max_scale < GENTLE_SCALE:
        return []
    moves: list[dict] = []
    starts = sorted(int(t) for t in graphic_starts)
    last_start = -10**9
    for r in sorted(regions, key=lambda r: r.start_ms):
        if len(moves) >= limit:
            break
        window = _inside(r.start_ms, allowed)
        if window is None:
            continue
        size = r.local if r.local[0] > 0 else (r.box[2], r.box[3])
        s = scale_for((0.0, 0.0, size[0], size[1]), max_scale)
        if s is None:
            continue
        # A region that moves more than the zoomed frame shows is followed (pans along its path).
        moving = r.box[2] * s > 0.9 or r.box[3] * s > 0.9
        cx, cy = r.box[0] + r.box[2] / 2, r.box[1] + r.box[3] / 2
        at = max(window[0], r.start_ms - LEAD_MS)
        cap = COLD_HOLD_CAP_MS if at < cold_ms else HOLD_CAP_MS
        # Pan to it when it follows the last zoom closely (and the zoom has room left under its cap).
        if moves and at - moves[-1]["end_ms"] < MERGE_GAP_MS and _inside(moves[-1]["at_ms"], allowed) == window:
            m = moves[-1]
            prev_s = m["keys"][-1][3]
            room = m["at_ms"] + EASE_IN_MS + cap + EASE_OUT_MS - m["end_ms"]
            if abs(s - prev_s) <= 0.35 and room > 1500:
                s2 = round((s + prev_s) / 2, 3)
                pan_at = max(m["keys"][-1][0] + PAN_MS, r.start_ms - PAN_MS // 2)
                end = min(window[1], r.end_ms + TAIL_MS, m["at_ms"] + EASE_IN_MS + cap + EASE_OUT_MS)
                if end - pan_at >= PAN_MS + EASE_OUT_MS and not any(a < end and b > m["end_ms"] for a, b in blocked):
                    m["keys"].append([int(pan_at), round(_clamp_center(cx, s2), 4), round(_clamp_center(cy, s2), 4), s2])
                    m["end_ms"] = int(end)
                    continue
        gap = cold_gap_ms if at < cold_ms else body_gap_ms
        at = max(at, last_start + gap)
        recent = [g for g in starts if g <= at]
        if recent and at - recent[-1] < AFTER_GRAPHIC_MS:
            at = recent[-1] + AFTER_GRAPHIC_MS
        if moves:
            at = max(at, moves[-1]["end_ms"] + 300)
        end = min(window[1], r.end_ms + TAIL_MS, at + EASE_IN_MS + cap + EASE_OUT_MS)
        for a, b in blocked:
            if a < end and b > at:
                if a - at >= MIN_MOVE_MS:
                    end = a
                else:
                    at = max(at, b)
        if end - at < MIN_MOVE_MS:
            continue
        # Pan along the region's path when it moves while held.
        if moving and r.path:
            cx, cy = next(((px, py) for t, px, py in r.path if t >= at), r.path[-1][1:])
        keys = [[int(at), round(_clamp_center(cx, s), 4), round(_clamp_center(cy, s), 4), s]]
        if moving:
            last_key = keys[0]
            for t, px, py in r.path:
                px, py = round(_clamp_center(px, s), 4), round(_clamp_center(py, s), 4)
                if t - last_key[0] >= FOLLOW_MS and t + PAN_MS + EASE_OUT_MS < end and math.hypot(px - last_key[1], py - last_key[2]) > 0.15 / s:
                    last_key = [int(t), px, py, s]
                    keys.append(last_key)
        moves.append({"at_ms": int(at), "end_ms": int(end), "keys": keys, "max": round(max_scale, 3)})
        last_start = at
    return moves


def _ease_out_cubic(p: float) -> float:
    return 1 - (1 - p) ** 3


def _ease_in_out_cubic(p: float) -> float:
    return 4 * p ** 3 if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2


def _smoothstep(p: float) -> float:
    return p * p * (3 - 2 * p)


def _key_box(cx: float, cy: float, s: float) -> tuple[float, float, float, float]:
    w = 1 / s
    return (min(1 - w, max(0.0, cx - w / 2)), min(1 - w, max(0.0, cy - w / 2)), w, w)


def _lerp_box(a: Sequence[float], b: Sequence[float], p: float) -> tuple[float, float, float, float]:
    return tuple(x + (y - x) * p for x, y in zip(a, b))  # type: ignore[return-value]


def effective_scale(scale: float, intensity: float, max_scale: float) -> float:
    """A key's scale with the member's intensity (0.5-1.5: gentler or stronger), never past the move's max."""
    k = max(INTENSITY[0], min(INTENSITY[1], intensity))
    return max(1.0, min(max_scale, 1 + (scale - 1) * k))


def crop_at(move: dict, t_ms: float) -> tuple[float, float, float, float]:
    """The crop (x, y, w, h shares of the area, w = h = 1 / scale) a move shows at t_ms: the full area outside it;
    eased in over EASE_IN_MS (decelerating), the keys' targets (each pan eased over PAN_MS), eased out over
    EASE_OUT_MS before its end. Boxes are interpolated, so the zoom heads straight for its target."""
    full = (0.0, 0.0, 1.0, 1.0)
    at, end = move["at_ms"], move["end_ms"]
    if t_ms <= at or t_ms >= end or move.get("on") is False:
        return full
    intensity = float(move.get("intensity", 1.0))
    mx = float(move.get("max", MAX_SCALE))
    keys = move["keys"]
    boxes = [_key_box(k[1], k[2], effective_scale(k[3], intensity, mx)) for k in keys]
    target = boxes[0]
    for i in range(1, len(keys)):
        if t_ms <= keys[i][0]:
            break
        p = min(1.0, (t_ms - keys[i][0]) / PAN_MS)
        target = _lerp_box(target, boxes[i], _smoothstep(p))
    length = end - at
    ease_in = min(EASE_IN_MS, length * 0.45)
    ease_out = min(EASE_OUT_MS, length * 0.45)
    if t_ms < at + ease_in:
        return _lerp_box(full, target, _ease_out_cubic((t_ms - at) / ease_in))
    if t_ms > end - ease_out:
        return _lerp_box(target, full, _ease_in_out_cubic((t_ms - (end - ease_out)) / ease_out))
    return target


def glow_at(move: dict, t_ms: float) -> float:
    """How visible a move's glowing box is at t_ms (0..1): it fades in at its word, holds GLOW_MS, fades out."""
    g = move.get("glow")
    if not g or move.get("on") is False:
        return 0.0
    start = int(g.get("at_ms", move["at_ms"]))
    end = min(move["end_ms"] - EASE_OUT_MS, start + GLOW_MS)
    if t_ms < start or t_ms > end:
        return 0.0
    return max(0.0, min(1.0, (t_ms - start) / 250, (end - t_ms) / 300))


# ---------------------------------------------------------------------------
# Validation (the editor project: main checks it too, src/shared/screen-zoom.ts)
# ---------------------------------------------------------------------------

ZOOM_CLIP = r"[a-f0-9]{16}\.mp4"


def _num(v: Any, lo: float, hi: float) -> bool:
    return type(v) in (int, float) and math.isfinite(v) and lo <= v <= hi


def _shares4(v: Any) -> bool:
    return isinstance(v, list) and len(v) == 4 and all(_num(n, 0, 1) for n in v) and v[2] >= 0.01 and v[3] >= 0.01 \
        and v[0] + v[2] <= 1.000001 and v[1] + v[3] <= 1.000001


def validate_zoom_area(raw: Any) -> dict:
    """A project's zoom area: {area, keep?, radius?} (shares of the frame; radius: of the area's height)."""
    if not isinstance(raw, dict) or set(raw) - {"area", "keep", "radius"} or not _shares4(raw.get("area")):
        raise ValueError("Invalid zoom area")
    if raw.get("keep") is not None and not _shares4(raw["keep"]):
        raise ValueError("Invalid zoom area")
    if raw.get("radius") is not None and not _num(raw["radius"], 0, 0.5):
        raise ValueError("Invalid zoom area")
    return raw


def validate_zooms(raw: Any, duration_ms: float) -> list[dict]:
    """A clip's zoom moves (untrusted): sorted, apart, inside the clip, sane keys and scales."""
    import re
    if not isinstance(raw, list) or len(raw) > 200:
        raise ValueError("Invalid zooms")
    previous = -1.0
    for m in raw:
        if not isinstance(m, dict) or set(m) - {"at_ms", "end_ms", "keys", "max", "on", "intensity", "clip", "glow"}:
            raise ValueError("Invalid zoom")
        at, end = m.get("at_ms"), m.get("end_ms")
        if not _num(at, previous, duration_ms) or not _num(end, at + 300, duration_ms) or end - at > 60_000:
            raise ValueError("Invalid zoom")
        previous = end
        if not _num(m.get("max", MAX_SCALE), 1, MAX_SCALE) or not _num(m.get("intensity", 1), *INTENSITY) \
                or type(m.get("on", True)) is not bool:
            raise ValueError("Invalid zoom")
        keys = m.get("keys")
        if not isinstance(keys, list) or not 1 <= len(keys) <= 24:
            raise ValueError("Invalid zoom")
        last = at - 1
        for k in keys:
            if not isinstance(k, list) or len(k) != 4 or not _num(k[0], last + 1, end) or not _num(k[1], 0, 1) \
                    or not _num(k[2], 0, 1) or not _num(k[3], 1, MAX_SCALE):
                raise ValueError("Invalid zoom")
            last = k[0]
        if m.get("clip") is not None and (not isinstance(m["clip"], str) or not re.fullmatch(ZOOM_CLIP, m["clip"])):
            raise ValueError("Invalid zoom")
        g = m.get("glow")
        if g is not None and (not isinstance(g, dict) or set(g) - {"box", "at_ms"} or not _shares4(g.get("box"))
                              or not _num(g.get("at_ms"), at, end)):
            raise ValueError("Invalid zoom")
    return raw


# ---------------------------------------------------------------------------
# The bake: moves made into the picture
# ---------------------------------------------------------------------------

def area_px(share: Sequence[float], width: int, height: int) -> tuple[int, int, int, int]:
    """A share box in even pixels inside the frame."""
    x, y = int(round(share[0] * width / 2)) * 2, int(round(share[1] * height / 2)) * 2
    w = max(2, min(width - x, int(round(share[2] * width / 2)) * 2))
    h = max(2, min(height - y, int(round(share[3] * height / 2)) * 2))
    return x, y, w, h


def area_mask(w: int, h: int, radius: float, keep: Optional[tuple[int, int, int, int]] = None, inset: int = 0):
    """Where the zoomed picture shows inside the area (float 0..1, h x w): the area's rounded rectangle (`inset`
    pixels in from its edge), minus the webcam card (`keep`, px inside the area, with its ring)."""
    import cv2
    import numpy as np
    scale = 4
    big = np.zeros((h * scale, w * scale), np.uint8)
    r = int(max(0, radius) * scale)
    i = inset * scale if radius > 0 else 0
    x0, y0, x1, y1 = i, i, w * scale - 1 - i, h * scale - 1 - i
    if r > 0:
        cv2.rectangle(big, (x0 + r, y0), (x1 - r, y1), 255, -1)
        cv2.rectangle(big, (x0, y0 + r), (x1, y1 - r), 255, -1)
        for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
            cv2.circle(big, (cx, cy), r, 255, -1)
    else:
        big[y0:y1 + 1, x0:x1 + 1] = 255
    if keep:
        kx, ky, kw, kh = keep
        ring = 8
        cv2.rectangle(big, ((kx - ring) * scale, (ky - ring) * scale), ((kx + kw + ring) * scale, (ky + kh + ring) * scale), 0, -1)
    mask = cv2.resize(big, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    return mask[..., None]


def edge_alpha(w: int, h: int, radius: float):
    """The picture-in-picture window's thin light edge (longform.stage_layers draws it over the screen: white at
    EDGE_ALPHA, 2 px), as alpha (h x w x 1), so a zoom can draw it again over the zoomed picture."""
    import cv2
    import numpy as np
    scale = 4
    big = np.zeros((h * scale, w * scale), np.uint8)
    r, t = int(radius * scale), 2 * scale
    x0, y0, x1, y1 = t // 2, t // 2, w * scale - 1 - t // 2, h * scale - 1 - t // 2
    cv2.line(big, (x0 + r, y0), (x1 - r, y0), 255, t)
    cv2.line(big, (x0 + r, y1), (x1 - r, y1), 255, t)
    cv2.line(big, (x0, y0 + r), (x0, y1 - r), 255, t)
    cv2.line(big, (x1, y0 + r), (x1, y1 - r), 255, t)
    for (cx, cy), a in (((x0 + r, y0 + r), 180), ((x1 - r, y0 + r), 270), ((x0 + r, y1 - r), 90), ((x1 - r, y1 - r), 0)):
        cv2.ellipse(big, (cx, cy), (r, r), a, 0, 90, 255, t)
    return (cv2.resize(big, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0 * EDGE_ALPHA)[..., None]


# The window's light edge (longform.stage_layers: white, alpha 34 of 255).
EDGE_ALPHA = 34 / 255


def draw_glow(frame, box_px: Sequence[float], alpha: float, color=(80, 220, 120)) -> None:
    """A glowing rounded box (soft halo and a crisp outline) around box_px (x0, y0, x1, y1) on a BGR frame, in place."""
    import cv2
    import numpy as np
    if alpha <= 0:
        return
    x0, y0, x1, y1 = box_px
    pad = max(6.0, (y1 - y0) * 0.22)
    x0, y0, x1, y1 = int(x0 - pad), int(y0 - pad), int(x1 + pad), int(y1 + pad)
    h, w = frame.shape[:2]
    halo = np.zeros((h, w), np.uint8)
    radius = int(max(6, (y1 - y0) * 0.25))
    thick = max(2, int((y1 - y0) * 0.06))

    def rounded(img, value, t):
        cv2.line(img, (x0 + radius, y0), (x1 - radius, y0), value, t, cv2.LINE_AA)
        cv2.line(img, (x0 + radius, y1), (x1 - radius, y1), value, t, cv2.LINE_AA)
        cv2.line(img, (x0, y0 + radius), (x0, y1 - radius), value, t, cv2.LINE_AA)
        cv2.line(img, (x1, y0 + radius), (x1, y1 - radius), value, t, cv2.LINE_AA)
        for (cx, cy), a in (((x0 + radius, y0 + radius), 180), ((x1 - radius, y0 + radius), 270),
                            ((x0 + radius, y1 - radius), 90), ((x1 - radius, y1 - radius), 0)):
            cv2.ellipse(img, (cx, cy), (radius, radius), a, 0, 90, value, t, cv2.LINE_AA)

    rounded(halo, 255, thick * 4)
    halo = cv2.GaussianBlur(halo, (0, 0), max(3.0, thick * 3.0))
    line = np.zeros((h, w), np.uint8)
    rounded(line, 255, thick)
    a = (np.maximum(halo.astype(np.float32) / 255.0 * 0.85, line.astype(np.float32) / 255.0) * alpha)[..., None]
    tint = np.empty_like(frame)
    tint[:] = color
    frame[:] = (frame.astype(np.float32) * (1 - a) + tint.astype(np.float32) * a).astype(np.uint8)


def intermediate_codec(crf: int = 14, mbps: int = 20) -> list[str]:
    """A high-quality H.264 encoder this FFmpeg has, for files the bake reads again (x264 here; the app's LGPL
    build has OpenH264 or VideoToolbox instead)."""
    from clip_engine.services.broll_library import encoder_args
    args = list(encoder_args())
    if "libx264" in args:
        return ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf), "-pix_fmt", "yuv420p"]
    if "-b:v" in args:
        args[args.index("-b:v") + 1] = f"{mbps}M"
    return [*args, "-pix_fmt", "yuv420p"]


def _frame_reader(path: str, start_s: float, frames: int, vf: str, w: int, h: int):
    from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS
    cmd = ["ffmpeg", "-nostdin", "-v", "error", *MEDIA_INPUT_OPTIONS, "-ss", f"{max(0.0, start_s):.6f}", "-i", path, "-map", "0:v:0",
           "-an", "-sn", "-dn", "-vf", f"{vf}format=bgr24", "-frames:v", str(frames), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    from clip_engine.services.media_process import media_child_env
    return subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=media_child_env()), w * h * 3


def render_move(video: str, move: dict, area: tuple[int, int, int, int], fps: float, out: str, *, clip: Optional[str] = None,
                keep: Optional[tuple[int, int, int, int]] = None, radius: float = 0.0, timeout: float = 3600) -> str:
    """One move's frames: the area of `video` zoomed by crop_at (from `clip`, the same picture at a higher
    resolution cut to the move, when there is one), its corners and the webcam card kept as they were, the glowing box
    drawn when the move has one. Written as an H.264 file the size of the area, starting at the move's first frame."""
    import cv2
    import numpy as np
    from clip_engine.services.media_process import MediaProcessError, media_child_env
    from clip_engine.services.screen_pair import probe
    ax, ay, aw, ah = area
    first = int(round(move["at_ms"] * fps / 1000))
    count = max(1, int(round(move["end_ms"] * fps / 1000)) - first)
    start_s = first / fps
    base, base_bytes = _frame_reader(video, start_s, count, f"crop={aw}:{ah}:{ax}:{ay},", aw, ah)
    src = None
    if clip:
        info = probe(clip)
        nw, nh = int(info["width"]), int(info["height"])
        if nw >= 2 and nh >= 2:
            src, src_bytes = _frame_reader(clip, 0.0, count, "", nw, nh)
    if src is None:
        nw, nh = aw, ah
    mask = area_mask(aw, ah, radius * ah, (keep[0] - ax, keep[1] - ay, keep[2], keep[3]) if keep else None)[..., 0]
    # Only the mask's soft edge is blended; where it is 0 the original shows, where 1 the zoom (fast for big frames).
    hidden = mask <= 0.002
    edge = ~hidden & (mask < 0.998)
    edge_ys, edge_xs = np.nonzero(edge)
    edge_w = mask[edge][:, None]
    plain = not hidden.any() and not edge.any()
    hidden3 = np.repeat(hidden[..., None], 3, axis=2)
    # A rounded window (picture-in-picture) has its light edge drawn again over the zoom.
    rim = edge_alpha(aw, ah, radius * ah) * mask[..., None] if radius > 0 else None
    rim_ys, rim_xs = np.nonzero(rim[..., 0] > 0.002) if rim is not None else (None, None)
    rim_w = rim[rim_ys, rim_xs] if rim is not None else None
    encode = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{aw}x{ah}", "-r", f"{fps:g}",
              "-i", "pipe:0", *intermediate_codec(), out]
    glow = move.get("glow")
    with tempfile.TemporaryFile() as errors:
        writer = subprocess.Popen(encode, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors, env=media_child_env())
        timer = threading.Timer(timeout, lambda: writer.poll() is None and writer.kill())
        timer.daemon = True
        timer.start()
        try:
            native = None
            written = 0
            for n in range(count):
                raw = base.stdout.read(base_bytes)
                if len(raw) < base_bytes:
                    break
                orig = np.frombuffer(raw, np.uint8).reshape(ah, aw, 3)
                if src is not None:
                    more = src.stdout.read(src_bytes)
                    if len(more) == src_bytes:
                        native = np.frombuffer(more, np.uint8).reshape(nh, nw, 3)
                    picture = native if native is not None else orig
                else:
                    picture = orig
                ph, pw = picture.shape[:2]
                t = (first + n) * 1000 / fps
                x, y, w, h = crop_at(move, t)
                if w >= 0.9999 and picture is orig:
                    frame = orig.copy()
                else:
                    # Output pixels per picture pixel; a big downscale goes through a resize first (no aliasing).
                    f = aw / (w * pw)
                    if f < 0.75:
                        r = min(1.0, f * 1.5)
                        picture = cv2.resize(picture, (max(2, int(pw * r)), max(2, int(ph * r))), interpolation=cv2.INTER_AREA)
                        ph, pw = picture.shape[:2]
                    sx, sy, sw, sh = x * pw, y * ph, w * pw, h * ph
                    m = np.array([[sw / aw, 0, sx], [0, sh / ah, sy]], np.float32)
                    zoomed = cv2.warpAffine(picture, m, (aw, ah), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
                    frame = zoomed
                    if not plain:
                        np.copyto(frame, orig, where=hidden3)
                        frame[edge_ys, edge_xs] = (zoomed[edge_ys, edge_xs].astype(np.float32) * edge_w
                                                   + orig[edge_ys, edge_xs].astype(np.float32) * (1 - edge_w)).astype(np.uint8)
                    if rim is not None:
                        frame[rim_ys, rim_xs] = (frame[rim_ys, rim_xs].astype(np.float32) * (1 - rim_w) + 255 * rim_w).astype(np.uint8)
                if glow:
                    a = glow_at(move, t)
                    if a > 0:
                        gx, gy, gw, gh = glow["box"]
                        draw_glow(frame, ((gx - x) / w * aw, (gy - y) / h * ah, (gx + gw - x) / w * aw, (gy + gh - y) / h * ah), a)
                try:
                    writer.stdin.write(frame.tobytes())
                except (BrokenPipeError, OSError):
                    raise MediaProcessError("Writing a zoom failed") from None
                written += 1
            writer.stdin.close()
            writer.wait()
            if writer.returncode or written == 0:
                errors.seek(0)
                logger.warning(f"Zoom encode failed: {errors.read()[-400:]!r}")
                raise MediaProcessError("Writing a zoom failed")
        finally:
            timer.cancel()
            for p in (base, src, writer):
                if p is not None and p.poll() is None:
                    p.kill()
                    p.wait()
            for p in (base, src):
                if p is not None and p.stdout:
                    p.stdout.close()
    return out


def overlay_command(video: str, parts: Sequence[tuple[str, dict]], area: tuple[int, int, int, int], fps: float, out: str,
                    codec: Sequence[str]) -> list[str]:
    """One FFmpeg pass laying each move's frames (render_move) over `video` at the area, each only during its move."""
    from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS
    ax, ay, _, _ = area
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", *MEDIA_INPUT_OPTIONS, "-i", video]
    chains = []
    label = "0:v"
    for n, (path, move) in enumerate(parts, start=1):
        cmd += [*MEDIA_INPUT_OPTIONS, "-i", path]
        first = int(round(move["at_ms"] * fps / 1000)) / fps
        last = int(round(move["end_ms"] * fps / 1000)) / fps
        chains.append(f"[{n}:v]setpts=PTS-STARTPTS+{first:.6f}/TB[z{n}]")
        chains.append(f"[{label}][z{n}]overlay={ax}:{ay}:eof_action=pass:enable='between(t,{first - 0.0005:.4f},{last - 0.0005:.4f})'[v{n}]")
        label = f"v{n}"
    return [*cmd, "-filter_complex", ";".join(chains), "-map", f"[{label}]", "-map", "0:a?", *codec, "-c:a", "copy",
            "-movflags", "+faststart", out]


def active_moves(zooms: Sequence[dict], start_ms: float = 0, end_ms: float = float("inf")) -> list[dict]:
    """The moves that change the picture: on, and inside [start, end)."""
    return [m for m in zooms if m.get("on", True) is not False and m["end_ms"] > start_ms and m["at_ms"] < end_ms]


def apply_zooms(video: str, out: str, zooms: Sequence[dict], zoom: dict, width: int, height: int, fps: float, work: str,
                codec: Sequence[str], clips_dir: Optional[str] = None, run_cmd: Optional[Callable[[list[str]], None]] = None,
                start_ms: float = 0, end_ms: float = float("inf")) -> bool:
    """`video` with its zoom moves made into the picture, written to `out`; False (nothing written) when no move is on.
    `zoom`: the project's zoom area (validate_zoom_area). A move's `clip` (in clips_dir) is the same picture at a
    higher resolution."""
    moves = active_moves(zooms, start_ms, end_ms)
    if not moves:
        return False
    area = area_px(zoom["area"], width, height)
    keep = area_px(zoom["keep"], width, height) if zoom.get("keep") else None
    if keep and not (keep[0] < area[0] + area[2] and keep[0] + keep[2] > area[0] and keep[1] < area[1] + area[3] and keep[1] + keep[3] > area[1]):
        keep = None
    parts = []
    for n, move in enumerate(moves):
        clip = None
        if clips_dir and move.get("clip"):
            path = os.path.join(clips_dir, move["clip"])
            if os.path.isfile(path) and not os.path.islink(path):
                clip = path
        path = os.path.join(work, f"zoom-{n:03d}.mp4")
        render_move(video, move, area, fps, path, clip=clip, keep=keep, radius=float(zoom.get("radius") or 0))
        parts.append((path, move))
    cmd = overlay_command(video, parts, area, fps, out, codec)
    if run_cmd:
        run_cmd(cmd)
    else:
        from clip_engine.services.media_process import run_media
        result = run_media(cmd, timeout=6 * 3600)
        if result.returncode:
            raise RuntimeError("Laying the zooms failed")
    for path, _ in parts:
        try:
            os.remove(path)
        except OSError:
            pass
    return True


# ---------------------------------------------------------------------------
# What the speaker says, found on the screen (optional OCR, screen_text)
# ---------------------------------------------------------------------------

MAX_OCR_FRAMES = 30
GLOW_FILL = 0.42       # a said number or phrase fills about this share of the zoomed frame
GLOW_LEAD_MS = 700     # its zoom starts this long before the word


def said_candidates(timed: Sequence[Sequence[Any]], allowed: Sequence[tuple[int, int]], lines: Sequence[tuple[int, int]] = ()) -> list[tuple[int, str]]:
    """What may be written on the screen as it is said, inside `allowed` (reel ms): every number with two or more
    digits ("$1,227", "31"), and a short run of words from each key line (`lines`); at most MAX_OCR_FRAMES, apart."""
    import re
    out: list[tuple[int, str]] = []
    for w in timed:
        text, start = str(w[0]), int(w[1])
        if len(re.sub(r"[^0-9]", "", text)) >= 2 and _inside(start, allowed):
            out.append((start, text.strip(".,!?;:\"'()")))
    for a, b in lines:
        if not _inside(a, allowed):
            continue
        words = [str(w[0]).strip(".,!?;:\"'()") for w in timed if a <= int(w[1]) < b]
        words = [x for x in words if x]
        # The line's longest run of 2-3 plain words (the likeliest to be on screen as typed).
        best = max((" ".join(words[i:i + n]) for n in (3, 2) for i in range(len(words) - n + 1)), key=len, default="")
        if len(re.sub(r"[^A-Za-z]", "", best)) >= 8:
            start = next(int(w[1]) for w in timed if a <= int(w[1]) < b)
            out.append((start, best))
    out.sort()
    picked: list[tuple[int, str]] = []
    for t, text in out:
        if not picked or t - picked[-1][0] >= 1500:
            picked.append((t, text))
    return picked[:MAX_OCR_FRAMES]


def grab_frame(video: str, t_ms: int, area: tuple[int, int, int, int]):
    """One frame of the area at t_ms (BGR), or None."""
    import numpy as np
    from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS, run_media
    x, y, w, h = area
    result = run_media(["ffmpeg", "-nostdin", "-v", "error", *MEDIA_INPUT_OPTIONS, "-ss", f"{max(0, t_ms) / 1000:.3f}", "-i", video,
                        "-frames:v", "1", "-vf", f"crop={w}:{h}:{x}:{y}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                       timeout=120, max_output=w * h * 3 + 4096)
    data = result.stdout if isinstance(result.stdout, (bytes, bytearray)) else b""
    if result.returncode or len(data) < w * h * 3:
        return None
    return np.frombuffer(data[:w * h * 3], np.uint8).reshape(h, w, 3)


def said_on_screen(video: str, area: tuple[int, int, int, int], candidates: Sequence[tuple[int, str]]) -> list[tuple[int, str, list[float]]]:
    """The candidates found written on the screen as they are said: [(t_ms, text, box shares of the area)]. Empty
    when words can't be read here (screen_text.available)."""
    from clip_engine.services import screen_text
    if not candidates or not screen_text.available():
        return []
    out = []
    _, _, w, h = area
    for t, text in candidates:
        try:
            frame = grab_frame(video, t + 150, area)
            if frame is None:
                continue
            box = screen_text.find_said(screen_text.read(frame), text)
        except Exception as error:  # noqa: BLE001 - reading words is an extra: the zooms go on without it
            logger.warning(f"Reading the screen failed: {type(error).__name__}: {error}")
            return out
        if box:
            x0, y0, x1, y1 = box
            out.append((t, text, [round(x0 / w, 4), round(y0 / h, 4), round(max(4, x1 - x0) / w, 4), round(max(4, y1 - y0) / h, 4)]))
    return out


def glow_moves(found: Sequence[tuple[int, str, Sequence[float]]], max_scale: float, allowed: Sequence[tuple[int, int]]) -> list[dict]:
    """A zoom onto each said number or phrase with a glowing box around it as it is said."""
    moves = []
    for t, _text, box in found:
        window = _inside(t, allowed)
        if window is None:
            continue
        s = min(max_scale, max(MIN_SCALE, min(MAX_SCALE, GLOW_FILL / max(box[2], box[3], 1e-3))))
        s = max(1.0, s)
        at = max(window[0], t - GLOW_LEAD_MS)
        end = min(window[1], t + GLOW_MS + EASE_OUT_MS + 200)
        if end - at < MIN_MOVE_MS:
            continue
        cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
        moves.append({"at_ms": int(at), "end_ms": int(end), "keys": [[int(at), round(_clamp_center(cx, s), 4), round(_clamp_center(cy, s), 4), round(s, 3)]],
                      "max": round(max(1.0, max_scale), 3), "glow": {"box": [round(v, 4) for v in box], "at_ms": int(max(at, t))}})
    return moves


def merge_moves(follow: Sequence[dict], said: Sequence[dict], limit: int = MAX_ZOOMS) -> list[dict]:
    """Activity zooms and said-on-screen zooms together: a said one wins where they overlap; sorted and apart."""
    out = sorted(said, key=lambda m: m["at_ms"])
    for m in follow:
        if not any(m["at_ms"] < s["end_ms"] + 300 and s["at_ms"] < m["end_ms"] + 300 for s in out):
            out.append(m)
    out.sort(key=lambda m: m["at_ms"])
    kept: list[dict] = []
    for m in out:
        if kept and m["at_ms"] < kept[-1]["end_ms"]:
            continue
        kept.append(m)
    return kept[:limit]


def plan_video(video: str, area_share: Sequence[float], width: int, height: int, allowed: Sequence[tuple[int, int]], max_scale: float, *,
               blocked: Sequence[tuple[int, int]] = (), graphic_starts: Sequence[int] = (), cold_ms: int = 0,
               timed: Sequence[Sequence[Any]] = (), key_lines: Sequence[tuple[int, int]] = (), cache_dir: Optional[str] = None,
               limit: int = MAX_ZOOMS) -> list[dict]:
    """The zoom moves for a video: where its screen is busy inside `allowed` (long screen stretches), and (when words
    can be read) onto the numbers and phrases said as they show on the screen, with a glowing box."""
    if not allowed or max_scale < GENTLE_SCALE:
        return []
    area = area_px(area_share, width, height)
    act = read_activity(video, area, cache_dir=cache_dir)
    regions = focus_regions(act, allowed)
    follow = plan_zooms(regions, allowed, max_scale, blocked=blocked, graphic_starts=graphic_starts, cold_ms=cold_ms, limit=limit)
    said = []
    if timed:
        found = said_on_screen(video, area, said_candidates(timed, allowed, key_lines))
        said = [m for m in glow_moves(found, max_scale, allowed) if not any(a < m["end_ms"] and b > m["at_ms"] for a, b in blocked)]
    return merge_moves(follow, said, limit)


# ---------------------------------------------------------------------------
# A sharper picture for the zooms: the screen cut like the video, at its own resolution
# ---------------------------------------------------------------------------

def reel_spans(pieces: Sequence[Any], at_ms: int, end_ms: int, fps: float, to_source: Callable[[Any, float], tuple[str, float]]) -> list[tuple[str, float, int]]:
    """Where the frames [at_ms, end_ms) of a cut video come from: [(file, its time s, frames)] (each kept piece is
    round(seconds * fps) frames, in order; `to_source(piece, s)` maps a time in the piece's take to a file and time)."""
    first, last = int(round(at_ms * fps / 1000)), int(round(end_ms * fps / 1000))
    out: list[tuple[str, float, int]] = []
    f0 = 0
    for p in pieces:
        n = max(1, round(p.seconds * fps))
        a, b = max(first, f0), min(last, f0 + n)
        if a < b:
            path, t = to_source(p, p.start + (a - f0) / fps)
            out.append((path, t, b - a))
        f0 += n
        if f0 >= last:
            break
    return out


def cut_clip(spans: Sequence[tuple[str, float, int]], size: tuple[int, int], fps: float, out: str) -> Optional[str]:
    """The spans joined into one video at `size` (the picture at a higher resolution for a zoom), or None."""
    from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS, run_media
    if not spans:
        return None
    w, h = size
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y"]
    chains = []
    for n, (path, t, frames) in enumerate(spans):
        lead = max(0.0, -t)
        cmd += [*MEDIA_INPUT_OPTIONS, "-ss", f"{max(0.0, t):.6f}", "-i", path]
        chains.append(f"[{n}:v]fps={fps:g},tpad=start_duration={lead:.4f}:start_mode=clone,tpad=stop_mode=clone:stop_duration=2,"
                      f"trim=end_frame={frames},setpts=PTS-STARTPTS,scale={w}:{h}:flags=lanczos,setsar=1,format=yuv420p[p{n}]")
    graph = ";".join(chains) + ";" + "".join(f"[p{n}]" for n in range(len(spans))) + f"concat=n={len(spans)}:v=1:a=0[v]"
    cmd += ["-filter_complex", graph, "-map", "[v]", "-an", *intermediate_codec(16, 16), "-r", f"{fps:g}", out]
    result = run_media(cmd, timeout=1800)
    if result.returncode or not os.path.isfile(out):
        logger.warning(f"A zoom's picture could not be cut: {(result.stderr or b'')[-300:]!r}")
        return None
    return out


def clip_size(native: tuple[int, int], area: tuple[int, int]) -> Optional[tuple[int, int]]:
    """The picture's size for the zooms (even, at most MAX_SCALE times the area, never over the source's own), or None
    when the source is no sharper than the area already shows."""
    nw, nh = native
    aw, ah = area
    if nw <= aw * 1.05 or nh <= ah * 1.05:
        return None
    k = min(nw / aw, nh / ah, MAX_SCALE)
    return max(2, int(aw * k) // 2 * 2), max(2, int(ah * k) // 2 * 2)


def attach_clips(moves: list[dict], folder: str, cut: Callable[[int, int, str], Optional[str]]) -> None:
    """Each move's sharper picture (cut(at_ms, end_ms, path)) saved in `folder` under a random name, kept in the move."""
    os.makedirs(folder, mode=0o700, exist_ok=True)
    for m in moves:
        name = os.urandom(8).hex() + ".mp4"
        try:
            if cut(m["at_ms"], m["end_ms"], os.path.join(folder, name)):
                m["clip"] = name
                continue
        except Exception as error:  # noqa: BLE001 - the zoom then reads the video itself (a little softer)
            logger.warning(f"A zoom's picture could not be cut: {type(error).__name__}: {error}")
        cap_move(m, UPSCALE_SLACK)


def cap_move(move: dict, cap: float) -> dict:
    """A move kept within `cap` (its picture is the video itself: no sharper source)."""
    move["max"] = round(min(float(move.get("max", MAX_SCALE)), cap), 3)
    for k in move["keys"]:
        k[3] = round(max(1.0, min(k[3], move["max"])), 3)
        k[1], k[2] = round(_clamp_center(k[1], k[3]), 4), round(_clamp_center(k[2], k[3]), 4)
    return move


# ---------------------------------------------------------------------------
# A Screen recording window's slow push-in (graphics_overlay.inset_chain): toward where the screen is busy
# ---------------------------------------------------------------------------

# The window's shapes (src/shared/motion-graphics.ts SCREEN_ASPECT).
SCREEN_ASPECT = {"wide": 16 / 9, "square": 1.0, "tall": 4 / 5}
FRAME_FILL = 0.68
FRAME_SIDE = (0.5, 0.85)
FRAME_CONTEXT_MS = 15_000


def view_box(box: Sequence[float], src_w: int, src_h: int, aspect: float) -> tuple[float, float, float, float]:
    """A box (x, y, w, h shares of the source frame) as shares of what the window shows: the source cover-cropped to
    the window's shape, centered."""
    vw, vh = min(src_w, src_h * aspect), min(src_h, src_w / aspect)
    ox, oy = (src_w - vw) / 2, (src_h - vh) / 2
    x0, y0 = (box[0] * src_w - ox) / vw, (box[1] * src_h - oy) / vh
    x1, y1 = ((box[0] + box[2]) * src_w - ox) / vw, ((box[1] + box[3]) * src_h - oy) / vh
    x0, y0, x1, y1 = max(0.0, x0), max(0.0, y0), min(1.0, x1), min(1.0, y1)
    return x0, y0, max(0.0, x1 - x0), max(0.0, y1 - y0)


def frame_zoom_field(video: str, from_ms: int, duration_ms: int, shape: str, cache_dir: Optional[str] = None) -> Optional[str]:
    """A Screen recording window's zoom target ("x, y, w, h" shares of what it shows, the field the editor keeps):
    the region where the screen is busiest while the window plays, filling about FRAME_FILL of it (at most 2x in).
    None when nothing on the screen stands out (the window's gentle centered push-in then)."""
    from clip_engine.services.screen_pair import probe
    info = probe(video)
    if not info["width"] or not info["height"]:
        return None
    # Read with some time around the window, so always-busy spots (a webcam in the recording) show as such.
    start = max(0, int(from_ms) - FRAME_CONTEXT_MS)
    act = read_activity(video, None, start, int(from_ms) + int(duration_ms) + FRAME_CONTEXT_MS, cache_dir=cache_dir)
    window = [(int(from_ms), int(from_ms) + int(duration_ms))]
    regions = [r for r in focus_regions(act, window) if max(r.box[2], r.box[3]) <= MAX_SPREAD]
    if not regions:
        return None
    best = max(regions, key=lambda r: r.samples)
    x, y, w, h = view_box(best.box, int(info["width"]), int(info["height"]), SCREEN_ASPECT.get(shape, 1.0))
    if w <= 0.01 or h <= 0.01:
        return None
    side = min(FRAME_SIDE[1], max(FRAME_SIDE[0], max(w, h) / FRAME_FILL))
    cx, cy = x + w / 2, y + h / 2
    zx, zy = min(1 - side, max(0.0, cx - side / 2)), min(1 - side, max(0.0, cy - side / 2))
    return f"{zx:.3f}, {zy:.3f}, {side:.3f}, {side:.3f}"


def busy_box(video: str, start_ms: int, end_ms: int, cache_dir: Optional[str] = None) -> Optional[tuple[float, float, float, float]]:
    """Where a filmed screen is busiest between two times (x, y, w, h shares of the frame): the focus region with the
    most samples that isn't spread over the whole screen. None when nothing stands out."""
    act = read_activity(video, None, max(0, int(start_ms) - FRAME_CONTEXT_MS), int(end_ms) + FRAME_CONTEXT_MS, cache_dir=cache_dir)
    regions = [r for r in focus_regions(act, [(int(start_ms), int(end_ms))]) if max(r.box[2], r.box[3]) <= MAX_SPREAD]
    if not regions:
        return None
    return tuple(max(regions, key=lambda r: r.samples).box)  # type: ignore[return-value]


def aim_screen_frames(video: str, graphics: Sequence[dict], cache_dir: Optional[str] = None) -> list[dict]:
    """Automatic Screen recording windows of this video's own footage, their push-in aimed at where it is busy."""
    out = []
    for g in graphics:
        f = g.get("fields") or {}
        if g.get("template") == "screen_frame" and g.get("origin") == "auto" and f.get("video") == "source" and not f.get("zoom"):
            try:
                field = frame_zoom_field(video, int(round(float(f.get("from") or 0) * 1000)), int(g["duration_ms"]), f.get("shape") or "square", cache_dir)
            except Exception as error:  # noqa: BLE001 - the centered push-in stays
                logger.warning(f"A screen window's zoom was left centered: {type(error).__name__}: {error}")
                field = None
            if field:
                g = {**g, "fields": {**f, "zoom": field}}
        out.append(g)
    return out
