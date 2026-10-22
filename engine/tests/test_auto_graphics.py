"""Motion graphics: Auto on Create's Automatic clips: the planner's card moments (in the same planner call),
checked against what was actually said (made-up numbers and words are dropped), fitted to the finished cut
(time mapping through cuts and speed, never in the first second, never overlapping, at most three),
recorded for main and for the editor, and laid over the finished clips by the overlay worker."""

import asyncio
import json
import os
import shutil
import subprocess
from types import SimpleNamespace

import pytest

from clip_engine.services import ai_clipping_pipeline as pipeline_module
from clip_engine.services.ai_clipping_pipeline import ClippingJobRequest, JobStatus
from clip_engine.services.auto_graphics import (
    GRAPHICS_PLAN, MOTION_GRAPHICS_RULE, fit_to_clip, output_ms, parse_planned, source_ms, window, words_said,
)
from clip_engine.services.intelligence_planner import ClipPlanResponse, ClipPlanSegment, clip_plan_schema
from clip_engine.services.rendering_service import RenderRequest, RenderResult
from clip_engine.services.transcription_service import TranscriptionResult, TranscriptSegment, TranscriptWord

from .test_more_clips_and_caption_language import run_pipeline
from .test_plan_boundaries import make_planner

needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs FFmpeg")


@pytest.fixture(autouse=True)
def approved_candidates(monkeypatch):
    from unittest.mock import AsyncMock
    monkeypatch.setattr(pipeline_module.CoherenceReviewer, 'prepare', AsyncMock(return_value=True))


def line(start, text, step=400):
    words = text.split()
    timed = [TranscriptWord(word, start + i * step, start + i * step + step - 50) for i, word in enumerate(words)]
    return TranscriptSegment(start, timed[-1].end_time_ms, text, words=timed)


# What is said: a number at 12 s, a list at 20 s, a tool at 30 s.
SAID = [
    line(10_000, "Here is the thing."),
    line(12_000, "We made fifteen thousand dollars in one month from short clips."),
    line(20_000, "Three steps: find the hook, cut the pauses, post every day."),
    line(30_000, "I edit everything in CapCut, the free editor."),
]


def stat(at, value, label="in one month", **extra):
    return {"template": "stat", "at_ms": at, "duration_ms": 3500, "placement": "top", "fields": {"value": value, "label": label}, **extra}


# --- what the planner returns ----------------------------------------------

def test_planned_moments_are_shape_checked_inside_the_clip():
    raw = [
        {"template": "stat", "time": 12.4, "seconds": 3, "placement": "top", "value": "$15,000", "label": "in one month",
         "text": "", "title": "", "items": [], "before": "", "after": "", "author": "", "name": "", "role": ""},
        {"template": "list", "time": 20.0, "seconds": 9, "placement": "sideways", "title": "Three steps",
         "items": ["1. find the hook", "- cut the pauses", "post every day", "", "  "]},
        {"template": "logo", "time": 21, "seconds": 3},  # never automatic
        {"template": "highlight", "time": 21, "seconds": 3},
        {"template": "stat", "time": 99.0, "seconds": 3, "value": "5"},  # outside the clip
        {"template": "stat", "time": 13.0, "seconds": 3, "value": "lots", "label": "of money"},  # a stat needs its number
        {"template": "list", "time": 22, "seconds": 3, "items": ["only one"]},  # a list needs two points
        "nonsense", {"template": "quote", "time": "soon", "text": "x"},
    ]
    kept = parse_planned(raw, 10_000, 40_000)
    assert [g["template"] for g in kept] == ["stat", "list"]
    assert kept[0] == {"template": "stat", "at_ms": 12_400, "duration_ms": 3000, "placement": "top",
                       "fields": {"value": "$15,000", "label": "in one month"}}
    # Numbering is the template's job; length is kept to 1.5-7 s; an unknown placement falls back.
    assert kept[1]["fields"] == {"title": "Three steps", "items": "find the hook\ncut the pauses\npost every day"}
    assert kept[1]["duration_ms"] == 7000 and kept[1]["placement"] == "top"
    assert parse_planned(None, 0, 1000) == [] and parse_planned({"x": 1}, 0, 1000) == []


def test_planner_asks_for_graphics_in_the_same_call_only_when_on():
    plain = clip_plan_schema(False)
    assert "graphics" not in plain["properties"]["clips"]["items"]["properties"]
    schema = clip_plan_schema(False, True)
    item = schema["properties"]["clips"]["items"]
    assert "graphics" in item["required"] and item["properties"]["graphics"]["items"]["properties"]["template"]["enum"] == [
        "stat", "title", "list", "checklist", "before_after", "quote", "lower_third",
        "statement", "sticky_notes", "strike_list", "headline_pill", "icon_pop", "comment_cta", "orbit", "feature_tile",
        "staircase", "funnel", "journey", "growth", "idea_hub", "compare_marks"]
    # Strict output: every field is required, none extra (OpenRouter structured outputs).
    graphic = item["properties"]["graphics"]["items"]
    assert set(graphic["required"]) == set(graphic["properties"]) and graphic["additionalProperties"] is False
    # The longform schema still gets its own fields too.
    longform = clip_plan_schema(True, True)["properties"]["clips"]["items"]
    assert {"graphics", "skip", "chapters"} <= set(longform["required"])
    assert "Use ONLY words said" in MOTION_GRAPHICS_RULE and "never add a number" in MOTION_GRAPHICS_RULE


def test_planner_parses_graphics_from_its_response(monkeypatch):
    planner = make_planner(SAID)
    planner._motion_graphics = True
    planner._current_longform = False
    clips = [{"start_time": 10.0, "end_time": 34.0, "summary": "Clips money", "headline": "h", "tags": [], "emphasis": [],
              "scores": {k: 5 for k in ("hook", "standalone", "arc", "quotability", "ending")},
              "graphics": [{"template": "stat", "time": 12.4, "seconds": 3, "placement": "top", "value": "$15,000", "label": "in one month",
                            "text": "", "title": "", "items": [], "before": "", "after": "", "author": "", "name": "", "role": ""}]}]
    response = {"choices": [{"message": {"content": json.dumps({"insights": "x", "clips": clips})}, "finish_reason": "stop"}]}
    segments = planner._parse_clip_plan_response(response).segments
    assert segments and segments[0].graphics and segments[0].graphics[0]["fields"]["value"] == "$15,000"
    planner._motion_graphics = False
    assert planner._parse_clip_plan_response(response).segments[0].graphics == []


# --- nothing made up -------------------------------------------------------

def test_a_number_on_a_card_must_be_said_within_three_seconds():
    assert words_said(stat(12_300, "$15,000"), SAID)  # "fifteen thousand dollars", said as words
    assert words_said(stat(12_300, "15k"), SAID)
    # A number that wasn't said: dropped.
    assert not words_said(stat(12_300, "$50,000"), SAID)
    assert not words_said(stat(12_300, "$15,000", label="in 2 months"), SAID)
    # Said, but far from the card (the card is 15 s later).
    assert not words_said(stat(27_000, "$15,000", label="clips"), SAID)


def test_most_words_on_a_card_must_be_said_near_it():
    tool = {"template": "lower_third", "at_ms": 30_200, "duration_ms": 3000, "placement": "bottom", "fields": {"name": "CapCut", "role": "the free editor"}}
    assert words_said(tool, SAID)
    made_up = {**tool, "fields": {"name": "CapCut", "role": "the best paid video software"}}
    assert not words_said(made_up, SAID)
    steps = {"template": "list", "at_ms": 20_000, "duration_ms": 5000, "placement": "top",
             "fields": {"title": "Three steps", "items": "Find the hook\nCut the pauses\nPost every day"}}
    assert words_said(steps, SAID)


# --- fitted to the finished cut -------------------------------------------

def test_time_mapping_matches_the_editor():
    ranges, speed = [(10_000, 14_000), (20_000, 26_000)], 1.25
    assert output_ms(ranges, speed, 12_000) == 1600
    assert output_ms(ranges, speed, 21_000) == 4000  # (4000 + 1000) / 1.25
    assert output_ms(ranges, speed, 16_000) is None  # cut out
    assert source_ms(ranges, speed, 4000) == 21_000
    # Across the cut, the cut-out part is dropped (like graphicWindow in motion-graphics.ts).
    assert window(ranges, speed, 13_000, 9000) == (2400, 2400)
    assert window(ranges, speed, 15_000, 2000) is None


def test_fit_keeps_three_said_cards_out_of_the_first_second_without_overlap():
    planned = [
        stat(12_000, "$15,000"),  # in the first second of the clip: moved to 1 s
        {"template": "title", "at_ms": 13_000, "duration_ms": 2500, "placement": "middle", "fields": {"text": "short clips"}},  # overlaps the stat: the stat wins
        {"template": "list", "at_ms": 20_000, "duration_ms": 5000, "placement": "top",
         "fields": {"title": "Three steps", "items": "Find the hook\nCut the pauses\nPost every day"}},
        {"template": "lower_third", "at_ms": 30_200, "duration_ms": 3000, "placement": "bottom", "fields": {"name": "CapCut", "role": "the free editor"}},
        stat(31_000, "$90,000"),  # made up: dropped
        {"template": "quote", "at_ms": 33_500, "duration_ms": 3000, "placement": "middle", "fields": {"text": "the free editor"}},  # a fourth: dropped
    ]
    kept = fit_to_clip(planned, SAID, [(11_500, 40_000)], 1.0)
    assert [g["template"] for g in kept] == ["stat", "list", "lower_third"]
    assert kept[0]["at_ms"] == 12_500 and kept[0]["duration_ms"] == 3000  # ends when it would have
    assert all(g["origin"] == "auto" and g["id"].startswith("g-") for g in kept)
    assert len({g["id"] for g in kept}) == 3
    for a, b in zip(kept, kept[1:]):
        assert a["at_ms"] + a["duration_ms"] <= b["at_ms"]


def test_fit_follows_cuts_and_speed():
    # The stat's words were cut out of the clip (pacing): it starts where the clip picks up again.
    kept = fit_to_clip([stat(12_300, "$15,000")], SAID, [(5_000, 12_000), (12_800, 20_000)], 1.0)
    assert [g["at_ms"] for g in kept] == [12_800]
    # Too far from the cut back in: dropped.
    assert fit_to_clip([stat(12_300, "$15,000")], SAID, [(5_000, 12_000), (16_000, 20_000)], 1.0) == []
    # Sped up: the first second is output time (1 s of output = 2 s of source at 2x).
    kept = fit_to_clip([stat(12_300, "$15,000")], SAID, [(11_000, 30_000)], 2.0)
    assert kept and kept[0]["at_ms"] == 13_000
    # Running past the clip's end: trimmed to it, or dropped when too short.
    kept = fit_to_clip([stat(12_300, "$15,000")], SAID, [(9_000, 14_000)], 1.0)
    assert kept[0]["at_ms"] + kept[0]["duration_ms"] == 14_000
    assert fit_to_clip([stat(12_300, "$15,000")], SAID, [(9_000, 12_800)], 1.0) == []


# --- the pipeline ----------------------------------------------------------

def test_pipeline_plans_checks_and_records_graphics_for_main_and_the_editor(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video" * 100)
    seen = {}

    async def transcribe(*args, **kwargs):
        return TranscriptionResult(segments=SAID, full_text=" ".join(s.text for s in SAID))

    async def plan(**kwargs):
        seen.update(kwargs)
        segment = ClipPlanSegment(10_000, 40_000, 0.9, summary="Fifteen thousand a month", headline="He made $15,000 in one month from clips")
        segment.graphics = [stat(12_300, "$15,000"), stat(25_000, "$80,000", label="a month")]  # the second was never said
        return ClipPlanResponse(segments=[segment], total_clips=1)

    async def render(request: RenderRequest):
        open(request.output_path, "wb").write(b"mp4")
        return RenderResult(output_path=request.output_path, file_size_bytes=3, duration_ms=29_000,
                            kept_source_ms=[[10_000, 24_000], [25_000, 40_000]], window_start_ms=10_000)

    request = ClippingJobRequest(video_url=str(source), job_id="graphics", quality_bar="off", motion_graphics=True,
                                 aspect_ratio="9:16", title_style="headline", include_captions=True)
    result, _ = run_pipeline(monkeypatch, tmp_path, request, transcribe, plan, render=render)
    assert result.status == JobStatus.COMPLETED, result.error
    assert seen["motion_graphics"] is True
    entry = result.output.metrics["clip_layouts"][0]
    assert [(g["template"], g["fields"]["value"], g["origin"]) for g in entry["graphics"]] == [("stat", "$15,000", "auto")]
    assert entry["teaser_ms"] == 0
    assert result.output.metrics["requested_settings"]["motion_graphics"] is True
    run = tmp_path / "out" / "graphics"
    plan_file = json.loads((run / GRAPHICS_PLAN).read_text())
    (candidate,) = plan_file["project"]["candidates"]
    assert candidate["library_clip"] == 0 and candidate["ranges"] == [[10_000, 24_000], [25_000, 40_000]]
    assert candidate["graphics"] == entry["graphics"]
    assert candidate["hook"]["text"] == "He made $15,000 in one month from clips"
    assert plan_file["clips"][candidate["id"]] == {"offset_ms": 0, "top": 0}


def test_pipeline_without_graphics_asks_for_none_and_writes_no_plan(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video" * 100)
    seen = {}

    async def transcribe(*args, **kwargs):
        return TranscriptionResult(segments=SAID, full_text="x")

    async def plan(**kwargs):
        seen.update(kwargs)
        return ClipPlanResponse(segments=[ClipPlanSegment(10_000, 40_000, 0.9, summary="Money")], total_clips=1)

    result, _ = run_pipeline(monkeypatch, tmp_path, ClippingJobRequest(video_url=str(source), job_id="plain", quality_bar="off"), transcribe, plan)
    assert result.status == JobStatus.COMPLETED, result.error
    assert "motion_graphics" not in seen
    assert "graphics" not in result.output.metrics["clip_layouts"][0]
    assert not (tmp_path / "out" / "plain" / GRAPHICS_PLAN).exists()


def test_editor_conversion_shows_the_drawn_graphics(tmp_path):
    from clip_engine.services.automatic_editor import build_candidates, parse_settings
    run = tmp_path
    (run / "clip_00.mp4").write_bytes(b"x")
    good = {"id": "g-0123456789", "template": "stat", "at_ms": 12_300, "duration_ms": 3500, "placement": "top",
            "fields": {"value": "$15,000", "label": "in one month"}, "origin": "auto"}
    bad = {**good, "id": "../x", "template": "logo"}
    output = {"clips": [{"clip_index": 0, "start_time_ms": 10_000, "end_time_ms": 40_000, "summary": "Money"}],
              "metrics": {"clip_layouts": [{"clip_index": 0, "kept_source_ms": [[10_000, 40_000]], "graphics": [good, bad]}]}}
    settings = parse_settings({"aspect_ratio": "9:16", "video_speed": 1})
    (c,), _ = build_candidates(run, output, settings, SAID, 1920, 1080, 60_000, 0)
    assert c["graphics"] == [good]


# --- laid over the finished clip -------------------------------------------

@needs_ffmpeg
def test_overlay_worker_lays_graphics_over_each_clip_and_reports_failures(tmp_path):
    from PIL import Image
    from clip_engine.services.graphics_overlay import overlay_run_clips
    from .test_graphics_overlay import NAME, make_run
    run = make_run(tmp_path, size=(108, 192), seconds=1.0)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=108x192:r=30", "-t", "2",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(run / "clip_00.mp4")], check=True)
    seen = []
    result = asyncio.run(overlay_run_clips(run, [
        {"clip_index": 0, "graphics": [{"file": NAME, "start_ms": 500, "duration_ms": 1000}]},
        {"clip_index": 1, "graphics": [{"file": NAME, "start_ms": 0, "duration_ms": 1000}]},  # no such clip
    ], lambda *args: seen.append(args)))
    assert result == {"done": [0], "failed": [1]}
    assert seen == [(0, True, 1, 2), (1, False, 2, 2)]
    frame = tmp_path / "f.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "1.0", "-i", str(run / "clip_00.mp4"), "-frames:v", "1", str(frame)], check=True)
    r, g, b = Image.open(frame).convert("RGB").getpixel((54, 70))
    assert r > 180 and g < 80 and b < 80, (r, g, b)
    with pytest.raises(ValueError):
        asyncio.run(overlay_run_clips(run, [{"clip_index": "0"}]))
