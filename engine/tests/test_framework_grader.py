"""Paid Creators framework grading: grade math, selection and pipeline wiring."""
import asyncio
import json
import os
from types import SimpleNamespace

import pytest

from clip_engine.services import ai_clipping_pipeline as pipeline_module
from clip_engine.services import framework_grader as grader_module
from clip_engine.services.ai_clipping_pipeline import AIClippingPipeline, ClippingJobRequest, JobStatus
from clip_engine.services.framework_grader import ClipGrade, FrameworkGrader, clip_excerpt, compute_grade, passes, select_by_grade
from clip_engine.services.intelligence_planner import ClipPlanResponse, ClipPlanSegment
from clip_engine.services.rendering_service import RenderingService, RenderResult
from clip_engine.services.transcription_service import TranscriptionResult, TranscriptSegment, TranscriptWord


def raw(scores, elements=("q", "m", "t"), hard_fails=()):
    names = ("qualifier", "main_statement", "twist")
    return {
        "hook_elements": {**{name: (f"quote {name}" if name[0] in "".join(e[0] for e in elements) else None) for name in names}, "stakes": None},
        "hook_type": "direct_response",
        "story_beats": {"hook": True, "background": True, "conflict": False, "resolution": True, "call_to_action": False},
        "scores": scores, "hard_fails": list(hard_fails), "verdict": "v", "fix": "f", "suggested_title": "Title",
    }


ALL_TENS = {key: 10 for key in grader_module.WEIGHTS}


def test_full_triple_hook_and_strong_scores_earn_an_a():
    grade = compute_grade(raw(ALL_TENS))
    assert grade.grade == "A" and grade.score == pytest.approx(10)
    assert grade.hook_elements["qualifier"] == "quote qualifier"


def test_triple_hook_score_is_capped_by_the_elements_actually_quoted():
    one = compute_grade(raw(ALL_TENS, elements=("m",)))
    assert one.scores["triple_hook"] == 4 and one.scores["twist"] == 4
    # "If your hook sucks, nothing else matters": a weak hook caps the grade at C.
    assert one.grade == "C"
    two = compute_grade(raw(ALL_TENS, elements=("q", "m")))
    assert two.scores["triple_hook"] == 7 and two.grade in ("B", "C")
    assert two.grade != "A"


def test_hard_fails_are_an_f_and_bad_values_are_clamped():
    assert compute_grade(raw(ALL_TENS, hard_fails=["payoff_cut_off", "payoff_cut_off", "made_up"])).grade == "F"
    weird = compute_grade(raw({**ALL_TENS, "payoff": 99, "specificity": "lots"}))
    assert weird.scores["payoff"] == 10 and weird.scores["specificity"] == 0
    assert compute_grade({}).grade == "F"


def test_quality_bar():
    assert passes("A", "a") and not passes("B", "a")
    assert passes("B", "b") and not passes("C", "b")
    assert passes("C", "c") and passes("F", "all")


def grade(letter, score):
    return ClipGrade(grade=letter, score=score, scores={}, hook_elements={}, hook_type="none", story_beats={})


def test_selection_keeps_the_best_graded_clips_up_to_the_target():
    segments = [ClipPlanSegment(i * 1000, i * 1000 + 500, 0.5, summary=f"c{i}") for i in range(6)]
    grades = {0: grade("C", 6), 1: grade("A", 9.1), 2: grade("B", 7.5), 3: grade("F", 2), 4: grade("B", 8.0), 5: grade("D", 4.5)}
    kept, dropped = select_by_grade(segments, grades, "b", target=2)
    assert [s.summary for s in kept] == ["c1", "c4"] and dropped == 4
    kept, _ = select_by_grade(segments, grades, "b", target=10)
    assert [s.summary for s in kept] == ["c1", "c4", "c2"]
    kept, _ = select_by_grade(segments, grades, "all", target=0, keep_all=True)
    assert [s.summary for s in kept] == ["c1", "c4", "c2", "c0", "c5", "c3"]


def test_selection_never_ends_empty_and_tolerates_missing_grades():
    segments = [ClipPlanSegment(0, 500, 0.5, summary="weak"), ClipPlanSegment(1000, 1500, 0.5, summary="worse")]
    grades = {0: grade("C", 6), 1: grade("D", 4)}
    kept, _ = select_by_grade(segments, grades, "a", target=3)
    assert [s.summary for s in kept] == ["weak"]
    assert "nothing met your quality bar" in grades[0].fix
    # Grading unavailable: the planner's selection is left exactly as it was.
    kept, dropped = select_by_grade(segments, {}, "b", target=1)
    assert [s.summary for s in kept] == ["weak", "worse"] and dropped == 0


def test_excerpt_uses_clip_relative_times():
    words = [TranscriptWord("You", 10_000, 10_200), TranscriptWord("won't", 10_200, 10_500), TranscriptWord("believe", 10_500, 11_000)]
    segments = [TranscriptSegment(9_000, 9_900, "before"), TranscriptSegment(10_000, 11_000, "You won't believe", words=words, speaker_label="S1")]
    assert clip_excerpt(segments, 10_000, 20_000) == "[0.0s] (S1) You won't believe"


def test_grader_parses_one_structured_call(monkeypatch):
    settings = SimpleNamespace(openrouter_api_key="k", openrouter_base_url="https://openrouter.ai/api/v1", planner_model="m",
                               get_planner_fallback_models=lambda: [], clipping_mode="quality", planner_reasoning_effort="medium")
    sent = {}

    async def fake_chat(client, payload):
        sent["payload"] = payload
        clips = json.loads(payload["messages"][1]["content"].split("\n\n", 1)[1])["clips"]
        sent["clips"] = clips
        body = {"choices": [{"message": {"content": json.dumps({"clips": [{"id": 1, **raw(ALL_TENS)}, {"id": 99, **raw(ALL_TENS)}]})}}]}
        return body, {"cost": 0.01}

    monkeypatch.setattr(grader_module, "chat_completion", fake_chat)
    segments = [ClipPlanSegment(0, 5000, .5, summary="Hook A"), ClipPlanSegment(6000, 9000, .5, summary="Hook B")]
    transcript = [TranscriptSegment(0, 9000, "words")]
    grader = FrameworkGrader(settings, client=object())
    grades = asyncio.run(grader.grade(transcript, segments))
    assert list(grades) == [1] and grades[1].grade == "A"  # unknown ids ignored, skipped ids not fabricated
    assert grader.cost_usd == 0.01
    assert sent["payload"]["response_format"]["json_schema"]["strict"] is True
    assert "Triple Hook" in sent["payload"]["messages"][0]["content"]
    assert [c["hook_title"] for c in sent["clips"]] == ["Hook A", "Hook B"]


def test_pipeline_oversamples_grades_and_keeps_the_strong_clips(monkeypatch, tmp_path):
    monkeypatch.setattr(RenderingService, "_verify_ffmpeg", lambda self: None)
    settings = pipeline_module.get_settings()
    monkeypatch.setattr(settings, "local_mode", True)
    monkeypatch.setattr(settings, "local_output_dir", str(tmp_path / "out"))
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")
    monkeypatch.setattr(settings.__class__, "temp_directory", property(lambda self: str(tmp_path / "work")))
    pipeline = AIClippingPipeline()
    pipeline.local_mode = True

    async def download(url, output_dir):
        source = os.path.join(output_dir, "source.mp4")
        open(source, "wb").write(b"source")
        return SimpleNamespace(video_path=source, metadata=SimpleNamespace(title="T", duration_seconds=600.0, width=1920, height=1080), file_size_bytes=1)

    async def transcribe(video_path, work_dir, keyterms=None, **_range):
        return TranscriptionResult(segments=[TranscriptSegment(0, 500, "hi", words=[TranscriptWord("hi", 0, 500)])], full_text="hi")

    planned = {}

    async def plan(**kwargs):
        planned.update(kwargs)
        pipeline.intelligence_planner.discovery_limit = 2
        return ClipPlanResponse(segments=[ClipPlanSegment(i * 60_000, i * 60_000 + 30_000, 0.9, summary=f"clip {i}") for i in range(4)], total_clips=4)

    class FakeGrader:
        def __init__(self, settings):
            self.cost_usd = 0.02

        async def grade(self, transcript, segments):
            letters = {0: ("C", 6.0), 1: ("A", 9.2), 2: ("B", 7.4), 3: ("F", 1.0)}
            return {i: compute_grade(raw(ALL_TENS)) if letters[i][0] == "A" else grade(*letters[i]) for i in range(4)}

        async def close(self):
            pass

    rendered = []

    async def render(request):
        rendered.append(request.title_text)
        open(request.output_path, "wb").write(b"mp4")
        return RenderResult(output_path=request.output_path, file_size_bytes=3, duration_ms=30_000, layout_type="talking_head")

    monkeypatch.setattr(pipeline_module, "FrameworkGrader", FakeGrader)
    monkeypatch.setattr(pipeline.video_downloader, "download_video", download)
    monkeypatch.setattr(pipeline.transcription_service, "transcribe", transcribe)
    monkeypatch.setattr(pipeline.intelligence_planner, "plan_clips", plan)
    monkeypatch.setattr(pipeline.rendering_service, "render_clip", render)
    monkeypatch.setattr(pipeline, "_update_progress", lambda *args, **kwargs: None)

    result = asyncio.run(pipeline.process_video(ClippingJobRequest(video_url="local.mp4", job_id="graded", max_clips=2)))
    assert result.status == JobStatus.COMPLETED, result.error
    assert planned["oversample"] == 1.75
    assert sorted(rendered) == ["clip 1", "clip 2"]
    clips = result.output.clips
    assert [c.framework["grade"] for c in clips] == ["A", "B"]
    assert result.output.metrics["api_costs"]["framework_grading"]["estimated_cost_usd"] == 0.02
    saved = json.loads((tmp_path / "out" / "graded" / "job_output.json").read_text())
    assert saved["clips"][0]["framework"]["grade"] == "A"
    assert result.output.metrics["requested_settings"]["quality_bar"] == "b"


def test_planner_oversample_requests_more_but_keeps_the_target(monkeypatch):
    from clip_engine.services.intelligence_planner import IntelligencePlannerService

    class Stop(Exception):
        pass

    planner = IntelligencePlannerService()
    seen = {}

    def capture(self, clip_count, *args, **kwargs):
        seen["clip_count"] = clip_count
        raise Stop()

    monkeypatch.setattr(IntelligencePlannerService, "_build_system_prompt", capture)
    transcript = TranscriptionResult(segments=[TranscriptSegment(i * 10_000, i * 10_000 + 9_000, "word " * 30) for i in range(120)], full_text="")
    meta = SimpleNamespace(duration_seconds=1200)
    with pytest.raises(Stop):
        asyncio.run(planner.plan_clips(transcript, meta, max_clips=4, auto_clip_count=False, oversample=1.75))
    assert seen["clip_count"] == 7 and planner.discovery_limit == 4
    with pytest.raises(Stop):
        asyncio.run(planner.plan_clips(transcript, meta, max_clips=4, auto_clip_count=False))
    assert seen["clip_count"] == 4
