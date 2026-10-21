"""Hook text looks: white/black/brand bars or floating text, in three fonts."""

import asyncio
import os

import pytest
from PIL import Image

from clip_engine.services import rendering_service as module
from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.rendering_service import (
    RenderingService, RenderRequest, TitleStyle, parse_headline_look, validate_headline_look,
)

from .test_audit_render import FFMPEG_WITH_ASS
from .test_background_split import _mean

TEXT = "TJR finds out people are getting scammed by this"


def _bar(tmp_path, look):
    request = RenderRequest("in.mp4", str(tmp_path / "o.mp4"), 0, 1000, 64, 64, title_style=TitleStyle.HEADLINE,
                            headline_text=TEXT, headline_look=look)
    return RenderingService()._headline_bar_image(request, 1080, 1920, False)


def test_parse_falls_back_and_validate_is_strict():
    assert parse_headline_look(None).look == "white"
    assert parse_headline_look({"look": "neon", "font": "comic", "color": "red"}).__dict__ == {"look": "white", "color": "#FFFFFF", "font": "clean", "text_bg": "none", "hide_after_s": None}
    assert parse_headline_look({"look": "brand", "color": "#ff8800"}).pad_color == "0xFF8800"
    assert validate_headline_look(None) is None
    assert validate_headline_look({"look": "brand", "color": "#2563eb", "font": "serif"}) == {"look": "brand", "color": "#2563EB", "font": "serif"}
    for bad in ({"look": "neon"}, {"font": "comic"}, {"color": "blue"}, {"color": 5}, {"extra": 1}, "white", []):
        with pytest.raises(ValueError):
            validate_headline_look(bad)


def test_text_color_follows_the_bar():
    assert parse_headline_look({"look": "white"}).text == (0, 0, 0)
    assert parse_headline_look({"look": "black"}).text == (255, 255, 255)
    assert parse_headline_look({"look": "brand", "color": "#FFE600"}).text == (0, 0, 0)  # light brand: black text
    assert parse_headline_look({"look": "brand", "color": "#1D3BB3"}).text == (255, 255, 255)
    assert parse_headline_look({"look": "floating"}).background is None


@pytest.mark.parametrize("look,corner", [
    (None, (255, 255, 255)),
    ({"look": "black"}, (14, 14, 14)),
    ({"look": "brand", "color": "#E11D48"}, (0xE1, 0x1D, 0x48)),
])
def test_bars_are_drawn_in_their_color(tmp_path, look, corner):
    path, bar_h = _bar(tmp_path, look)
    assert bar_h > 200
    with Image.open(path) as img:
        assert img.size == (1080, bar_h)
        assert img.convert("RGB").getpixel((4, 4)) == corner


def test_floating_text_has_no_bar(tmp_path):
    path, bar_h = _bar(tmp_path, {"look": "floating"})
    assert bar_h == 0
    with Image.open(path) as img:
        assert img.mode == "RGBA"
        assert img.getpixel((4, 4))[3] == 0  # see-through around the text
        box = img.getchannel("A").getbbox()
        assert box and box[1] > 60  # under the platform UI
        assert any(px[0] > 240 and px[3] == 255 for px in img.crop(box).getdata())  # white text


def test_fonts_change_the_text(tmp_path):
    images = {}
    for font in ("clean", "serif", "condensed", "marker", "sans_serif_accent"):
        (tmp_path / font).mkdir()
        path, _ = _bar(tmp_path / font, {"look": "black", "font": font})
        with Image.open(path) as img:
            images[font] = img.convert("L").tobytes()
    assert len(set(images.values())) == 5


def test_new_fonts_are_bundled_and_validated():
    for font in ("marker", "sans_serif_accent"):
        assert validate_headline_look({"look": "white", "font": font})["font"] == font
        assert os.path.isfile(RenderingService()._headline_font_path(font))
        assert os.path.basename(RenderingService()._headline_font_path(font)) == module.HEADLINE_FONTS[font]
    assert os.path.isfile(RenderingService()._headline_font_path("sans_serif_accent", module.HEADLINE_ACCENT_FONT))
    fonts = os.path.join(os.path.dirname(module.__file__), "..", "..", "assets", "fonts")
    assert os.path.isfile(os.path.join(fonts, "CaveatBrush-OFL.txt"))


def test_accent_word_is_the_last_real_word():
    assert module.headline_accent_index("Make your videos look different.".split()) == 4
    assert module.headline_accent_index("Two: onetake".split()) == 1
    assert module.headline_accent_index("This is it".split()) == 0
    assert module.headline_accent_index("a b".split()) == 1


def test_accent_word_changes_only_one_word(tmp_path):
    images = {}
    for font in ("clean", "sans_serif_accent"):
        (tmp_path / font).mkdir()
        path, bar_h = _bar(tmp_path / font, {"look": "black", "font": font})
        with Image.open(path) as img:
            images[font] = (bar_h, img.convert("L"))
    assert images["clean"][0] == images["sans_serif_accent"][0]
    clean, accent = images["clean"][1], images["sans_serif_accent"][1]
    assert clean.tobytes() != accent.tobytes()


def test_pad_takes_the_bar_color_and_floating_does_not_pad():
    graph = "[0:v]null[base]"
    assert "color=0x0E0E0E" in RenderingService._pad_for_headline(graph, 1080, 1920, 300, parse_headline_look({"look": "black"}).pad_color)
    assert RenderingService._pad_for_headline(graph, 1080, 1920, 0) == graph


def _render(tmp_path, monkeypatch, look):
    ffmpeg, _ = FFMPEG_WITH_ASS
    from .test_av_sync import source
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    service = RenderingService()
    service._video_codec_args = lambda *args: ["-c:v", "mpeg4", "-q:v", "2", "-bf", "2"]
    monkeypatch.setattr(module, "get_output_dimensions", lambda *_: (360, 640))

    async def plan(request, width, height, start, duration):
        return ClipLayoutPlan([ShotLayout(0, duration, LayoutType.TALKING_HEAD)], width, height)

    monkeypatch.setattr(service, "_plan_layout", plan)
    path = source(tmp_path, duration=2)
    request = RenderRequest(str(path), str(tmp_path / "clip.mp4"), 0, 2000, 64, 64, pacing="natural",
                            apply_padding=False, include_captions=False, title_style=TitleStyle.HEADLINE,
                            headline_text=TEXT, headline_look=look)
    result = asyncio.run(service.render_clip(request))
    return ffmpeg, result.output_path


def test_render_black_bar(tmp_path, monkeypatch):
    ffmpeg, out = _render(tmp_path, monkeypatch, {"look": "black"})
    corner = _mean(ffmpeg, out, 1.0, "crop=40:20:0:0")
    assert corner.max() < 30, corner


def test_render_floating_keeps_the_video_full_frame(tmp_path, monkeypatch):
    ffmpeg, out = _render(tmp_path, monkeypatch, {"look": "floating"})
    corner = _mean(ffmpeg, out, 1.0, "crop=20:10:0:0")
    assert corner.max() < 235, corner  # no white bar: the video shows at the very top


def test_non_string_values_are_rejected_cleanly():
    for bad in ({"font": ["clean"]}, {"look": {"x": 1}}, {"color": None}):
        with pytest.raises(ValueError):
            validate_headline_look(bad)
    assert parse_headline_look({"font": ["clean"], "look": "black"}).look == "black"


def test_no_hook_text(tmp_path):
    assert validate_headline_look({"look": "none"}) == {"look": "none", "color": "#FFFFFF", "font": "clean"}
    assert _bar(tmp_path, {"look": "none"}) is None
    # Headline style with no hook text doesn't fall back to a title card on 9:16 clips; 16:9 keeps its title card.
    from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
    request = RenderRequest("in.mp4", str(tmp_path / "o.mp4"), 0, 1000, 64, 64, title_style=TitleStyle.HEADLINE,
                            title_text="Short title", headline_text=TEXT, headline_look={"look": "none"})
    plan = ClipLayoutPlan([ShotLayout(0, 1000, LayoutType.TALKING_HEAD)], 64, 64)
    titles = lambda overlays: [o for o in overlays if "title-" in str(o[0])]  # noqa: E731
    assert titles(RenderingService()._overlays(request, plan, 1080, 1920, False)) == []
    assert titles(RenderingService()._overlays(request, plan, 1920, 1080, True)) != []


def test_render_with_no_hook_text_keeps_the_full_frame(tmp_path, monkeypatch):
    ffmpeg, out = _render(tmp_path, monkeypatch, {"look": "none"})
    corner = _mean(ffmpeg, out, 1.0, "crop=20:10:0:0")
    assert corner.max() < 235, corner


# ---------------------------------------------------------------------------
# Floating text's background: a snug rounded box behind each line (Instagram's text background).
# ---------------------------------------------------------------------------

def test_text_bg_parses_validates_and_round_trips():
    assert parse_headline_look({"look": "floating", "textBg": "dark"}).text_bg == "dark"
    assert parse_headline_look({"look": "floating", "textBg": "neon"}).text_bg == "none"
    assert validate_headline_look({"look": "floating", "textBg": "light"}) == {"look": "floating", "color": "#FFFFFF", "font": "clean", "textBg": "light"}
    # "none" is the default: left out, so older requests and outputs are unchanged.
    assert validate_headline_look({"look": "floating", "textBg": "none"}) == {"look": "floating", "color": "#FFFFFF", "font": "clean"}
    for bad in ({"textBg": "neon"}, {"textBg": 1}, {"text_bg": "dark"}):
        with pytest.raises(ValueError):
            validate_headline_look(bad)
    look = parse_headline_look({"look": "floating", "color": "#e11d48", "font": "serif", "textBg": "brand"})
    assert look.as_dict() == {"look": "floating", "color": "#E11D48", "font": "serif", "textBg": "brand"}
    assert parse_headline_look(look.as_dict()) == look
    assert parse_headline_look({"look": "white"}).as_dict() == {"look": "white", "color": "#FFFFFF", "font": "clean"}


def test_text_color_follows_the_box():
    assert parse_headline_look({"look": "floating", "textBg": "dark"}).text == (255, 255, 255)
    assert parse_headline_look({"look": "floating", "textBg": "light"}).text == (0, 0, 0)
    assert parse_headline_look({"look": "floating", "textBg": "brand", "color": "#FFE600"}).text == (0, 0, 0)
    assert parse_headline_look({"look": "floating", "textBg": "brand", "color": "#1D3BB3"}).text == (255, 255, 255)
    # Only floating text gets a box; bars ignore it.
    assert parse_headline_look({"look": "black", "textBg": "light"}).box is None
    assert parse_headline_look({"look": "black", "textBg": "light"}).text == (255, 255, 255)
    assert parse_headline_look({"look": "floating", "textBg": "dark"}).background is None


def test_outline_steps_between_lines_and_snaps_near_widths():
    # Two lines, the second narrower: 4 outer corners and a step (2 corners) on each side.
    outline = module.text_box_outline([(100, 0, 900, 70), (300, 70, 700, 140)], 15)
    assert [(x, y) for x, y, _ in outline] == [(100, 0), (900, 0), (900, 70), (700, 70), (700, 140), (300, 140), (300, 70), (100, 70)]
    assert all(r == 15 for _, _, r in outline)
    # Lines within the snap distance take the wider width: one rectangle.
    snapped = module.text_box_outline([(100, 0, 900, 70), (105, 70, 895, 140)], 15, snap=15)
    assert [(x, y) for x, y, _ in snapped] == [(100, 0), (900, 0), (900, 140), (100, 140)]
    # A small step limits the corner radius to half of it.
    small = module.text_box_outline([(100, 0, 900, 70), (120, 70, 880, 140)], 15)
    assert min(r for _, _, r in small) == 10


def _boxed(tmp_path, text_bg, text=TEXT, color="#E11D48"):
    path, bar_h = _bar_text(tmp_path, {"look": "floating", "textBg": text_bg, "color": color}, text)
    assert bar_h == 0  # still over the video: no bar
    return Image.open(path).convert("RGBA")


def _bar_text(tmp_path, look, text):
    request = RenderRequest("in.mp4", str(tmp_path / "o.mp4"), 0, 1000, 64, 64, title_style=TitleStyle.HEADLINE,
                            headline_text=text, headline_look=look)
    return RenderingService()._headline_bar_image(request, 1080, 1920, False)


def _rows(img):
    """Each row band of the box: (top, bottom, left, right) where the alpha is solid."""
    alpha = img.getchannel("A")
    rows = []
    for y in range(img.height):
        xs = [x for x in range(0, img.width, 2) if alpha.getpixel((x, y)) > 200]
        if xs:
            rows.append((y, xs[0], xs[-1]))
    return rows


@pytest.mark.parametrize("text_bg,box,ink", [
    ("dark", (0, 0, 0, 230), (255, 255, 255)),
    ("light", (255, 255, 255, 255), (0, 0, 0)),
    ("brand", (0xE1, 0x1D, 0x48, 255), (255, 255, 255)),
])
def test_each_line_sits_on_a_snug_box(tmp_path, text_bg, box, ink):
    img = _boxed(tmp_path, text_bg, "Why nobody watches your videos yet ok")
    rows = _rows(img)
    assert rows, "a box is drawn"
    top, bottom = rows[0][0], rows[-1][0]
    # Boxes touch: no see-through gap between the lines' boxes down the middle.
    alpha = img.getchannel("A")
    assert all(alpha.getpixel((540, y)) > 200 for y in range(top + 2, bottom - 2))
    # Snug: the widest box stays inside the frame's side margins, and the lines' boxes differ in width.
    widths = {right - left for _, left, right in rows[len(rows) // 8: -len(rows) // 8]}
    assert max(widths) < 1080 - 2 * 40
    assert max(widths) - min(widths) > 60
    # The box's color fills the corner-free part of a line (left edge, between the glyphs and the box edge).
    y = top + 22  # below the first box's top corners
    left = next(l for row_y, l, _ in rows if row_y == y)
    assert img.getpixel((left + 6, y)) == box
    # The text on it is in the contrast color, with no black outline around it.
    pixels = list(img.crop((0, top, 1080, bottom)).getdata())
    assert any(px[:3] == ink and px[3] == 255 for px in pixels)
    if ink == (255, 255, 255):
        assert not any(px[:3] == (0, 0, 0) and px[3] == 255 for px in pixels)  # no opaque outline (the dark box is 90%)


def test_outside_the_snug_box_is_video(tmp_path):
    img = _boxed(tmp_path, "dark", "I quit my job and this happened to my business in under ninety days")
    rows = _rows(img)
    lefts = [left for _, left, _ in rows]
    # Where a line is narrower than the widest, the space beside its box is see-through (the video).
    narrow_y, narrow_left, _ = max(rows, key=lambda row: row[1])
    assert narrow_left > min(lefts) + 40
    assert img.getpixel((narrow_left - 20, narrow_y))[3] == 0
    assert img.getpixel((min(lefts) - 10, narrow_y))[3] == 0
    # Above and below the boxes too.
    assert img.getpixel((540, rows[0][0] - 8))[3] == 0
    assert img.getpixel((540, rows[-1][0] + 8))[3] == 0


def test_boxes_keep_the_text_where_it_was(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    plain, _ = _bar_text(tmp_path / "a", {"look": "floating"}, TEXT)
    boxed, _ = _bar_text(tmp_path / "b", {"look": "floating", "textBg": "light"}, TEXT)
    with Image.open(plain) as a, Image.open(boxed) as b:
        assert a.size == b.size
        # The black text on the light box lands on the white text's fill (inside the outline).
        dark = [(x, y) for y in range(0, b.height, 3) for x in range(0, b.width, 3) if b.getpixel((x, y)) == (0, 0, 0, 255)]
        assert dark and sum(a.getpixel(p)[:3] == (255, 255, 255) for p in dark) / len(dark) > 0.9


def test_render_floating_with_a_dark_box(tmp_path, monkeypatch):
    ffmpeg, out = _render(tmp_path, monkeypatch, {"look": "floating", "textBg": "dark"})
    corner = _mean(ffmpeg, out, 1.0, "crop=20:10:0:0")
    assert corner.max() < 235, corner  # still no bar
