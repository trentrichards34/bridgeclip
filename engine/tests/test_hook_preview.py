"""Hook preview: the clip opens with its strongest line, then plays from the start."""

import asyncio
import json
import os
import subprocess

import numpy as np

from clip_engine.services import hook_preview
from clip_engine.services import rendering_service as module
from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.rendering_service import RenderingService, RenderRequest
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord

from .test_audit_render import FFMPEG_WITH_ASS, needs_libass


def transcript(start_ms=0, count=30, step=500):
    words = [TranscriptWord(f"w{i}", start_ms + i * step, start_ms + i * step + 400) for i in range(count)]
    return [TranscriptSegment(words[0].start_time_ms, words[-1].end_time_ms, " ".join(w.word for w in words), words=words)]


class TestSnap:
    def test_snaps_to_whole_words_with_a_little_air(self):
        span = hook_preview.snap_to_words(transcript(), 0, 15_000, 6_100, 8_300)
        assert span == (6_000 - 80, 8_400 + 120)

    def test_rejects_the_opening_and_too_short_or_empty_spans(self):
        assert hook_preview.snap_to_words(transcript(), 0, 15_000, 500, 3_000) is None  # the hook itself
        assert hook_preview.snap_to_words(transcript(), 0, 15_000, 6_000, 6_500) is None  # too short
        assert hook_preview.snap_to_words(transcript(), 0, 15_000, 20_000, 22_000) is None  # no words

    def test_long_spans_are_trimmed_to_the_limit(self):
        start, end = hook_preview.snap_to_words(transcript(), 0, 15_000, 4_000, 12_000)
        assert end - start <= hook_preview.MAX_TEASER_MS + 200


class FakeSettings:
    openrouter_api_key = "k"
    broll_model = "fast/model"
    openrouter_base_url = "https://openrouter.ai/api/v1"

    def get_broll_fallback_models(self):
        return []


def fake_chat(reply):
    async def chat(client, payload):
        chat.payload = payload
        return {"choices": [{"message": {"content": json.dumps(reply)}}]}, {}
    return chat


def test_pick_teaser_returns_a_snapped_span(monkeypatch):
    monkeypatch.setattr(hook_preview, "chat_completion", fake_chat({"use_teaser": True, "start": 6.0, "end": 8.4, "reason": "the number"}))
    assert asyncio.run(hook_preview.pick_teaser(transcript(), 0, 15_000, FakeSettings())) == (5_920, 8_520)


def test_pick_teaser_respects_no_and_short_clips(monkeypatch):
    monkeypatch.setattr(hook_preview, "chat_completion", fake_chat({"use_teaser": False, "start": 0, "end": 0, "reason": "none"}))
    assert asyncio.run(hook_preview.pick_teaser(transcript(), 0, 15_000, FakeSettings())) is None
    assert asyncio.run(hook_preview.pick_teaser(transcript(), 0, 9_000, FakeSettings())) is None  # under 12 s


def test_pick_teaser_survives_model_failure(monkeypatch):
    async def broken(client, payload):
        raise hook_preview.OpenRouterError("down")
    monkeypatch.setattr(hook_preview, "chat_completion", broken)
    assert asyncio.run(hook_preview.pick_teaser(transcript(), 0, 15_000, FakeSettings())) is None


def _rgb(ffmpeg, path, at):
    raw = subprocess.run([ffmpeg, "-v", "error", "-ss", str(at), "-i", path, "-frames:v", "1", "-vf", "crop=180:200:0:60",
                          "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=120).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, 3).mean(axis=0)


@needs_libass
def test_prepend_teaser_plays_the_line_then_the_whole_clip(tmp_path, monkeypatch):
    ffmpeg, ffprobe = FFMPEG_WITH_ASS
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    # 0-5 s red, 5-10 s green, 10-15 s blue, with a tone throughout.
    source = tmp_path / "source.mp4"
    subprocess.run([ffmpeg, "-v", "error",
                    "-f", "lavfi", "-i", "color=c=0xff0000:s=320x180:d=5:r=30",
                    "-f", "lavfi", "-i", "color=c=0x00ff00:s=320x180:d=5:r=30",
                    "-f", "lavfi", "-i", "color=c=0x0000ff:s=320x180:d=5:r=30",
                    "-f", "lavfi", "-i", "sine=f=330:d=15",
                    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a",
                    "-c:v", "mpeg4", "-q:v", "2", "-c:a", "aac", "-shortest", str(source)], check=True, timeout=120)
    service = RenderingService()
    service._video_codec_args = lambda *args: ["-c:v", "mpeg4", "-q:v", "2", "-bf", "2"]
    monkeypatch.setattr(module, "get_output_dimensions", lambda *_: (180, 320))

    async def plan(request, width, height, start, duration):
        return ClipLayoutPlan([ShotLayout(0, duration, LayoutType.TALKING_HEAD)], width, height)

    monkeypatch.setattr(service, "_plan_layout", plan)
    request = RenderRequest(str(source), str(tmp_path / "clip.mp4"), 0, 15_000, 320, 180, pacing="natural",
                            apply_padding=False, include_captions=False, include_title=False)

    async def run():
        result = await service.render_clip(request)
        return await service.prepend_teaser(request, result, 11_000, 13_000)

    result = asyncio.run(run())
    probe = json.loads(subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration:stream=codec_type",
                                       "-of", "json", result.output_path], capture_output=True, check=True, text=True).stdout)
    assert abs(float(probe["format"]["duration"]) - 17.0) < 0.4  # 2 s teaser + 15 s clip
    assert abs(result.duration_ms - 17_000) < 400
    assert any(s["codec_type"] == "audio" for s in probe["streams"])
    teaser = _rgb(ffmpeg, result.output_path, 1.0)
    opening = _rgb(ffmpeg, result.output_path, 3.0)
    assert teaser[2] > 180 and teaser[0] < 60, teaser    # blue: the line from 11-13 s
    assert opening[0] > 180 and opening[2] < 60, opening  # red: the clip's own start
    assert not os.path.exists(str(tmp_path / "clip.teaser.mp4"))
