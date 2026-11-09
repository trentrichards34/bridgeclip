"""Headline title style: a white story-headline bar above the video panel."""

import asyncio
import json
import os
import subprocess

from PIL import Image

from clip_engine.services import rendering_service as module
from clip_engine.services.intelligence_planner import clean_headline
from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.rendering_service import RenderingService, RenderRequest, TitleStyle

from .test_audit_render import FFMPEG_WITH_ASS, needs_libass
from .test_background_split import _mean


def _request(tmp_path, **kw):
    return RenderRequest("in.mp4", str(tmp_path / "o.mp4"), 0, 1000, 64, 64, **kw)


def test_pad_for_headline_keeps_base_label():
    graph = "[0:v]null[clocked];[clocked]concat=n=1:v=1:a=0[base]"
    padded = RenderingService._pad_for_headline(graph, 1080, 1920, 380)
    assert padded.count("[base]") == 1 and padded.endswith("[base]")
    assert "pad=1080:1920:0:380:color=white" in padded


def test_headline_bar_is_full_width_white_and_sized_to_the_text(tmp_path):
    service = RenderingService()
    short = service._headline_bar_image(_request(tmp_path, title_style=TitleStyle.HEADLINE,
                                                 headline_text="Brez thought he is Mentalist"), 1080, 1920, False)
    img = Image.open(short[0]).convert("RGB")
    long = service._headline_bar_image(_request(tmp_path, title_style=TitleStyle.HEADLINE, headline_text=(
        "A 9-5 mechanic tried to humble Brez and it went completely wrong for him in front of everyone")),
        1080, 1920, False)
    assert short and long
    path, bar_h = short
    assert bar_h % 2 == 0 and 1920 * 0.17 - 2 <= bar_h <= 1920 * 0.30
    assert img.size == (1080, bar_h)
    assert img.getpixel((5, 5)) == (255, 255, 255)
    assert min(img.getdata())[0] < 50  # black text drawn
    assert long[1] >= bar_h


def test_headline_falls_back_to_the_title_and_drops_emoji(tmp_path):
    service = RenderingService()
    result = service._headline_bar_image(_request(tmp_path, title_style=TitleStyle.HEADLINE,
                                                  title_text="He Bought A Corvette 😭"), 1080, 1920, False)
    assert result is not None


def test_headline_only_for_vertical_headline_style_with_title_on(tmp_path):
    service = RenderingService()
    args = dict(headline_text="This debate had everyone picking sides")
    assert service._headline_bar_image(_request(tmp_path, **args), 1080, 1920, False) is None  # card style
    assert service._headline_bar_image(_request(tmp_path, title_style="headline", include_title=False, **args),
                                       1080, 1920, False) is None
    assert service._headline_bar_image(_request(tmp_path, title_style="headline", **args), 1920, 1080, True) is None


def test_clean_headline():
    assert clean_headline("“A 9-5 mechanic tried to humble Brez” #shorts #fyp") == "A 9-5 mechanic tried to humble Brez"
    assert clean_headline("Wow") is None and clean_headline(None) is None and clean_headline(5) is None
    assert len(clean_headline("word " * 100)) <= 120


@needs_libass
def test_render_puts_the_video_under_a_white_headline_bar(tmp_path, monkeypatch):
    ffmpeg, ffprobe = FFMPEG_WITH_ASS
    from .test_av_sync import source
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    service = RenderingService()
    service._video_codec_args = lambda *args: ["-c:v", "mpeg4", "-q:v", "2", "-bf", "2"]
    monkeypatch.setattr(module, "get_output_dimensions", lambda *_: (360, 640))

    async def plan(request, width, height, start, duration):
        return ClipLayoutPlan([ShotLayout(0, duration, LayoutType.TALKING_HEAD)], width, height)

    monkeypatch.setattr(service, "_plan_layout", plan)
    path = source(tmp_path, duration=3)
    request = RenderRequest(str(path), str(tmp_path / "clip.mp4"), 0, 3000, 64, 64, pacing="natural",
                            apply_padding=False, include_captions=False, title_style=TitleStyle.HEADLINE,
                            title_text="Short title", headline_text="TJR finds out people are getting scammed by this")
    result = asyncio.run(service.render_clip(request))
    assert result.render_fallback is None
    probe = json.loads(subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json",
         result.output_path], capture_output=True, check=True, text=True).stdout)
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (360, 640)
    corner = _mean(ffmpeg, result.output_path, 1.0, "crop=40:20:0:0")
    assert corner.min() > 235, corner  # the bar is white
    panel = _mean(ffmpeg, result.output_path, 1.0, "crop=360:200:0:400")
    assert panel.min() < 235, panel  # the video below it is not
