"""My logos (graphics_director.place_logos: names said as whole words pop the member's logo in, capped and gated) and the
data effects in HyperFrames' style (gauge, waffle chart, flanking words, magazine cover): their sanity and words-said
checks, the cues that pick them, the share effects taking turns, and their caps."""
from clip_engine.services import auto_graphics as ag
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


META = {'image': 'aaaaaaaaaaaaaaaa.png', 'name': 'Meta', 'aliases': ['Facebook', 'Meta Ads Manager']}
CLAUDE = {'image': 'bbbbbbbbbbbbbbbb.png', 'name': 'Claude', 'aliases': []}


def logos_of(out):
    return [g for g in out if g['template'] == 'logo']


# --- matching -------------------------------------------------------------------

def test_names_and_aliases_match_as_whole_words_case_insensitive():
    segments = [seg('I run ads on META every day.', 1), seg('Facebook still works.', 6), seg("Meta's tools are fine.", 12)]
    hits = gd.logo_mentions(segments, gd.clean_logos([META]))
    assert [h['at_ms'] for h in hits] == [word_ms(segments, 'META'), word_ms(segments, 'Facebook'), word_ms(segments, "Meta's")]


def test_no_match_inside_words_or_on_plurals():
    segments = [seg('The metadata and the Metas and metaverse.', 1), seg('Claudes everywhere.', 6)]
    assert gd.logo_mentions(segments, gd.clean_logos([META, CLAUDE])) == []


def test_the_longest_name_wins_and_bad_logos_are_left_out():
    segments = [seg('Open Meta Ads Manager now.', 1)]
    clean = gd.clean_logos([META, {'image': '../x.png', 'name': 'X'}, {'image': 'ok.png', 'name': ''}, 'nope'])
    assert len(clean) == 1
    (hit,) = gd.logo_mentions(segments, clean)
    assert hit['at_ms'] == word_ms(segments, 'Meta') and hit['end_ms'] > word_ms(segments, 'Ads')


# --- caps and gating ------------------------------------------------------------

def test_one_logo_per_six_seconds_and_each_at_most_twice():
    segments = [seg('Meta and Claude together.', 1), seg('Meta again here.', 4), seg('Meta once more.', 9), seg('Meta a third time.', 17),
                seg('Meta a fourth time.', 25), seg('Claude is last.', 33)]
    out = logos_of(gd.place_logos([], segments, [META, CLAUDE], [(0, 40_000)]))
    starts = [g['at_ms'] for g in out]
    assert all(b - a >= gd.LOGO_GAP_MS for a, b in zip(starts, starts[1:]))
    assert sum(1 for g in out if g['fields']['image'] == META['image']) == 2
    assert out[-1]['fields']['image'] == CLAUDE['image']
    assert all(g['placement'] == 'middle' and g['duration_ms'] == gd.LOGO_MS for g in out)


def test_never_in_a_story_minimal_over_another_graphic_or_outside_the_cut():
    story = [seg('I remember when I was broke and scared, my dad used Facebook every night.', 1)]
    assert logos_of(gd.place_logos([], story, [META], [(0, 20_000)])) == []
    segments = [seg('We use Meta for ads.', 1), seg('And Claude to write.', 8)]
    assert logos_of(gd.place_logos([], segments, [META, CLAUDE], [(0, 20_000)], register='minimal')) == []
    busy = [{'template': 'stat', 'at_ms': 0, 'duration_ms': 5000, 'fields': {'value': '10'}}]
    out = gd.place_logos(busy, segments, [META, CLAUDE], [(0, 20_000)])
    assert [g['fields']['image'] for g in logos_of(out)] == [CLAUDE['image']] and out[0] is busy[0]
    # A cut that removed "Meta": no pop there.
    assert [g['fields']['image'] for g in logos_of(gd.place_logos([], segments, [META, CLAUDE], [(5000, 20_000)]))] == [CLAUDE['image']]
    assert gd.place_logos([], segments, [], [(0, 20_000)]) == []


def test_create_places_logos_in_the_finished_clip_with_the_rest():
    segments = [seg('Today we talk about growth.', 0.2), seg('I use Claude for every script.', 3), seg('It saves hours.', 8)]
    out = ag.fit_to_clip([], segments, [(0, 12_000)], 1.0, {'logos': [CLAUDE]})
    (g,) = logos_of(out)
    assert g['fields'] == {'image': CLAUDE['image']} and g['at_ms'] <= word_ms(segments, 'Claude') and g['size'] == 'card'
    assert logos_of(ag.fit_to_clip([], segments, [(0, 12_000)], 1.0, {})) == []


# --- the data effects -----------------------------------------------------------

def test_waffle_takes_only_said_numbers():
    assert gd.waffle_share('1 in 10') == 10 and gd.waffle_share('3 out of 4') == 75 and gd.waffle_share('90%') == 90
    assert gd.waffle_share('90 percent') == 90 and gd.waffle_share('most') is None and gd.waffle_share('almost all') is None
    assert gd.fx_sane({'effect': 'waffle-chart', 'figure': '1 in 10'})
    assert not gd.fx_sane({'effect': 'waffle-chart', 'figure': 'most'})


def test_gauge_flanking_and_cover_sanity():
    assert gd.fx_sane({'effect': 'gauge-dial', 'value': '72'}) and gd.fx_sane({'effect': 'gauge-dial', 'value': '8', 'max': '10'})
    assert not gd.fx_sane({'effect': 'gauge-dial', 'value': '120'}) and not gd.fx_sane({'effect': 'gauge-dial', 'value': '12', 'max': '10'})
    assert gd.fx_sane({'effect': 'flanking-words', 'words': 'Step\nOne'})
    assert not gd.fx_sane({'effect': 'flanking-words', 'words': 'Step\nOne\nTwo'}) and not gd.fx_sane({'effect': 'flanking-words', 'words': 'Step one two three\nOne'})
    assert gd.fx_sane({'effect': 'magazine-cover', 'masthead': 'Creator', 'lines': 'Quit my job\nBuilt it alone'})
    assert not gd.fx_sane({'effect': 'magazine-cover', 'masthead': 'Creator', 'lines': 'Only one line'})


def test_the_words_must_be_said_for_each_new_effect():
    segments = [seg('There is a 72 percent chance it works.', 1)]
    gauge = {'template': 'fx', 'at_ms': 1000, 'duration_ms': 3500, 'fields': {'effect': 'gauge-dial', 'value': '72', 'unit': '%', 'label': 'chance it works'}}
    assert ag.words_said(gauge, segments) and gd.fx_words_ok(gauge, segments)
    made_up = {**gauge, 'fields': {**gauge['fields'], 'value': '85'}}
    assert not ag.words_said(made_up, segments)
    steps = [seg('Step one is to pick a topic.', 1)]
    flank = {'template': 'fx', 'at_ms': 900, 'duration_ms': 3000, 'fields': {'effect': 'flanking-words', 'words': 'Step\nOne'}}
    assert ag.words_said(flank, steps) and gd.fx_words_ok(flank, steps)
    # Two words said that are not a numbered step: no flanking words.
    other = [seg('Pick one topic and go.', 1)]
    assert not gd.fx_words_ok({**flank, 'fields': {**flank['fields'], 'words': 'Pick\nOne'}}, other)
    who = [seg("I'm a full-time creator who quit my job at 30.", 1)]
    cover = {'template': 'fx', 'at_ms': 900, 'duration_ms': 4500, 'fields': {'effect': 'magazine-cover', 'masthead': 'Creator', 'lines': 'full-time creator\nquit my job at 30'}}
    assert gd.fx_words_ok(cover, who)
    assert not gd.fx_words_ok(cover, [seg('The creator quit my job at 30 full-time.', 1)])


def test_cues_pick_the_new_effects():
    cues = gd.find_cues([seg('About 90% of people quit.', 1), seg('Step two is posting daily.', 5), seg("I'm a coach for new creators.", 9)])
    by = {c['kind']: c for c in cues}
    assert 'fx:gauge-dial' in by['percent']['prefer'] and 'fx:waffle-chart' in by['percent']['prefer']
    assert by['numbered_step']['prefer'] == ('fx:flanking-words',) and by['numbered_step']['text'] == 'Step two'
    assert by['identity']['prefer'] == ('fx:magazine-cover',)
    for effect in ('gauge-dial', 'waffle-chart', 'flanking-words', 'magazine-cover'):
        assert effect in ag.AUTO_FX and effect in gd.compact_catalog()


def test_shares_take_turns_and_cover_is_once_a_video():
    ring = {'template': 'fx', 'at_ms': 0, 'duration_ms': 3500, 'fields': {'effect': 'conic-progress-ring', 'progress': '80', 'label': '80%'}}
    gauge = gd.convert(ring, 'fx:gauge-dial')
    assert gauge['fields'] == {'effect': 'gauge-dial', 'value': '80', 'unit': '%'}
    waffle = gd.convert(gauge, 'fx:waffle-chart')
    assert waffle['fields'] == {'effect': 'waffle-chart', 'figure': '80%'}
    # "1 in 10" stays a waffle (a ring would show a percent never said).
    assert gd.convert({**waffle, 'fields': {'effect': 'waffle-chart', 'figure': '1 in 10'}}, 'fx:conic-progress-ring') is None
    assert 'fx:gauge-dial' in gd.CONVERSIONS['fx:conic-progress-ring']
    covers = [{'template': 'fx', 'at_ms': 0, 'duration_ms': 1000, 'fields': {'effect': 'magazine-cover'}}]
    assert not gd.group_allows('fx:magazine-cover', covers, 600) and gd.group_allows('fx:magazine-cover', [], 600)


def test_flanking_words_only_with_the_stage_up():
    segments = [seg('Okay so here we go.', 0.2), seg('Step one is to pick a topic.', 3), seg('Then you film it.', 7)]
    planned = ag.parse_planned([{'template': 'fx', 'time': 3, 'seconds': 3, 'placement': 'top', 'effect': 'flanking-words',
                                 'fx_fields': [{'key': 'words', 'value': 'Step\nOne'}]}], 0, 12_000)
    assert planned
    on = [g for g in ag.fit_to_clip(planned, segments, [(0, 12_000)], 1.0, {'stage': True}) if g['template'] == 'fx']
    assert on and on[0]['fields']['effect'] == 'flanking-words' and on[0]['size'] == 'stage'
    assert not [g for g in ag.fit_to_clip(planned, segments, [(0, 12_000)], 1.0, {}) if g['template'] == 'fx' and g['fields'].get('effect') == 'flanking-words']
