"""Remix layouts from the "You on camera" reference reels: where the hook text sits, their clip as a phone card,
part 2 as a voiceover over a screen recording, proof screenshots popping in, and leaving a clip's own captions alone.

- Their clip, then me: part 1 is their clip full frame; when it already has captions burned in, ours stay off it.
- React, then my thoughts: part 1 can be "Phone card" (the member's silent reaction fills the frame and their clip
  floats as a rounded card in the lower right, the hook text beside the member's head). Part 2 can be a voiceover
  over a screen recording, with a "Comment KEYWORD" banner pinned at the top and red hand-drawn circles at the
  times and places the member marked.
- Pause & react, split: the hook text in a white rounded box ON the line between the halves.
- Their clip, then me / React, then my thoughts, part 2: up to six proof screenshots pop into the lower half as cards
  (each with an optional small label, and an optional highlight box that the look extras' proof underline uses).

Plain logic and the pictures (PIL) live here so they're tested without FFmpeg; remix_service drives the rendering.
"""

from __future__ import annotations

import glob
import math
import os
import random
import re
from typing import Any, Optional

from PIL import Image, ImageDraw, ImageFilter, ImageFont

THEIR_CAPTIONS = ("auto", "yes", "no")
HOOK_AT = ("top", "seam", "beside")
PART1 = ("box", "phone")
PART2 = ("camera", "screen")
# React, then my thoughts, part 1 with their clip in a box: where the box goes ("auto": clear of the member's face).
BOX_AT = ("auto", "top", "bottom")
CLIP_FORMATS = ("clip_then_me", "react_thoughts")
LAYOUT_FORMATS = ("pause_react", *CLIP_FORMATS)
MAX_PROOFS = 6
MAX_CIRCLES = 8
MAX_LABEL = 24
PROOF_ID = re.compile(r"^p[0-9a-f]{8}$")
SCREEN_ID = re.compile(r"^s[0-9a-f]{8}$")
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
VIDEO_EXTENSIONS = (".mp4", ".mov", ".m4v", ".webm", ".mkv")
# A part-2 time from the app: never past the longest take (3 minutes) and a little.
MAX_AT_S = 185.0

# Proof cards: when each shows (part-2 seconds), never over its first 2 s or last 1.5 s.
PROOF_HEAD_S = 2.0
PROOF_TAIL_S = 1.5
PROOF_MIN_S = 1.5
PROOF_MAX_S = 4.0
PROOF_POP_S = 0.18
PROOF_GAP_S = 0.1
# Where the cards go (a 1080 x 1920 frame): the lower half, under the member's face; captions move under the card.
PROOF_TOP = 0.47
PROOF_MAX_W = 0.84
PROOF_MAX_H = 0.31
PROOF_RADIUS = 26
PROOF_SHADOW = 26
PROOF_CAPTION_GAP = 90
# Circles: shown this long from their time, this big around the marked point.
CIRCLE_S = 2.0
CIRCLE_W = 0.28
CIRCLE_H = 0.11

# Phone card: about 60% of the frame's width, rounded, a soft shadow, in the lower right over the member.
CARD_SHARE = 0.6
CARD_MAX_H = 0.56
CARD_MARGIN = 44
CARD_BOTTOM_SAFE = 300
CARD_RADIUS = 46
CARD_SHADOW = 30

# The hook text on the split line: a white rounded box with black bold text, at most two lines.
SEAM_MAX_W = 0.88
SEAM_FONT = 54
SEAM_MIN_FONT = 36
SEAM_PAD_X = 34
SEAM_PAD_Y = 22
SEAM_RADIUS = 30
# The most the box reaches above or below the line (the credit tag goes under it).
SEAM_HALF = 96

FONTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts"))
BOLD_FONT = "Montserrat-ExtraBold.ttf"


# ---------------------------------------------------------------------------
# The request
# ---------------------------------------------------------------------------

def _finite(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _unit(value: Any) -> bool:
    return _finite(value) and 0 <= value <= 1


def _path(value: Any, extensions: tuple[str, ...]) -> bool:
    return isinstance(value, str) and 0 < len(value) <= 4096 and "\0" not in value and os.path.isabs(value) \
        and value.lower().endswith(extensions)


def parse_highlight(raw: Any) -> Optional[dict]:
    """A highlight box on a screenshot ({x, y, w, h} in 0..1 of the picture), or None. Raises ValueError."""
    if raw is None:
        return None
    if not isinstance(raw, dict) or set(raw) != {"x", "y", "w", "h"} or not all(_unit(raw[k]) for k in "xywh"):
        raise ValueError("Invalid highlight")
    x, y, w, h = (float(raw[k]) for k in "xywh")
    if w < 0.01 or h < 0.01 or x + w > 1.0001 or y + h > 1.0001:
        raise ValueError("Invalid highlight")
    return {"x": round(x, 4), "y": round(y, 4), "w": round(min(w, 1 - x), 4), "h": round(min(h, 1 - y), 4)}


def clean_label(value: Any) -> str:
    """A proof's small label ("Thread", "My post"): plain text, short."""
    if not isinstance(value, str):
        return ""
    return " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", value).split())[:MAX_LABEL]


def default_layout() -> dict:
    return {"their_captions": "auto", "hook_at": "top", "part1": "box", "part2": "camera", "screen": None, "banner": False,
            "circles": [], "proofs": [], "box_at": "auto"}


def parse_layout(raw: Any, fmt: str) -> dict:
    """The layout choices from the app (untrusted), checked for this format. Raises ValueError.

    {"their_captions": auto|yes|no, "hook_at": top|seam|beside, "part1": box|phone, "part2": camera|screen,
     "screen": {"path"} | None, "banner": bool, "circles": [{"at", "x", "y"}], "proofs": [{"id", "path", "at", "label", "highlight"}]}
    """
    out = default_layout()
    if raw is None:
        return out
    if fmt not in LAYOUT_FORMATS or not isinstance(raw, dict) or set(raw) - set(out):
        raise ValueError("Invalid layout")
    their = raw.get("their_captions", "auto")
    hook = raw.get("hook_at", "top")
    part1 = raw.get("part1", "box")
    part2 = raw.get("part2", "camera")
    if their not in THEIR_CAPTIONS or hook not in HOOK_AT or part1 not in PART1 or part2 not in PART2:
        raise ValueError("Invalid layout")
    # Each placement only where it exists: the split line in Pause & react; beside the head with the phone card.
    if (hook == "seam" and fmt != "pause_react") or (hook == "beside" and (fmt != "react_thoughts" or part1 != "phone")):
        raise ValueError("Invalid layout")
    react = fmt == "react_thoughts"
    if not react and (part1 != "box" or part2 != "camera" or raw.get("screen") is not None or raw.get("banner") not in (None, False)
                      or raw.get("circles") not in (None, [])):
        raise ValueError("Invalid layout")
    banner = raw.get("banner", False)
    if not isinstance(banner, bool):
        raise ValueError("Invalid layout")
    box_at = raw.get("box_at", "auto")
    if box_at not in BOX_AT or (box_at != "auto" and (not react or part1 != "box")):
        raise ValueError("Invalid layout")
    screen = raw.get("screen")
    if screen is not None:
        if not isinstance(screen, dict) or set(screen) - {"path", "id", "name"} or not _path(screen.get("path"), VIDEO_EXTENSIONS):
            raise ValueError("Invalid screen recording")
        screen = {"path": screen["path"]}
    if part2 == "screen" and screen is None:
        raise ValueError("Add your screen recording")
    circles = raw.get("circles") or []
    if not isinstance(circles, list) or len(circles) > MAX_CIRCLES:
        raise ValueError("Invalid circles")
    marks = []
    for circle in circles:
        if not isinstance(circle, dict) or set(circle) != {"at", "x", "y"} or not _finite(circle["at"]) \
                or not 0 <= circle["at"] <= MAX_AT_S or not _unit(circle["x"]) or not _unit(circle["y"]):
            raise ValueError("Invalid circles")
        marks.append({"at": round(float(circle["at"]), 2), "x": round(float(circle["x"]), 4), "y": round(float(circle["y"]), 4)})
    proofs = raw.get("proofs") or []
    if not isinstance(proofs, list) or len(proofs) > MAX_PROOFS or (proofs and fmt not in CLIP_FORMATS):
        raise ValueError("Invalid proof screenshots")
    cards, seen = [], set()
    for proof in proofs:
        if not isinstance(proof, dict) or set(proof) - {"id", "path", "at", "label", "highlight", "name"}:
            raise ValueError("Invalid proof screenshots")
        pid, at = proof.get("id"), proof.get("at")
        if not isinstance(pid, str) or not PROOF_ID.match(pid) or pid in seen or not _path(proof.get("path"), IMAGE_EXTENSIONS):
            raise ValueError("Invalid proof screenshots")
        if at is not None and (not _finite(at) or not 0 <= at <= MAX_AT_S):
            raise ValueError("Invalid proof screenshots")
        seen.add(pid)
        cards.append({"id": pid, "path": proof["path"], "at": None if at is None else round(float(at), 2),
                      "label": clean_label(proof.get("label")), "highlight": parse_highlight(proof.get("highlight"))})
    out.update(their_captions=their, hook_at=hook, part1=part1, part2=part2, screen=screen, banner=banner and react,
               circles=sorted(marks, key=lambda c: c["at"]) if part2 == "screen" else [], proofs=cards, box_at=box_at)
    return out


# ---------------------------------------------------------------------------
# Their clip already has captions: a cheap look at the lower half (no OCR)
# ---------------------------------------------------------------------------

def caption_band(frame: Any) -> Optional[tuple[int, int]]:
    """Rows (top, bottom) of a burned-in caption line in the lower half of a gray frame (a 2-D array), or None.

    Text is a short band of rows full of sharp, high-contrast edges (bright letters, usually outlined) that stands
    out from the rest of the picture; busy footage everywhere (foliage, a test pattern) has no such band."""
    import numpy as np
    gray = np.asarray(frame, dtype=np.int16)
    if gray.ndim != 2 or gray.shape[0] < 64 or gray.shape[1] < 36:
        return None
    h, w = gray.shape
    # Captions sit across the middle: a short word fills a good part of the middle 60% of the width.
    gray = gray[:, int(w * 0.2):int(w * 0.8)]
    edges = np.abs(np.diff(gray, axis=1)) > 70
    density = edges.mean(axis=1)
    bright = (gray > 200).mean(axis=1)
    baseline = float(np.median(density))
    lo, hi = int(h * 0.45), int(h * 0.92)
    threshold = max(0.07, baseline * 4 + 0.03)
    hot = (density[lo:hi] > threshold) & (bright[lo:hi] > 0.02)
    best: Optional[tuple[int, int]] = None
    start = None
    for i, on in enumerate([*hot.tolist(), False]):
        if on and start is None:
            start = i
        elif not on and start is not None:
            # The tallest run of busy rows that is the height of one or two caption lines.
            length = i - start
            if h * 0.018 <= length <= h * 0.16 and (best is None or length > best[1] - best[0]):
                best = (lo + start, lo + i)
            start = None
    if best is None:
        return None
    # The band stands out: much busier than the picture just above and below it.
    a, b = best
    pad = max(2, (b - a))
    around = np.concatenate([density[max(0, a - pad * 2):max(0, a - 2)], density[min(h, b + 2):min(h, b + pad * 2)]])
    if around.size and float(np.mean(density[a:b])) < float(np.mean(around)) * 2.2:
        return None
    return best


def has_burned_captions(frames: list) -> bool:
    """Their clip shows captions of its own: a caption band in at least half the sampled frames (at least two)."""
    found = sum(1 for f in frames if caption_band(f) is not None)
    return len(frames) > 0 and found >= max(2, math.ceil(len(frames) / 2))


# ---------------------------------------------------------------------------
# Fonts
# ---------------------------------------------------------------------------

def font_file(name: str) -> Optional[str]:
    path = os.path.join(FONTS, name)
    return path if os.path.isfile(path) else None


def marker_font(look_font: str = "clean") -> tuple[str, bool]:
    """The hand-drawn marker font for hook text beside the head and the comment banner, when the app has one (the look
    extras add it); otherwise the member's hook font. Returns (path, is_marker)."""
    try:
        from clip_engine.services.rendering_service import HEADLINE_FONTS
        fonts: dict = dict(HEADLINE_FONTS)
    except Exception:  # noqa: BLE001 - no rendering service: the files alone
        fonts = {}
    marker = font_file(fonts["marker"]) if isinstance(fonts.get("marker"), str) else None
    if marker:
        return marker, True
    for path in sorted(glob.glob(os.path.join(FONTS, "*Marker*.ttf")) + glob.glob(os.path.join(FONTS, "*Marker*.otf"))):
        return path, True
    own = fonts.get(look_font) if isinstance(fonts.get(look_font), str) else None
    return (font_file(own or BOLD_FONT) or font_file(BOLD_FONT) or ""), False


def _truetype(path: str, size: int) -> Any:
    try:
        return ImageFont.truetype(path, size) if path else ImageFont.load_default()
    except OSError:
        return ImageFont.load_default()


def wrap(draw: ImageDraw.ImageDraw, text: str, font: Any, max_w: int) -> list[str]:
    lines: list[str] = []
    for word in text.split():
        if lines and draw.textlength(f"{lines[-1]} {word}", font=font) <= max_w:
            lines[-1] = f"{lines[-1]} {word}"
        else:
            lines.append(word)
    return lines


# ---------------------------------------------------------------------------
# Hook text: on the split line, or beside the head
# ---------------------------------------------------------------------------

def seam_hook_image(text: str, path: str, frame_w: int) -> tuple[int, int]:
    """The hook text as a white rounded box with black bold text (at most two lines). Returns (w, h)."""
    text = " ".join(text.split())
    draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    max_w = round(frame_w * SEAM_MAX_W) - 2 * SEAM_PAD_X
    bold = font_file(BOLD_FONT) or ""
    size = SEAM_FONT
    while True:
        font = _truetype(bold, size)
        lines = wrap(draw, text, font, max_w)
        if len(lines) <= 2 or size <= SEAM_MIN_FONT:
            break
        size -= 3
    if len(lines) > 2:
        lines = [lines[0], " ".join(lines[1:])]
        while len(lines[1]) > 4 and draw.textlength(lines[1], font=font) > max_w:
            lines[1] = lines[1][:-2].rstrip() + "…"
    elif len(lines) == 2:
        # Balanced: the narrowest wrap that still takes two lines (no lone last word).
        width = max_w
        while width > max_w // 2:
            narrower = wrap(draw, text, font, width - 20)
            if len(narrower) != 2:
                break
            lines, width = narrower, width - 20
    line_h = round(size * 1.18)
    text_w = max(int(draw.textlength(line, font=font)) for line in lines)
    w, h = text_w + 2 * SEAM_PAD_X, line_h * len(lines) + 2 * SEAM_PAD_Y
    pad = 18
    img = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([(pad, pad + 6), (pad + w, pad + h + 6)], radius=SEAM_RADIUS, fill=(0, 0, 0, 90))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(9)))
    out = ImageDraw.Draw(img)
    out.rounded_rectangle([(pad, pad), (pad + w, pad + h)], radius=SEAM_RADIUS, fill=(255, 255, 255, 255))
    y = pad + SEAM_PAD_Y - round(size * 0.06)
    for line in lines:
        lw = out.textlength(line, font=font)
        out.text((pad + (w - lw) / 2, y), line, font=font, fill=(0, 0, 0, 255))
        y += line_h
    img.save(path, "PNG")
    return img.size


def beside_spot(face: Optional[tuple[int, int, int, int]], frame_w: int, frame_h: int, card_top: int) -> dict:
    """Where the hook text goes beside the member's head (frame pixels): the open side of the face, from the top of the
    head down, never into the phone card. Returns {"x", "y", "w", "max_h", "align"}."""
    top_safe = round(frame_h * 0.07)
    margin = 48
    if face is None:
        return {"x": margin, "y": round(frame_h * 0.12), "w": round(frame_w * 0.62), "max_h": max(200, card_top - 40 - round(frame_h * 0.12)), "align": "left"}
    fx, fy, fw, fh = face
    left_room, right_room = fx - margin - 24, frame_w - (fx + fw) - margin - 24
    if max(left_room, right_room) < frame_w * 0.3:
        # The face fills the width: above the head instead.
        y = top_safe
        return {"x": margin, "y": y, "w": frame_w - 2 * margin, "max_h": max(160, fy - 30 - y), "align": "center"}
    left = left_room >= right_room
    w = min(round(frame_w * 0.5), int(max(left_room, right_room)))
    x = margin if left else frame_w - margin - w
    y = max(top_safe, fy - round(fh * 0.15))
    return {"x": x, "y": y, "w": w, "max_h": max(200, card_top - 40 - y), "align": "right" if left else "left"}


def beside_hook_image(text: str, path: str, spot: dict, look_font: str = "clean") -> tuple[int, int]:
    """The hook text beside the head: white marker capitals with a soft dark outline, no bar. Returns (w, h)."""
    font_path, marker = marker_font(look_font)
    text = " ".join(text.split()).upper()
    draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    w, max_h = int(spot["w"]), int(spot["max_h"])
    size = 84 if marker else 70
    while True:
        font = _truetype(font_path, size)
        lines = wrap(draw, text, font, w)
        line_h = round(size * 1.12)
        widest = max(draw.textlength(line, font=font) for line in lines)
        if (len(lines) * line_h <= max_h and widest <= w and len(lines) <= 6) or size <= 36:
            break
        size -= 4
    stroke = max(3, round(size * 0.06))
    pad = stroke + 16
    h = len(lines) * line_h
    img = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)

    def x_of(line: str) -> float:
        lw = draw.textlength(line, font=font)
        return pad + (0 if spot["align"] == "left" else w - lw if spot["align"] == "right" else (w - lw) / 2)
    y = pad
    for line in lines:
        sd.text((x_of(line), y + 5), line, font=font, fill=(0, 0, 0, 170), stroke_width=stroke, stroke_fill=(0, 0, 0, 170))
        y += line_h
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(6)))
    out = ImageDraw.Draw(img)
    y = pad
    for line in lines:
        out.text((x_of(line), y), line, font=font, fill=(255, 255, 255, 255), stroke_width=max(1, stroke // 2), stroke_fill=(20, 20, 20, 230))
        y += line_h
    img.save(path, "PNG")
    return img.size


def banner_image(keyword: str, path: str, frame_w: int, look_font: str = "clean") -> tuple[int, int]:
    """'COMMENT "KEYWORD"' pinned at the top during a how-to part: marker capitals (or the hook font), dark outline."""
    font_path, marker = marker_font(look_font)
    text = f"COMMENT “{keyword.upper()}”"
    draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    size = 78 if marker else 64
    while size > 34 and draw.textlength(text, font=_truetype(font_path, size)) > frame_w - 140:
        size -= 3
    font = _truetype(font_path, size)
    stroke = max(4, round(size * 0.08))
    tw = int(draw.textlength(text, font=font))
    pad = stroke + 18
    img = Image.new("RGBA", (tw + 2 * pad, round(size * 1.25) + 2 * pad), (0, 0, 0, 0))
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((pad, pad + 5), text, font=font, fill=(0, 0, 0, 180), stroke_width=stroke, stroke_fill=(0, 0, 0, 180))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(6)))
    ImageDraw.Draw(img).text((pad, pad), text, font=font, fill=(255, 255, 255, 255), stroke_width=max(2, stroke // 2), stroke_fill=(15, 15, 15, 255))
    img.save(path, "PNG")
    return img.size


# ---------------------------------------------------------------------------
# Phone card
# ---------------------------------------------------------------------------

def phone_card(src_w: int, src_h: int, frame_w: int, frame_h: int) -> dict:
    """Their clip as a card in the lower right (frame pixels): {"x", "y", "w", "h"}, about 60% of the width, never taller
    than CARD_MAX_H of the frame, its bottom clear of the platforms' buttons."""
    aspect = src_h / src_w if src_w > 0 and src_h > 0 else 16 / 9
    w = round(frame_w * CARD_SHARE)
    h = round(w * aspect)
    if h > frame_h * CARD_MAX_H:
        h = round(frame_h * CARD_MAX_H)
        w = round(h / aspect)
    w, h = max(2, w // 2 * 2), max(2, h // 2 * 2)
    x = frame_w - CARD_MARGIN - w
    y = frame_h - CARD_BOTTOM_SAFE - h
    return {"x": x, "y": y, "w": w, "h": h}


def rounded_mask(path: str, w: int, h: int, radius: int) -> str:
    """A white-on-black mask with rounded corners (alphamerge makes the card's corners clear)."""
    scale = 3
    big = Image.new("L", (w * scale, h * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle([(0, 0), (w * scale - 1, h * scale - 1)], radius=radius * scale, fill=255)
    big.resize((w, h), Image.LANCZOS).save(path, "PNG")
    return path


def card_shadow(path: str, w: int, h: int, radius: int, blur: int, alpha: int = 165) -> tuple[str, int]:
    """A soft shadow for a w x h card; returns (path, how far it reaches past the card on each side)."""
    reach = blur * 2
    img = Image.new("RGBA", (w + 2 * reach, h + 2 * reach), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([(reach, reach + blur // 2), (reach + w, reach + h + blur // 2)], radius=radius, fill=(0, 0, 0, alpha))
    img.filter(ImageFilter.GaussianBlur(blur)).save(path, "PNG")
    return path, reach


# ---------------------------------------------------------------------------
# Part 2: a screen recording, circles, proof cards
# ---------------------------------------------------------------------------

def fit_rect(src_w: int, src_h: int, frame_w: int, frame_h: int) -> tuple[int, int, int, int]:
    """A screen recording fitted whole into the frame (x, y, w, h), centered (blurred fill around it)."""
    if src_w <= 0 or src_h <= 0:
        return 0, 0, frame_w, frame_h
    scale = min(frame_w / src_w, frame_h / src_h)
    w, h = max(2, round(src_w * scale) // 2 * 2), max(2, round(src_h * scale) // 2 * 2)
    return (frame_w - w) // 2, (frame_h - h) // 2, w, h


def circle_spots(circles: list[dict], rect: tuple[int, int, int, int], frame_w: int, frame_h: int, take_s: float) -> list[dict]:
    """Each circle on the frame: {"start", "end", "cx", "cy", "w", "h"}; the marked point is on the screen recording
    (0..1 of its picture). Circles past the end of the take are dropped; overlapping times are fine."""
    x0, y0, rw, rh = rect
    w, h = round(frame_w * CIRCLE_W) // 2 * 2, round(frame_h * CIRCLE_H) // 2 * 2
    out = []
    for c in circles[:MAX_CIRCLES]:
        start = float(c["at"])
        if start >= take_s - 0.3:
            continue
        cx = round(x0 + c["x"] * rw)
        cy = round(y0 + c["y"] * rh)
        out.append({"start": round(start, 2), "end": round(min(take_s, start + CIRCLE_S), 2),
                    "cx": min(max(cx, w // 2), frame_w - w // 2), "cy": min(max(cy, h // 2), frame_h - h // 2), "w": w, "h": h})
    return out


def circle_image(path: str, w: int, h: int, seed: int = 0) -> str:
    """A red hand-drawn circle: two loose, slightly tilted passes of a marker, open where they meet."""
    rng = random.Random(seed)
    scale = 2
    W, H = w * scale, h * scale
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    width = round(min(W, H) * 0.06) + 4
    cx, cy = W / 2, H / 2
    for loop in range(2):
        rx, ry = W / 2 - width * (1.2 + loop * 0.6), H / 2 - width * (1.2 + loop * 0.4)
        tilt = math.radians(rng.uniform(-6, 6))
        start = rng.uniform(-0.6, -0.2)
        points = []
        for i in range(73):
            a = start + (2 * math.pi + 0.5) * i / 72
            wobble = 1 + 0.035 * math.sin(a * 3 + loop) + rng.uniform(-0.008, 0.008)
            x, y = rx * math.cos(a) * wobble, ry * math.sin(a) * wobble
            points.append((cx + x * math.cos(tilt) - y * math.sin(tilt), cy + x * math.sin(tilt) + y * math.cos(tilt)))
        draw.line(points, fill=(232, 28, 36, 245), width=width, joint="curve")
    img.resize((w, h), Image.LANCZOS).save(path, "PNG")
    return path


def proof_times(proofs: list[dict], take_s: float) -> list[Optional[tuple[float, float]]]:
    """When each proof card shows in part 2 ([start, end] seconds, or None when it doesn't fit): the member's time, else
    spread evenly; each 1.5-4 s, never over the first 2 s or the last 1.5 s, one card at a time in order of time (a card
    moves a little earlier when the ones after it need the room)."""
    lo, hi = PROOF_HEAD_S, max(PROOF_HEAD_S, take_s - PROOF_TAIL_S)
    n = len(proofs)
    if not n or hi - lo < PROOF_MIN_S:
        return [None] * n
    gap = PROOF_GAP_S
    fit = min(n, int((hi - lo + gap) // (PROOF_MIN_S + gap)))
    slot = (hi - lo) / n
    desired = [float(p["at"]) if _finite(p.get("at")) else lo + slot * i + min(0.3, slot * 0.1) for i, p in enumerate(proofs)]
    keep = sorted(range(n), key=lambda i: (desired[i], i))[:fit]
    times: list[Optional[tuple[float, float]]] = [None] * n
    prev_end = lo - gap
    for rank, i in enumerate(keep):
        left = fit - rank - 1
        cap = hi - left * (PROOF_MIN_S + gap)
        start = min(max(desired[i], lo, prev_end + gap), cap - PROOF_MIN_S)
        nxt = desired[keep[rank + 1]] if left else hi
        end = min(start + PROOF_MAX_S, max(start + PROOF_MIN_S, nxt - gap), cap)
        times[i] = (round(start, 2), round(end, 2))
        prev_end = end
    return times


def proof_card_image(source: str, path: str, frame_w: int, frame_h: int, label: str = "",
                     highlight: Optional[dict] = None) -> dict:
    """A proof screenshot as a card: fitted into the lower half, rounded, a soft shadow, an optional small label tag
    above its top left. Returns {"w", "h", "card": [x, y, w, h] inside the picture, "highlight": [x, y, w, h] | None}
    (the picture's own pixels; the caller adds where the picture goes)."""
    from PIL import ImageOps
    with Image.open(source) as opened:
        picture = ImageOps.exif_transpose(opened).convert("RGBA")
    max_w, max_h = round(frame_w * PROOF_MAX_W), round(frame_h * PROOF_MAX_H)
    scale = min(max_w / picture.width, max_h / picture.height)
    cw, ch = max(2, round(picture.width * scale)), max(2, round(picture.height * scale))
    picture = picture.resize((cw, ch), Image.LANCZOS)
    mask = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle([(0, 0), (cw - 1, ch - 1)], radius=PROOF_RADIUS, fill=255)
    picture.putalpha(Image.composite(picture.getchannel("A"), Image.new("L", (cw, ch), 0), mask))
    tag = None
    tag_h = 0
    if label:
        bold = _truetype(font_file(BOLD_FONT) or "", 30)
        draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
        tw = int(draw.textlength(label, font=bold))
        tag = Image.new("RGBA", (tw + 36, 50), (0, 0, 0, 0))
        td = ImageDraw.Draw(tag)
        td.rounded_rectangle([(0, 0), (tw + 35, 49)], radius=25, fill=(18, 18, 18, 235))
        td.text((18, 7), label, font=bold, fill=(255, 255, 255, 255))
        tag_h = 50 + 12
    reach = PROOF_SHADOW * 2
    W, H = cw + 2 * reach, ch + 2 * reach + tag_h
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([(reach, reach + tag_h + 10), (reach + cw, reach + tag_h + ch + 10)], radius=PROOF_RADIUS, fill=(0, 0, 0, 130))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(PROOF_SHADOW)))
    img.alpha_composite(picture, (reach, reach + tag_h))
    if tag is not None:
        img.alpha_composite(tag, (reach + 6, reach))
    img.save(path, "PNG")
    box = [reach, reach + tag_h, cw, ch]
    lit = None
    if highlight:
        lit = [reach + round(highlight["x"] * cw), reach + tag_h + round(highlight["y"] * ch), round(highlight["w"] * cw), round(highlight["h"] * ch)]
    return {"w": W, "h": H, "card": box, "highlight": lit}


def proof_spot(card: dict, frame_w: int, frame_h: int) -> tuple[int, int]:
    """Where a proof card's picture goes (x, y in frame pixels): centered across, its card's top at PROOF_TOP."""
    x = (frame_w - card["w"]) // 2
    y = round(frame_h * PROOF_TOP) - card["card"][1]
    return x, y


def proof_caption_y(card_bottom: int, frame_h: int, default_y: int) -> int:
    """Captions while a proof card shows: under the card, clear of the platforms' buttons."""
    return int(min(frame_h - 240, max(default_y, card_bottom + PROOF_CAPTION_GAP)))


def proof_anchors(windows: list[tuple[float, float, int]], default_y: int) -> list[list[int]]:
    """Caption anchors ([until_ms, y]) for the proof windows ((start_s, end_s, y), on the final video's clock): the
    usual line before and after each card, under the card while it shows."""
    out: list[list[int]] = []
    for start, end, y in sorted(windows):
        out.append([round(start * 1000), default_y])
        out.append([round(end * 1000), int(y)])
    return out
