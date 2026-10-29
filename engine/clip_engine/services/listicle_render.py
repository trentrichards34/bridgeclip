"""Faceless "Top N" list videos (Avatar Studio → Top list).

Each video is a fixed branded header at the top, a title with one italic
serif accent word, numbered chips as a progress row (the current one lit),
the member's screenshot with a glowing highlight box on the part they marked
(or the picture filling the card), word-sweep captions at the bottom (spoken
words white, upcoming ones grey) and an end card with a "Follow @handle"
button. Main writes the voiceover per part (intro, each item) and passes the
word timings; this module draws every distinct frame once with PIL and lets
FFmpeg hold each one for as long as it shows.
"""
from __future__ import annotations

import math
import os
import re
import subprocess
from dataclasses import dataclass, field
from typing import Callable, Optional

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

W, H, FPS = 1080, 1920, 30
MIN_ITEMS, MAX_ITEMS = 3, 7
MAX_SEGMENT_MS = 60_000
MAX_TOTAL_MS = 4 * 60_000
MAX_WORDS_PER_SEGMENT = 160
CHUNK_WORDS = 6
CHUNK_CHARS = 28
# The card "pops" in over these offsets (ms) at the start of an item; the highlight box lights up after BOX_DELAY_MS.
POP_STEPS = ((0, 0.94), (40, 0.965), (80, 0.985), (120, 1.0))
BOX_DELAY_MS = 450

BG_TOP = (12, 12, 16)
BG_BOTTOM = (22, 22, 30)
CARD_BG = (26, 26, 34)
WHITE = (255, 255, 255)
GREY = (255, 255, 255, 92)
DEFAULT_ACCENT = "#7CE7AC"

FONT_DIR_CANDIDATES = (
    os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts"),
    "/app/assets/fonts",
)

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


class ListicleSpecError(ValueError):
    """The request from main is not a valid list video."""


# ---------------------------------------------------------------------------
# Spec
# ---------------------------------------------------------------------------

@dataclass
class Word:
    word: str
    start_ms: int
    end_ms: int


@dataclass
class Box:
    x: float
    y: float
    w: float
    h: float


@dataclass
class Segment:
    kind: str  # intro | item | end
    duration_ms: int
    title: str = ""
    accent: str = ""
    index: int = 0  # 1-based item number
    image: Optional[str] = None
    box: Optional[Box] = None
    line: str = ""
    audio: Optional[str] = None
    words: list[Word] = field(default_factory=list)


@dataclass
class ListicleSpec:
    header: str
    accent_color: tuple[int, int, int]
    handle: str
    captions: bool
    count: int
    segments: list[Segment]
    names: list[str]

    @property
    def duration_ms(self) -> int:
        return sum(segment.duration_ms for segment in self.segments)


def _text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return _CONTROL.sub(" ", value).replace(" ", " ").strip()[:limit]


def _hex(value: object) -> tuple[int, int, int]:
    color = value if isinstance(value, str) and _HEX.match(value) else DEFAULT_ACCENT
    return tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def _path(value: object) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str) or not os.path.isabs(value) or "\0" in value:
        raise ListicleSpecError("Invalid path")
    return value


def _box(value: object) -> Optional[Box]:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ListicleSpecError("Invalid highlight box")
    try:
        x, y, w, h = (float(value[k]) for k in ("x", "y", "w", "h"))
    except (KeyError, TypeError, ValueError) as error:
        raise ListicleSpecError("Invalid highlight box") from error
    if not all(math.isfinite(v) for v in (x, y, w, h)) or w <= 0.01 or h <= 0.01 or x < 0 or y < 0 or x + w > 1.0001 or y + h > 1.0001:
        raise ListicleSpecError("Invalid highlight box")
    return Box(x, y, w, h)


def _words(value: object, duration_ms: int) -> list[Word]:
    if not isinstance(value, list):
        return []
    out: list[Word] = []
    for item in value[:MAX_WORDS_PER_SEGMENT]:
        if not isinstance(item, dict):
            continue
        word = _text(item.get("word"), 40)
        try:
            start, end = int(item.get("start_ms", 0)), int(item.get("end_ms", 0))
        except (TypeError, ValueError):
            continue
        if not word or start >= duration_ms:
            continue
        start = max(0, start)
        out.append(Word(word, start, max(start + 1, min(end, duration_ms))))
    out.sort(key=lambda w: w.start_ms)
    return out


def parse_spec(raw: object) -> ListicleSpec:
    """Validate main's request (untrusted JSON) into a spec."""
    if not isinstance(raw, dict):
        raise ListicleSpecError("Invalid request")
    items = raw.get("segments")
    if not isinstance(items, list) or not items:
        raise ListicleSpecError("No segments")
    segments: list[Segment] = []
    for item in items[: MAX_ITEMS + 2]:
        if not isinstance(item, dict) or item.get("kind") not in ("intro", "item", "end"):
            raise ListicleSpecError("Invalid segment")
        try:
            duration = int(item.get("duration_ms", 0))
        except (TypeError, ValueError) as error:
            raise ListicleSpecError("Invalid duration") from error
        if duration < 300 or duration > MAX_SEGMENT_MS:
            raise ListicleSpecError("Invalid duration")
        segment = Segment(
            kind=item["kind"], duration_ms=duration, title=_text(item.get("title"), 90), accent=_text(item.get("accent"), 40),
            line=_text(item.get("line"), 160), image=_path(item.get("image")), box=_box(item.get("box")), audio=_path(item.get("audio")),
            words=_words(item.get("words"), duration),
        )
        if segment.kind == "item":
            try:
                segment.index = int(item.get("index", 0))
            except (TypeError, ValueError) as error:
                raise ListicleSpecError("Invalid item number") from error
        segments.append(segment)
    numbers = [s.index for s in segments if s.kind == "item"]
    count = len(numbers)
    if count < MIN_ITEMS or count > MAX_ITEMS or numbers != list(range(1, count + 1)):
        raise ListicleSpecError("Items must be numbered 1 to N")
    if sum(s.kind == "intro" for s in segments) > 1 or sum(s.kind == "end" for s in segments) > 1:
        raise ListicleSpecError("Invalid segments")
    spec = ListicleSpec(
        header=_text(raw.get("header"), 40).upper(), accent_color=_hex(raw.get("accent_color")), handle=_text(raw.get("handle"), 30),
        captions=raw.get("captions", True) is not False, count=count, segments=segments,
        names=[s.title for s in segments if s.kind == "item"],
    )
    if spec.duration_ms > MAX_TOTAL_MS:
        raise ListicleSpecError("Too long")
    return spec


# ---------------------------------------------------------------------------
# Fonts and text
# ---------------------------------------------------------------------------

_font_cache: dict[tuple[str, int, int], ImageFont.FreeTypeFont] = {}


def _font_path(name: str) -> Optional[str]:
    for base in FONT_DIR_CANDIDATES:
        path = os.path.abspath(os.path.join(base, name))
        if os.path.isfile(path):
            return path
    return None


def sans(size: int, weight: int = 800) -> ImageFont.FreeTypeFont:
    key = ("sans", size, weight)
    if key not in _font_cache:
        path = _font_path("PlusJakartaSans.ttf")
        if path:
            font = ImageFont.truetype(path, size)
            try:
                font.set_variation_by_axes([weight])
            except Exception:  # noqa: BLE001 - a build without variation support keeps the default weight
                pass
        else:
            fallback = _font_path("Montserrat-ExtraBold.ttf")
            font = ImageFont.truetype(fallback, size) if fallback else ImageFont.load_default()
        _font_cache[key] = font
    return _font_cache[key]


def serif_italic(size: int) -> ImageFont.FreeTypeFont:
    key = ("serif", size, 0)
    if key not in _font_cache:
        path = _font_path("InstrumentSerif-Italic.ttf")
        _font_cache[key] = ImageFont.truetype(path, size) if path else sans(size)
    return _font_cache[key]


def _bare(word: str) -> str:
    return re.sub(r"[^\w'’-]", "", word).lower()


def accent_index(title: str, accent: str) -> int:
    """Index of the accent word in the title (its last occurrence), or the last word when it isn't there."""
    words = title.split()
    if not words:
        return -1
    target = _bare(accent)
    if target:
        for i in range(len(words) - 1, -1, -1):
            if _bare(words[i]) == target:
                return i
    return len(words) - 1


@dataclass
class _Run:
    text: str
    font: ImageFont.FreeTypeFont
    serif: bool
    width: float


def _title_lines(title: str, accent: str, max_w: int, size: int) -> tuple[list[list[_Run]], int]:
    words = title.split()
    accent_at = accent_index(title, accent)
    draw = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    space = draw.textlength(" ", font=sans(size))
    runs = []
    for i, word in enumerate(words):
        serif = i == accent_at
        font = serif_italic(round(size * 1.22)) if serif else sans(size)
        runs.append(_Run(word, font, serif, draw.textlength(word, font=font)))
    lines: list[list[_Run]] = []
    current: list[_Run] = []
    width = 0.0
    for run in runs:
        add = run.width + (space if current else 0)
        if current and width + add > max_w:
            lines.append(current)
            current, width = [run], run.width
        else:
            current.append(run)
            width += add
    if current:
        lines.append(current)
    return lines, int(space)


def draw_title(img: Image.Image, title: str, accent: str, top: int, color: tuple[int, int, int], max_w: int = 960) -> int:
    """Centered title, the accent word in italic serif and the accent color; returns the bottom y."""
    if not title:
        return top
    size = 78
    lines, space = _title_lines(title, accent, max_w, size)
    while (len(lines) > 3 or any(sum(r.width for r in line) + space * (len(line) - 1) > max_w for line in lines)) and size > 44:
        size -= 4
        lines, space = _title_lines(title, accent, max_w, size)
    draw = ImageDraw.Draw(img)
    line_h = round(size * 1.18)
    y = top
    for line in lines:
        total = sum(r.width for r in line) + space * (len(line) - 1)
        x = (W - total) / 2
        baseline = y + round(size * 0.92)
        for run in line:
            ascent = run.font.getmetrics()[0]
            fill = color if run.serif else WHITE
            draw.text((x, baseline - ascent), run.text, font=run.font, fill=fill)
            x += run.width + space
        y += line_h
    return y


def _rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    scale = 3
    big = Image.new("L", (size[0] * scale, size[1] * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, big.width - 1, big.height - 1), radius=radius * scale, fill=255)
    return big.resize(size, Image.LANCZOS)


# ---------------------------------------------------------------------------
# Frame parts
# ---------------------------------------------------------------------------

HEADER_Y = 112
TITLE_TOP = 196
CARD_X, CARD_W = 60, 960
CARD_BOTTOM = 1470
CAPTION_CENTER = 1620


def background() -> Image.Image:
    img = Image.new("RGBA", (W, H), BG_TOP + (255,))
    grad = Image.linear_gradient("L").resize((W, H))
    bottom = Image.new("RGBA", (W, H), BG_BOTTOM + (255,))
    return Image.composite(bottom, img, grad)


def draw_header(img: Image.Image, header: str, color: tuple[int, int, int]) -> None:
    if not header:
        return
    font = sans(30, 700)
    draw = ImageDraw.Draw(img)
    tracking = 5
    widths = [draw.textlength(ch, font=font) for ch in header]
    text_w = sum(widths) + tracking * (len(header) - 1)
    dot = 12
    pad_x, pill_h = 30, 64
    total = dot + 16 + text_w
    left = (W - total - pad_x * 2) / 2
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((left, HEADER_Y - pill_h / 2, left + total + pad_x * 2, HEADER_Y + pill_h / 2), radius=pill_h // 2,
                        fill=(255, 255, 255, 14), outline=(255, 255, 255, 46), width=2)
    x = left + pad_x
    d.ellipse((x, HEADER_Y - dot / 2, x + dot, HEADER_Y + dot / 2), fill=color + (255,))
    x += dot + 16
    ascent, descent = font.getmetrics()
    y = HEADER_Y - (ascent + descent) / 2 + 2
    for ch, w in zip(header, widths):
        d.text((x, y), ch, font=font, fill=(255, 255, 255, 215))
        x += w + tracking
    img.alpha_composite(layer)


def draw_chips(img: Image.Image, count: int, current: int, top: int, color: tuple[int, int, int]) -> int:
    """Numbered chips 1..N; `current` (1-based) is lit, earlier ones done, later ones upcoming. Returns the bottom y."""
    size, gap = 72, 18
    total = count * size + (count - 1) * gap
    x = (W - total) // 2
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    font = sans(34, 800)
    for n in range(1, count + 1):
        box = (x, top, x + size, top + size)
        if n == current:
            d.rounded_rectangle(box, radius=22, fill=color + (255,))
            fill = BG_TOP + (255,)
        elif current and n < current:
            d.rounded_rectangle(box, radius=22, fill=(255, 255, 255, 34))
            fill = (255, 255, 255, 200)
        else:
            d.rounded_rectangle(box, radius=22, outline=(255, 255, 255, 70), width=3)
            fill = (255, 255, 255, 120)
        d.text((x + size / 2, top + size / 2 + 1), str(n), font=font, fill=fill, anchor="mm")
        x += size + gap
    if current:
        # A soft glow under the lit chip.
        glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
        cx = (W - total) // 2 + (current - 1) * (size + gap)
        ImageDraw.Draw(glow).rounded_rectangle((cx - 4, top - 4, cx + size + 4, top + size + 4), radius=26, fill=color + (120,))
        img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(16)))
    img.alpha_composite(layer)
    return top + size


def _load_image(path: Optional[str]) -> Optional[Image.Image]:
    if not path:
        return None
    try:
        with Image.open(path) as source:
            source.draft("RGB", (2400, 2400))
            image = ImageOps.exif_transpose(source).convert("RGB")
    except Exception:  # noqa: BLE001 - an unreadable picture leaves the typographic card
        return None
    if max(image.size) > 2400:
        image.thumbnail((2400, 2400), Image.LANCZOS)
    return image


def card_image(segment: Segment, size: tuple[int, int], color: tuple[int, int, int], box_on: bool, picture: Optional[Image.Image]) -> Image.Image:
    """The card's content at `size`: the screenshot with its highlight box, the picture filling it, or a type card."""
    cw, ch = size
    card = Image.new("RGBA", size, CARD_BG + (255,))
    if picture is not None and segment.box is not None:
        # The whole screenshot (never cropped, so the marked part always shows).
        fit = picture.copy()
        fit.thumbnail((cw, ch), Image.LANCZOS)
        if fit.width < cw and fit.height < ch:
            scale = min(cw / fit.width, ch / fit.height)
            fit = picture.resize((max(1, round(picture.width * scale)), max(1, round(picture.height * scale))), Image.LANCZOS)
        ox, oy = (cw - fit.width) // 2, (ch - fit.height) // 2
        shot = fit.convert("RGBA")
        bx0 = ox + segment.box.x * fit.width
        by0 = oy + segment.box.y * fit.height
        bx1 = bx0 + segment.box.w * fit.width
        by1 = by0 + segment.box.h * fit.height
        if box_on:
            # Dim everything but the marked part, then a glowing outline around it.
            shade = Image.new("RGBA", shot.size, (0, 0, 0, 92))
            hole = Image.new("L", shot.size, 255)
            ImageDraw.Draw(hole).rounded_rectangle((bx0 - ox, by0 - oy, bx1 - ox, by1 - oy), radius=14, fill=0)
            shot.alpha_composite(Image.composite(shade, Image.new("RGBA", shot.size, (0, 0, 0, 0)), hole))
        card.alpha_composite(shot, (ox, oy))
        if box_on:
            pad_box = 8
            rect = (max(4, bx0 - pad_box), max(4, by0 - pad_box), min(cw - 5, bx1 + pad_box), min(ch - 5, by1 + pad_box))
            # The glow: the accent color everywhere, shown through a blurred outline (no dark fringe).
            ring = Image.new("L", size, 0)
            ImageDraw.Draw(ring).rounded_rectangle(rect, radius=18, outline=255, width=16)
            ring = ring.filter(ImageFilter.GaussianBlur(20)).point(lambda v: min(255, int(v * 1.8)))
            glow = Image.new("RGBA", size, color + (255,))
            glow.putalpha(ring)
            card.alpha_composite(glow)
            # The marked part itself stays crisp and bright.
            inner = (int(bx0 - ox), int(by0 - oy), int(math.ceil(bx1 - ox)), int(math.ceil(by1 - oy)))
            card.alpha_composite(fit.convert("RGBA").crop(inner), (int(bx0), int(by0)))
            ImageDraw.Draw(card).rounded_rectangle(rect, radius=18, outline=color + (255,), width=6)
        return card
    if picture is not None:
        return ImageOps.fit(picture, size, Image.LANCZOS, centering=(0.5, 0.4)).convert("RGBA")
    # No picture: the number, the name and the member's line.
    draw = ImageDraw.Draw(card)
    number = f"{segment.index:02d}" if segment.kind == "item" else ""
    if number:
        draw.text((cw / 2, ch * 0.36), number, font=serif_italic(380), fill=color + (255,), anchor="mm")
    name_font = sans(64, 800)
    y = ch * 0.62
    for line in _wrap(segment.title, name_font, cw - 120)[:2]:
        draw.text((cw / 2, y), line, font=name_font, fill=WHITE, anchor="mm")
        y += 78
    if segment.line:
        line_font = sans(38, 500)
        y += 16
        for line in _wrap(segment.line, line_font, cw - 140)[:3]:
            draw.text((cw / 2, y), line, font=line_font, fill=(255, 255, 255, 170), anchor="mm")
            y += 50
    return card


def card_size(segment: Segment, picture: Optional[Image.Image], available: int) -> tuple[int, int]:
    """Full width; a wide picture gets a shorter card so it shows whole instead of cropped."""
    if segment.kind != "item" or picture is None:
        return CARD_W, available
    natural = round(CARD_W * picture.height / max(1, picture.width))
    return CARD_W, max(min(available, 420), min(available, natural))


def overview_card(names: list[str], pictures: list[Optional[Image.Image]], size: tuple[int, int], color: tuple[int, int, int]) -> Image.Image:
    """The intro's card: a collage of the items' pictures, or the numbered list of names."""
    cw, ch = size
    card = Image.new("RGBA", size, CARD_BG + (255,))
    shown = [p for p in pictures if p is not None]
    if len(shown) >= 2:
        cols = 2
        rows = math.ceil(len(pictures) / cols)
        gap = 18
        tile_w = (cw - gap * (cols + 1)) // cols
        tile_h = (ch - gap * (rows + 1)) // rows
        for i, picture in enumerate(pictures):
            r, c = divmod(i, cols)
            if len(pictures) % 2 and i == len(pictures) - 1:
                tw, x = cw - gap * 2, gap
            else:
                tw, x = tile_w, gap + c * (tile_w + gap)
            y = gap + r * (tile_h + gap)
            if picture is not None:
                tile = ImageOps.fit(picture, (tw, tile_h), Image.LANCZOS, centering=(0.5, 0.3)).convert("RGBA")
            else:
                tile = Image.new("RGBA", (tw, tile_h), (40, 40, 50, 255))
                tile_font = sans(40, 800)
                td = ImageDraw.Draw(tile)
                rows_text = _wrap(names[i] if i < len(names) else "", tile_font, tw - 48)[:3]
                ty = tile_h / 2 - (len(rows_text) - 1) * 26
                for row_text in rows_text:
                    td.text((tw / 2, ty), row_text, font=tile_font, fill=WHITE, anchor="mm")
                    ty += 52
            card.paste(tile, (x, y), _rounded_mask((tw, tile_h), 22))
            badge = sans(36, 800)
            d = ImageDraw.Draw(card)
            d.rounded_rectangle((x + 14, y + 14, x + 70, y + 70), radius=16, fill=color + (255,))
            d.text((x + 42, y + 43), str(i + 1), font=badge, fill=BG_TOP + (255,), anchor="mm")
        return card
    draw = ImageDraw.Draw(card)
    font = sans(54, 700)
    row = min(150, (ch - 120) // max(1, len(names)))
    y = (ch - row * len(names)) / 2 + row / 2
    for i, name in enumerate(names):
        draw.text((90, y), f"{i + 1}", font=serif_italic(84), fill=color + (255,), anchor="lm")
        draw.text((190, y), _ellipsize(name, font, cw - 240), font=font, fill=WHITE, anchor="lm")
        y += row
    return card


def end_card(img: Image.Image, spec: ListicleSpec, title: str, accent: str) -> None:
    """Follow card: the list's title and a "Follow @handle" button."""
    color = spec.accent_color
    bottom = draw_title(img, title, accent, 700, color) if title else 760
    label = f"Follow {spec.handle}"
    font = sans(54, 800)
    draw = ImageDraw.Draw(img)
    text_w = draw.textlength(label, font=font)
    bw, bh = int(text_w + 120), 124
    x0, y0 = (W - bw) // 2, max(bottom + 90, 940)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle((x0, y0, x0 + bw, y0 + bh), radius=bh // 2, fill=color + (150,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(28)))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), radius=bh // 2, fill=color + (255,))
    draw.text((W / 2, y0 + bh / 2 + 2), label, font=font, fill=BG_TOP + (255,), anchor="mm")


def _wrap(text: str, font: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    draw = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    lines, current = [], ""
    for word in text.split():
        trial = f"{current} {word}".strip()
        if current and draw.textlength(trial, font=font) > max_w:
            lines.append(current)
            current = word
        else:
            current = trial
    if current:
        lines.append(current)
    return lines


def _ellipsize(text: str, font: ImageFont.FreeTypeFont, max_w: int) -> str:
    draw = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    while len(text) > 3 and draw.textlength(text, font=font) > max_w:
        text = text[:-2].rstrip() + "…"
    return text


# ---------------------------------------------------------------------------
# Captions
# ---------------------------------------------------------------------------

def caption_chunks(words: list[Word]) -> list[list[Word]]:
    """Short groups of words shown together: at most CHUNK_WORDS words or CHUNK_CHARS characters, broken after a sentence."""
    chunks: list[list[Word]] = []
    current: list[Word] = []
    for word in words:
        length = sum(len(w.word) + 1 for w in current) + len(word.word)
        if current and (len(current) >= CHUNK_WORDS or length > CHUNK_CHARS * 1.6):
            chunks.append(current)
            current = []
        current.append(word)
        if re.search(r"[.!?]['\")\]]*$", word.word):
            chunks.append(current)
            current = []
    if current:
        chunks.append(current)
    return chunks


def caption_layer(chunk: list[Word], spoken: int) -> Image.Image:
    """The chunk centered in the caption area: the first `spoken` words white, the rest grey."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if not chunk:
        return layer
    font = sans(62, 800)
    draw = ImageDraw.Draw(layer)
    space = draw.textlength(" ", font=font)
    widths = [draw.textlength(w.word, font=font) for w in chunk]
    lines: list[list[int]] = [[]]
    width = 0.0
    for i, w in enumerate(widths):
        add = w + (space if lines[-1] else 0)
        if lines[-1] and width + add > 940:
            lines.append([i])
            width = w
        else:
            lines[-1].append(i)
            width += add
    line_h = 80
    top = CAPTION_CENTER - line_h * len(lines) / 2
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    for row, line in enumerate(lines):
        total = sum(widths[i] for i in line) + space * (len(line) - 1)
        x = (W - total) / 2
        y = top + row * line_h
        for i in line:
            fill = WHITE + (255,) if i < spoken else GREY
            sd.text((x, y + 3), chunk[i].word, font=font, fill=(0, 0, 0, 170))
            draw.text((x, y), chunk[i].word, font=font, fill=fill)
            x += widths[i] + space
    out = shadow.filter(ImageFilter.GaussianBlur(6))
    out.alpha_composite(layer)
    return out


# ---------------------------------------------------------------------------
# States: every distinct frame and how long it shows
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class State:
    segment: int
    pop: float
    box_on: bool
    chunk: int  # -1: no caption
    spoken: int


def segment_states(segment: Segment, seg_index: int, captions: bool) -> list[tuple[int, State]]:
    """(start offset ms, state) for one segment, sorted, starting at 0."""
    marks: dict[int, dict] = {0: {}}
    if segment.kind == "item":
        for offset, scale in POP_STEPS:
            if offset < segment.duration_ms:
                marks.setdefault(offset, {})
        if segment.box is not None and BOX_DELAY_MS < segment.duration_ms:
            marks.setdefault(BOX_DELAY_MS, {})
    chunks = caption_chunks(segment.words) if captions else []
    for c, chunk in enumerate(chunks):
        for k, word in enumerate(chunk):
            if word.start_ms < segment.duration_ms:
                marks.setdefault(word.start_ms, {})
    out: list[tuple[int, State]] = []
    for offset in sorted(marks):
        pop = 1.0
        if segment.kind == "item":
            for start, scale in POP_STEPS:
                if offset >= start:
                    pop = scale
        box_on = segment.kind == "item" and segment.box is not None and offset >= BOX_DELAY_MS
        chunk_at, spoken = -1, 0
        for c, chunk in enumerate(chunks):
            if c == 0 or offset >= chunk[0].start_ms:
                chunk_at = c
                spoken = sum(1 for w in chunk if w.start_ms <= offset)
        # A chunk stays up after its last word only until the next one starts (handled above); after the
        # segment's last word ends by more than a second, the captions clear.
        if chunks and chunk_at == len(chunks) - 1 and offset > chunks[-1][-1].end_ms + 1000:
            chunk_at, spoken = -1, 0
        out.append((offset, State(seg_index, pop, box_on, chunk_at, spoken)))
    # Clear captions a second after the last word, when the segment runs on.
    if chunks:
        clear = chunks[-1][-1].end_ms + 1000
        if clear < segment.duration_ms and all(o != clear for o, _ in out):
            last = [s for o, s in out if o < clear][-1]
            out.append((clear, State(seg_index, last.pop, last.box_on, -1, 0)))
            out.sort(key=lambda pair: pair[0])
    # Drop states that would show for under a frame (keep the later one).
    frame = 1000 / FPS
    pruned: list[tuple[int, State]] = []
    for offset, state in out:
        if pruned and offset - pruned[-1][0] < frame and pruned[-1][0] != 0:
            pruned[-1] = (pruned[-1][0], state)
        else:
            pruned.append((offset, state))
    return pruned


class FrameRenderer:
    """Draws states, caching the parts that repeat (the base frame per segment and look, each caption)."""

    def __init__(self, spec: ListicleSpec):
        self.spec = spec
        self.pictures = {i: _load_image(s.image) for i, s in enumerate(spec.segments)}
        self._base: dict[tuple[int, float, bool], Image.Image] = {}
        self._captions: dict[tuple[int, int, int], Image.Image] = {}
        self._chunks = {i: caption_chunks(s.words) if spec.captions else [] for i, s in enumerate(spec.segments)}
        self._bg = background()
        intro = next((s for s in spec.segments if s.kind == "intro"), None)
        self.list_title = intro.title if intro else ""
        self.list_accent = intro.accent if intro else ""

    def base(self, seg_index: int, pop: float, box_on: bool) -> Image.Image:
        key = (seg_index, pop, box_on)
        if key in self._base:
            return self._base[key]
        spec, segment = self.spec, self.spec.segments[seg_index]
        color = spec.accent_color
        img = self._bg.copy()
        draw_header(img, spec.header, color)
        if segment.kind == "end":
            end_card(img, spec, self.list_title, self.list_accent)
        else:
            title = segment.title
            if segment.kind == "item":
                title = f"{segment.index}. {segment.title}"
            bottom = draw_title(img, title, segment.accent or (segment.title.split() or [""])[-1], TITLE_TOP, color)
            chips_top = max(bottom + 28, 420)
            chips_bottom = draw_chips(img, spec.count, segment.index if segment.kind == "item" else 0, chips_top, color)
            card_top = chips_bottom + 44
            size = card_size(segment, self.pictures[seg_index], CARD_BOTTOM - card_top)
            card_top += (CARD_BOTTOM - card_top - size[1]) // 2
            if segment.kind == "intro":
                pictures = [self.pictures[i] for i, s in enumerate(spec.segments) if s.kind == "item"]
                content = overview_card(spec.names, pictures, size, color)
            else:
                content = card_image(segment, size, color, box_on, self.pictures[seg_index])
            mask = _rounded_mask(size, 40)
            if pop < 1:
                scaled = (round(size[0] * pop), round(size[1] * pop))
                content = content.resize(scaled, Image.LANCZOS)
                mask = mask.resize(scaled, Image.LANCZOS)
            cx = CARD_X + (size[0] - content.width) // 2
            cy = card_top + (size[1] - content.height) // 2
            shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
            ImageDraw.Draw(shadow).rounded_rectangle((cx, cy + 18, cx + content.width, cy + content.height + 18), radius=40, fill=(0, 0, 0, 150))
            img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(24)))
            img.paste(content, (cx, cy), mask)
            ImageDraw.Draw(img).rounded_rectangle((cx, cy, cx + content.width - 1, cy + content.height - 1), radius=40, outline=(255, 255, 255, 28), width=2)
        if len(self._base) > 24:
            self._base.pop(next(iter(self._base)))
        self._base[key] = img
        return img

    def frame(self, state: State) -> Image.Image:
        img = self.base(state.segment, state.pop, state.box_on).copy()
        if state.chunk >= 0:
            key = (state.segment, state.chunk, state.spoken)
            layer = self._captions.get(key)
            if layer is None:
                layer = caption_layer(self._chunks[state.segment][state.chunk], state.spoken)
                if len(self._captions) > 64:
                    self._captions.pop(next(iter(self._captions)))
                self._captions[key] = layer
            img.alpha_composite(layer)
        return img.convert("RGB")


def timeline(spec: ListicleSpec) -> list[tuple[int, int, State]]:
    """(start ms, duration ms, state) for the whole video."""
    rows: list[tuple[int, int, State]] = []
    start = 0
    for i, segment in enumerate(spec.segments):
        states = segment_states(segment, i, spec.captions)
        for k, (offset, state) in enumerate(states):
            end = states[k + 1][0] if k + 1 < len(states) else segment.duration_ms
            if end > offset:
                rows.append((start + offset, end - offset, state))
        start += segment.duration_ms
    return rows


# ---------------------------------------------------------------------------
# Encoding
# ---------------------------------------------------------------------------

def render_frames(spec: ListicleSpec, work_dir: str, progress: Optional[Callable[[float], None]] = None) -> str:
    """Draw each distinct frame once; returns an FFmpeg concat list holding each for its duration."""
    os.makedirs(work_dir, exist_ok=True)
    renderer = FrameRenderer(spec)
    rows = timeline(spec)
    names: dict[State, str] = {}
    lines = ["ffconcat version 1.0"]
    for n, (_, duration, state) in enumerate(rows):
        name = names.get(state)
        if name is None:
            name = f"f{len(names):04d}.png"
            renderer.frame(state).save(os.path.join(work_dir, name), compress_level=1)
            names[state] = name
        lines.append(f"file '{name}'")
        lines.append(f"duration {duration / 1000:.3f}")
        if progress and n % 5 == 0:
            progress(n / max(1, len(rows)))
    # The concat demuxer needs the last file again to honor its duration.
    lines.append(f"file '{names[rows[-1][2]]}'")
    path = os.path.join(work_dir, "frames.ffconcat")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    return path


def audio_args(spec: ListicleSpec) -> tuple[list[str], str]:
    """FFmpeg inputs and filter that join each segment's voice, padded or cut to its length (silence where it has none)."""
    inputs: list[str] = []
    parts: list[str] = []
    for i, segment in enumerate(spec.segments):
        seconds = segment.duration_ms / 1000
        if segment.audio:
            inputs += ["-protocol_whitelist", "file", "-i", segment.audio]
        else:
            inputs += ["-f", "lavfi", "-t", f"{seconds:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        parts.append(f"[{i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:{seconds:.3f},asetpts=PTS-STARTPTS[a{i}]")
    joined = "".join(f"[a{i}]" for i in range(len(spec.segments)))
    return inputs, ";".join(parts) + f";{joined}concat=n={len(spec.segments)}:v=0:a=1[aout]"


def encode(spec: ListicleSpec, frames: str, output: str, video_args: list[str], ffmpeg: str = "ffmpeg", timeout: int = 900) -> None:
    inputs, audio_filter = audio_args(spec)
    seconds = spec.duration_ms / 1000
    audio = output + ".audio.m4a"
    try:
        subprocess.run([ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", audio_filter,
                        "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", audio], check=True, timeout=timeout, capture_output=True)
        subprocess.run([ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", frames, "-i", audio,
                        "-vf", f"fps={FPS},format=yuv420p", "-map", "0:v:0", "-map", "1:a:0", *video_args, "-c:a", "copy",
                        "-t", f"{seconds:.3f}", "-movflags", "+faststart", output], check=True, timeout=timeout, capture_output=True)
    finally:
        try:
            os.remove(audio)
        except OSError:
            pass
