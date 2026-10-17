"""Editor hook ideas: graded with the hook rubric, never facts beyond the clip's words."""
import asyncio
import json
from dataclasses import asdict
from types import SimpleNamespace

import pytest

from clip_engine.services import hook_ideas
from clip_engine.services.framework_grader import SYSTEM_PROMPT
from clip_engine.services.hook_ideas import HooksUnavailable, clip_text, grade_ideas, hook_grade, numbers_supported, suggest_hooks
from clip_engine.services.manual_editor import EditorError, run_editor, validate_candidate_list
from clip_engine.services.openrouter import OpenRouterError
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord

CLIP = 'I almost quit after losing $4,200 in March. Then we found 160 leads for $531 by breaking one rule.'


def idea(text, evidence='we found 160 leads for $531', score=8.0, **extra):
    return {'text': text, 'evidence': evidence, 'elements': {'qualifier': None, 'main_statement': None, 'twist': None},
            'hook_type': 'direct_response', 'hook_score': score, 'why': 'Specific result.', **extra}


def test_the_rubric_is_the_framework_graders_own_text():
    for heading in ('## WHAT A STRONG HOOK IS', '## THE TRIPLE HOOK', '## HOOK TYPES'):
        assert heading in hook_ideas.PROMPT
    assert '## THE FIVE-STEP STORY' not in hook_ideas.PROMPT
    assert hook_ideas.HOOK_RUBRIC.split('## WHAT A STRONG HOOK IS\n', 1)[1].split('\n\n## THE TRIPLE HOOK')[0] in SYSTEM_PROMPT


def test_ideas_need_quoted_evidence_and_only_numbers_the_speaker_said():
    raw = {'hooks': [
        idea('160 leads for $531 by breaking one rule', score=9,
             elements={'qualifier': None, 'main_statement': '160 leads for $531', 'twist': 'by breaking one rule'}),
        idea('We made $10,000 in a week', evidence='we found 160 leads'),        # a number nobody said
        idea('Losing $4,200 almost ended it', evidence='I nearly gave up forever'),  # evidence not in the clip
        idea('The rule everyone follows is wrong', evidence='breaking one rule', score=6,
             elements={'qualifier': 'made up words', 'main_statement': None, 'twist': None}),
        idea('160 leads for $531 by breaking one rule'),                           # duplicate
        idea('One'),                                                               # one word is never drawn
        idea('x' * 201),
        idea('Bad\x07text here'),
        idea('Unscored idea here', score='high'),
        'not an idea',
    ]}
    ideas = grade_ideas(raw, CLIP)
    assert [i['text'] for i in ideas] == ['160 leads for $531 by breaking one rule', 'The rule everyone follows is wrong']
    best, other = ideas
    assert best['grade'] == 'A' and best['score'] == 9.0
    assert best['elements'] == {'qualifier': None, 'main_statement': '160 leads for $531', 'twist': 'by breaking one rule'}
    assert other['elements']['qualifier'] is None, 'elements must be quoted from the idea itself'
    assert other['grade'] == 'C'
    assert grade_ideas(raw, '') == [] and grade_ideas({'hooks': 'x'}, CLIP) == [] and grade_ideas(None, CLIP) == []


def test_grades_follow_the_hook_score_and_ideas_are_capped_best_first():
    assert [hook_grade(s, n) for s, n in ((9, 2), (9, 1), (7, 0), (5, 3), (4, 0), (1, 0))] == ['A', 'B', 'B', 'C', 'D', 'F']
    raw = {'hooks': [idea(f'Breaking one rule changed things {n}', evidence='breaking one rule', score=n) for n in range(1, 8)]}
    # Numbers in the text ("1"…"7") were never said, so these are dropped…
    assert grade_ideas(raw, CLIP) == []
    raw = {'hooks': [idea(f'Breaking one rule changed {word}', evidence='breaking one rule', score=n)
                     for n, word in enumerate(['all', 'March', 'leads', 'rules', 'quitting', 'everything', 'us'])]}
    ideas = grade_ideas(raw, CLIP)
    assert len(ideas) == 5 and [i['score'] for i in ideas] == [6, 5, 4, 3, 2]
    assert numbers_supported('From $4,200 down', CLIP) and not numbers_supported('From $4,300 down', CLIP)


def test_clip_text_uses_corrected_words_inside_the_cuts():
    rows = [TranscriptSegment(0, 2000, 'Hello there friends', words=[TranscriptWord('Hello', 0, 500), TranscriptWord('there', 500, 1000), TranscriptWord('friends', 1000, 2000)]),
            TranscriptSegment(3000, 5000, 'Skipped line'), TranscriptSegment(6000, 8000, 'Kept line')]
    assert clip_text(rows, [[600, 1500], [6000, 8000]]) == 'there friends … Kept line'
    long = [TranscriptSegment(0, 1000, 'w' * 20000)]
    assert len(clip_text(long, [[0, 1000]])) < 9100


def settings(**extra):
    return SimpleNamespace(openrouter_api_key='key', openrouter_base_url='https://openrouter.ai/api/v1', planner_model='planner/model',
                           planner_reasoning_effort='medium', get_planner_fallback_models=lambda: ['fallback/one'], **extra)


def reply(hooks, cost=0.004):
    return {'model': 'planner/model', 'choices': [{'message': {'content': json.dumps({'hooks': hooks})}, 'finish_reason': 'stop'}]}, {'cost': cost}


def test_one_request_with_the_planner_model_and_its_cost(monkeypatch):
    calls = []
    async def fake(client, payload):
        calls.append(payload)
        return reply([idea('160 leads for $531 by breaking one rule')])
    monkeypatch.setattr(hook_ideas, 'chat_completion', fake)
    result = asyncio.run(suggest_hooks(settings(), 'Title', CLIP, client=object()))
    assert [i['text'] for i in result['hooks']] == ['160 leads for $531 by breaking one rule']
    assert result['cost_usd'] == 0.004 and result['cost_incomplete'] is False and result['model'] == 'planner/model'
    (payload,) = calls
    assert payload['model'] == 'planner/model' and payload['models'] == ['fallback/one']
    assert payload['reasoning'] == {'effort': 'medium', 'exclude': True}
    assert payload['response_format']['json_schema']['name'] == 'hook_ideas'
    assert CLIP in payload['messages'][1]['content']


def test_unreadable_output_retries_once_and_provider_failures_are_unavailable(monkeypatch):
    replies = [({'choices': [{'message': {'content': 'not json'}}]}, {'cost': None}), reply([], cost=0.002)]
    async def flaky(client, payload):
        return replies.pop(0)
    monkeypatch.setattr(hook_ideas, 'chat_completion', flaky)
    result = asyncio.run(suggest_hooks(settings(), 'Title', CLIP, client=object()))
    assert result['hooks'] == [] and result['cost_usd'] == 0.002 and result['cost_incomplete'] is True
    async def broke(client, payload):
        raise OpenRouterError('out of credits')
    monkeypatch.setattr(hook_ideas, 'chat_completion', broke)
    with pytest.raises(HooksUnavailable):
        asyncio.run(suggest_hooks(settings(), 'Title', CLIP, client=object()))
    keyless = settings()
    keyless.openrouter_api_key = ''
    with pytest.raises(HooksUnavailable):
        asyncio.run(suggest_hooks(keyless, 'T', CLIP))


def candidate(**extra):
    return {'id': 'candidate-1', 'title': 'The result', 'ranges': [[3000, 8000]],
            'scenes': [{'at_ms': 0, 'layout': 'fill', 'crops': [[.1, 0, .31640625, 1]]}], 'captions': True, 'caption_preset': 'pop',
            'video_speed': 1, 'score': 0, 'reason': '', 'review': None, 'exports': [], 'status': 'refining',
            'caption_edits': [{'segment': 1, 'text': 'The corrected event happened.'}], **extra}


def project_dir(tmp_path, candidates):
    rows = [TranscriptSegment(0, 2000, 'Here is the setup.'), TranscriptSegment(3000, 5000, 'The event happened.'),
            TranscriptSegment(6000, 8000, 'That explains the result.')]
    project = {'version': 1, 'revision': 2, 'width': 1920, 'height': 1080, 'duration_ms': 12000, 'aspect_ratio': '9:16',
               'candidates': candidates, 'transcript': [{'start_ms': s.start_time_ms, 'end_ms': s.end_time_ms, 'text': s.text} for s in rows]}
    (tmp_path / 'editor-project.json').write_text(json.dumps(project))
    (tmp_path / 'editor-source.mp4').write_bytes(b'source')
    (tmp_path / 'transcript.json').write_text(json.dumps({'segments': [asdict(s) for s in rows]}))
    return project


def test_run_editor_suggests_hooks_from_the_corrected_clip_without_changing_the_project(monkeypatch, tmp_path):
    project = project_dir(tmp_path, [candidate()])
    seen = {}
    async def fake(settings, title, text, client=None):
        seen.update(title=title, text=text)
        return {'hooks': [{'text': 'x'}], 'cost_usd': 0.01, 'cost_incomplete': False, 'model': 'm'}
    monkeypatch.setattr(hook_ideas, 'suggest_hooks', fake)
    config = {'run': str(tmp_path), 'revision': 2, 'candidate_id': 'candidate-1', 'action': 'suggest-hooks'}
    result = asyncio.run(run_editor(config))
    assert result['cost_usd'] == 0.01
    assert seen == {'title': 'The result', 'text': 'The corrected event happened. That explains the result.'}
    assert json.loads((tmp_path / 'editor-project.json').read_text()) == project
    async def unavailable(*args, **kwargs):
        raise HooksUnavailable('no')
    monkeypatch.setattr(hook_ideas, 'suggest_hooks', unavailable)
    with pytest.raises(EditorError) as error:
        asyncio.run(run_editor(config))
    assert error.value.editor_code == 'hooks_unavailable'
    # A clip where nothing is said makes no request.
    project_dir(tmp_path, [candidate(ranges=[[9000, 12000]], caption_edits=[])])
    assert asyncio.run(run_editor(config)) == {'hooks': []}


@pytest.mark.parametrize('candidates', [
    [], [candidate(), candidate()], [candidate(id='../escape')], [candidate(id='')], [candidate(id=7)],
    [candidate(id=f'c{i}') for i in range(101)], 'not a list',
])
def test_the_whole_clip_list_is_checked_before_any_clip_is_used(tmp_path, candidates):
    with pytest.raises(ValueError):
        validate_candidate_list(candidates)
    if isinstance(candidates, list) and candidates:
        project_dir(tmp_path, candidates)
        with pytest.raises(ValueError) as error:
            asyncio.run(run_editor({'run': str(tmp_path), 'revision': 2, 'candidate_id': 'candidate-1', 'action': 'review'}))
        assert error.value.editor_code == 'invalid_edit'


def test_one_hundred_clips_with_unique_ids_pass():
    validate_candidate_list([candidate(id=f'clip-{i}') for i in range(100)])
