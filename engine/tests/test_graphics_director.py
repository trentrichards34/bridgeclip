"""The graphics director (graphics_director.py): cues found in the words, the register and its density, plain text cards
as a capped fallback, one look per video, effects placed by the planner (words said, units, sanity), their beats on the
spoken words (cue_ms) and their holds, and the planner's guidance."""
from clip_engine.services import auto_graphics as ag
from clip_engine.services import edit_direction as ed
from clip_engine.services import graphics_director as gd
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord


def seg(text, start_s, step=0.35):
    words, t = [], start_s
    for token in text.split():
        words.append(TranscriptWord(token, round(t * 1000), round((t + step - 0.05) * 1000)))
        t += step
    return TranscriptSegment(words[0].start_time_ms, words[-1].end_time_ms, text, words=words)


def word_ms(segments, token):
    return next(w.start_time_ms for s in segments for w in s.words if w.word.strip('.,!?').lower() == token.lower())


def kinds(cues):
    return [c['kind'] for c in cues]


def raw(template, time, seconds=3, **fields):
    out = {'template': template, 'time': time, 'seconds': seconds, 'placement': 'top', 'effect': '', 'fx_fields': []}
    for k in ag.ALL_FIELDS:
        out[k] = fields.get(k, [] if k in ('items', 'icons', 'notes') else '')
    return out


def fx(effect, time, seconds=3, **fields):
    return {**raw('fx', time, seconds), 'effect': effect, 'fx_fields': [{'key': k, 'value': v} for k, v in fields.items()]}


# --- cues ---------------------------------------------------------------------

def test_numbers_are_told_apart_money_percent_rating_and_count():
    cues = gd.find_cues([seg('Yesterday we made $4,215 in sales.', 1), seg('About 80% of people never finish.', 6),
                         seg('It is rated 4.9 stars by buyers.', 11), seg('We reach 3 million people every week.', 16)])
    assert [c['kind'] for c in cues if c['kind'] in ('money', 'percent', 'rating', 'count')] == ['money', 'percent', 'rating', 'count']
    money = cues[0]
    assert money['prefer'][0] == 'fx:count-up' and '$4,215' in money['text']
    assert next(c for c in cues if c['kind'] == 'percent')['prefer'][0] == 'fx:conic-progress-ring'
    assert next(c for c in cues if c['kind'] == 'rating')['prefer'] == ('fx:star-rating-fill',)
    # A step number is not a figure.
    assert not [c for c in gd.find_cues([seg('Step two is the offer.', 1)]) if c['kind'] == 'count']


def test_trends_steps_lists_contrasts_typing_brands_screens_and_ctas():
    found = kinds(gd.find_cues([
        seg('We went from 82 down to 34 sales.', 1),
        seg('Step one, build the product. Step two, write the offer.', 6),
        seg('You need emails, calls, meetings and reports.', 13),
        seg('Use a typed client instead of scraping.', 18),
        seg('I typed the prompt into Claude.', 23),
        seg('As you can see on this website.', 28),
        seg('Comment GUIDE and I will send it.', 33),
    ]))
    for kind in ('trend', 'steps', 'list', 'contrast', 'typing', 'brand', 'screen', 'cta'):
        assert kind in found, (kind, found)
    lst = next(c for c in gd.find_cues([seg('You need emails, calls, meetings and reports.', 1)]) if c['kind'] == 'list')
    assert lst['text'] == 'emails, calls, meetings, reports' and lst['prefer'][0] == 'fx:marker-checklist-card'


def test_personal_story_is_a_quiet_stretch_but_a_result_said_is_proof():
    segments = [seg('I remember when I was a kid my dad worked two jobs.', 1), seg('I felt so scared every single night.', 5.5),
                seg('Then I made $10,000 in one month.', 10)]
    cues = gd.find_cues(segments)
    (story,) = gd.story_spans(cues)
    assert story[0] == word_ms(segments, 'I') and story[1] < word_ms(segments, 'Then')
    assert 'money' in kinds(cues)
    assert gd.in_story({'at_ms': story[0] + 500, 'duration_ms': 2000}, [story])
    assert not gd.in_story({'at_ms': story[1] - 200, 'duration_ms': 3000}, [story])
    # Teaching words alone are never a story.
    assert not gd.story_spans(gd.find_cues([seg('Your offer needs a clear promise and a deadline.', 1)]))


def test_hints_are_short_lines_with_the_visual_that_fits():
    hints = gd.cue_hints([seg('We made $4,215 yesterday.', 1), seg('I remember my dad crying that night, I felt lost.', 5)])
    lines = hints.split('\n')
    assert lines[0].startswith('1.') and 'money' in lines[0] and 'fx:count-up' in lines[0]
    assert any('story/emotion -> NO graphic' in line for line in lines)
    # Edit my recording: anchored on word indices.
    labeled = gd.cue_hints([seg('We made $4,215 yesterday.', 1)], label=lambda ms: 'w7')
    assert labeled.startswith('w7 money')


# --- register and density -----------------------------------------------------

def test_register_is_detected_and_scales_density():
    teaching = gd.find_cues([seg('We made $500 and spent $200 on ads.', 1), seg('Step one, pick a niche.', 6)])
    assert gd.detect_register(teaching, 30_000) == 'teaching'
    story = gd.find_cues([seg('I remember my mom crying in the kitchen that night.', 1), seg('I felt so alone and scared back then.', 5),
                          seg('My dad never came home, I was heartbroken.', 9)])
    assert gd.detect_register(story, 14_000) == 'story'
    assert gd.seconds_per_graphic('teaching', 45) == 6.5 and gd.seconds_per_graphic('teaching', 150) == 10
    assert gd.seconds_per_graphic('story', 45) == 13
    # Create: a 45-s teaching clip about 6 graphics, a story half, minimal a few.
    assert ag.max_cards(45_000, 'teaching') == 6 and ag.max_cards(45_000, 'story') == 3 and ag.max_cards(45_000, 'minimal') == 3
    assert ag.max_cards(120_000, 'teaching') == 12
    # Without a register: as before.
    assert ag.max_cards(45_000) == 4
    # Edit my recording: one per 9 s teaching, half for a story.
    assert ed.graphics_limit(240, 'teaching') == 26 and ed.graphics_limit(240, 'story') == 13 and ed.graphics_limit(240) == 26
    assert ed.graphics_target(240, 'story')[1] <= 13


def test_minimal_keeps_only_numbers_hook_and_cta():
    segments = [seg('We made $4,215 yesterday with one simple offer.', 2), seg('Skip the scraping and use a typed client.', 9)]
    planned = [ag.parse_planned([fx('count-up', 2.5, value='4,215', prefix='$')], 0, 30_000)[0],
               ag.parse_planned([raw('statement', 9, text='Skip the scraping', accent='scraping')], 0, 30_000)[0]]
    out = ag.fit_to_clip(planned, segments, [(0, 20_000)], 1.0, {'register': 'minimal'})
    assert [gd.kind_of(g) for g in out] == ['fx:count-up']


def test_nothing_plays_over_a_personal_story():
    segments = [seg('I remember my dad crying, I felt so scared that night.', 2), seg('Now we sell 3 courses every single day.', 9)]
    planned = ag.parse_planned([raw('statement', 2.0, text='I felt so scared that night', accent='scared'),
                                raw('stat', 9.6, value='3', label='courses every single day')], 0, 30_000)
    out = ag.fit_to_clip(planned, segments, [(0, 20_000)], 1.0, {})
    assert [g['template'] for g in out] == ['stat']


# --- fallback caps --------------------------------------------------------------

def test_plain_cards_are_a_capped_fallback_and_slams_at_most_two():
    assert gd.plain_cap(30) == 1 and gd.plain_cap(240) == 5
    kept = [{'template': 'statement', 'at_ms': 0, 'duration_ms': 1000, 'fields': {}}]
    assert not gd.group_allows('quote', kept, 40)
    assert gd.group_allows('quote', kept, 100)
    slams = [{'template': 'fx', 'at_ms': 0, 'duration_ms': 1000, 'fields': {'effect': e}} for e in ('headline-slam', 'per-word-rise')]
    assert not gd.group_allows('fx:kinetic-center-build', slams, 600)
    assert gd.group_allows('fx:count-up', slams, 600)


def test_a_plain_statement_becomes_a_richer_visual_its_words_fit():
    segments = [seg('You can actually make a profit with this.', 3)]
    planned = ag.parse_planned([raw('statement', 3, text='You can actually make a profit', accent='profit')], 0, 20_000)
    (g,) = ag.fit_to_clip(planned, segments, [(0, 20_000)], 1.0, {})
    assert gd.kind_of(g) == 'fx:marker-highlight'
    assert g['fields']['text'] == 'You can actually make a profit' and g['fields']['word'] == 'profit'
    # Its marker lands on "profit"; it starts on its first word.
    assert g['at_ms'] <= word_ms(segments, 'You')
    assert int(g['fields']['cue_ms']) == word_ms(segments, 'profit') - g['at_ms']


def test_stat_conversions_split_the_number():
    stat = {'template': 'stat', 'at_ms': 0, 'duration_ms': 3000, 'fields': {'value': '$4,215', 'label': 'spent on ads'}}
    assert gd.convert(stat, 'fx:count-up')['fields'] == {'effect': 'count-up', 'value': '4,215', 'prefix': '$'}
    million = {**stat, 'fields': {'value': '3 million'}}
    assert gd.convert(million, 'fx:count-up')['fields'] == {'effect': 'count-up', 'value': '3', 'suffix': ' million'}
    assert gd.convert({**stat, 'fields': {'value': '10x'}}, 'fx:number-pop-in')['fields'] == {'effect': 'number-pop-in', 'value': '10', 'unit': 'x'}
    back = gd.convert({'template': 'fx', 'at_ms': 0, 'duration_ms': 3000, 'fields': {'effect': 'count-up', 'value': '4,215', 'prefix': '$'}}, 'stat')
    assert back['fields'] == {'value': '$4,215'}


# --- one look -------------------------------------------------------------------

def test_one_look_for_the_whole_video():
    gs = [{'template': t, 'at_ms': i * 1000, 'duration_ms': 900, 'fields': {}} for i, t in enumerate(['statement', 'stat', 'statement', 'list'])]
    gs.append({'template': 'fx', 'at_ms': 9000, 'duration_ms': 900, 'fields': {'effect': 'count-up', 'value': '3'}})
    dark = gd.with_look(gs, gd.video_look({}))
    assert [g['fields'].get('variant') for g in dark[:4]] == ['glass', 'gradient', 'glass', 'pills'] and dark[4]['fields']['theme'] == 'dark'
    light = gd.with_look(gs, gd.video_look({'tone': 'light'}))
    assert {g['fields'].get('variant') for g in light[:4]} == {'card'} and light[4]['fields']['theme'] == 'light'
    # A look the member picked stays.
    mine = gd.with_look([{**gs[0], 'fields': {'variant': 'bold'}}], gd.video_look({}))
    assert mine[0]['fields']['variant'] == 'bold'


def test_create_clips_get_one_look_and_the_white_hook_picks_light():
    from clip_engine.services.ai_clipping_pipeline import ClippingJobRequest, graphics_options
    request = ClippingJobRequest(video_url='x', headline_look={'look': 'white'}, graphics_register='story')
    opts = graphics_options(request)
    assert opts['tone'] == 'light' and opts['register'] == 'story'
    assert graphics_options(ClippingJobRequest(video_url='x'))['tone'] == 'dark'
    segments = [seg('We made $4,215 in sales.', 2), seg('Focus on making a really good offer first.', 12),
                seg('We reached 3 million people every single week.', 24)]
    planned = ag.parse_planned([raw('stat', 2.5, value='$4,215', label='in sales'), raw('stat', 24.5, value='3 million', label='people')], 0, 40_000)
    out = ag.fit_to_clip(planned, segments, [(0, 40_000)], 1.0, {'tone': 'light'})
    assert all(g['fields'].get('variant') == 'card' or g['fields'].get('theme') == 'light' for g in out), out


# --- effects from the planner ---------------------------------------------------

def test_effects_are_parsed_from_fx_fields_and_only_known_ones():
    (g,) = ag.parse_planned([fx('count-up', 3, value='4,215', prefix='$')], 0, 20_000)
    assert g['template'] == 'fx' and g['fields'] == {'effect': 'count-up', 'value': '4,215', 'prefix': '$'}
    # Its hold: the catalog's (3 s), not the 6 s asked.
    assert 3000 <= g['duration_ms'] <= 5500
    assert ag.parse_planned([fx('whiteboard-ink', 3, caption='x')], 0, 20_000) == []
    assert ag.parse_planned([fx('count-up', 3)], 0, 20_000) == []
    schema = ag.GRAPHIC_SCHEMA
    assert 'count-up' in schema['properties']['effect']['enum'] and set(schema['required']) == set(schema['properties'])
    edit_item = ed.graphic_item_schema()
    assert set(edit_item['required']) == set(edit_item['properties'])


def test_effect_words_numbers_and_units_must_be_said():
    segments = [seg('Yesterday we spent $4,215 on ads.', 2), seg('It is 10x faster than before.', 8), seg('Rated 4.9 stars by buyers.', 14)]
    ok = ag.parse_planned([fx('count-up', 3, value='4,215', prefix='$', suffix=' on ads')], 0, 30_000)[0]
    assert ag.words_said(ok, segments)
    wrong = ag.parse_planned([fx('count-up', 3, value='4,500', prefix='$')], 0, 30_000)[0]
    assert not ag.words_said(wrong, segments)
    pop = ag.parse_planned([fx('number-pop-in', 8.8, value='10', unit='x')], 0, 30_000)[0]
    assert ag.words_said(pop, segments)
    made_up_unit = ag.parse_planned([fx('number-pop-in', 8.8, value='10', unit='k')], 0, 30_000)[0]
    assert not ag.words_said(made_up_unit, segments)
    stars = ag.parse_planned([fx('star-rating-fill', 14.3, rating='4.9')], 0, 30_000)[0]
    assert ag.words_said(stars, segments)
    # A rating over 5 or a drop that rises never shows.
    assert not gd.fx_sane({'effect': 'star-rating-fill', 'rating': '49'})
    assert not gd.fx_sane({'effect': 'decline-chart', 'start': '34', 'end': '82'})
    assert not gd.fx_sane({'effect': 'marker-highlight', 'text': 'Make a profit', 'word': 'money'})


def test_list_effects_need_their_items_in_order_and_typing_needs_typing():
    segments = [seg('Emails, calls, meetings and reports pile up.', 2), seg('I typed the prompt and hit enter.', 9)]
    good = ag.parse_planned([fx('radial-surround', 2, 5, center='pile up', chips='Emails\ncalls\nmeetings\nreports')], 0, 30_000)[0]
    assert ag.words_said(good, segments)
    shuffled = ag.parse_planned([fx('radial-surround', 2, 5, center='pile up', chips='meetings\nEmails\ncalls')], 0, 30_000)[0]
    assert not ag.words_said(shuffled, segments)
    typed = ag.parse_planned([fx('typed-prompt', 9, text='the prompt')], 0, 30_000)[0]
    assert ag.words_said(typed, segments)
    not_typing = ag.parse_planned([fx('typing-indicator', 2, tone='')], 0, 30_000)
    assert not not_typing or not ag.words_said(not_typing[0], segments)


def test_effect_beats_land_on_the_spoken_words():
    segments = [seg('Yesterday we spent $4,215 on ads.', 2), seg('Emails, calls, meetings and reports pile up.', 9)]
    planned = ag.parse_planned([fx('count-up', 2, value='4,215', prefix='$'),
                                fx('radial-surround', 9, 5, center='pile up', chips='Emails\ncalls\nmeetings\nreports')], 0, 30_000)
    out = ag.fit_to_clip(planned, segments, [(0, 30_000)], 1.0, {})
    count = next(g for g in out if g['fields']['effect'] == 'count-up')
    said = word_ms(segments, '$4,215')
    # Its main beat (1.72 s into the unit) lands on the number: it starts that much before it.
    assert count['at_ms'] == said - 1720 and count['fields']['cue_ms'] == '1720'
    surround = next(g for g in out if g['fields']['effect'] == 'radial-surround')
    cues = [int(t) for t in surround['fields']['cue_ms'].split('\n')]
    assert [surround['at_ms'] + c for c in cues] == [word_ms(segments, t) for t in ('Emails', 'calls', 'meetings', 'reports')]
    # Held while its items are said, never over 8 s.
    assert surround['at_ms'] + surround['duration_ms'] >= word_ms(segments, 'reports') + 1000 and surround['duration_ms'] <= 8000
    # Kinds: effects count as distinct kinds for the variety rules.
    assert {gd.kind_of(g) for g in out} == {'fx:count-up', 'fx:radial-surround'}


def test_edit_plan_carries_effects_without_cue_times_and_rerenders_them():
    from clip_engine.services import edit_recording as er
    words = []
    t = 0.3
    for token in 'So yesterday we spent $4,215 on ads and it worked really well for us.'.split():
        words.append(er.Word(token, round(t * 1000), round((t + 0.3) * 1000), 0))
        t += 0.35
    marks = [None] * len(words)
    spent = next(i for i, w in enumerate(words) if w.text == '$4,215')
    item = {'template': 'fx', 'word': spent, 'seconds': 3, 'placement': 'top', 'effect': 'count-up',
            'fx_fields': [{'key': 'value', 'value': '4,215'}, {'key': 'prefix', 'value': '$'}], **{k: '' for k in ag.ALL_FIELDS}}
    item.update(items=[], icons=[], notes=[])
    (g,) = ed.plan_graphics([item], words, marks, {'register': 'teaching'})
    assert g['template'] == 'fx' and 'cue_ms' not in g['fields'] and g['fields']['theme'] == 'dark'
    timed = [(w.text, w.start_ms, w.end_ms, i) for i, w in enumerate(words)]
    placed, _ = ed.editor_graphics([g], timed, words[-1].end_ms + 500)
    (fxg,) = placed
    assert fxg['fields']['cue_ms'] and fxg['at_ms'] + int(fxg['fields']['cue_ms']) == words[spent].start_ms


# --- guidance ---------------------------------------------------------------------

def test_the_prompts_carry_the_cue_map_and_a_compact_catalog():
    create = ag.motion_graphics_rule({'hints': '1.0s money "$4,215" -> fx:count-up'})
    for text in ('PICK THE VISUAL LIKE A PRO EDITOR', 'fx count-up', 'personal story or emotion -> NOTHING', 'FALLBACK',
                 'count-up(value*,prefix<=6,suffix<=12)', 'Avoid:', 'CUES FOUND IN THE TRANSCRIPT', 'fx_fields'):
        assert text in create, text
    assert 'whiteboard-ink(' not in create  # decorative effects stay in the gallery
    edit = ed.direction_rule(240, {'register': 'story', 'hints': 'w12 money'})
    assert 'REGISTER: story' in edit and 'w12 money' in edit and 'about one graphic per 20 seconds' in edit
    # The catalog stays compact.
    assert len(gd.compact_catalog()) < 7000
