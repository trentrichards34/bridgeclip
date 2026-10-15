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
    assert parse_headline_look({"look": "neon", "font": "comic", "color": "red"}).__dict__ == {"look": "white", "color": "#FFFFFF", "font": "clean"}
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
    for font in ("clean", "serif", "condensed"):
        (tmp_path / font).mkdir()
        path, _ = _bar(tmp_path / font, {"look": "black", "font": font})
        with Image.open(path) as img:
            images[font] = img.convert("L").tobytes()
    assert len(set(images.values())) == 3


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
    # Headline style with no hook text doesn't fall back to a title card either.
    request = RenderRequest("in.mp4", str(tmp_path / "o.mp4"), 0, 1000, 64, 64, title_style=TitleStyle.HEADLINE,
                            title_text="Short title", headline_text=TEXT, headline_look={"look": "none"})
    assert RenderingService()._title_overlay_image(request, 1080) is None
    card = RenderRequest("in.mp4", str(tmp_path / "o.mp4"), 0, 1000, 64, 64, title_style=TitleStyle.CARD, title_text="Short title")
    assert RenderingService()._title_overlay_image(card, 1080) is not None


def test_render_with_no_hook_text_keeps_the_full_frame(tmp_path, monkeypatch):
    ffmpeg, out = _render(tmp_path, monkeypatch, {"look": "none"})
    corner = _mean(ffmpeg, out, 1.0, "crop=20:10:0:0")
    assert corner.max() < 235, corner
