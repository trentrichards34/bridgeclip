"""Look extras: optional motion effects a member adds on top of a look (src/shared/look-extras.ts is the contract).

Each effect is off unless picked and stays isolated: the renderers (Create's rendering_service, Remix's
remix_service, Edit my recording's edit_recording) make one small call per hook point and get back a caption style,
filter-graph text or picture layers to overlay. Nothing here calls the network.

- punch_zoom: hard cuts between the normal framing and a ~1.25x punch-in on the face at phrase boundaries every
  3-5 s, only while the speaker fills the frame (never over b-roll, a split or a box).
- keyword_pill / accent_words: caption styling (see caption_generator: the group's key word in a pill, or lowercase
  in an italic serif).
- progress_bar: a thin bar at the very top that fills across the video.
- comment_box: in the last ~2.5 s, a comment box types the comment keyword letter by letter, with "Post".
- broll_tags: a small "● B-ROLL" / "● SCREEN RECORDING" tag at the top right of each b-roll shot.
- proof_underline: screenshots the member added pop in (0.9 -> 1 over 150 ms); with a known highlight box for the key
  number, a hand-drawn red underline is drawn under it.
"""
from __future__ import annotations

import copy
import logging
import math
import os
import random
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional, Sequence

from PIL import Image, ImageDraw, ImageFilter, ImageFont

logger = logging.getLogger(__name__)

EXTRA_IDS = ("punch_zoom", "keyword_pill", "accent_words", "progress_bar", "comment_box", "broll_tags", "proof_underline")
HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")
FONTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts"))
FACE_MODEL = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "models",
                                          "face_detection_yunet_2023mar.onnx"))

# The accent words' face (bundled, OFL: assets/fonts/InstrumentSerif-OFL.txt).
ACCENT_FONT = "Instrument Serif"

PUNCH_ZOOM = 1.25
PUNCH_MIN_S, PUNCH_MAX_S = 3.0, 5.0
# A punch-in shorter than this (cut short by b-roll or a layout change) is left out.
PUNCH_MIN_PIECE_S = 1.2
# Where the face sits in the tight shot (share of its height from the top).
PUNCH_FACE_Y = 0.42
# FFmpeg's expression parser has a term limit: windows go in groups of this many.
PUNCH_GROUP = 20

PROGRESS_HEIGHT = 0.006
COMMENT_SECONDS = 2.5
COMMENT_TYPE_DELAY = 0.4
POP_MS = 150
POP_FROM = 0.9
UNDERLINE_RED = (232, 44, 48)
POST_BLUE = (0, 149, 246)


# ---------------------------------------------------------------------------
# The request
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class LookExtras:
    """The extras picked for one render, and the brand color they use (None: each effect's own default)."""

    ids: tuple[str, ...] = ()
    color: Optional[str] = None
    # The comment keyword the comment box types ("" for none: the box is skipped).
    keyword: str = ""

    def has(self, extra: str) -> bool:
        return extra in self.ids

    def __bool__(self) -> bool:
        return bool(self.ids)

    def record(self) -> dict:
        """As kept in an edit bundle (re-making a video keeps its extras)."""
        return {"ids": list(self.ids), "color": self.color, "keyword": self.keyword}


def parse_look_extras(raw: Any) -> tuple[str, ...]:
    """Known extras in a fixed order, no duplicates (None or [] for none; anything but a list is refused)."""
    if raw is None:
        return ()
    if not isinstance(raw, (list, tuple)):
        raise ValueError("Invalid look extras")
    picked = {item for item in raw if isinstance(item, str)}
    return tuple(extra for extra in EXTRA_IDS if extra in picked)


def parse_color(raw: Any) -> Optional[str]:
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str) or not HEX_COLOR.match(raw):
        raise ValueError("Invalid look extras color")
    return raw.upper()


def look_extras(ids: Any = None, color: Any = None, keyword: Any = "") -> LookExtras:
    parsed = parse_look_extras(ids)
    word = keyword.strip().upper() if isinstance(keyword, str) else ""
    if word and not re.fullmatch(r"[A-Z0-9][A-Z0-9-]{0,31}", word):
        word = ""
    return LookExtras(parsed, parse_color(color) if parsed else None, word)


def from_record(raw: Any) -> LookExtras:
    """A bundle's saved extras (anything unreadable: none)."""
    if not isinstance(raw, dict):
        return LookExtras()
    try:
        return look_extras(raw.get("ids"), raw.get("color"), raw.get("keyword") or "")
    except ValueError:
        return LookExtras()


# ---------------------------------------------------------------------------
# Captions: keyword pill and accent words
# ---------------------------------------------------------------------------

def caption_style(style: Any, extras: LookExtras) -> Any:
    """A copy of the caption style with the caption extras turned on (the style itself is never changed)."""
    if style is None or not (extras.has("keyword_pill") or extras.has("accent_words")):
        return style
    styled = copy.copy(style)
    if extras.has("keyword_pill"):
        styled.keyword_pill_color = (extras.color or style.emphasis_color or style.highlight_box_color
                                     or style.highlight_color or "#FFE234")
    if extras.has("accent_words") and _font_file("InstrumentSerif-Italic.ttf"):
        styled.accent_font = ACCENT_FONT
    return styled


# ---------------------------------------------------------------------------
# Punch zoom
# ---------------------------------------------------------------------------

Span = tuple[float, float]


def _merge(spans: Iterable[Span]) -> list[Span]:
    out: list[Span] = []
    for a, b in sorted(s for s in spans if s[1] > s[0]):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def _subtract(spans: list[Span], cut: list[Span]) -> list[Span]:
    out: list[Span] = []
    for a, b in spans:
        pieces = [(a, b)]
        for c, d in _merge(cut):
            pieces = [p for x, y in pieces for p in ((x, min(y, c)), (max(x, d), y)) if p[1] > p[0]]
        out.extend(pieces)
    return out


def _intersect(spans: list[Span], keep: list[Span]) -> list[Span]:
    out = []
    for a, b in spans:
        for c, d in _merge(keep):
            lo, hi = max(a, c), min(b, d)
            if hi > lo:
                out.append((lo, hi))
    return out


def phrase_cuts(words: Sequence[tuple[float, float, str]], total_s: float) -> list[float]:
    """Cut points (seconds) between phrases, roughly every 3-5 s: at a sentence end where one falls in the window,
    else a comma or a pause, else the nearest gap between words (never mid-word), else the window's middle."""
    words = sorted((float(a), float(b), str(t)) for a, b, t in words if b > a)
    candidates: list[tuple[float, int]] = []
    for (a0, b0, t0), (a1, _, _) in zip(words, words[1:]):
        at = (b0 + a1) / 2 if a1 > b0 else a1
        end = t0.strip()[-1:] if t0.strip() else ""
        score = 3 if end in ".!?" else 2 if end in ",;:" or a1 - b0 >= 0.35 else 1 if a1 - b0 >= 0.12 else 0
        candidates.append((at, score))
    cuts: list[float] = []
    t = 0.0
    while t + PUNCH_MIN_S < total_s - 1.0:
        lo, hi = t + PUNCH_MIN_S, min(t + PUNCH_MAX_S, total_s - 1.0)
        inside = [(at, score) for at, score in candidates if lo <= at <= hi]
        if inside:
            best = max(score for _, score in inside)
            at = min((c for c in inside if c[1] == best), key=lambda c: abs(c[0] - (t + 4.0)))[0]
        else:
            at = (lo + hi) / 2
        cuts.append(round(at, 3))
        t = at
    return cuts


def punch_windows(words: Sequence[tuple[float, float, str]], total_s: float, eligible: Optional[list[Span]] = None,
                  blocked: Sequence[Span] = ()) -> list[Span]:
    """When the tight shot shows: every other phrase stretch (starting wide), only inside `eligible` (the speaker
    filling the frame; None: the whole video) and never during `blocked` (b-roll, boxes, splits)."""
    if total_s <= PUNCH_MIN_S + 1.0:
        return []
    cuts = [0.0, *phrase_cuts(words, total_s), float(total_s)]
    tight = [(cuts[i], cuts[i + 1]) for i in range(1, len(cuts) - 1, 2)]
    if eligible is not None:
        tight = _intersect(tight, eligible)
    tight = _subtract(tight, list(blocked))
    return [(round(a, 3), round(b, 3)) for a, b in tight if b - a >= PUNCH_MIN_PIECE_S]


def punch_rect(width: int, height: int, center: Optional[tuple[float, float]]) -> tuple[int, int, int, int]:
    """The tight shot's crop (x, y, w, h) around the face center (output px); no face: the upper middle."""
    cw, ch = _even(width / PUNCH_ZOOM), _even(height / PUNCH_ZOOM)
    cx, cy = center if center else (width / 2, height * 0.40)
    x = min(max(0, round(cx - cw / 2)), width - cw)
    y = min(max(0, round(cy - ch * PUNCH_FACE_Y)), height - ch)
    return x // 2 * 2, y // 2 * 2, cw, ch


def punch_graph(src: str, dst: str, width: int, height: int, windows: list[tuple[float, float, tuple[int, int, int, int]]],
                tag: str = "pz") -> str:
    """Filter-graph text from [src] to [dst]: during each window, a crop of the frame scaled back up (a hard cut in
    and out, the crop fixed for the window, so no wobble). With no windows, a plain copy."""
    if not windows:
        return f"[{src}]null[{dst}]"
    parts = []
    current = src
    groups = [windows[i:i + PUNCH_GROUP] for i in range(0, len(windows), PUNCH_GROUP)]
    for g, group in enumerate(groups):
        out = dst if g == len(groups) - 1 else f"{tag}{g}o"
        cw, ch = group[0][2][2], group[0][2][3]
        x_expr, y_expr = "0", "0"
        for a, b, (x, y, _, _) in reversed(group):
            x_expr = f"if(between(t,{a:.3f},{b:.3f}),{x},{x_expr})"
            y_expr = f"if(between(t,{a:.3f},{b:.3f}),{y},{y_expr})"
        enable = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b, _ in group)
        parts.append(f"[{current}]split[{tag}{g}w][{tag}{g}t]")
        parts.append(f"[{tag}{g}t]crop={cw}:{ch}:x='{x_expr}':y='{y_expr}',scale={width}:{height}:flags=lanczos,setsar=1[{tag}{g}z]")
        parts.append(f"[{tag}{g}w][{tag}{g}z]overlay=0:0:enable='{enable}'[{out}]")
        current = out
    return ";".join(parts)


Rect = tuple[float, float, float, float]


def face_boxes(video: str, windows: list[Span], out_size: tuple[int, int], offset: tuple[int, int] = (0, 0),
               samples: int = 3) -> list[Optional[Rect]]:
    """The face (x0, y0, x1, y1 in output px) in each window of a video, from a few frames in it (the biggest face,
    median); None where no face is found. `out_size` is the size the video is shown at, `offset` where its top-left
    lands in the output."""
    try:
        import cv2
        import numpy as np
    except ImportError:  # pragma: no cover - the engine ships both
        return [None] * len(windows)
    if not os.path.isfile(FACE_MODEL) or not windows:
        return [None] * len(windows)
    capture = cv2.VideoCapture(video)
    detector = None
    centers: list[Optional[Rect]] = []
    try:
        for a, b in windows:
            found = []
            for k in range(samples):
                capture.set(cv2.CAP_PROP_POS_MSEC, (a + (b - a) * (k + 0.5) / samples) * 1000)
                ok, frame = capture.read()
                if not ok or frame is None:
                    continue
                h, w = frame.shape[:2]
                scale = min(1.0, 640 / max(w, h))
                small = cv2.resize(frame, (max(1, round(w * scale)), max(1, round(h * scale)))) if scale < 1 else frame
                sh, sw = small.shape[:2]
                if detector is None:
                    detector = cv2.FaceDetectorYN.create(FACE_MODEL, "", (sw, sh), 0.7, 0.3, 50)
                detector.setInputSize((sw, sh))
                _, faces = detector.detect(small)
                if faces is None or not len(faces):
                    continue
                x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])[:4]
                found.append((x / sw, y / sh, (x + fw) / sw, (y + fh) / sh))
            if found:
                x0, y0, x1, y1 = (float(v) for v in np.median(np.array(found), axis=0))
                ow, oh = out_size
                centers.append((offset[0] + x0 * ow, offset[1] + y0 * oh, offset[0] + x1 * ow, offset[1] + y1 * oh))
            else:
                centers.append(None)
    except Exception as error:  # noqa: BLE001 - without a face the punch-in centers on the upper middle
        logger.warning(f"Finding the face for the zoom punch failed: {type(error).__name__}")
        return [None] * len(windows)
    finally:
        capture.release()
    return centers


def center_of(rect: Optional[Rect]) -> Optional[tuple[float, float]]:
    return None if rect is None else ((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2)


def zone_rects(zones: Sequence[Any], a_ms: float, b_ms: float) -> list[Rect]:
    """Faces on screen during [a_ms, b_ms) from layout_renderer.face_zones (output px)."""
    return [r for z in zones if z.start_ms < b_ms and z.end_ms > a_ms for r in z.rects]


def zone_center(zones: Sequence[Any], a_ms: float, b_ms: float) -> Optional[tuple[float, float]]:
    """The biggest face's center during [a_ms, b_ms) from layout_renderer.face_zones (output px), or None."""
    rects = zone_rects(zones, a_ms, b_ms)
    if not rects:
        return None
    return center_of(max(rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1])))


def comment_box_center(height: int, box_h: int, top: float, caption_top: float, faces: Sequence[Rect] = ()) -> float:
    """Where the comment box goes (its center y): in the upper middle, else at the top, else just under the face,
    whichever stays off every face (grown for the zoom punch) and above the captions; else at the top."""
    grown = [(y0 - (y1 - y0) * 0.2, y1 + (y1 - y0) * 0.2) for _, y0, _, y1 in faces]
    half = box_h / 2
    candidates = [max(top + half, height * 0.30), top + half]
    if grown:
        candidates.append(max(y1 for _, y1 in grown) + half)
    for center in candidates:
        lo, hi = center - half, center + half
        if lo >= top and hi <= caption_top and not any(lo < y1 and hi > y0 for y0, y1 in grown):
            return center
    return top + half


# ---------------------------------------------------------------------------
# Picture layers (progress bar, comment box, b-roll tags, underline)
# ---------------------------------------------------------------------------

@dataclass
class Layer:
    """A picture overlaid at (x, y) (FFmpeg expressions) while `enable` holds, through `filter` (a filter for the
    picture's own stream, '' for none). Times are on the video's clock."""

    path: str
    x: str
    y: str
    enable: str = "1"
    filter: str = ""
    extra: dict = field(default_factory=dict)

    def as_overlay(self) -> tuple[str, str, str, str, str]:
        """As one of Create's overlays (rendering_service.Overlay)."""
        return (self.path, self.x, self.y, self.enable, self.filter or "null")


def layer_inputs(layers: Sequence[Layer], seconds: float, fps: int = 30) -> list[str]:
    """FFmpeg input arguments for the layers' pictures (each repeated for the video's length)."""
    return [arg for layer in layers
            for arg in ("-loop", "1", "-framerate", str(fps), "-t", f"{max(0.1, seconds):.3f}", "-i", layer.path)]


def overlay_chain(current: str, layers: Sequence[Layer], first_index: int, tag: str = "lx") -> tuple[str, str]:
    """Filter-graph text that lays the layers (inputs first_index..) over [current]: (text, the last label)."""
    parts = []
    for i, layer in enumerate(layers):
        index = first_index + i
        image = f"[{index}:v]"
        if layer.filter:
            parts.append(f"[{index}:v]{layer.filter}[{tag}i{i}]")
            image = f"[{tag}i{i}]"
        label = f"{tag}{i}"
        parts.append(f"[{current}]{image}overlay=x='{layer.x}':y='{layer.y}':enable='{layer.enable}':eof_action=pass[{label}]")
        current = label
    return ";".join(parts), current


def _even(value: float) -> int:
    return max(2, int(round(value)) // 2 * 2)


def _font_file(name: str) -> Optional[str]:
    for base in (FONTS_DIR, "/app/assets/fonts"):
        path = os.path.join(base, name)
        if os.path.isfile(path):
            return path
    return None


def _ui_font(size: int, weight: str = "SemiBold") -> ImageFont.FreeTypeFont:
    path = _font_file("PlusJakartaSans.ttf")
    if path:
        font = ImageFont.truetype(path, size)
        try:
            font.set_variation_by_name(weight)
        except (OSError, ValueError):
            pass
        return font
    from clip_engine.services.brand_mark import _font
    return _font(size)


def _rgb(hex_color: str) -> tuple[int, int, int]:
    clean = hex_color.lstrip("#")
    return int(clean[0:2], 16), int(clean[2:4], 16), int(clean[4:6], 16)


def _luminance(rgb: tuple[int, int, int]) -> float:
    lin = [c / 255 / 12.92 if c / 255 <= 0.04045 else ((c / 255 + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def _contrast(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def pop_scale(start_s: float) -> str:
    """The pop-in's scale at time t: 0.9 -> 1 over 150 ms from start_s."""
    return f"min(1,{POP_FROM}+{1 - POP_FROM:.2f}*max(0,t-{start_s:.3f})/{POP_MS / 1000:.3f})"


def pop_filter(start_s: float, fade: bool = True) -> str:
    """A picture's own stream popping in at start_s (scaled 0.9 -> 1 over 150 ms, fading in). Overlay it with
    pop_x / pop_y so it grows about its center."""
    chain = f"format=rgba,scale=w='trunc(iw*{pop_scale(start_s)}/2)*2':h=-2:eval=frame"
    if fade:
        chain += f",fade=t=in:st={start_s:.3f}:d=0.12:alpha=1"
    return chain


def pop_xy(x: float, y: float, full_w: int, full_h: int, start_s: float) -> tuple[str, str]:
    """Overlay x/y for a popping picture whose full-size top-left is (x, y): it stays centered on its full box."""
    scale = pop_scale(start_s)
    return (f"{x:.0f}+(1-{scale})*{full_w}/2", f"{y:.0f}+(1-{scale})*{full_h}/2")


def progress_bar_layers(work: str, width: int, height: int, duration_s: float, color: Optional[str] = None,
                        under: Optional[tuple[int, int, int]] = None, name: str = "progress") -> list[Layer]:
    """A thin bar along the very top filling over the video: a faint track and the bar (brand color, else white).
    `under`: what the bar sits on at the top (a hook bar's color), so it never disappears into it."""
    bar_h = max(4, round(height * PROGRESS_HEIGHT))
    fill = _rgb(color) if color else (255, 255, 255)
    if under is not None and _contrast(fill, under) < 1.8:
        fill = (17, 17, 17) if _luminance(under) > 0.36 else (255, 255, 255)
    os.makedirs(work, exist_ok=True)
    track_path, bar_path = os.path.join(work, f"{name}-track.png"), os.path.join(work, f"{name}-bar.png")
    track_rgb = (0, 0, 0) if _luminance(fill) > 0.2 else (255, 255, 255)
    Image.new("RGBA", (width, bar_h), (*track_rgb, 70)).save(track_path)
    Image.new("RGBA", (width, bar_h), (*fill, 255)).save(bar_path)
    seconds = max(0.1, float(duration_s))
    return [Layer(track_path, "0", "0"), Layer(bar_path, f"-w+w*min(1,t/{seconds:.3f})", "0")]


def _shadowed(card: Image.Image, radius: int, blur: int = 18, offset: int = 8, opacity: int = 90) -> Image.Image:
    """The card on a soft drop shadow (the canvas grows by the blur on every side)."""
    pad = blur * 2
    canvas = Image.new("RGBA", (card.width + 2 * pad, card.height + 2 * pad), (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((pad, pad + offset, pad + card.width, pad + card.height + offset),
                                             radius=radius, fill=(0, 0, 0, opacity))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(blur)))
    canvas.alpha_composite(card, (pad, pad))
    return canvas


def comment_box_height(basis: int) -> int:
    """The comment box's height (without its shadow) on a frame `basis` px across (its short side)."""
    return round(124 * basis / 1080)


def comment_box_image(keyword: str, typed: int, width: int, path: str, dark: bool = False, cursor: bool = True) -> tuple[int, int, int]:
    """The comment box with the first `typed` letters of the keyword (0: the "Add a comment…" placeholder), a cursor
    and "Post". Returns (image width, image height, the shadow's padding around the box)."""
    s = width / 1080
    box_w, box_h = round(width * 0.82), comment_box_height(width)
    fill = (30, 30, 32, 242) if dark else (255, 255, 255, 246)
    ink = (245, 245, 245) if dark else (20, 20, 22)
    muted = (150, 150, 156) if dark else (140, 140, 146)
    card = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    radius = box_h // 2
    draw.rounded_rectangle((0, 0, box_w - 1, box_h - 1), radius=radius, fill=fill,
                           outline=(70, 70, 74, 255) if dark else (222, 222, 226, 255), width=max(1, round(2 * s)))
    # A generic avatar: a circle with a head and shoulders.
    d = round(box_h * 0.62)
    ax, ay = round(box_h * 0.22), (box_h - d) // 2
    face_bg = (78, 78, 84) if dark else (214, 214, 220)
    figure = (128, 128, 136) if dark else (170, 170, 178)
    avatar = Image.new("RGBA", (d, d), (0, 0, 0, 0))
    ad = ImageDraw.Draw(avatar)
    ad.ellipse((0, 0, d - 1, d - 1), fill=face_bg)
    ad.ellipse((d * 0.33, d * 0.18, d * 0.67, d * 0.52), fill=figure)
    ad.ellipse((d * 0.16, d * 0.58, d * 0.84, d * 1.2), fill=figure)
    mask = Image.new("L", (d, d), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, d - 1, d - 1), fill=255)
    card.paste(avatar, (ax, ay), Image.composite(avatar, Image.new("RGBA", (d, d), (0, 0, 0, 0)), mask))
    post_font = _ui_font(round(42 * s), "Bold")
    post_w = draw.textlength("Post", font=post_font)
    post_x = box_w - round(box_h * 0.32) - post_w
    text_x = ax + d + round(26 * s)
    max_text = post_x - text_x - round(24 * s)
    text = keyword[:typed]
    size = round(46 * s)
    font = _ui_font(size, "SemiBold")
    while size > 20 and draw.textlength(text or "Add a comment…", font=font) > max_text:
        size -= 2
        font = _ui_font(size, "SemiBold")
    mid = box_h / 2
    if text:
        draw.text((text_x, mid), text, font=font, fill=(*ink, 255), anchor="lm")
        caret_x = text_x + draw.textlength(text, font=font) + round(5 * s)
    else:
        draw.text((text_x + round(14 * s), mid), "Add a comment…", font=font, fill=(*muted, 255), anchor="lm")
        caret_x = text_x
    if cursor:
        caret_h = round(size * 1.05)
        draw.rounded_rectangle((caret_x, mid - caret_h / 2, caret_x + max(3, round(4 * s)), mid + caret_h / 2),
                               radius=2, fill=(*POST_BLUE, 255))
    draw.text((post_x, mid), "Post", font=post_font, fill=(*POST_BLUE, 255 if text else 110), anchor="lm")
    out = _shadowed(card, radius, blur=round(16 * s), offset=round(8 * s), opacity=110 if not dark else 140)
    out.save(path)
    return out.width, out.height, round(16 * s) * 2


def comment_box_layers(work: str, keyword: str, width: int, center_y: float, end_s: float, dark: bool = False,
                       basis: Optional[int] = None) -> list[Layer]:
    """In the last ~2.5 s: the box pops in empty, types the keyword letter by letter, then its cursor blinks.
    Nothing without a keyword."""
    keyword = (keyword or "").strip()
    if not keyword or end_s < 1.5:
        return []
    os.makedirs(work, exist_ok=True)
    basis = basis or width
    start = max(end_s * 0.4, end_s - COMMENT_SECONDS)
    typing_from = start + COMMENT_TYPE_DELAY
    step = min(0.11, max(0.04, (end_s - 0.7 - typing_from) / max(1, len(keyword))))
    layers: list[Layer] = []
    times = [typing_from + step * k for k in range(len(keyword))]
    states = [(0, start, times[0])] + [(k + 1, times[k], times[k + 1] if k + 1 < len(times) else None) for k in range(len(keyword))]
    for typed, a, b in states:
        if b is None:
            break
        path = os.path.join(work, f"comment-{typed:02d}.png")
        w, h, _ = comment_box_image(keyword, typed, basis, path, dark)
        x, y = (width - w) / 2, center_y - h / 2
        if typed == 0:
            px, py = pop_xy(x, y, w, h, start)
            layers.append(Layer(path, px, py, f"between(t,{a:.3f},{b:.3f})", pop_filter(start)))
        else:
            layers.append(Layer(path, f"{x:.0f}", f"{y:.0f}", f"between(t,{a:.3f},{b:.3f})"))
    done = times[-1]
    for cursor, phase in ((True, "lt"), (False, "gte")):
        path = os.path.join(work, f"comment-done-{'on' if cursor else 'off'}.png")
        w, h, _ = comment_box_image(keyword, len(keyword), basis, path, dark, cursor=cursor)
        layers.append(Layer(path, f"{(width - w) / 2:.0f}", f"{center_y - h / 2:.0f}",
                            f"gte(t,{done:.3f})*{phase}(mod(t-{done:.3f},0.9),0.5)"))
    return layers


def frame_is_dark(video: str, at_s: float, region: Optional[tuple[float, float, float, float]] = None) -> bool:
    """Whether the picture around a region (x, y, w, h as shares of the frame) is dark at at_s (a light box then
    reads best... a dark one on light). Unreadable: False."""
    try:
        import cv2
    except ImportError:  # pragma: no cover
        return False
    capture = cv2.VideoCapture(video)
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, at_s) * 1000)
        ok, frame = capture.read()
        if not ok or frame is None:
            return False
        h, w = frame.shape[:2]
        x0, y0, rw, rh = region or (0.1, 0.3, 0.8, 0.4)
        part = frame[int(y0 * h):max(int(y0 * h) + 1, int((y0 + rh) * h)), int(x0 * w):max(int(x0 * w) + 1, int((x0 + rw) * w))]
        return float(cv2.cvtColor(part, cv2.COLOR_BGR2GRAY).mean()) < 70
    except Exception:  # noqa: BLE001
        return False
    finally:
        capture.release()


def tag_label(kind: str, label: Optional[str] = None) -> str:
    text = " ".join((label or "").split()).upper()
    if not text:
        text = "SCREEN RECORDING" if kind == "screen" else "B-ROLL"
    return text[:28]


def broll_tag_image(text: str, width: int, path: str) -> tuple[int, int]:
    """A small dark tag with a red dot ("● B-ROLL")."""
    s = width / 1080
    size = round(26 * s)
    font = _ui_font(size, "ExtraBold")
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    dot = round(size * 0.5)
    pad_x, pad_y, gap = round(size * 0.6), round(size * 0.42), round(size * 0.45)
    text_w = probe.textlength(text, font=font)
    w, h = round(pad_x * 2 + dot + gap + text_w + size * 0.08 * len(text)), size + pad_y * 2
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=round(h * 0.28), fill=(10, 10, 12, 175))
    draw.ellipse((pad_x, (h - dot) / 2, pad_x + dot, (h + dot) / 2), fill=(255, 59, 48, 255))
    x = pad_x + dot + gap
    for ch in text:  # a little tracking, like a camera's on-screen label
        draw.text((x, h / 2), ch, font=font, fill=(255, 255, 255, 255), anchor="lm")
        x += probe.textlength(ch, font=font) + size * 0.08
    img.save(path)
    return w, h


def broll_tag_layers(work: str, windows: Sequence[tuple[float, float, str]], width: int, top: int,
                     margin: Optional[int] = None, basis: Optional[int] = None) -> list[Layer]:
    """A tag at the top right of each b-roll / screen recording window (start s, end s, label), at or below `top`."""
    os.makedirs(work, exist_ok=True)
    margin = round(width * 0.037) if margin is None else margin
    layers = []
    for i, (a, b, text) in enumerate(windows):
        if b - a < 0.4:
            continue
        path = os.path.join(work, f"broll-tag-{i}.png")
        w, _ = broll_tag_image(text, basis or width, path)
        layers.append(Layer(path, str(width - w - margin), str(top), f"between(t,{a:.3f},{b:.3f})",
                            f"format=rgba,fade=t=in:st={a:.3f}:d=0.15:alpha=1"))
    return layers


def underline_image(width: int, thickness: int, path: str, reveal: float = 1.0, seed: int = 7) -> tuple[int, int]:
    """A hand-drawn red underline `width` px long, drawn up to `reveal` (0-1) of its length from the left."""
    rng = random.Random(seed)
    pad = thickness * 2
    w, h = width + 2 * pad, thickness * 7
    scale = 3  # drawn large, then shrunk: smooth edges
    img = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    points = []
    steps = 28
    lift = rng.uniform(-0.6, 0.6)
    for k in range(steps + 1):
        f = k / steps
        if f > reveal:
            break
        x = pad + f * width
        # A slight sag, a flick up at the end and a little hand wobble, like a quick marker stroke.
        y = h * 0.5 + thickness * (0.7 * math.sin(math.pi * f) - 1.6 * max(0.0, f - 0.85) / 0.15 * max(0.0, f - 0.85)
                                   + lift * f + 0.18 * math.sin(f * 9 + seed) + rng.uniform(-0.06, 0.06))
        points.append((x * scale, y * scale))
    if len(points) >= 2:
        # The stroke, then a thinner second pass over most of it (a marker goes over a line twice).
        second = points[max(1, len(points) // 12):max(2, len(points) - len(points) // 8)]
        for stroke, width_share, dy in ((points, 1.0, 0.0), (second, 0.6, 0.38)):
            if len(stroke) < 2:
                continue
            stroke = [(x, y + dy * thickness * scale) for x, y in stroke]
            draw.line(stroke, fill=(*UNDERLINE_RED, 240), width=round(thickness * scale * width_share), joint="curve")
            r = thickness * scale * width_share / 2
            for x, y in (stroke[0], stroke[-1]):
                draw.ellipse((x - r, y - r, x + r, y + r), fill=(*UNDERLINE_RED, 240))
    img = img.resize((w, h), Image.LANCZOS)
    img.save(path)
    return w, h


def underline_layers(work: str, rect: tuple[float, float, float, float], start_s: float, frame_w: int,
                     draw_s: float = 0.35, shift: str = "", visible: Optional[tuple[float, float]] = None) -> list[Layer]:
    """A red underline drawn under rect (x, y, w, h in output px) from start_s, left to right over draw_s. With
    `shift` (an expression in t) it moves up by that much (a scrolling screenshot), shown only while its line is
    within `visible` (y range)."""
    x, y, w, h = rect
    if w < 8 or h < 4:
        return []
    os.makedirs(work, exist_ok=True)
    thickness = max(6, min(18, round(h * 0.16), round(frame_w * 0.012)))
    length = round(w * 1.06)
    frames = 6
    layers = []
    for k in range(1, frames + 1):
        path = os.path.join(work, f"underline-{k}.png")
        iw, ih = underline_image(length, thickness, path, k / frames)
        ux = round(x - (length - w) / 2 - thickness * 2)
        uy = round(y + h + thickness * 0.4 - ih / 2)
        a = start_s + draw_s * (k - 1) / frames
        enable = f"gte(t,{a:.3f})" if k == frames else f"between(t,{a:.3f},{start_s + draw_s * k / frames:.3f})"
        y_expr = str(uy)
        if shift:
            y_expr = f"{uy}-({shift})"
            if visible:
                line = f"{uy + ih / 2:.0f}-({shift})"
                enable += f"*between({line},{visible[0]:.0f},{visible[1]:.0f})"
        layers.append(Layer(path, str(ux), y_expr, enable))
    return layers


def parse_highlight(raw: Any) -> Optional[tuple[float, float, float, float]]:
    """An optional highlight box for the key number on a screenshot: [x, y, w, h] as shares of the picture."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        raw = [raw.get(k) for k in ("x", "y", "w", "h")]
    if not isinstance(raw, (list, tuple)) or len(raw) != 4 or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in raw):
        raise ValueError("Invalid highlight")
    x, y, w, h = (float(v) for v in raw)
    if not all(math.isfinite(v) for v in (x, y, w, h)) or x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > 1.0001 or y + h > 1.0001:
        raise ValueError("Invalid highlight")
    return (round(x, 5), round(y, 5), round(w, 5), round(h, 5))


# ---------------------------------------------------------------------------
# Hook-ins: Create (rendering_service)
# ---------------------------------------------------------------------------

def create_punch(graph: str, extras: LookExtras, plan: Any, out_plan: Any, time_map: Any, words: Sequence[tuple[float, float, str]],
                 width: int, height: int, blocked: Sequence[Span]) -> str:
    """Create: the zoom punch on the speaker panel ([base] of the layout graph, width x height), only over
    talking-head shots (never a split, a screen share or the letterbox) and never during b-roll."""
    if not extras.has("punch_zoom") or plan is None or out_plan is None or graph.count("[base]") != 1:
        return graph
    from clip_engine.services.layout_analyzer import LayoutType
    eligible = [(s.start_ms / 1000, s.end_ms / 1000) for s in out_plan.shots
                if s.layout == LayoutType.TALKING_HEAD and len(getattr(s, "manual_crops", None) or []) < 2
                and getattr(s, "content_box", None) is None]
    windows = punch_windows(words, time_map.output_ms / 1000, eligible, blocked)
    if not windows:
        return graph
    zones = []
    if height > width:
        try:
            from clip_engine.services.layout_renderer import face_zones
            zones = face_zones(plan, time_map, width, height)
        except Exception as error:  # noqa: BLE001 - without faces the punch-in centers on the upper middle
            logger.warning(f"Face zones for the zoom punch failed: {type(error).__name__}")
    placed = [(a, b, punch_rect(width, height, zone_center(zones, a * 1000, b * 1000))) for a, b in windows]
    return graph.replace("[base]", "[pz_in]") + ";" + punch_graph("pz_in", "base", width, height, placed)


def create_layers(extras: LookExtras, request: Any, out_plan: Any, work: str, width: int, height: int, bar_h: int,
                  end_s: float, broll: Sequence[tuple[str, float, float]], is_landscape: bool,
                  under: Optional[tuple[int, int, int]] = None, plan: Any = None, time_map: Any = None,
                  background: bool = False) -> list[tuple[str, str, str, str, str]]:
    """Create: the progress bar, the comment box and the b-roll tags, as Create overlays (edited clock)."""
    if not extras:
        return []
    layers: list[Layer] = []
    stem = f"{request.start_time_ms}-{request.end_time_ms}"
    folder = os.path.join(work, f"extras-{stem}")
    if extras.has("broll_tags"):
        from clip_engine.services.layout_analyzer import LayoutType
        windows = [(a, b, tag_label("broll")) for _, a, b in broll]
        covered = _merge((a, b) for a, b, _ in windows)
        for shot in (out_plan.shots if out_plan is not None else []):
            # A screen share with the webcam (SCREEN alone is also the letterbox, so it isn't tagged).
            if shot.layout == LayoutType.SCREEN_CAM and getattr(shot, "source", "") != "fallback":
                for a, b in _subtract([(shot.start_ms / 1000, shot.end_ms / 1000)], covered):
                    windows.append((a, b, tag_label("screen")))
        title_drawn = request.include_title and bool(request.title_text) and not bar_h and not is_landscape
        top = max(bar_h, round(height * 0.06)) + round(height * 0.012)
        if title_drawn:
            top = max(top, round(height * 0.17))
        mark = request.brand_mark or {}
        if mark.get("position") == "top-right":
            top += round(height * 0.04) + round(height * 0.012)
        layers += broll_tag_layers(folder, sorted(windows), width, top, basis=min(width, height))
    if extras.has("comment_box") and extras.keyword:
        basis = min(width, height)
        title_drawn = request.include_title and bool(request.title_text) and not bar_h
        top = max(bar_h, round(height * 0.06)) + round(height * 0.02)
        if title_drawn:
            top = max(top, round(height * (0.17 if not is_landscape else 0.2)))
        faces: list[Rect] = []
        if plan is not None and time_map is not None and not is_landscape and not background:
            try:
                from clip_engine.services.layout_renderer import face_zones
                start_ms = max(end_s * 0.4, end_s - COMMENT_SECONDS) * 1000
                zones = face_zones(plan, time_map, width, height - bar_h)
                faces = [(x0, y0 + bar_h, x1, y1 + bar_h) for x0, y0, x1, y1 in zone_rects(zones, start_ms, end_s * 1000)]
            except Exception as error:  # noqa: BLE001 - placed without knowing the face
                logger.warning(f"Face zones for the comment box failed: {type(error).__name__}")
        caption_top = height * (0.5 if background else 0.62 if not is_landscape else 0.78)
        center = comment_box_center(height, comment_box_height(basis), top, caption_top, faces)
        dark = frame_is_dark(request.video_path, request.end_time_ms / 1000 - 1.0)
        layers += comment_box_layers(folder, extras.keyword, width, center, end_s, dark, basis=basis)
    if extras.has("progress_bar"):
        layers += progress_bar_layers(folder, width, height, end_s, extras.color, under=under if bar_h else None)
    return [layer.as_overlay() for layer in layers]


# ---------------------------------------------------------------------------
# Hook-ins: Remix (remix_service) and Edit my recording (edit_recording)
# ---------------------------------------------------------------------------

def reel_punch(extras: LookExtras, video: str, words: Sequence[tuple[float, float, str]], total_s: float, width: int, height: int,
               src: str, dst: str, *, eligible: Optional[list[Span]] = None, blocked: Sequence[Span] = (),
               shown_size: Optional[tuple[int, int]] = None, offset: tuple[float, float] = (0, 0)) -> str:
    """The zoom punch on a panel-sized stream ([src] -> [dst], width x height) made from `video`, the face found in
    the video itself (`shown_size`/`offset`: how the video is scaled and placed on the panel; default: as is)."""
    if not extras.has("punch_zoom"):
        return f"[{src}]null[{dst}]"
    windows = punch_windows(words, total_s, eligible, blocked)
    if not windows:
        return f"[{src}]null[{dst}]"
    boxes = face_boxes(video, windows, shown_size or (width, height), (round(offset[0]), round(offset[1])))
    placed = [(a, b, punch_rect(width, height, center_of(box))) for (a, b), box in zip(windows, boxes)]
    return punch_graph(src, dst, width, height, placed)


def reel_layers(extras: LookExtras, work: str, *, width: int, height: int, total_s: float, top: int, caption_top: float,
                faces: Sequence[Rect] = (), under: Optional[tuple[int, int, int]] = None,
                broll: Sequence[tuple[float, float, str]] = (), dark: bool = False, tag_top: Optional[int] = None) -> list[Layer]:
    """Remix / Edit my recording: the b-roll tags, the comment box and the progress bar (video clock, full frame).
    `top`: where the free area starts under the hook text; `caption_top`: where the captions begin."""
    if not extras:
        return []
    os.makedirs(work, exist_ok=True)
    layers: list[Layer] = []
    if extras.has("broll_tags") and broll:
        layers += broll_tag_layers(work, list(broll), width, tag_top if tag_top is not None else top)
    if extras.has("comment_box") and extras.keyword:
        center = comment_box_center(height, comment_box_height(width), top, caption_top, faces)
        layers += comment_box_layers(work, extras.keyword, width, center, total_s, dark)
    if extras.has("progress_bar"):
        layers += progress_bar_layers(work, width, height, total_s, extras.color, under=under)
    return layers


def popup_pop(extras: LookExtras) -> bool:
    """Whether pictures the member added (screenshots, pop-up cards) pop in."""
    return extras.has("proof_underline")


def highlight_rect(highlight: Optional[tuple[float, float, float, float]],
                   picture: tuple[float, float, float, float]) -> Optional[tuple[float, float, float, float]]:
    """The highlight box (shares of the picture) as (x, y, w, h) in output px, for a picture drawn at (x, y, w, h)."""
    if not highlight:
        return None
    hx, hy, hw, hh = highlight
    x, y, w, h = picture
    return (x + hx * w, y + hy * h, hw * w, hh * h)
