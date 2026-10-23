"""Depth and camera: frame escape (stage scenes), the type takeover's split, punch-ins on cues and scene transitions."""

import re

import numpy as np
import pytest

from clip_engine.services import depth_fx as dx
from clip_engine.services import graphics_director as gd
from clip_engine.services import look_extras as lx
from clip_engine.services import sound_design as sd
from clip_engine.services import stage_scenes as ss
from clip_engine.services.graphics_overlay import behind_windows, checked_graphics, overlay_command
from clip_engine.services.layout_analyzer import Box, ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.manual_editor import punch_events
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord


# ---------------------------------------------------------------------------
# Frame escape
# ---------------------------------------------------------------------------

def _faces(face, n=6, step=500):
    return [(i * step, face) for i in range(n)]


def test_escape_crop_frames_the_eyes_near_the_card_top_with_room_above_for_the_hair():
    # A wide webcam shot: a 200 px face in a 1920x1080 frame, well below the top.
    face = (860.0, 300.0, 200.0, 200.0)
    bounds = (0.0, 0.0, 1920.0, 1080.0)
    base = ss.card_crop(_faces(face), bounds, 1000 / 806)
    crop = ss.escape_crop(_faces(face), base)
    assert crop is not None and crop.ext == pytest.approx(dx.ESCAPE_EXT * crop.h)
    x, y = crop.at(1000)
    eye = face[1] + ss.EYE_IN_FACE * face[3]
    assert (eye - y) / crop.h == pytest.approx(dx.ESCAPE_EYE_Y, abs=0.01)
    # The hair (about 0.3 face heights over the box) rises over the card's top edge, inside the strip drawn above it.
    hair = face[1] - dx.HAIR_ABOVE * face[3]
    assert y - crop.ext < hair < y
    # The usual card keeps the whole head inside.
    assert base.at(1000)[1] < hair
    # Same width and height as the usual crop at most (it may come in closer, never further out).
    assert crop.h <= base.h + 1e-6 and crop.w / crop.h == pytest.approx(base.w / base.h)


def test_escape_crop_is_refused_when_the_head_is_cut_off_or_the_face_too_low():
    bounds = (0.0, 0.0, 1920.0, 1080.0)
    # The top of the head is outside the picture: it would break out with a flat top.
    cut = (860.0, 20.0, 200.0, 200.0)
    assert ss.escape_crop(_faces(cut), ss.card_crop(_faces(cut), bounds, 1000 / 806)) is None
    # No face seen.
    assert ss.escape_crop([], ss.card_crop([], bounds, 1000 / 806)) is None
    # A face at the very bottom of the frame: the card can't go lower, so the eyes can't come near its top.
    low = (860.0, 820.0, 200.0, 200.0)
    assert ss.escape_crop(_faces(low), ss.card_crop(_faces(low), bounds, 1000 / 806)) is None
    # One jumpy detection out of six doesn't undo it.
    good = (860.0, 300.0, 200.0, 200.0)
    mixed = _faces(good, 5) + [(2500, cut)]
    assert ss.escape_crop(mixed, ss.card_crop(mixed, bounds, 1000 / 806)) is not None


def test_a_close_selfie_card_comes_in_closer_to_escape():
    # Face 45% of a 9:16 frame (a selfie at arm's length): the usual card is zoomed out over a blur.
    face = (170.0, 270.0, 380.0, 575.0)
    bounds = (0.0, 0.0, 720.0, 1280.0)
    base = ss.card_crop(_faces(face), bounds, 1080 / 846, 0, 0.6)
    crop = ss.escape_crop(_faces(face), base)
    assert crop is not None and crop.h < base.h
    assert crop.at(0)[1] + crop.h <= 1280 + 0.5  # the card's bottom stays inside the picture
    assert (face[1] + ss.EYE_IN_FACE * face[3] - crop.at(0)[1]) / crop.h <= dx.ESCAPE_MAX_EYE


def test_escape_chains_draw_a_taller_card_and_the_same_cut_of_the_matte():
    face = (860.0, 300.0, 200.0, 200.0)
    base = ss.card_crop(_faces(face), (0.0, 0.0, 1920.0, 1080.0), 1000 / 806)
    crop = ss.escape_crop(_faces(face), base)
    video = ss.card_chain("in", "out", crop, 0, 3000, 1000, 806, 274)
    assert "scale=1000:1080" in video and re.search(r"crop=w=\d+:h=\d+", video)
    matte = ss.card_matte_chain("m", "mo", crop, 0, 3000, 1000, 806, 274, (0.5, 0.5))
    assert "scale=1000:1080" in matte
    # Half-size matte: the crop is the video's, halved.
    w = int(re.search(r"crop=w=(\d+)", video).group(1))
    assert int(re.search(r"crop=w=(\d+)", matte).group(1)) == round(w * 0.5)
    # A piece with no escape: padded on top (video), black (matte).
    assert "pad=1000:1080:0:274:color=black" in ss.card_chain("in", "out", base, 0, 3000, 1000, 806, 274)
    assert "drawbox=c=black:t=fill" in ss.card_matte_chain("m", "mo", base, 0, 3000, 1000, 806, 274, (0.5, 0.5))


def _plan(face=Box(0.45, 0.28, 0.104, 0.185)):
    return ClipLayoutPlan([ShotLayout(0, 6000, LayoutType.TALKING_HEAD, people=[face])], 1920, 1080,
                          face_samples=[(t, [face]) for t in range(0, 6000, 500)])


def test_scene_graph_lays_the_escape_strip_over_the_card_only_where_the_matte_is_good(tmp_path):
    plan = _plan()
    graph = "[0:v]fps=30[clocked];[clocked]null[base]"
    asked = []

    def matte(spans, good=True):
        asked.append(spans)
        path = tmp_path / "m.mkv"
        path.write_bytes(b"x")
        return str(path), [good] * len(spans)

    card = lambda w, h, runs, transition, escape=None: ss.card_source_graph(plan, [(0, 6000)], w, h, "30", runs, transition, escape=escape)  # noqa: E731
    scenes = [ss.Scene("stage", 1000, 4000)]
    comp = ss.build_scene_graph(graph, scenes, 1080, 1920, 6000, 1.0, "30", 1, str(tmp_path), "t", card_graph=card,
                                escape_matte=matte, matte_size=(960, 540))
    assert asked == [[(1000, 4000)]]  # the matte only for the stage scene's stretch (window ms)
    assert comp.escaped == [True] and comp.escaped_spans == [(1.0, 4.0)]
    index = 1 + next(i for i, p in enumerate(comp.inputs) if p.endswith("m.mkv"))
    assert f"[{index}:v]format=gray,fps=30:start_time=0:round=near" in comp.graph
    assert "alphamerge[sc_esc_full]" in comp.graph and "[sc_card_matte]" in comp.graph
    ext = ss.even(round(1920 - ss.geometry(1080, 1920).card_y - round(1920 * ss.CARD_BOTTOM)) * dx.ESCAPE_EXT)
    strip = re.search(r"\[sc_esc_0\]crop=(\d+):(\d+):0:(\d+)\[sc_strip\]", comp.graph)
    assert strip and int(strip.group(2)) == ext + ss.geometry(1080, 1920).radius
    assert re.search(rf"overlay=x=-?\d+:y='.*-{ext}':enable='between\(t,1\.0000,4\.3500\)'\[sc_escaped\]", comp.graph)
    # The captions move onto the card (over the chest) while the head is out.
    windows = ss.caption_windows(comp.segments, comp.geometry, comp.escaped_spans)
    geo = comp.geometry
    assert windows == [(1000, 4000, geo.card_y + round(geo.card_h * ss.ESCAPE_CAPTION_Y), "")]
    # A poor matte: the card is framed as usual and no strip is drawn.
    asked.clear()
    comp = ss.build_scene_graph(graph, scenes, 1080, 1920, 6000, 1.0, "30", 1, str(tmp_path), "u", card_graph=card,
                                escape_matte=lambda spans: matte(spans, False), matte_size=(960, 540))
    assert asked and comp.escaped == [False] and "sc_esc" not in comp.graph and not any(p.endswith("m.mkv") for p in comp.inputs)
    # Turned off in the scene: never asked.
    asked.clear()
    comp = ss.build_scene_graph(graph, [ss.Scene("stage", 1000, 4000, escape=False)], 1080, 1920, 6000, 1.0, "30", 1, str(tmp_path), "v",
                                card_graph=card, escape_matte=matte, matte_size=(960, 540))
    assert not asked and "sc_esc" not in comp.graph


def test_matte_quality_rules():
    good = dx.MatteQuality(0.95, 0.2, 0.05)
    assert good.good
    assert not dx.MatteQuality(0.5, 0.2, 0.05).good  # the speaker is often missing
    assert not dx.MatteQuality(0.95, 0.6, 0.05).good  # mostly soft, undecided edges
    assert not dx.MatteQuality(0.95, 0.2, 0.3).good  # flickers
    solid = np.zeros((40, 40), np.uint8)
    solid[10:30, 10:30] = 255
    moved = np.roll(solid, 2, axis=1)
    present, soft, flicker = dx.frame_stats(moved, solid)
    assert present and soft == 0.0 and 0 < flicker < 0.25
    q = dx.summarize([dx.frame_stats(solid), dx.frame_stats(moved, solid), dx.frame_stats(np.zeros_like(solid), moved)])
    assert q.present == pytest.approx(2 / 3)


def test_scenes_parse_the_escape_and_transition_options():
    scenes = ss.parse_scenes([{"scene": "stage", "start_ms": 0, "end_ms": 2000, "escape": False, "transition": "whip"},
                              {"scene": "visual", "start_ms": 2000, "end_ms": 4000, "transition": "slide"}])
    assert scenes[0].escape is False and scenes[0].transition == "whip" and scenes[1].transition == "slide"
    assert ss.to_dicts(scenes)[0] == {"scene": "stage", "start_ms": 0, "end_ms": 2000, "backdrop": "light", "escape": False, "transition": "whip"}
    for bad in ({"escape": "no"}, {"transition": "spin"}):
        with pytest.raises(ValueError):
            ss.parse_scenes([{"scene": "stage", "start_ms": 0, "end_ms": 2000, **bad}])
    pairs = ss.output_scenes([{"scene": "stage", "start_ms": 1000, "end_ms": 3000, "escape": False, "transition": "slide"}], [(0, 5000)], 1.0)
    assert pairs[0][1] == {"scene": "stage", "start_ms": 1000, "end_ms": 3000, "backdrop": "light", "escape": False, "transition": "slide"}


# ---------------------------------------------------------------------------
# Type takeover
# ---------------------------------------------------------------------------

def test_chin_row():
    assert dx.chin_row((100, 400, 300, 700)) == round(700 + 300 * dx.CHIN_BELOW)
    assert dx.chin_row(None) is None


def test_overlay_command_splits_a_takeover_around_the_speaker(tmp_path):
    (tmp_path / ".graphics").mkdir()
    name = "c" * 64 + ".mov"
    (tmp_path / ".graphics" / name).write_bytes(b"x" * 100)
    graphics = checked_graphics(tmp_path, [{"file": name, "start_ms": 1000, "duration_ms": 2000, "depth": "between"}], 5000)
    assert graphics[0]["depth"] == "between" and behind_windows(graphics) == [(1000, 3000)]
    cmd = overlay_command("clip.mp4", [{**graphics[0], "split": 900}], "out.mp4", 1080, 1920, ["-c:v", "libx264"],
                          [{"path": "m.mkv", "start_ms": 1000, "duration_ms": 2000}])
    graph = cmd[cmd.index("-filter_complex") + 1]
    # The room blurs and darkens while it plays; the upper lines go on before the speaker, the lower lines after.
    assert graph.startswith("[0:v]gblur=") and "enable='between(t,1.000,3.000)'" in graph
    upper, person, lower = graph.index("[g1a]overlay"), graph.index("[person0]overlay"), graph.index("[g1b]overlay=0:900")
    assert upper < person < lower
    assert "crop=1080:900:0:0[g1a]" in graph and "crop=1080:1020:0:900[g1b]" in graph
    # Without the cut-out (no mattes) it is simply laid over the video, no darkening.
    plain = overlay_command("clip.mp4", graphics, "out.mp4", 1080, 1920, ["-c:v", "libx264"])
    assert "gblur" not in plain[plain.index("-filter_complex") + 1]


def _segments(words):
    return [TranscriptSegment(words[0][1], words[-1][2], " ".join(w for w, _, _ in words),
                              words=[TranscriptWord(w, a, b) for w, a, b in words])]


def _said(text, start=0, step=350):
    out = []
    for i, w in enumerate(text.split()):
        out.append((w, start + i * step, start + i * step + 300))
    return out


def test_director_picks_the_takeover_for_the_punchline_and_caps_the_family():
    words = _said("I tried every hack for months.") + _said("Here's the thing: consistency beats talent.", 2500)
    cues = gd.find_cues(_segments(words))
    punch = [c for c in cues if c["kind"] == "punchline"]
    assert punch and punch[0]["prefer"][0] == "takeover" and punch[0]["at_ms"] == 2500
    # One family with the slam effects: at most two in a video.
    kept = [{"template": "takeover", "fields": {}}, {"template": "fx", "fields": {"effect": "headline-slam"}}]
    assert gd.group_allows("takeover", kept[:1], 60) and not gd.group_allows("takeover", kept, 60)
    assert not gd.group_allows("fx:per-word-rise", kept, 60)
    assert "takeover" in gd.director_rule()


# ---------------------------------------------------------------------------
# Punch-ins on cues
# ---------------------------------------------------------------------------

def _words(text, start=0.0, step=0.32):
    out = []
    for i, w in enumerate(text.split()):
        out.append((start + i * step, start + i * step + 0.26, w))
    return out


def test_punches_land_on_the_stressed_word_of_a_turn_and_on_a_number():
    words = _words("Most people post every single day. But here's the thing: nobody watches.", 0.4) + \
        _words("We grew to 40,000 followers in a year doing less.", 6.5)
    cues = dx.punch_cues(words, 16.0)
    by_word = {p.word: p for p in cues}
    thing = next(w for w in words if w[2].startswith("thing"))
    assert by_word["thing:"].land == pytest.approx(thing[0]) and by_word["thing:"].kind == "turn"
    # The push-in starts 6 frames before the word (it lands on it), decelerating.
    assert by_word["thing:"].land - by_word["thing:"].start == pytest.approx(6 / 30, abs=1e-3)
    p = by_word["thing:"]
    assert dx.punch_zoom_at(p.start, p) == 1.0 and dx.punch_zoom_at(p.land, p) == pytest.approx(dx.CUE_ZOOM)
    assert dx.punch_zoom_at((p.start + p.land) / 2, p) > 1 + (dx.CUE_ZOOM - 1) * 0.8  # most of the travel early
    assert dx.punch_zoom_at(p.end, p) == 1.0  # a cut back
    assert dx.CUE_MIN_HOLD_S * 0.8 <= p.end - p.land <= dx.CUE_MAX_HOLD_S
    number = next(c for c in cues if c.kind == "number")
    assert number.word == "40,000"
    # Never two closer than the gap; never in the first second.
    assert all(b.land - a.land >= dx.CUE_GAP_S for a, b in zip(cues, cues[1:]))
    assert all(c.start >= 1.0 for c in cues)


def test_punch_density_is_capped():
    words = []
    for k in range(10):
        words += _words("But here's the thing about 50 sales.", 1.0 + k * 3.0)
    cues = dx.punch_cues(words, 32.0)
    assert len(cues) <= max(1, int(32.0 / dx.CUE_PER_S))
    assert dx.punch_cues(words[:3], 3.0) == []  # too short a clip


def test_the_zoom_extra_punches_on_cues_and_keeps_its_rhythm_clear_of_them():
    words = _words("Most people post daily and it never works for them at all. But here's the thing: nobody watches the first ten seconds.", 0.3)
    plan = lx.punch_plan(words, 14.0)
    assert plan.cues
    for a, b in plan.rhythm:
        for p in plan.cues:
            assert b <= p.start - lx.CUE_CLEARANCE_S + 1e-6 or a >= p.end + lx.CUE_CLEARANCE_S - 1e-6
    # A cue during b-roll (blocked) is not punched.
    blocked = [(p.start - 0.1, p.end + 0.1) for p in plan.cues]
    assert not lx.punch_plan(words, 14.0, blocked=blocked).cues
    held, ramps = lx.cue_windows(plan.cues, [None] * len(plan.cues), 1080, 1920)
    (start, frames, rect), (a, b, rect2) = ramps[0], held[0]
    assert frames == 6 and rect == rect2 and a == pytest.approx(start + 6 / 30, abs=1e-3)
    assert rect[2] == lx._even(1080 / dx.CUE_ZOOM)
    graph = lx.punch_graph("v", "o", 1080, 1920, held, ramps=ramps)
    assert "zoompan=" in graph and f"trim=start={start:.4f}" in graph and graph.count("[o]") == 1


def test_a_punch_on_a_cue_sounds_on_its_word():
    events = punch_events([{"at_ms": 2100, "end_ms": 3500, "kind": "turn"}, {"at_ms": 7000, "end_ms": 8000, "kind": "number"}])
    assert events == [{"kind": "punch", "at_ms": 2100, "sound": "whoosh"}, {"kind": "punch", "at_ms": 7000, "sound": "impact"}]
    cues = sd.cues_from_events([*events, {"kind": "punch", "at_ms": 9000}], 12000)
    assert [(c.at_ms, c.action, c.priority) for c in cues] == [(2100, "whoosh", sd.PRIORITY["punch_cue"]),
                                                             (7000, "impact", sd.PRIORITY["punch_cue"]),
                                                             (9000, "swipe", sd.PRIORITY["punch"])]


# ---------------------------------------------------------------------------
# Scene transitions
# ---------------------------------------------------------------------------

def test_transitions_center_on_the_cut_at_each_change_of_scene_kind():
    scenes = [ss.Scene("stage", 1000, 3000), ss.Scene("visual", 3000, 5000, transition="whip"),
              ss.Scene("stage", 6000, 8000, transition="slide")]
    segments = ss.edited_segments(scenes, 10000, 1.0)
    moves = dx.scene_transitions(segments, 30.0, 1.0, 10.0)
    assert [(m.kind, m.at) for m in moves] == [("zoom", 1.0), ("whip", 3.0), ("whip", 5.0)]
    assert moves[0].half == pytest.approx(4 / 30) and moves[1].half == pytest.approx(5 / 30)
    # At 1.25x the move is longer on the edited clock (the same output frames once sped up).
    sped = dx.scene_transitions(ss.edited_segments(scenes, 12500, 1.25), 30.0, 1.25, 12.5)
    assert sped[0].at == pytest.approx(1.25) and sped[0].half == pytest.approx(4 / 30 * 1.25)
    graph = dx.transitions_graph("a", "b", moves, "30", 1080, 1920)
    assert graph.startswith("[a]split=4") and "zoompan=" in graph and "hstack" in graph and "avgblur" in graph
    assert f"enable='between(t,{1 - 4 / 30:.4f}," in graph


def test_the_scene_graph_moves_the_camera_and_reports_where(tmp_path):
    graph = "[0:v]fps=30[clocked];[clocked]null[base]"
    comp = ss.build_scene_graph(graph, [ss.Scene("stage", 2000, 4000)], 1080, 1920, 6000, 1.0, "30", 1, str(tmp_path), "t")
    assert [(m.kind, m.at) for m in comp.transitions] == [("zoom", 2.0), ("zoom", 4.0)]
    assert "[sc_moved]format=yuv420p[base]" in comp.graph
    # The scene's sound lands on the cut: the scene event's time is the move's middle.
    events = sd.cues_from_events([{"kind": "scene", "at_ms": 2000, "end_ms": 4000}], 6000)
    assert events[0].at_ms == round(comp.transitions[0].at * 1000)
    plain = ss.build_scene_graph(graph, [ss.Scene("stage", 2000, 4000, transition="slide")], 1080, 1920, 6000, 1.0, "30", 1, str(tmp_path), "u")
    assert not plain.transitions and "sc_moved" not in plain.graph


def test_output_to_source_maps_a_takeover_through_the_cut_and_speed():
    ranges = [(1000, 3000), (5000, 9000)]
    assert dx.output_to_source(ranges, 1.0, 500, 1000) == [(1500, 2000)]
    # Across the cut, at 1.25x: output 1200-2000 ms is edited 1500-2500 ms.
    assert dx.output_to_source(ranges, 1.25, 1200, 2000) == [(2500, 3000), (5000, 5500)]


def test_overlay_command_draws_a_smaller_speaker_during_a_takeover_only():
    g = {"path": "t.mov", "start_ms": 1000, "duration_ms": 2000, "depth": "between", "split": 700, "shift": 40, "person": (0.55, 230, 288)}
    cmd = overlay_command("clip.mp4", [g], "out.mp4", 1080, 1920, [], [{"path": "m.mkv", "start_ms": 1000, "duration_ms": 2000}])
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "[person0]split=2[person0w][person0s0]" in graph
    assert "enable='between(t,1.000,3.000)*not(between(t,1.000,3.000))'" in graph  # the full-size cut-out sits this one out
    assert "scale=594:1056:flags=bicubic,geq=lum='p(X,Y)'" in graph and "overlay=230:288" in graph
    assert "overlay=0:40:" in graph and "[g1b]overlay=0:740:" in graph  # both parts moved by the shift


def _head_matte(cx=540, crown=700, chin=1250, half_w=230, h=1920, w=1080):
    """A speaker's matte: an oval head from the crown to the chin, shoulders below it to the bottom."""
    yy, xx = np.mgrid[0:h, 0:w]
    cy, ry = (crown + chin) / 2, (chin - crown) / 2
    head = ((xx - cx) / half_w) ** 2 + ((yy - cy) / ry) ** 2 <= 1
    body = (yy >= chin) & (np.abs(xx - cx) <= half_w * 2.2)
    return ((head | body) * 255).astype(np.uint8)


def _takeover_alpha(rows=((150, 380), (410, 640), (670, 900), (930, 1160)), h=1920, w=1080):
    alpha = np.zeros((h, w), np.uint8)
    for a, b in rows:
        for k in range(4):  # a few "words" across the width
            x0 = 80 + k * 240
            alpha[a:b, x0:x0 + 190] = 255
    return list(rows), alpha


def test_takeover_layout_keeps_the_behind_lines_readable_above_the_head():
    lines, alpha = _takeover_alpha()
    matte = _head_matte()
    face = (380.0, 820.0, 700.0, 1200.0)
    layout = dx.takeover_layout(lines, alpha, [matte], face, 1080, 1920)
    assert not layout.front_only
    behind = [line for line in layout.lines if line[3]]
    front = [line for line in layout.lines if not line[3]]
    assert 1 <= len(behind) <= 2 and front
    placed = dx.place_matte(matte, layout.person, 1080, 1920)
    for a, b, dst, _ in behind:
        line, word = dx.line_occlusion(alpha[a:b] > 96, placed, dst)
        assert line <= dx.OCCLUDE_MAX and word <= dx.WORD_OCCLUDE_MAX
        assert dst + (b - a) <= dx.head_top_of(placed) + (b - a) * max(dx.TUCKS) + 1  # above the crown (tucked at most)
    # The front lines go below the chin, in order, inside the frame.
    scale, _, y = layout.person
    assert all(dst >= y + scale * dx.chin_row(face) for _, _, dst, _ in front)
    assert max(dst + b - a for a, b, dst, _ in layout.lines) <= dx.LAYOUT_BOTTOM * 1920 + 1


def test_takeover_layout_falls_back_to_all_lines_in_front():
    lines, alpha = _takeover_alpha()
    # No face found: nothing goes behind; the lines stay where they were drawn.
    plain = dx.takeover_layout(lines, alpha, [_head_matte()], None, 1080, 1920)
    assert plain.front_only and all(not behind and dst == a for a, _, dst, behind in plain.lines)
    # Type too tall to fit above and below even the smallest speaker: all in front.
    tall, tall_alpha = _takeover_alpha(((100, 500), (520, 920), (940, 1340), (1360, 1760)))
    assert dx.takeover_layout(tall, tall_alpha, [_head_matte(crown=200, chin=1500)], (300.0, 400.0, 780.0, 1450.0), 1080, 1920).front_only


def test_line_occlusion_counts_ink_and_the_worst_word():
    ink = np.zeros((100, 1080), bool)
    ink[:, 100:300] = True
    ink[:, 600:800] = True
    matte = np.zeros((1920, 1080), np.uint8)
    matte[1000:1100, 600:700] = 255  # half of the second word
    line, word = dx.line_occlusion(ink, matte, 1000)
    assert line == pytest.approx(0.25) and word == pytest.approx(0.5)
    assert dx.word_spans(ink, 10) == [(100, 300), (600, 800)]


def test_overlay_command_lays_each_takeover_line_where_the_layout_put_it():
    g = {"path": "t.mov", "start_ms": 1000, "duration_ms": 2000, "depth": "between", "person": (0.6, 216, 300),
         "layout": [[150, 380, 120, True], [410, 640, 380, True], [670, 900, 1250, False], [930, 1160, 1500, False]]}
    cmd = overlay_command("clip.mp4", [g], "out.mp4", 1080, 1920, [], [{"path": "m.mkv", "start_ms": 1000, "duration_ms": 2000}])
    graph = cmd[cmd.index("-filter_complex") + 1]
    person = graph.index("[ps0_0]overlay")
    # The room zooms out with the speaker (a softer copy filling the frame).
    assert "gblur=sigma=36" in graph and "[rb0][rz0]overlay=216:300" in graph
    behind = [graph.index(f"[g1c{j}]overlay") for j in (0, 1)]
    front = [graph.index(f"[g1c{j}]overlay") for j in (2, 3)]
    assert max(behind) < person < min(front)
    assert "split=4[g1_0][g1_1][g1_2][g1_3]" in graph
