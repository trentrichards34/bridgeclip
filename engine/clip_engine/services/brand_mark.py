"""The member's brand on the video: a small @handle and/or logo in a corner, and
the rounded tags (credit, AI presenter mark, "Comment KEYWORD") Remix and
Create draw with PIL.

The mark is about 4% of the frame height at 70% opacity, placed in the corner
the member chose, below the hook text and clear of the captions (the caller
passes where those end). Create (rendering_service), Remix (remix_service,
including recompose) and Avatar Studio share it.
"""
from __future__ import annotations

import os
import re
from typing import Any, Optional

from PIL import Image, ImageDraw, ImageFont

POSITIONS = ("top-left", "top-right", "bottom-left", "bottom-right")
MAX_HANDLE_CHARS = 30
MARK_HEIGHT = 0.04
MARK_OPACITY = 0.70
# Corner margin as a share of the frame width (40 px on 1080).
MARK_MARGIN = 0.037
# Top marks start at least this far down (the platforms' own top bar), bottom marks end above this line
# (the caption and the post's description and buttons at the bottom of the screen).
TOP_SAFE = 0.06
BOTTOM_LINE = 0.84
BOTTOM_LIMIT = 0.90
# A mark never takes more than this share of the frame width.
MAX_MARK_WIDTH = 0.42
LOGO_EXTENSIONS = (".png",)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _font(size: int) -> ImageFont.FreeTypeFont:
    for name in ("Montserrat-ExtraBold.ttf", "Montserrat-Black.ttf"):
        for base in (os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts"), "/app/assets/fonts"):
            path = os.path.join(base, name)
            if os.path.isfile(path):
                return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def tag_image(text: str, path: str, size: int = 30, fill: tuple[int, int, int, int] = (0, 0, 0, 165),
              color: tuple[int, int, int, int] = (255, 255, 255, 255), max_w: int = 0) -> tuple[int, int]:
    """A rounded tag (credit, AI presenter mark, comment-keyword call to action); dark with white text by default.
    With max_w, a long text gets a smaller font (down to 2/3 size), then an ellipsis, so the tag fits."""
    draw = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    if max_w:
        smallest = max(14, round(size * 2 / 3))
        while size > smallest and draw.textlength(text, font=_font(size)) + 2 * round(size * 0.6) > max_w:
            size -= 1
        while len(text) > 4 and draw.textlength(text, font=_font(size)) + 2 * round(size * 0.6) > max_w:
            text = text[:-2].rstrip() + "…"
    font = _font(size)
    text_w = int(draw.textlength(text, font=font))
    pad_x, pad_y = round(size * 0.6), round(size * 0.4)
    w, h = text_w + pad_x * 2, size + pad_y * 2
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out = ImageDraw.Draw(img)
    out.rounded_rectangle([(0, 0), (w - 1, h - 1)], radius=h // 2, fill=fill)
    out.text((pad_x, pad_y - round(size * 0.08)), text, font=font, fill=color)
    img.save(path, "PNG")
    return w, h


def keyword_tag(keyword: str, path: str, frame_w: int, size: int = 44) -> tuple[int, int]:
    """The "Comment KEYWORD" tag at the end of a video (white with dark text, like Remix silent react)."""
    return tag_image(f"Comment {keyword}", path, size, fill=(255, 255, 255, 240), color=(10, 10, 10, 255), max_w=frame_w - 120)


def validate_brand_mark(raw: Any) -> Optional[dict]:
    """A brand mark from the app ({"handle", "logo_path", "position"}), checked; None for none."""
    if raw is None:
        return None
    if not isinstance(raw, dict) or not set(raw) <= {"handle", "logo_path", "position"}:
        raise ValueError("Invalid brand mark")
    handle = raw.get("handle") or ""
    if not isinstance(handle, str) or _CONTROL.search(handle) or len(handle) > MAX_HANDLE_CHARS:
        raise ValueError("Invalid brand mark")
    logo = raw.get("logo_path")
    if logo is not None and (not isinstance(logo, str) or "\0" in logo or not os.path.isabs(logo)
                             or not logo.lower().endswith(LOGO_EXTENSIONS) or len(logo) > 4096):
        raise ValueError("Invalid brand mark")
    position = raw.get("position") or "bottom-right"
    if position not in POSITIONS:
        raise ValueError("Invalid brand mark")
    handle = " ".join(handle.split())
    if logo is not None and not os.path.isfile(logo):
        logo = None
    if not handle and not logo:
        return None
    return {"handle": handle, "logo_path": logo, "position": position}


def mark_image(mark: dict, path: str, frame_w: int, frame_h: int) -> Optional[tuple[int, int]]:
    """Draw the mark (logo, handle, or the logo then the handle) at ~4% of the frame height and 70% opacity.
    Returns (width, height), or None when there is nothing to draw (or the logo can't be read and there's no handle)."""
    height = max(24, round(frame_h * MARK_HEIGHT))
    max_w = round(frame_w * MAX_MARK_WIDTH)
    logo = None
    if mark.get("logo_path"):
        try:
            with Image.open(mark["logo_path"]) as source:
                source.load()
                logo = source.convert("RGBA")
        except (OSError, ValueError, Image.DecompressionBombError):
            logo = None
    handle = mark.get("handle") or ""
    if logo is None and not handle:
        return None
    parts: list[Image.Image] = []
    if logo is not None:
        inner = height if not handle else height - 2 * round(height * 0.12)
        scale = inner / max(1, logo.height)
        lw = max(1, min(round(logo.width * scale), max_w if not handle else max_w // 2))
        lh = max(1, round(logo.height * min(scale, lw / max(1, logo.width))))
        parts.append(logo.resize((lw, lh), Image.LANCZOS))
    if handle:
        tag_path = path + ".tag.png"
        room = max_w - (parts[0].width + round(height * 0.2) if parts else 0)
        size = round(height / 1.8)
        tag_image(handle, tag_path, size, fill=(0, 0, 0, 150), max_w=room)
        with Image.open(tag_path) as tag:
            tag_img = tag.convert("RGBA")
        os.remove(tag_path)
        if tag_img.height != height:
            tag_img = tag_img.resize((max(1, round(tag_img.width * height / tag_img.height)), height), Image.LANCZOS)
        parts.append(tag_img)
    gap = round(height * 0.2) if len(parts) == 2 else 0
    w = min(max_w, sum(p.width for p in parts) + gap)
    canvas = Image.new("RGBA", (w, height), (0, 0, 0, 0))
    x = 0
    for part in parts:
        canvas.alpha_composite(part, (x, (height - part.height) // 2))
        x += part.width + gap
    alpha = canvas.getchannel("A").point(lambda a: round(a * MARK_OPACITY))
    canvas.putalpha(alpha)
    canvas.save(path, "PNG")
    return canvas.width, canvas.height


def mark_position(position: str, frame_w: int, frame_h: int, w: int, h: int, *, top_from: int = 0,
                  captions_to: int = 0) -> tuple[int, int]:
    """Where the mark goes: its corner, below `top_from` (the hook text) for top corners, and for bottom
    corners under `captions_to` (where the captions end) but above the platform's description area."""
    margin = round(frame_w * MARK_MARGIN)
    x = margin if position.endswith("left") else frame_w - w - margin
    if position.startswith("top"):
        y = max(round(frame_h * TOP_SAFE), top_from + margin // 2)
    else:
        y = max(round(frame_h * BOTTOM_LINE) - h, captions_to + margin // 2)
        y = min(y, round(frame_h * BOTTOM_LIMIT) - h)
    return max(0, x), max(0, min(frame_h - h, y))


def _hashtag(tag: str) -> Optional[str]:
    """Same as the app's hashtagFor: letters and numbers only, words joined in camel case."""
    import unicodedata
    words = [w for w in re.split(r"[^\w]+|_", unicodedata.normalize("NFKC", tag)) if w]
    if not words:
        return None
    joined = words[0] if len(words) == 1 else "".join(w[:1].upper() + w[1:] for w in words)
    return f"#{joined[:60]}"


def cta_line(keyword: str, offer: str) -> str:
    """The comment-keyword line (the app and Remix write the same words)."""
    offer = " ".join((offer or "").split()).rstrip(".!? ")
    return f"Comment {keyword} and I'll send you {offer}." if offer else f"Comment {keyword} and I'll send you the full breakdown."


def create_post_caption(segment: Any, keyword: str, offer: str, max_tags: int = 5) -> Optional[str]:
    """A Create clip's ready-to-post caption when the run has a comment keyword: the title and hashtags
    (as the app would write them) and the call to action last. None without a keyword, so the app's own default stays."""
    if not keyword:
        return None
    title = " ".join((getattr(segment, "summary", None) or getattr(segment, "headline", None) or "").split())
    hashtags: list[str] = []
    seen: set[str] = set()
    for tag in getattr(segment, "tags", None) or []:
        if not isinstance(tag, str):
            continue
        hashtag = _hashtag(tag)
        if not hashtag or hashtag.lower() in seen:
            continue
        seen.add(hashtag.lower())
        hashtags.append(hashtag)
        if len(hashtags) == max_tags:
            break
    return "\n\n".join(part for part in (title, " ".join(hashtags), cta_line(keyword, offer)) if part)
