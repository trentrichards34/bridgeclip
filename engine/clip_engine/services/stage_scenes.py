"""Scenes: layout switching on a 9:16 clip, so graphics get a real stage.

Three scenes on the finished clip's clock (OUTPUT time: after the cut and the
export speed, like the graphics main lays over a render):

- ``face``: the normal full-frame framing (the default; gaps between scenes are face).
- ``stage``: a backdrop (soft light-gray gradient, dark charcoal or brand-tinted)
  fills the frame; the speaker sits in a big rounded card along the bottom
  (face-centered crop of the framed speaker), the top ~53% is free for graphics
  and the captions sit in the band between the two.
- ``visual``: the card is off-screen; the whole frame is backdrop (for a big graphic or inset).

Between scenes the card slides up/down with an ease (~350 ms) and the backdrop
crossfades. Everything is drawn in the render's single FFmpeg pass: the
backdrops, the card's rounded-corner alpha mask and its shadow are small still
PNG inputs (decoded once and repeated in memory), the slide is an
expression-driven overlay ``y``.

Mirror of src/shared/scenes.ts (field names, limits and geometry).
"""
from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Callable, Iterable, Optional, Sequence

from PIL import Image, ImageDraw, ImageFilter

SCENE_KINDS = ("face", "stage", "visual")
BACKDROPS = ("light", "dark", "brand")
MAX_SCENES = 24
# Shorter than this (after the cut) a scene is dropped; the editor keeps scenes 1.2 s or longer.
MIN_RENDER_SCENE_MS = 300
MIN_SCENE_MS = 1200
TRANSITION_MS = 350

# Geometry at 1080x1920, as shares of the frame (scaled with the output).
CARD_SIDE = 40 / 1080
CARD_BOTTOM = 40 / 1920
CARD_HEIGHT = 0.37
CARD_RADIUS = 48 / 1080
STAGE_BOTTOM = 0.53
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


@dataclass(frozen=True)
class Scene:
    scene: str
    start_ms: int
    end_ms: int
    backdrop: str = "light"


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
        if not isinstance(item, dict) or set(item) - {"scene", "start_ms", "end_ms", "backdrop"}:
            raise ValueError("Invalid scene")
        kind, start, end, backdrop = item.get("scene"), item.get("start_ms"), item.get("end_ms"), item.get("backdrop", "light")
        if kind not in SCENE_KINDS or backdrop not in BACKDROPS or not _number(start) or not _number(end) or start < 0 or end <= start:
            raise ValueError("Invalid scene")
        items.append(Scene(kind, round(start), round(end), backdrop))
    return normalize_scenes(items, duration_ms)


def normalize_scenes(scenes: Iterable[Scene], duration_ms: Optional[int] = None, min_ms: int = MIN_RENDER_SCENE_MS) -> list[Scene]:
    """Sorted by start; a later scene wins where two overlap; clipped to [0, duration];
    neighbors with the same scene and backdrop merged; face and too-short scenes dropped."""
    out: list[Scene] = []
    for s in sorted(scenes, key=lambda s: (s.start_ms, s.end_ms)):
        end = s.end_ms if duration_ms is None else min(s.end_ms, duration_ms)
        if end <= s.start_ms:
            continue
        s = Scene(s.scene, s.start_ms, end, s.backdrop)
        if out and out[-1].end_ms > s.start_ms:
            prev = out[-1]
            out[-1] = Scene(prev.scene, prev.start_ms, s.start_ms, prev.backdrop)
            if out[-1].end_ms <= out[-1].start_ms:
                out.pop()
        out.append(s)
    merged: list[Scene] = []
    for s in out:
        if s.scene == "face" or s.end_ms - s.start_ms < min_ms:
            continue
        if merged and merged[-1].scene == s.scene and merged[-1].backdrop == s.backdrop and s.start_ms - merged[-1].end_ms <= 1:
            merged[-1] = Scene(s.scene, merged[-1].start_ms, s.end_ms, s.backdrop)
        else:
            merged.append(s)
    return merged


def scene_at(scenes: Sequence[Scene], t_ms: float) -> str:
    """The scene at t (face in the gaps)."""
    for s in scenes:
        if s.start_ms <= t_ms < s.end_ms:
            return s.scene
    return "face"


def to_dicts(scenes: Iterable[Scene]) -> list[dict]:
    return [{"scene": s.scene, "start_ms": s.start_ms, "end_ms": s.end_ms, "backdrop": s.backdrop} for s in scenes]


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
            out.append((s, {"scene": s["scene"], "start_ms": lo_ms, "end_ms": hi_ms, "backdrop": s.get("backdrop", "light")}))
    return out[:MAX_SCENES]


# ---------------------------------------------------------------------------
# Auto-picker (Motion graphics: Auto with Stage layouts on)
# ---------------------------------------------------------------------------

STAGE_PAD_BEFORE_MS = 400
STAGE_PAD_AFTER_MS = 300


def suggest_scenes(graphics: Iterable[dict], duration_ms: int, backdrop: str = "light") -> list[dict]:
    """Scenes for a clip from its graphics: 'stage' around each stage-size graphic (EditorGraphic
    ``size == 'stage'``; a missing size is not stage), padded a little either side, with stage
    windows closer than a scene's minimum merged; 'face' everywhere else (gaps shorter than the
    minimum join the stage). Times are on the graphics' own clock, clipped to [0, duration_ms].
    """
    if backdrop not in BACKDROPS:
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
        out.append({"scene": "stage", "start_ms": a, "end_ms": b, "backdrop": backdrop})
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


def geometry(width: int, height: int) -> StageGeometry:
    side = round(width * CARD_SIDE)
    card_w = even(width - 2 * side)
    card_h = even(height * CARD_HEIGHT)
    card_y = height - round(height * CARD_BOTTOM) - card_h
    stage_bottom = round(height * STAGE_BOTTOM)
    return StageGeometry(
        width, height, (width - card_w) // 2, card_y, card_w, card_h, max(4, round(width * CARD_RADIUS)),
        max(8, round(width * 28 / 1080)), stage_bottom, round((stage_bottom + card_y) / 2), round(height * VISUAL_CAPTION_Y),
    )


def _hex(color: str) -> tuple[int, int, int]:
    color = color.lstrip("#")
    return int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)


def backdrop_colors(backdrop: str, brand: Optional[str] = None) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    """Top and bottom colors of a backdrop's vertical gradient. Brand: the brand color mixed into white (stays light)."""
    if backdrop in BACKDROP_COLORS:
        return BACKDROP_COLORS[backdrop]
    r, g, b = _hex(brand if brand and len(brand) == 7 else DEFAULT_BRAND)
    mix = lambda share: tuple(round(255 + (c - 255) * share) for c in (r, g, b))  # noqa: E731
    return mix(0.10), mix(0.24)


def is_light(backdrop: str) -> bool:
    return backdrop != "dark"


def draw_backdrop(path: str, width: int, height: int, backdrop: str, brand: Optional[str] = None) -> str:
    """Vertical gradient with a soft glow near the top (no banding: a little dither)."""
    top, bottom = backdrop_colors(backdrop, brand)
    column = Image.new("RGB", (1, 256))
    for y in range(256):
        p = y / 255
        column.putpixel((0, y), tuple(round(a + (b - a) * p) for a, b in zip(top, bottom)))
    img = column.resize((width, height), Image.BICUBIC)
    # A faint light pool behind the stage area, so the backdrop isn't flat.
    glow = Image.new("L", (width, height), 0)
    ImageDraw.Draw(glow).ellipse((-width * 0.2, -height * 0.15, width * 1.2, height * 0.55), fill=60 if backdrop != "dark" else 28)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=width * 0.18))
    img = Image.composite(Image.new("RGB", (width, height), (255, 255, 255)), img, glow)
    noise = Image.effect_noise((width, height), 6).convert("L")
    img = Image.blend(img, Image.merge("RGB", (noise, noise, noise)), 0.015)
    img.save(path, optimize=False, compress_level=1)
    return path


def draw_mask(path: str, width: int, height: int, radius: int) -> str:
    """Rounded-rectangle alpha mask (gray), drawn at 4x and reduced so the corners are smooth."""
    scale = 4
    big = Image.new("L", (width * scale, height * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, width * scale - 1, height * scale - 1), radius=radius * scale, fill=255)
    big.resize((width, height), Image.LANCZOS).save(path, compress_level=1)
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
        segments.append(Segment(s.scene, max(a, cursor), b, s.backdrop))
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


def card_runs(segments: Sequence[Segment]) -> list[tuple[float, float]]:
    """Edited-clock spans where the speaker card is up (consecutive stage segments)."""
    return [(segments[i].start, segments[j].end) for i, j in _runs(segments, lambda s: s.scene == "stage")]


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


# How much of the main framing's height the card shows (a little closer than the full frame).
CARD_ZOOM = 0.78


def _shot_face(plan, shot) -> Optional[tuple[float, float]]:
    """The speaker's face center in the shot (normalized source), from the analyzed frames or the shot's boxes."""
    centers = [max(faces, key=lambda b: b.area) for t, faces in plan.face_samples
               if shot.start_ms <= t < shot.end_ms and faces]
    if not centers and shot.cam_face is not None and shot.layout == "screen_cam":
        return shot.cam_face.cx, shot.cam_face.cy
    if not centers and shot.people:
        centers = [max(shot.people, key=lambda b: b.area)]
    if not centers:
        return None
    xs, ys = sorted(b.cx for b in centers), sorted(b.cy for b in centers)
    return xs[len(xs) // 2], ys[len(ys) // 2]


def card_plan(plan, out_w: int, panel_h: int, card_w: int, card_h: int):
    """A plan that frames each shot for the speaker card: one static crop at the card's shape around the
    speaker (the panel the speaker is in, a little closer, wider than the 9:16 framing), from the same
    shot analysis or editor crops the main framing uses."""
    from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
    from clip_engine.services.layout_renderer import shot_views
    src_w, src_h = plan.source_width, plan.source_height
    aspect = card_w / card_h
    shots = []
    for shot in plan.shots:
        views = shot_views(shot, (shot.start_ms + shot.end_ms) // 2, src_w, src_h, out_w, panel_h)
        if shot.layout == LayoutType.SCREEN_CAM and shot.cam_box is not None and len(views) > 1:
            (x, y, w, h), _ = views[1]
        else:
            (x, y, w, h), _ = max(views, key=lambda v: v[1][2] * v[1][3])
        face = _shot_face(plan, shot)
        if face and x <= face[0] * src_w <= x + w and y <= face[1] * src_h <= y + h:
            fx, fy = face[0] * src_w, face[1] * src_h
        else:
            fx, fy = x + w / 2, y + h * DEFAULT_FACE_Y
        ch = h * CARD_ZOOM
        cw = ch * aspect
        if cw > src_w:
            cw, ch = src_w, src_w / aspect
        if ch > src_h:
            ch, cw = src_h, src_h * aspect
        cx = max(0.0, min(src_w - cw, fx - cw / 2))
        cy = max(0.0, min(src_h - ch, fy - ch * CARD_FACE_Y))
        shots.append(ShotLayout(shot.start_ms, shot.end_ms, LayoutType.TALKING_HEAD, source="manual",
                                manual_crops=[(cx / src_w, cy / src_h, cw / src_w, ch / src_h)]))
    return ClipLayoutPlan(shots, src_w, src_h)


def card_source_graph(plan, keeps, out_w: int, panel_h: int, card_w: int, card_h: int, fps: str, video_speed: float) -> str:
    """The card's own framing chain, from [sc_card_src] (the source) to [sc_card_frames] (card_w x card_h)."""
    import re
    from clip_engine.services.layout_renderer import build_layout_graph
    graph = build_layout_graph(card_plan(plan, out_w, panel_h, card_w, card_h), card_w, card_h, keeps, False,
                               fps=fps, video_speed=video_speed)
    graph = re.sub(r"\[([A-Za-z_][A-Za-z0-9_]*)\]", r"[cd_\1]", graph).replace("[0:v]", "[sc_card_src]")
    return graph.replace("[cd_base]", "[sc_card_frames]")


@dataclass
class SceneComposite:
    """What the render needs from the scenes: graph text, still inputs, caption placement."""

    graph: str
    inputs: list[str]
    segments: list[Segment]
    geometry: StageGeometry


def face_center_y(zones, start_ms: float, end_ms: float, panel_h: int) -> int:
    """Median face center (panel pixels) during [start, end) edited ms, or the usual framing's."""
    centers = sorted((r[1] + r[3]) / 2 for z in zones if z.start_ms < end_ms and z.end_ms > start_ms for r in z.rects)
    if not centers:
        return round(panel_h * DEFAULT_FACE_Y)
    return round(centers[len(centers) // 2])


def build_scene_graph(
    graph: str, scenes: Sequence[Scene], width: int, height: int, edited_ms: int, video_speed: float, fps: str,
    first_input: int, work_dir: str, stem: str, bar_h: int = 0, zones: Sequence = (), brand: Optional[str] = None,
    card_graph: Optional[Callable[[int, int], str]] = None,
) -> Optional[SceneComposite]:
    """Lay the scenes over a graph ending in a single full-frame [base] (W x H); output stays [base].

    `first_input` is the index the first still input gets. None when every scene is face.
    `card_graph(card_w, card_h)` gives the card's own framing chain from the source (card_source_graph);
    without it the card is cut from the framed video.
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
        parts.append(card_graph(geo.card_w, geo.card_h))
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
    if runs:
        panel_h = height - bar_h
        crop_h = min(panel_h, even(width * geo.card_h / geo.card_w))
        tops = []
        for a, b in runs:
            cy = face_center_y(zones, a * 1000, b * 1000, panel_h)
            tops.append(bar_h + max(0, min(panel_h - crop_h, round(cy - crop_h * CARD_FACE_Y))))
        mask = os.path.join(work_dir, f"scene-{stem}-mask.png")
        shadow = os.path.join(work_dir, f"scene-{stem}-shadow.png")
        draw_mask(mask, geo.card_w, geo.card_h, geo.radius)
        draw_shadow(shadow, geo.card_w, geo.card_h, geo.radius, geo.shadow_pad)
        mask_index, shadow_index = first_input + len(inputs), first_input + len(inputs) + 1
        inputs += [mask, shadow]
        visible = card_visibility_expr(runs, total, transition)
        off = height + 2 * geo.shadow_pad
        y = f"{off}-({off - geo.card_y})*({visible})"
        enable = card_enable_expr(runs, transition)
        if own_card:
            parts.append("[sc_card_frames]format=yuva420p[sc_card_rgb]")
        else:
            parts.append(f"[sc_src]crop={width}:{crop_h}:0:'{crop_y_expr(runs, tops)}',"
                         f"scale={geo.card_w}:{geo.card_h}:flags=bicubic,format=yuva420p[sc_card_rgb]")
        parts.append(f"[{mask_index}:v]format=gray[sc_mask]")
        parts.append("[sc_card_rgb][sc_mask]alphamerge[sc_card]")
        parts.append(f"[{shadow_index}:v]format=yuva420p[sc_shadow]")
        parts.append(f"[{current}][sc_shadow]overlay=x={geo.card_x - geo.shadow_pad}:y='{y}-{geo.shadow_pad}':enable='{enable}'[sc_shadowed]")
        parts.append(f"[sc_shadowed][sc_card]overlay=x={geo.card_x}:y='{y}':enable='{enable}'[sc_carded]")
        current = "sc_carded"
    parts.append(f"[{current}]format=yuv420p[base]")
    return SceneComposite(";".join(parts), inputs, segments, geo)


# ---------------------------------------------------------------------------
# Captions
# ---------------------------------------------------------------------------


def caption_windows(segments: Sequence[Segment], geo: StageGeometry) -> list[tuple[int, int, int, bool]]:
    """(start ms, end ms, y, light backdrop) on the edited clock where captions move off the face default."""
    out = []
    for s in segments:
        if s.scene == "face":
            continue
        y = geo.caption_y if s.scene == "stage" else geo.visual_caption_y
        out.append((round(s.start * 1000), round(s.end * 1000), y, is_light(s.backdrop or "light")))
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


def splice_caption_events(normal_ass: str, light_ass: str, windows: Sequence[tuple[int, int, int, bool]], parse_time) -> str:
    """The normal captions with each event that starts on a light backdrop taken from the light-text version."""
    light = [(a, b) for a, b, _, is_light_bg in windows if is_light_bg]
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
    kept += [line for line in light_ass.split("\n") if line.startswith(prefix) and lit(line)]
    kept.sort(key=start)
    return "\n".join(head + kept)
