#!/usr/bin/env python3
"""Build the CreatorClips brand artwork.

Writes, from code (no source images):
  resources/creatorclips-icon.svg        app icon, full detail
  resources/creatorclips-icon-small.svg  app icon for 64 px and under
  resources/creatorclips-mark.svg        the emblem alone (collapsed sidebar)
  resources/creatorclips-logo.svg        emblem + wordmark, for dark backgrounds
  resources/creatorclips-logo-light.svg  emblem + wordmark, for light backgrounds
  build/icon.png, build/icon.ico, build/icon.icns  packaged app icons

The wordmark is set in the bundled Montserrat Black and converted to outlines,
so the logo looks the same wherever the SVG is shown.

Needs: pip install cairosvg fonttools pillow
"""
from __future__ import annotations

import io
from pathlib import Path

import cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "resources"
BUILD = ROOT / "build"
FONT = ROOT / "engine/assets/fonts/Montserrat-Black.ttf"

INK = "#0B0B0F"      # tile background
LIME = "#C6FF3D"     # brand accent (same as the Lime caption style)
WHITE = "#FAFAFA"
DARK_TEXT = "#09090B"


def emblem(x: float, y: float, s: float, frame_stroke: float) -> str:
    """A 9:16 phone frame with a play button, drawn in a box of size s at (x, y)."""
    fw, fh = s * 0.5, s * 0.84          # 9:16-ish frame
    fx, fy = x + (s - fw) / 2, y + (s - fh) / 2
    r = fw * 0.22
    cx, cy = x + s / 2, y + s / 2
    t = fw * 0.36                         # play triangle size
    tri = f"M{cx - t * 0.42:.2f} {cy - t * 0.55:.2f} L{cx + t * 0.6:.2f} {cy:.2f} L{cx - t * 0.42:.2f} {cy + t * 0.55:.2f} Z"
    return (
        f'<rect x="{fx:.2f}" y="{fy:.2f}" width="{fw:.2f}" height="{fh:.2f}" rx="{r:.2f}" '
        f'fill="none" stroke="{LIME}" stroke-width="{frame_stroke:.2f}"/>'
        f'<path d="{tri}" fill="{LIME}" stroke="{LIME}" stroke-width="{frame_stroke * 0.5:.2f}" stroke-linejoin="round"/>'
    )


def icon_svg(size: int = 1024, small: bool = False) -> str:
    rx = size * 0.225
    s = size * (0.74 if small else 0.66)
    off = (size - s) / 2
    stroke = size * (0.075 if small else 0.055)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" role="img" aria-label="CreatorClips">'
        f'<title>CreatorClips</title>'
        f'<rect width="{size}" height="{size}" rx="{rx:.2f}" fill="{INK}"/>'
        f'{emblem(off, off, s, stroke)}</svg>'
    )


def mark_svg() -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="CreatorClips">'
        '<title>CreatorClips</title>' + emblem(0, 0, 100, 7) + '</svg>'
    )


def text_paths(text: str, x: float, baseline: float, size: float) -> tuple[str, float]:
    """Outline `text` in Montserrat Black. Returns (path d, advance width)."""
    font = TTFont(str(FONT))
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    scale = size / upm
    pen = SVGPathPen(glyphs)
    cursor = 0.0
    for ch in text:
        name = cmap[ord(ch)]
        tpen = TransformPen(pen, (scale, 0, 0, -scale, x + cursor, baseline))
        glyphs[name].draw(tpen)
        cursor += glyphs[name].width * scale
    return pen.getCommands(), cursor


def logo_svg(text_color: str) -> str:
    h = 100.0
    size = 54.0
    baseline = 69.0
    gap = 18.0
    mark = emblem(0, 0, h, 7)
    d1, w1 = text_paths("Creator", h + gap, baseline, size)
    d2, w2 = text_paths("Clips", h + gap + w1, baseline, size)
    width = h + gap + w1 + w2 + 8
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.2f} {h:.0f}" role="img" aria-label="CreatorClips">'
        f'<title>CreatorClips</title>{mark}'
        f'<path d="{d1}" fill="{text_color}"/><path d="{d2}" fill="{LIME}"/></svg>'
    )


def png(svg: str, size: int) -> Image.Image:
    data = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(data)).convert("RGBA")


def main() -> None:
    full, small = icon_svg(), icon_svg(small=True)
    (RES / "creatorclips-icon.svg").write_text(full + "\n")
    (RES / "creatorclips-icon-small.svg").write_text(small + "\n")
    (RES / "creatorclips-mark.svg").write_text(mark_svg() + "\n")
    (RES / "creatorclips-logo.svg").write_text(logo_svg(WHITE) + "\n")
    (RES / "creatorclips-logo-light.svg").write_text(logo_svg(DARK_TEXT) + "\n")

    big = png(full, 1024)
    big.save(BUILD / "icon.png")
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_frames = [png(small if s <= 64 else full, s) for s in ico_sizes]
    ico_frames[-1].save(BUILD / "icon.ico", sizes=[(s, s) for s in ico_sizes], append_images=ico_frames[:-1])
    big.save(BUILD / "icon.icns")
    print("wrote CreatorClips brand artwork")


if __name__ == "__main__":
    main()
