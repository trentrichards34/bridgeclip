"""Edit my recording's drawn graphics, made here from text and the member's own pictures (PIL, no outside assets):

- half-screen explainer cards (a numbered list, a big number, before and after, a chat) for the top half of the frame;
- image pop-ups: the member's logo or product shot on a fixed canvas, a few frames scaling in, then still;
- the collage behind the cut-out opening: their pictures (or stills of their recording), tilted, blurred and darkened;
- the raw-to-edited opening: the raw take small, a red RAW tag, its timecode and a waveform with what was cut marked.
"""
from __future__ import annotations

import os
import re
import subprocess
from typing import Iterable, Optional

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from clip_engine.services.media_process import media_child_env, run_media

FONTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts"))
CARD_W, CARD_H = 1080, 960
# Platform UI sits along the top of the screen: card content starts below it.
TOP_SAFE = 120
DEFAULT_ACCENT = (47, 91, 255)
INK = (17, 19, 24)
MUTED = (96, 101, 112)
PAPER = (247, 246, 242)
RED = (232, 54, 54)
POP_CANVAS = 600
POP_FRAMES = 6


def font(size: int, kind: str = "bold") -> ImageFont.FreeTypeFont:
    names = {"bold": ("Montserrat-ExtraBold.ttf",), "black": ("Montserrat-Black.ttf", "Montserrat-ExtraBold.ttf"),
             "text": ("PlusJakartaSans.ttf", "Montserrat-ExtraBold.ttf"), "serif": ("InstrumentSerif-Italic.ttf",)}[kind]
    for name in names:
        path = os.path.join(FONTS, name)
        if os.path.isfile(path):
            f = ImageFont.truetype(path, size)
            if name == "PlusJakartaSans.ttf":
                try:  # a variable font: medium weight for body text
                    f.set_variation_by_axes([600])
                except Exception:  # noqa: BLE001 - the default weight is fine
                    pass
            return f
    return ImageFont.load_default()


def accent_of(headline_look: Optional[dict]) -> tuple[int, int, int]:
    """The brand color from the hook text's look; a calm blue when it's white, black or missing."""
    color = (headline_look or {}).get("color") or ""
    if re.fullmatch(r"#[0-9A-Fa-f]{6}", color):
        rgb = tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))
        lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
        if 40 < lum < 215:
            return rgb  # type: ignore[return-value]
    return DEFAULT_ACCENT


def on_color(rgb: tuple[int, int, int]) -> tuple[int, int, int]:
    lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    return INK if lum > 165 else (255, 255, 255)


def wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, width: int, max_lines: int = 3) -> list[str]:
    words, lines, line = text.split(), [], ""
    for word in words:
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=f) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(".,;:") + "…"
    return lines


def fit(draw: ImageDraw.ImageDraw, text: str, kind: str, start: int, smallest: int, width: int, max_lines: int) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """The largest size (start down to smallest) at which the text fits in max_lines."""
    size = start
    while True:
        f = font(size, kind)
        lines = wrap(draw, text, f, width, 99)
        if (len(lines) <= max_lines and all(draw.textlength(l, font=f) <= width for l in lines)) or size <= smallest:
            return f, wrap(draw, text, f, width, max_lines)
        size -= 4


def _text_block(draw: ImageDraw.ImageDraw, lines: list[str], f: ImageFont.FreeTypeFont, x: int, y: int, fill, center_w: int = 0,
                spacing: float = 1.18) -> int:
    """Draws lines from y (centered in center_w from x when given); returns the y below them."""
    step = round(f.size * spacing)
    for line in lines:
        lx = x + (center_w - draw.textlength(line, font=f)) / 2 if center_w else x
        draw.text((lx, y), line, font=f, fill=fill)
        y += step
    return y


def card_image(card: dict, path: str, accent: tuple[int, int, int]) -> str:
    """One explainer card as a 1080x960 PNG for the top half of the frame."""
    img = Image.new("RGB", (CARD_W, CARD_H), PAPER)
    draw = ImageDraw.Draw(img)
    kind, title, items = card["type"], card.get("title") or "", [i for i in card.get("items") or [] if i]
    margin = 84
    inner = CARD_W - 2 * margin
    # A thin accent line where the card meets the speaker below.
    draw.rectangle((0, CARD_H - 10, CARD_W, CARD_H), fill=accent)
    if kind == "list":
        f, lines = fit(draw, title, "black", 72, 48, inner, 2)
        y = _text_block(draw, lines, f, margin, TOP_SAFE + 20, INK) + 34
        n = min(4, len(items))
        room = CARD_H - 60 - y
        row = min(150, room // max(1, n))
        for k, item in enumerate(items[:4]):
            top = y + k * row
            box = (margin, top, CARD_W - margin, top + row - 22)
            draw.rounded_rectangle(box, radius=28, fill=(255, 255, 255), outline=(228, 226, 220), width=2)
            r = (row - 22) // 2 - 16
            cx, cy = margin + 26 + r, top + (row - 22) // 2
            draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=accent)
            nf = font(round(r * 1.15), "black")
            label = str(k + 1)
            draw.text((cx - draw.textlength(label, font=nf) / 2, cy - nf.size * 0.62), label, font=nf, fill=on_color(accent))
            tx = cx + r + 30
            tf, tl = fit(draw, item, "text", 50, 32, CARD_W - margin - 30 - tx, 2)
            th = round(tf.size * 1.15) * len(tl)
            _text_block(draw, tl, tf, tx, cy - th // 2 - round(tf.size * 0.1), INK, spacing=1.15)
    elif kind == "stat":
        label = items[0] if items else ""
        f, lines = fit(draw, title, "black", 260, 110, inner, 1)
        lf, ll = fit(draw, label, "text", 58, 38, inner, 2)
        total = round(f.size * 1.0) + 40 + round(lf.size * 1.2) * len(ll)
        y = TOP_SAFE + (CARD_H - TOP_SAFE - 40 - total) // 2
        _text_block(draw, lines, f, margin, y - round(f.size * 0.12), accent, inner)
        _text_block(draw, ll, lf, margin, y + f.size + 40, MUTED, inner)
    elif kind == "compare":
        y = TOP_SAFE + 10
        if title:
            f, lines = fit(draw, title, "black", 64, 44, inner, 1)
            y = _text_block(draw, lines, f, margin, y, INK, inner) + 30
        gap = 76
        col = (inner - gap) // 2
        bottom = CARD_H - 70
        for k, (name, text) in enumerate((("BEFORE", items[0] if items else ""), ("AFTER", items[1] if len(items) > 1 else ""))):
            x0 = margin + k * (col + gap)
            fill, ink = ((233, 231, 225), INK) if k == 0 else (accent, on_color(accent))
            draw.rounded_rectangle((x0, y, x0 + col, bottom), radius=34, fill=fill)
            tag = font(34, "bold")
            draw.text((x0 + 36, y + 32), name, font=tag, fill=MUTED if k == 0 else ink)
            tf, tl = fit(draw, text, "black" if k else "text", 64, 36, col - 72, 5)
            th = round(tf.size * 1.16) * len(tl)
            _text_block(draw, tl, tf, x0 + 36, y + 32 + 60 + (bottom - y - 92 - th) // 2, ink, spacing=1.16)
        # An arrow between the two.
        cx, cy = margin + col + gap // 2, (y + bottom) // 2
        draw.ellipse((cx - 34, cy - 34, cx + 34, cy + 34), fill=(255, 255, 255), outline=(228, 226, 220), width=2)
        draw.polygon([(cx - 10, cy - 16), (cx + 14, cy), (cx - 10, cy + 16)], fill=INK)
    else:  # chat
        ask, reply = (items + ["", ""])[:2]
        # A plain chat window: a header bar, the question on the right, the reply on the left.
        win = (margin - 20, TOP_SAFE, CARD_W - margin + 20, CARD_H - 60)
        draw.rounded_rectangle(win, radius=36, fill=(255, 255, 255), outline=(228, 226, 220), width=2)
        draw.rounded_rectangle((win[0], win[1], win[2], win[1] + 92), radius=36, fill=(240, 239, 235))
        draw.rectangle((win[0], win[1] + 60, win[2], win[1] + 92), fill=(240, 239, 235))
        for k, c in enumerate(((255, 95, 86), (255, 189, 46), (39, 201, 63))):
            draw.ellipse((win[0] + 34 + k * 34, win[1] + 36, win[0] + 56 + k * 34, win[1] + 58), fill=c)
        hf = font(34, "bold")
        name = title or "Chat"
        draw.text(((win[0] + win[2] - draw.textlength(name, font=hf)) / 2, win[1] + 28), name, font=hf, fill=MUTED)
        width = round((win[2] - win[0]) * 0.74)
        bubbles = []
        for side, text in (("right", ask), ("left", reply)):
            bf, bl = fit(draw, text, "text", 52, 32, width - 64, 4)
            bubbles.append((side, bf, bl, max(round(draw.textlength(l, font=bf)) for l in bl) + 64, round(bf.size * 1.2) * len(bl) + 44))
        content = sum(b[4] for b in bubbles) + 34
        y = win[1] + 92 + max(40, (win[3] - win[1] - 92 - content) // 2)
        for side, bf, bl, bw, bh in bubbles:
            x0 = win[2] - 30 - bw if side == "right" else win[0] + 30
            fill, ink = (accent, on_color(accent)) if side == "right" else ((236, 235, 231), INK)
            draw.rounded_rectangle((x0, y, x0 + bw, y + bh), radius=30, fill=fill)
            _text_block(draw, bl, bf, x0 + 32, y + 18, ink, spacing=1.2)
            y += bh + 34
    img.save(path)
    return path


def _soft_shadow(size: tuple[int, int], box: tuple[int, int, int, int], radius: int, blur: int = 18, alpha: int = 110) -> Image.Image:
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(box, radius=radius, fill=(0, 0, 0, alpha))
    return shadow.filter(ImageFilter.GaussianBlur(blur))


def _rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.size[0] - 1, img.size[1] - 1), radius=radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(Image.composite(out.getchannel("A"), mask, mask) if out.mode == "RGBA" else mask)
    return out


def load_picture(path: str, max_side: int) -> Image.Image:
    """The member's picture, upright and no bigger than max_side (RGBA)."""
    with Image.open(path) as raw:
        raw.draft("RGB", (max_side * 2, max_side * 2))
        img = ImageOps.exif_transpose(raw).convert("RGBA")
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    return img


def pop_frames(src: str, folder: str, stem: str) -> tuple[str, str]:
    """An image pop-up: POP_FRAMES frames scaling in (an animated PNG, stem-in.apng) and the still (stem.png), on one canvas."""
    pic = load_picture(src, 460)
    alpha = pic.getchannel("A")
    see_through = alpha.getextrema()[0] < 250
    if see_through:
        # A logo with a clear background sits on a white plate.
        pad = 48
        plate = Image.new("RGBA", (pic.width + 2 * pad, pic.height + 2 * pad), (255, 255, 255, 250))
        plate.alpha_composite(pic, (pad, pad))
        card = _rounded(plate, 44)
    else:
        card = _rounded(pic, 36)
    scale = min(1.0, (POP_CANVAS - 80) / max(card.size))
    if scale < 1:
        card = card.resize((round(card.width * scale), round(card.height * scale)), Image.LANCZOS)

    def frame(s: float) -> Image.Image:
        canvas = Image.new("RGBA", (POP_CANVAS, POP_CANVAS), (0, 0, 0, 0))
        w, h = max(2, round(card.width * s)), max(2, round(card.height * s))
        x, y = (POP_CANVAS - w) // 2, (POP_CANVAS - h) // 2
        canvas.alpha_composite(_soft_shadow(canvas.size, (x, y + 14, x + w, y + h + 14), 40, 16, 120))
        canvas.alpha_composite(card.resize((w, h), Image.LANCZOS), (x, y))
        return canvas

    frames = []
    for k in range(POP_FRAMES):
        t = (k + 1) / POP_FRAMES
        # Ease out with a touch of overshoot: 0.55 → 1.06 → 1.0.
        frames.append(frame(min(1.06, 0.55 + 0.51 * (1 - (1 - t) ** 3)) if k < POP_FRAMES - 1 else 1.0))
    ramp = os.path.join(folder, f"{stem}-in.apng")
    frames[0].save(ramp, format="PNG", save_all=True, append_images=frames[1:], duration=round(1000 / 30), loop=1, disposal=1)
    still = os.path.join(folder, f"{stem}.png")
    frame(1.0).save(still)
    return ramp, still


def collage_image(pictures: list[Image.Image], path: str, w: int = 1080, h: int = 1920) -> str:
    """The cut-out opening's background: the pictures as tilted cards, softly blurred and darkened."""
    bg = Image.new("RGBA", (w, h), (18, 20, 26, 255))
    grad = Image.linear_gradient("L").resize((w, h))
    bg = Image.composite(Image.new("RGBA", (w, h), (38, 44, 60, 255)), bg, grad)
    spots = [(0.27, 0.16, -8), (0.76, 0.24, 7), (0.22, 0.47, 6), (0.80, 0.56, -6), (0.30, 0.80, -4), (0.74, 0.86, 9)]
    pics = pictures or []
    for k, (fx, fy, angle) in enumerate(spots):
        if not pics:
            break
        pic = pics[k % len(pics)].copy()
        pic.thumbnail((620, 620), Image.LANCZOS)
        framed = Image.new("RGBA", (pic.width + 24, pic.height + 24), (255, 255, 255, 255))
        framed.alpha_composite(pic.convert("RGBA"), (12, 12))
        framed = _rounded(framed, 26).rotate(angle, expand=True, resample=Image.BICUBIC)
        x, y = round(fx * w - framed.width / 2), round(fy * h - framed.height / 2)
        shadow = _soft_shadow((w, h), (x + 10, y + 24, x + framed.width - 10, y + framed.height), 30, 24, 140)
        bg.alpha_composite(shadow)
        bg.alpha_composite(framed, (x, y))
    out = bg.convert("RGB").filter(ImageFilter.GaussianBlur(7))
    out = Image.blend(out, Image.new("RGB", (w, h), (8, 10, 14)), 0.32)
    out.save(path)
    return path


def video_stills(video: str, times: Iterable[float], folder: str) -> list[Image.Image]:
    """Stills of a video at these times (used for the collage when the member added no pictures)."""
    out: list[Image.Image] = []
    for k, t in enumerate(times):
        path = os.path.join(folder, f"still-{k}.png")
        result = run_media(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{max(0.0, t):.3f}", "-protocol_whitelist", "file,pipe,fd",
                            "-format_whitelist", "mov,matroska,webm,avi,flv,mpegts", "-i", video, "-frames:v", "1", "-vf", "scale=540:-2", path], timeout=120)
        if result.returncode == 0 and os.path.isfile(path):
            with Image.open(path) as img:
                out.append(img.convert("RGB"))
    return out


# ---------------------------------------------------------------------------
# The raw-to-edited opening
# ---------------------------------------------------------------------------

def clock(seconds: float, frames: bool = False) -> str:
    total = max(0.0, seconds)
    m, s = divmod(int(total), 60)
    h, m = divmod(m, 60)
    text = f"{h:02d}:{m:02d}:{s:02d}"
    return text + (f":{int((total % 1) * 30):02d}" if frames else "")


def short_clock(seconds: float) -> str:
    total = max(0, round(seconds))
    return f"{total // 60}:{total % 60:02d}"


def audio_levels(sources: list[str], buckets: int) -> tuple[np.ndarray, list[float]]:
    """Loudness (0..1) in `buckets` across the raw takes played one after another, and each take's length."""
    rate = 1000
    chunks, lengths = [], []
    for source in sources:
        result = run_media(["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe,fd", "-format_whitelist",
                            "mov,matroska,webm,avi,flv,mpegts", "-i", source, "-map", "0:a:0", "-ac", "1", "-ar", str(rate),
                            "-f", "s16le", "-"], timeout=600, max_output=64 * 1024 * 1024)
        pcm = np.frombuffer(result.stdout or b"", dtype="<i2").astype(np.float32) / 32768.0 if result.returncode == 0 else np.zeros(0, np.float32)
        chunks.append(pcm)
        lengths.append(len(pcm) / rate)
    audio = np.concatenate(chunks) if chunks else np.zeros(0, np.float32)
    if audio.size == 0:
        return np.zeros(buckets, np.float32), lengths
    edges = np.linspace(0, audio.size, buckets + 1).astype(int)
    levels = np.array([float(np.sqrt(np.mean(audio[a:b] ** 2))) if b > a else 0.0 for a, b in zip(edges[:-1], edges[1:])], np.float32)
    peak = float(np.percentile(levels, 98)) or 1.0
    return np.clip(levels / peak, 0, 1) ** 0.7, lengths


def raw_intro_frames(still: Optional[Image.Image], name: str, raw_seconds: float, reel_seconds: float, levels: np.ndarray,
                     cuts: list[tuple[float, float]], seconds: float, fps: int) -> Iterable[bytes]:
    """The opening's frames (RGB bytes, 1080x1920): the playhead sweeps the raw take; what was cut turns red."""
    w, h = 1080, 1920
    base = Image.new("RGB", (w, h), (12, 13, 17))
    draw = ImageDraw.Draw(base)
    # The raw take, small and as filmed (its own shape, inside 840x840 between the name and the waveform).
    if still is not None:
        panel = ImageOps.contain(still.convert("RGB"), (840, 840), Image.LANCZOS)
    else:
        panel = Image.new("RGB", (840, 472), (30, 32, 38))
    frame_w, frame_h = panel.size
    top = 300 + (840 - frame_h) // 2
    box = ((w - frame_w) // 2, top, (w - frame_w) // 2 + frame_w, top + frame_h)
    panel = _rounded(panel, 28)
    base.paste(panel, box[:2], panel)
    draw.rounded_rectangle(box, radius=28, outline=(60, 63, 72), width=3)
    tag_font = font(40, "black")
    draw.rounded_rectangle((box[0] + 28, box[1] + 28, box[0] + 228, box[1] + 100), radius=18, fill=(0, 0, 0))
    draw.ellipse((box[0] + 50, box[1] + 50, box[0] + 78, box[1] + 78), fill=RED)
    draw.text((box[0] + 94, box[1] + 41), "RAW", font=tag_font, fill=(255, 255, 255))
    meta = font(34, "bold")
    label = name if len(name) <= 34 else name[:31] + "…"
    draw.text((box[0], box[1] - 70), label, font=meta, fill=(200, 203, 212))
    right = f"{short_clock(raw_seconds)} raw"
    draw.text((box[2] - draw.textlength(right, font=meta), box[1] - 70), right, font=meta, fill=(200, 203, 212))
    sub = font(40, "text")
    line = "Raw take · every pause and retake still in"
    draw.text(((w - draw.textlength(line, font=sub)) / 2, 1650), line, font=sub, fill=(150, 154, 166))
    # The waveform.
    wave_box = (90, 1290, 990, 1520)
    mid = (wave_box[1] + wave_box[3]) // 2
    bars = len(levels)
    bar_w = (wave_box[2] - wave_box[0]) / bars
    total = max(raw_seconds, 1e-3)
    in_cut = [any(a <= (k + 0.5) / bars * total < b for a, b in cuts) for k in range(bars)]
    cut_label = font(26, "black")
    frames = max(1, round(seconds * fps))
    for f in range(frames):
        t = f / fps
        # The sweep takes most of the opening; the last half second holds the result.
        progress = min(1.0, t / max(0.1, seconds - 0.9))
        img = base.copy()
        head = wave_box[0] + progress * (wave_box[2] - wave_box[0])
        band = Image.new("RGBA", img.size, (0, 0, 0, 0))
        bd = ImageDraw.Draw(band)
        for a, b in cuts:
            xa, xb = wave_box[0] + a / total * (wave_box[2] - wave_box[0]), wave_box[0] + b / total * (wave_box[2] - wave_box[0])
            if xa < head:
                bd.rectangle((xa, wave_box[1] - 6, max(xa + 3, min(xb, head)), wave_box[3] + 6), fill=(*RED, 60))
        img = Image.alpha_composite(img.convert("RGBA"), band).convert("RGB")
        d = ImageDraw.Draw(img)
        for k in range(bars):
            x0 = wave_box[0] + k * bar_w
            amp = max(3, levels[k] * (wave_box[3] - wave_box[1]) / 2)
            passed = x0 < head
            color = (RED if in_cut[k] else (238, 240, 245)) if passed else (78, 82, 92)
            d.rounded_rectangle((x0 + 1, mid - amp, x0 + max(2, bar_w - 2), mid + amp), radius=2, fill=color)
        for a, b in cuts:
            xa, xb = wave_box[0] + a / total * (wave_box[2] - wave_box[0]), wave_box[0] + b / total * (wave_box[2] - wave_box[0])
            if xa < head and xb - xa >= 46:
                d.text((xa + 4, wave_box[1] - 42), "CUT", font=cut_label, fill=RED)
        d.line((head, wave_box[1] - 50, head, wave_box[3] + 20), fill=(255, 255, 255), width=4)
        # The timecode follows the playhead through the raw take.
        tc = clock(progress * raw_seconds, frames=True)
        tf = font(36, "bold")
        tw = d.textlength(tc, font=tf)
        d.rounded_rectangle((box[2] - tw - 64, box[3] - 86, box[2] - 24, box[3] - 28), radius=14, fill=(0, 0, 0))
        d.text((box[2] - tw - 44, box[3] - 80), tc, font=tf, fill=(255, 255, 255))
        if progress >= 1.0:
            result = f"{short_clock(raw_seconds)} raw  →  {short_clock(reel_seconds)} edited"
            rf = font(52, "black")
            d.rounded_rectangle(((w - d.textlength(result, font=rf)) / 2 - 36, 1740, (w + d.textlength(result, font=rf)) / 2 + 36, 1830),
                                radius=45, fill=(255, 255, 255))
            d.text(((w - d.textlength(result, font=rf)) / 2, 1756), result, font=rf, fill=INK)
        yield img.tobytes()


def write_raw_intro(out: str, frames: Iterable[bytes], seconds: float, fps: int, whoosh: Optional[str], timeout: float = 600) -> str:
    """The opening as an H.264/AAC clip at 30 fps: the frames piped in, a soft whoosh into the reel at its end."""
    inputs = ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1080x1920", "-r", str(fps), "-i", "pipe:0"]
    audio = ["-f", "lavfi", "-t", f"{seconds:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
    graph = "[0:v]fps=30,format=yuv420p,setsar=1[v]"
    if whoosh:
        audio += ["-i", whoosh]
        lead = max(0, round((seconds - 0.35) * 1000))
        graph += f";[2:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.5,adelay={lead}|{lead}[w];[1:a][w]amix=inputs=2:normalize=0:duration=first[a]"
    else:
        graph += ";[1:a]anull[a]"
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", *inputs, *audio, "-filter_complex", graph, "-map", "[v]", "-map", "[a]",
           "-t", f"{seconds:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", out]
    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=media_child_env())
    try:
        for frame in frames:
            process.stdin.write(frame)
        process.stdin.close()
        _, err = process.communicate(timeout=timeout)
    except BaseException:
        process.kill()
        process.wait()
        raise
    if process.returncode or not os.path.isfile(out):
        raise RuntimeError(f"raw opening failed: {(err or b'')[-300:]!r}")
    return out


def dropped_ranges(pieces: list, lengths: list[float]) -> list[tuple[float, float]]:
    """What the edit left out of the raw takes (played one after another), from the kept pieces: (start, end) seconds."""
    offsets, at = [], 0.0
    for length in lengths:
        offsets.append(at)
        at += length
    kept: list[tuple[float, float]] = sorted((offsets[p.src] + p.start, offsets[p.src] + p.end) for p in pieces if p.src < len(offsets))
    out, cursor = [], 0.0
    for a, b in kept:
        if a - cursor > 0.15:
            out.append((cursor, a))
        cursor = max(cursor, b)
    if at - cursor > 0.15:
        out.append((cursor, at))
    return out

