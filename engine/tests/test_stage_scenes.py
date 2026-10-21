"""Scenes: face / stage / visual layout switching on 9:16 clips (stage_scenes + the render)."""

import asyncio
import os
import re
import subprocess

import numpy as np
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
    windows = ss.backdrop_windows(segments, 0.4375)
    assert [(w["backdrop"], w["start"], round(w["end"], 4), w["fade_in"], w["fade_out"]) for w in windows] == [
        ("light", 2.5, 5.4375, True, False), ("dark", 5.0, 7.9375, True, True)]


@pytest.mark.parametrize("kind", ["stage", "visual"])
def test_scene_graph_builds_for_each_scene(tmp_path, kind):
    scenes = [ss.Scene(kind, 1000, 3000, "light")]
    comp = ss.build_scene_graph(GRAPH, scenes, 1080, 1920, 5000, 1.0, "30", 2, str(tmp_path), "t")
    assert comp.graph.count("[base]") == 1 and comp.graph.endswith("[base]")
    # The backdrop fades in at the scene start and out (the next scene is face) over 350 ms.
    assert "fade=t=in:st=1.0000:d=0.3500:alpha=1" in comp.graph and "fade=t=out:st=3.0000:d=0.3500:alpha=1" in comp.graph
    assert "[2:v]" in comp.graph
    if kind == "stage":
        assert len(comp.inputs) == 3  # backdrop, card mask, card shadow
        assert "alphamerge" in comp.graph and "[3:v]format=gray" in comp.graph
        assert "clip((t-1.0000)/0.3500,0,1)" in comp.graph and "clip((t-3.0000)/0.3500,0,1)" in comp.graph
        assert "enable='between(t,1.0000,3.3500)'" in comp.graph
    else:
        assert len(comp.inputs) == 1 and "alphamerge" not in comp.graph
    for path in comp.inputs:
        assert os.path.isfile(path)
    # All face: nothing to draw.
    assert ss.build_scene_graph(GRAPH, [], 1080, 1920, 5000, 1.0, "30", 1, str(tmp_path), "t") is None


def test_scene_graph_at_speed_and_a_backdrop_change(tmp_path):
    scenes = [ss.Scene("stage", 0, 2000, "light"), ss.Scene("visual", 2000, 4000, "dark")]
    comp = ss.build_scene_graph(GRAPH, scenes, 1080, 1920, 6000, 1.25, "30", 1, str(tmp_path), "t")
    # A scene at the clip start is up from the first frame (no fade, no slide).
    assert "fade=t=in:st=0.0000" not in comp.graph and "(1-" in comp.graph
    # Light → dark at output 2.0 s = edited 2.5 s; the transition is 350 ms of output (0.4375 s edited).
    assert "fade=t=in:st=2.5000:d=0.4375:alpha=1" in comp.graph
    assert "between(t,0.0000,2.9375)" in comp.graph  # light held until the dark one is fully in
    assert "clip((t-2.5000)/0.4375,0,1)" in comp.graph  # the card slides down as visual starts


def test_card_frames_come_from_their_own_framing_when_the_graph_reads_the_source(tmp_path):
    plan = ClipLayoutPlan([ShotLayout(0, 4000, LayoutType.TALKING_HEAD, people=[Box(0.45, 0.2, 0.1, 0.2)])], 1920, 1080)
    card = ss.card_plan(plan, 1080, 1920, 1000, 768)
    x, y, w, h = card.shots[0].manual_crops[0]
    assert abs(w * 1920 / (h * 1080) - 1000 / 768) < 0.01  # the card's shape
    assert x < 0.5 < x + w and y < 0.3 < y + h  # around the face
    graph = "[0:v]fps=30[clocked];[clocked]null[base]"
    comp = ss.build_scene_graph(graph, [ss.Scene("stage", 0, 2000)], 1080, 1920, 4000, 1.0, "30", 1, str(tmp_path), "t",
                                card_graph=lambda w, h: ss.card_source_graph(plan, [(0, 4000)], 1080, 1920, w, h, "30", 1.0))
    assert comp.graph.startswith("[0:v]split=2[sc_v0][sc_card_src];[sc_v0]fps=30")
    assert "[sc_card_frames]format=yuva420p" in comp.graph and "[sc_src]" not in comp.graph
    labels = re.findall(r"\[([A-Za-z_][A-Za-z0-9_]*)\]", comp.graph)
    assert labels.count("base") == 1 and labels.count("clocked") == 2 and labels.count("cd_clocked") == 2


def test_captions_move_to_the_band_and_take_dark_text_on_a_light_backdrop():
    geo = ss.geometry(1080, 1920)
    assert geo.stage_bottom < geo.caption_y < geo.card_y and geo.card_y + geo.card_h < 1920
    assert (geo.card_x, geo.card_w, geo.radius) == (40, 1000, 48)
    segments = ss.edited_segments([ss.Scene("stage", 1000, 3000), ss.Scene("visual", 3000, 4000, "dark")], 6000, 1.0)
    windows = ss.caption_windows(segments, geo)
    assert windows == [(1000, 3000, geo.caption_y, True), (3000, 4000, geo.visual_caption_y, False)]
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
    assert ss.suggest_scenes(graphics, 24000) == [
        {"scene": "face", "start_ms": 0, "end_ms": 2600},
        {"scene": "stage", "start_ms": 2600, "end_ms": 7600, "backdrop": "light"},
        {"scene": "face", "start_ms": 7600, "end_ms": 19600},
        {"scene": "stage", "start_ms": 19600, "end_ms": 20800, "backdrop": "light"},
        {"scene": "face", "start_ms": 20800, "end_ms": 24000},
    ]
    # Near the ends the stage runs to the clip's edge rather than leave a sliver of face.
    assert ss.suggest_scenes([{"at_ms": 500, "duration_ms": 8000, "size": "stage"}], 9000, "dark") == [
        {"scene": "stage", "start_ms": 0, "end_ms": 9000, "backdrop": "dark"}]
    assert ss.suggest_scenes([], 5000) == [{"scene": "face", "start_ms": 0, "end_ms": 5000}]
    # What it returns is a valid request.
    assert ss.parse_scenes(ss.suggest_scenes(graphics, 24000))


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
    # Mid-slide (just after the stage starts), the card is still below its resting place.
    assert not red(_mean(result.output_path, 1.15, (60, 200, 60, 10))) and red(_mean(result.output_path, 1.9, (60, 200, 60, 10)))
    # The still inputs were cleaned up.
    assert not [name for name in os.listdir(tmp_path) if name.startswith("scene-")]
