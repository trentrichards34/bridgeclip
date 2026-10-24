"""Scenes: layout switching on a 9:16 clip, so graphics get a real stage.

Three scenes on the finished clip's clock (OUTPUT time: after the cut and the
export speed, like the graphics main lays over a render):

- ``face``: the normal full-frame framing (the default; gaps between scenes are face).
- ``stage``: a backdrop (soft light-gray gradient, dark charcoal, brand-tinted, a
  brand gradient with a faint square grid, or a soft brand gradient) fills the
  frame; the speaker sits in a big card along the bottom (``rounded``: a rounded
  card with a margin; ``arch``: full width, large rounded top corners, flush with
  the bottom edge)
  (a head-and-shoulders crop around the speaker's detected face, zoomed out over a
  blurred copy when the source is too tight), the top half is free for graphics
  and the captions sit in the band between the two.
- ``visual``: the card is off-screen; the whole frame is backdrop (for a big graphic or inset).

Between scenes the card slides up/down with an ease (~350 ms) and the backdrop
crossfades, through a short camera move (a subtle zoom by default, a whip, or none:
a scene's ``transition``; depth_fx.scene_transitions). In a stage scene the speaker's
head breaks out above the card's top edge (``escape``, on by default) when the face
framing and the cut-out allow it (depth_fx; the escape matte is made for the stage
stretches only and kept between renders). Everything is drawn in the render's single FFmpeg pass: the
backdrops, the card's rounded-corner alpha mask and its shadow are small still
PNG inputs (decoded once and repeated in memory), the slide is an
expression-driven overlay ``y``.

Mirror of src/shared/scenes.ts (field names, limits and geometry).
"""
from __future__ import annotations

import dataclasses
import math
import os
import re
from dataclasses import dataclass
from typing import Callable, Iterable, Optional, Sequence

from PIL import Image, ImageDraw, ImageFilter

from clip_engine.services import depth_fx
from clip_engine.services.depth_fx import DEFAULT_TRANSITION, TRANSITIONS

SCENE_KINDS = ("face", "stage", "visual")
BACKDROPS = ("light", "dark", "brand", "grid", "gradient", "solid")
# The solid backdrop without a brand color: royal blue (motion-graphics.ts DIAGRAM_PANEL), for white line-art diagrams.
SOLID_DEFAULT = "#1F4E9C"
# The speaker card's shape in a stage scene.
CARDS = ("rounded", "arch")
MAX_SCENES = 60
# Shorter than this (after the cut) a scene is dropped; the editor keeps scenes 1.2 s or longer.
MIN_RENDER_SCENE_MS = 300
MIN_SCENE_MS = 1200
TRANSITION_MS = 350

# Geometry at 1080x1920, as shares of the frame (scaled with the output).
CARD_SIDE = 40 / 1080
CARD_BOTTOM = 32 / 1920
# Tall enough for head and shoulders (the card was 0.37 and cut the head on close selfie footage).
CARD_HEIGHT = 0.42
CARD_RADIUS = 48 / 1080
# The arch card: full width, its top where the rounded card's is, these large top corners.
ARCH_RADIUS = 120 / 1080
STAGE_BOTTOM = 0.50
VISUAL_CAPTION_Y = 0.82
# Where the face sits in the card (share of the crop height from its top), and the
# face height assumed in the framed speaker when the plan has no face boxes.
CARD_FACE_Y = 0.42
DEFAULT_FACE_Y = 0.36

BACKDROP_COLORS = {
    "light": ((0xF6, 0xF7, 0xF9), (0xE2, 0xE5, 0xEA)),
    "dark": ((0x2B, 0x2E, 0x34), (0x15, 0x17, 0x1B)),
}
DEFAULT_BRAND = "#3B6BFF"
# Text on a light backdrop: bold, near-black; accent words in a readable blue.
DARK_TEXT = "#111111"
DARK_ACCENT = "#1F5BFF"
# The Highlight box captions' box on a grid or gradient backdrop without a brand color.
DEFAULT_BOX = "#2F5BFF"
# How captions in a scene's band are drawn: dark text (light backdrops), white on a color box (grid and
# gradient backdrops), or the member's own captions (dark backdrop).
CAPTION_MODES = {"light": "light", "brand": "light", "grid": "box", "gradient": "box", "dark": "", "solid": ""}


@dataclass(frozen=True)
class Scene:
    scene: str
    start_ms: int
    end_ms: int
    backdrop: str = "light"
    # stage only: the speaker card's shape.
    card: str = "rounded"
    # stage only: the head may break out above the card's top edge (frame escape; on unless turned off).
    escape: bool = True
    # The camera move into this scene (and out of it, back to face): "slide" (the card's slide alone), "zoom", "whip".
    transition: str = DEFAULT_TRANSITION


def _same_look(a: "Scene", b: "Scene") -> bool:
    return (a.scene, a.backdrop, a.card, a.escape, a.transition) == (b.scene, b.backdrop, b.card, b.escape, b.transition)


def _number(value) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def parse_scenes(raw: object, duration_ms: Optional[int] = None) -> list[Scene]:
    """Scenes from a request (untrusted): checked, sorted, clipped to the clip, overlaps and slivers resolved.

    Raises ValueError on anything malformed. Face scenes are dropped (gaps are face).
    """
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_SCENES:
        raise ValueError("Invalid scenes")
    items: list[Scene] = []
    for item in raw:
        if not isinstance(item, dict) or set(item) - {"scene", "start_ms", "end_ms", "backdrop", "card", "escape", "transition"}:
            raise ValueError("Invalid scene")
        kind, start, end, backdrop = item.get("scene"), item.get("start_ms"), item.get("end_ms"), item.get("backdrop", "light")
        card, escape, transition = item.get("card", "rounded"), item.get("escape", True), item.get("transition", DEFAULT_TRANSITION)
        if kind not in SCENE_KINDS or backdrop not in BACKDROPS or card not in CARDS or not _number(start) or not _number(end) \
                or start < 0 or end <= start or type(escape) is not bool or transition not in TRANSITIONS:
            raise ValueError("Invalid scene")
        items.append(Scene(kind, round(start), round(end), backdrop, card if kind == "stage" else "rounded", escape or kind != "stage",
                           transition))
    return normalize_scenes(items, duration_ms)


def normalize_scenes(scenes: Iterable[Scene], duration_ms: Optional[int] = None, min_ms: int = MIN_RENDER_SCENE_MS) -> list[Scene]:
    """Sorted by start; a later scene wins where two overlap; clipped to [0, duration];
    neighbors with the same scene and backdrop merged; face and too-short scenes dropped."""
    out: list[Scene] = []
    for s in sorted(scenes, key=lambda s: (s.start_ms, s.end_ms)):
        end = s.end_ms if duration_ms is None else min(s.end_ms, duration_ms)
        if end <= s.start_ms:
            continue
        s = dataclasses.replace(s, end_ms=end)
        if out and out[-1].end_ms > s.start_ms:
            prev = out[-1]
            out[-1] = dataclasses.replace(prev, end_ms=s.start_ms)
            if out[-1].end_ms <= out[-1].start_ms:
                out.pop()
        out.append(s)
    merged: list[Scene] = []
    for s in out:
        if s.scene == "face" or s.end_ms - s.start_ms < min_ms:
            continue
        if merged and _same_look(merged[-1], s) and s.start_ms - merged[-1].end_ms <= 1:
            merged[-1] = dataclasses.replace(s, start_ms=merged[-1].start_ms)
        else:
            merged.append(s)
    return merged


def scene_at(scenes: Sequence[Scene], t_ms: float) -> str:
    """The scene at t (face in the gaps)."""
    for s in scenes:
        if s.start_ms <= t_ms < s.end_ms:
            return s.scene
    return "face"


def _extra(scene: str, item) -> dict:
    """A scene's optional fields as kept in a request (only when they differ from the default)."""
    get = (lambda k, d: item.get(k, d)) if isinstance(item, dict) else (lambda k, d: getattr(item, k, d))  # noqa: E731
    card, escape, transition = get("card", "rounded"), get("escape", True), get("transition", DEFAULT_TRANSITION)
    return {**({"card": card} if scene == "stage" and card in CARDS and card != "rounded" else {}),
            **({"escape": False} if scene == "stage" and escape is False else {}),
            **({"transition": transition} if transition in TRANSITIONS and transition != DEFAULT_TRANSITION else {})}


def to_dicts(scenes: Iterable[Scene]) -> list[dict]:
    return [{"scene": s.scene, "start_ms": s.start_ms, "end_ms": s.end_ms, "backdrop": s.backdrop, **_extra(s.scene, s)} for s in scenes]


def output_scenes(source_scenes: Iterable[dict], ranges: Sequence[Sequence[float]], video_speed: float) -> list[tuple[dict, dict]]:
    """Source-time scenes moved onto the finished clip's clock through the cut (`ranges`, source ms) and the
    speed (outputScenes in src/shared/scenes.ts): (source scene, output scene) pairs; face, cut-out and
    too-short ones are left out."""
    out: list[tuple[dict, dict]] = []
    for s in source_scenes or []:
        if not isinstance(s, dict) or s.get("scene") not in ("stage", "visual"):
            continue
        a0, b0 = s.get("start_ms"), s.get("end_ms")
        if not _number(a0) or not _number(b0) or b0 <= a0:
            continue
        before, start, kept = 0.0, None, 0.0
        for a, b in ranges:
            lo, hi = max(a, a0), min(b, b0)
            if hi > lo:
                if start is None:
                    start = before + lo - a
                kept += hi - lo
            before += b - a
        if start is None:
            continue
        lo_ms, hi_ms = round(start / video_speed), round((start + kept) / video_speed)
        if hi_ms - lo_ms >= MIN_RENDER_SCENE_MS:
            out.append((s, {"scene": s["scene"], "start_ms": lo_ms, "end_ms": hi_ms, "backdrop": s.get("backdrop", "light"),
                            **_extra(s["scene"], s)}))
    return out[:MAX_SCENES]


# ---------------------------------------------------------------------------
# Auto-picker (Motion graphics: Auto with Stage layouts on)
# ---------------------------------------------------------------------------

STAGE_PAD_BEFORE_MS = 400
# The stage closes with its graphic (an empty stage after it left read as a dead frame).
STAGE_PAD_AFTER_MS = 0


def suggest_scenes(graphics: Iterable[dict], duration_ms: int, backdrop: str = "light", card: str = "rounded") -> list[dict]:
    """Scenes for a clip from its graphics: 'stage' around each stage-size graphic (EditorGraphic
    ``size == 'stage'``; a missing size is not stage), padded a little either side, with stage
    windows closer than a scene's minimum merged; 'face' everywhere else (gaps shorter than the
    minimum join the stage). Times are on the graphics' own clock, clipped to [0, duration_ms].
    """
    if backdrop not in BACKDROPS or card not in CARDS:
        raise ValueError("Invalid backdrop")
    duration_ms = max(0, int(duration_ms))
    windows: list[list[int]] = []
    for g in graphics or []:
        if not isinstance(g, dict) or g.get("size") != "stage":
            continue
        at, length = g.get("at_ms"), g.get("duration_ms")
        if not _number(at) or not _number(length) or length <= 0:
            continue
        a, b = max(0, round(at) - STAGE_PAD_BEFORE_MS), min(duration_ms, round(at + length) + STAGE_PAD_AFTER_MS)
        if b > a:
            windows.append([a, b])
    windows.sort()
    merged: list[list[int]] = []
    for a, b in windows:
        if merged and a - merged[-1][1] < MIN_SCENE_MS:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    # Stretch short ones to the minimum (inside the clip), then merge again.
    for w in merged:
        if w[1] - w[0] < MIN_SCENE_MS:
            grow = MIN_SCENE_MS - (w[1] - w[0])
            w[0] = max(0, w[0] - grow // 2)
            w[1] = min(duration_ms, w[0] + MIN_SCENE_MS)
            w[0] = max(0, w[1] - MIN_SCENE_MS)
    # A sliver before the first stage, or after the last, joins it.
    if merged and merged[0][0] < MIN_SCENE_MS:
        merged[0][0] = 0
    if merged and duration_ms - merged[-1][1] < MIN_SCENE_MS:
        merged[-1][1] = duration_ms
    final: list[list[int]] = []
    for w in merged:
        if final and w[0] - final[-1][1] < MIN_SCENE_MS:
            final[-1][1] = max(final[-1][1], w[1])
        elif w[1] > w[0]:
            final.append(w)
    out: list[dict] = []
    cursor = 0
    for a, b in final:
        if a > cursor:
            out.append({"scene": "face", "start_ms": cursor, "end_ms": a})
        out.append({"scene": "stage", "start_ms": a, "end_ms": b, "backdrop": backdrop, **({"card": card} if card != "rounded" else {})})
        cursor = b
    if cursor < duration_ms:
        out.append({"scene": "face", "start_ms": cursor, "end_ms": duration_ms})
    return out


# ---------------------------------------------------------------------------
# Geometry and still images
# ---------------------------------------------------------------------------


def even(value: float) -> int:
    return max(2, int(round(value / 2)) * 2)


@dataclass(frozen=True)
class StageGeometry:
    width: int
    height: int
    card_x: int
    card_y: int
    card_w: int
    card_h: int
    radius: int
    shadow_pad: int
    stage_bottom: int
    caption_y: int
    visual_caption_y: int
    # The arch card: full width, from card_y down to the frame's bottom edge, large top corners.
    arch_h: int = 0
    arch_radius: int = 0


def geometry(width: int, height: int) -> StageGeometry:
    side = round(width * CARD_SIDE)
    card_w = even(width - 2 * side)
    card_h = even(height * CARD_HEIGHT)
    card_y = height - round(height * CARD_BOTTOM) - card_h
    stage_bottom = round(height * STAGE_BOTTOM)
    return StageGeometry(
        width, height, (width - card_w) // 2, card_y, card_w, card_h, max(4, round(width * CARD_RADIUS)),
        max(8, round(width * 28 / 1080)), stage_bottom, round((stage_bottom + card_y) / 2), round(height * VISUAL_CAPTION_Y),
        height - card_y, max(6, round(width * ARCH_RADIUS)),
    )


def auto_look(brand: Optional[str]) -> tuple[str, str]:
    """The backdrop and card the automatic Stage layouts use: the brand grid with the arch card when the member
    has a brand color, else the grid in the graphics' own blue (DEFAULT_BOX) with the rounded card: never a flat
    near-white stage."""
    return ("grid", "arch") if isinstance(brand, str) and len(brand) == 7 and brand.startswith("#") else ("grid", "rounded")


def _hex(color: str) -> tuple[int, int, int]:
    color = color.lstrip("#")
    return int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)


def backdrop_colors(backdrop: str, brand: Optional[str] = None) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    """Top and bottom colors of a backdrop's vertical gradient. Brand: the brand color mixed into white (stays light)."""
    if backdrop in BACKDROP_COLORS:
        return BACKDROP_COLORS[backdrop]
    if backdrop == "solid":
        # The color itself, a touch deeper at the bottom.
        r, g, b = _hex(brand if brand and len(brand) == 7 else SOLID_DEFAULT)
        return (r, g, b), (round(r * .86), round(g * .86), round(b * .86))
    r, g, b = _hex(brand if brand and len(brand) == 7 else DEFAULT_BRAND if backdrop == "brand" else DEFAULT_BOX)
    mix = lambda share: tuple(round(255 + (c - 255) * share) for c in (r, g, b))  # noqa: E731
    if backdrop == "grid":
        # Lavender at the top, deepening to the brand color at the bottom (under the speaker card).
        return mix(0.16), mix(0.82)
    if backdrop == "gradient":
        return mix(0.08), mix(0.5)
    return mix(0.10), mix(0.24)


def is_light(backdrop: str) -> bool:
    return backdrop not in ("dark", "solid")


def caption_mode(backdrop: Optional[str]) -> str:
    """How captions in a scene on this backdrop are drawn: "light" (dark text), "box" (white on a color box) or ""."""
    return CAPTION_MODES.get(backdrop or "light", "light")


def draw_backdrop(path: str, width: int, height: int, backdrop: str, brand: Optional[str] = None) -> str:
    """Vertical gradient with a soft glow near the top (no banding: a little dither); the grid backdrop adds a faint
    square grid that fades out toward the bottom."""
    top, bottom = backdrop_colors(backdrop, brand)
    column = Image.new("RGB", (1, 256))
    for y in range(256):
        # The brand backdrops ease into their deep color low in the frame, so the stage stays light.
        p = y / 255 if backdrop not in ("grid", "gradient") else (y / 255) ** 1.6
        column.putpixel((0, y), tuple(round(a + (b - a) * p) for a, b in zip(top, bottom)))
    img = column.resize((width, height), Image.BICUBIC)
    # A faint light pool behind the stage area, so the backdrop isn't flat.
    glow = Image.new("L", (width, height), 0)
    ImageDraw.Draw(glow).ellipse((-width * 0.2, -height * 0.15, width * 1.2, height * 0.55), fill=28 if backdrop == "dark" else 22 if backdrop == "solid" else 60)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=width * 0.18))
    img = Image.composite(Image.new("RGB", (width, height), (255, 255, 255)), img, glow)
    if backdrop == "grid":
        img = _grid(img, width, height)
    noise = Image.effect_noise((width, height), 6).convert("L")
    img = Image.blend(img, Image.merge("RGB", (noise, noise, noise)), 0.015)
    img.save(path, optimize=False, compress_level=1)
    return path


def _grid(img: Image.Image, width: int, height: int) -> Image.Image:
    """A faint white square grid (about 14 cells across), strongest at the top, gone by the bottom."""
    cell = max(8, round(width / 14))
    lines = Image.new("L", (width, height), 0)
    d = ImageDraw.Draw(lines)
    stroke = max(1, round(width / 900))
    x0 = (width % cell) // 2
    for x in range(x0, width, cell):
        d.rectangle((x, 0, x + stroke - 1, height), fill=255)
    for y in range(0, height, cell):
        d.rectangle((0, y, width, y + stroke - 1), fill=255)
    fade = Image.linear_gradient("L").resize((width, height)).point(lambda v: round(70 * (1 - v / 255) ** 1.2))
    alpha = Image.composite(fade, Image.new("L", (width, height), 0), lines)
    return Image.composite(Image.new("RGB", (width, height), (255, 255, 255)), img, alpha)


def draw_mask(path: str, width: int, height: int, radius: int) -> str:
    """Rounded-rectangle alpha mask (gray), drawn at 4x and reduced so the corners are smooth."""
    scale = 4
    big = Image.new("L", (width * scale, height * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, width * scale - 1, height * scale - 1), radius=radius * scale, fill=255)
    big.resize((width, height), Image.LANCZOS).save(path, compress_level=1)
    return path


def draw_arch_mask(path: str, width: int, height: int, radius: int) -> str:
    """The arch card's alpha mask: large rounded top corners, square at the bottom (drawn at 4x and reduced)."""
    scale = 4
    big = Image.new("L", (width * scale, height * scale), 0)
    d = ImageDraw.Draw(big)
    d.rounded_rectangle((0, 0, width * scale - 1, height * scale - 1 + radius * scale * 2), radius=radius * scale, fill=255)
    big.resize((width, height), Image.LANCZOS).save(path, compress_level=1)
    return path


def draw_arch_shadow(path: str, width: int, height: int, radius: int, pad: int) -> str:
    """The arch card's soft shadow: a glow above its top edge (the card sits on the bottom of the frame)."""
    img = Image.new("RGBA", (width + 2 * pad, height + 2 * pad), (0, 0, 0, 0))
    alpha = Image.new("L", img.size, 0)
    ImageDraw.Draw(alpha).rounded_rectangle((pad, pad, pad + width, pad + height + radius * 2), radius=radius, fill=60)
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=pad / 2.2))
    img.putalpha(alpha)
    img.save(path, compress_level=1)
    return path


def draw_shadow(path: str, width: int, height: int, radius: int, pad: int) -> str:
    """The card's soft shadow: a blurred rounded rectangle, a little lower than the card."""
    img = Image.new("RGBA", (width + 2 * pad, height + 2 * pad), (0, 0, 0, 0))
    alpha = Image.new("L", img.size, 0)
    ImageDraw.Draw(alpha).rounded_rectangle((pad, pad + pad // 3, pad + width, pad + height + pad // 3), radius=radius, fill=70)
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=pad / 2.2))
    img.putalpha(alpha)
    img.save(path, compress_level=1)
    return path


# ---------------------------------------------------------------------------
# Timeline on the edited (pre-speed) clock, and the filter graph
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Segment:
    """[start, end) seconds on the edited clock (before the speed-up)."""

    scene: str
    start: float
    end: float
    backdrop: Optional[str]
    card: str = "rounded"
    escape: bool = False
    transition: str = DEFAULT_TRANSITION


def edited_segments(scenes: Sequence[Scene], edited_ms: int, video_speed: float) -> list[Segment]:
    """The whole edited timeline as segments (face in the gaps), from output-clock scenes.

    Output time t plays at edited time t * speed (the composite is sped up last)."""
    total = edited_ms / 1000
    segments: list[Segment] = []
    cursor = 0.0
    for s in scenes:
        a = min(total, s.start_ms * video_speed / 1000)
        b = min(total, s.end_ms * video_speed / 1000)
        if b <= a:
            continue
        if a > cursor + 1e-6:
            segments.append(Segment("face", cursor, a, None))
        segments.append(Segment(s.scene, max(a, cursor), b, s.backdrop, s.card, s.scene == "stage" and s.escape, s.transition))
        cursor = b
    if cursor < total - 1e-6:
        segments.append(Segment("face", cursor, total, None))
    return segments


def _runs(segments: Sequence[Segment], key: Callable[[Segment], object]) -> list[tuple[int, int]]:
    """Index ranges [i, j] of consecutive segments with the same truthy key."""
    runs: list[tuple[int, int]] = []
    for i, seg in enumerate(segments):
        k = key(seg)
        if not k:
            continue
        if runs and runs[-1][1] == i - 1 and key(segments[i - 1]) == k:
            runs[-1] = (runs[-1][0], i)
        else:
            runs.append((i, i))
    return runs


def card_runs(segments: Sequence[Segment], card: Optional[str] = None) -> list[tuple[float, float]]:
    """Edited-clock spans where the speaker card is up (consecutive stage segments; with `card`, only that shape's)."""
    if card is None:
        return [(segments[i].start, segments[j].end) for i, j in _runs(segments, lambda s: s.scene == "stage")]
    return [(segments[i].start, segments[j].end) for i, j in _runs(segments, lambda s: s.scene == "stage" and s.card == card)]


def backdrop_windows(segments: Sequence[Segment], transition: float) -> list[dict]:
    """Each run of one backdrop: when it shows, and whether it fades in and out.

    A transition starts at the scene boundary and lasts `transition` seconds. A backdrop
    followed by another stays fully up through the next one's fade-in (that one is drawn over it).
    """
    total = segments[-1].end if segments else 0.0
    windows = []
    for i, j in _runs(segments, lambda s: s.backdrop if s.scene != "face" else None):
        a, b = segments[i].start, segments[j].end
        nxt = segments[j + 1] if j + 1 < len(segments) else None
        windows.append({
            "backdrop": segments[i].backdrop, "start": a, "end": min(total, b + transition) if nxt else b,
            "fade_in": a > 1e-6, "fade_out": bool(nxt and nxt.scene == "face"), "boundary": b,
        })
    return windows


def _smooth(x: str) -> str:
    return f"(({x})*({x})*(3-2*({x})))"


def card_visibility_expr(runs: Sequence[tuple[float, float]], total: float, transition: float) -> str:
    """0..1 of t: how far the card is up (smoothstep in at a run's start, out at its end)."""
    terms = []
    for a, b in runs:
        rise = "1" if a <= 1e-6 else _smooth(f"clip((t-{a:.4f})/{transition:.4f},0,1)")
        fall = "0" if b >= total - 1e-6 else _smooth(f"clip((t-{b:.4f})/{transition:.4f},0,1)")
        terms.append(f"({rise}-{fall})")
    return "+".join(terms) if terms else "0"


# The hook text (top of the frame) hands over to the stage when the first stage or visual scene starts, so the
# stage's graphics never sit under it, unless that is in the clip's first seconds (then the hook keeps its time and
# the graphics keep below it). The editor's preview and graphic layout mirror this (scenes.ts stageHookEndMs).
HOOK_STAGE_MIN_MS = 2500


def hook_hand_over_s(segments: Sequence[Segment], video_speed: float) -> Optional[float]:
    """When (edited clock, seconds) the hook fades out for the first stage or visual scene, or None."""
    first = next((s for s in segments if s.scene != "face"), None)
    if first is None or first.start / video_speed * 1000 < HOOK_STAGE_MIN_MS - 0.5:
        return None
    return first.start


def card_enable_expr(runs: Sequence[tuple[float, float]], transition: float) -> str:
    return "+".join(f"between(t,{max(0.0, a):.4f},{b + transition:.4f})" for a, b in runs) or "0"


def crop_y_expr(runs: Sequence[tuple[float, float]], values: Sequence[int]) -> str:
    """The card crop's top per run (held through the run's slide-out)."""
    if not values:
        return "0"
    expr = f"{values[-1]}"
    for k in range(len(runs) - 2, -1, -1):
        # Switch halfway between this run's end and the next one's start (the card is down then).
        boundary = (runs[k][1] + runs[k + 1][0]) / 2
        expr = f"if(lt(t,{boundary:.4f}),{values[k]},{expr})"
    return expr


# ---------------------------------------------------------------------------
# The speaker card's framing: head and shoulders around the detected face
# ---------------------------------------------------------------------------

# The head around a detected face box (YuNet boxes run from the forehead to the chin), as shares of the face box:
# hair above it (generous: real hair usually ends ~0.3 above), the chin and neck below, a little either side.
HEAD_ABOVE = 0.6
HEAD_BELOW = 0.15
HEAD_SIDE = 0.15
# The head's top (with that hair allowance) sits at least this share of the card's height below the card's top edge:
# the hair itself then ends ~12-15% below it (real hair usually ends ~0.3 face heights above the box).
HEAD_MARGIN = 0.01
# The eye line inside a face box (share of its height from its top), and where the card puts it (share of the card).
EYE_IN_FACE = 0.35
CARD_EYE_Y = 0.36
# The card's crop height in face heights: never tighter than CARD_FACE_MIN (the whole head with room above and the
# shoulders starting below); a speaker far from the camera is brought in no closer than CARD_FACE_MAX.
CARD_FACE_MIN = 2.3
CARD_FACE_MAX = 4.0
# The closest a narrowed card comes in (MIN_CARD_SHARE) before a blur fills its sides: the head box (1.75 face
# heights) with a little room.
CARD_FACE_FLOOR = 1.9
# The face size a stretch is framed for: a high percentile over it, so leaning in stays inside the card.
CARD_FACE_PERCENTILE = 0.8
# Faces for the card are looked at every half second of a stage scene (when the plan has fewer); the path is
# smoothed (median of 5, then a mean of 3) and keyframed where it bends more than CARD_KEY_TOLERANCE of the crop.
CARD_SAMPLE_MS = 500
CARD_MEDIAN = 5
CARD_KEY_TOLERANCE = 0.012
# The plan's own face samples are enough when they come at least this often.
CARD_PLAN_SAMPLE_MS = 1500
MAX_CARD_SAMPLES = 480
# The narrowest the card gets (share of its full width). The card stays full width, as in the pro references (a card
# across the frame, the stage visual over it): a close selfie is brought in closer (down to CARD_FACE_FLOOR face heights,
# the head still whole) and, only when even that is wider than the video, its sides are a blurred copy of it.
MIN_CARD_SHARE = 1.0
# Long side of the frames the card's faces are found in.
CARD_DETECT_PX = 480

Rect4 = tuple[float, float, float, float]


@dataclass(frozen=True)
class CardCrop:
    """The card's crop in source pixels: a fixed size for a stretch, its top-left over window time (ms) as keyframes.

    It may reach past `bounds` (the speaker's part of the source) when the speaker is filmed too close for a
    head-and-shoulders card: the card then zooms out and the rest is a blurred copy of the source.
    """

    w: float
    h: float
    keys: tuple[tuple[int, float, float], ...]
    bounds: Rect4
    # Frame escape: source pixels above the crop drawn as a strip over the card's top edge (0: none).
    ext: float = 0.0

    @property
    def zoomed_out(self) -> bool:
        bx, by, bw, bh = self.bounds
        return any(x < bx - 0.5 or y < by - 0.5 or x + self.w > bx + bw + 0.5 or y + self.h > by + bh + 0.5
                   for _, x, y in self.keys)

    def at(self, t_ms: float) -> tuple[float, float]:
        """The crop's top-left at window time t (linear between keys, held past either end)."""
        keys = self.keys
        if t_ms <= keys[0][0]:
            return keys[0][1], keys[0][2]
        for (t0, x0, y0), (t1, x1, y1) in zip(keys, keys[1:]):
            if t_ms < t1:
                p = (t_ms - t0) / max(1, t1 - t0)
                return x0 + (x1 - x0) * p, y0 + (y1 - y0) * p
        return keys[-1][1], keys[-1][2]


def head_box(face: Rect4) -> Rect4:
    """The whole head (hair to chin) around a face box (x, y, w, h)."""
    x, y, w, h = face
    return x - w * HEAD_SIDE, y - h * HEAD_ABOVE, w * (1 + 2 * HEAD_SIDE), h * (1 + HEAD_ABOVE + HEAD_BELOW)


def _percentile(values: Sequence[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))]


def _median_filter(values: Sequence[float], n: int) -> list[float]:
    half = n // 2
    return [sorted(values[max(0, i - half):i + half + 1])[len(values[max(0, i - half):i + half + 1]) // 2] for i in range(len(values))]


def _mean3(values: Sequence[float]) -> list[float]:
    return [sum(values[max(0, i - 1):i + 2]) / len(values[max(0, i - 1):i + 2]) for i in range(len(values))]


def _simplify(points: list[tuple[int, float, float]], tolerance: float) -> list[tuple[int, float, float]]:
    """Douglas-Peucker on (t, x, y): keyframes where the path bends more than `tolerance` pixels."""
    if len(points) <= 2:
        return points
    (t0, x0, y0), (t1, x1, y1) = points[0], points[-1]
    worst, at = -1.0, 0
    for i in range(1, len(points) - 1):
        t, x, y = points[i]
        p = (t - t0) / max(1, t1 - t0)
        d = max(abs(x - (x0 + (x1 - x0) * p)), abs(y - (y0 + (y1 - y0) * p)))
        if d > worst:
            worst, at = d, i
    if worst <= tolerance:
        return [points[0], points[-1]]
    return _simplify(points[:at + 1], tolerance)[:-1] + _simplify(points[at:], tolerance)


def card_crop(faces: Sequence[tuple[int, Rect4]], bounds: Rect4, aspect: float, start_ms: int = 0, min_share: float = 0.0) -> CardCrop:
    """The card's crop for one stretch: head and shoulders around the speaker's face, smoothed over time.

    `faces`: (window ms, face box) in source pixels, the speaker's face in each sample; `bounds`: the speaker's
    part of the source (x, y, w, h); `aspect`: the card's width / height. The crop is sized for the face (never
    tighter than CARD_FACE_MIN face heights, no looser than CARD_FACE_MAX or the largest crop inside `bounds`,
    whichever is tighter), keeps the head's top HEAD_MARGIN of the card below its edge and the eyes near
    CARD_EYE_Y; when the source is too tight for that it reaches past `bounds` (zoomed out) instead of
    cutting the head. `min_share`: the narrowest card (share of its full width, card_width); a crop whose video
    would come out narrower is brought in to fill that much, as long as the head still fits (CARD_FACE_FLOOR).
    """
    bx, by, bw, bh = bounds
    fit_h = min(bh, bw / aspect)
    if not faces:
        # No face seen (a screen, or a face the detector missed): the upper part of the speaker's area (heads are
        # high in a frame), at least half its height (zoomed out a little when it is narrow).
        ch = min(bh, max(fit_h, bh * 0.5))
        cw = ch * aspect
        return CardCrop(cw, ch, ((start_ms, bx + (bw - cw) / 2, by + (bh - ch) * 0.1),), bounds)
    face_h = _percentile([f[3] for _, f in faces], CARD_FACE_PERCENTILE)
    ch = max(min(fit_h, CARD_FACE_MAX * face_h), CARD_FACE_MIN * face_h)
    if min_share > 0 and ch * aspect > bw:
        # The card narrows to the video; not below min_share of its width while the head fits closer in.
        ch = min(ch, max(bw / (min_share * aspect), CARD_FACE_FLOOR * face_h))
    cw = ch * aspect
    # Wider than the speaker's area: the area centered (the card narrows to it, card_width), else follow the face.
    x_lo, x_hi = (bx, bx + bw - cw) if cw <= bw else (bx + (bw - cw) / 2, bx + (bw - cw) / 2)
    y_lo, y_hi = (by, by + bh - ch) if ch <= bh else (by + bh - ch, by)
    times, xs, ys, tops = [], [], [], []
    for t, face in sorted(faces):
        fx, fy, fw, fh = face
        _, hy, _, hh = head_box(face)
        top = hy - HEAD_MARGIN * ch  # the crop's top may not be lower than this (the head's room)
        y = min(fy + EYE_IN_FACE * fh - CARD_EYE_Y * ch, top)
        # The chin inside too, unless the head is taller than the card can hold (then the top wins).
        y = min(max(y, hy + hh - ch), top)
        times.append(int(t))
        xs.append(fx + fw / 2 - cw / 2)
        ys.append(y)
        tops.append(top)
    xs = _mean3(_median_filter(xs, CARD_MEDIAN))
    ys = _mean3(_median_filter(ys, CARD_MEDIAN))
    points = []
    for i, t in enumerate(times):
        # Smoothing never lowers the card onto a head: no lower than any neighboring sample needs.
        need = min(tops[max(0, i - 1):i + 2])
        y = min(ys[i], need)
        # Above the speaker's area only as far as the head's room needs (a blurred band there).
        lo = min(y_lo, max(need, by - HEAD_MARGIN * ch))
        points.append((t, max(x_lo, min(x_hi, xs[i])), max(lo, min(y_hi, y))))
    return CardCrop(cw, ch, tuple(_simplify(points, CARD_KEY_TOLERANCE * ch)), bounds)


def escape_crop(faces: Sequence[tuple[int, Rect4]], base: CardCrop, start_ms: int = 0) -> Optional[CardCrop]:
    """The card's crop for a frame escape (the same size as `base`, the usual crop): framed lower, so the eye line sits
    depth_fx.ESCAPE_EYE_Y of the card below its top edge and the forehead and hair rise over it, with a strip
    depth_fx.ESCAPE_EXT of the crop's height above it to draw them from. None when the escape can't be drawn well: no
    face seen, the top of the head cut off by the speaker's area (it would break out with a flat top), the card's top
    edge above the speaker's area, or the face too low for its eyes to come near the card's top."""
    if not faces:
        return None
    bx, by, bw, bh = base.bounds
    aspect = base.w / base.h
    # Framed lower, the card may come in closer (down to ESCAPE_MIN_FACES face heights) so the eyes reach near its top
    # while its bottom stays inside the speaker's area (a close selfie has little picture under the chin).
    fh = _percentile([f[3] for _, f in faces], CARD_FACE_PERCENTILE)
    eye_low = _percentile([f[1] + EYE_IN_FACE * f[3] for _, f in faces], CARD_FACE_PERCENTILE)
    fit = (by + bh - eye_low) / (1 - depth_fx.ESCAPE_EYE_Y)
    ch = min(base.h, max(depth_fx.ESCAPE_MIN_FACES * fh, fit))
    cw = ch * aspect
    ext = depth_fx.ESCAPE_EXT * ch
    # Wider than the speaker's area (a narrowed card): centered, as the usual crop.
    x_lo, x_hi = (bx, bx + bw - cw) if cw <= bw else (bx + (bw - cw) / 2, bx + (bw - cw) / 2)
    y_hi = by + bh - ch if ch <= bh else by
    times, xs, ys = [], [], []
    for t, face in sorted(faces):
        fx, fy, fw, fh = face
        times.append(int(t))
        xs.append(fx + fw / 2 - cw / 2)
        ys.append(fy + EYE_IN_FACE * fh - depth_fx.ESCAPE_EYE_Y * ch)
    xs = _mean3(_median_filter(xs, CARD_MEDIAN))
    ys = _mean3(_median_filter(ys, CARD_MEDIAN))
    points, misses = [], 0
    for (t, face), x, y in zip(sorted(faces), xs, ys):
        y = min(y, y_hi)
        fx, fy, fw, fh = face
        eye = fy + EYE_IN_FACE * fh
        hair = fy - depth_fx.HAIR_ABOVE * fh
        if y < by - 0.5:
            return None
        # A sample whose head would be cut by the picture's top, or that doesn't rise over the card, or sits too low.
        misses += hair < by + 1 or hair >= y or (eye - y) / ch > depth_fx.ESCAPE_MAX_EYE
        points.append((t, max(x_lo, min(x_hi, x)), y))
    if misses > len(points) * (1 - depth_fx.ESCAPE_MIN_SHARE):
        return None
    return CardCrop(cw, ch, tuple(_simplify(points, CARD_KEY_TOLERANCE * ch)), base.bounds, ext)


def _escape_fast(crop: CardCrop) -> bool:
    """Whether an escape crop's strip is all inside the speaker's area (a plain taller crop draws it)."""
    bx, by, bw, bh = crop.bounds
    return not crop.zoomed_out and min(y for _, _, y in crop.keys) - crop.ext >= by - 0.5


def edited_to_window(spans: Sequence[tuple[float, float]], keeps: Sequence[Sequence[int]]) -> list[tuple[int, int]]:
    """Edited-clock spans (seconds) as window-time pieces (ms) through the kept parts."""
    out: list[tuple[int, int]] = []
    for a, b in spans:
        offset = 0
        for ka, kb in keeps:
            lo, hi = max(a * 1000, offset), min(b * 1000, offset + kb - ka)
            if hi > lo:
                out.append((round(ka + lo - offset), round(ka + hi - offset)))
            offset += kb - ka
    return out


def speaker_bounds(shot, src_w: int, src_h: int, faces: Sequence[Box] = ()) -> Rect4:
    """The part of the source the speaker is in (pixels): the webcam on a screen recording (or the editor's bubble
    crop, or its inset's part), the padded inset's picture, the panel with the face on a two-panel editor layout,
    else the whole frame."""
    from clip_engine.services.layout_analyzer import LayoutType
    def px(box) -> Rect4:
        x, y, w, h = box
        return x * src_w, y * src_h, w * src_w, h * src_h
    if shot.manual_crops and len(shot.manual_crops) > 1:
        def holds(crop) -> bool:
            x, y, w, h = crop
            return any(x <= f.cx <= x + w and y <= f.cy <= y + h for f in faces)
        crop = next((c for c in reversed(shot.manual_crops) if holds(c)), shot.manual_crops[-1])
        return px(crop)
    if shot.manual_bubble is not None:
        return px(shot.manual_bubble)
    if shot.content_box is not None:
        b = shot.content_box.clamp()
        return px((b.x, b.y, b.w, b.h))
    if shot.layout == LayoutType.SCREEN_CAM and shot.cam_box is not None:
        b = shot.cam_box.clamp()
        return px((b.x, b.y, b.w, b.h))
    if shot.crop_bounds is not None:
        b = shot.crop_bounds.clamp()
        return px((b.x, b.y, b.w, b.h))
    return 0.0, 0.0, float(src_w), float(src_h)


def _shot_face(shot) -> Optional[Box]:
    """A face the shot's analysis knows (for shots no sample saw a face in)."""
    from clip_engine.services.layout_analyzer import LayoutType
    if shot.layout == LayoutType.SCREEN_CAM and shot.cam_face is not None:
        return shot.cam_face
    return max(shot.people, key=lambda b: b.area) if shot.people else None


def card_crops(plan, keeps, runs: Sequence[tuple[float, float]], transition: float, aspect: float,
               faces: Sequence[tuple[int, Sequence[Box]]] = (), min_share: float = 0.0, escape: Sequence[bool] = (),
               escapes: Optional[dict] = None) -> dict[tuple[int, int], CardCrop]:
    """The crop for each (card run, shot) the card shows: from the face samples (window ms, normalized boxes) in
    the run's stretch of that shot (the largest face inside the speaker's area). For the runs `escape` asks a frame
    escape for, the escape's crop (escape_crop) goes into `escapes` where it can be drawn."""
    escapes = {} if escapes is None else escapes
    src_w, src_h = plan.source_width, plan.source_height
    samples = sorted(list(plan.face_samples) + list(faces), key=lambda s: s[0])
    out: dict[tuple[int, int], CardCrop] = {}
    for r, (a, b) in enumerate(runs):
        spans = edited_to_window([(a, b + transition)], keeps)
        for i, shot in enumerate(plan.shots):
            parts = [(max(lo, shot.start_ms), min(hi, shot.end_ms)) for lo, hi in spans if min(hi, shot.end_ms) > max(lo, shot.start_ms)]
            if not parts:
                continue
            seen = [(t, boxes) for t, boxes in samples if boxes and any(lo <= t < hi for lo, hi in parts)]
            bounds = speaker_bounds(shot, src_w, src_h, [f for _, boxes in seen for f in boxes])
            bx, by, bw, bh = bounds
            picked: list[tuple[int, Rect4]] = []
            for t, boxes in seen:
                inside = [f for f in boxes if bx <= f.cx * src_w <= bx + bw and by <= f.cy * src_h <= by + bh]
                if inside:
                    f = max(inside, key=lambda f: f.area)
                    picked.append((t, (f.x * src_w, f.y * src_h, f.w * src_w, f.h * src_h)))
            if not picked and _shot_face(shot) is not None:
                f = _shot_face(shot)
                picked = [(parts[0][0], (f.x * src_w, f.y * src_h, f.w * src_w, f.h * src_h))]
            out[(r, i)] = card_crop(picked, bounds, aspect, parts[0][0], min_share)
            if r < len(escape) and escape[r]:
                crop = escape_crop(picked, out[(r, i)], parts[0][0])
                if crop is not None:
                    escapes[(r, i)] = crop
    return out


def card_sample_spans(plan, keeps, runs: Sequence[tuple[float, float]], transition: float) -> list[tuple[int, int]]:
    """Window-time stretches (ms) the card shows where the plan's own face samples are too sparse for it."""
    spans = edited_to_window([(a, b + transition) for a, b in runs], keeps)
    times = sorted(t for t, boxes in plan.face_samples)
    need = []
    for lo, hi in spans:
        count = sum(1 for t in times if lo <= t < hi)
        if count < max(1, (hi - lo) / CARD_PLAN_SAMPLE_MS):
            need.append((lo, hi))
    return need


def card_faces(video: str, plan, window_start_ms: int, spans: Sequence[tuple[int, int]]) -> list:
    """Face samples [(window ms, [Box])] every CARD_SAMPLE_MS through the given window stretches, found in the
    source (one decode per stretch). Best effort: [] without the detector."""
    try:
        import cv2
        import numpy as np
        from clip_engine.services.layout_analyzer import Box
        from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS, run_media
        from clip_engine.services.remix_service import FACE_MODEL
    except Exception:  # noqa: BLE001
        return []
    if not os.path.isfile(FACE_MODEL) or not spans:
        return []
    src_w, src_h = plan.source_width, plan.source_height
    k = CARD_DETECT_PX / max(src_w, src_h)
    w, h = max(2, int(round(src_w * k / 2)) * 2), max(2, int(round(src_h * k / 2)) * 2)
    detector = cv2.FaceDetectorYN.create(FACE_MODEL, "", (w, h), 0.7, 0.3, 50)
    out: list = []
    budget = MAX_CARD_SAMPLES
    for lo, hi in spans:
        count = min(budget, max(1, int((hi - lo) // CARD_SAMPLE_MS)))
        if count <= 0:
            break
        budget -= count
        try:
            raw = run_media(["ffmpeg", "-nostdin", "-v", "error", *MEDIA_INPUT_OPTIONS, "-ss", f"{(window_start_ms + lo) / 1000:.3f}",
                             "-i", video, "-t", f"{count * CARD_SAMPLE_MS / 1000:.3f}", "-vf",
                             f"fps={1000 / CARD_SAMPLE_MS:g}:start_time=0,scale={w}:{h}", "-frames:v", str(count),
                             "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                            timeout=300, check=True, max_output=(count + 1) * w * h * 3).stdout
        except Exception:  # noqa: BLE001 - a stretch that can't be read keeps the plan's faces
            continue
        size = w * h * 3
        for j in range(min(count, len(raw) // size)):
            frame = np.frombuffer(raw, np.uint8, size, j * size).reshape(h, w, 3)
            _, found = detector.detect(frame)
            if found is not None and len(found):
                out.append((lo + j * CARD_SAMPLE_MS, [Box(float(f[0]) / w, float(f[1]) / h, float(f[2]) / w, float(f[3]) / h) for f in found]))
    return out


def _keys_expr(crop: CardCrop, lo_ms: int, hi_ms: int, axis: int, transform: Callable[[float], float]) -> str:
    """A piecewise-linear expression of window time t (seconds) for one axis of the crop's keys over [lo, hi]."""
    from clip_engine.services.layout_renderer import piecewise_expr
    keys = crop.keys
    first = max([i for i, k in enumerate(keys) if k[0] <= lo_ms] or [0])
    last = min([i for i, k in enumerate(keys) if k[0] >= hi_ms] or [len(keys) - 1])
    chosen = keys[first:last + 1]
    if len(chosen) == 1 or len({round(transform(k[axis]), 1) for k in chosen}) == 1:
        return f"{transform(chosen[0][axis]):.1f}"
    return piecewise_expr([(k[0] / 1000, transform(k[axis])) for k in chosen])


def card_chain(label: str, out: str, crop: CardCrop, lo_ms: int, hi_ms: int, card_w: int, card_h: int, ext_h: int = 0) -> str:
    """Filters from [label] (a trimmed piece of the clocked source) to [out] (card_w x card_h): the crop moving
    along its keys; zoomed out, the source scaled over a blurred copy of itself.

    `ext_h` (frame escape): the frames are that many rows taller, the extra rows on top: an escape crop (crop.ext)
    fills them from the source above it; any other is padded with black there (nothing escapes)."""
    bx, by, bw, bh = crop.bounds
    if ext_h and crop.ext > 0 and _escape_fast(crop):
        w, h = min(int(bw), max(2, int(round(crop.w)))), min(int(bh), max(2, int(round(crop.h + crop.ext))))
        ext = crop.ext
        x = _keys_expr(crop, lo_ms, hi_ms, 1, lambda v: max(bx, min(bx + bw - w, v)))
        y = _keys_expr(crop, lo_ms, hi_ms, 2, lambda v: max(by, min(by + bh - h, v - ext)))
        return f"[{label}]crop=w={w}:h={h}:x='{x}':y='{y}',scale={card_w}:{card_h + ext_h}:flags=lanczos,setsar=1[{out}]"
    if ext_h and crop.ext > 0:
        # The strip reaches past the speaker's area (or the card is zoomed out): the speaker's area scaled so the crop
        # fills the card, placed over a blurred copy of itself on the taller frame.
        ix, iy = int(bx) // 2 * 2, int(by) // 2 * 2
        iw, ih = max(2, int(bx + bw - ix) // 2 * 2), max(2, int(by + bh - iy) // 2 * 2)
        zoom = card_h / crop.h
        fw, fh = max(2, int(round(iw * zoom))), max(2, int(round(ih * zoom)))
        x = _keys_expr(crop, lo_ms, hi_ms, 1, lambda v: (ix - v) * zoom)
        y = _keys_expr(crop, lo_ms, hi_ms, 2, lambda v: (iy - v) * zoom + ext_h)
        th = card_h + ext_h
        qw, qh = even(card_w / 4), even(th / 4)
        return (f"[{label}]crop={iw}:{ih}:{ix}:{iy},split=2[{out}_b][{out}_f];"
                f"[{out}_b]scale={qw}:{qh}:force_original_aspect_ratio=increase,crop={qw}:{qh},gblur=sigma=8,"
                f"lutyuv=y=val*0.82,scale={card_w}:{th}[{out}_bg];"
                f"[{out}_f]scale={fw}:{fh}:flags=lanczos[{out}_fg];"
                f"[{out}_bg][{out}_fg]overlay=x='{x}':y='{y}':eval=frame,setsar=1[{out}]")
    if ext_h:
        return card_chain(label, f"{out}_p", dataclasses.replace(crop, ext=0.0), lo_ms, hi_ms, card_w, card_h) + \
            f";[{out}_p]pad={card_w}:{card_h + ext_h}:0:{ext_h}:color=black[{out}]"
    if not crop.zoomed_out:
        w, h = min(int(bw), max(2, int(round(crop.w)))), min(int(bh), max(2, int(round(crop.h))))
        x = _keys_expr(crop, lo_ms, hi_ms, 1, lambda v: max(bx, min(bx + bw - w, v)))
        y = _keys_expr(crop, lo_ms, hi_ms, 2, lambda v: max(by, min(by + bh - h, v)))
        return f"[{label}]crop=w={w}:h={h}:x='{x}':y='{y}',scale={card_w}:{card_h}:flags=lanczos,setsar=1[{out}]"
    # The speaker's area (whole pixels, even), scaled so the crop fills the card, placed over its blurred copy.
    ix, iy = int(bx) // 2 * 2, int(by) // 2 * 2
    iw, ih = max(2, int(bx + bw - ix) // 2 * 2), max(2, int(by + bh - iy) // 2 * 2)
    zoom = card_h / crop.h
    fw, fh = max(2, int(round(iw * zoom))), max(2, int(round(ih * zoom)))
    x = _keys_expr(crop, lo_ms, hi_ms, 1, lambda v: (ix - v) * zoom)
    y = _keys_expr(crop, lo_ms, hi_ms, 2, lambda v: (iy - v) * zoom)
    qw, qh = even(card_w / 4), even(card_h / 4)
    return (f"[{label}]crop={iw}:{ih}:{ix}:{iy},split=2[{out}_b][{out}_f];"
            f"[{out}_b]scale={qw}:{qh}:force_original_aspect_ratio=increase,crop={qw}:{qh},gblur=sigma=8,"
            f"lutyuv=y=val*0.82,scale={card_w}:{card_h}[{out}_bg];"
            f"[{out}_f]scale={fw}:{fh}:flags=lanczos[{out}_fg];"
            f"[{out}_bg][{out}_fg]overlay=x='{x}':y='{y}':eval=frame,setsar=1[{out}]")


def card_matte_chain(label: str, out: str, crop: CardCrop, lo_ms: int, hi_ms: int, card_w: int, card_h: int, ext_h: int,
                     scale: tuple[float, float]) -> str:
    """The escape matte's chain for one piece, from [label] (the clocked matte, `scale` = matte px per source px) to
    [out] (card_w x card_h + ext_h, gray): the same crop as the card's escape frames (card_chain); black for a crop
    with no escape."""
    if not crop.ext > 0:
        return f"[{label}]scale={card_w}:{card_h + ext_h},drawbox=c=black:t=fill[{out}]"
    kx, ky = scale
    bx, by, bw, bh = crop.bounds
    if not _escape_fast(crop):
        # As card_chain's zoomed-out escape: the speaker's area scaled and placed, here over black (nobody there).
        ix, iy = int(bx) // 2 * 2, int(by) // 2 * 2
        iw, ih = max(2, int(bx + bw - ix) // 2 * 2), max(2, int(by + bh - iy) // 2 * 2)
        zoom = card_h / crop.h
        fw, fh = max(2, int(round(iw * zoom))), max(2, int(round(ih * zoom)))
        x = _keys_expr(crop, lo_ms, hi_ms, 1, lambda v: (ix - v) * zoom)
        y = _keys_expr(crop, lo_ms, hi_ms, 2, lambda v: (iy - v) * zoom + ext_h)
        return (f"[{label}]crop={max(2, round(iw * kx))}:{max(2, round(ih * ky))}:{round(ix * kx)}:{round(iy * ky)},split=2[{out}_b][{out}_f];"
                f"[{out}_b]scale={card_w}:{card_h + ext_h},drawbox=c=black:t=fill[{out}_bg];"
                f"[{out}_f]scale={fw}:{fh}:flags=bicubic[{out}_fg];"
                f"[{out}_bg][{out}_fg]overlay=x='{x}':y='{y}':eval=frame,setsar=1[{out}]")
    w, h = min(int(bw), max(2, int(round(crop.w)))), min(int(bh), max(2, int(round(crop.h + crop.ext))))
    ext = crop.ext
    mw, mh = max(2, int(round(w * kx))), max(2, int(round(h * ky)))
    x = _keys_expr(crop, lo_ms, hi_ms, 1, lambda v: max(bx, min(bx + bw - w, v)) * kx)
    y = _keys_expr(crop, lo_ms, hi_ms, 2, lambda v: max(by, min(by + bh - h, v - ext)) * ky)
    return f"[{label}]crop=w={mw}:h={mh}:x='{x}':y='{y}',scale={card_w}:{card_h + ext_h}:flags=bicubic,setsar=1[{out}]"


@dataclass
class EscapeSource:
    """A frame escape the card's framing chain is asked for: which card runs want one, how to make the matte for some
    window-time spans (`make(spans) -> (matte path or None, good per span)`), the input index the matte goes in at,
    the matte's size and the strip's height. card_source_graph fills in the result: the matte's path and which runs
    escape."""

    wanted: list[bool]
    make: Callable[[list[tuple[int, int]]], tuple[Optional[str], list[bool]]]
    input_index: int
    matte_size: tuple[int, int]
    ext_h: int
    path: Optional[str] = None
    escaped: list[bool] = dataclasses.field(default_factory=list)


def card_width(crop: CardCrop, card_w: int, card_h: int, min_w: int) -> int:
    """How wide the card is drawn for a crop (frame pixels, even): its full width, or, when the speaker's area is
    narrower than the crop (a close selfie at head-and-shoulders framing), just the video's own width there (the
    backdrop shows either side), never under `min_w` (below that a light blur fills the rest)."""
    bx, _, bw, _ = crop.bounds
    if crop.w <= bw + 0.5:
        return card_w
    ix = int(bx) // 2 * 2
    iw = max(2, int(bx + bw - ix) // 2 * 2)
    return max(min(card_w, even(min_w)), min(card_w, int(iw * card_h / crop.h) // 2 * 2))


def card_source_graph(plan, keeps, card_w: int, card_h: int, fps: str, runs: Sequence[tuple[float, float]],
                      transition: float, faces: Sequence = (), min_w: Optional[int] = None,
                      escape: Optional[EscapeSource] = None) -> tuple[str, list[int]]:
    """The card's own framing chain, from [sc_card_src] (the source) to [sc_card_frames] (card_w x card_h), cut
    like the main framing (the same frames): each run's head-and-shoulders crop (card_crops), switching between
    runs while the card is down. Also each run's card width (card_width; the widest its shots need), the video
    centered in the frames.

    `escape`: for the runs that want a frame escape and can have one (escape_crop) the matte is made for their stretch
    and checked; where it is good the card is framed for the escape, the frames get `escape.ext_h` rows on top and the
    matte, cut the same way, comes out as [sc_card_matte] (input `escape.input_index`)."""
    from fractions import Fraction
    from clip_engine.services.layout_renderer import video_frame_pieces
    rate = Fraction(fps)
    least = min(card_w, round(card_w * MIN_CARD_SHARE) if min_w is None else min_w)
    escapes: dict[tuple[int, int], CardCrop] = {}
    crops = card_crops(plan, keeps, runs, transition, card_w / card_h, faces, least / card_w,
                       escape.wanted if escape else (), escapes)
    ext_h = 0
    if escape is not None:
        escape.escaped = [False] * len(runs)
        feasible = sorted({r for r, _ in escapes})
        spans = {r: edited_to_window([runs[r]], keeps) for r in feasible}
        flat = [span for r in feasible for span in spans[r]]
        path, oks = escape.make(flat) if flat else (None, [])
        good, k = set(), 0
        for r in feasible:
            n = len(spans[r])
            if path and n and all(oks[k:k + n]):
                good.add(r)
            k += n
        if path and not good:
            # Not used: the render won't take it in (nor clean it up).
            try:
                os.remove(path)
            except OSError:
                pass
        if good:
            escape.path, ext_h = path, escape.ext_h
            for (r, i), crop in escapes.items():
                if r in good:
                    crops[(r, i)] = crop
            escape.escaped = [r in good for r in range(len(runs))]
    widths = [max([card_width(c, card_w, card_h, least) for (r, _), c in crops.items() if r == k] or [card_w]) for k in range(len(runs))]
    switches = [round((runs[k][1] + runs[k + 1][0]) / 2 * rate) for k in range(len(runs) - 1)]
    window_end = plan.shots[-1].end_ms
    parts = [f"[sc_card_src]fps={fps}:start_time=0:round=near,tpad=stop_mode=clone:stop_duration={window_end / 1000:.3f}[cd_clocked]"]
    pieces: list[tuple[int, int, int, int]] = []  # (shot, source start frame, count, run)
    edited = 0
    for i, start, count in video_frame_pieces(plan, keeps, fps):
        cursor = 0
        while cursor < count:
            run = sum(1 for s in switches if s <= edited + cursor)
            nxt = next((s for s in switches if s > edited + cursor), None)
            length = count - cursor if nxt is None else min(count - cursor, nxt - edited - cursor)
            pieces.append((i, start + cursor, length, run))
            cursor += length
        edited += count
    n = len(pieces)
    parts.append("[cd_clocked]null[cd_s0]" if n == 1 else "[cd_clocked]split=" + str(n) + "".join(f"[cd_s{k}]" for k in range(n)))
    if ext_h:
        mw, mh = escape.matte_size
        scale = (mw / plan.source_width, mh / plan.source_height)
        parts.append(f"[{escape.input_index}:v]format=gray,fps={fps}:start_time=0:round=near,"
                     f"tpad=stop_mode=clone:stop_duration={window_end / 1000:.3f}[cm_clocked]")
        parts.append("[cm_clocked]null[cm_s0]" if n == 1 else "[cm_clocked]split=" + str(n) + "".join(f"[cm_s{k}]" for k in range(n)))
    for k, (i, start, count, run) in enumerate(pieces):
        crop = crops.get((run, i)) or next((c for (r, j), c in crops.items() if j == i), None) or next(iter(crops.values()), None)
        parts.append(f"[cd_s{k}]trim=start_frame={start}:end_frame={start + count}[cd_t{k}]")
        lo, hi = int(start / rate * 1000), int((start + count) / rate * 1000) + 1
        if crop is None:
            parts.append(f"[cd_t{k}]scale={card_w}:{card_h}:force_original_aspect_ratio=increase,crop={card_w}:{card_h},setsar=1"
                         + (f",pad={card_w}:{card_h + ext_h}:0:{ext_h}:color=black" if ext_h else "") + f"[cd_c{k}]")
        else:
            parts.append(card_chain(f"cd_t{k}", f"cd_c{k}", crop, lo, hi, card_w, card_h, ext_h))
        parts.append(f"[cd_c{k}]setpts=PTS-STARTPTS[cd_v{k}]")
        if ext_h:
            parts.append(f"[cm_s{k}]trim=start_frame={start}:end_frame={start + count}[cm_t{k}]")
            parts.append(card_matte_chain(f"cm_t{k}", f"cm_c{k}", crop or CardCrop(2, 2, ((0, 0.0, 0.0),), (0, 0, 2, 2)), lo, hi,
                                          card_w, card_h, ext_h, scale))
            parts.append(f"[cm_c{k}]setpts=PTS-STARTPTS[cm_v{k}]")
    parts.append("".join(f"[cd_v{k}]" for k in range(n)) + f"concat=n={n}:v=1:a=0,settb=expr=1/({fps}),setpts=N,fps={fps}[sc_card_frames]")
    if ext_h:
        parts.append("".join(f"[cm_v{k}]" for k in range(n)) + f"concat=n={n}:v=1:a=0,settb=expr=1/({fps}),setpts=N,fps={fps}[sc_card_matte]")
    return ";".join(parts), widths


@dataclass
class SceneComposite:
    """What the render needs from the scenes: graph text, still inputs, caption placement."""

    graph: str
    inputs: list[str]
    segments: list[Segment]
    geometry: StageGeometry
    # The camera moves at scene changes (edited clock) and which card runs' heads break out of the card.
    transitions: list = dataclasses.field(default_factory=list)
    escaped: list[bool] = dataclasses.field(default_factory=list)
    # The card runs (edited seconds) whose head breaks out (captions move onto the card there).
    escaped_spans: list[tuple[float, float]] = dataclasses.field(default_factory=list)


def face_center_y(zones, start_ms: float, end_ms: float, panel_h: int) -> int:
    """Median face center (panel pixels) during [start, end) edited ms, or the usual framing's."""
    centers = sorted((r[1] + r[3]) / 2 for z in zones if z.start_ms < end_ms and z.end_ms > start_ms for r in z.rects)
    if not centers:
        return round(panel_h * DEFAULT_FACE_Y)
    return round(centers[len(centers) // 2])


def build_scene_graph(
    graph: str, scenes: Sequence[Scene], width: int, height: int, edited_ms: int, video_speed: float, fps: str,
    first_input: int, work_dir: str, stem: str, bar_h: int = 0, zones: Sequence = (), brand: Optional[str] = None,
    card_graph: Optional[Callable[..., tuple[str, list[int]]]] = None,
    escape_matte: Optional[Callable[[list[tuple[int, int]]], tuple[Optional[str], list[bool]]]] = None,
    matte_size: Optional[tuple[int, int]] = None,
) -> Optional[SceneComposite]:
    """Lay the scenes over a graph ending in a single full-frame [base] (W x H); output stays [base].

    `first_input` is the index the first still input gets. None when every scene is face.
    `card_graph(card_w, card_h, runs, transition, escape=None)` gives the card's own framing chain from the source
    (card_source_graph; runs and transition on the edited clock, seconds) and each run's card width;
    without it the card is cut from the framed video. `escape_matte(spans)` (with `matte_size`) makes the frame
    escape's matte for window-time spans (depth_fx.escape_matte); without it no head breaks out of the card.
    Each change of scene goes through its camera move (depth_fx.scene_transitions) unless the scene's is "slide".
    """
    assert graph.count("[base]") == 1, "layout graph must end its video in a single [base]"
    segments = edited_segments(scenes, edited_ms, video_speed)
    if not any(s.scene != "face" for s in segments):
        return None
    geo = geometry(width, height)
    transition = TRANSITION_MS * video_speed / 1000
    total = edited_ms / 1000
    rate = f"({fps})"
    parts = [graph.replace("[base]", "[sc_in]")]
    inputs: list[str] = []
    runs = card_runs(segments)
    windows = backdrop_windows(segments, transition)
    own_card = bool(runs and card_graph and graph.count("[0:v]") == 1)
    if own_card:
        parts[0] = "[0:v]split=2[sc_v0][sc_card_src];" + parts[0].replace("[0:v]", "[sc_v0]")
        current = "sc_in"
    elif runs:
        parts.append("[sc_in]split=2[sc_face][sc_src]")
        current = "sc_face"
    else:
        current = "sc_in"
    # Backdrops: one still per window, repeated in memory, faded on its alpha.
    for k, w in enumerate(windows):
        path = os.path.join(work_dir, f"scene-{stem}-backdrop-{k}.png")
        draw_backdrop(path, width, height, w["backdrop"], brand)
        index = first_input + len(inputs)
        inputs.append(path)
        a, e = w["start"], w["end"]
        chain = (f"[{index}:v]format=yuva420p,loop=loop=-1:size=1:start=0,"
                 f"setpts=(N/{rate}+{a:.4f})/TB,trim=end={e:.4f}")
        if w["fade_in"]:
            chain += f",fade=t=in:st={a:.4f}:d={transition:.4f}:alpha=1"
        if w["fade_out"]:
            chain += f",fade=t=out:st={w['boundary']:.4f}:d={transition:.4f}:alpha=1"
        parts.append(chain + f"[sc_bd{k}]")
        nxt = f"sc_b{k}"
        parts.append(f"[{current}][sc_bd{k}]overlay=0:0:eof_action=pass:enable='between(t,{a:.4f},{e:.4f})'[{nxt}]")
        current = nxt
    escape: Optional[EscapeSource] = None
    reported: list[bool] = []
    if runs:
        panel_h = height - bar_h
        shapes = [c for c in CARDS if card_runs(segments, c)]
        arch = "arch" in shapes
        # The card's frames: the rounded card's size, or (with an arch anywhere) the arch's full width, which the
        # rounded card's runs crop at the center (same zoom, a narrower window).
        frame_w, frame_h = (width, geo.arch_h) if arch else (geo.card_w, geo.card_h)
        crop_h = min(panel_h, even(width * frame_h / frame_w))
        tops = []
        for a, b in runs:
            cy = face_center_y(zones, a * 1000, b * 1000, panel_h)
            tops.append(bar_h + max(0, min(panel_h - crop_h, round(cy - crop_h * CARD_FACE_Y))))
        widths: list[int] = [frame_w] * len(runs)
        if own_card:
            wanted = [any(s.escape for s in segments if s.scene == "stage" and a - 1e-6 <= s.start < b) for a, b in runs]
            if escape_matte is not None and matte_size is not None and any(wanted):
                escape = EscapeSource(wanted, escape_matte, first_input + len(inputs), matte_size, even(frame_h * depth_fx.ESCAPE_EXT))
                graph_text, widths = card_graph(frame_w, frame_h, runs, transition, escape=escape)
            else:
                graph_text, widths = card_graph(frame_w, frame_h, runs, transition)
            parts.append(graph_text)
            if escape is not None and escape.path:
                inputs.append(escape.path)
                parts.append("[sc_card_frames]split=2[sc_cf_card][sc_cf_esc]")
                parts.append(f"[sc_cf_card]crop={frame_w}:{frame_h}:0:{escape.ext_h},format=yuva420p[sc_card_rgb]")
                # The speaker cut out of the same (taller) frames, the cut-out's edge softened a touch.
                parts.append("[sc_cf_esc]format=yuva420p[sc_esc_v];[sc_card_matte]gblur=sigma=1.2,format=gray[sc_esc_m];"
                             "[sc_esc_v][sc_esc_m]alphamerge[sc_esc_full]")
            else:
                if escape is not None:
                    reported = list(escape.escaped) or [False] * len(runs)
                escape = None
                parts.append("[sc_card_frames]format=yuva420p[sc_card_rgb]")
        else:
            parts.append(f"[sc_src]crop={width}:{crop_h}:0:'{crop_y_expr(runs, tops)}',"
                         f"scale={frame_w}:{frame_h}:flags=bicubic,format=yuva420p[sc_card_rgb]")
        # One overlay per card shape and width: a run whose video is narrower than the card at head-and-shoulders
        # framing gets a narrower card (centered, the same height, corners and shadow).
        groups: list[tuple[str, int, int, list[tuple[float, float]]]] = []
        for shape in shapes:
            full = width if shape == "arch" else geo.card_w
            by_width: dict[int, list[tuple[float, float]]] = {}
            for a, b in card_runs(segments, shape):
                k = next((i for i, (ra, rb) in enumerate(runs) if ra <= a + 1e-6 and b <= rb + 1e-6), 0)
                by_width.setdefault(min(full, widths[k]), []).append((a, b))
            for w in sorted(by_width, reverse=True):
                groups.append((shape, w, full, by_width[w]))
        counts = {shape: sum(1 for g in groups if g[0] == shape) for shape in shapes}
        names = [shape if counts[shape] == 1 else f"{shape}_{w}" for shape, w, _, _ in groups]
        if len(groups) > 1:
            parts.append(f"[sc_card_rgb]split={len(groups)}" + "".join(f"[sc_card_rgb_{n}]" for n in names))
        # The card runs whose head breaks out, per group.
        escaping = []
        for shape, w, full, shape_runs in groups:
            ok = [(a, b) for a, b in shape_runs
                  if escape is not None and any(e and ra <= a + 1e-6 and b <= rb + 1e-6 for e, (ra, rb) in zip(escape.escaped, runs))]
            escaping.append(ok)
        esc_groups = [k for k, ok in enumerate(escaping) if ok]
        if escape is not None and esc_groups:
            parts.append("[sc_esc_full]null[sc_esc_0]" if len(esc_groups) == 1 else
                         f"[sc_esc_full]split={len(esc_groups)}" + "".join(f"[sc_esc_{k}]" for k in range(len(esc_groups))))
        off = height + 2 * geo.shadow_pad
        for g_index, ((shape, w, full, shape_runs), name) in enumerate(zip(groups, names)):
            frames = f"sc_card_rgb_{name}" if len(groups) > 1 else "sc_card_rgb"
            narrow = w < full
            tag = ("" if shape == "rounded" else "-arch") + (f"-{w}" if narrow else "")
            mask = os.path.join(work_dir, f"scene-{stem}-mask{tag}.png")
            shadow = os.path.join(work_dir, f"scene-{stem}-shadow{tag}.png")
            if shape == "arch":
                ch = geo.arch_h
                cx = (width - w) // 2
                draw_arch_mask(mask, w, ch, geo.arch_radius)
                draw_arch_shadow(shadow, w, ch, geo.arch_radius, geo.shadow_pad)
            else:
                ch = geo.card_h
                cx = geo.card_x + (geo.card_w - w) // 2
                draw_mask(mask, w, ch, geo.radius)
                draw_shadow(shadow, w, ch, geo.radius, geo.shadow_pad)
            if w < frame_w or ch < frame_h:
                parts.append(f"[{frames}]crop={w}:{ch}:{(frame_w - w) // 2}:{(frame_h - ch) // 2}[{frames}_c]")
                frames = f"{frames}_c"
            mask_index, shadow_index = first_input + len(inputs), first_input + len(inputs) + 1
            inputs += [mask, shadow]
            visible = card_visibility_expr(shape_runs, total, transition)
            y = f"{off}-({off - geo.card_y})*({visible})"
            enable = card_enable_expr(shape_runs, transition)
            k = ("" if shape == "rounded" else "_arch") + (f"_{w}" if narrow else "")
            parts.append(f"[{mask_index}:v]format=gray[sc_mask{k}]")
            parts.append(f"[{frames}][sc_mask{k}]alphamerge[sc_card{k}]")
            parts.append(f"[{shadow_index}:v]format=yuva420p[sc_shadow{k}]")
            parts.append(f"[{current}][sc_shadow{k}]overlay=x={cx - geo.shadow_pad}:y='{y}-{geo.shadow_pad}':enable='{enable}'[sc_shadowed{k}]")
            parts.append(f"[sc_shadowed{k}][sc_card{k}]overlay=x={cx}:y='{y}':enable='{enable}'[sc_carded{k}]")
            current = f"sc_carded{k}"
            if escape is not None and escaping[g_index]:
                # Frame escape: the speaker cut out over the card's top edge (the part of the head above it), moving with
                # the card: the frames' whole width (hair past a narrow card's sides too) and down through the card's
                # rounded top corners (the cut-out redraws the card's own pixels inside it).
                e = esc_groups.index(g_index)
                ext = escape.ext_h
                corner = geo.arch_radius if shape == "arch" else geo.radius
                parts.append(f"[sc_esc_{e}]crop={frame_w}:{ext + corner}:0:{(frame_h - ch) // 2}[sc_strip{k}]")
                parts.append(f"[{current}][sc_strip{k}]overlay=x={cx - (frame_w - w) // 2}:y='{y}-{ext}':"
                             f"enable='{card_enable_expr(escaping[g_index], transition)}'[sc_escaped{k}]")
                current = f"sc_escaped{k}"
    from fractions import Fraction
    moves = depth_fx.scene_transitions(segments, float(Fraction(fps)), video_speed, total)
    if moves:
        parts.append(depth_fx.transitions_graph(current, "sc_moved", moves, fps, width, height))
        current = "sc_moved"
    parts.append(f"[{current}]format=yuv420p[base]")
    escaped = list(escape.escaped) if escape else reported
    return SceneComposite(";".join(parts), inputs, segments, geo, moves, escaped, [r for r, e in zip(runs, escaped) if e])


# ---------------------------------------------------------------------------
# Captions
# ---------------------------------------------------------------------------


# With the head breaking out of the card, the captions sit on the card (over the chest) instead of in the band above
# it (where the head is): this share of the card's height down from its top, in the member's own caption style.
ESCAPE_CAPTION_Y = 0.74


def caption_windows(segments: Sequence[Segment], geo: StageGeometry,
                    escaped: Sequence[tuple[float, float]] = ()) -> list[tuple[int, int, int, str]]:
    """(start ms, end ms, y, caption mode) on the edited clock where captions move off the face default.

    The mode (caption_mode): "light" for dark text on a light backdrop, "box" for white words on a color box
    (grid and gradient backdrops), "" for the member's own captions (dark backdrop). A stage stretch inside an
    `escaped` span (edited seconds: a card whose head breaks out) has its captions on the card, in the member's style."""
    out = []
    for s in segments:
        if s.scene == "face":
            continue
        if s.scene == "stage" and any(a - 1e-6 <= s.start and s.end <= b + 1e-6 for a, b in escaped):
            out.append((round(s.start * 1000), round(s.end * 1000), geo.card_y + round(geo.card_h * ESCAPE_CAPTION_Y), ""))
            continue
        y = geo.caption_y if s.scene == "stage" else geo.visual_caption_y
        out.append((round(s.start * 1000), round(s.end * 1000), y, caption_mode(s.backdrop)))
    return out


def scene_anchors(anchors: Sequence[tuple[int, int, int]], windows: Sequence[tuple[int, int, int, bool]]) -> list[tuple[int, int, int]]:
    """Caption anchors (until_ms, alignment, y) with the scene windows spliced in (centered at the band)."""
    def base_at(t: int) -> tuple[int, int]:
        for until, a, y in anchors:
            if t < until:
                return a, y
        return anchors[-1][1], anchors[-1][2]

    points = sorted({0, *[w[0] for w in windows], *[w[1] for w in windows], *[a[0] for a in anchors if a[0] < 10 ** 9]})
    out: list[tuple[int, int, int]] = []
    for i, t in enumerate(points):
        until = points[i + 1] if i + 1 < len(points) else 10 ** 9
        window = next((w for w in windows if w[0] <= t < w[1]), None)
        a, y = (5, window[2]) if window else base_at(t)
        if out and out[-1][1:] == (a, y):
            out[-1] = (until, a, y)
        else:
            out.append((until, a, y))
    out[-1] = (10 ** 9, out[-1][1], out[-1][2])
    return out


def scene_placer(placer, windows: Sequence[tuple[int, int, int, bool]]):
    """Wrap a caption placer: a group starting in a scene window goes to that scene's band."""
    def place(start_ms: int, end_ms: int, block_w: int, block_h: int) -> tuple[int, int]:
        for a, b, y, _ in windows:
            if a <= start_ms < b:
                return 5, y
        return placer(start_ms, end_ms, block_w, block_h)
    return place


def _luma(color: str) -> float:
    r, g, b = _hex(color)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255


def light_backdrop_style(style):
    """The member's caption style for a light backdrop: the same font, size and motion, in dark text
    (no glow, plate or heavy shadow); accents that would wash out on light gray turn blue."""
    import copy
    accent = lambda c: c if c and _luma(c) < 0.55 else DARK_ACCENT  # noqa: E731
    changes = dict(primary_color=DARK_TEXT, highlight_color=accent(style.highlight_color), outline_color="#FFFFFF",
                   outline_width=0, shadow_opacity=0.0, glow_color=None, line_box_color=None)
    if getattr(style, "emphasis_color", None):
        changes["emphasis_color"] = accent(style.emphasis_color)
    styled = copy.copy(style)
    for key, value in changes.items():
        setattr(styled, key, value)
    return styled


def boxed(style) -> bool:
    """Whether captions already sit on a solid box of their own (the Highlight box look reads on any backdrop)."""
    return bool(style.line_box_color) and getattr(style, "line_box_shape", "round") == "rect" and style.line_box_opacity >= 0.9


def box_backdrop_style(style, brand: Optional[str] = None):
    """Captions for a grid or gradient backdrop: the Highlight box look (white bold words on a solid box), the box
    in the brand color when there is one. A member already on Highlight box keeps their style (box recolored)."""
    import copy
    from clip_engine.config import HIGHLIGHT_BOX_COLOR, get_caption_preset
    color = brand if isinstance(brand, str) and len(brand) == 7 and brand.startswith("#") else HIGHLIGHT_BOX_COLOR
    styled = copy.copy(style) if boxed(style) else get_caption_preset("highlight_box")
    # A very light brand color would wash out white words: darkened toward black.
    if _luma(color) > 0.62:
        r, g, b = _hex(color)
        k = 0.62 / _luma(color)
        color = "#{:02X}{:02X}{:02X}".format(round(r * k), round(g * k), round(b * k))
    styled.line_box_color = color
    return styled


def splice_caption_events(normal_ass: str, light_ass: str, windows: Sequence[tuple[int, int, int, object]], parse_time,
                          mode: object = "light") -> str:
    """The normal captions with each event that starts in a window of this mode taken from the other version
    (the dark-text one for "light", the Highlight box one for "box")."""
    light = [(a, b) for a, b, _, m in windows if (m == mode if isinstance(m, str) else bool(m) and mode == "light")]
    prefix = "Dialogue: "

    def start(line: str) -> int:
        return parse_time(line[len(prefix):].split(",", 2)[1])

    def lit(line: str) -> bool:
        t = start(line)
        return any(a <= t < b for a, b in light)

    head, events = [], []
    for line in normal_ass.split("\n"):
        (events if line.startswith(prefix) else head).append(line)
    kept = [line for line in events if not lit(line)]
    taken = [line for line in light_ass.split("\n") if line.startswith(prefix) and lit(line)]
    # The other version's own styles (its font, its box) go in under their own names, so both looks render.
    tag = "Light" if mode == "light" else "Box"
    styles = {name: f"{tag}{name}" for name in re.findall(r"^Style: ([A-Za-z]+),", light_ass, re.M)}
    if styles and taken:
        def rename(line: str) -> str:
            fields = line.split(",", 4)
            if len(fields) == 5 and fields[3] in styles:
                fields[3] = styles[fields[3]]
            return ",".join(fields)
        taken = [rename(line) for line in taken]
        extra = [f"Style: {styles[m.group(1)]},{m.group(2)}" for m in re.finditer(r"^Style: ([A-Za-z]+),(.*)$", light_ass, re.M)]
        last = max((i for i, line in enumerate(head) if line.startswith("Style: ")), default=None)
        if last is not None:
            head = head[:last + 1] + extra + head[last + 1:]
    kept += taken
    kept.sort(key=start)
    return "\n".join(head + kept)
