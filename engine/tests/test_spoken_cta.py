"""The spoken call to action: found in the words (deterministic, no AI), its graphic, and both pipelines' hook-ins."""
import json
import os
import re
from types import SimpleNamespace

import pytest

from clip_engine.services import spoken_cta as sc
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord

CASES = json.load(open(os.path.join(os.path.dirname(__file__), 'fixtures', 'spoken_cta_cases.json')))['cases']


def timed(text, start=0):
    """Words 300 ms apart, 250 ms long; '/' is a 700 ms pause."""
    out, t = [], start
    for word in text.split():
        if word == '/':
            t += 700
            continue
        out.append((word, t, t + 250))
        t += 300
    return out


@pytest.mark.parametrize('case', CASES, ids=[c['name'] for c in CASES])
def test_shared_cases(case):
    found = sc.find_spoken_cta(timed(case['text']), window=tuple(case['window']) if case.get('window') else None)
    if case['expect'] is None:
        assert found is None
        return
    assert found is not None
    assert {k: found[k] for k in ('kind', 'text', 'where', 'keyword', 'lead')} == case['expect']


@pytest.mark.parametrize('case', [c for c in CASES if c['expect']], ids=[c['name'] for c in CASES if c['expect']])
def test_every_word_shown_was_said_in_order(case):
    found = sc.find_spoken_cta(timed(case['text']))
    said = [re.sub(r"[^\w'-]", '', w).lower() for w in case['text'].split()]
    for field in ('text', 'where', 'lead'):
        words = [re.sub(r"[^\w'-]", '', w).lower() for w in found[field].split()]
        k = 0
        for w in words:
            assert w in said[k:], (field, found[field])
            k = said.index(w, k) + 1


def test_timing_covers_the_words():
    words = timed('so that is it. hit the link below to get the guide')
    found = sc.find_spoken_cta(words)
    assert found['start_ms'] == words[4][1]  # "hit"
    assert found['end_ms'] == words[-1][2]  # "guide" (the line after it)
    g = sc.cta_graphic(found, 0, 20_000)
    assert g['template'] == 'link_cta' and g['placement'] == 'top' and g['size'] == 'card' and g['origin'] == 'auto'
    assert g['at_ms'] == found['start_ms'] - sc.LEAD_MS
    assert sc.MIN_MS <= g['duration_ms'] <= sc.MAX_MS
    assert g['fields'] == {'text': 'Hit the link', 'kind': 'link', 'where': 'below', 'lead': 'Get the guide'}


def test_the_plans_span_wins():
    # A follow said at the very end, and the plan's call to action span on the link earlier in the talk.
    words = timed('click the link below to get the guide. ' + 'we talk a lot more here ' * 30 + 'and follow me')
    found = sc.find_spoken_cta(words, span=(0, 3))
    assert found['kind'] == 'link' and found['text'] == 'Click the link'
    # Without the span only the tail counts.
    assert sc.find_spoken_cta(words)['kind'] == 'follow'
    # A span with no request in it falls back to the tail.
    assert sc.find_spoken_cta(words, span=(10, 14))['kind'] == 'follow'


def test_graphic_near_the_end_plays_shorter_or_not_at_all():
    found = sc.find_spoken_cta(timed('hit the link below'))
    end = found['end_ms'] + 600
    g = sc.cta_graphic(found, 0, end)
    assert g['at_ms'] + g['duration_ms'] <= end and g['duration_ms'] >= sc.SHORTEST_MS
    assert sc.cta_graphic(found, 0, found['start_ms'] + 900) is None


def test_comment_keyword_respects_the_members_setting():
    found = sc.find_spoken_cta(timed('comment GUIDE below'))
    # No keyword set: the word said.
    assert sc.cta_graphic(found, 0, 20_000)['fields'] == {'keyword': 'GUIDE', 'lead': 'Comment'}
    # The member's keyword (their casing) when the speaker says it.
    assert sc.cta_graphic(found, 0, 20_000, keyword='guide')['fields']['keyword'] == 'GUIDE'
    # The clip already shows the member's keyword at its end: no second prompt.
    assert sc.cta_graphic(found, 0, 20_000, keyword='GUIDE', keyword_shown=True) is None
    # "Let me know in the comments" with the member's keyword: their keyword.
    asked = sc.find_spoken_cta(timed('let me know in the comments'))
    assert sc.cta_graphic(asked, 0, 20_000, keyword='AI')['fields']['keyword'] == 'AI'
    # Without one: a call to action button with the words said.
    g = sc.cta_graphic(asked, 0, 20_000)
    assert g['template'] == 'link_cta' and g['fields'] == {'text': 'Let me know in the comments', 'kind': 'comment'}


def test_a_link_ends_before_the_members_keyword_tail():
    found = sc.find_spoken_cta(timed('hit the link below'))
    g = sc.cta_graphic(found, 0, found['end_ms'] + 6000, keyword='GUIDE', keyword_shown=True)
    assert g['at_ms'] + g['duration_ms'] <= found['end_ms'] + 6000 - sc.KEYWORD_TAIL_MS


def test_with_cta_never_duplicates_and_auto_graphics_give_way():
    cta = {'id': 'g-cta000001', 'template': 'link_cta', 'at_ms': 10_000, 'duration_ms': 3000, 'placement': 'bottom', 'fields': {'text': 'Hit the link'}, 'origin': 'auto'}
    auto = {'id': 'g-auto00001', 'template': 'statement', 'at_ms': 8000, 'duration_ms': 4000, 'placement': 'top', 'fields': {'text': 'x', 'word_ms': '0\n3500'}, 'origin': 'auto'}
    late = {'id': 'g-auto00002', 'template': 'stat', 'at_ms': 10_500, 'duration_ms': 2000, 'placement': 'top', 'fields': {'value': '3'}, 'origin': 'auto'}
    chapter = {'id': 'g-chap00001', 'template': 'chapter', 'at_ms': 0, 'duration_ms': 30_000, 'placement': 'top', 'fields': {'title': 'T'}, 'origin': 'auto'}
    out = sc.with_cta([auto, late, chapter], cta)
    assert [g['id'] for g in out] == ['g-chap00001', 'g-auto00001', 'g-cta000001']
    trimmed = out[1]
    assert trimmed['at_ms'] + trimmed['duration_ms'] <= cta['at_ms'] and trimmed['fields']['word_ms'].split('\n')[-1] != '3500'
    # A call to action already there (the planner's comment prompt), or the member's own graphic then: unchanged.
    prompt = {'id': 'g-comm00001', 'template': 'comment_cta', 'at_ms': 9500, 'duration_ms': 3000, 'fields': {'keyword': 'AI'}, 'origin': 'auto'}
    assert sc.with_cta([prompt], cta) == [prompt]
    mine = {**late, 'origin': 'member'}
    assert sc.with_cta([mine], cta) == [mine]
    assert sc.with_cta([auto], None) == [auto]


def test_clear_scenes_keeps_the_face_for_the_call():
    scenes = [{'scene': 'stage', 'start_ms': 5000, 'end_ms': 14_000}]
    assert sc.clear_scenes(scenes, (10_000, 13_000)) == [{'scene': 'stage', 'start_ms': 5000, 'end_ms': 10_000}, {'scene': 'stage', 'start_ms': 13_000, 'end_ms': 14_000}][:1]


def _segments(words):
    return [TranscriptSegment(words[0][1], words[-1][2], ' '.join(w[0] for w in words),
                              words=[TranscriptWord(t, s, e) for t, s, e in words])]


def test_create_uses_only_the_words_kept():
    words = timed('here is the thing about offers. ' * 3 + 'hit the link below to get the guide', start=60_000)
    segments = _segments(words)
    start, end = words[0][1], words[-1][2] + 500
    g = sc.create_cta(segments, [(start, end)])
    assert g['template'] == 'link_cta' and g['fields']['text'] == 'Hit the link' and start <= g['at_ms'] < end
    # The call to action cut out of the clip: no graphic.
    hit = next(w for w in words if w[0] == 'hit')
    assert sc.create_cta(segments, [(start, hit[1] - 10)]) is None
    # The member's keyword shows over the last seconds: the link plays before them.
    shown = sc.create_cta(segments, [(start, end + 5000)], 'GUIDE', True)
    assert shown['at_ms'] + shown['duration_ms'] <= end + 5000 - sc.KEYWORD_TAIL_MS


def test_edit_uses_the_plans_span_on_the_reels_clock():
    words = timed('the link is in my bio. ' + 'more talk about the offer here ' * 30 + 'and that is all')
    rows = [(t, s, e, k + 100) for k, (t, s, e) in enumerate(words)]
    g = sc.edit_cta(rows, (100, 105), rows[-1][2] + 500, offset_ms=2000)
    assert g['fields']['text'] == 'Link is in my bio' and g['at_ms'] == rows[1][1] + 2000 - sc.LEAD_MS
    # Without the span the early line is outside the tail.
    assert sc.edit_cta(rows, None, rows[-1][2] + 500) is None


def test_dm_is_written_dm():
    assert sc.find_spoken_cta(timed('so dm me SCALE for the checklist'))['text'] == 'DM me SCALE'


def test_placement_covers_the_face_least():
    assert sc.cta_placement(None) == 'top'
    # A talking head (the owner's reel: face from 25% to 62% down): above the head.
    assert sc.cta_placement([0.3, 0.25, 0.4, 0.37]) == 'top'
    # A face high in the frame: the band over the captions.
    assert sc.cta_placement([0.3, 0.06, 0.4, 0.3]) == 'bottom'
    found = sc.find_spoken_cta(timed('hit the link below'))
    assert sc.cta_graphic(found, 0, 20_000, face=[0.3, 0.06, 0.4, 0.3])['placement'] == 'bottom'


def test_points_down():
    assert sc.points_down({'where': 'in my bio'}) and sc.points_down({'text': 'Link below'})
    assert not sc.points_down({'where': 'where you see it', 'text': 'Hit the link'})


def test_saved_runs_keep_the_graphic():
    from clip_engine.services import auto_graphics as ag
    from clip_engine.services import edit_direction as ed
    raw = [{'id': 'g-cta000001', 'template': 'link_cta', 'at_ms': 1000, 'duration_ms': 3000, 'placement': 'bottom',
            'fields': {'text': 'Hit the link', 'where': 'below', 'kind': 'link', 'lead': 'Get the guide'}, 'size': 'card'}]
    assert ag.checked_saved(raw, 10_000)[0]['fields'] == raw[0]['fields']
    assert 'link_cta' in ed.EDITOR_TEMPLATES
    # Never one of the planner's own templates (it is added from the words, not planned).
    assert 'link_cta' not in ag.AUTO_TEMPLATES


# --- Create's pipeline: the call to action said in a clip gets its graphic (the planner never suggested one) ---------

@pytest.fixture
def approved_candidates(monkeypatch):
    from unittest.mock import AsyncMock
    from clip_engine.services import ai_clipping_pipeline as pipeline_module
    monkeypatch.setattr(pipeline_module.CoherenceReviewer, 'prepare', AsyncMock(return_value=True))


def _line(start, text, step=400):
    words = text.split()
    timed_words = [TranscriptWord(word, start + i * step, start + i * step + step - 50) for i, word in enumerate(words)]
    return TranscriptSegment(start, timed_words[-1].end_time_ms, text, words=timed_words)


@pytest.mark.parametrize('keyword', ['', 'GUIDE'])
def test_create_pipeline_adds_the_spoken_call_to_action(monkeypatch, tmp_path, approved_candidates, keyword):
    from clip_engine.services.ai_clipping_pipeline import ClippingJobRequest, JobStatus
    from clip_engine.services.intelligence_planner import ClipPlanResponse, ClipPlanSegment
    from clip_engine.services.rendering_service import RenderRequest, RenderResult
    from clip_engine.services.transcription_service import TranscriptionResult
    from .test_more_clips_and_caption_language import run_pipeline

    source = tmp_path / 'source.mp4'
    source.write_bytes(b'video' * 100)
    said = [_line(10_000, 'I made fifteen thousand dollars last month from short clips.'),
            _line(16_000, 'Here is the whole system and it works for anyone.'),
            _line(22_000, 'Hit the link below to get the free guide.')]

    async def transcribe(*args, **kwargs):
        return TranscriptionResult(segments=said, full_text=' '.join(s.text for s in said))

    async def plan(**kwargs):
        segment = ClipPlanSegment(10_000, 40_000, 0.9, summary='Clips', headline='Fifteen thousand from clips')
        segment.graphics = []
        return ClipPlanResponse(segments=[segment], total_clips=1)

    async def render(request: RenderRequest):
        open(request.output_path, 'wb').write(b'mp4')
        return RenderResult(output_path=request.output_path, file_size_bytes=3, duration_ms=30_000, kept_source_ms=[[10_000, 40_000]], window_start_ms=10_000)

    request = ClippingJobRequest(video_url=str(source), job_id='cta', quality_bar='off', motion_graphics=True, aspect_ratio='9:16',
                                 title_style='headline', include_captions=True, cta_keyword=keyword)
    result, _ = run_pipeline(monkeypatch, tmp_path, request, transcribe, plan, render=render)
    assert result.status == JobStatus.COMPLETED, result.error
    (g,) = result.output.metrics['clip_layouts'][0]['graphics']
    assert g['template'] == 'link_cta' and g['origin'] == 'auto'
    assert g['fields'] == {'text': 'Hit the link', 'kind': 'link', 'where': 'below', 'lead': 'Get the free guide'}
    assert g['at_ms'] == 22_000 - sc.LEAD_MS
    # The run's editor plan carries it, so it opens (editable, removable) in the clip editor.
    plan_file = json.loads((tmp_path / 'out' / 'cta' / 'auto-graphics.json').read_text())
    assert plan_file['project']['candidates'][0]['graphics'][0]['template'] == 'link_cta'


# --- Edit my recording / Combine clips: the reel's call to action (the plan's span) becomes an editor graphic ----------

@pytest.mark.skipif(not __import__('shutil').which('ffmpeg'), reason='needs FFmpeg')
def test_edit_render_adds_the_call_to_action_to_the_editor_project(tmp_path):
    import asyncio
    import subprocess
    from clip_engine.services import edit_recording as er
    from .test_edit_direction import at, talk

    root = str(tmp_path / 'edit-run')
    os.makedirs(root)
    source = str(tmp_path / 'recording.mp4')
    words = talk()  # ends: "So focus on making a really good offer. Hit the link to get all the details."
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=40', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=40',
                    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], check=True)
    marks = er.analyze_takes(words)
    span = er.Span(at(words, 'Hit'), at(words, 'details.'))
    look = er.Look('You do not need a huge audience', {'look': 'floating', 'color': '#FFFFFF', 'font': 'serif'}, True, 'pop', None)
    config = {'output_dir': root, 'sources': [source], 'words': words, 'keep': [m is None for m in marks], 'hook': None, 'cta': span,
              'popups': [], 'sounds': [], 'look': look, 'title': 'My reel', 'cost_usd': 0, 'sound_cache': str(tmp_path / 'sounds'),
              # A member's graphic elsewhere stays; the planner made no call to action graphic.
              'editor': {'graphics': [], 'pins': [], 'motion': True, 'stage': True, 'brand_color': None, 'cta_keyword': ''}}
    asyncio.run(er.render_edit(config, lambda *_: None))
    project = json.load(open(os.path.join(root, 'editor-project.json')))
    ctas = [g for g in project['candidates'][0].get('graphics', []) if g['template'] == 'link_cta']
    assert len(ctas) == 1
    g = ctas[0]
    assert g['origin'] == 'auto' and g['fields'] == {'text': 'Hit the link', 'kind': 'link', 'lead': 'Get all the details'}
    assert g['placement'] == 'top' and g.get('size', 'card') == 'card'
    assert sc.MIN_MS <= g['duration_ms'] <= sc.MAX_MS or g['at_ms'] + g['duration_ms'] >= project['duration_ms'] - 50
    # On the reel's clock, on "Hit" (the call to action plays last).
    hit = json.load(open(os.path.join(root, 'transcript.json')))['segments'][-1]['words']
    first = next(w for w in hit if w['word'].lower().startswith('hit'))
    assert g['at_ms'] == max(0, first['start_time_ms'] - sc.LEAD_MS)
    # No stage scene over the call to action: the face stays on screen.
    for s in project['candidates'][0].get('stage_scenes', []):
        assert s['end_ms'] <= g['at_ms'] or s['start_ms'] >= g['at_ms'] + g['duration_ms']
