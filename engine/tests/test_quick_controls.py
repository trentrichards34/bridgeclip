"""Quick controls and Create's sound effects: the color grade (filters, footage only: everything drawn comes after it,
a real FFmpeg run), Create clips' sound effects mixed after their graphics (the same planning and mix as an edited
reel's bake), the planner's spare graphics for "Dress it up", and what the editor keeps (sound, grade)."""
import asyncio
import inspect
import shutil
import subprocess
from pathlib import Path

import pytest

from clip_engine.services import color_grade as cg
from clip_engine.services import graphics_overlay as go
from clip_engine.services import sound_design as sd


# ---------------------------------------------------------------------------
# Color grade
# ---------------------------------------------------------------------------

def test_each_grade_is_one_known_filter_chain_and_none_is_no_filter():
    assert cg.GRADES == ("none", "warm", "cinematic", "film", "cool", "mono")
    assert cg.grade_filter(None) == "" and cg.grade_filter("none") == ""
    assert cg.grade_filter("mono") == "hue=s=0,eq=contrast=1.06"
    assert cg.grade_filter("warm").startswith("colorbalance=rs=0.06")
    assert cg.grade_filter("film").startswith("curves=all='0/0.05 0.5/0.5 1/0.95'")
    for bad in ("sepia", "", 3, "Warm"):
        with pytest.raises(ValueError):
            cg.parse_grade(bad)


def test_the_grade_goes_on_the_framed_footage_and_the_headline_bar_captions_and_graphics_come_after_it():
    graph = "[0:v]scale=1080:1920,setsar=1[base]"
    graded = cg.with_grade(graph, "cinematic")
    assert graded == "[0:v]scale=1080:1920,setsar=1[ungraded];[ungraded]" + cg.GRADE_FILTERS["cinematic"] + "[base]"
    assert cg.with_grade(graph, None) == graph
    with pytest.raises(ValueError):
        cg.with_grade("[a][base];[base]null[base]", "warm")
    from clip_engine.services.rendering_service import RenderingService
    padded = RenderingService._pad_for_headline(graded, 1080, 1920, 300, "white")
    assert padded.index("colorbalance") < padded.index("pad=")
    # In the render itself: after the layout, the zoom punch, b-roll and a gameplay background; before the headline bar,
    # the stage scenes and the captions (which then go over [base]); the graphics are laid over the finished file.
    source = inspect.getsource(RenderingService._render_edit)
    at = source.index("with_grade(graph, request.color_grade)")
    assert source.index("create_punch(") < at and source.index("_overlay_broll(") < at and source.index("_stack_background(") < at
    assert at < source.index("_pad_for_headline(graph") < source.index("_scene_composite(")


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs FFmpeg")
def test_every_grade_runs_in_ffmpeg_inside_a_filter_graph():
    for grade in cg.GRADE_FILTERS:
        graph = cg.with_grade("[0:v]format=yuv420p[base]", grade) + ";[base]drawtext=text=x:fontcolor=white[out]"
        result = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=160x284:d=0.2",
                                 "-filter_complex", graph, "-map", "[out]", "-f", "null", "-"], capture_output=True)
        assert result.returncode == 0, (grade, result.stderr[-300:])


def test_the_editor_bake_checks_and_applies_a_candidates_grade():
    from clip_engine.services import manual_editor
    source = inspect.getsource(manual_editor.render_export)
    assert "color_grade=c.get('grade') if c.get('grade') != 'none' else None" in source
    assert "parse_grade(c['grade'])" in inspect.getsource(manual_editor.validate_candidate)


def test_the_edit_runner_takes_the_grade_with_the_editor_project():
    import edit_runner
    assert edit_runner._editor({"grade": "film"}, 10)["grade"] == "film"
    assert "grade" not in edit_runner._editor({"grade": "none"}, 10)
    with pytest.raises(ValueError):
        edit_runner._editor({"grade": "neon"}, 10)


# ---------------------------------------------------------------------------
# Create: sound effects after the graphics
# ---------------------------------------------------------------------------

def _run(tmp_path, monkeypatch):
    run = tmp_path / "run"
    run.mkdir()
    for index in (0, 1):
        (run / f"clip_{index:02d}.mp4").write_bytes(b"x" * 64)
    order, mixed = [], []

    async def overlay(renderer, video, graphics):
        order.append(("graphics", Path(video).name))

    def design(video, request, total_ms, work, warnings=None):
        order.append(("sounds", Path(video).name))
        mixed.append((Path(video).name, request, total_ms, Path(work).parent))
        return []

    monkeypatch.setattr(go, "overlay_graphics", overlay)
    monkeypatch.setattr(go, "checked_graphics", lambda run, graphics, ms, **_: graphics or [])
    monkeypatch.setattr(sd, "design_in_place", design)
    import clip_engine.services.manual_editor as me
    monkeypatch.setattr(me, "source_info", lambda video: {"duration": 12000.4})
    return run, order, mixed


def test_create_clips_get_sound_effects_after_their_graphics_with_the_members_sounds(tmp_path, monkeypatch):
    run, order, mixed = _run(tmp_path, monkeypatch)
    own = tmp_path / "mine.wav"
    own.write_bytes(b"RIFF")
    events = [{"kind": "hook", "at_ms": 0}, {"kind": "graphic", "template": "stat", "at_ms": 1500, "end_ms": 4500, "size": "card"}]
    clips = [{"clip_index": 0, "graphics": [], "sound": {"register": "story", "music_db": -22, "events": events}},
             {"clip_index": 1, "graphics": []}]
    result = asyncio.run(go.overlay_run_clips(run, clips, None, [{"path": str(own), "action": "pop"}]))
    assert result == {"done": [0, 1], "failed": []}
    # Graphics first, then the sounds; a clip without a sound request gets none.
    assert order == [("graphics", "clip_00.mp4"), ("sounds", "clip_00.mp4"), ("graphics", "clip_01.mp4")]
    name, request, total, workdir = mixed[0]
    assert (name, total, workdir) == ("clip_00.mp4", 12000, run)
    assert (request.register, request.music_db, request.events) == ("story", -22.0, events)
    assert request.palette == [{"path": str(own), "action": "pop"}]
    # The work folder is gone afterwards.
    assert not [p for p in run.iterdir() if p.name.startswith(".sounds-")]


def test_a_malformed_sound_request_fails_only_that_clip(tmp_path, monkeypatch):
    run, order, _ = _run(tmp_path, monkeypatch)
    clips = [{"clip_index": 0, "graphics": [], "sound": {"register": "loud", "events": []}},
             {"clip_index": 1, "graphics": [], "sound": {"events": [], "palette": [{"path": "/x.wav", "action": "pop"}]}}]
    assert asyncio.run(go.overlay_run_clips(run, clips)) == {"done": [], "failed": [0, 1]}
    assert order == []


def test_create_sounds_use_the_same_planner_and_levels_as_an_edited_reel():
    """The events main sends become cues and placements exactly as an editor bake's do (no Create-only logic)."""
    request = go.run_clip_sound({"register": "teaching", "events": [{"kind": "hook", "at_ms": 0},
                                {"kind": "graphic", "template": "stat", "at_ms": 3000, "end_ms": 6000, "size": "card"},
                                {"kind": "graphic", "template": "comment_cta", "at_ms": 9000, "end_ms": 12000, "size": "card"}]}, [])
    placements = sd.plan_sounds(sd.cues_from_events(request.events, 15000), 15000, request.register, request.music_db)
    actions = [(p.action, p.kind) for p in placements]
    assert ("swipe", "hook") in actions and ("pop", "graphic") in actions
    # One riser into the call to action, which lands as an impact.
    assert [a for a, _ in actions].count("riser") == 1 and ("impact", "graphic") in actions


def test_the_editor_keeps_a_create_clips_recorded_sound():
    from clip_engine.services.automatic_editor import saved_sound
    assert saved_sound({"on": True, "register": "story", "music_db": -22, "cues": []}, 10000) == {"on": True, "register": "story", "music_db": -22, "cues": []}
    assert saved_sound({"on": True, "register": "loud", "cues": []}, 10000) is None
    assert saved_sound(None, 10000) is None


# ---------------------------------------------------------------------------
# "Dress it up": the planner's spare graphics
# ---------------------------------------------------------------------------

def test_spare_graphics_are_the_teaching_plans_others_away_from_the_used_ones(monkeypatch):
    from clip_engine.services import edit_recording as er
    seen = {}

    def planned(raw, words, plan, options):
        seen["register"] = options.get("register")
        return [{"id": f"g-{w:010d}", "template": "stat", "word": w} for w in (4, 12, 15, 30, 31, 50)]

    monkeypatch.setattr(er, "_planned_graphics", planned)
    used = [{"id": "g-x", "word": 10}]
    spare = er.spare_graphics([], [], {}, {"register": "story", "stage": True}, used)
    assert seen["register"] == "teaching"
    # 12 and 15 sit near the used one (10) or each other; 31 is next to 30.
    assert [g["word"] for g in spare] == [4, 30, 50]

    def broken(*_):
        raise RuntimeError("no")
    monkeypatch.setattr(er, "_planned_graphics", broken)
    assert er.spare_graphics([], [], {}, {}, used) == []
