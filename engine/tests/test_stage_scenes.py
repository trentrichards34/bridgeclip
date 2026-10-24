"""Scenes: face / stage / visual layout switching on 9:16 clips (stage_scenes + the render)."""

import asyncio
import os
import re
import subprocess

import numpy as np
from PIL import Image
import pytest

from clip_engine.services import rendering_service as module
from clip_engine.services import stage_scenes as ss
from clip_engine.services.layout_analyzer import Box, ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.manual_editor import manual_plan
from clip_engine.services.rendering_service import RenderingService, RenderRequest

GRAPH = "[0:v]fps=30[clocked];[clocked]null[base]"


def test_parse_checks_sorts_clips_and_resolves_overlaps():
    raw = [
        {"scene": "visual", "start_ms": 5000, "end_ms": 9000, "backdrop": "dark"},
        {"scene": "stage", "start_ms": 1000, "end_ms": 6000},
        {"scene": "face", "start_ms": 9000, "end_ms": 9500},
    ]
    scenes = ss.parse_scenes(raw, 8000)
    # The later scene wins the overlap; face is the default (dropped); the end is clipped to the clip.
    assert scenes == [ss.Scene("stage", 1000, 5000, "light"), ss.Scene("visual", 5000, 8000, "dark")]
    # Same scene and backdrop back to back merge; slivers go.
    assert ss.parse_scenes([{"scene": "stage", "start_ms": 0, "end_ms": 2000}, {"scene": "stage", "start_ms": 2000, "end_ms": 3000},
                            {"scene": "visual", "start_ms": 3000, "end_ms": 3100}]) == [ss.Scene("stage", 0, 3000)]
    for bad in ([{"scene": "zoom", "start_ms": 0, "end_ms": 1000}], [{"scene": "stage", "start_ms": 1000, "end_ms": 1000}],
                [{"scene": "stage", "start_ms": -1, "end_ms": 1000}], [{"scene": "stage", "start_ms": 0, "end_ms": 1000, "backdrop": "red"}],
                [{"scene": "stage", "start_ms": 0, "end_ms": 1000, "extra": 1}], [{"scene": "stage", "start_ms": 0, "end_ms": float("nan")}],
                [{"scene": "stage", "start_ms": i * 1000, "end_ms": i * 1000 + 900} for i in range(ss.MAX_SCENES + 1)], {"scene": "stage"}):
        with pytest.raises(ValueError):
            ss.parse_scenes(bad)
    assert ss.parse_scenes(None) == []
    assert ss.scene_at(scenes, 999) == "face" and ss.scene_at(scenes, 1000) == "stage" and ss.scene_at(scenes, 7999) == "visual"


def test_segments_run_on_the_edited_clock_at_the_export_speed():
    # Output-clock scenes at 1.25x: output t plays at edited t * 1.25 (the composite is sped up last).
    scenes = [ss.Scene("stage", 2000, 4000), ss.Scene("visual", 4000, 6000, "dark")]
    segments = ss.edited_segments(scenes, 10000, 1.25)
    assert [(s.scene, round(s.start, 3), round(s.end, 3)) for s in segments] == [
        ("face", 0, 2.5), ("stage", 2.5, 5.0), ("visual", 5.0, 7.5), ("face", 7.5, 10.0)]
    assert ss.card_runs(segments) == [(2.5, 5.0)]
    # Backdrops cut in and out (never a dissolve); with the morph back to face the last one holds until it has landed.
    windows = ss.backdrop_windows(segments, 0.4375)
    assert [(w["backdrop"], w["start"], round(w["end"], 4)) for w in windows] == [("light", 2.5, 5.0), ("dark", 5.0, 7.5)]
    morphs = ss.scene_morphs(segments, 30.0, 1.25, 10.0)
    # Face -> stage in, visual -> face out (stage <-> visual is the card's slide), 14 edited frames (11 output frames).
    assert [(m.at, m.into, m.target) for m in morphs] == [(2.5, True, "card"), (7.5, False, "off")]
    assert ss.morph_frames_for(30.0, 1.25) == 14 and abs(morphs[0].length - 14 / 30) < 1e-9
    windows = ss.backdrop_windows(segments, 0.4375, morphs)
    # (each morph overlapped by a frame: the backdrop comes in a frame after the morph starts, holds a frame after it ends)
    assert [(w["backdrop"], round(w["start"], 4), round(w["end"], 4)) for w in windows] == [
        ("light", round(2.5 + 1 / 30, 4), 5.0), ("dark", 5.0, round(7.5 + 15 / 30, 4))]


@pytest.mark.parametrize("kind", ["stage", "visual"])
def test_scene_graph_builds_for_each_scene(tmp_path, kind):
    scenes = [ss.Scene(kind, 1000, 3000, "light")]
    comp = ss.build_scene_graph(GRAPH, scenes, 1080, 1920, 5000, 1.0, "30", 2, str(tmp_path), "t")
    assert comp.graph.count("[base]") == 1 and comp.graph.endswith("[base]")
    # No dissolve: the backdrop cuts in at the scene start and holds until the face frame is full again (11 frames).
    assert "fade=" not in comp.graph
    assert "[2:v]" in comp.graph and "trim=end=3.4000" in comp.graph
    # The face frame morphs into the scene and back: a per-frame scale on a canvas, cut by its mask frames.
    assert comp.graph.count("scale=w='if(lt(t,0.01667),") == 2 and "eval=frame" in comp.graph
    # Its mask is drawn in the graph (no still input: one read only at the morph made FFmpeg hold the video until then).
    assert comp.graph.count("geq=lum=") == 2 * ss.MORPH_FRAMES and "morph" not in "".join(comp.inputs)
    if kind == "stage":
        assert len(comp.inputs) == 3  # backdrop, card mask, card shadow
        assert "[3:v]format=gray" in comp.graph
        # The card is in place once the morph lands and leaves as the morph out starts (no slide).
        # (a frame of overlap with the morph either side, under it)
        assert "gte(t,1.3333)" in comp.graph and "gte(t,3.0333)" in comp.graph and "clip((t-" not in comp.graph
        assert "enable='between(t,1.3333,3.0333)'" in comp.graph
    else:
        assert len(comp.inputs) == 1
    # On the frame grid: from half a frame before its first frame to half a frame after its held last one.
    assert "enable='between(t,0.98333,1.38333)'" in comp.graph and "enable='between(t,2.98333,3.38333)'" in comp.graph
    for path in comp.inputs:
        assert os.path.isfile(path)
    # All face: nothing to draw.
    assert ss.build_scene_graph(GRAPH, [], 1080, 1920, 5000, 1.0, "30", 1, str(tmp_path), "t") is None


def test_scene_graph_at_speed_and_a_backdrop_change(tmp_path):
    scenes = [ss.Scene("stage", 0, 2000, "light"), ss.Scene("visual", 2000, 4000, "dark")]
    comp = ss.build_scene_graph(GRAPH, scenes, 1080, 1920, 6000, 1.25, "30", 1, str(tmp_path), "t")
    # A scene at the clip start is up from the first frame (no fade, no slide).
    assert "fade=" not in comp.graph and "(1-" in comp.graph
    # Light → dark at output 2.0 s = edited 2.5 s: the backdrops cut; the card slides away (350 ms of output, 0.4375 s
    # edited, accelerating).
    assert "between(t,0.0000,2.5000)" in comp.graph
    assert "pow(clip((t-2.5000)/0.4375,0,1),3)" in comp.graph


def test_card_frames_come_from_their_own_framing_when_the_graph_reads_the_source(tmp_path):
    plan = ClipLayoutPlan([ShotLayout(0, 4000, LayoutType.TALKING_HEAD, people=[Box(0.45, 0.2, 0.1, 0.2)])], 1920, 1080)
    crops = ss.card_crops(plan, [(0, 4000)], [(0.0, 2.0)], 0.35, 1000 / 806)
    crop = crops[(0, 0)]
    assert abs(crop.w / crop.h - 1000 / 806) < 0.01  # the card's shape
    x, y = crop.at(0)
    assert x < 0.5 * 1920 < x + crop.w and y < 0.2 * 1080 and 0.4 * 1080 < y + crop.h  # the whole face, room above it
    assert not crop.zoomed_out  # a wide shot has room
    graph = "[0:v]fps=30[clocked];[clocked]null[base]"
    comp = ss.build_scene_graph(graph, [ss.Scene("stage", 0, 2000)], 1080, 1920, 4000, 1.0, "30", 1, str(tmp_path), "t",
                                card_graph=lambda w, h, runs, transition: ss.card_source_graph(plan, [(0, 4000)], w, h, "30", runs, transition))
    assert ss.card_source_graph(plan, [(0, 4000)], 1000, 806, "30", [(0.0, 2.0)], 0.35)[1] == [1000]  # a wide shot: full width
    assert comp.graph.startswith("[0:v]split=2[sc_v0][sc_card_src];[sc_v0]fps=30")
    assert "[sc_card_frames]format=yuva420p" in comp.graph and "[sc_src]" not in comp.graph
    labels = re.findall(r"\[([A-Za-z_][A-Za-z0-9_]*)\]", comp.graph)
    assert labels.count("base") == 1 and labels.count("clocked") == 2 and labels.count("cd_clocked") == 2


def _head_in_card(crop, t, face, margin=ss.HEAD_MARGIN):
    """Where the face's head (with its hair allowance) and eyes land in the crop at t, as shares of the crop's height."""
    x, y = crop.at(t)
    hx, hy, hw, hh = ss.head_box(face)
    return (hy - y) / crop.h, (hy + hh - y) / crop.h, (face[1] + ss.EYE_IN_FACE * face[3] - y) / crop.h, (face[0] + face[2] / 2 - x) / crop.w


def test_card_crop_frames_head_and_shoulders_with_headroom():
    # A seated speaker in a 16:9 frame: the face 216 px tall.
    face = (900.0, 300.0, 150.0, 216.0)
    crop = ss.card_crop([(0, face), (500, face)], (0, 0, 1920, 1080), 1000 / 806)
    assert not crop.zoomed_out
    top, bottom, eyes, cx = _head_in_card(crop, 250, face)
    assert top >= ss.HEAD_MARGIN - 1e-6 and bottom < 0.75  # the whole head, chin and shoulders below
    assert 0.3 < eyes < 0.42 and abs(cx - 0.5) < 0.01  # eyes near the upper third, face centered
    # Never tighter than CARD_FACE_MIN face heights; a speaker far away is brought in to CARD_FACE_MAX, no closer.
    assert ss.CARD_FACE_MIN * 216 - 1 <= crop.h <= ss.CARD_FACE_MAX * 216 + 1
    small = (940.0, 400.0, 40.0, 60.0)
    far = ss.card_crop([(0, small)], (0, 0, 1920, 1080), 1000 / 806)
    assert abs(far.h - ss.CARD_FACE_MAX * 60) < 1


def test_card_crop_zooms_out_instead_of_cutting_a_close_selfie_head():
    # A close selfie (the owner's footage): a 1080x1920 frame, the face 690 px tall near the top.
    face = (330.0, 540.0, 470.0, 690.0)
    crop = ss.card_crop([(t, face) for t in range(0, 3000, 500)], (0, 0, 1080, 1920), 1080 / 838)
    # The card at its shape would be 1080 x 838 inside the frame: far too tight. It zooms out past the frame's sides.
    assert crop.zoomed_out and crop.w > 1080 and abs(crop.h - ss.CARD_FACE_MIN * 690) < 1
    top, bottom, eyes, cx = _head_in_card(crop, 1000, face)
    assert top >= ss.HEAD_MARGIN - 1e-6 and bottom <= 1  # hair allowance to chin inside the card
    x, y = crop.at(1000)
    assert abs(x - (1080 - crop.w) / 2) < 1e-6  # the frame centered in the crop
    # The card narrows to the video's own width at that framing (the backdrop shows either side) ...
    loose = ss.card_crop([(0, (380.0, 700.0, 320.0, 450.0))], (0, 0, 1080, 1920), 1080 / 838, min_share=0.6)
    w = ss.card_width(loose, 1080, 838, 648)
    assert w == int(1080 * 838 / loose.h) // 2 * 2 and 648 < w < 1080
    # ... not under 60% of the frame: this selfie (570 px at 2.3 face heights) comes in to fill 648 px while
    # the head fits ...
    narrow = ss.card_crop([(t, face) for t in range(0, 3000, 500)], (0, 0, 1080, 1920), 1080 / 838, min_share=0.6)
    assert ss.card_width(crop, 1080, 838, 648) == 648 and ss.card_width(narrow, 1080, 838, 648) == 648
    assert abs(narrow.h - 1080 / (0.6 * 1080 / 838)) < 1 and _head_in_card(narrow, 0, face)[0] >= -1e-6
    assert _head_in_card(narrow, 0, face)[1] <= 1
    # ... and only a face too big for that gets a light blur beside the video.
    huge = (290.0, 560.0, 520.0, 800.0)
    tight = ss.card_crop([(0, huge)], (0, 0, 1080, 1920), 1080 / 838, min_share=0.6)
    assert abs(tight.h - ss.CARD_FACE_FLOOR * 800) < 1 and tight.zoomed_out
    chain = ss.card_chain("in", "out", crop, 0, 3000, 1080, 838)
    assert "gblur" in chain and "overlay=x=" in chain and chain.endswith("[out]")
    # A face whose hair allowance just runs off the top: the card shows a thin band above the frame rather than cut
    # it (at most HEAD_MARGIN of the card: a head the source itself cuts stays as filmed).
    high = (330.0, 400.0, 470.0, 690.0)
    up = ss.card_crop([(0, high)], (0, 0, 1080, 1920), 1080 / 838)
    assert -ss.HEAD_MARGIN * up.h - 1e-6 <= up.at(0)[1] < 0 and _head_in_card(up, 0, high)[0] >= -1e-6
    cut = ss.card_crop([(0, (330.0, 100.0, 470.0, 690.0))], (0, 0, 1080, 1920), 1080 / 838)
    assert abs(cut.at(0)[1] + ss.HEAD_MARGIN * cut.h) < 1e-6


def test_card_crop_follows_the_speaker_smoothly_and_never_onto_the_head():
    # He leans and moves: the face drifts 300 px right and 150 px down over 6 s, one jittery sample.
    faces = []
    for k in range(13):
        t = k * 500
        faces.append((t, (600.0 + 25 * k + (60 if k == 5 else 0), 300.0 + 12.5 * k, 150.0, 216.0)))
    crop = ss.card_crop(faces, (0, 0, 1920, 1080), 1000 / 806)
    assert 2 <= len(crop.keys) <= 13
    xs = [crop.at(t)[0] for t in range(0, 6001, 100)]
    assert all(b >= a - 2 for a, b in zip(xs, xs[1:]))  # the jitter is smoothed out: it only moves one way
    for t, face in faces:
        top, bottom, _, _ = _head_in_card(crop, t, face)
        assert top >= -1e-6 and bottom <= 1  # the head never cut, anywhere along the path
    # No face at all: the speaker's area from near its top, at least half of its height.
    none = ss.card_crop([], (0, 0, 1080, 1920), 1080 / 838)
    assert none.h >= 960 and none.at(0)[1] < 100


def test_card_crops_find_the_speaker_per_run_and_map_through_the_cut():
    # The edited clock skips window 2-4 s: run 2.5-4.5 s edited is window 4.5-6.5 s (plus the slide out).
    assert ss.edited_to_window([(2.5, 4.5)], [(0, 2000), (4000, 9000)]) == [(4500, 6500)]
    assert ss.edited_to_window([(1.0, 3.0)], [(0, 2000), (4000, 9000)]) == [(1000, 2000), (4000, 5000)]
    left, right = Box(0.1, 0.2, 0.08, 0.2), Box(0.7, 0.3, 0.08, 0.2)
    plan = ClipLayoutPlan([ShotLayout(0, 9000, LayoutType.TALKING_HEAD)], 1920, 1080,
                          face_samples=[(t, [left]) for t in range(0, 3000, 500)] + [(t, [right]) for t in range(5000, 9000, 500)])
    crops = ss.card_crops(plan, [(0, 9000)], [(0.0, 2.0), (5.0, 8.0)], 0.35, 1000 / 806)
    assert crops[(0, 0)].at(1000)[0] < 0.3 * 1920 < crops[(1, 0)].at(6000)[0]
    # Sparse samples (an editor export's plan has none): the stretches to look in.
    assert ss.card_sample_spans(plan, [(0, 9000)], [(0.0, 2.0), (5.0, 8.0)], 0.35) == []
    bare = ClipLayoutPlan([ShotLayout(0, 9000, LayoutType.TALKING_HEAD)], 1920, 1080)
    assert ss.card_sample_spans(bare, [(0, 9000)], [(0.0, 2.0)], 0.35) == [(0, 2350)]
    # A camera + screen shot: the card frames the webcam's part, not the screen.
    cam = ShotLayout(0, 9000, LayoutType.SCREEN_CAM, cam_box=Box(0.75, 0.7, 0.2, 0.25))
    assert ss.speaker_bounds(cam, 1920, 1080) == (0.75 * 1920, 0.7 * 1080, 0.2 * 1920, 0.25 * 1080)


def test_card_source_graph_switches_crops_between_runs_while_the_card_is_down():
    plan = ClipLayoutPlan([ShotLayout(0, 9000, LayoutType.TALKING_HEAD)], 1920, 1080,
                          face_samples=[(t, [Box(0.1, 0.2, 0.08, 0.2)]) for t in range(0, 3000, 500)]
                          + [(t, [Box(0.7, 0.3, 0.08, 0.2)]) for t in range(5000, 9000, 500)])
    graph, widths = ss.card_source_graph(plan, [(0, 9000)], 1080, 838, "30", [(0.0, 2.0), (5.0, 8.0)], 0.35)
    assert widths == [1080, 1080]
    # One piece per run, split halfway between them (3.5 s = frame 105).
    assert "trim=start_frame=0:end_frame=105[cd_t0]" in graph and "trim=start_frame=105:end_frame=270[cd_t1]" in graph
    assert graph.endswith("[sc_card_frames]") and "concat=n=2" in graph


def test_a_narrow_video_gets_a_narrower_card_centered_with_its_own_mask_and_shadow(tmp_path):
    graph = "[0:v]fps=30[clocked];[clocked]null[base]"
    scenes = [ss.Scene("stage", 0, 2000, "grid", "arch"), ss.Scene("stage", 3000, 5000, "grid", "arch")]
    comp = ss.build_scene_graph(graph, scenes, 1080, 1920, 6000, 1.0, "30", 1, str(tmp_path), "n",
                                card_graph=lambda w, h, runs, transition: ("[sc_card_src]null[sc_card_frames]", [700, 1080]))
    geo = comp.geometry
    # Two cards: the 700 px one centered (x 190), cut from the middle of the frames; the full one as before.
    assert "split=2[sc_card_rgb_arch_1080][sc_card_rgb_arch_700]" in comp.graph
    assert f"crop=700:{geo.arch_h}:190:0" in comp.graph and "overlay=x=190:" in comp.graph and "overlay=x=0:" in comp.graph
    mask = next(p for p in comp.inputs if p.endswith("mask-arch-700.png"))
    assert Image.open(mask).size == (700, geo.arch_h)
    rounded = ss.build_scene_graph(graph, [ss.Scene("stage", 0, 2000)], 1080, 1920, 3000, 1.0, "30", 1, str(tmp_path), "r",
                                   card_graph=lambda w, h, runs, transition: ("[sc_card_src]null[sc_card_frames]", [648]))
    assert f"crop=648:{geo.card_h}:176:0" in rounded.graph and f"overlay=x={40 + (1000 - 648) // 2}:" in rounded.graph


def test_hook_hands_over_to_the_first_stage_scene():
    segments = ss.edited_segments([ss.Scene("stage", 4000, 8000)], 10000, 1.25)
    assert ss.hook_hand_over_s(segments, 1.25) == 5.0
    # A stage in the clip's first seconds: the hook keeps its own time (the graphics keep below it).
    assert ss.hook_hand_over_s(ss.edited_segments([ss.Scene("stage", 1000, 8000)], 10000, 1.0), 1.0) is None
    assert ss.hook_hand_over_s(ss.edited_segments([], 10000, 1.0), 1.0) is None


def test_stage_layout_constants_leave_a_tall_card_and_a_caption_band():
    geo = ss.geometry(1080, 1920)
    # The card: 0.42 of the height (806 px), 32 px off the bottom; the stage ends halfway; captions between.
    assert (geo.card_h, geo.card_y, geo.stage_bottom) == (806, 1082, 960)
    assert geo.card_w / geo.card_h < 1.25 and 1080 / geo.arch_h < 1.3
    assert geo.card_y - geo.stage_bottom >= 120 and geo.stage_bottom < geo.caption_y < geo.card_y


def test_captions_move_to_the_band_and_take_dark_text_on_a_light_backdrop():
    geo = ss.geometry(1080, 1920)
    assert geo.stage_bottom < geo.caption_y < geo.card_y and geo.card_y + geo.card_h < 1920
    assert (geo.card_x, geo.card_w, geo.radius) == (40, 1000, 48)
    segments = ss.edited_segments([ss.Scene("stage", 1000, 3000), ss.Scene("visual", 3000, 4000, "dark")], 6000, 1.0)
    windows = ss.caption_windows(segments, geo)
    assert windows == [(1000, 3000, geo.caption_y, "light"), (3000, 4000, geo.visual_caption_y, "")]
    anchors = ss.scene_anchors([(2000, 5, 1340), (10 ** 9, 2, 1500)], windows)
    assert anchors == [(1000, 5, 1340), (3000, 5, geo.caption_y), (4000, 5, geo.visual_caption_y), (10 ** 9, 2, 1500)]
    placed = ss.scene_placer(lambda *a: (2, 1600), windows)
    assert placed(1500, 1900, 300, 80) == (5, geo.caption_y) and placed(4500, 4900, 300, 80) == (2, 1600)

    from clip_engine.config import CaptionStyle
    def style(**values):
        s = CaptionStyle()
        for key, value in values.items():
            setattr(s, key, value)
        return s
    member = style(highlight_color="#FFE234", glow_color="#FFFFFF", font_name="Montserrat Black")
    light = ss.light_backdrop_style(member)
    assert light.primary_color == ss.DARK_TEXT and light.highlight_color == ss.DARK_ACCENT and light.glow_color is None
    assert light.font_name == "Montserrat Black" and member.primary_color == "#FFFFFF"  # the preset's font; the original untouched
    assert ss.light_backdrop_style(style(highlight_color="#7A1FA2")).highlight_color == "#7A1FA2"

    def event(start, text):
        return f"Dialogue: 0,0:00:0{start}.00,0:00:0{start}.50,Default,,0,0,0,,{text}"
    normal = "\n".join(["[Events]", event(0, "a"), event(1, "b"), event(3, "c")])
    dark = "\n".join(["[Events]", event(0, "A"), event(1, "B"), event(3, "C")])
    merged = ss.splice_caption_events(normal, dark, windows, module.CaptionGeneratorService._parse_ass_time)
    assert [line[-1] for line in merged.split("\n")[1:]] == ["a", "B", "c"]


def test_suggest_scenes_stages_stage_size_graphics_with_padding_and_merging():
    graphics = [
        {"at_ms": 3000, "duration_ms": 2000, "size": "stage"},
        {"at_ms": 5800, "duration_ms": 1500, "size": "stage"},  # close to the first: one stage
        {"at_ms": 12000, "duration_ms": 1000, "size": "card"},  # not stage size
        {"at_ms": 15000, "duration_ms": 1500},  # size missing: not stage
        {"at_ms": 20000, "duration_ms": 500, "size": "stage"},  # short: grown to the minimum
    ]
    # A stage opens STAGE_LAND_MS before its graphic shows (it lands with the face frame's morph into the card).
    assert ss.suggest_scenes(graphics, 24000) == [
        {"scene": "face", "start_ms": 0, "end_ms": 2670},
        {"scene": "stage", "start_ms": 2670, "end_ms": 7300, "backdrop": "light"},
        {"scene": "face", "start_ms": 7300, "end_ms": 19485},
        {"scene": "stage", "start_ms": 19485, "end_ms": 20685, "backdrop": "light"},
        {"scene": "face", "start_ms": 20685, "end_ms": 24000},
    ]
    # Near the ends the stage runs to the clip's edge rather than leave a sliver of face.
    assert ss.suggest_scenes([{"at_ms": 500, "duration_ms": 8000, "size": "stage"}], 9000, "dark") == [
        {"scene": "stage", "start_ms": 0, "end_ms": 9000, "backdrop": "dark"}]
    assert ss.suggest_scenes([], 5000) == [{"scene": "face", "start_ms": 0, "end_ms": 5000}]
    # What it returns is a valid request.
    assert ss.parse_scenes(ss.suggest_scenes(graphics, 24000))


def test_a_stage_opens_with_its_graphics_first_element_never_empty():
    # A flowchart whose first step is cued 250 ms in: the stage opens so that step lands with the card.
    flow = {"at_ms": 24364, "duration_ms": 4240, "size": "stage", "template": "fx",
            "fields": {"effect": "flowchart", "steps": "a\nb", "cue_ms": "250\n1420\n3740"}}
    assert ss.first_element_ms(flow) == 150
    assert ss.stage_open_ms(flow) == 24364 + 150 - ss.STAGE_LAND_MS
    scenes = ss.suggest_scenes([flow], 40000)
    stage = next(s for s in scenes if s["scene"] == "stage")
    # The morph into the card takes MORPH_FRAMES output frames: the first step starts entering by the time it lands.
    land = stage["start_ms"] + ss.MORPH_FRAMES * 1000 / 30
    assert stage["start_ms"] < 24364 + 150 <= land
    # A title shows first; items and words time their own first element; nothing timed shows at once.
    assert ss.first_element_ms({**flow, "fields": {**flow["fields"], "title": "The loop"}}) == 0
    assert ss.first_element_ms({"at_ms": 0, "duration_ms": 3000, "fields": {"item_ms": "400\n900"}}) == 400
    assert ss.first_element_ms({"at_ms": 0, "duration_ms": 3000, "fields": {}}) == 0
    # A diagram's Visual scene opens the same way (auto_graphics.stage_scenes_for).
    from clip_engine.services import auto_graphics as ag
    diagram = {"at_ms": 10000, "duration_ms": 4000, "size": "stage", "template": "staircase", "fields": {"item_ms": "600\n1400"}}
    assert set(ss.DRAWN_AT_ONCE) == set(ag.DIAGRAMS)  # a diagram draws its frame at once
    visual = ag.stage_scenes_for([diagram], 0, 30000)
    assert visual == [{"scene": "visual", "start_ms": 10000 - ss.STAGE_LAND_MS, "end_ms": 14000, "backdrop": "solid"}]


def test_a_bad_scenes_request_is_refused_before_rendering(tmp_path):
    request = RenderRequest("in.mp4", str(tmp_path / "o.mp4"), 0, 1000, 64, 64, scenes=[{"scene": "zoom", "start_ms": 0, "end_ms": 900}])
    with pytest.raises(ValueError):
        asyncio.run(RenderingService().render_clip(request))


def _mean(path, at, box):
    x, y, w, h = box
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{at:.3f}", "-i", path, "-frames:v", "1", "-vf", f"crop={w}:{h}:{x}:{y}",
                          "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=120).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, 3).mean(axis=0)


def test_render_switches_scenes_on_the_output_clock_with_a_cut_and_speed(tmp_path, monkeypatch):
    """Face → stage → visual (dark) → face, on a clip with a cut at 1.25x, in one FFmpeg pass."""
    monkeypatch.setattr(module, "get_output_dimensions", lambda *_: (180, 320))
    source = tmp_path / "red.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=0xd02020:s=320x180:d=10:r=30",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=10",
                    "-c:v", "mpeg4", "-q:v", "2", "-c:a", "aac", "-shortest", str(source)], check=True, timeout=120)
    ranges = [(0, 2000), (3000, 8000)]  # 7 s of source at 1.25x: 5.6 s long
    c = {"ranges": [list(r) for r in ranges], "scenes": [{"at_ms": 0, "layout": "fill", "crops": [[0.34, 0, 0.32, 1.0]]}]}
    scenes = [{"scene": "stage", "start_ms": 1000, "end_ms": 2600}, {"scene": "visual", "start_ms": 2600, "end_ms": 4000, "backdrop": "dark"}]
    service = RenderingService()
    service._video_codec_args = lambda *args: ["-c:v", "mpeg4", "-q:v", "2"]
    request = RenderRequest(str(source), str(tmp_path / "clip.mp4"), 0, 8000, 320, 180, include_captions=False, include_title=False,
                            apply_padding=False, pacing="natural", video_speed=1.25, manual_ranges_ms=ranges,
                            manual_plan=manual_plan({"width": 320, "height": 180}, c), scenes=scenes)
    result = asyncio.run(service.render_clip(request))
    assert abs(result.duration_ms - 5600) < 50
    top, card = (20, 20, 140, 80), (60, 250, 60, 40)
    red = lambda rgb: rgb[0] > 150 and rgb[1] < 90  # noqa: E731
    # Face: the framed video everywhere.
    assert red(_mean(result.output_path, 0.5, top)) and red(_mean(result.output_path, 0.5, card))
    # Stage: light backdrop above, the speaker card below.
    assert _mean(result.output_path, 1.9, top).min() > 200 and red(_mean(result.output_path, 1.9, card))
    # Visual on the dark backdrop: no card.
    assert _mean(result.output_path, 3.4, top).max() < 90 and _mean(result.output_path, 3.4, card).max() < 70
    # Face again after the crossfade.
    assert red(_mean(result.output_path, 4.8, top)) and red(_mean(result.output_path, 4.8, card))
    # Mid-morph (just after the stage starts) the face frame has shrunk most of the way into the card: backdrop above.
    assert _mean(result.output_path, 1.15, top).min() > 200 and red(_mean(result.output_path, 1.15, card))
    # No frame across the changes in or out is a blend of the speaker and the stage (a dissolve's washed-out double
    # image): every pixel is either the speaker (red) or the backdrop / the dark visual, bar the card's soft edge.
    for at in (0.95, 3.95):
        frames = _frames(result.output_path, at, 0.5)
        assert len(frames) >= 12
        for rgb in frames:
            r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
            speaker = (r > 160) & (g < 80)
            light = (r > 200) & (g > 200) & (b > 200)
            dark = (r < 70) & (g < 70) & (b < 80)
            mixed = ~(speaker | light | dark)
            assert mixed.mean() < 0.06, mixed.mean()
            if at < 2:
                # Into the stage: the speaker never leaves the card's place for a frame (no empty stage between the
                # morph and the card).
                assert speaker[250:290, 60:120].mean() > 0.9
    # The still inputs were cleaned up.
    assert not [name for name in os.listdir(tmp_path) if name.startswith("scene-")]


def _frames(path, at, seconds):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{at:.3f}", "-t", f"{seconds:.3f}", "-i", path, "-pix_fmt", "rgb24",
                          "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=120).stdout
    return list(np.frombuffer(raw, np.uint8).reshape(-1, 320, 180, 3))


@pytest.mark.parametrize("into,face_share", [(True, 3), (False, 3), (True, 9)])
def test_each_morph_frame_is_the_face_frame_cut_to_that_frames_card_rectangle(into, face_share):
    """Frame by frame, the morph shows the face frame exactly inside its step's rectangle (no gap, no stale frame, no
    half-transparent first frame) and the backdrop outside it, decelerating toward the card (or the full frame)."""
    W, H = 180, 320
    geo = ss.geometry(W, H)
    rect = (geo.card_x, geo.card_y, geo.card_w, geo.card_h)
    # face_share 9: the card shows the face small (a close selfie zoomed out): the frame lands narrower than the card,
    # a blurred copy of it (never black) at its sides.
    steps = ss.morph_steps(into, W, H, (70, 80, 40, 50), geo.card_h / face_share, rect, geo.radius, ss.MORPH_FRAMES)
    if face_share == 9:
        assert steps[-1].scale_w < geo.card_w
    m = ss.Morph(1.0, ss.MORPH_FRAMES / 30, into, "card")
    graph = ("color=c=0xd02020:s=180x320:r=30:d=3[src];color=c=white:s=180x320:r=30:d=3[bg];[src]split[f][x];"
             "[bg][x]overlay=enable=0[u];" + ss.morph_chain("f", "u", "o", 0, m, steps, "30", W, H))
    raw = subprocess.run(["ffmpeg", "-v", "error", "-filter_complex", graph, "-map", "[o]", "-ss", "1.0", "-frames:v", str(ss.MORPH_FRAMES),
                          "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=120).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
    assert len(frames) == ss.MORPH_FRAMES
    areas = []
    for rgb, st in zip(frames, steps):
        x, y, w, h = st.rect
        r, g = rgb[..., 0].astype(int), rgb[..., 1].astype(int)
        red = (r > 160) & (g < 90)
        e = 2 * ss.MORPH_MASK_DIV  # the mask is drawn at a quarter size and scaled up: a soft edge this wide
        inner = red[y + e:y + h - e, x + e:x + w - e]
        assert inner.mean() > 0.98, (st.rect, inner.mean())
        outside = np.ones_like(red); outside[max(0, y - e):y + h + e, max(0, x - e):x + w + e] = False
        if outside.any():
            assert (rgb[outside] > 235).all(axis=-1).mean() > 0.99
        areas.append(w * h)
    # Decelerating: the rectangle changes most at the start of the move and least at its end.
    deltas = [abs(b - a) for a, b in zip(areas, areas[1:])]
    assert deltas[0] > deltas[-1] * 3
