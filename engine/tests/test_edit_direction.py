"""Edit my recording's automatic direction: the plan's motion graphics (schema, guidance, word checks, density), their
placement on the finished reel's clock (chapters, diagrams, word timing), stage scenes, and the reel as an editor project."""
import asyncio
import json
import os
import shutil
import subprocess

import pytest

from clip_engine.services import auto_graphics as ag
from clip_engine.services import edit_direction as ed
from clip_engine.services import edit_recording as er
from clip_engine.services.manual_editor import validate_candidate, validate_candidate_list


def say(text, start, step=0.32, src=0):
    out, t = [], start
    for token in text.split():
        out.append(er.Word(token, round(t * 1000), round((t + step - 0.04) * 1000), src))
        t += step
    return out


def talk():
    """About 40 s of explanation: a claim, three things, a number, a contrast."""
    lines = [
        ("You do not need a huge audience to make money online.", 0.0),
        ("We only need three things to build a real business.", 4.0),
        ("First a product. Then an offer. And finally eyeballs.", 8.0),
        ("Yesterday I spent 4,365 dollars on ads.", 13.0),
        ("Not organic content, not going viral, just paid ads that work.", 18.0),
        ("Turns out about three million people look for that every single week.", 21.5),
        ("And I ended up generating 8,188 dollars in one day.", 26.5),
        ("So focus on making a really good offer.", 31.0),
        ("Hit the link to get all the details.", 35.0),
    ]
    words = []
    for text, start in lines:
        words += say(text, start)
    return words


def at(words, text, after=0):
    return next(i for i, w in enumerate(words) if i >= after and w.text.strip('.,!?').lower() == text.strip('.,!?').lower())


def item(template, word, seconds=4, placement='top', **fields):
    out = {'template': template, 'word': word, 'seconds': seconds, 'placement': placement}
    for k in ag.ALL_FIELDS:
        out[k] = fields.get(k, [] if k in ('items', 'icons', 'notes') else '')
    return out


# ---------------------------------------------------------------------------
# The plan
# ---------------------------------------------------------------------------

def test_the_directed_plan_asks_for_graphics_instead_of_pop_ups_and_cards():
    schema = er.plan_schema(True)
    props = schema['properties']
    assert 'graphics' in props and 'popups' not in props and 'cards' not in props
    assert 'graphics' in schema['required'] and 'popups' not in schema['required']
    one = props['graphics']['items']
    assert 'word' in one['properties'] and 'time' not in one['properties']
    assert set(one['required']) >= {'template', 'word', 'seconds', 'placement'}
    assert 'big_words' in one['properties']['template']['enum'] and 'headline_pill' not in one['properties']['template']['enum']
    combine = er.combine_schema(True)['properties']
    assert {'graphics', 'order', 'proof'} <= set(combine) and 'cards' not in combine
    # Without the direction (camera + screen) the old plan stands.
    assert 'popups' in er.plan_schema(False)['properties'] and 'graphics' not in er.plan_schema(False)['properties']
    prompt = er.plan_system_prompt(True)
    assert 'pop-up' not in prompt.lower() and 'cards:' not in prompt and 'MOTION GRAPHICS' in prompt


def test_the_guidance_asks_for_a_dense_varied_reel_with_the_target_reels_patterns():
    rule = ed.direction_rule(240, {'stage': True, 'cta_keyword': 'GUIDE'})
    # About one per 6-8 s, as numbers for this length, all through the video, varied.
    assert 'about 30 to 40' in rule
    assert 'never the same template twice in a row' in rule and 'WHOLE video' in rule
    for pattern in ('strike_list', 'statement', 'sticky_notes', 'stat', 'icon_pop', 'orbit', 'feature_tile', 'big_words', 'staircase',
                    'funnel', 'journey', 'growth', 'idea_hub', 'compare_marks', 'comment_cta'):
        assert f'"{pattern}"' in rule, pattern
    # Examples from the target reels, the face for personal lines, nothing made up, chapters automatic.
    assert 'typed client' in rule and 'Skip the scraping.' in rule
    assert "face alone" in rule and 'never add a number' in rule and 'Chapter headers' in rule and 'Stage layouts are on' in rule
    assert 'Stage layouts are on' not in ed.direction_rule(60)
    # A short video still gets a few.
    assert 'about 2 to 3.' in ed.direction_rule(10) and ed.graphics_limit(10) == 3


def test_planned_graphics_keep_only_what_was_said_and_anchor_on_kept_words():
    words = talk()
    marks = er.analyze_takes(words)
    raw = [
        item('statement', at(words, 'only'), text='We only need three things', accent='three things'),
        item('staircase', at(words, 'a', after=at(words, 'First')), 12, title='Three things', items=['a product', 'an offer', 'eyeballs'], icons=['gift', 'target', 'users']),
        item('stat', at(words, '4,365'), value='$4,365', label='spent on ads'),
        # The contrast: rejected things, then the better choice.
        item('strike_list', at(words, 'organic'), 5, items=['organic content', 'going viral'], final='just paid ads that work', accent='paid ads'),
        # A number nobody said, a word nobody said, and a meaning word dropped ("not" turned around).
        item('stat', at(words, 'three', after=at(words, 'Turns')), value='5 million', label='people every week'),
        item('statement', at(words, 'Turns'), text='Turns out millions search daily', accent='millions'),
        item('statement', at(words, 'organic'), text='organic content going viral', accent='viral'),
        item('big_words', at(words, '8,188'), 2, text='8,188 dollars'),
        # On the call to action: never.
        item('statement', at(words, 'Hit'), text='Hit the link', accent='link'),
    ]
    hook = (0, at(words, 'online.'))
    cta = (at(words, 'Hit'), len(words) - 1)
    out = ed.plan_graphics(raw, words, marks, {'stage': True}, [hook, cta])
    # Alone (nothing else at its time), the card that drops "not" is still left out: it says the opposite.
    flipped = item('statement', at(words, 'organic'), 3, text='organic content going viral', accent='viral')
    assert ed.plan_graphics([flipped], words, marks) == []
    kept_line = item('statement', at(words, 'organic') - 1, 3, text='Not organic content, not going viral', accent='viral')
    assert [g['template'] for g in ed.plan_graphics([kept_line], words, marks)] == ['statement']
    kinds = [g['template'] for g in out]
    assert kinds == ['statement', 'staircase', 'stat', 'strike_list', 'big_words'], kinds
    for g in out:
        assert marks[g['word']] is None and g['origin'] == 'auto' and ed.GRAPHIC_ID.match(g['id'])
        assert 'item_ms' not in g['fields'] and 'word_ms' not in g['fields']
    # Each starts where its first word is said (a diagram a little before its first item).
    assert words[out[0]['word']].text == 'We'
    assert words[out[2]['word']].text.startswith('4,365') or words[out[2]['word']].text == 'spent'
    assert out[4]['depth'] == 'behind'
    assert out[1]['duration_ms'] >= 6000


def test_a_graphic_on_the_first_kept_word_is_kept_the_reel_opens_on_its_hook():
    words = say('Most coaches lose so many clients.', 0.3) + say('Fifteen billion messages wait.', 3.0)
    marks = er.analyze_takes(words)
    out = ed.plan_graphics([item('statement', 0, 2.5, text='Most coaches lose clients.', accent='clients')], words, marks, {}, [(6, 9)])
    assert [(g['template'], g['word']) for g in out] == [('statement', 0)]


def test_takes_and_clips_never_collide_on_the_plans_clock():
    # Two clips, each starting at 0 s: a graphic in the second is checked against the second's words only.
    words = say('We need a product.', 0.0, src=0) + say('Yesterday I spent 4,365 dollars on ads.', 0.0, src=1)
    marks = er.analyze_takes(words)
    good = item('stat', at(words, '4,365'), value='$4,365', label='spent on ads')
    wrong = item('statement', at(words, 'Yesterday'), text='We need a product', accent='product')
    out = ed.plan_graphics([good, wrong], words, marks)
    assert [g['template'] for g in out] == ['stat']
    assert words[out[0]['word']].src == 1


def test_about_one_graphic_per_six_seconds_never_two_at_once():
    lines = ['Monday cost 1000 dollars.', 'Tuesday brought 1100 sales.', 'Wednesday took 1200 clicks.', 'Thursday made 1300 leads.',
             'Friday reached 1400 people.', 'Saturday gave 1500 views.', 'Sunday saw 1600 replies.', 'Then came 1700 signups.',
             'After that 1800 orders.', 'Finally 1900 buyers.']
    words = []
    for k, line in enumerate(lines):
        words += say(line, k * 3.0)
    marks = er.analyze_takes(words)
    raw = [item('stat', i, 3, value=w.text.strip('.'), label=words[i + 1].text.strip('.')) for i, w in enumerate(words) if w.text[0].isdigit()]
    out = ed.plan_graphics(raw, words, marks)
    assert 2 <= len(out) <= ed.graphics_limit(30)
    starts = sorted(words[g['word']].start_ms for g in out)
    ends = {words[g['word']].start_ms: words[g['word']].start_ms + g['duration_ms'] for g in out}
    assert all(ends[a] <= b for a, b in zip(starts, starts[1:]))


def test_a_plan_call_with_the_direction_returns_the_graphics_to_review(monkeypatch):
    words = talk()
    seen = {}

    async def fake_completion(client, payload):
        seen['payload'] = payload
        plan = {'hooks': [{'start': 0, 'end': 10, 'text': 'You do not need a huge audience', 'why': ''}], 'cuts': [],
                'cta': {'present': False, 'start': 0, 'end': 0}, 'sounds': [],
                'graphics': [item('stat', at(words, '4,365'), value='$4,365', label='spent on ads')]}
        return {'choices': [{'message': {'content': json.dumps(plan)}}]}, {'cost': 0.01}

    monkeypatch.setattr(er, 'chat_completion', fake_completion)
    review = asyncio.run(er.plan_edit({'words': words, 'names': ['take.mp4'], 'direction': {'stage': True}}, lambda *_: None))
    system = seen['payload']['messages'][0]['content']
    assert 'MOTION GRAPHICS' in system and 'popups' not in json.dumps(seen['payload']['response_format'])
    assert [g['template'] for g in review['graphics']] == ['stat']
    assert review['graphics'][0]['fields'] == {'value': '$4,365', 'label': 'spent on ads'}


# ---------------------------------------------------------------------------
# On the reel
# ---------------------------------------------------------------------------

def reel(words):
    """The reel's timed words as build_timeline makes them (everything kept, as said)."""
    _, timed = er.build_timeline(words, [True] * len(words), None, None)
    return timed


def test_on_the_reel_graphics_are_timed_on_the_words_and_chapters_come_from_the_structure():
    words = (say('Step one, come up with your idea.', 0.5) + say('Pick a problem people pay to fix every week.', 3.0)
             + say('Step two, get clear on your avatar.', 7.0) + say('Urgent, useful, specific and unique.', 9.5)
             + say('Step three, build the pitch.', 14.0) + say('We spent 4,365 dollars on ads.', 16.5))
    timed = reel(words)
    total = timed[-1][2] + 400
    specs = [
        {'id': 'g-hub', 'template': 'idea_hub', 'word': at(words, 'Urgent,'), 'duration_ms': 8000, 'placement': 'top', 'origin': 'auto',
         'fields': {'items': 'Urgent\nuseful\nspecific\nunique'}},
        {'id': 'g-stat', 'template': 'stat', 'word': at(words, '4,365'), 'duration_ms': 3000, 'placement': 'top', 'origin': 'auto',
         'fields': {'value': '$4,365', 'label': 'on ads'}},
        # The member's own, as they set it (not checked against the words).
        {'id': 'g-mine', 'template': 'title', 'word': at(words, 'Pick'), 'duration_ms': 2000, 'placement': 'middle', 'origin': 'member',
         'fields': {'text': 'My words'}},
    ]
    graphics, notes = ed.editor_graphics(specs, timed, total, {'motion': True, 'stage': True, 'chapters': True})
    by = {g['template']: g for g in graphics}
    assert notes == []
    chapters = [g for g in graphics if g['template'] == 'chapter']
    assert [c['fields']['label'] for c in chapters] == ['Step #1.', 'Step #2.', 'Step #3.']
    assert chapters[0]['fields']['title'].startswith('Come Up With Your Idea')
    hub = by['idea_hub']
    assert hub['size'] == 'stage' and len(hub['fields']['item_ms'].split('\n')) == 4
    assert abs(hub['at_ms'] - (timed[at(words, 'Urgent,')][1] - ag.DIAGRAM_LEAD_MS)) <= 50
    assert by['title']['fields'] == {'text': 'My words'} and by['title']['origin'] == 'member'
    assert by['stat']['at_ms'] == timed[at(words, '4,365')][1]
    # With an opening before the reel, everything moves by its length.
    shifted, _ = ed.editor_graphics(specs, timed, total, {'motion': True, 'chapters': True}, offset_ms=3500)
    assert next(g['at_ms'] for g in shifted if g['template'] == 'stat') == by['stat']['at_ms'] + 3500
    # Motion graphics off: the planned ones and the chapters go, the member's stay.
    off, _ = ed.editor_graphics(specs, timed, total, {'motion': False, 'chapters': True})
    assert [g['template'] for g in off] == ['title']


def test_on_the_reel_cut_words_drop_their_graphic_and_pop_ups_cards_and_pins_become_graphics():
    words = talk()
    keep = [True] * len(words)
    gone = at(words, '4,365')
    keep[gone] = False
    _, timed = er.build_timeline(words, keep, None, None)
    specs = [{'id': 'g-gone', 'template': 'stat', 'word': gone, 'duration_ms': 3000, 'placement': 'top', 'origin': 'auto',
              'fields': {'value': '$4,365', 'label': 'spent on ads'}}]
    popups = [{'word': at(words, 'three'), 'text': 'three things', 'kind': 'keyword'},
              {'word': at(words, '8,188'), 'text': '$8,188', 'kind': 'number'},
              {'word': at(words, 'organic'), 'kind': 'card', 'seconds': 4, 'card': {'type': 'compare', 'title': '', 'items': ['organic content', 'paid ads']}}]
    pins = [{'word': at(words, 'offer', after=at(words, 'focus')), 'image': 'a' * 16 + '.png'}]
    graphics, notes = ed.editor_graphics(specs, timed, timed[-1][2], {'motion': True}, popups=popups, pins=pins)
    assert [g['template'] for g in graphics] == ['title', 'before_after', 'stat', 'logo']
    assert graphics[2]['fields'] == {'value': '$8,188'}
    assert graphics[3]['fields'] == {'image': 'a' * 16 + '.png'}
    assert notes and 'cut' in notes[0]


def test_stage_scenes_go_around_the_stage_cards_and_diagrams_but_not_over_a_filmed_screen():
    graphics = [{'id': 'g-1', 'template': 'statement', 'at_ms': 3000, 'duration_ms': 3000, 'size': 'stage', 'origin': 'auto', 'fields': {}},
                {'id': 'g-2', 'template': 'staircase', 'at_ms': 12000, 'duration_ms': 9000, 'size': 'stage', 'origin': 'auto', 'fields': {}},
                {'id': 'g-3', 'template': 'list', 'at_ms': 30000, 'duration_ms': 4000, 'size': 'stage', 'origin': 'auto', 'fields': {}}]
    scenes = ed.editor_scenes(graphics, 40000, None)
    assert [s['scene'] for s in scenes] == ['stage', 'visual', 'stage']
    assert scenes[1]['backdrop'] == 'solid'
    assert ag.checked_saved_scenes(scenes, 40000) == scenes
    # A filmed screen from 29 to 36 s: no stage there; the list there is drawn as a card.
    avoid = ed.editor_scenes(graphics, 40000, '#FF5500', [(29000, 36000)])
    assert [s['scene'] for s in avoid] == ['stage', 'visual'] and avoid[0]['backdrop'] == 'grid'
    sized = ed.size_for_scenes(graphics, avoid)
    assert [g['size'] for g in sized] == ['stage', 'stage', 'card']


def test_the_editor_project_is_one_ready_clip_the_editor_and_its_bake_accept():
    words = talk()
    timed = reel(words)
    total = timed[-1][2] + 300
    segments = ed.reel_segments(timed)
    graphics, _ = ed.editor_graphics([{'id': 'g-stat', 'template': 'stat', 'word': at(words, '4,365'), 'duration_ms': 3000, 'placement': 'top',
                                       'origin': 'auto', 'fields': {'value': '$4,365', 'label': 'spent on ads'}}], timed, total, {'motion': True})
    look = er.Look('You do not need a huge audience', {'look': 'floating', 'color': '#FFFFFF', 'font': 'serif'}, True, 'pop', None)
    project = ed.edit_project('My reel', total, segments, look, graphics, [], {'handle': '@me', 'logo': False, 'position': 'bottom-right'}, 'a' * 32)
    c = project['candidates'][0]
    validate_candidate(c, total, len(segments))
    validate_candidate_list(project['candidates'])
    assert (c['id'], c['status'], c['library_clip'], c['ranges']) == ('edit-reel', 'ready', 0, [[0, total]])
    assert c['hook']['text'] == 'You do not need a huge audience' and c['captions'] is True and c['graphics'] == graphics
    assert project['brand_mark']['handle'] == '@me' and project['aspect_ratio'] == '9:16'
    from pathlib import Path
    from clip_engine.services.manual_editor import automatic_extras
    assert automatic_extras(Path('/nowhere'), project)['brand_mark']['handle'] == '@me'
    assert len(project['transcript']) == len(segments)


def test_the_bridge_checks_the_review_graphics_it_sends():
    import edit_runner
    words = [['Hello', 0, 400, 0], ['world.', 450, 900, 0], ['Again.', 1000, 1400, 0]]
    base = {'mode': 'render', 'output_dir': '/tmp/edit-x', 'sources': ['/tmp/a.mp4'], 'words': words, 'keep': [True, True, True], 'popups': [], 'sounds': []}
    ok = {'id': 'g-abcdef', 'template': 'stat', 'word': 1, 'duration_ms': 3000, 'placement': 'top', 'fields': {'value': '5'}, 'origin': 'auto'}
    parsed = edit_runner.parse_request({**base, 'editor': {'graphics': [ok], 'pins': [{'word': 0, 'image': 'a' * 16 + '.png'}], 'motion': True, 'stage': True,
                                                          'brand_color': '#112233'}})
    assert parsed['editor']['graphics'][0]['template'] == 'stat' and parsed['editor']['stage'] is True
    for bad in ({**ok, 'template': 'script'}, {**ok, 'word': 9}, {**ok, 'fields': {'Value': 'x'}}, {**ok, 'duration_ms': 100}, {**ok, 'id': '../x'}):
        with pytest.raises(ValueError):
            edit_runner.parse_request({**base, 'editor': {'graphics': [bad]}})
    with pytest.raises(ValueError):
        edit_runner.parse_request({**base, 'editor': {'pins': [{'word': 0, 'image': '../x.png'}]}})
    with pytest.raises(ValueError):
        edit_runner.parse_request({**base, 'editor': {'brand_color': 'red'}})
    plan = edit_runner.parse_request({'mode': 'plan', 'output_dir': '/tmp/x', 'sources_count': 1, 'words': words, 'direction': {'stage': True, 'cta_keyword': 'GUIDE'}})
    assert plan['direction'] == {'stage': True, 'cta_keyword': 'GUIDE'}


def _ffmpeg_ok():
    return shutil.which('ffmpeg') is not None


@pytest.mark.skipif(not _ffmpeg_ok(), reason='needs FFmpeg')
def test_a_render_with_the_direction_makes_an_editor_project_with_its_graphics_and_scenes(tmp_path):
    root = str(tmp_path / 'edit-run')
    os.makedirs(root)
    source = str(tmp_path / 'recording.mp4')
    words = talk()
    seconds = 40
    expr = '+'.join(f'between(t,{w.start_ms / 1000:.3f},{w.end_ms / 1000:.3f})' for w in words)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc2=s=720x1280:r=30:d={seconds}', '-f', 'lavfi', '-i',
                    f"aevalsrc='0.25*sin(2*PI*300*t)*({expr})':s=48000:d={seconds}", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-shortest', source], check=True)
    marks = er.analyze_takes(words)
    raw = [item('statement', at(words, 'only'), text='We only need three things', accent='three things'),
           item('stat', at(words, '4,365'), value='$4,365', label='spent on ads'),
           item('strike_list', at(words, 'organic'), 5, items=['organic content', 'going viral'], final='just paid ads that work', accent='paid ads')]
    planned = ed.plan_graphics(raw, words, marks, {'stage': True})
    look = er.Look('You do not need a huge audience', {'look': 'floating', 'color': '#FFFFFF', 'font': 'serif'}, True, 'pop', None)
    config = {'output_dir': root, 'sources': [source], 'words': words, 'keep': [m is None for m in marks], 'hook': None, 'cta': None,
              'popups': [], 'sounds': [], 'look': look, 'title': 'My reel', 'cost_usd': 0, 'sound_cache': str(tmp_path / 'sounds'),
              'editor': {'graphics': planned, 'pins': [], 'motion': True, 'stage': True, 'brand_color': None, 'cta_keyword': ''}}
    result = asyncio.run(er.render_edit(config, lambda *_: None))
    assert result['editor'] is True and result['graphics'] >= 3 and result['scenes'] >= 1
    project = json.load(open(os.path.join(root, 'editor-project.json')))
    c = project['candidates'][0]
    assert {g['template'] for g in c['graphics']} >= {'statement', 'stat', 'strike_list'}
    assert any(s['scene'] == 'stage' for s in c['stage_scenes'])
    assert os.path.isfile(os.path.join(root, 'editor-source.mp4')) and os.path.isfile(os.path.join(root, f"editor-preview-{project['preview_id']}.mp4"))
    job = json.load(open(os.path.join(root, 'job_output.json')))
    assert job['editor_project'] is True and job['clips'][0]['clip_index'] == 0 and 'editor_candidate' not in job['clips'][0]
    assert 'editable' not in job['clips'][0]
    segments = json.load(open(os.path.join(root, 'transcript.json')))['segments']
    assert segments and segments[0]['words'][0]['word'] == 'You'
    assert os.path.isfile(result['path'])


def test_two_graphics_the_cut_brings_together_share_the_time_instead_of_one_vanishing():
    stat = {'id': 'g-stat01', 'template': 'stat', 'at_ms': 1000, 'duration_ms': 3500, 'placement': 'top', 'fields': {'value': '$5'}}
    strike = {'id': 'g-strike', 'template': 'strike_list', 'at_ms': 3000, 'duration_ms': 4000, 'placement': 'top', 'fields': {'items': 'a', 'final': 'b'}}
    word = {'id': 'g-words1', 'template': 'statement', 'at_ms': 3200, 'duration_ms': 2000, 'placement': 'top', 'fields': {'text': 'x y', 'word_ms': '0\n1900'}}
    out = ed.settle([stat, strike])
    assert [(g['id'], g['at_ms'], g['duration_ms']) for g in out] == [('g-stat01', 1000, 1850), ('g-strike', 3000, 4000)]
    # Too close to share: the weaker one goes; a shortened word card keeps its words' times inside it.
    assert [g['id'] for g in ed.settle([strike, word])] == ['g-strike']
    assert ed.shortened(word, 1000)['fields']['word_ms'] == '0\n700'
