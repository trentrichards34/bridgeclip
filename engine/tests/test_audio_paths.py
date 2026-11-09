"""Voice cleanup and music reach every place the sound is final: Create clips (and the editor's re-exports), Edit my
recording, and Remix (the member's part only)."""
import asyncio
import json
import os
import shutil
import subprocess
from types import SimpleNamespace

import numpy as np
import pytest

from clip_engine.services import ai_clipping_pipeline as pipeline_module
from clip_engine.services import audio_finish as af
from clip_engine.services import edit_recording as er
from clip_engine.services import remix_service as rs
from clip_engine.services.ai_clipping_pipeline import ClippingJobRequest, JobStatus
from clip_engine.services.intelligence_planner import ClipPlanResponse, ClipPlanSegment
from clip_engine.services.transcription_service import TranscriptionResult, TranscriptSegment, TranscriptWord
from tests.speech_fixture import RATE, frame_power, noisy_speech, read_audio, write_video
from tests.test_more_clips_and_caption_language import approved_candidates, run_pipeline  # noqa: F401 - fixture

has_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs FFmpeg")


def spy(monkeypatch, module, name="finish_in_place"):
    calls = []

    def record(path, plan, work, warnings=None):
        calls.append((path, plan))
        return {"voice_cleanup": plan.voice_cleanup, "music": plan.music.track if plan.music else None}
    monkeypatch.setattr(module, name, record)
    return calls


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

def create_run(monkeypatch, tmp_path, audio):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")

    async def transcribe(*args, **kwargs):
        return TranscriptionResult(segments=[TranscriptSegment(0, 500, "hi", words=[TranscriptWord("hi", 0, 500)])], full_text="hi")

    async def plan(**kwargs):
        return ClipPlanResponse(segments=[ClipPlanSegment(60_000, 85_000, 0.8), ClipPlanSegment(100_000, 130_000, 0.7)], total_clips=2)

    request = ClippingJobRequest(video_url=str(source), job_id="job-audio", quality_bar="off", audio=audio)
    return run_pipeline(monkeypatch, tmp_path, request, transcribe, plan)


def test_create_cleans_up_and_adds_music_to_every_clip_and_keeps_the_choice_with_the_run(monkeypatch, tmp_path):
    calls = spy(monkeypatch, pipeline_module)
    result, renders = create_run(monkeypatch, tmp_path, {"voice_cleanup": True, "music": {"track": "upbeat-pulse"}, "music_level_db": -22})
    assert result.status == JobStatus.COMPLETED, result.error
    # Applied to each rendered clip (after its hook preview), with the run's choices.
    assert sorted(path for path, _ in calls) == sorted(r.output_path for r in renders)
    assert all(plan.voice_cleanup and plan.music.track == "upbeat-pulse" and plan.music_level_db == -22 and plan.target_lufs == -14
               for _, plan in calls)
    layouts = result.output.metrics["clip_layouts"]
    assert [entry["audio"] for entry in layouts] == [{"voice_cleanup": True, "music": "upbeat-pulse"}] * 2
    assert result.output.metrics["requested_settings"]["voice_cleanup"] is True and result.output.metrics["requested_settings"]["music"] == "upbeat-pulse"
    # Kept with the run (its own copy of the music), so the editor's exports sound the same.
    saved = af.load_run_audio(str(tmp_path / "out" / "job-audio"))
    assert saved.voice_cleanup and saved.music.track == "upbeat-pulse" and os.path.isfile(saved.music.path)
    assert saved.music.path.startswith(str(tmp_path / "out" / "job-audio" / ".audio"))


def test_create_without_them_leaves_the_sound_alone(monkeypatch, tmp_path):
    calls = spy(monkeypatch, pipeline_module)
    result, _ = create_run(monkeypatch, tmp_path, None)
    assert result.status == JobStatus.COMPLETED, result.error
    assert calls == []
    assert "audio" not in result.output.metrics["clip_layouts"][0]
    assert not os.path.exists(tmp_path / "out" / "job-audio" / ".audio")


def test_the_editor_export_applies_the_runs_saved_sound(monkeypatch, tmp_path):
    from clip_engine.services import manual_editor
    run = tmp_path / "run"
    run.mkdir()
    af.save_run_audio(str(run), af.AudioPlan(voice_cleanup=True, music=af.bundled_music("calm-pad")))
    calls = []
    monkeypatch.setattr(af, "finish_in_place", lambda path, plan, work, warnings=None: calls.append((path, plan)))

    class Renderer:
        async def render_clip(self, request):
            open(request.output_path, "wb").write(b"mp4")
            return SimpleNamespace(output_path=request.output_path, duration_ms=1000, layout_type="fill", subtitle_path=None)
    monkeypatch.setattr(manual_editor, "RenderRequest", lambda **kwargs: SimpleNamespace(**kwargs))
    monkeypatch.setattr(manual_editor, "manual_plan", lambda *args, **kwargs: None)
    project = {"width": 1920, "height": 1080, "aspect_ratio": "9:16", "revision": 1}
    candidate = {"captions": False, "caption_preset": "pop", "ranges": [[0, 1000]], "video_speed": 1, "score": 1, "title": "t", "id": "c1",
                 "caption_language": None}
    output = {"clips": [], "next_clip_index": 0}
    asyncio.run(manual_editor.render_export(run, project, candidate, output, "src.mp4", [], None, 0, Renderer(), 0, 1000, None, {}, {}, {}, None))
    assert len(calls) == 1 and calls[0][1].voice_cleanup and calls[0][1].music.track == "calm-pad"
    assert os.path.isfile(run / "clip_00.mp4")


# ---------------------------------------------------------------------------
# Edit my recording
# ---------------------------------------------------------------------------

@has_ffmpeg
def test_edit_my_recording_cleans_the_voice_before_the_sound_effects_and_puts_music_under_the_mix(tmp_path, monkeypatch):
    from tests.test_edit_recording import make_recording
    root = str(tmp_path / "edit-run")
    os.makedirs(root)
    source = str(tmp_path / "recording.mp4")
    words = make_recording(source)
    cleaned, music = [], []
    real_clean, real_finish = er._clean_voice, er.finish_in_place
    monkeypatch.setattr(er, "_clean_voice", lambda path, work, warnings: cleaned.append(path) or real_clean(path, work, warnings))
    monkeypatch.setattr(er, "finish_in_place", lambda path, plan, work, warnings=None: music.append((path, plan)) or real_finish(path, plan, work, warnings))
    look = er.Look("Most coaches lose clients", {"look": "floating", "color": "#FFFFFF", "font": "clean"}, False, "pop", None)
    plan = af.AudioPlan(voice_cleanup=True, music=af.bundled_music("lofi-beat"))
    config = {"output_dir": root, "sources": [source], "words": words, "keep": [True] * len(words), "hook": None, "cta": None,
              "popups": [], "sounds": [{"at": "title", "sound": "whoosh"}], "look": look, "title": "", "cost_usd": 0,
              "sound_cache": str(tmp_path / "sounds"), "audio": plan}
    result = asyncio.run(er.render_edit(config, lambda *_: None))
    assert cleaned and cleaned[0].endswith("assembled.mkv")
    assert len(music) == 1 and music[0][0].endswith(os.path.join(".edit", "clip_00", "base.mp4"))
    assert music[0][1].music.track == "lofi-beat" and not music[0][1].voice_cleanup and music[0][1].target_lufs is None
    # The music is in the finished reel: sound where the recording was silent (between "clients." and "Um.").
    reel = read_audio(result["path"])
    level = 10 * np.log10(frame_power(reel, RATE // 10) + 1e-12)
    assert np.median(level) > -60
    assert not result.get("warnings")


def test_edit_runner_checks_the_audio_options():
    import edit_runner
    from tests.test_edit_recording import script
    words = script(("Most coaches lose clients.", 0.5))
    base = {"mode": "render", "output_dir": "/tmp/x", "sources": ["/tmp/a.mp4"], "words": [[w.text, w.start_ms, w.end_ms, 0] for w in words],
            "keep": [True] * len(words), "look": {"headline": "Hook", "include_captions": True, "caption_preset": "pop"}}
    assert edit_runner.parse_request(base)["audio"] is None
    parsed = edit_runner.parse_request({**base, "audio": {"voice_cleanup": True, "music": {"track": "calm-pad"}}})
    assert parsed["audio"].voice_cleanup and parsed["audio"].music.track == "calm-pad"
    for bad in ({"voice_cleanup": 1}, {"music": {"track": "../x"}}, {"music": {"path": "/no/such.mp3"}}):
        with pytest.raises(ValueError):
            edit_runner.parse_request({**base, "audio": bad})


# ---------------------------------------------------------------------------
# Remix
# ---------------------------------------------------------------------------

def remix_result(tmp_path, fmt="moment_take", camera=True, seconds=12.0):
    manifest = tmp_path / "clip_00.source.json"
    manifest.write_text(json.dumps({"timeline": [{"part": "moment", "start_seconds": 0, "seconds": 4.0},
                                                 {"part": "take", "start_seconds": 4.0, "seconds": 8.0}]}))
    return rs.RemixResult(path=str(tmp_path / "clip_00.mp4"), manifest_path=str(manifest), headline="h", stance="s", excerpt_seconds=4,
                          duration_seconds=seconds, cost_usd=0, checks=[], warnings=[], format=fmt, camera=camera)


def test_remix_leaves_their_clip_alone_and_by_default_plays_no_music_under_it(tmp_path):
    result = remix_result(tmp_path)
    plan = af.AudioPlan(voice_cleanup=True, music=af.bundled_music("calm-pad"))
    keep = rs.their_windows(result, {})
    assert keep == [(0.0, 4.0)]
    own = rs.remix_sound_plan(plan, result, keep)
    assert own.voice_cleanup and own.keep_windows == [(0.0, 4.0)] and own.quiet_windows == [(0.0, 4.0)] and own.target_lufs is None
    # "Music under their clip too": the music plays throughout, still ducking under every voice.
    assert rs.remix_sound_plan(af.AudioPlan(music=af.bundled_music("calm-pad"), music_during_clip=True), result, keep).quiet_windows == []
    # An AI presenter's voice isn't a recording to clean up; React to a clip is their clip from start to end.
    assert not rs.remix_sound_plan(plan, remix_result(tmp_path, camera=False), keep).voice_cleanup
    silent = remix_result(tmp_path, fmt="silent")
    silent_plan = rs.remix_sound_plan(plan, silent, rs.their_windows(silent, {}))
    assert not silent_plan.active


def test_pause_and_react_keeps_the_stretches_where_their_video_plays(tmp_path):
    from clip_engine.services.pause_react import Segment, Timeline
    timeline = Timeline(10.0, 25.0, 0.0, 60.0, "app", [Segment(10.0, 14.0, "play", 0.0), Segment(14.0, 20.0, "pause", 4.0),
                                                       Segment(20.0, 25.0, "play", 4.0)])
    assert rs.their_windows(remix_result(tmp_path, fmt="pause_react"), {"timeline": timeline}) == [(0.0, 4.0), (10.0, 15.0)]


@has_ffmpeg
def test_a_remix_render_cleans_the_members_part_and_recompose_does_it_again(tmp_path):
    noisy, _, _ = noisy_speech(12.0, -34.0)
    result = remix_result(tmp_path)
    write_video(str(tmp_path / "clip_00.mkv"), noisy, str(tmp_path / "remix.wav"))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp_path / "clip_00.mkv"), "-c:v", "copy", "-c:a", "aac", result.path], check=True)
    before = read_audio(result.path)
    folder = rs.edit_dir(str(tmp_path), "clip_00")
    os.makedirs(folder)
    rs.write_edit_bundle(folder, {"version": rs.EDIT_VERSION, "kind": "panel"})
    plan = af.AudioPlan(voice_cleanup=True, music=af.bundled_music("calm-pad"))
    af.save_run_audio(str(tmp_path), plan)
    rs.finish_remix_sound(result, plan, {}, str(tmp_path))
    after = read_audio(result.path)
    t = np.arange(min(len(before), len(after))) / RATE
    theirs, mine = (t > 0.2) & (t < 3.8), (t > 4.5)
    n = len(t)
    assert np.corrcoef(before[:n][theirs], after[:n][theirs])[0, 1] > 0.99
    assert np.corrcoef(before[:n][mine], after[:n][mine])[0, 1] < 0.99
    with open(os.path.join(folder, "edit.json"), encoding="utf-8") as handle:
        saved = json.load(handle)["audio"]
    assert saved == {"voice_cleanup": True, "music": True, "keep": [[0.0, 4.0]]}
    # Recompose redraws the hook over the joined video (its sound as it was): the same sound comes back.
    remade = str(tmp_path / "remade.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp_path / "clip_00.mkv"), "-c:v", "copy", "-c:a", "aac", remade], check=True)
    rs.reapply_remix_sound(remade, saved, str(tmp_path), str(tmp_path / "work"))
    again = read_audio(remade)
    m = min(len(again), len(after))
    assert np.corrcoef(again[:m], after[:m])[0, 1] > 0.98


def test_remix_runner_checks_the_audio_options():
    import remix_runner
    assert remix_runner.parse_audio_options(None) is None
    raw = {"voice_cleanup": True, "music": {"track": "cinematic-swell"}, "music_during_clip": True}
    assert remix_runner.parse_audio_options(raw) == raw
    with pytest.raises(ValueError):
        remix_runner.parse_audio_options({"music": {"track": "nope"}})
