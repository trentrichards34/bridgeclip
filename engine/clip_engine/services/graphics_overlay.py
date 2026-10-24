"""Layer the clip editor's motion graphics over a finished render.

Main draws each graphic with our own templates into a transparent QuickTime
Animation (.mov, ARGB) in the run's ``.graphics/`` folder, and works out where
it plays in the finished clip (output time: through the cut and the export
speed, with cut-out parts dropped). Here each one is placed full-frame over the
clip from its start for its length. The graphic's band already keeps it clear
of the hook and the captions, so there is nothing to position.

A type takeover (depth "between") goes half behind, half in front: its lines above the speaker's chin behind them, the
ones below in front of their chest, over the room softened (depth_fx.takeover_layout; place_between lays it out).

A graphic with depth "behind" sits in the scene, behind the speaker: the clip,
then the graphic, then the speaker cut out of the same frames (the selfie
segmentation matte, segmentation.py) on top, only while it plays. The matte is
made for those windows only, and kept per clip in the graphics folder's
``mattes/`` (named by the clip's bytes and the window), so laying the same clip
again reuses it. Without the cut-out model (or when it fails) the graphic is
laid in front, as before. Words behind the speaker are placed by the matte: at
the graphic's start the top of the head is found, and the block of words moves
(and, when there is no room above, shrinks) so the head covers only the lower
third or so of its last line, never above the band main allowed (``min_top``).

A Screen recording graphic carries an ``inset``: main drew the window with a
see-through hole, and the video (a file the member added, in the graphics
folder's ``videos/``, or the clip's own source at source time) plays under it,
cover-fitted to the hole, with a slow eased zoom and the window's fades.
"""
from __future__ import annotations

import hashlib
import logging
import math
import os
import re
from pathlib import Path
from typing import Iterable, Optional

from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS, run_media

GRAPHICS_DIR = ".graphics"
# Renders made for Edit my recording and Remix (the clip editor's sweep leaves this folder alone).
REEL_DIR = "reel"
RENDER_FILE = re.compile(r"[a-f0-9]{64}\.mov")
MAX_GRAPHICS = 60
# A YouTube video may carry more (auto_graphics.graphics_cap; main checks each video's own cap).
MAX_GRAPHICS_LONG = 180
MIN_MS = 100
# How big main drew a graphic: absent is the usual card; "stage" takes the top ~55% of a 9:16 frame.
SIZES = ("compact", "card", "stage")
# In front of the video (the default), behind the speaker, or between: a type takeover whose upper lines go behind the
# speaker's head and lower lines in front of their chest (depth_fx.takeover_layout), over the room softened.
DEPTHS = ("front", "behind", "between")
# The depths that need the speaker's matte.
MATTED = ("behind", "between")
MATTES_DIR = "mattes"
# Mattes kept per graphics folder (the newest; older ones are removed).
MAX_MATTES = 24
# Mattes for text behind the speaker are cut at a finer size than "Me, on camera" (hair edges over big letters).
BEHIND_MATTE_EDGE = 1280
# Bump when the matte's look changes, so kept mattes are made again.
MATTE_VERSION = 2
VIDEOS_DIR = "videos"
VIDEO_FILE = re.compile(r"[a-f0-9]{16}\.(mp4|mov|m4v|webm)")
# Behind the speaker, the head covers about this much of the last line (from its bottom); moves start outside 25-35%.
HEAD_COVER = 0.3
HEAD_COVER_RANGE = (0.25, 0.35)
# The words are moved down at most this share of the frame, and shrunk to no less than this.
MAX_DROP = 0.12
MIN_SHRINK = 0.4
# Without a band from main, words never go above this share of the frame (platform buttons, the hook).
DEFAULT_MIN_TOP = 0.08
# The inset video plays at this rate (the graphics are drawn at 30 fps too).
INSET_FPS = 30
# The slow zoom: from the window's start (after its fade in) to this share of its length.
ZOOM_END_SHARE = 0.75
# With no zoom target, a gentle push-in to this share of the view, centered.
PUSH_IN = 0.94

logger = logging.getLogger(__name__)


def _shares(value: object, count: int = 4) -> Optional[list[float]]:
    if not isinstance(value, list) or len(value) != count or not all(type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1 for v in value):
        return None
    return [float(v) for v in value]


def checked_inset(run: Path, raw: object, source: Optional[str]) -> dict:
    """A Screen recording's video (untrusted): 'source' (only where the clip's source is known) or a file in the run's
    .graphics/videos/; where it starts; the hole (shares of the frame); an optional zoom target (shares of the view)."""
    if not isinstance(raw, dict) or set(raw) - {"video", "from_ms", "rect", "zoom", "fade_ms"}:
        raise ValueError("Invalid graphic video")
    video, start, fade = raw.get("video"), raw.get("from_ms", 0), raw.get("fade_ms", 300)
    rect, zoom = _shares(raw.get("rect")), _shares(raw.get("zoom")) if raw.get("zoom") is not None else None
    if type(start) is not int or not 0 <= start <= 24 * 3600 * 1000 or type(fade) is not int or not 0 <= fade <= 2000 or rect is None \
            or rect[2] < 0.02 or rect[3] < 0.02 or rect[0] + rect[2] > 1.001 or rect[1] + rect[3] > 1.001:
        raise ValueError("Invalid graphic video")
    if raw.get("zoom") is not None and (zoom is None or zoom[2] <= 0 or zoom[3] <= 0):
        raise ValueError("Invalid graphic video")
    if video == "source":
        if not source:
            raise ValueError("Invalid graphic video")
        path = source
    elif isinstance(video, str) and VIDEO_FILE.fullmatch(video):
        folder = run / GRAPHICS_DIR / VIDEOS_DIR
        path = folder / video
        if folder.is_symlink() or path.is_symlink() or not path.is_file():
            raise ValueError("A graphic's video is missing")
        path = str(path)
    else:
        raise ValueError("Invalid graphic video")
    return {"path": path, "from_ms": start, "rect": rect, **({"zoom": zoom} if zoom else {}), "fade_ms": fade}


def checked_graphics(run: Path, raw: object, clip_ms: int, sub: str = "", source: Optional[str] = None) -> list[dict]:
    """The graphics main asked for, validated: known render files in the run's .graphics/ folder (or `sub` in it),
    inside the clip.

    A graphic past the clip's end is dropped; one running over it is trimmed. An optional "size" ("compact",
    "card" or "stage") is kept so a stage scene can make room for a stage-size graphic; "min_top" (behind the speaker:
    the highest its words may go) and "inset" (a Screen recording's video; `source` is the clip's own video when the
    caller knows it) are checked and kept.
    """
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_GRAPHICS_LONG:
        raise ValueError("Invalid graphics")
    if sub not in ("", REEL_DIR):
        raise ValueError("Invalid graphics folder")
    folder = run / GRAPHICS_DIR
    if folder.is_symlink() or (sub and (folder / sub).is_symlink()):
        raise ValueError("Invalid graphics folder")
    folder = folder / sub if sub else folder
    out = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("Invalid graphic")
        name, start, length = item.get("file"), item.get("start_ms"), item.get("duration_ms")
        if not isinstance(name, str) or not RENDER_FILE.fullmatch(name) or type(start) is not int or type(length) is not int:
            raise ValueError("Invalid graphic")
        # A chapter header can stay for a whole section (motion-graphics.ts CHAPTER_MAX_MS).
        if start < 0 or length < MIN_MS or length > 180_000:
            raise ValueError("Invalid graphic time")
        path = folder / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("A graphic's render is missing")
        size = item.get("size")
        if size is not None and size not in SIZES:
            raise ValueError("Invalid graphic size")
        depth = item.get("depth")
        if depth is not None and depth not in DEPTHS:
            raise ValueError("Invalid graphic depth")
        min_top = item.get("min_top")
        if min_top is not None and not (type(min_top) in (int, float) and math.isfinite(min_top) and 0 <= min_top <= 0.6):
            raise ValueError("Invalid graphic band")
        inset = checked_inset(run, item["inset"], source) if item.get("inset") is not None else None
        if start >= clip_ms - MIN_MS:
            continue
        out.append({"path": str(path), "start_ms": start, "duration_ms": min(length, clip_ms - start), **({"size": size} if size else {}),
                    **({"depth": depth} if depth in MATTED else {}),
                    **({"min_top": float(min_top)} if depth == "behind" and min_top is not None else {}), **({"inset": inset} if inset else {})})
    return sorted(out, key=lambda g: g["start_ms"])


def behind_windows(graphics: Iterable[dict]) -> list[tuple[int, int]]:
    """The output windows (start_ms, end_ms) graphics behind the speaker play in, overlapping ones merged."""
    spans = sorted((g["start_ms"], g["start_ms"] + g["duration_ms"]) for g in graphics if g.get("depth") in MATTED)
    merged: list[tuple[int, int]] = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


def overlay_command(video: str, graphics: Iterable[dict], output: str, width: int, height: int, codec: list[str],
                    mattes: Optional[list[dict]] = None) -> list[str]:
    """FFmpeg: the clip with each graphic laid over it at its time (audio copied).

    `mattes` ([{"path", "start_ms", "duration_ms"}], one per behind window): the graphics behind the speaker go on
    first, then the speaker, cut out of the clip's own frames with each window's matte, then the others. Without
    mattes every graphic is laid over the clip in time order.
    """
    graphics = list(graphics)
    mattes = list(mattes or [])
    if mattes:
        # Behind the speaker first (a takeover's upper lines too); the speaker; then the rest (each group in time order).
        graphics = [g for g in graphics if g.get("depth") in MATTED] + [g for g in graphics if g.get("depth") not in MATTED]
    behind = sum(1 for g in graphics if g.get("depth") in MATTED) if mattes else 0
    # Takeovers: their lower lines go on after the speaker (the split row from place_between; none: all behind).
    between = [(i, g) for i, g in enumerate(graphics[:behind], start=1) if g.get("depth") == "between"]
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", *MEDIA_INPUT_OPTIONS, "-i", video]
    for g in graphics:
        cmd += [*MEDIA_INPUT_OPTIONS, "-i", g["path"]]
    for m in mattes:
        cmd += [*MEDIA_INPUT_OPTIONS, "-i", m["path"]]
    # The clip's own frames for each window, read again from where the window starts (not split off the clip: on a long
    # reel FFmpeg would hold every frame up to a late window in memory).
    for m in mattes:
        cmd += ["-ss", f"{m['start_ms'] / 1000:.3f}", "-t", f"{m['duration_ms'] / 1000:.3f}", *MEDIA_INPUT_OPTIONS, "-i", video]
    # Screen recordings' videos, each from where it starts, a little longer than its window.
    inset_index: dict[int, int] = {}
    next_input = len(graphics) + 2 * len(mattes) + 1
    for i, g in enumerate(graphics, start=1):
        if g.get("inset"):
            inset = g["inset"]
            cmd += ["-ss", f"{inset['from_ms'] / 1000:.3f}", "-t", f"{g['duration_ms'] / 1000 + 1:.3f}", *MEDIA_INPUT_OPTIONS, "-i", inset["path"]]
            inset_index[i] = next_input
            next_input += 1
    # A takeover that shows the speaker smaller: the clip's frames for its window, read again from where it starts
    # (as the mattes' windows are, never split off the clip and held back in memory).
    room_index: dict[int, int] = {}
    for j, (_, g) in enumerate(between):
        if g.get("person") and g.get("layout"):
            cmd += ["-ss", f"{g['start_ms'] / 1000:.3f}", "-t", f"{g['duration_ms'] / 1000 + 0.05:.3f}", *MEDIA_INPUT_OPTIONS, "-i", video]
            room_index[j] = next_input
            next_input += 1
    parts: list[str] = []
    last = "[0:v]"
    if between:
        # The room behind a takeover: blurred and darkened while it plays (the speaker is laid back on crisp).
        from clip_engine.services import depth_fx
        windows = [(g["start_ms"] / 1000, (g["start_ms"] + g["duration_ms"]) / 1000) for _, g in between]
        source = "[0:v]"
        for j, (_, g) in enumerate(between):
            person = g.get("person")
            if not person or not g.get("layout"):
                continue
            # The speaker is shown smaller: so is their room (the shot zoomed out), over a softer copy filling the frame.
            scale, x, y = person
            a, b = g["start_ms"] / 1000, (g["start_ms"] + g["duration_ms"]) / 1000
            sw, sh = even(width * scale), even(height * scale)
            on = f"between(t,{a:.3f},{b:.3f})"
            parts.append(f"[{room_index[j]}:v]setpts=PTS-STARTPTS,scale={sw}:{sh}:flags=bicubic,format=yuva420p,"
                         f"geq=lum='p(X,Y)':a='p(X,Y)*clip(min(min(X,W-1-X),min(Y,H-1-Y))/(W*0.06),0,1)',setpts=PTS+{a:.3f}/TB[rz{j}]")
            # (Softer still behind the smaller shot; the room's one dim comes after, with the rest of the takeover's.)
            parts.append(f"{source}gblur=sigma=24:enable='{on}'[rb{j}]")
            parts.append(f"[rb{j}][rz{j}]overlay={x}:{y}:eof_action=pass:enable='{on}'[rr{j}]")
            source = f"[rr{j}]"
        parts.append(f"{source}{depth_fx.takeover_backdrop_chain(windows)}[room]")
        last = "[room]"
    lower: dict[int, list[tuple[str, str]]] = {}

    def lay(i: int, g: dict) -> None:
        nonlocal last
        start, end = g["start_ms"] / 1000, (g["start_ms"] + g["duration_ms"]) / 1000
        if g.get("depth") == "between" and mattes and g.get("layout"):
            # Each line where the layout put it: those behind the speaker now, the others after them (lower[i]).
            rows = sorted(g["layout"], key=lambda line: line[0])
            parts.append(f"[{i}:v]format=argb,scale={width}:{height},setpts=PTS-STARTPTS+{start:.3f}/TB,split={len(rows)}"
                         + "".join(f"[g{i}_{j}]" for j in range(len(rows))))
            later = []
            for j, (a, b, dst, behind) in enumerate(rows):
                # The band around the line's ink (to halfway to its neighbors), so its arrival from oversize isn't cut.
                lo = 0 if j == 0 else (rows[j - 1][1] + a) // 2
                hi = height if j == len(rows) - 1 else (b + rows[j + 1][0]) // 2
                # A little room around the ink for its arrival from oversize, never into the next line.
                lo, hi = max(0, lo, a - (b - a) // 6), min(height, hi, b + (b - a) // 6)
                lo, hi = lo // 2 * 2, max(lo + 2, hi // 2 * 2)
                parts.append(f"[g{i}_{j}]crop={width}:{hi - lo}:0:{lo}[g{i}c{j}]")
                place = f"overlay=0:{int(dst) - (a - lo)}:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'"
                if behind:
                    parts.append(f"{last}[g{i}c{j}]{place}[v{i}_{j}]")
                    last = f"[v{i}_{j}]"
                else:
                    later.append((f"[g{i}c{j}]", place))
            lower[i] = later
            return
        if g.get("depth") == "between" and mattes:
            # Split at the row between the lines: the upper part now (behind the speaker), the lower part after them;
            # both moved by the graphic's shift (its lines placed around the chin).
            split = max(0, min(height, int(g.get("split", height)))) // 2 * 2
            shift = int(g.get("shift", 0))
            parts.append(f"[{i}:v]format=argb,scale={width}:{height},setpts=PTS-STARTPTS+{start:.3f}/TB[g{i}]")
            if split <= 0:
                lower[i] = [(f"[g{i}]", f"overlay=0:{shift}:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'")]
                return
            if split >= height:
                parts.append(f"{last}[g{i}]overlay=0:{shift}:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'[v{i}]")
                last = f"[v{i}]"
                return
            parts.append(f"[g{i}]split[g{i}u][g{i}l];[g{i}u]crop={width}:{split}:0:0[g{i}a];[g{i}l]crop={width}:{height - split}:0:{split}[g{i}b]")
            parts.append(f"{last}[g{i}a]overlay=0:{shift}:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'[v{i}]")
            last = f"[v{i}]"
            lower[i] = [(f"[g{i}b]", f"overlay=0:{split + shift}:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'")]
            return
        if i in inset_index:
            # The video goes under the window's see-through hole first.
            parts.append(inset_chain(inset_index[i], g, width, height, f"in{i}"))
            x, y, _, _ = inset_box(g["inset"]["rect"], width, height)
            parts.append(f"{last}[in{i}]overlay={x}:{y}:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'[w{i}]")
            last = f"[w{i}]"
        # Shift the graphic to its start, scale it to the frame (renders are made at the output size), keep its alpha.
        place = g.get("place")
        if place and place != (1.0, 0, 0):
            # Moved (and maybe shrunk) to clear the speaker's head: scaled about its own center, then offset.
            s, x, y = place
            parts.append(f"[{i}:v]format=argb,scale={even(width * s)}:{even(height * s)},setpts=PTS-STARTPTS+{start:.3f}/TB[g{i}]")
            parts.append(f"{last}[g{i}]overlay={x}:{y}:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'[v{i}]")
        else:
            parts.append(f"[{i}:v]format=argb,scale={width}:{height},setpts=PTS-STARTPTS+{start:.3f}/TB[g{i}]")
            parts.append(f"{last}[g{i}]overlay=0:0:eof_action=pass:enable='between(t,{start:.3f},{end:.3f})'[v{i}]")
        last = f"[v{i}]"

    for i, g in enumerate(graphics[:behind], start=1):
        lay(i, g)
    for k, m in enumerate(mattes):
        start, end = m["start_ms"] / 1000, (m["start_ms"] + m["duration_ms"]) / 1000
        # The window's own frames with its matte (made smaller: scaled up smoothly) as their alpha, back at the window's time.
        parts.append(f"[{len(graphics) + len(mattes) + 1 + k}:v]trim=duration={end - start:.3f},setpts=PTS-STARTPTS,format=yuva444p[pv{k}]")
        parts.append(f"[{len(graphics) + 1 + k}:v]scale={width}:{height}:flags=bicubic,format=gray,setpts=PTS-STARTPTS[pm{k}]")
        parts.append(f"[pv{k}][pm{k}]alphamerge,setpts=PTS+{start:.3f}/TB[person{k}]")
        # A takeover that shows the speaker smaller: that stretch gets a scaled cut-out (its sides faded) instead.
        small = [(g["start_ms"] / 1000, (g["start_ms"] + g["duration_ms"]) / 1000, g["person"]) for _, g in between
                 if g.get("person") and start <= g["start_ms"] / 1000 < end]
        whole = f"between(t,{start:.3f},{end:.3f})" + "".join(f"*not(between(t,{a:.3f},{b:.3f}))" for a, b, _ in small)
        if small:
            parts.append(f"[person{k}]split={len(small) + 1}[person{k}w]" + "".join(f"[person{k}s{j}]" for j in range(len(small))))
        parts.append(f"{last}[person{k}{'w' if small else ''}]overlay=0:0:eof_action=pass:enable='{whole}'[p{k}]")
        last = f"[p{k}]"
        for j, (a, b, (scale, x, y)) in enumerate(small):
            from clip_engine.services import depth_fx
            sw, sh = even(width * scale), even(height * scale)
            parts.append(f"[person{k}s{j}]scale={sw}:{sh}:flags=bicubic,"
                         f"geq=lum='p(X,Y)':a='{depth_fx.person_fade((scale, x, y), height)}'[ps{k}_{j}]")
            parts.append(f"{last}[ps{k}_{j}]overlay={x}:{y}:eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[p{k}_{j}]")
            last = f"[p{k}_{j}]"
    for i, g in between:
        # A takeover's lower lines, in front of the speaker's chest.
        for j, (stream, place) in enumerate(lower.get(i, [])):
            parts.append(f"{last}{stream}{place}[f{i}_{j}]")
            last = f"[f{i}_{j}]"
    for i, g in enumerate(graphics[behind:], start=behind + 1):
        lay(i, g)
    parts.append(f"{last}format=yuv420p[vout]")
    cmd += ["-filter_complex", ";".join(parts), "-map", "[vout]", "-map", "0:a?", "-c:a", "copy", *codec,
            "-movflags", "+faststart", output]
    return cmd


def even(value: float) -> int:
    return max(2, int(round(value / 2)) * 2)


# How far the inset video reaches under the window's border on each side (hides rounding at the hole's edge).
INSET_BLEED = 2


def inset_box(rect: list[float], width: int, height: int) -> tuple[int, int, int, int]:
    """The inset video's place and size in the frame (pixels): the hole, a little bigger on each side, even sizes."""
    x, y = round(rect[0] * width) - INSET_BLEED, round(rect[1] * height) - INSET_BLEED
    return x, y, even(rect[2] * width + 2 * INSET_BLEED), even(rect[3] * height + 2 * INSET_BLEED)


def _smooth(x: str) -> str:
    return f"(({x})*({x})*(3-2*({x})))"


def inset_chain(index: int, g: dict, width: int, height: int, label: str) -> str:
    """The Screen recording's video: cover-fitted to the window's hole, slowly zoomed (to its target, or a gentle
    centered push-in) with an ease, faded in and out with the window, starting at the graphic's time."""
    inset = g["inset"]
    _, _, w, h = inset_box(inset["rect"], width, height)
    aspect = w / h
    start, length = g["start_ms"] / 1000, g["duration_ms"] / 1000
    fade = min(inset.get("fade_ms", 300) / 1000, length / 3)
    zx, zy, zw, _ = inset.get("zoom") or [(1 - PUSH_IN) / 2, (1 - PUSH_IN) / 2, PUSH_IN, PUSH_IN]
    # Progress of the zoom: after the fade in, done by ZOOM_END_SHARE of the window (eased both ends).
    a, b = fade, max(0.3, length * ZOOM_END_SHARE - fade)
    p = _smooth(f"clip((in/{INSET_FPS}-{a:.3f})/{b:.3f},0,1)")
    zoom = f"1/(1-{1 - zw:.5f}*{p})"
    x, y = f"{zx:.5f}*{p}*iw", f"{zy:.5f}*{p}*ih"
    return (f"[{index}:v]fps={INSET_FPS},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=60,"
            f"crop='min(iw,ih*{aspect:.6f})':'min(ih,iw/{aspect:.6f})',scale={2 * w}:{2 * h}:flags=bicubic,setsar=1,"
            f"zoompan=z='{zoom}':x='{x}':y='{y}':d=1:s={w}x{h}:fps={INSET_FPS},trim=duration={length:.3f},format=yuva420p,"
            f"fade=t=in:st=0:d={fade:.3f}:alpha=1,fade=t=out:st={max(0.0, length - fade):.3f}:d={fade:.3f}:alpha=1,"
            f"setpts=PTS+{start:.3f}/TB[{label}]")


# ---------------------------------------------------------------------------
# Words behind the speaker: placed so the head covers only the lower part of the last line.
# ---------------------------------------------------------------------------

def _frame_alpha(path: str, at_s: float, width: int, height: int, alpha: bool) -> Optional["np.ndarray"]:
    """One frame's alpha (a graphic) or gray (a matte) at `at_s` seconds, at width x height, as a uint8 array."""
    import numpy as np
    from clip_engine.services.media_process import run_media
    vf = f"{'alphaextract,' if alpha else ''}scale={width}:{height}:flags=area,format=gray"
    result = run_media(["ffmpeg", "-nostdin", "-v", "error", *MEDIA_INPUT_OPTIONS, "-ss", f"{max(0.0, at_s):.3f}", "-i", path,
                        "-frames:v", "1", "-vf", vf, "-f", "rawvideo", "-pix_fmt", "gray", "-"], timeout=120, check=True,
                        max_output=width * height + 4096)
    data = result.stdout if isinstance(result.stdout, (bytes, bytearray)) else b""
    if len(data) < width * height:
        return None
    return np.frombuffer(data[:width * height], np.uint8).reshape(height, width)


def text_lines(alpha: "np.ndarray", gap: int = 4, min_h: int = 6) -> list[tuple[int, int]]:
    """The rows (top, bottom) of each line of drawn words in a graphic's alpha: runs of rows with ink, joined across
    gaps of up to `gap` rows, slivers under `min_h` rows left out."""
    ink = (alpha > 96).sum(axis=1) > max(2, alpha.shape[1] // 400)
    runs: list[list[int]] = []
    for y, on in enumerate(ink):
        if not on:
            continue
        if runs and y - runs[-1][1] <= gap + 1:
            runs[-1][1] = y
        else:
            runs.append([y, y])
    return [(a, b + 1) for a, b in runs if b + 1 - a >= min_h]


def head_top(matte: "np.ndarray") -> Optional[int]:
    """The speaker's highest row in a matte (the top of the head), or None when nobody is there."""
    rows = (matte > 128).sum(axis=1) > max(4, matte.shape[1] // 100)
    hits = rows.nonzero()[0]
    return int(hits[0]) if hits.size else None


def text_x_span(alpha: "np.ndarray") -> tuple[int, int]:
    cols = ((alpha > 96).sum(axis=0) > 0).nonzero()[0]
    return (int(cols[0]), int(cols[-1]) + 1) if cols.size else (0, alpha.shape[1])


def behind_place(lines: list[tuple[int, int]], head: Optional[int], height: int, min_top: float,
                 x_span: tuple[int, int] = (0, 0)) -> tuple[float, int, int]:
    """(scale, x, y) for a block of words behind the speaker so the head covers about HEAD_COVER of its last line.

    Words the head covers too much move up (shrunk about their center when there is no room under `min_top`); words
    the head doesn't reach move down a little (at most MAX_DROP of the frame). (1.0, 0, 0) leaves them where they are."""
    if not lines or head is None or head <= min_top * height:
        # Nobody there, or the head reaches above the band (filmed close or cut off at the top): left as drawn.
        return (1.0, 0, 0)
    top, (last_top, last_bottom) = lines[0][0], lines[-1]
    h = last_bottom - last_top
    if h <= 0:
        return (1.0, 0, 0)
    covered = (last_bottom - head) / h
    if HEAD_COVER_RANGE[0] <= covered <= HEAD_COVER_RANGE[1]:
        return (1.0, 0, 0)
    target = last_top + (1 - HEAD_COVER) * h  # where the head should meet the last line
    dy = head - target
    if dy > 0:
        dy = min(dy, MAX_DROP * height)
        return (1.0, 0, round(dy))
    floor = min_top * height
    if top + dy >= floor:
        return (1.0, 0, round(dy))
    # No room above: anchored at the floor, shrunk so the head still meets the last line where it should.
    span = (last_top - top) + (1 - HEAD_COVER) * h
    s = max(MIN_SHRINK, min(1.0, (head - floor) / span)) if span > 0 else 1.0
    cx = (x_span[0] + x_span[1]) / 2 if x_span[1] > x_span[0] else 0
    return (round(s, 4), round(cx * (1 - s)), round(floor - s * top))


def place_behind(graphics: list[dict], mattes: list[dict], width: int, height: int) -> list[dict]:
    """The graphics behind the speaker with a "place" (scale, x, y) worked out from the matte at their start and their
    own drawn words (best effort: a graphic that can't be measured stays where main drew it)."""
    out = []
    for g in graphics:
        if g.get("depth") != "behind" or g.get("inset"):
            out.append(g)
            continue
        try:
            a = g["start_ms"]
            window = next(m for m in mattes if m["start_ms"] <= a < m["start_ms"] + m["duration_ms"])
            # The head where the words land (a little after the start), and the words once they have built.
            matte = _frame_alpha(window["path"], (a - window["start_ms"] + 250) / 1000, width, height, alpha=False)
            words = _frame_alpha(g["path"], min(g["duration_ms"] * 0.6, g["duration_ms"] - 200) / 1000, width, height, alpha=True)
            if matte is None or words is None:
                out.append(g)
                continue
            place = behind_place(text_lines(words, gap=max(4, height // 300), min_h=max(6, height // 160)), head_top(matte), height,
                                 g.get("min_top", DEFAULT_MIN_TOP), text_x_span(words))
            out.append({**g, "place": place} if place != (1.0, 0, 0) else g)
        except Exception as error:  # noqa: BLE001 - placement is a nicety; the words go where main drew them
            logger.warning(f"Words behind the speaker kept their place: {type(error).__name__}: {error}")
            out.append(g)
    return out


# A takeover leaves in its last 140-220 ms (takeover.ts): its lines are measured just before, once every line is in (a
# line arrives as its first word is said, so the last one can come in late in the takeover).
TAKEOVER_EXIT_MS = 260


def takeover_sample_ms(duration_ms: float) -> float:
    """When a takeover's drawn lines are measured: every line in, none leaving yet."""
    return max(min(duration_ms * 0.6, duration_ms - 200), duration_ms - TAKEOVER_EXIT_MS)


def place_between(graphics: list[dict], mattes: list[dict], video: str, width: int, height: int) -> list[dict]:
    """The takeovers (depth "between") with a layout (depth_fx.takeover_layout): each of their lines moved so the ones
    behind the speaker sit above the head and stay readable (checked against the speaker's matte during the takeover)
    and the rest sit in front of the chest; the speaker shown smaller where that makes room. Best effort: a takeover
    that can't be measured, or can't be laid out readably, has every line in front."""
    from clip_engine.services import depth_fx
    from clip_engine.services.look_extras import face_boxes
    out = []
    for g in graphics:
        if g.get("depth") != "between":
            out.append(g)
            continue
        try:
            a, b = g["start_ms"] / 1000, (g["start_ms"] + g["duration_ms"]) / 1000
            face = face_boxes(video, [(a + (b - a) * 0.2, b - (b - a) * 0.2)], (width, height))[0]
            words = _frame_alpha(g["path"], takeover_sample_ms(g["duration_ms"]) / 1000, width, height, alpha=True)
            lines = text_lines(words, gap=max(4, height // 300), min_h=max(6, height // 160)) if words is not None else []
            window = next((m for m in mattes if m["start_ms"] <= g["start_ms"] < m["start_ms"] + m["duration_ms"]), None)
            frames = []
            if window is not None:
                for share in (0.25, 0.55, 0.85):
                    at = (g["start_ms"] + g["duration_ms"] * share - window["start_ms"]) / 1000
                    frame = _frame_alpha(window["path"], at, width, height, alpha=False)
                    if frame is not None:
                        frames.append(frame)
            layout = depth_fx.takeover_layout(lines, words, frames, face, width, height) if words is not None else None
            if layout is None:
                out.append({**g, "split": 0})
                continue
            out.append({**g, "layout": [list(line) for line in layout.lines],
                        **({"person": layout.person} if layout.person != (1.0, 0, 0) else {}),
                        "occlusion": [list(o) for o in layout.occlusion]})
        except Exception as error:  # noqa: BLE001 - the takeover then lies in front of the speaker
            logger.warning(f"Takeover layout not found: {type(error).__name__}: {error}")
            out.append({**g, "split": 0})
    return out


def _file_digest(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _video_rate(video: str) -> tuple[int, int, str]:
    """The clip's frame size and rate ("30000/1001")."""
    import json
    from clip_engine.services.media_process import run_media
    result = run_media(["ffprobe", "-v", "error", *MEDIA_INPUT_OPTIONS, "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,r_frame_rate", "-of", "json", video], timeout=60, check=True)
    stream = json.loads(result.stdout)["streams"][0]
    rate = str(stream.get("r_frame_rate") or "30")
    from clip_engine.services.depth_fx import frame_rate_ok
    if not frame_rate_ok(rate):
        rate = "30"
    return int(stream["width"]), int(stream["height"]), rate


def _prune_mattes(folder: Path, keep: set[str]) -> None:
    try:
        files = sorted((p for p in folder.iterdir() if p.is_file() and not p.is_symlink()), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return
    for path in files[MAX_MATTES:]:
        if path.name not in keep:
            try:
                path.unlink()
            except OSError:
                pass


def behind_mattes(video: str, graphics: list[dict], cache: Optional[Path] = None) -> list[dict]:
    """The speaker's matte for each window a graphic plays behind them: [{"path", "start_ms", "duration_ms"}].

    Made only for those windows, and kept in `cache` (default: the graphics folder's mattes/) under the clip's bytes
    and the window, so the same clip laid again reuses them. Empty (the graphics then go in front) when there is no
    behind graphic, the cut-out model isn't available, or making a matte fails."""
    windows = behind_windows(graphics)
    if not windows:
        return []
    from clip_engine.services import segmentation
    if not segmentation.available():
        logger.warning("Text behind the speaker was laid in front: background removal is not available")
        return []
    try:
        folder = cache or Path(next(g["path"] for g in graphics if g.get("depth") in MATTED)).parent / MATTES_DIR
        if folder.is_symlink():
            raise ValueError("Invalid mattes folder")
        folder.mkdir(mode=0o700, exist_ok=True)
        width, height, rate = _video_rate(video)
        digest = _file_digest(video)[:32]
        out, names = [], set()
        for a, b in windows:
            name = f"{digest}-{a}-{b - a}-v{MATTE_VERSION}.mkv"
            path = folder / name
            names.add(name)
            if path.is_symlink():
                raise ValueError("Invalid matte")
            if not path.is_file() or path.stat().st_size < 64:
                partial = folder / f".tmp-{os.getpid()}-{name}"
                try:
                    segmentation.write_matte(video, str(partial), width, height, rate, start=a / 1000, duration=(b - a) / 1000,
                                             max_edge=BEHIND_MATTE_EDGE, refine=True)
                    os.replace(partial, path)
                finally:
                    if partial.exists():
                        partial.unlink()
            else:
                os.utime(path)
            out.append({"path": str(path), "start_ms": a, "duration_ms": b - a})
        _prune_mattes(folder, names)
        return out
    except Exception as error:  # noqa: BLE001 - the graphics still go on, in front
        logger.warning(f"Text behind the speaker was laid in front: {type(error).__name__}: {error}")
        return []


def overlay_graphics_file(video: str, graphics: list[dict], width: int, height: int, codec: list[str], run_cmd) -> None:
    """Replace `video` with a copy that has the graphics laid over it (`run_cmd` runs the FFmpeg command)."""
    if not graphics:
        return
    output = f"{video}.graphics.mp4"
    mattes = behind_mattes(video, graphics)
    if mattes:
        graphics = place_between(place_behind(graphics, mattes, width, height), mattes, video, width, height)
    try:
        run_cmd(overlay_command(video, graphics, output, width, height, codec, mattes))
        os.replace(output, video)
    finally:
        if os.path.exists(output):
            os.remove(output)


def _duration_s(video: str) -> float:
    result = run_media(["ffprobe", "-v", "error", *MEDIA_INPUT_OPTIONS, "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", video], timeout=60)
    try:
        value = float((result.stdout or b"").decode().strip())
    except ValueError:
        return 0.0
    return value if value > 0 else 0.0


def overlapping(start_ms: int, length_ms: int, windows: Iterable[tuple[float, float]]) -> bool:
    """Whether [start, start + length) (ms) overlaps any of `windows` (seconds)."""
    a, b = start_ms / 1000, (start_ms + length_ms) / 1000
    return any(a < hi and b > lo for lo, hi in windows)


def chunk_commands(video: str, graphics: list[dict], output: str, width: int, height: int, codec: list[str], total_ms: int,
                   fps: float) -> tuple[list[tuple[str, list[str]]], list[str], str]:
    """A long video's graphics laid in chunks (longform.chunk_ranges: cut where no graphic plays), so FFmpeg only ever
    opens one chunk's graphics: [(part file, its command)], the command that joins the parts (stream copy) with the
    video's own sound, and the parts' list file to write. Each chunk starts and ends on a frame."""
    from clip_engine.services.longform import chunk_ranges
    rate = fps if fps > 0 else 30.0
    spans = [(int(g["start_ms"]), int(g["start_ms"]) + int(g["duration_ms"])) for g in graphics]
    frames = [round(a * rate / 1000) for a, _ in chunk_ranges(total_ms, spans)] + [None]
    parts: list[tuple[str, list[str]]] = []
    for k in range(len(frames) - 1):
        a_f, b_f = frames[k], frames[k + 1]
        a_ms = a_f * 1000 / rate
        b_ms = b_f * 1000 / rate if b_f is not None else float("inf")
        inside = [{**g, "start_ms": int(round(g["start_ms"] - a_ms))} for g in graphics if a_ms <= g["start_ms"] < b_ms]
        part = f"{output}.part{k:03d}.mp4"
        cmd = overlay_command(video, inside, part, width, height, codec)
        at = cmd.index("-i")
        cmd[at - len(MEDIA_INPUT_OPTIONS):at - len(MEDIA_INPUT_OPTIONS)] = ["-ss", f"{a_f / rate:.6f}"]
        audio = cmd.index("0:a?")
        cmd[audio - 1:audio + 3] = ["-an"]
        if b_f is not None:
            cmd[-1:-1] = ["-frames:v", str(b_f - a_f)]
        parts.append((part, cmd))
    listing = f"{output}.parts.txt"
    join = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-protocol_whitelist", "file,pipe,fd",
            "-i", listing, *MEDIA_INPUT_OPTIONS, "-i", video, "-map", "0:v", "-map", "1:a?", "-c", "copy", "-movflags", "+faststart", output]
    return parts, join, listing


async def overlay_in_chunks(renderer, video: str, graphics: list[dict], output: str, width: int, height: int, codec: list[str],
                            total_ms: int, fps: float) -> None:
    """overlay_graphics for a long video: chunk by chunk, then joined (see chunk_commands)."""
    parts, join, listing = chunk_commands(video, graphics, output, width, height, codec, total_ms, fps)
    try:
        for part, cmd in parts:
            await renderer._run_cmd(cmd)
        with open(listing, "w", encoding="utf-8") as handle:
            handle.writelines(f"file '{os.path.basename(part)}'\n" for part, _ in parts)
        await renderer._run_cmd(join)
    finally:
        for path in [listing, *(part for part, _ in parts)]:
            if os.path.exists(path):
                os.remove(path)


def _rate(fps: str) -> float:
    try:
        a, _, b = str(fps).partition("/")
        return float(a) / float(b or 1)
    except (TypeError, ValueError, ZeroDivisionError):
        return 30.0


async def overlay_graphics(renderer, video: str, graphics: list[dict]) -> None:
    """Replace `video` with a copy that has the graphics laid over it. A long video (a YouTube video) with nothing behind
    the speaker is done in chunks, so memory stays bounded however long it is."""
    if not graphics:
        return
    import asyncio
    width, height = await renderer._get_video_dimensions(video)
    fps = await renderer._probe_fps(video)
    from clip_engine.services.longform import CHUNK_AFTER_MS
    total_ms = int(round(await asyncio.to_thread(_duration_s, video) * 1000))
    if total_ms > CHUNK_AFTER_MS and not any(g.get("depth") for g in graphics):
        output = f"{video}.graphics.mp4"
        try:
            await overlay_in_chunks(renderer, video, graphics, output, width, height, renderer._video_codec_args(width, height, fps),
                                    total_ms, _rate(fps))
            os.replace(output, video)
        finally:
            if os.path.exists(output):
                os.remove(output)
        return
    mattes = await asyncio.to_thread(behind_mattes, video, graphics)
    if mattes:
        graphics = await asyncio.to_thread(place_behind, graphics, mattes, width, height)
        graphics = await asyncio.to_thread(place_between, graphics, mattes, video, width, height)
    output = f"{video}.graphics.mp4"
    try:
        await renderer._run_cmd(overlay_command(video, graphics, output, width, height, renderer._video_codec_args(width, height, fps), mattes))
        os.replace(output, video)
    finally:
        if os.path.exists(output):
            os.remove(output)


async def overlay_run_clips(run: Path, clips: list, progress=None, palette=None) -> dict:
    """Motion graphics: Auto, after a Create run: lay each clip's rendered graphics over its finished file.

    `clips` is [{clip_index, graphics: [{file, start_ms, duration_ms}], sound?}] from main (start times are the
    finished clip's own). `sound` (sound_design.parse_request: register, music_db, events) mixes sound effects
    that follow what was laid (the same planning and mix as an edited reel's bake), with the member's own sounds
    (`palette`) first. A clip that fails keeps its file as made; the others go on (sound effects that can't be
    mixed leave the clip with its graphics and its own sound). Returns the clip indices done and failed.
    """
    from clip_engine.services.manual_editor import source_info
    from clip_engine.services.rendering_service import RenderingService
    if not isinstance(clips, list) or len(clips) > 100:
        raise ValueError("Invalid clips")
    renderer = RenderingService()
    done, failed, seen = [], [], set()
    for n, item in enumerate(clips):
        index = item.get("clip_index") if isinstance(item, dict) else None
        if type(index) is not int or not 0 <= index <= 999 or index in seen:
            raise ValueError("Invalid clip")
        seen.add(index)
        video = run / f"clip_{index:02d}.mp4"
        ok = False
        try:
            if video.is_symlink() or not video.is_file():
                raise ValueError("The clip is missing")
            clip_ms = round(source_info(video)["duration"])
            sound = run_clip_sound(item.get("sound"), palette)
            await overlay_graphics(renderer, str(video), checked_graphics(run, item.get("graphics"), clip_ms))
            if sound is not None:
                await mix_clip_sounds(run, str(video), sound, clip_ms)
            done.append(index)
            ok = True
        except Exception as error:  # noqa: BLE001 - one clip's graphics never stop the others
            import logging
            logging.getLogger(__name__).warning("Graphics could not be laid over clip %s (%s)", index + 1, type(error).__name__)
            failed.append(index)
        if progress:
            progress(index, ok, n + 1, len(clips))
    return {"done": done, "failed": failed}


def run_clip_sound(raw, palette):
    """A Create clip's sound effects request (None: none); raises ValueError when malformed."""
    if raw is None:
        return None
    from clip_engine.services.sound_design import parse_request
    if not isinstance(raw, dict) or "palette" in raw:
        raise ValueError("Invalid sound")
    return parse_request({**raw, "palette": palette if isinstance(palette, list) else []})


async def mix_clip_sounds(run: Path, video: str, sound, clip_ms: int) -> list:
    """Mix the sound effects into a finished Create clip in place (sound_design.design_in_place: never fails the clip)."""
    import asyncio
    import tempfile
    from clip_engine.services.sound_design import design_in_place
    with tempfile.TemporaryDirectory(prefix=".sounds-", dir=str(run)) as work:
        return await asyncio.to_thread(design_in_place, video, sound, clip_ms, work)
