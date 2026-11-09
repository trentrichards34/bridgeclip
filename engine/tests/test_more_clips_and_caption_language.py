"""
More clips from a video (saved transcript reused, earlier moments skipped) and
caption language (captions translated per line, timing kept, SRT in that language).
"""

import asyncio
import json
import os
from types import SimpleNamespace

import pytest

from clip_engine.services import ai_clipping_pipeline as pipeline_module
from clip_engine.services import caption_translation
from clip_engine.services.ai_clipping_pipeline import AIClippingPipeline, ClippingJobRequest, JobStatus
from clip_engine.services.caption_translation import (
    CaptionTranslator, apply_translations, caption_tokens, retime_words, segment_key,
)
from clip_engine.services.clip_editor import TimeMap, remap_segments
from clip_engine.services.intelligence_planner import ClipPlanResponse, ClipPlanSegment, exclusion_rule, output_language_rule
from clip_engine.services.rendering_service import RenderingService, RenderRequest, RenderResult, join_srt
from clip_engine.services.transcription_service import TranscriptionResult, TranscriptSegment, TranscriptWord
from clip_engine.services.transcript_reuse import load_saved_transcript, reusable_transcript, source_fingerprint


@pytest.fixture(autouse=True)
def approved_candidates(monkeypatch):
    from unittest.mock import AsyncMock
    monkeypatch.setattr(pipeline_module.CoherenceReviewer, 'prepare', AsyncMock(return_value=True))


def line(start, words):
    """A transcript line whose words are 400 ms apart."""
    timed = [TranscriptWord(word, start + i * 400, start + i * 400 + 350) for i, word in enumerate(words)]
    return TranscriptSegment(start, timed[-1].end_time_ms, " ".join(words), words=timed)


# --- translation re-timing -------------------------------------------------

def test_retime_spreads_words_over_the_span_by_length():
    words = retime_words(["a", "bbb", "cccccc"], 1000, 2000)
    assert [w.word for w in words] == ["a", "bbb", "cccccc"]
    assert words[0].start_time_ms == 1000 and words[-1].end_time_ms == 2000
    # Contiguous, in order, longer words get more time.
    assert all(a.end_time_ms == b.start_time_ms for a, b in zip(words, words[1:]))
    durations = [w.end_time_ms - w.start_time_ms for w in words]
    assert durations[0] < durations[1] < durations[2]


def test_retime_gives_every_word_time_even_in_a_tiny_span():
    words = retime_words(["x"] * 5, 0, 2)
    assert len(words) == 5
    assert all(w.end_time_ms > w.start_time_ms for w in words)


def test_unspaced_languages_split_into_short_runs():
    tokens = caption_tokens("今日はとても良い天気ですね。", "ja")
    assert "".join(tokens) == "今日はとても良い天気ですね。"
    assert all(1 <= len(token) <= 5 for token in tokens)
    assert caption_tokens("Hola  a todos", "es") == ["Hola", "a", "todos"]


def test_translated_lines_keep_their_line_timing_after_cuts():
    first = line(0, ["so", "um", "this", "is", "big"])
    second = line(5000, ["you", "need", "it"])
    translations = {segment_key(first): "esto es enorme", segment_key(second): "lo necesitas"}
    # Cut 400-760 ms (the filler "um") from a 10 s window.
    time_map = TimeMap([(0, 400), (760, 10_000)], 10_000)
    lines = apply_translations([first, second], lambda segs: remap_segments(segs, 0, time_map), translations, "es")
    assert [l.text for l in lines] == ["esto es enorme", "lo necesitas"]
    original = remap_segments([first, second], 0, time_map)
    for translated, kept in zip(lines, original):
        # Each translated line covers exactly what is left of its original line.
        assert translated.start_time_ms == kept.start_time_ms
        assert translated.end_time_ms == kept.end_time_ms
        assert [w.start_time_ms for w in translated.words] == sorted(w.start_time_ms for w in translated.words)


def test_lines_without_a_translation_keep_their_words():
    first = line(0, ["hello", "there"])
    lines = apply_translations([first], lambda segs: [s for s in segs], {}, "fr")
    assert lines[0].text == "hello there"


def fake_chat(reply, calls):
    async def chat(client, payload):
        calls.append(payload)
        return {"choices": [{"message": {"content": json.dumps(reply)}}]}, {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.0012}
    return chat


def test_translator_makes_one_call_per_clip_and_records_the_cost(monkeypatch):
    calls = []
    monkeypatch.setattr(caption_translation, "chat_completion", fake_chat({"lines": [{"id": 0, "text": "Bonjour"}, {"id": 1, "text": "le monde"}]}, calls))
    settings = SimpleNamespace(planner_model="test/planner", openrouter_api_key="k", openrouter_base_url="https://openrouter.ai/api/v1")
    translator = CaptionTranslator(settings, client=object())
    segments = [line(0, ["hello"]), line(1000, ["world"])]
    result = asyncio.run(translator.translate(segments, "fr"))
    assert result == {segment_key(segments[0]): "Bonjour", segment_key(segments[1]): "le monde"}
    assert len(calls) == 1 and calls[0]["model"] == "test/planner"
    assert "French" in calls[0]["messages"][0]["content"]
    assert translator.usage.as_api_costs("test/planner")["estimated_cost_usd"] == 0.0012


def test_translator_failure_keeps_original_captions(monkeypatch):
    async def broken(client, payload):
        raise caption_translation.OpenRouterError("down")
    monkeypatch.setattr(caption_translation, "chat_completion", broken)
    settings = SimpleNamespace(planner_model="m/m", openrouter_api_key="k", openrouter_base_url="https://x")
    translator = CaptionTranslator(settings, client=object())
    assert asyncio.run(translator.translate([line(0, ["hi"])], "de")) == {}
    assert translator.usage.failures == 1


def test_srt_sidecar_uses_the_caption_language(tmp_path):
    service = RenderingService.__new__(RenderingService)
    from clip_engine.services.caption_generator import CaptionGeneratorService
    service.caption_generator = CaptionGeneratorService()
    first = line(0, ["hello", "everyone", "today"])
    request = RenderRequest(video_path="in.mp4", output_path=str(tmp_path / "clip_00.mp4"), start_time_ms=0, end_time_ms=3000,
                            source_width=1920, source_height=1080, transcript_segments=[first], write_subtitles=True,
                            caption_translations={segment_key(first): "hola a todos hoy"}, caption_language="es")
    path = asyncio.run(service._write_subtitles(request, 0, TimeMap([(0, 3000)], 3000)))
    text = open(path, encoding="utf-8").read()
    assert path.endswith("clip_00.srt")
    assert "hola a todos hoy" in text and "hello" not in text
    assert "00:00:00,000 -->" in text


def test_short_clips_write_no_srt_unless_asked(tmp_path):
    service = RenderingService.__new__(RenderingService)
    from clip_engine.services.caption_generator import CaptionGeneratorService
    service.caption_generator = CaptionGeneratorService()
    request = RenderRequest(video_path="in.mp4", output_path=str(tmp_path / "c.mp4"), start_time_ms=0, end_time_ms=3000,
                            source_width=1920, source_height=1080, transcript_segments=[line(0, ["hi", "there"])])
    assert asyncio.run(service._write_subtitles(request, 0, TimeMap([(0, 3000)], 3000))) is None


def test_hook_preview_moves_the_clip_captions_after_the_teaser(tmp_path):
    teaser, clip = tmp_path / "t.srt", tmp_path / "c.srt"
    teaser.write_text("1\n00:00:00,000 --> 00:00:02,000\nthe number\n", encoding="utf-8")
    clip.write_text("1\n00:00:00,500 --> 00:00:01,500\nfirst line\n\n2\n00:00:03,000 --> 00:00:04,000\nsecond\n", encoding="utf-8")
    join_srt(str(teaser), 2500, str(clip))
    text = clip.read_text(encoding="utf-8")
    assert text.index("the number") < text.index("first line")
    assert "00:00:03,000 --> 00:00:04,000\nfirst line" in text
    assert "00:00:05,500 --> 00:00:06,500\nsecond" in text


# --- planner prompt rules -------------------------------------------------

def test_planner_rules_name_the_earlier_moments_and_the_language():
    rule = exclusion_rule([[60_000, 90_000], [0, 30_000], "bad", [5, 1]])
    assert "0.0-30.0" in rule and "60.0-90.0" in rule and "ALREADY CLIPPED" in rule
    assert exclusion_rule([]) == ""
    assert "Spanish" in output_language_rule("Spanish") and output_language_rule(None) == ""


# --- saved transcript reuse ------------------------------------------------

def save_transcript(path, video_path, duration=300.0):
    data = {
        "segments": [{"start_time_ms": 0, "end_time_ms": 500, "text": "hi", "speaker_label": None,
                      "words": [{"word": "hi", "start_time_ms": 0, "end_time_ms": 500}], "audio_events": []}],
        "full_text": "hi", "language": "en", "status": "available", "captions_available": True,
        "source_duration_seconds": duration, "source_fingerprint": source_fingerprint(video_path),
    }
    path.write_text(json.dumps(data), encoding="utf-8")


def test_saved_transcript_is_used_only_for_the_same_video(tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"a" * 5000)
    saved_path = tmp_path / "transcript.json"
    save_transcript(saved_path, str(video))
    saved = load_saved_transcript(str(saved_path))
    assert saved["result"].segments[0].words[0].word == "hi"
    assert reusable_transcript(saved, str(video), 300.4) is saved
    assert reusable_transcript(saved, str(video), 320.0) is None  # another length
    other = tmp_path / "other.mp4"
    other.write_bytes(b"b" * 5000)
    assert reusable_transcript(saved, str(other), 300.0) is None  # other bytes
    # A link downloaded again can differ in bytes; its length still has to match.
    assert reusable_transcript(saved, str(other), 300.0, compare_bytes=False) is saved
    (tmp_path / "broken.json").write_text("{", encoding="utf-8")
    assert load_saved_transcript(str(tmp_path / "broken.json")) is None


def run_pipeline(monkeypatch, tmp_path, request, transcribe, plan, render=None, chat=None):
    monkeypatch.setattr(RenderingService, "_verify_ffmpeg", lambda self: None)
    settings = pipeline_module.get_settings()
    monkeypatch.setattr(settings, "local_mode", True)
    monkeypatch.setattr(settings, "local_output_dir", str(tmp_path / "out"))
    monkeypatch.setattr(settings.__class__, "temp_directory", property(lambda self: str(tmp_path / "work")))
    pipeline = AIClippingPipeline()
    pipeline.local_mode = True
    source = tmp_path / "source.mp4"

    async def download(url, output_dir):
        assert url == str(source)
        meta = SimpleNamespace(title="Test", duration_seconds=300.0, width=1920, height=1080)
        return SimpleNamespace(video_path=str(source), metadata=meta, file_size_bytes=1)

    renders = []

    async def default_render(render_request: RenderRequest):
        renders.append(render_request)
        open(render_request.output_path, "wb").write(b"mp4")
        srt = os.path.splitext(render_request.output_path)[0] + ".srt"
        with open(srt, "w", encoding="utf-8") as f:
            f.write("1\n00:00:00,000 --> 00:00:01,000\nhi\n")
        return RenderResult(output_path=render_request.output_path, file_size_bytes=3, duration_ms=20_000, subtitle_path=srt)

    monkeypatch.setattr(pipeline.video_downloader, "download_video", download)
    monkeypatch.setattr(pipeline.transcription_service, "transcribe", transcribe)
    monkeypatch.setattr(pipeline.intelligence_planner, "plan_clips", plan)
    monkeypatch.setattr(pipeline.rendering_service, "render_clip", render or default_render)
    if chat:
        monkeypatch.setattr(caption_translation, "chat_completion", chat)
    monkeypatch.setattr(pipeline, "_update_progress", lambda *args, **kwargs: None)
    return asyncio.run(pipeline.process_video(request)), renders


def test_more_clips_reuses_the_transcript_and_skips_earlier_moments(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video" * 1000)
    saved = tmp_path / "earlier" / "transcript.json"
    saved.parent.mkdir()
    save_transcript(saved, str(source))

    async def transcribe(*args, **kwargs):
        raise AssertionError("transcription must not run again")

    seen = {}

    async def plan(**kwargs):
        seen.update(kwargs)
        # One repeats an earlier clip (0-30 s); the other two are new.
        segments = [ClipPlanSegment(2_000, 28_000, 0.9), ClipPlanSegment(60_000, 85_000, 0.8), ClipPlanSegment(120_000, 150_000, 0.7)]
        return ClipPlanResponse(segments=segments, total_clips=3)

    request = ClippingJobRequest(video_url=str(source), job_id="job2", quality_bar="off",
                                 reuse_transcript_path=str(saved), reuse_expected_duration_seconds=300.0,
                                 exclude_ranges_ms=[[0, 30_000]])
    result, renders = run_pipeline(monkeypatch, tmp_path, request, transcribe, plan)
    assert result.status == JobStatus.COMPLETED, result.error
    assert seen["exclude_ranges_ms"] == [[0, 30_000]]
    assert seen["transcript_result"].segments[0].text == "hi"
    assert [(r.start_time_ms, r.end_time_ms) for r in renders] == [(60_000, 85_000), (120_000, 150_000)]
    assert result.output.metrics["transcript_reused"] is True
    assert result.output.metrics["excluded_moment_count"] == 1
    assert "transcription" not in result.output.metrics["api_costs"]
    # The new run's transcript can itself be reused later.
    copied = json.loads((tmp_path / "out" / "job2" / "transcript.json").read_text())
    assert copied["source_fingerprint"] == source_fingerprint(str(source))


def test_more_clips_with_only_repeats_says_so(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    saved = tmp_path / "transcript.json"
    save_transcript(saved, str(source))

    async def transcribe(*args, **kwargs):
        raise AssertionError("transcription must not run again")

    async def plan(**kwargs):
        return ClipPlanResponse(segments=[ClipPlanSegment(1_000, 29_000, 0.9)], total_clips=1)

    request = ClippingJobRequest(video_url=str(source), job_id="job3", quality_bar="off", reuse_transcript_path=str(saved),
                                 exclude_ranges_ms=[[0, 30_000]])
    result, _ = run_pipeline(monkeypatch, tmp_path, request, transcribe, plan)
    assert result.status == JobStatus.FAILED
    assert result.error == "No new moments were left to clip"


def test_a_different_video_is_transcribed_again(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    saved = tmp_path / "transcript.json"
    save_transcript(saved, str(source), duration=999.0)
    calls = []

    async def transcribe(video_path, work_dir, keyterms=None, **_range):
        calls.append(video_path)
        return TranscriptionResult(segments=[TranscriptSegment(0, 500, "fresh", words=[TranscriptWord("fresh", 0, 500)])], full_text="fresh")

    async def plan(**kwargs):
        return ClipPlanResponse(segments=[ClipPlanSegment(60_000, 85_000, 0.8)], total_clips=1)

    request = ClippingJobRequest(video_url=str(source), job_id="job4", quality_bar="off", reuse_transcript_path=str(saved))
    result, _ = run_pipeline(monkeypatch, tmp_path, request, transcribe, plan)
    assert result.status == JobStatus.COMPLETED, result.error
    assert calls == [str(source)]
    assert result.output.metrics["transcript_reused"] is False


def test_caption_language_translates_each_clip_and_records_the_srt(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")

    async def transcribe(video_path, work_dir, keyterms=None, **_range):
        segments = [line(60_000, ["this", "is", "big"]), line(120_000, ["second", "clip"])]
        return TranscriptionResult(segments=segments, full_text="this is big second clip", language="en")

    planned = {}

    async def plan(**kwargs):
        planned.update(kwargs)
        return ClipPlanResponse(segments=[ClipPlanSegment(59_000, 85_000, 0.8), ClipPlanSegment(119_000, 150_000, 0.7)], total_clips=2)

    calls = []

    async def chat(client, payload):
        calls.append(payload)
        lines = json.loads(payload["messages"][1]["content"])["lines"]
        reply = {"lines": [{"id": item["id"], "text": "es: " + item["text"]} for item in lines]}
        return {"choices": [{"message": {"content": json.dumps(reply)}}]}, {"prompt_tokens": 5, "completion_tokens": 5, "cost": 0.001}

    settings = pipeline_module.get_settings()
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")
    request = ClippingJobRequest(video_url=str(source), job_id="job5", quality_bar="off", caption_language="es")
    result, renders = run_pipeline(monkeypatch, tmp_path, request, transcribe, plan, chat=chat)
    assert result.status == JobStatus.COMPLETED, result.error
    assert planned["output_language"] == "Spanish"
    assert len(calls) == 2  # one translation call per clip
    for render in renders:
        assert render.write_subtitles is True and render.caption_language == "es"
        assert all(text.startswith("es: ") for text in render.caption_translations.values())
    costs = result.output.metrics["api_costs"]
    assert costs["caption_translation"]["attempts"] == 2
    assert costs["caption_translation"]["estimated_cost_usd"] == pytest.approx(0.002)
    assert result.output.metrics["requested_settings"]["caption_language"] == "es"
    for clip in result.output.clips:
        assert clip.caption_language == "es"
        assert clip.captions_srt == str(tmp_path / "out" / "job5" / f"clip_{clip.clip_index:02d}.srt")
        assert os.path.isfile(clip.captions_srt)


def test_original_language_makes_no_translation_calls(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")

    async def transcribe(video_path, work_dir, keyterms=None, **_range):
        return TranscriptionResult(segments=[line(60_000, ["hi", "there"])], full_text="hi there")

    async def plan(**kwargs):
        assert "output_language" not in kwargs
        return ClipPlanResponse(segments=[ClipPlanSegment(59_000, 85_000, 0.8)], total_clips=1)

    async def chat(client, payload):
        raise AssertionError("no translation for original captions")

    request = ClippingJobRequest(video_url=str(source), job_id="job6", quality_bar="off", caption_language="xx")
    assert request.caption_language is None  # unknown codes mean original
    result, renders = run_pipeline(monkeypatch, tmp_path, request, transcribe, plan, chat=chat)
    assert result.status == JobStatus.COMPLETED, result.error
    assert renders[0].caption_translations == {}
    assert "caption_translation" not in result.output.metrics["api_costs"]
    assert result.output.clips[0].caption_language is None


def test_saved_transcript_must_cover_the_new_runs_part_of_the_video(tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"a" * 5000)
    saved_path = tmp_path / "transcript.json"
    save_transcript(saved_path, str(video))
    data = json.loads(saved_path.read_text())

    def saved_with(**fields):
        saved_path.write_text(json.dumps({**data, **fields}), encoding="utf-8")
        return load_saved_transcript(str(saved_path))

    whole = (None, None)
    # Recorded: the whole video covers any part; part of it covers only what lies inside.
    assert reusable_transcript(saved_with(transcribed_range=None), str(video), 300.0, window=(30, 60)) is not None
    partial = saved_with(transcribed_range=[30, 120])
    assert reusable_transcript(partial, str(video), 300.0, window=(30, 120)) is partial
    assert reusable_transcript(partial, str(video), 300.0, window=(40, 100)) is partial
    assert reusable_transcript(partial, str(video), 300.0, window=whole) is None
    assert reusable_transcript(partial, str(video), 300.0, window=(0, 120)) is None
    assert reusable_transcript(partial, str(video), 300.0, window=(30, None)) is None
    open_end = saved_with(transcribed_range=[None, None])
    assert reusable_transcript(open_end, str(video), 300.0, window=whole) is open_end
    # An end past the video counts as its end.
    assert reusable_transcript(saved_with(transcribed_range=[0, 300.0]), str(video), 300.0, window=whole) is not None
    # Older transcripts don't record a range: reused unless the earlier run looked at only part of the video.
    saved_path.write_text(json.dumps(data), encoding="utf-8")
    older = load_saved_transcript(str(saved_path))
    assert older["range_known"] is False
    assert reusable_transcript(older, str(video), 300.0, window=whole) is older
    assert reusable_transcript(older, str(video), 300.0, window=whole, earlier_partial=True) is None
    # An unreadable range is treated as unknown.
    assert saved_with(transcribed_range=["a", 3])["range_known"] is False


def test_more_clips_transcribes_again_when_the_earlier_run_covered_less(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    saved = tmp_path / "transcript.json"
    save_transcript(saved, str(source))
    data = json.loads(saved.read_text())
    saved.write_text(json.dumps({**data, "transcribed_range": [0, 60]}), encoding="utf-8")
    calls = []

    async def transcribe(video_path, work_dir, keyterms=None, **_range):
        calls.append(_range)
        return TranscriptionResult(segments=[line(60_000, ["fresh", "words"])], full_text="fresh words", language="es")

    async def plan(**kwargs):
        return ClipPlanResponse(segments=[ClipPlanSegment(59_000, 85_000, 0.8)], total_clips=1)

    request = ClippingJobRequest(video_url=str(source), job_id="job7", quality_bar="off", reuse_transcript_path=str(saved))
    result, _ = run_pipeline(monkeypatch, tmp_path, request, transcribe, plan)
    assert result.status == JobStatus.COMPLETED, result.error
    assert len(calls) == 1
    assert result.output.metrics["transcript_reused"] is False
    assert result.output.metrics["requested_settings"]["more_clips"] is True
    # The spoken language is recorded on each clip, for YouTube captions.
    assert result.output.clips[0].spoken_language == "es"
    assert result.output.clips[0].caption_language is None


def test_spoken_language_is_a_two_letter_code_or_nothing():
    assert pipeline_module.spoken_language_code("en") == "en"
    assert pipeline_module.spoken_language_code(" EN-us ") == "en"
    for value in (None, "english", "e", "123", "", 7):
        assert pipeline_module.spoken_language_code(value) is None
