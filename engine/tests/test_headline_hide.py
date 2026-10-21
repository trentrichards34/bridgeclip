"""'Hide hook text': the hook text fades out N seconds into the video; a bar stays as a plain band."""

import asyncio
import os
import shutil
import subprocess

import numpy as np
import pytest

from clip_engine.services import rendering_service as module
from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.rendering_service import (
    HEADLINE_HIDE_FADE_S, HeadlineLook, RenderingService, RenderRequest, TitleStyle, headline_hide_fade, headline_hide_overlay,
    parse_headline_look, validate_headline_look,
)

from .test_audit_render import FFMPEG_WITH_ASS, needs_libass

TEXT = "TJR finds out people are getting scammed by this"


def test_hide_after_parses_validates_and_round_trips():
    look = {"look": "black", "color": "#FFFFFF", "font": "clean", "hideAfterS": 10}
    assert validate_headline_look(look) == look
    assert parse_headline_look(look).hide_after_s == 10
    assert parse_headline_look(look).as_dict() == look
    # Older looks (no hideAfterS) read and compare the same.
    assert "hideAfterS" not in parse_headline_look({"look": "black"}).as_dict()
    assert validate_headline_look({"look": "floating", "textBg": "dark", "hideAfterS": 3}) == {
        "look": "floating", "color": "#FFFFFF", "font": "clean", "textBg": "dark", "hideAfterS": 3}
    for bad in (7, 0, -3, "10", 10.0, True, None, [10]):
        with pytest.raises(ValueError):
            validate_headline_look({"look": "white", "hideAfterS": bad})
        # The lenient parser drops it: the hook text stays.
        assert parse_headline_look({"look": "white", "hideAfterS": bad}).hide_after_s is None


def test_fade_is_on_the_output_clock():
    look = HeadlineLook("black", hide_after_s=10)
    assert headline_hide_fade(look, 30.0) == (10, HEADLINE_HIDE_FADE_S)
    # At 1.5x, 10 output seconds are 15 seconds on the edited clock the overlays run on.
    start, length = headline_hide_fade(look, 30.0, 1.5)
    assert (start, round(length, 3)) == (15.0, 0.45)
    # A clip that ends first, no choice, or no hook text: nothing changes.
    assert headline_hide_fade(look, 10.0) is None
    assert headline_hide_fade(look, 9.5) is None
    assert headline_hide_fade(HeadlineLook("black"), 30.0) is None
    assert headline_hide_fade(HeadlineLook("none", hide_after_s=3), 30.0) is None
    enable, image = headline_hide_overlay((15.0, 0.45))
    assert enable == "lt(t,15.450)"
    assert image == "format=rgba,fade=t=out:st=15.000:d=0.450:alpha=1"


def _plan():
    return ClipLayoutPlan([ShotLayout(0, 30000, LayoutType.TALKING_HEAD)], 64, 64)


@pytest.mark.parametrize("speed,end_s,expected", [
    (1.0, 20.0, "fade=t=out:st=5.000:d=0.300"),
    (1.5, 20.0, "fade=t=out:st=7.500:d=0.450"),
    # 7 s edited at 1.5x is a 4.7 s clip: shorter than 5 s, so the hook text stays.
    (1.5, 7.0, None),
])
def test_create_overlay_fades_the_headline(tmp_path, speed, end_s, expected):
    request = RenderRequest("in.mp4", str(tmp_path / "o.mp4"), 0, 30000, 64, 64, title_style=TitleStyle.HEADLINE,
                            headline_text=TEXT, headline_look={"look": "floating", "hideAfterS": 5}, video_speed=speed)
    service = RenderingService()
    headline = service._headline_bar_image(request, 1080, 1920, False)
    overlays = service._overlays(request, _plan(), 1080, 1920, False, headline=headline, end_s=end_s)
    first = overlays[0]
    assert first[0] == headline[0]
    if expected is None:
        assert len(first) == 3
    else:
        assert len(first) == 5 and expected in first[4] and first[3].startswith("lt(t,")


def _bright(ffmpeg, path, at, crop):
    raw = subprocess.run([ffmpeg, "-v", "error", "-ss", str(at), "-i", str(path), "-frames:v", "1", "-vf", crop,
                          "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=120).stdout
    pixels = np.frombuffer(raw, np.uint8).reshape(-1, 3)
    return int((pixels.min(axis=1) > 200).sum()), pixels.mean(axis=0)


def _render(tmp_path, monkeypatch, look, duration, speed=1.0):
    ffmpeg, _ = FFMPEG_WITH_ASS
    from .test_av_sync import source
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    service = RenderingService()
    service._video_codec_args = lambda *args: ["-c:v", "mpeg4", "-q:v", "2", "-bf", "2"]
    monkeypatch.setattr(module, "get_output_dimensions", lambda *_: (360, 640))

    async def plan(request, width, height, start, duration):
        return ClipLayoutPlan([ShotLayout(0, duration, LayoutType.TALKING_HEAD)], width, height)

    monkeypatch.setattr(service, "_plan_layout", plan)
    path = source(tmp_path, duration=duration)
    request = RenderRequest(str(path), str(tmp_path / "clip.mp4"), 0, duration * 1000, 64, 64, pacing="natural",
                            apply_padding=False, include_captions=False, title_style=TitleStyle.HEADLINE,
                            headline_text=TEXT, headline_look=look, video_speed=speed)
    result = asyncio.run(service.render_clip(request))
    return ffmpeg, result.output_path


@needs_libass
def test_render_black_bar_text_fades_and_the_bar_stays(tmp_path, monkeypatch):
    ffmpeg, out = _render(tmp_path, monkeypatch, {"look": "black", "hideAfterS": 3}, 5)
    # The source is black with a white flash at .5-.7 of each second: sample away from it.
    before, _ = _bright(ffmpeg, out, 1.2, "crop=360:110:0:0")
    after, band = _bright(ffmpeg, out, 4.2, "crop=360:110:0:0")
    assert before > 300, before          # white text on the black bar
    assert after == 0 and band.max() < 30, (after, band)  # gone; the bar is still a dark band
    # The video still sits under the bar: its flash shows below the bar, never in it.
    flash, _ = _bright(ffmpeg, out, 4.6, "crop=360:40:0:600")
    assert flash > 1000


@needs_libass
def test_render_floating_text_is_gone_after_the_time_at_speed(tmp_path, monkeypatch):
    # 6 s at 1.5x is a 4 s clip; the text hides 3 s in (4.5 s on the edited clock).
    ffmpeg, out = _render(tmp_path, monkeypatch, {"look": "floating", "hideAfterS": 3}, 6, speed=1.5)
    before, _ = _bright(ffmpeg, out, 2.0, "crop=360:160:0:0")
    after, _ = _bright(ffmpeg, out, 3.6, "crop=360:160:0:0")
    assert before > 300 and after == 0, (before, after)


@needs_libass
def test_render_shorter_than_the_time_keeps_the_text(tmp_path, monkeypatch):
    ffmpeg, out = _render(tmp_path, monkeypatch, {"look": "black", "hideAfterS": 5}, 3)
    late, _ = _bright(ffmpeg, out, 2.8, "crop=360:110:0:0")
    assert late > 300


def _lavfi_video(ffmpeg, path, seconds, size):
    subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", f"color=0x303030:s={size}:r=30:d={seconds}",
                    "-f", "lavfi", "-i", f"sine=frequency=300:duration={seconds}", "-c:v", "libx264", "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path)], check=True, timeout=120)


@needs_libass
def test_remix_hook_bar_text_fades_and_the_bar_stays(tmp_path, monkeypatch):
    from clip_engine.services import remix_service as remix
    from .test_camera_remix import FAST_VIDEO
    ffmpeg, _ = FFMPEG_WITH_ASS
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    monkeypatch.setattr(remix, "VIDEO_ARGS", FAST_VIDEO)
    remixer = remix.Remixer.__new__(remix.Remixer)
    remixer.config = remix.RemixConfig(output_dir=str(tmp_path), headline_look={"look": "white", "color": "#FFFFFF", "font": "clean", "hideAfterS": 3})
    remixer.progress, remixer.warnings, remixer._clip_offset = (lambda *_: None), [], 0
    work = tmp_path / "work"
    work.mkdir()
    service = RenderingService()
    bar_path, bar_h, clear_h = remixer._headline(service, "in.mp4", str(work), 0, TEXT)
    assert bar_h > 200
    assembled = tmp_path / "assembled.mp4"
    _lavfi_video(ffmpeg, assembled, 5, f"1080x{1920 - bar_h}")
    out = tmp_path / "final.mp4"
    asyncio.run(remixer._overlay_final(service, str(assembled), str(out), str(work), bar_path=bar_path, bar_h=bar_h, clear_h=clear_h,
                                       total_s=5.0, words=[], anchor="panel", tags={"style": "commentary", "credit_text": ""}))
    dark = lambda at: int((_pixels(ffmpeg, out, at, f"crop=1080:{bar_h - 20}:0:10").max(axis=1) < 60).sum())  # noqa: E731
    assert dark(1.0) > 3000                      # black text on the white bar
    assert dark(4.0) == 0                        # gone
    assert _pixels(ffmpeg, out, 4.0, f"crop=1080:{bar_h - 20}:0:10").min() > 230  # the white bar stays


def _pixels(ffmpeg, path, at, crop):
    raw = subprocess.run([ffmpeg, "-v", "error", "-ss", str(at), "-i", str(path), "-frames:v", "1", "-vf", crop,
                          "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=120).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, 3)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")
def test_edit_my_recording_hook_text_fades(tmp_path):
    from clip_engine.services import edit_recording as er
    ffmpeg = shutil.which("ffmpeg")
    base = tmp_path / "base.mp4"
    _lavfi_video(ffmpeg, base, 5, "1080x1920")
    look = er.Look(TEXT, {"look": "brand", "color": "#1D3BB3", "font": "clean", "hideAfterS": 3}, False, "pop", None)
    out = tmp_path / "reel.mp4"
    asyncio.run(er.overlay_reel(str(base), str(out), str(tmp_path / "work"), look, [], [], 4.8, str(tmp_path)))
    white = lambda at: int((_pixels(ffmpeg, out, at, "crop=1080:300:0:20").min(axis=1) > 200).sum())  # noqa: E731
    assert white(1.0) > 3000 and white(4.0) == 0
    band = _pixels(ffmpeg, out, 4.0, "crop=1080:200:0:20").mean(axis=0)
    assert abs(band[2] - 0xB3) < 25 and band[0] < 70, band  # the brand bar stays
