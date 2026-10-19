"""An Automatic run opens in the editor from the clips it made, and exports replace those clips in place."""
import asyncio
import json
import os
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace

import pytest

from clip_engine.services import automatic_editor
from clip_engine.services.automatic_editor import normalize_ranges, parse_settings, prepare, shot_from_summary
from clip_engine.services.manual_editor import EditorError, run_editor, validate_candidate
from clip_engine.services.rendering_service import RenderResult, RenderingService
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord

MEDIA_ID = 'a' * 32
LOOK = {'look': 'black', 'color': '#000000', 'font': 'serif'}


def words(start, text, step=300):
    return [TranscriptWord(word, start + i * step, start + i * step + step - 50) for i, word in enumerate(text.split())]


def segments():
    # A long pause between 4.7s and 8s: tight pacing cuts it.
    return [TranscriptSegment(1000, 4700, 'He admits he does not know what makes great carousels', words=words(1000, 'He admits he does not know what makes great carousels', 370)),
            TranscriptSegment(8000, 11000, 'So he tested twenty of them', words=words(8000, 'So he tested twenty of them', 500)),
            TranscriptSegment(20000, 24000, 'Here is the second moment people loved', words=words(20000, 'Here is the second moment people loved', 500))]


def settings(**extra):
    return {'aspect_ratio': '9:16', 'layout_style': 'auto', 'include_captions': True, 'caption_preset': 'pop', 'include_title': True,
            'title_style': 'headline', 'headline_look': LOOK, 'video_speed': 1.25, 'pacing': 'tight', 'background': False,
            'broll': True, 'hook_preview': False, 'headline_voice': 'creator', 'cta_keyword': 'GUIDE', 'cta_offer': 'my free guide',
            'brand_mark': {'handle': '@trent', 'logo': True, 'position': 'top-right'}, **extra}


def automatic_run(tmp_path):
    """A finished Automatic run: three clips, a kept source and its transcript."""
    run = tmp_path / '11111111-1111-4111-8111-111111111111'
    run.mkdir(parents=True)
    for index in range(3):
        (run / f'clip_{index:02d}.mp4').write_bytes(f'clip {index}'.encode())
    (run / 'clip_02.original.mp4').write_bytes(b'before its call to action')
    (run / 'editor-source.mp4').write_bytes(b'kept source')
    (run / '.brand-logo.png').write_bytes(b'logo')
    (run / 'transcript.json').write_text(json.dumps({'segments': [asdict(s) for s in segments()]}))
    talking = {'start_ms': 0, 'end_ms': 12000, 'layout': 'talking_head', 'source': 'heuristic', 'people': [[.6, .2, .1, .2]],
               'focus': [.65, .3], 'screen_box': None, 'screen_focus': None, 'cam_box': None, 'content_box': None, 'crop_bounds': None}
    two = {'start_ms': 5000, 'end_ms': 12000, 'layout': 'two_shot', 'people': [[.1, .2, .1, .2], [.7, .2, .1, .2]]}
    output = {'job_id': run.name, 'source_video_url': 'https://www.youtube.com/watch?v=abc', 'source_video_title': 'Carousels',
              'source_video_duration_seconds': 30, 'total_clips': 3, 'clips': [
        {'clip_index': 0, 's3_url': f'file://{run}/clip_00.mp4', 'duration_ms': 9000, 'start_time_ms': 1000, 'end_time_ms': 11000,
         'virality_score': .9, 'summary': 'Not knowing carousels', 'headline': "He admits he doesn't know what makes great carousels",
         'tags': ['carousels'], 'post_caption': 'Watch this', 'framework': {'grade': 'A'}},
        {'clip_index': 1, 's3_url': f'file://{run}/clip_01.mp4', 'duration_ms': 4000, 'start_time_ms': 20000, 'end_time_ms': 24000,
         'virality_score': .7, 'summary': 'The second moment', 'headline': 'People loved this second moment'},
        {'clip_index': 2, 's3_url': f'file://{run}/clip_02.mp4', 'duration_ms': 3000, 'start_time_ms': 8000, 'end_time_ms': 11000,
         'virality_score': .5, 'summary': 'Testing twenty', 'headline': 'He tested twenty carousels', 'caption_language': 'es',
         'cta': {'id': 'b' * 16, 'name': 'Follow', 'seconds': 3}},
    ], 'metrics': {'captions_status': 'enabled', 'clip_layouts': [
        # Clip 0 recorded its cut (new runs); clip 1 did not (older runs); clip 2 was letterboxed.
        {'clip_index': 0, 'layout_type': 'talking_head', 'shots': [talking, two], 'window_start_ms': 500,
         'kept_source_ms': [[1000, 4700], [8000, 11000]]},
        {'clip_index': 1, 'layout_type': 'talking_head', 'shots': [{**talking, 'end_ms': 6000}]},
        {'clip_index': 2, 'layout_type': 'fit', 'shots': [], 'render_fallback': 'letterbox'},
    ]}}
    (run / 'job_output.json').write_text(json.dumps(output))
    return run, output


@pytest.fixture
def media(monkeypatch):
    """No FFmpeg: a 30-second 1920×1080 source and a stand-in preview."""
    info = {'width': 1920, 'height': 1080, 'duration': 30000, 'rotation': 0, 'sar': '1:1', 'audio': True}
    monkeypatch.setattr(automatic_editor, 'source_info', lambda path: dict(info))
    previews = []
    async def preview(self, source, output, **kwargs):
        previews.append(source)
        Path(output).write_bytes(b'preview')
    monkeypatch.setattr(RenderingService, '_verify_ffmpeg', lambda _: None)
    monkeypatch.setattr(RenderingService, 'capture_framing_source', preview)
    return SimpleNamespace(info=info, previews=previews)


def convert(run, **extra):
    config = {'run': str(run), 'library': str(run.parent), 'media_id': MEDIA_ID, 'mode': 'convert', 'source': 'kept', 'settings': settings(), **extra}
    return asyncio.run(prepare(config))


def test_conversion_keeps_every_clip_as_made_with_no_ai(media, tmp_path):
    run, output = automatic_run(tmp_path)
    before = {p.name: p.read_bytes() for p in run.iterdir() if p.is_file()}
    assert convert(run) == {'candidates': 3}
    project = json.loads((run / 'editor-project.json').read_text())
    assert project['preview_id'] == MEDIA_ID and 'source_id' not in project and (run / f'editor-preview-{MEDIA_ID}.mp4').exists()
    assert media.previews == [str(run / 'editor-source.mp4')]
    assert (project['width'], project['height'], project['duration_ms'], project['aspect_ratio']) == (1920, 1080, 30000, '9:16')
    assert project['headline_voice'] == 'creator' and project['title'] == 'Carousels'
    assert project['automatic'] == {'omitted': ['broll'], 'estimated_cuts': 2, 'brand_mark': {'handle': '@trent', 'logo': True, 'position': 'top-right'},
                                    'cta_keyword': 'GUIDE', 'cta_offer': 'my free guide'}
    first, second, third = project['candidates']
    for c, index in zip(project['candidates'], range(3)):
        validate_candidate(c, 30000, 3)
        assert (c['status'], c['exports'], c['library_clip']) == ('baked', [index], index)
        assert (c['captions'], c['caption_preset'], c['video_speed']) == (True, 'pop', 1.25)
    # The recorded cut (the long pause stays out), the headline and its look.
    assert first['ranges'] == [[1000, 4700], [8000, 11000]]
    assert first['hook'] == {'text': "He admits he doesn't know what makes great carousels", 'look': LOOK}
    assert first['title'] == 'Not knowing carousels' and first['cta_id'] is None
    # Framing follows the saved shots: a face-centered crop, then the two-person split.
    assert [s['layout'] for s in first['scenes']] == ['fill', 'split'] and first['scenes'][1]['at_ms'] == 5500
    crop = first['scenes'][0]['crops'][0]
    assert abs(crop[0] + crop[2] / 2 - .65) < .01
    # An older clip without a saved cut: tight pacing worked out again from the words, inside its padded window.
    assert second['ranges'][0][0] >= 19000 and second['ranges'][-1][1] <= 25000
    assert second['hook']['text'] == 'People loved this second moment'
    # A letterboxed clip stays fitted; its call to action and caption language carry over.
    assert [s['layout'] for s in third['scenes']] == ['fit']
    assert third['cta_id'] == 'b' * 16 and third['caption_language'] == 'es'
    # Nothing the run made changed.
    assert {p.name: p.read_bytes() for p in run.iterdir() if p.is_file() and p.name in before} == before
    # Converting twice is refused; the project stays.
    with pytest.raises(EditorError) as error:
        convert(run)
    assert error.value.editor_code == 'project_changed'


def test_runs_without_a_headline_or_with_card_titles(media, tmp_path):
    run, _ = automatic_run(tmp_path)
    convert(run, settings=settings(title_style='card', broll=False, hook_preview=True, brand_mark=None, cta_keyword=''))
    project = json.loads((run / 'editor-project.json').read_text())
    assert all(c['hook'] is None for c in project['candidates'])
    assert project['automatic'] == {'omitted': ['hook_preview', 'title_card'], 'estimated_cuts': 2}
    run2, _ = automatic_run(tmp_path / 'other')
    convert(run2, settings=settings(aspect_ratio='16:9', include_captions=False))
    project = json.loads((run2 / 'editor-project.json').read_text())
    assert all(c['hook'] is None and not c['captions'] and [s['layout'] for s in c['scenes']] == ['fill'] for c in project['candidates'])


def test_a_missing_transcript_or_a_different_video_is_refused(media, tmp_path):
    run, _ = automatic_run(tmp_path)
    (run / 'transcript.json').unlink()
    with pytest.raises(EditorError) as error:
        convert(run)
    assert error.value.editor_code == 'transcript_missing' and not (run / 'editor-project.json').exists()
    run, _ = automatic_run(tmp_path / 'b')
    media.info['duration'] = 95000
    with pytest.raises(EditorError) as error:
        convert(run)
    assert error.value.editor_code == 'source_changed' and not (run / 'editor-project.json').exists()


@pytest.mark.parametrize('bad', [
    {'aspect_ratio': '4:3'}, {'video_speed': 3}, {'caption_preset': '../x'}, {'cta_keyword': 'lower'},
    {'brand_mark': {'handle': '@a', 'logo': 'yes', 'position': 'top-right'}}, {'brand_mark': {'handle': '@a', 'logo': False, 'position': 'middle'}},
])
def test_settings_are_checked(bad):
    with pytest.raises(ValueError):
        parse_settings(settings(**bad))


def test_ranges_fit_the_editor():
    assert normalize_ranges([[0, 50], [60, 5000], [5020, 5030], [5100, 9000]], 8000) == [[0, 5030], [5100, 8000]]
    many = normalize_ranges([[i * 1000, i * 1000 + 800 + (i % 3) * 10] for i in range(40)], 100000)
    assert len(many) == 24 and many[0][0] == 0 and many[-1][1] == 39800
    assert all(b - a >= 100 for a, b in many) and all(many[i][1] < many[i + 1][0] for i in range(23))
    assert normalize_ranges([[10, 40]], 1000) == []
    assert shot_from_summary({'layout': 'mystery', 'start_ms': 0, 'end_ms': 10}) is None
    assert shot_from_summary({'layout': 'talking_head', 'start_ms': 10, 'end_ms': 5}) is None


def ready(run, edit):
    project = json.loads((run / 'editor-project.json').read_text())
    c = project['candidates'][0]
    c.update(status='ready', **edit)
    (run / 'editor-project.json').write_text(json.dumps(project))
    return project


def test_export_replaces_the_library_clip_in_place(media, tmp_path, monkeypatch):
    run, _ = automatic_run(tmp_path)
    convert(run)
    project = ready(run, {'hook': {'text': 'The carousel test nobody runs', 'look': LOOK}})
    seen = []
    async def render(self, request):
        seen.append(request)
        Path(request.output_path).write_bytes(b'new render')
        srt = Path(request.output_path).with_suffix('.srt')
        srt.write_text('1\n00:00:00,000 --> 00:00:01,000\nHi\n')
        return RenderResult(request.output_path, 10, 7000, layout_type='talking_head', subtitle_path=str(srt))
    monkeypatch.setattr(RenderingService, 'render_clip', render)
    config = {'run': str(run), 'revision': project['revision'], 'candidate_id': 'clip-000', 'action': 'export'}
    assert asyncio.run(run_editor(config)) is None
    (request,) = seen
    assert request.headline_text == 'The carousel test nobody runs' and request.manual_ranges_ms == [(1000, 4700), (8000, 11000)]
    assert request.cta_keyword == 'GUIDE' and request.brand_mark == {'handle': '@trent', 'logo_path': str(run / '.brand-logo.png'), 'position': 'top-right'}
    assert request.write_subtitles is True and request.video_speed == 1.25
    output = json.loads((run / 'job_output.json').read_text())
    assert [c['clip_index'] for c in output['clips']] == [0, 1, 2] and output['total_clips'] == 3
    clip = output['clips'][0]
    assert (run / 'clip_00.mp4').read_bytes() == b'new render' and (run / 'clip_01.mp4').read_bytes() == b'clip 1'
    assert clip['headline'] == 'The carousel test nobody runs' and clip['duration_ms'] == 7000 and clip['cta'] is None
    # Details that aren't about the render stay with the clip.
    assert clip['tags'] == ['carousels'] and clip['post_caption'] == 'Watch this' and clip['framework'] == {'grade': 'A'}
    assert clip['captions_srt'] == str(run / 'clip_00.srt') and (run / 'clip_00.srt').exists()
    assert clip['edited_at'] and 'edited_at' not in output['clips'][1]
    saved = json.loads((run / 'editor-project.json').read_text())
    c = saved['candidates'][0]
    assert (c['status'], c['exports'], c['library_clip']) == ('baked', [0], 0)
    # Removing a headline draws none, and the clip's stale call-to-action original goes.
    project = json.loads((run / 'editor-project.json').read_text())
    third = project['candidates'][2]
    third.update(status='ready', hook=None, caption_language=None)
    third.pop('caption_language')
    (run / 'editor-project.json').write_text(json.dumps(project))
    asyncio.run(run_editor({**config, 'revision': project['revision'], 'candidate_id': 'clip-002'}))
    assert 'headline_text' not in vars(seen[-1]) or not seen[-1].headline_text
    assert not (run / 'clip_02.original.mp4').exists()
    output = json.loads((run / 'job_output.json').read_text())
    assert output['clips'][2]['headline'] is None and output['clips'][2]['caption_language'] is None


def test_export_translates_captions_for_a_clip_in_another_language(media, tmp_path, monkeypatch):
    from clip_engine.services import caption_translation
    run, _ = automatic_run(tmp_path)
    convert(run)
    project = json.loads((run / 'editor-project.json').read_text())
    project['candidates'][2]['status'] = 'ready'
    (run / 'editor-project.json').write_text(json.dumps(project))
    asked = []
    async def translate(self, lines, language):
        asked.append((language, [s.text for s in lines]))
        self.usage.cost_usd += .001
        return {caption_translation.segment_key(lines[0]): 'Así que probó veinte'} if language != 'fail' else {}
    monkeypatch.setattr(caption_translation.CaptionTranslator, 'translate', translate)
    monkeypatch.setattr(caption_translation.CaptionTranslator, 'close', lambda self: asyncio.sleep(0))
    seen = []
    async def render(self, request):
        seen.append(request)
        Path(request.output_path).write_bytes(b'translated')
        return RenderResult(request.output_path, 10, 3000)
    monkeypatch.setattr(RenderingService, 'render_clip', render)
    config = {'run': str(run), 'revision': project['revision'], 'candidate_id': 'clip-002', 'action': 'export'}
    result = asyncio.run(run_editor(config))
    assert result['cost_usd'] == .001 and asked == [('es', ['So he tested twenty of them'])]
    assert seen[0].caption_language == 'es' and list(seen[0].caption_translations.values()) == ['Así que probó veinte']
    assert json.loads((run / 'job_output.json').read_text())['clips'][2]['caption_language'] == 'es'
    # A failed translation never bakes the clip in the spoken language.
    project = json.loads((run / 'editor-project.json').read_text())
    project['candidates'][2].update(status='ready', caption_language='fr')
    (run / 'editor-project.json').write_text(json.dumps(project))
    async def nothing(self, lines, language):
        return {}
    monkeypatch.setattr(caption_translation.CaptionTranslator, 'translate', nothing)
    with pytest.raises(EditorError) as error:
        asyncio.run(run_editor({**config, 'revision': project['revision']}))
    assert error.value.editor_code == 'translation_failed' and len(seen) == 1
    assert error.value.usage['cost_usd'] == 0
    # A render that fails after a paid translation still reports what the translation cost.
    async def paid(self, lines, language):
        self.usage.cost_usd += .002
        return {caption_translation.segment_key(lines[0]): 'Alors il en a testé vingt'}
    monkeypatch.setattr(caption_translation.CaptionTranslator, 'translate', paid)
    async def broken(self, request):
        raise RuntimeError('encoder failed')
    monkeypatch.setattr(RenderingService, 'render_clip', broken)
    with pytest.raises(RuntimeError) as failed:
        asyncio.run(run_editor({**config, 'revision': project['revision']}))
    assert failed.value.usage['cost_usd'] == .002 and failed.value.editor_code == 'render_failed'
    assert json.loads((run / 'job_output.json').read_text())['clips'][2]['caption_language'] == 'es'


def test_a_deleted_library_clip_is_exported_as_a_new_clip(media, tmp_path, monkeypatch):
    run, _ = automatic_run(tmp_path)
    convert(run)
    project = ready(run, {})
    output = json.loads((run / 'job_output.json').read_text())
    output['clips'] = output['clips'][1:]
    output['next_clip_index'] = 3
    (run / 'job_output.json').write_text(json.dumps(output))
    (run / 'clip_00.mp4').unlink()
    async def render(self, request):
        Path(request.output_path).write_bytes(b'again')
        return RenderResult(request.output_path, 10, 7000)
    monkeypatch.setattr(RenderingService, 'render_clip', render)
    asyncio.run(run_editor({'run': str(run), 'revision': project['revision'], 'candidate_id': 'clip-000', 'action': 'export'}))
    assert (run / 'clip_03.mp4').read_bytes() == b'again' and not (run / 'clip_00.mp4').exists()
    c = json.loads((run / 'editor-project.json').read_text())['candidates'][0]
    assert c['exports'] == [0, 3] and 'library_clip' not in c


def test_restore_brings_back_freed_media_only_for_the_same_video(media, tmp_path, monkeypatch):
    run, _ = automatic_run(tmp_path)
    convert(run)
    project = json.loads((run / 'editor-project.json').read_text())
    project.update(media_freed=True, revision=4)
    project.pop('preview_id')
    (run / 'editor-project.json').write_text(json.dumps(project))
    (run / 'editor-source.mp4').unlink()
    new_id = 'c' * 32
    (run / f'editor-source-{new_id}.mp4').write_bytes(b'copied by main')
    config = {'run': str(run), 'library': str(tmp_path), 'media_id': new_id, 'mode': 'restore', 'source': 'file', 'revision': 4}
    media.info['height'] = 1440  # A different shape is a different video.
    with pytest.raises(EditorError) as error:
        asyncio.run(prepare(config))
    assert error.value.editor_code == 'source_changed'
    media.info['height'] = 1080
    with pytest.raises(EditorError) as error:
        asyncio.run(prepare({**config, 'revision': 3}))
    assert error.value.editor_code == 'project_changed'
    asyncio.run(prepare(config))
    saved = json.loads((run / 'editor-project.json').read_text())
    assert saved['source_id'] == new_id and 'media_freed' not in saved and saved['revision'] == 5
    assert (run / f'editor-preview-{new_id}.mp4').exists() and saved['candidates'] == project['candidates']
    with pytest.raises(ValueError):
        asyncio.run(prepare({**config, 'source': 'kept', 'revision': 5}))


def test_a_link_that_cannot_be_downloaded_fails_with_its_own_code(media, tmp_path, monkeypatch):
    from clip_engine.services import video_downloader
    run, _ = automatic_run(tmp_path)
    (run / 'editor-source.mp4').unlink()
    async def gone(self, url, output_dir, **kwargs):
        Path(output_dir, 'partial.part').write_bytes(b'x')
        raise video_downloader.VideoDownloadError('Private video')
    monkeypatch.setattr(video_downloader.VideoDownloaderService, '__init__', lambda self: None)
    monkeypatch.setattr(video_downloader.VideoDownloaderService, 'download_video', gone)
    with pytest.raises(EditorError) as error:
        convert(run, source='download', url='https://www.youtube.com/watch?v=abc')
    assert error.value.editor_code == 'download_failed'
    assert not list(run.glob('.editor-download-*')) and not (run / 'editor-project.json').exists()
    async def fetched(self, url, output_dir, **kwargs):
        path = Path(output_dir, 'source.mp4')
        path.write_bytes(b'downloaded')
        return SimpleNamespace(video_path=str(path))
    monkeypatch.setattr(video_downloader.VideoDownloaderService, 'download_video', fetched)
    convert(run, source='download', url='https://www.youtube.com/watch?v=abc')
    project = json.loads((run / 'editor-project.json').read_text())
    assert project['source_id'] == MEDIA_ID and (run / f'editor-source-{MEDIA_ID}.mp4').read_bytes() == b'downloaded'
    assert oct(os.stat(run / f'editor-source-{MEDIA_ID}.mp4').st_mode & 0o777) == '0o600'


def test_a_run_outside_the_library_or_a_bad_request_is_refused(media, tmp_path):
    run, _ = automatic_run(tmp_path)
    (tmp_path / 'elsewhere').mkdir()
    with pytest.raises(ValueError):
        convert(run, library=str(tmp_path / 'elsewhere'))
    for patch in ({'media_id': '../x'}, {'mode': 'delete'}, {'source': 'path'}, {'source': 'download', 'url': 'file:///etc/passwd'}):
        with pytest.raises(ValueError):
            convert(run, **patch)
    assert not (run / 'editor-project.json').exists()


def test_automatic_runs_keep_a_downloaded_source(tmp_path):
    from clip_engine.services.ai_clipping_pipeline import AIClippingPipeline
    work, out = tmp_path / 'work', tmp_path / 'out'
    work.mkdir(); out.mkdir()
    (work / 'source.mp4').write_bytes(b'downloaded')
    downloaded = SimpleNamespace(source_type='youtube', video_path=str(work / 'source.mp4'))
    assert AIClippingPipeline._keep_source_copy(downloaded, str(out)) is True
    assert (out / 'editor-source.mp4').read_bytes() == b'downloaded' and not (work / 'source.mp4').exists()
    assert oct(os.stat(out / 'editor-source.mp4').st_mode & 0o777) == '0o600'
    # A local file (or another run's kept copy) is never moved or copied.
    (tmp_path / 'mine.mp4').write_bytes(b'mine')
    other = tmp_path / 'out2'; other.mkdir()
    assert AIClippingPipeline._keep_source_copy(SimpleNamespace(source_type='local', video_path=str(tmp_path / 'mine.mp4')), str(other)) is False
    assert (tmp_path / 'mine.mp4').exists() and not (other / 'editor-source.mp4').exists()
