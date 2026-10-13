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


def test_a_strong_natural_hook_does_not_need_a_full_triple_hook():
    # One strong line, everything else excellent: still an A. The Triple Hook is a small bonus.
    one = compute_grade(raw(ALL_TENS, elements=("m",)))
    assert one.scores["triple_hook"] == 4 and one.grade == "A"
    # A typical good conversational clip: no scripted hook elements, solid everywhere else -> B.
    typical = compute_grade(raw({"hook": 7.5, "payoff": 7, "standalone": 7, "story_arc": 6, "specificity": 6, "emotion_stance": 6, "triple_hook": 2}, elements=()))
    assert typical.grade == "B", typical.score


def test_a_weak_opening_still_caps_the_grade():
    weak = compute_grade(raw({**ALL_TENS, "hook": 3}))
    assert weak.grade == "C"


def test_too_few_passing_clips_are_topped_up_with_the_next_grade_down():
    segments = [ClipPlanSegment(i * 1000, i * 1000 + 500, 0.5, summary=f"c{i}") for i in range(6)]
    grades = {0: grade("C", 6), 1: grade("B", 7.1), 2: grade("C", 5.6), 3: grade("D", 4), 4: grade("F", 1), 5: grade("C", 5.2)}
    kept, _ = select_by_grade(segments, grades, "b", fill_to=3)
    assert [s.summary for s in kept] == ["c1", "c0", "c2"]
    assert "kept so the run reaches your clip count" in grades[0].fix and "kept so" not in grades[1].fix
    # Never tops up with D or F, and no top-up without a target.
    kept, _ = select_by_grade(segments, grades, "b", fill_to=6)
    assert [s.summary for s in kept] == ["c1", "c0", "c2", "c5"]
    kept, _ = select_by_grade(segments, grades, "b")
    assert [s.summary for s in kept] == ["c1"]


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
    # Grading unavailable: planner order, cut only when a target is given (review projects).
    kept, dropped = select_by_grade(segments, {}, "b", target=0)
    assert [s.summary for s in kept] == ["weak", "worse"] and dropped == 0
    kept, dropped = select_by_grade(segments, {}, "b", target=1)
    assert [s.summary for s in kept] == ["weak"] and dropped == 1


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
    transcript = [TranscriptSegment(0, 9000, "quote qualifier quote main_statement quote twist")]
    grader = FrameworkGrader(settings, client=object())
    grades = asyncio.run(grader.grade(transcript, segments))
    assert list(grades) == [1] and grades[1].grade == "A"  # unknown ids ignored, skipped ids not fabricated
    assert grader.cost_usd == 0.01
    assert sent["payload"]["response_format"]["json_schema"]["strict"] is True
    assert sent["payload"]["model"] == grader_module.GRADER_MODEL
    assert "Triple Hook" in sent["payload"]["messages"][0]["content"]
    assert [c["hook_title"] for c in sent["clips"]] == ["Hook A", "Hook B"]


def run_graded_pipeline(monkeypatch, tmp_path, grader_cls, quality_bar="b", max_clips=2, job_id="graded"):
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
        pipeline.intelligence_planner.discovery_limit = max_clips
        return ClipPlanResponse(segments=[ClipPlanSegment(i * 60_000, i * 60_000 + 30_000, 0.9, summary=f"clip {i}") for i in range(4)], total_clips=4)

    rendered = []

    async def render(request):
        rendered.append(request.title_text)
        open(request.output_path, "wb").write(b"mp4")
        return RenderResult(output_path=request.output_path, file_size_bytes=3, duration_ms=30_000, layout_type="talking_head")

    monkeypatch.setattr(pipeline_module, "FrameworkGrader", grader_cls)
    monkeypatch.setattr(pipeline.video_downloader, "download_video", download)
    monkeypatch.setattr(pipeline.transcription_service, "transcribe", transcribe)
    monkeypatch.setattr(pipeline.intelligence_planner, "plan_clips", plan)
    monkeypatch.setattr(pipeline.rendering_service, "render_clip", render)
    monkeypatch.setattr(pipeline, "_update_progress", lambda *args, **kwargs: None)
    result = asyncio.run(pipeline.process_video(ClippingJobRequest(video_url="local.mp4", job_id=job_id, max_clips=max_clips, quality_bar=quality_bar)))
    return result, planned, rendered


def fake_grader(letters):
    class FakeGrader:
        def __init__(self, settings):
            self.cost_usd = 0.02
            self.cost_incomplete = False

        async def grade(self, transcript, segments):
            return {i: compute_grade(raw(ALL_TENS)) if letters[i][0] == "A" else grade(*letters[i]) for i in range(len(segments)) if i in letters}

        async def close(self):
            pass
    return FakeGrader


def test_pipeline_oversamples_grades_and_keeps_the_strong_clips(monkeypatch, tmp_path):
    letters = {0: ("C", 6.0), 1: ("A", 9.2), 2: ("B", 7.4), 3: ("F", 1.0)}
    result, planned, rendered = run_graded_pipeline(monkeypatch, tmp_path, fake_grader(letters))
    assert result.status == JobStatus.COMPLETED, result.error
    assert planned["oversample"] == 1.75
    assert sorted(rendered) == ["clip 1", "clip 2"]
    clips = result.output.clips
    assert [c.framework["grade"] for c in clips] == ["A", "B"]
    assert result.output.metrics["api_costs"]["framework_grading"]["estimated_cost_usd"] == 0.02
    saved = json.loads((tmp_path / "out" / "graded" / "job_output.json").read_text())
    assert saved["clips"][0]["framework"]["grade"] == "A"
    settings = result.output.metrics["requested_settings"]
    assert settings["quality_bar"] == "b" and settings["framework_grading"] == {"enabled": True, "candidates": 4, "graded": 4, "kept": 2}


def test_when_grading_fails_the_planned_clips_render_as_before(monkeypatch, tmp_path):
    class BrokenGrader:
        def __init__(self, settings):
            self.cost_usd, self.cost_incomplete = 0.0, False

        async def grade(self, transcript, segments):
            raise AttributeError("model returned a list")

        async def close(self):
            pass
    result, _, rendered = run_graded_pipeline(monkeypatch, tmp_path, BrokenGrader, job_id="broken")
    assert result.status == JobStatus.COMPLETED, result.error
    assert rendered == ["clip 0", "clip 1"]
    assert all(c.framework is None for c in result.output.clips)


def test_when_nothing_meets_the_bar_the_best_clip_is_kept_and_says_why(monkeypatch, tmp_path):
    letters = {0: ("C", 6.0), 1: ("D", 4.2), 2: ("C", 6.4), 3: ("F", 1.0)}
    result, _, rendered = run_graded_pipeline(monkeypatch, tmp_path, fake_grader(letters), quality_bar="a", job_id="below")
    assert result.status == JobStatus.COMPLETED, result.error
    assert rendered == ["clip 2"]
    assert "nothing met your quality bar" in result.output.clips[0].framework["fix"]


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


def test_quotes_must_appear_in_the_clip_or_title():
    item = raw(ALL_TENS)
    source = "Hook title\n[0.0s] quote qualifier and quote main_statement but nothing else"
    graded = compute_grade(item, source)
    assert graded.hook_elements["twist"] is None and graded.scores["triple_hook"] == 7
    # Near-verbatim (punctuation, case, a small slip) still counts.
    assert grader_module._quoted_in("You're NOT gonna believe this, but", "you’re not gonna believe this but we made it")
    assert not grader_module._quoted_in("we made a million dollars", "we made a few sales")


def test_malformed_model_output_never_raises():
    for item in ([], "x", {"hook_elements": [], "scores": [], "story_beats": "y", "hard_fails": "z"}):
        assert compute_grade(item).grade == "F"


def test_long_clips_keep_their_ending():
    segments = [TranscriptSegment(i * 1000, i * 1000 + 900, f"line {i} " + "word " * 30) for i in range(400)]
    excerpt = clip_excerpt(segments, 0, 400_000)
    assert len(excerpt) < 9200 and "middle of the clip omitted" in excerpt
    assert "line 0 " in excerpt and "line 399 " in excerpt
