"""The Explainer style: the paper backdrop, the speaker cut out with no card (the rounded card where the cut-out isn't
good), the captions at the top in the paper look, and the page laid out around a reel's filmed screens."""

import asyncio
import os
import shutil

import numpy as np
import pytest

from clip_engine.services import edit_direction as ed
from clip_engine.services import segmentation
from clip_engine.services import stage_scenes as ss
from clip_engine.config import get_caption_preset
from clip_engine.services.layout_analyzer import Box, ClipLayoutPlan, LayoutType, ShotLayout


def _plan(face=Box(0.45, 0.28, 0.104, 0.185)):
    return ClipLayoutPlan([ShotLayout(0, 6000, LayoutType.TALKING_HEAD, people=[face])], 1920, 1080,
                          face_samples=[(t, [face]) for t in range(0, 6000, 500)])


def test_paper_and_cutout_parse_and_the_captions_go_to_the_top_in_the_paper_look():
    scenes = ss.parse_scenes([{"scene": "stage", "start_ms": 0, "end_ms": 4000, "backdrop": "paper", "card": "cutout", "transition": "slide"}])
    assert scenes[0].backdrop == "paper" and scenes[0].card == "cutout"
    segments = ss.edited_segments(scenes, 6000, 1.0)
    geo = ss.geometry(1080, 1920)
    windows = ss.caption_windows(segments, geo, [(0.0, 4.0)])
    # The top of the frame, not on the card (even where the matte made the cut-out: the head isn't "escaping" there).
    assert windows == [(0, 4000, round(1920 * ss.EXPLAINER_CAPTION_Y), "paper")]
    style = ss.paper_backdrop_style(get_caption_preset("pop"))
    assert style.primary_color == ss.EXPLAINER_INK and style.uppercase is False and style.future_words == "hide"
    assert style.accent_font and style.emphasis_color == ss.EXPLAINER_ACCENT and style.outline_width == 0
    # A brand color that reads on paper becomes the accent; a pale one doesn't.
    assert ss.paper_backdrop_style(get_caption_preset("pop"), "#1D4ED8").emphasis_color == "#1D4ED8"
    assert ss.paper_backdrop_style(get_caption_preset("pop"), "#FDE68A").emphasis_color == ss.EXPLAINER_ACCENT
    assert ss.caption_mode("paper") == "paper" and ss.is_light("paper")


def test_saved_scenes_keep_paper_and_cutout():
    from clip_engine.services import auto_graphics as ag
    kept = ag.checked_saved_scenes([{"scene": "stage", "start_ms": 0, "end_ms": 5000, "backdrop": "paper", "card": "cutout"}], 10000)
    assert kept == [{"scene": "stage", "start_ms": 0, "end_ms": 5000, "backdrop": "paper", "card": "cutout"}]


def test_the_cutout_stands_on_the_backdrop_where_the_matte_is_good_else_the_rounded_card(tmp_path):
    plan = _plan()
    graph = "[0:v]fps=30[clocked];[clocked]null[base]"
    asked = []

    def matte(spans, good=True):
        asked.append(spans)
        path = tmp_path / "m.mkv"
        path.write_bytes(b"x")
        return str(path), [good] * len(spans)

    card = lambda w, h, runs, transition, escape=None: ss.card_source_graph(plan, [(0, 6000)], w, h, "30", runs, transition, escape=escape)  # noqa: E731
    scenes = [ss.Scene("stage", 0, 6000, backdrop="paper", card="cutout", escape=False, transition="slide")]
    comp = ss.build_scene_graph(graph, scenes, 1080, 1920, 6000, 1.0, "30", 1, str(tmp_path), "t", card_graph=card,
                                escape_matte=matte, matte_size=(960, 540))
    # The matte is made even with the escape off (the cut-out needs it), and the speaker is laid on the paper: no mask, no shadow.
    assert asked and comp.escaped == [True]
    assert "[sc_cutout_cut_" in comp.graph and "alphamerge[sc_esc_full]" in comp.graph
    assert not any("mask" in os.path.basename(p) or "shadow" in os.path.basename(p) for p in comp.inputs)
    assert any("backdrop" in os.path.basename(p) for p in comp.inputs)
    # A poor matte: the rounded card instead (mask and shadow), no cut-out.
    comp = ss.build_scene_graph(graph, scenes, 1080, 1920, 6000, 1.0, "30", 1, str(tmp_path), "u", card_graph=card,
                                escape_matte=lambda spans: matte(spans, False), matte_size=(960, 540))
    assert "sc_cutout" not in comp.graph and any("mask" in os.path.basename(p) for p in comp.inputs)


def test_the_page_is_laid_around_filmed_screens_and_a_section_gives_way_to_one():
    section = {'id': 'g-sect01', 'template': 'custom', 'at_ms': 1000, 'duration_ms': 20000, 'placement': 'top', 'size': 'stage',
               'fields': {'comp': 'a' * 16, 'scene': 'explainer'}, 'origin': 'member'}
    early = {**section, 'id': 'g-sect02', 'at_ms': 30000, 'duration_ms': 10000}
    card = {'id': 'g-card01', 'template': 'stat', 'at_ms': 50000, 'duration_ms': 3000, 'placement': 'top', 'fields': {'value': '$5'}, 'origin': 'auto'}
    graphics, scenes = ed.explainer_layout([section, early, card], 60000, [(15000, 24000), (31000, 36000)])
    by = {g['id']: g for g in graphics}
    # Most of the first section plays before the screen: cut short there. The second starts into one: left out.
    assert by['g-sect01']['duration_ms'] == 15000 - ed.CUT_PAD_MS - 1000 and 'g-sect02' not in by and 'g-card01' in by
    assert [(s['start_ms'], s['end_ms']) for s in scenes] == [(0, 15000 - ed.CUT_PAD_MS), (24000 + ed.CUT_PAD_MS, 31000 - ed.CUT_PAD_MS), (36000 + ed.CUT_PAD_MS, 60000)]
    assert all(s['backdrop'] == 'paper' and s['card'] == 'cutout' and s['scene'] == 'stage' for s in scenes)


def test_an_explainer_project_has_no_hook_text():
    from types import SimpleNamespace
    look = SimpleNamespace(headline='You do not need an audience', headline_look={'look': 'floating', 'color': '#FFFFFF', 'font': 'serif'},
                           include_captions=True, caption_preset='pop', look_extras=(), look_extras_keyword='')
    from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord
    segs = [TranscriptSegment(0, 2000, 'You do not', words=[TranscriptWord('You', 0, 300), TranscriptWord('do', 300, 600), TranscriptWord('not', 600, 900)])]
    plain = ed.edit_project('T', 4000, segs, look, [], [], None, 'a' * 32, directed=True)
    explained = ed.edit_project('T', 4000, segs, look, [], [{'scene': 'stage', 'start_ms': 0, 'end_ms': 4000, 'backdrop': 'paper', 'card': 'cutout'}],
                                None, 'a' * 32, directed=True, explainer=True)
    assert plain['candidates'][0]['hook'] and explained['candidates'][0]['hook'] is None
    assert explained['candidates'][0]['stage_scenes'][0]['card'] == 'cutout'


@pytest.mark.skipif(not shutil.which("ffmpeg") or not segmentation.available(), reason="needs FFmpeg and the cut-out model")
def test_an_explainer_page_on_a_real_person(tmp_path):
    """The portrait fixture on the paper page: the speaker cut out (no card edge, the paper all around them) and the
    captions at the top in dark ink."""
    from test_depth_render import H, W, frame, person_video, words
    from clip_engine.services.manual_editor import manual_plan
    from clip_engine.services.rendering_service import RenderingService, RenderRequest
    source = str(tmp_path / "person.mp4")
    person_video(source, 6.0)
    c = {"ranges": [[0, 6000]], "scenes": [{"at_ms": 0, "layout": "fill", "crops": [[0, 0, 1.0, 1.0]]}]}
    request = RenderRequest(source, str(tmp_path / "clip.mp4"), 0, 6000, 720, 1280, include_captions=True, include_title=False,
                            apply_padding=False, pacing="natural", video_speed=1.0, manual_ranges_ms=[(0, 6000)],
                            manual_plan=manual_plan({"width": 720, "height": 1280}, c), transcript_segments=words(),
                            caption_style=get_caption_preset("pop"),
                            scenes=[{"scene": "stage", "start_ms": 0, "end_ms": 6000, "backdrop": "paper", "card": "cutout", "transition": "slide"}])
    result = asyncio.run(RenderingService().render_clip(request))
    assert result.escaped_runs == 1
    img = frame(result.output_path, 2.4)
    g = ss.geometry(W, H)
    paper = np.array([0xF0, 0xEC, 0xE3])
    # Where the rounded card's corners and edges would be: paper (no card), and the frame's middle top is paper too.
    for y, x in ((g.card_y + 12, g.card_x + 12), (g.card_y + 12, g.card_x + g.card_w - 14), (H - 40, g.card_x + 20)):
        assert np.abs(img[y - 6:y + 6, x - 6:x + 6].reshape(-1, 3).mean(axis=0) - paper).sum() < 45, (y, x, img[y, x])
    assert np.abs(img[int(0.35 * H), 40:120].reshape(-1, 3).mean(axis=0) - paper).sum() < 45
    # The speaker: in the card's middle, not paper.
    middle = img[g.card_y + g.card_h // 2 - 40:g.card_y + g.card_h // 2 + 40, W // 2 - 40:W // 2 + 40].reshape(-1, 3).mean(axis=0)
    assert np.abs(middle - paper).sum() > 120
    # The captions near the top in dark ink.
    band = img[int(0.07 * H):int(0.17 * H), 60:W - 60]
    assert (band.max(axis=2) < 80).sum() > 600
    if os.environ.get("EXPLAINER_SHEET"):
        from PIL import Image
        Image.fromarray(img).save(os.environ["EXPLAINER_SHEET"])
