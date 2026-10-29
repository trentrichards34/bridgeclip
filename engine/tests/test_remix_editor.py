"""A finished Remix run opens in the clip editor over its finished videos (remix_editor.py)."""
import asyncio
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from clip_engine.services import manual_editor
from clip_engine.services.automatic_editor import prepare
from clip_engine.services.manual_editor import EditorError, remix_project, replace_library_clip, source_info, validate_candidate
from clip_engine.services.remix_editor import (
    build_remix_project, bundle_words, caption_lines, plan_layout, remix_videos,
)
from clip_engine.services.rendering_service import RenderingService

MEDIA_ID = 'b' * 32
CTA = 'c' * 16


def make_video(path, seconds, color='red', size='216x384', audio=True):
    args = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=c={color}:s={size}:r=30:d={seconds}']
    if audio:
        args += ['-f', 'lavfi', '-i', f'sine=frequency=440:sample_rate=48000:duration={seconds}']
    args += ['-c:v', 'libx264' if b'libx264' in subprocess.run(['ffmpeg', '-hide_banner', '-encoders'], capture_output=True).stdout else 'libopenh264',
             '-pix_fmt', 'yuv420p', *(['-c:a', 'aac', '-shortest'] if audio else []), str(path)]
    subprocess.run(args, check=True)


def remix_run(tmp_path, count=2, audio=True):
    """A finished Remix run: `count` videos, the last one with a call to action added (its original kept), each with its bundle."""
    run = tmp_path / 'remix-1111'
    run.mkdir()
    clips = []
    for index in range(count):
        make_video(run / f'clip_{index:02d}.mp4', 1 + index * .5, ['red', 'blue', 'green'][index % 3], audio=audio or index == 0)
        bundle = run / '.edit' / f'clip_{index:02d}'
        bundle.mkdir(parents=True)
        (bundle / 'edit.json').write_text(json.dumps({'version': 1, 'words': [['Money', 0, 300], ['moves', 320, 600], ['fast.', 620, 900],
                                                                              ['Gone', 950, 1300]]}))
        clips.append({'clip_index': index, 's3_url': f'file://{run}/clip_{index:02d}.mp4', 'duration_ms': 1000 + index * 500,
                      'summary': f'Remix take {index + 1}', 'headline': f'He says money moves fast {index}', 'editable': {'split': False}})
    if count > 1:
        # The call to action was added to the last one: the editor uses the video as rendered.
        last = count - 1
        (run / f'clip_{last:02d}.mp4').rename(run / f'clip_{last:02d}.original.mp4')
        make_video(run / f'clip_{last:02d}.mp4', 3, 'white')
        clips[-1]['cta'] = {'id': CTA}
    output = {'job_id': run.name, 'source_video_url': 'https://www.youtube.com/watch?v=abc', 'source_video_title': 'Remix · Money talk',
              'total_clips': count, 'clips': clips, 'metrics': {'remix': True, 'remix_kinds': ['camera']}}
    (run / 'job_output.json').write_text(json.dumps(output))
    return run, output


def test_caption_lines_split_on_sentences_pauses_and_length():
    words = [('One', 0, 100), ('two.', 120, 200), ('Three', 1000, 1100)] + [(f'w{i}', 1200 + i * 100, 1290 + i * 100) for i in range(14)]
    lines = caption_lines(words, 5000)
    assert [l['text'] for l in lines][:2] == ['One two.', 'Three w0 w1 w2 w3 w4 w5 w6 w7 w8 w9 w10']
    assert lines[0]['start_time_ms'] == 5000 and lines[0]['words'][1] == {'word': 'two.', 'start_time_ms': 5120, 'end_time_ms': 5200}
    assert sum(len(l['words']) for l in lines) == len(words)


def test_plan_layout_puts_videos_end_to_end_on_whole_frames():
    spans = plan_layout([{'duration': 1000}, {'duration': 1510}, {'duration': 999}], '30')
    assert spans == [(0, 1000, 30), (1000, 2500, 45), (2500, 3500, 30)]


def test_bundle_words_are_checked_and_clamped(tmp_path):
    run = tmp_path / 'r'
    (run / '.edit' / 'clip_00').mkdir(parents=True)
    (run / '.edit' / 'clip_00' / 'edit.json').write_text(json.dumps({'words': [['a', 0, 100], ['bad'], ['', 1, 2], ['late', 900, 1500], ['out', 2000, 2100]]}))
    assert bundle_words(run, 0, 1000) == [('a', 0, 100), ('late', 900, 1000)]
    assert bundle_words(run, 1, 1000) == []


def test_project_keeps_the_remix_look_and_replaces_library_videos(tmp_path):
    run, output = remix_run(tmp_path)
    videos = remix_videos(run, output)
    # The video as rendered, before its call to action.
    assert [p.name for _c, p in videos] == ['clip_00.mp4', 'clip_01.original.mp4']
    infos = [{'width': 1080, 'height': 1920, 'duration': 1000, 'audio': True}, {'width': 1080, 'height': 1920, 'duration': 1500, 'audio': True}]
    spans = plan_layout(infos, '30')
    words = [bundle_words(run, 0, 1000), bundle_words(run, 1, 1500)]
    project, transcript = build_remix_project(output, videos, infos, spans, words, MEDIA_ID)
    assert project['aspect_ratio'] == '9:16' and project['duration_ms'] == 2500 and project['source_id'] == MEDIA_ID
    assert project['automatic'] == {'omitted': [], 'estimated_cuts': 0, 'remix': True} and remix_project(project)
    a, b = project['candidates']
    assert a['ranges'] == [[0, 1000]] and b['ranges'] == [[1000, 2500]]
    for c, index in ((a, 0), (b, 1)):
        # Captions and hook text are in the picture already; the whole frame is kept; baking replaces the Library video.
        assert c['captions'] is False and c['hook'] is None and c['scenes'] == [{'at_ms': 0, 'layout': 'fill', 'crops': [[0, 0, 1, 1]]}]
        assert c['library_clip'] == index and c['exports'] == [index] and c['status'] == 'baked' and c['video_speed'] == 1
        validate_candidate(c, project['duration_ms'])
    assert a['title'] == 'Remix take 1' and a['cta_id'] is None and b['cta_id'] == CTA
    # The words said, in the joined source's time: graphics may show only these.
    assert [r['text'] for r in project['transcript']] == ['Money moves fast.', 'Gone', 'Money moves fast.', 'Gone']
    assert project['transcript'][2]['start_ms'] == 1000
    assert transcript['segments'][3]['words'][0] == {'word': 'Gone', 'start_time_ms': 1950, 'end_time_ms': 2300}


def test_landscape_videos_make_a_landscape_project(tmp_path):
    run, output = remix_run(tmp_path, count=1)
    infos = [{'width': 1920, 'height': 1080, 'duration': 1000, 'audio': True}]
    project, _ = build_remix_project(output, remix_videos(run, output), infos, [(0, 1000, 30)], [[]], MEDIA_ID)
    assert project['aspect_ratio'] == '16:9' and project['candidates'][0]['scenes'][0]['crops'] == [[0, 0, 1, 1]]
    assert project['transcript'] == []


@pytest.mark.parametrize('count', [1, 3])
def test_prepare_makes_source_preview_transcript_and_project(tmp_path, count):
    run, _ = remix_run(tmp_path, count=count, audio=count == 1)
    progress = []
    result = asyncio.run(prepare({'run': str(run), 'library': str(tmp_path), 'media_id': MEDIA_ID, 'mode': 'remix'}, progress.append))
    assert result == {'candidates': count}
    project = json.loads((run / 'editor-project.json').read_text())
    source = run / f'editor-source-{MEDIA_ID}.mp4'
    assert (run / f'editor-preview-{MEDIA_ID}.mp4').is_file() and project['frame_preview'] is True
    info = source_info(source)
    assert (info['width'], info['height']) == (216, 384) and info['audio']
    # Each video's place in the joined source, end to end (1 s, 1.5 s and the 2 s original before its call to action).
    assert [c['ranges'] for c in project['candidates']] == ([[[0, 1000]]] if count == 1 else [[[0, 1000]], [[1000, 2500]], [[2500, 4500]]])
    assert abs(info['duration'] - project['duration_ms']) < 80
    if count == 1:
        assert source.read_bytes() == (run / 'clip_00.mp4').read_bytes()
    transcript = json.loads((run / 'transcript.json').read_text())
    assert len(transcript['segments']) == 2 * count
    assert {p['phase'] for p in progress} >= {'copy', 'preview'}
    # A second conversion is refused; making it again needs the current revision.
    with pytest.raises(EditorError):
        asyncio.run(prepare({'run': str(run), 'library': str(tmp_path), 'media_id': 'd' * 32, 'mode': 'remix'}))
    with pytest.raises(EditorError):
        asyncio.run(prepare({'run': str(run), 'library': str(tmp_path), 'media_id': 'd' * 32, 'mode': 'remix', 'revision': 7}))
    again = asyncio.run(prepare({'run': str(run), 'library': str(tmp_path), 'media_id': 'd' * 32, 'mode': 'remix', 'revision': 0}))
    assert again == {'candidates': count}
    assert json.loads((run / 'editor-project.json').read_text())['revision'] == 1


def test_prepare_refuses_runs_that_are_not_remixes(tmp_path):
    run, output = remix_run(tmp_path, count=1)
    output['metrics'] = {}
    (run / 'job_output.json').write_text(json.dumps(output))
    with pytest.raises(ValueError):
        asyncio.run(prepare({'run': str(run), 'library': str(tmp_path), 'media_id': MEDIA_ID, 'mode': 'remix'}))
    assert not (run / 'editor-project.json').exists()


def test_bake_keeps_the_card_hook_drops_recompose_and_skips_run_music(tmp_path, monkeypatch):
    run, output = remix_run(tmp_path, count=1)
    project = {'automatic': {'omitted': [], 'estimated_cuts': 0, 'remix': True}, 'revision': 3}
    rendered = run / 'render.mp4'
    rendered.write_bytes(b'new')
    result = SimpleNamespace(output_path=str(rendered), subtitle_path=None, duration_ms=1000, layout_type='fill')
    c = {'id': 'remix-000', 'title': 'Remix take 1'}
    replace_library_clip(run, output, 0, result, c, project, None, 0, 1000)
    entry = output['clips'][0]
    assert entry['headline'] == 'He says money moves fast 0' and 'editable' not in entry
    # A Clip run's export without a hook still clears it.
    other = {'clips': [{'clip_index': 0, 'headline': 'x', 'editable': {}}]}
    rendered.write_bytes(b'new')
    replace_library_clip(run, other, 0, result, c, {'revision': 1}, None, 0, 1000)
    assert other['clips'][0]['headline'] is None and 'editable' in other['clips'][0]


def test_remix_bakes_use_more_bits():
    renderer = RenderingService.__new__(RenderingService)
    renderer.settings = SimpleNamespace(local_mode=False, ffmpeg_preset='veryfast', ffmpeg_crf=20)
    assert renderer._video_codec_args()[renderer._video_codec_args().index('-crf') + 1] == '20'
    renderer.quality_scale = 1.5
    assert renderer._video_codec_args()[renderer._video_codec_args().index('-crf') + 1] == '16'
    renderer.settings.local_mode = True
    renderer._local_cpu_encoder = 'libopenh264'
    import sys
    if sys.platform != 'darwin':
        assert '12M' in renderer._video_codec_args()
