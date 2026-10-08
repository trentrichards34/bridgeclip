"""Gameplay split: speaker on top, a looping muted background video underneath."""

import asyncio
import json
import os
import subprocess

import numpy as np
import pytest

from clip_engine.services import rendering_service as module
from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.rendering_service import RenderingError, RenderingService, RenderRequest

from .test_audit_render import FFMPEG_WITH_ASS, needs_libass


def test_stack_background_keeps_base_label_and_reads_input_one():
    graph = "[0:v]null[clocked];[clocked]concat=n=1:v=1:a=0[base]"
    stacked = RenderingService._stack_background(graph, 1080, 960, "30")
    assert stacked.count("[base]") == 1 and stacked.endswith("[base]")
    assert "[speaker]" in stacked and "[1:v]fps=30" in stacked
    assert "scale=1080:960:force_original_aspect_ratio=increase" in stacked and "crop=1080:960" in stacked
    assert "vstack=inputs=2:shortest=1" in stacked


def test_overlays_shift_past_the_background_input():
    overlays = [("title.png", "0", "0"), ("banner.png", "0", "10")]
    graph, inputs = RenderingService._compose_overlays("[x]null[captioned]", overlays, first_index=2)
    assert inputs == ["title.png", "banner.png"]
    assert "[2:v]overlay" in graph and "[3:v]overlay" in graph and "[1:v]" not in graph
    assert "[composited]null[out]" in graph


def test_missing_background_fails_with_a_clear_message(tmp_path):
    request = RenderRequest("in.mp4", str(tmp_path / "o.mp4"), 0, 1000, 64, 64,
                            background_video_path=str(tmp_path / "gone.mp4"))
    with pytest.raises(RenderingError, match="background video is missing"):
        RenderingService._background_video(request, is_landscape=False)


def test_landscape_ignores_the_background(tmp_path):
    request = RenderRequest("in.mp4", str(tmp_path / "o.mp4"), 0, 1000, 64, 64,
                            background_video_path=str(tmp_path / "gone.mp4"))
    assert RenderingService._background_video(request, is_landscape=True) is None


def _mean(ffmpeg: str, path: str, at: float, crop: str) -> np.ndarray:
    raw = subprocess.run(
        [ffmpeg, "-v", "error", "-ss", str(at), "-i", path, "-frames:v", "1", "-vf", crop,
         "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=120,
    ).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, 3).mean(axis=0)


@needs_libass
def test_render_stacks_a_looping_background_under_the_speaker(tmp_path, monkeypatch):
    ffmpeg, ffprobe = FFMPEG_WITH_ASS
    from .test_av_sync import source
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    service = RenderingService()
    service._video_codec_args = lambda *args: ["-c:v", "mpeg4", "-q:v", "2", "-bf", "2"]
    monkeypatch.setattr(module, "get_output_dimensions", lambda *_: (180, 320))

    async def plan(request, width, height, start, duration):
        return ClipLayoutPlan([ShotLayout(0, duration, LayoutType.TALKING_HEAD)], width, height)

    monkeypatch.setattr(service, "_plan_layout", plan)
    path = source(tmp_path, duration=6)
    # A 2-second pure green background must loop to cover the 6-second clip.
    background = tmp_path / "gameplay.mp4"
    subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=c=0x00ff00:s=320x240:d=2:r=30",
                    "-c:v", "mpeg4", "-q:v", "2", str(background)], check=True, timeout=120)

    request = RenderRequest(str(path), str(tmp_path / "clip.mp4"), 0, 6000, 64, 64, pacing="natural",
                            apply_padding=False, include_captions=False, include_title=False,
                            background_video_path=str(background))
    result = asyncio.run(service.render_clip(request))
    assert result.render_fallback is None

    probe = json.loads(subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration",
         "-of", "json", result.output_path], capture_output=True, check=True, text=True).stdout)
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (180, 320)
    assert abs(float(probe["format"]["duration"]) - 6.0) < 0.3  # the speaker sets the length
    assert any(s["codec_type"] == "audio" for s in probe["streams"])  # speaker audio is kept

    for at in (1.0, 4.5):  # 4.5 s is past the background's first loop
        bottom = _mean(ffmpeg, result.output_path, at, "crop=180:150:0:165")
        assert bottom[1] > 180 and bottom[0] < 60 and bottom[2] < 60, (at, bottom)
        top = _mean(ffmpeg, result.output_path, at, "crop=180:150:0:5")
        assert not (top[1] > 180 and top[0] < 60), (at, top)  # the speaker, not green
