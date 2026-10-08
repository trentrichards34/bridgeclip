"""B-roll mode: beat planning, Pexels footage, and the full-frame overlay."""

import asyncio
import json
import os
import subprocess

import httpx
import numpy as np
import pytest

from clip_engine.services import broll_service as broll
from clip_engine.services import rendering_service as module
from clip_engine.services.clip_editor import TimeMap
from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.rendering_service import RenderingError, RenderingService, RenderRequest
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord

from .test_audit_render import FFMPEG_WITH_ASS, needs_libass


def spans(shots):
    return [(s.start_ms, s.end_ms, s.query) for s in shots]


class TestNormalizeShots:
    def test_tiles_from_the_hook_to_the_end_without_gaps(self):
        raw = [
            {"start": 3.0, "end": 5.5, "query": "Laptop Spreadsheet!"},
            {"start": 6.0, "end": 9.0, "query": "cash counting"},
            {"start": 9.0, "end": 11.0, "query": "city traffic night"},
        ]
        shots = broll.normalize_shots(raw, 10_000, 22_000, 13_000)
        assert spans(shots)[0][:2] == (13_000, 16_000)  # the 0.5 s gap joins the earlier shot
        assert spans(shots)[0][2] == "laptop spreadsheet"
        for a, b in zip(shots, shots[1:]):
            assert a.end_ms == b.start_ms  # back to back
        assert shots[-1].end_ms == 22_000  # covers to the end
        assert all(broll.MIN_SHOT_MS <= s.end_ms - s.start_ms <= broll.MAX_SHOT_MS for s in shots)

    def test_long_shots_split_and_slivers_merge(self):
        raw = [{"start": 0, "end": 12, "query": "ocean waves"}, {"start": 12, "end": 12.5, "query": "sliver"}]
        shots = broll.normalize_shots(raw, 0, 12_500, 0)
        assert all(s.end_ms - s.start_ms <= broll.MAX_SHOT_MS for s in shots)
        assert "sliver" not in [s.query for s in shots]
        assert shots[0].start_ms == 0 and shots[-1].end_ms == 12_500

    def test_garbage_is_ignored(self):
        raw = [None, {"start": "x"}, {"start": 1, "end": 2}, {"start": 1, "end": 4, "query": 7}, "nope"]
        assert broll.normalize_shots(raw, 0, 10_000, 0) == []
        assert broll.normalize_shots("nope", 0, 10_000, 0) == []


def test_transcript_lines_are_relative_phrases():
    words = [TranscriptWord(w, 10_000 + i * 400, 10_000 + i * 400 + 350) for i, w in enumerate("This one ad made me a million.".split())]
    text = broll.transcript_lines([TranscriptSegment(10_000, 13_000, "", words=words)], 10_000, 14_000)
    assert text.startswith("[0.0-")
    assert "million." in text


def video(id_, files):
    return {"id": id_, "video_files": files}


def mp4(w, h, link):
    return {"file_type": "video/mp4", "width": w, "height": h, "link": link}


def test_pick_file_prefers_the_right_orientation_near_1080():
    v = video(1, [
        mp4(720, 1280, "https://videos.pexels.com/a.mp4"),
        mp4(1080, 1920, "https://videos.pexels.com/b.mp4"),
        mp4(2160, 3840, "https://videos.pexels.com/c.mp4"),
        mp4(1920, 1080, "https://videos.pexels.com/landscape.mp4"),
        mp4(1080, 1920, "https://evil.example.com/x.mp4"),
    ])
    assert broll.pick_file(v, portrait=True)["link"].endswith("/b.mp4")
    assert broll.pick_file(v, portrait=False)["link"].endswith("/landscape.mp4")


@pytest.mark.parametrize("url,ok", [
    ("https://videos.pexels.com/video-files/1/a.mp4", True),
    ("https://pexels.com/a.mp4", True),
    ("http://videos.pexels.com/a.mp4", False),
    ("https://pexels.com.evil.com/a.mp4", False),
    ("https://evilpexels.com/a.mp4", False),
    ("file:///etc/passwd", False),
])
def test_footage_only_comes_from_pexels(url, ok):
    assert broll.is_pexels_media(url) is ok


def test_fill_downloads_one_file_per_beat_and_drops_misses(tmp_path):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        if request.url.host == "api.pexels.com":
            assert request.headers["Authorization"] == "KEY"
            query = request.url.params["query"]
            if query == "nothing here":
                return httpx.Response(200, json={"videos": []})
            return httpx.Response(200, json={"videos": [
                video(11, [mp4(1080, 1920, f"https://videos.pexels.com/{query.replace(' ', '-')}-1.mp4")]),
                video(12, [mp4(1080, 1920, f"https://videos.pexels.com/{query.replace(' ', '-')}-2.mp4")]),
            ]})
        return httpx.Response(200, content=b"video-bytes")

    async def run():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        async with broll.PexelsClient("KEY", str(tmp_path / "cache"), client) as pexels:
            shots = [broll.BrollShot(0, 3000, "cash counting"), broll.BrollShot(3000, 6000, "nothing here"),
                     broll.BrollShot(6000, 9000, "cash counting")]
            filled = await pexels.fill(shots, portrait=True)
        await client.aclose()
        return filled

    filled = asyncio.run(run())
    assert [s.query for s in filled] == ["cash counting", "cash counting"]
    assert filled[0].path != filled[1].path  # a repeated search uses a different video
    assert all(os.path.isfile(s.path) for s in filled)
    assert sum("api.pexels.com" in url for url in requests) == 2  # searches are cached per query


def test_a_rejected_pexels_key_stops_with_a_clear_message(tmp_path):
    def handler(request):
        return httpx.Response(401, json={})

    async def run():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        async with broll.PexelsClient("BAD", str(tmp_path), client) as pexels:
            await pexels.fill([broll.BrollShot(0, 3000, "ocean")], portrait=True)

    with pytest.raises(PermissionError, match="Pexels rejected the API key"):
        asyncio.run(run())


def test_plan_shots_uses_the_model_and_keeps_the_hook(monkeypatch):
    seen = {}

    async def fake_chat(client, payload):
        seen["payload"] = payload
        return {"choices": [{"message": {"content": json.dumps({"shots": [
            {"start": 0, "end": 4, "query": "laptop spreadsheet"},
            {"start": 4, "end": 8, "query": "cash counting"},
        ]})}}]}, {}

    monkeypatch.setattr(broll, "chat_completion", fake_chat)
    settings = type("S", (), {"openrouter_api_key": "k", "broll_model": "fast/model", "openrouter_base_url": "https://openrouter.ai/api/v1",
                               "get_broll_fallback_models": lambda self: ["other/model"]})()
    words = [TranscriptWord(w, i * 500, i * 500 + 450) for i, w in enumerate("one ad made me a million dollars from a spreadsheet".split())]
    shots = asyncio.run(broll.plan_shots([TranscriptSegment(0, 5000, "", words=words)], 0, 8000, 3000, settings))
    assert seen["payload"]["model"] == "fast/model" and seen["payload"]["models"] == ["other/model"]
    assert shots[0].start_ms == 3000 and shots[-1].end_ms == 8000


def test_planning_failure_means_no_broll(monkeypatch):
    async def broken(client, payload):
        raise broll.OpenRouterError("down")

    monkeypatch.setattr(broll, "chat_completion", broken)
    settings = type("S", (), {"openrouter_api_key": "k", "broll_model": "m", "openrouter_base_url": "https://x.test",
                               "get_broll_fallback_models": lambda self: []})()
    words = [TranscriptWord("hello", 0, 9000)]
    assert asyncio.run(broll.plan_shots([TranscriptSegment(0, 9000, "hello", words=words)], 0, 9000, 0, settings)) == []


def test_overlay_graph_places_each_shot_on_the_output_clock():
    graph = "[0:v]null[clocked];[clocked]concat=n=1:v=1:a=0[base]"
    out = RenderingService._overlay_broll(graph, [("a.mp4", 3.0, 5.5), ("b.mp4", 5.5, 8.0)], 1080, 1920, "30")
    assert out.count("[base]") == 1 and out.endswith("[base]")
    assert "[1:v]trim=duration=2.500,setpts=PTS-STARTPTS+3.000/TB" in out
    assert "[2:v]trim=duration=2.500,setpts=PTS-STARTPTS+5.500/TB" in out
    assert "enable='between(t,3.000,5.500)'" in out and "crop=1080:1920" in out


def test_broll_windows_follow_cuts_and_skip_slivers(tmp_path):
    a, b = tmp_path / "a.mp4", tmp_path / "b.mp4"
    a.write_bytes(b"x"), b.write_bytes(b"x")
    # Window starts at 10 s; 2-4 s of window time was cut.
    time_map = TimeMap([(0, 2000), (4000, 10_000)], 10_000)
    request = RenderRequest("in.mp4", str(tmp_path / "o.mp4"), 10_000, 20_000, 64, 64, broll_shots=[
        (13_000, 15_000, str(a)),          # half inside the cut
        (15_000, 15_300, str(b)),          # too short to show
        (16_000, 20_000, str(tmp_path / "gone.mp4")),  # missing file
    ])
    windows = RenderingService._broll_windows(request, time_map, 10_000)
    assert windows == [(str(a), 2.0, 3.0)]


def test_broll_and_background_are_exclusive(tmp_path):
    request = RenderRequest("in.mp4", str(tmp_path / "o.mp4"), 0, 1000, 64, 64,
                            background_video_path="bg.mp4", broll_shots=[(0, 1000, "a.mp4")])
    with pytest.raises(RenderingError, match="background video or B-roll"):
        RenderingService._broll_windows(request, TimeMap([(0, 1000)]), 0)


def _mean(ffmpeg, path, at):
    raw = subprocess.run([ffmpeg, "-v", "error", "-ss", str(at), "-i", path, "-frames:v", "1", "-vf", "crop=180:200:0:60",
                          "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=120).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, 3).mean(axis=0)


@needs_libass
def test_render_shows_the_speaker_for_the_hook_then_broll(tmp_path, monkeypatch):
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
    clips = []
    for name, color in (("red", "0xff0000"), ("blue", "0x0000ff")):
        clip = tmp_path / f"{name}.mp4"
        # 1-second footage must loop to fill a longer beat.
        subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", f"color=c={color}:s=360x640:d=1:r=30",
                        "-c:v", "mpeg4", "-q:v", "2", str(clip)], check=True, timeout=120)
        clips.append(str(clip))
    request = RenderRequest(str(path), str(tmp_path / "clip.mp4"), 0, 6000, 64, 64, pacing="natural",
                            apply_padding=False, include_captions=False, include_title=False,
                            broll_shots=[(2000, 4000, clips[0]), (4000, 6000, clips[1])])
    result = asyncio.run(service.render_clip(request))
    assert result.render_fallback is None

    probe = json.loads(subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration:stream=codec_type",
                                       "-of", "json", result.output_path], capture_output=True, check=True, text=True).stdout)
    assert abs(float(probe["format"]["duration"]) - 6.0) < 0.3
    assert any(s["codec_type"] == "audio" for s in probe["streams"])

    hook = _mean(ffmpeg, result.output_path, 1.0)
    red = _mean(ffmpeg, result.output_path, 3.5)
    blue = _mean(ffmpeg, result.output_path, 5.5)
    assert not (hook[0] > 180 and hook[1] < 60) and not (hook[2] > 180 and hook[0] < 60), hook
    assert red[0] > 180 and red[1] < 60 and red[2] < 60, red
    assert blue[2] > 180 and blue[0] < 60 and blue[1] < 60, blue
