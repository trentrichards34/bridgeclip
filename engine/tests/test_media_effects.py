"""Effects on the member's own screenshots and the data effects with variables: the catalog's picture fields (cleaned,
never said), the director placing the member's screenshots where a screen, a proof or a before and after is said (only
when they added some, never in a story or the minimal style), the planner's hints, Edit my recording's plan, and the
words-said rules for charts (every number said while it builds) and flows (every step said, in order)."""
from clip_engine.services import auto_graphics as ag
from clip_engine.services import edit_direction as ed
from clip_engine.services import edit_recording as er
from clip_engine.services import graphics_director as gd
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord


def seg(text, start_s, step=0.35):
    words, t = [], start_s
    for token in text.split():
        words.append(TranscriptWord(token, round(t * 1000), round((t + step - 0.05) * 1000)))
        t += step
    return TranscriptSegment(words[0].start_time_ms, words[-1].end_time_ms, text, words=words)


def ms(segments, token):
    return next(w.start_time_ms for s in segments for w in s.words if w.word.strip('.,!?').lower() == token.lower())


def fxg(at, length, **fields):
    return {'template': 'fx', 'at_ms': at, 'duration_ms': length, 'placement': 'middle', 'fields': fields}


SHOTS = [{'id': 'aaaaaaaaaaaa', 'box': [0.1, 0.2, 0.3, 0.1]}, {'id': 'bbbbbbbbbbbb', 'tall': True}, {'id': 'cccccccccccc'}]


def test_the_catalog_marks_picture_effects_and_their_fields_are_cleaned_never_said():
    cat = ag.fx_catalog()
    for e in ag.MEDIA_FX:
        assert e in cat and e not in ag.AUTO_FX, e
    assert cat['browser-device-stage']['needs_picture'] is True and cat['browser-device-stage']['pictures'] == ['image']
    assert cat['torn-paper-rip']['needs_picture'] is False and cat['torn-paper-rip']['either'] == ['image', 'second']
    assert cat['before-after-wipe']['pictures'] == ['image', 'image_b']
    for f in cat['light-sweep-pass']['fields']:
        if f['kind'] in ('image', 'region') or f['key'] == 'mark':
            assert f['said'] is False
    clean = ag.fx_clean_fields({'effect': 'browser-device-stage', 'image': 'aaaaaaaaaaaa', 'mark': 'circle', 'mark_box': '0.1, 0.2, 0.3, 0.1', 'title': 'yoursite.com'})
    assert clean == {'effect': 'browser-device-stage', 'image': 'aaaaaaaaaaaa', 'title': 'yoursite.com', 'mark': 'circle', 'mark_box': '0.1, 0.2, 0.3, 0.1'}
    bad = ag.fx_clean_fields({'effect': 'browser-device-stage', 'image': '../../etc/passwd', 'mark': 'heart', 'mark_box': '0.9, 0, 0.5, 0.5'})
    assert bad == {'effect': 'browser-device-stage'}
    assert not ag.fx_has_content(bad) and ag.fx_has_content(clean)
    assert not ag.fx_has_content({'effect': 'torn-paper-rip', 'first': 'Old way'})
    assert ag.fx_has_content({'effect': 'torn-paper-rip', 'first': 'Old way', 'image': 'aaaaaaaaaaaa'})
    # The new charts and flows are on the planner's menu; picture effects never are.
    for e in ('data-chart', 'animated-bar-chart', 'mk-line-graph', 'flowchart', 'onboarding-stepper-flow'):
        assert e in ag.AUTO_FX and f'{e}(' in gd.compact_catalog()
    assert 'browser-device-stage(' not in gd.compact_catalog()
    assert 'fx:mk-line-graph' in gd.CUE_VISUALS['trend'] and 'fx:flowchart' in gd.CUE_VISUALS['steps']


def test_without_screenshots_nothing_is_placed_and_the_hints_never_offer_them():
    talk = [seg('Go to this website and look at the dashboard.', 1), seg('Here is what it looked like before and after.', 6),
            seg('Look at this comment they sent me.', 12)]
    planned = [fxg(1000, 3000, effect='count-up', value='3')]
    assert gd.place_media(planned, talk, None) == planned
    assert gd.place_media(planned, talk, []) == planned
    assert gd.place_media(planned, talk, [{'id': '../x'}]) == planned
    hints = gd.cue_hints(talk)
    assert 'browser-device-stage' not in hints and 'proof' not in hints and 'before_after' not in hints
    assert 'browser_frame' in hints
    # With screenshots, those moments are marked as theirs (left free for the app).
    marked = gd.cue_hints(talk, media=True)
    assert "the member's screenshot" in marked and 'before_after' in marked


def test_screenshots_go_where_a_screen_a_before_and_after_or_a_proof_is_said_in_the_order_added():
    talk = [seg('Go to this website and look at the pricing page.', 1), seg('This is what my page looked like before and after the redesign.', 9),
            seg('And look at this comment from a client.', 18)]
    planned = [fxg(ms(talk, 'pricing') - 200, 3000, effect='headline-slam', text='the pricing page'), fxg(24000, 3000, effect='count-up', value='3')]
    out = gd.place_media(planned, talk, SHOTS)
    effects = [g['fields']['effect'] for g in out]
    # A wide screenshot in a browser window (with the member's circle), a before and after... and no third picture left.
    assert effects == ['browser-device-stage', 'count-up'] or effects[:2] == ['browser-device-stage', 'before-after-wipe'], effects
    browser = out[0]
    assert browser['fields']['image'] == 'aaaaaaaaaaaa' and browser['fields']['mark'] == 'circle' and browser['fields']['mark_box'] == '0.1, 0.2, 0.3, 0.1'
    assert browser['size'] == 'stage' and browser['origin'] == 'auto' and browser['at_ms'] <= ms(talk, 'website')
    # The planned slam over the same moment gave way to the member's picture.
    assert not any(g['fields']['effect'] == 'headline-slam' for g in out)
    wipe = next(g for g in out if g['fields']['effect'] == 'before-after-wipe')
    assert (wipe['fields']['image'], wipe['fields']['image_b']) == ('bbbbbbbbbbbb', 'cccccccccccc')
    # Its chips say only the words said ("before", "after").
    assert wipe['fields']['label_a'] == 'Before' and wipe['fields']['label_b'] == 'After'
    # Words said: everything a placed picture effect shows is said (nothing else on it is words).
    for g in out:
        if g['fields']['effect'] in ag.MEDIA_FX:
            assert ag.words_said(g, talk), g['fields']['effect']


def test_a_phone_shaped_proof_goes_in_a_phone_a_wide_one_under_a_light_with_its_underline():
    proof = [seg('Look at this comment they sent me last week.', 2)]
    (tall,) = gd.place_media([], proof, [{'id': 'bbbbbbbbbbbb', 'tall': True, 'box': [0.1, 0.5, 0.8, 0.1]}])
    assert tall['fields'] == {'effect': 'device-frame-stage', 'image': 'bbbbbbbbbbbb', 'mark': 'underline', 'mark_box': '0.1, 0.5, 0.8, 0.1'}
    (wide,) = gd.place_media([], proof, [{'id': 'cccccccccccc'}])
    assert wide['fields'] == {'effect': 'light-sweep-pass', 'image': 'cccccccccccc'}
    assert wide['duration_ms'] >= 4000


def test_never_in_a_personal_story_or_the_minimal_style_and_never_two_close_together():
    story = [seg('I remember when I was broke and scared.', 1), seg('I felt so ashamed, look at this message my mom sent.', 4)]
    assert gd.place_media([], story, SHOTS) == []
    talk = [seg('Go to this website now.', 1), seg('Look at this dashboard too.', 3.5)]
    assert gd.place_media([], talk, SHOTS, register='minimal') == []
    out = gd.place_media([], talk, SHOTS)
    assert len(out) == 1


def test_edit_my_recordings_plan_puts_the_screenshots_on_their_moments_anchored_on_kept_words():
    words = []
    t = 0.0
    for line in ('Today I will show you my new site.', 'Go to this website and check the pricing page.', 'It took me a week to build it.',
                 'This is how the page looked before and after.', 'Then I posted it and people loved it.', 'Look at this comment from a client.'):
        for token in line.split():
            words.append(er.Word(token, round(t * 1000), round((t + 0.28) * 1000), 0))
            t += 0.32
        t += 1.2
    marks = er.analyze_takes(words)
    out = ed.plan_graphics([], words, marks, {'media': SHOTS})
    assert [g['fields']['effect'] for g in out][:1] == ['browser-device-stage']
    first = out[0]
    assert words[first['word']].text in ('Go', 'to', 'this', 'website') or first['word'] <= 9
    assert first['size'] == 'stage' and first['fields']['theme'] == 'dark'
    # Without screenshots the same plan places none.
    # (The quiet stretches' own visuals aside: graphics_director.fill_quiet.)
    assert ed.plan_graphics([], words, marks, {'fill_quiet': False}) == []
    # The guidance tells the planner the moments are taken.
    assert 'added screenshots' in ed.direction_rule(30, {'media': SHOTS})
    assert 'added screenshots' not in ed.direction_rule(30, {})


def test_charts_need_every_number_said_while_they_build_and_flows_every_step_in_order():
    talk = [seg('In January we had 12 members, in February 28, in March 45 and in April 64.', 1)]
    at = ms(talk, 'January') - 200
    chart = fxg(at, 6000, effect='data-chart', data='12\n28\n45\n64', labels='January\nFebruary\nMarch\nApril')
    assert gd.fx_sane(chart['fields']) and ag.words_said(chart, talk)
    # A number nobody said, or the months out of order, and it is left out.
    assert not ag.words_said({**chart, 'fields': {**chart['fields'], 'data': '12\n28\n45\n70'}}, talk)
    assert not ag.words_said({**chart, 'fields': {**chart['fields'], 'labels': 'February\nJanuary\nMarch\nApril'}}, talk)
    # Too few numbers for a chart or a line.
    assert not gd.fx_sane({'effect': 'mk-line-graph', 'data': '12\n28'})
    assert not gd.fx_sane({'effect': 'data-chart', 'data': '12\nmany\n45'})
    assert gd.fx_sane({'effect': 'animated-bar-chart', 'value': '+42%', 'data': '42\n95'})
    steps = [seg('First you write the script, then you film it, then you post it.', 1)]
    flow = fxg(ms(steps, 'write') - 300, 5000, effect='flowchart', steps='write the script\nfilm it\npost it')
    assert gd.fx_sane(flow['fields']) and ag.words_said(flow, steps)
    assert not ag.words_said({**flow, 'fields': {**flow['fields'], 'steps': 'post it\nfilm it'}}, steps)
    assert not gd.fx_sane({'effect': 'onboarding-stepper-flow', 'steps': 'one'})
    stepper = fxg(ms(steps, 'write') - 300, 5000, effect='onboarding-stepper-flow', steps='write the script\nfilm it\npost it')
    assert ag.words_said(stepper, steps)
    # Their beats land on each step as said.
    times = gd.fx_cue_times(stepper, steps)
    assert times and len(times) == 3 and times == sorted(times)
