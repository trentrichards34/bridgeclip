"""Clip Editor: split size per scene, hook text per candidate, and the call to action id."""
import asyncio
import copy
import json
import shutil
import subprocess
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import numpy as np
import pytest

from clip_engine.services.intelligence_planner import ClipPlanSegment
from clip_engine.services.layout_renderer import caption_anchor, shot_views, stacked_panel_heights
from clip_engine.services.manual_editor import (
    manual_plan, parse_hook, prepare_project, run_editor, run_hook, validate_candidate,
)
from clip_engine.services.rendering_service import RenderResult, RenderingService
from tests.test_coherence_review import reviewer, transcript

HOOK = {'text': 'She quit her job to build this', 'look': {'look': 'brand', 'color': '#2563EB', 'font': 'serif'}}


def split_crops(share, w=1920, h=1080):
    """Top and bottom crops at their panels' aspect (as the app keeps them)."""
    crops = []
    for i, panel_h in enumerate([1920 * share, 1920 * (1 - share)]):
        aspect = 1080 / panel_h
        cw = min(.5, h * aspect / w)
        ch = cw * w / aspect / h
        crops.append([0 if i == 0 else .5, (1 - ch) / 2, cw, ch])
    return crops


def candidate(**extra):
    return {'id': 'candidate-1', 'title': 'The result', 'ranges': [[1000, 5000]],
            'scenes': [{'at_ms': 0, 'layout': 'fill', 'crops': [[.1, 0, .31640625, 1]]},
                       {'at_ms': 3000, 'layout': 'split', 'crops': split_crops(.35), 'split': .35}],
            'captions': True, 'caption_preset': 'pop', 'video_speed': 1, 'score': .8, 'reason': '', 'review': None,
            'exports': [], **extra}


class TestSplitContract:
    @pytest.mark.parametrize('split', [.3, .35, .5, .65, .7, 0.42, None])
    def test_valid_split_sizes(self, split):
        c = candidate()
        c['scenes'][1]['split'] = split
        validate_candidate(c, 12000)

    def test_absent_split_is_even(self):
        c = candidate()
        del c['scenes'][1]['split']
        validate_candidate(c, 12000)
        shot = manual_plan({'width': 1920, 'height': 1080}, c).shots[-1]
        assert shot.manual_split == .5 and stacked_panel_heights(shot, 1080, 1920) == (960, 960)

    @pytest.mark.parametrize('split', [.29, .71, 0, 1, -0.5, '0.5', True, float('nan'), float('inf'), [], {}])
    def test_invalid_split_sizes(self, split):
        c = candidate()
        c['scenes'][1]['split'] = split
        with pytest.raises(ValueError, match='split'):
            validate_candidate(c, 12000)

    def test_split_on_other_layouts_is_ignored(self):
        c = candidate()
        c['scenes'][0]['split'] = 'junk'
        validate_candidate(c, 12000)
        assert manual_plan({'width': 1920, 'height': 1080}, c).shots[0].manual_split is None

    def test_movement_needs_the_same_split(self):
        c = candidate()
        c['scenes'].append({'at_ms': 4000, 'layout': 'split', 'crops': split_crops(.5), 'transition_ms': 500})
        with pytest.raises(ValueError, match='movement'):
            validate_candidate(c, 12000)
        c['scenes'][-1].update(split=.35, crops=split_crops(.35))
        validate_candidate(c, 12000)
        shots = manual_plan({'width': 1920, 'height': 1080}, c).shots
        assert [s.manual_split for s in shots] == [None, .35, .35, .35]
        # Two even splits (absent and 0.5) may move between each other.
        c['scenes'][1].pop('split'); c['scenes'][-1]['split'] = .5
        validate_candidate(c, 12000)

    @pytest.mark.parametrize('share,top', [(.35, 672), (.65, 1248), (.3, 576), (.7, 1344)])
    def test_split_moves_the_panels_and_the_caption_seam(self, share, top):
        c = candidate()
        c['scenes'][1].update(split=share, crops=split_crops(share))
        shot = manual_plan({'width': 1920, 'height': 1080}, c).shots[-1]
        views = shot_views(shot, 3500, 1920, 1080, 1080, 1920)
        assert [dest for _, dest in views] == [(0, 0, 1080, top), (0, top, 1080, 1920 - top)]
        for (x, y, w, h), (_, _, pw, ph) in views:
            assert w / h == pytest.approx(pw / ph, rel=.02)  # no stretching
        assert caption_anchor(shot, 1920, 1080, 1080, 1920) == (5, top)


class TestHookContract:
    @pytest.mark.parametrize('hook', [None, HOOK, {'text': '  Two   words\n', 'look': {'look': 'none', 'color': '#ffffff', 'font': 'clean'}},
                                      {'text': 'x' * 200, 'look': {}}, {'text': '😀' * 100, 'look': {'look': 'floating'}}])
    def test_valid_hooks(self, hook):
        validate_candidate(candidate(hook=hook), 12000)

    def test_hook_is_normalized(self):
        assert parse_hook({'text': '  Two   words\n', 'look': {'look': 'black', 'color': '#abcdef', 'font': 'condensed'}}) == \
            {'text': 'Two words', 'look': {'look': 'black', 'color': '#ABCDEF', 'font': 'condensed'}}
        assert parse_hook({'text': 'Hi there', 'look': {}}) == {'text': 'Hi there', 'look': {'look': 'white', 'color': '#FFFFFF', 'font': 'clean'}}

    @pytest.mark.parametrize('hook', [
        {}, 'text', 5, [], {'text': '', 'look': {}}, {'text': '   ', 'look': {}}, {'text': 'x' * 201, 'look': {}},
        {'text': '😀' * 101, 'look': {}}, {'text': 7, 'look': {}}, {'text': 'Fine text'}, {'text': 'Fine text', 'look': None},
        {'text': 'Fine text', 'look': {'look': 'pink'}}, {'text': 'Fine text', 'look': {'color': 'blue'}},
        {'text': 'Fine text', 'look': {'font': 'comic'}}, {'text': 'Fine text', 'look': {'look': 'white', 'extra': 1}},
        {'text': 'Fine text', 'look': {}, 'extra': True}, {'text': 'bad\x00text', 'look': {}},
    ])
    def test_invalid_hooks(self, hook):
        with pytest.raises(ValueError):
            validate_candidate(candidate(hook=hook), 12000)

    @pytest.mark.parametrize('cta', [None, '0123456789abcdef'])
    def test_valid_call_to_action(self, cta):
        validate_candidate(candidate(cta_id=cta), 12000)

    @pytest.mark.parametrize('cta', ['0123456789ABCDEF', '0123456789abcde', '0123456789abcdef0', 5, True, {}])
    def test_invalid_call_to_action(self, cta):
        with pytest.raises(ValueError, match='call to action'):
            validate_candidate(candidate(cta_id=cta), 12000)

    def test_old_project_without_new_fields_still_loads(self):
        c = candidate()
        c['scenes'][1].pop('split')
        validate_candidate(c, 12000)


def make_request(**extra):
    return SimpleNamespace(**{'aspect_ratio': '9:16', 'layout_style': 'fit', 'include_captions': True, 'caption_preset': 'pop',
                              'video_speed': 1, 'title_style': 'headline', 'include_title': True,
                              'headline_look': {'look': 'black', 'color': '#FFFFFF', 'font': 'condensed'}, **extra})


class TestRunHook:
    def test_headline_runs_fill_the_hook(self, tmp_path):
        gate, _ = reviewer(lambda state, q: True)
        source = tmp_path / 'original.mov'
        source.write_bytes(b'source')
        out = tmp_path / 'run'; out.mkdir()
        async def preview(src, dest, **kwargs): Path(dest).write_bytes(b'preview')
        renderer = SimpleNamespace(_get_video_dimensions=AsyncMock(return_value=(1920, 1080)),
                                   capture_framing_source=AsyncMock(side_effect=preview))
        segments = [ClipPlanSegment(0, 5000, .9, summary='First', headline='A mechanic tried to humble Brez'),
                    ClipPlanSegment(6000, 11000, .7, summary='The second title')]
        project = asyncio.run(prepare_project(make_request(), segments, transcript(), SimpleNamespace(video_path=str(source),
            metadata=SimpleNamespace(title='Original', duration_seconds=12)), renderer, gate, str(out), lambda *_: None))
        look = {'look': 'black', 'color': '#FFFFFF', 'font': 'condensed'}
        assert [c['hook'] for c in project['candidates']] == [
            {'text': 'A mechanic tried to humble Brez', 'look': look}, {'text': 'The second title', 'look': look}]
        for c in project['candidates']:
            validate_candidate(c, 12000)

    @pytest.mark.parametrize('extra', [{'title_style': 'card'}, {'include_title': False}, {'aspect_ratio': '16:9'},
                                       {'background_video_path': '/videos/gameplay.mp4'}])
    def test_runs_without_a_hook_get_none(self, extra):
        assert run_hook(make_request(**extra), ClipPlanSegment(0, 5000, .9, summary='T', headline='A headline')) is None

    def test_no_hook_text_runs_keep_the_words_with_look_none(self):
        hook = run_hook(make_request(headline_look={'look': 'none'}), ClipPlanSegment(0, 5000, .9, headline='Words  here'))
        assert hook == {'text': 'Words here', 'look': {'look': 'none', 'color': '#FFFFFF', 'font': 'clean'}}
        assert run_hook(make_request(headline_look=None), ClipPlanSegment(0, 5000, .9, headline='Hi you'))['look']['look'] == 'white'


def export_requests(tmp_path, monkeypatch, c):
    project = {'version': 1, 'revision': 0, 'width': 1920, 'height': 1080, 'duration_ms': 12000, 'aspect_ratio': '9:16',
               'candidates': [{**c, 'status': 'ready'}], 'transcript': [asdict(s) for s in transcript()]}
    (tmp_path / 'editor-project.json').write_text(json.dumps(project))
    (tmp_path / 'editor-source.mp4').write_bytes(b'original')
    (tmp_path / 'transcript.json').write_text(json.dumps({'segments': [asdict(s) for s in transcript()]}))
    (tmp_path / 'job_output.json').write_text(json.dumps({'clips': [], 'total_clips': 0, 'editor_project': True}))
    monkeypatch.setattr(RenderingService, '_verify_ffmpeg', lambda _: None)
    requests = []
    async def render(self, request):
        requests.append(request)
        Path(request.output_path).write_bytes(b'clip')
        return RenderResult(request.output_path, 4, 4000)
    monkeypatch.setattr(RenderingService, 'render_clip', render)
    asyncio.run(run_editor({'run': str(tmp_path), 'revision': 0, 'candidate_id': c['id'], 'action': 'export'}))
    saved = json.loads((tmp_path / 'editor-project.json').read_text())['candidates'][0]
    return requests[0], saved


def test_export_draws_the_candidates_hook(tmp_path, monkeypatch):
    request, saved = export_requests(tmp_path, monkeypatch, candidate(hook=HOOK, cta_id='0123456789abcdef'))
    assert (request.title_style, request.headline_text, request.headline_look) == ('headline', HOOK['text'], HOOK['look'])
    assert all(s.manual_cover for s in request.manual_plan.shots)
    assert saved['hook'] == HOOK and saved['cta_id'] == '0123456789abcdef'


@pytest.mark.parametrize('extra', [{'hook': None}, {}])
def test_export_without_a_hook_draws_none(tmp_path, monkeypatch, extra):
    # Null removes it; an older project without the field has no recorded original.
    request, saved = export_requests(tmp_path, monkeypatch, candidate(**extra))
    assert request.title_style == 'card' and request.headline_text is None and request.title_text is None
    assert ('hook' in saved) == ('hook' in extra)


def test_export_with_look_none_draws_nothing(tmp_path, monkeypatch):
    hook = {'text': 'Hidden words', 'look': {'look': 'none', 'color': '#FFFFFF', 'font': 'clean'}}
    request, _ = export_requests(tmp_path, monkeypatch, candidate(hook=hook))
    assert request.title_style == 'headline' and request.headline_look['look'] == 'none'


# ------------------------------------------------------------------
# Real renders (frames are also written for review when FRAMES_DIR is set)
# ------------------------------------------------------------------

LEFT, RIGHT = (220, 40, 40), (40, 60, 220)


def source_video(path):
    """960x540, 2 s: red left half, blue right half, each with a white stripe."""
    frames = np.zeros((20, 540, 960, 3), np.uint8)
    frames[:, :, :480] = LEFT
    frames[:, :, 480:] = RIGHT
    frames[:, 260:280, :] = 255
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '960x540', '-r', '10',
                    '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', str(path)],
                   input=frames.tobytes(), check=True, capture_output=True)


def export_real(tmp_path, monkeypatch, name, scenes, hook):
    import os
    run = tmp_path / name
    run.mkdir()
    source_video(run / 'editor-source.mp4')
    c = {**candidate(), 'ranges': [[200, 1200]], 'scenes': scenes, 'captions': False, 'status': 'ready'}
    if hook != 'absent':
        c['hook'] = hook
    project = {'version': 1, 'revision': 0, 'width': 960, 'height': 540, 'duration_ms': 2000, 'aspect_ratio': '9:16',
               'candidates': [c], 'transcript': []}
    (run / 'editor-project.json').write_text(json.dumps(project))
    (run / 'transcript.json').write_text(json.dumps({'segments': []}))
    (run / 'job_output.json').write_text(json.dumps({'clips': [], 'total_clips': 0, 'editor_project': True}))
    asyncio.run(run_editor({'run': str(run), 'revision': 0, 'candidate_id': c['id'], 'action': 'export'}))
    clip = json.loads((run / 'job_output.json').read_text())['clips'][0]['s3_url']
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', '0.5', '-i', clip, '-frames:v', '1', '-f', 'rawvideo',
                          '-pix_fmt', 'rgb24', '-'], check=True, capture_output=True).stdout
    frame = np.frombuffer(raw, np.uint8).reshape(1920, 1080, 3).astype(int)
    if os.environ.get('FRAMES_DIR'):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '0.5', '-i', clip, '-frames:v', '1', '-vf', 'scale=540:960',
                        str(Path(os.environ['FRAMES_DIR']) / f'editor_{name}.png')], check=True)
    return frame


def is_color(pixel, color):
    return np.abs(np.asarray(pixel) - np.asarray(color)).sum() < 60


def seam(frame, x=540):
    """First output row (below any bar) that shows the right (blue) half."""
    return next(y for y in range(1920) if is_color(frame[y, x], RIGHT))


needs_ffmpeg = pytest.mark.skipif(not shutil.which('ffmpeg'), reason='ffmpeg not installed')


@needs_ffmpeg
@pytest.mark.parametrize('share', [.35, .65])
def test_real_export_renders_the_split_size(tmp_path, monkeypatch, share):
    monkeypatch.setattr(RenderingService, '_verify_ffmpeg', lambda _: None)
    scenes = [{'at_ms': 0, 'layout': 'split', 'crops': split_crops(share, 960, 540), 'split': share}]
    frame = export_real(tmp_path, monkeypatch, f'split_{round(share * 100)}', scenes, None)
    top = round(1920 * share)
    assert abs(seam(frame) - top) <= 4
    assert is_color(frame[top // 2 + 120, 540], LEFT) and is_color(frame[top + (1920 - top) // 2 + 120, 540], RIGHT)
    # The stripe sits at the middle of each panel: nothing was stretched or shifted.
    stripes = [y for y in range(0, 1920, 2) if frame[y, 540].min() > 200]
    assert any(abs(y - top / 2) < 30 for y in stripes) and any(abs(y - (top + (1920 - top) / 2)) < 30 for y in stripes)


@needs_ffmpeg
@pytest.mark.parametrize('look,bar', [('white', (255, 255, 255)), ('black', (14, 14, 14)), ('brand', (16, 185, 129)),
                                      ('floating', None), ('none', None), ('absent', None), ('null', None)])
def test_real_export_renders_each_hook_look(tmp_path, monkeypatch, look, bar):
    monkeypatch.setattr(RenderingService, '_verify_ffmpeg', lambda _: None)
    scenes = [{'at_ms': 0, 'layout': 'split', 'crops': split_crops(.5, 960, 540)}]
    hook = {'absent': 'absent', 'null': None}.get(look, {'text': 'She quit her job to build this',
                                                        'look': {'look': look, 'color': '#10B981', 'font': 'clean'}})
    frame = export_real(tmp_path, monkeypatch, f'hook_{look}', scenes, hook)
    corner = frame[30, 20]
    if bar is not None:
        assert is_color(corner, bar)
        # The video sits below the bar, still split in two and not stretched.
        assert seam(frame) > 960
        assert is_color(frame[1900, 540], RIGHT)
    else:
        assert is_color(corner, LEFT)
        assert abs(seam(frame) - 960) <= 4
    # Text is drawn only for a visible hook: check the top band for text pixels.
    band = frame[100:330, 60:1020]
    background = np.asarray(bar if bar is not None else LEFT)
    text_pixels = (np.abs(band - background).sum(axis=2) > 150).mean()
    assert (text_pixels > .01) == (look in ('white', 'black', 'brand', 'floating'))
