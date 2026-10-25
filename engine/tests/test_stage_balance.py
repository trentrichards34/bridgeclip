"""Stage moments while the speaker teaches (the owner's real run 4 put only three on the stage in four minutes; the
reference reels put a diagram on every step): a stretch of explaining with a list, steps or a contrast said and no stage
or diagram near it gets one (a Wrong / right, a staircase, a checklist on the stage) with its items lighting as said,
or the planner's own graphic of that cue is taken up onto the stage; never in a personal story or the story register,
never over a number or another diagram. A visual of 3+ items is a stage scene, never a small card."""
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


def fx(at_ms, effect, ms=3000, **fields):
    return {'template': 'fx', 'at_ms': at_ms, 'duration_ms': ms, 'placement': 'top', 'fields': {'effect': effect, **fields}, 'origin': 'auto'}


# The owner's run 4, said where he said it (seconds): the warm / cold contrast, the two ways to get eyeballs.
RUN4 = [(84.3, 'Now that we have our product, we need a sales page that is going to get people to buy our thing,'),
        (88.6, 'especially cold audience, people that don\'t know us.'),
        (91.6, 'That\'s a big difference because a warm audience will buy anything.'),
        (95.1, 'A cold audience, which people like you and me are starting with, we need a better sales page.'),
        (100.0, 'And again, I have built a tool that solves that.'),
        (110.0, 'You can see the page is already pre-written and all of the design is done.'),
        (120.0, 'It has all the animations set up in place for you, made automatically.'),
        (130.0, 'The platform built the product, so it knows everything that is in it.'),
        (140.0, 'Now we need eyeballs, and there are only two ways to get eyeballs.'),
        (144.5, 'Number one, get eyeballs through organic content, which we are not doing because I am not an influencer.'),
        (150.0, 'My organic content reaches a few people, but not nearly enough to sustain a real income.'),
        (155.5, 'So we are going to do something most people are petrified of.'),
        (159.0, 'We spend money on ads.'),
        (162.7, 'Yesterday I spent $4,365 on ads.'),
        (170.0, 'That is a petrifying number, I know that.')]


def test_a_contrast_with_one_side_negated_is_a_wrong_right_and_a_relative_clause_is_not_a_negation():
    pairs = gd.contrast_pairs([seg(t, at) for at, t in RUN4])
    by_items = {tuple(p['items']): p for p in pairs}
    # Organic content "not nearly enough", then ads: organic is the wrong side.
    organic = next(p for k, p in by_items.items() if k[0].lower().startswith('organic') and k[1].lower().startswith('ads'))
    assert organic['wrong'] == 'first'
    # "a cold audience, people that don't know us": the negation is about the people, not the side: no wrong side.
    warm_cold = [p for k, p in by_items.items() if {k[0].split()[-1].lower(), k[1].split()[-1].lower()} == {'audience'}]
    assert warm_cold and all(p['wrong'] is None for p in warm_cold)


def test_sentences_that_start_the_same_way_are_a_list_of_items():
    segments = [seg('Today I will show you how it works.', 0), seg('We need a product that people want.', 3),
                seg('We need an offer that sells it.', 6), seg('And we need a simple way to get eyeballs.', 9), seg('That is all.', 13)]
    runs = gd.parallel_runs(segments)
    assert len(runs) == 1 and runs[0]['items'] == ['a product', 'an offer', 'a simple way']
    # Two alike are not a list; nor are sentences far apart.
    assert gd.parallel_runs(segments[:3]) == []
    far = [seg('We need a product.', 0), seg('We need an offer.', 20), seg('We need eyeballs.', 40)]
    assert gd.parallel_runs(far) == []


def test_the_real_run_gets_a_stage_moment_about_every_minute_of_explaining():
    segments = [seg(t, at) for at, t in RUN4]
    # The planner's picks there (run 4): an annotate on "cold audience", a line swap of the warm / cold lines, a marker
    # on the ads line, then the $4,365.
    planned = [fx(88_900, 'vox-annotate', 3500, text='especially cold audience', word='cold audience'),
               fx(93_300, 'line-swap', 4000, first='a warm audience will buy anything.', second='A cold audience', underline='cold'),
               fx(158_800, 'marker-highlight', 3300, text='We spend money on ads.', word='ads'),
               {'template': 'stat', 'at_ms': 162_800, 'duration_ms': 3000, 'placement': 'top', 'fields': {'value': '$4,365', 'label': 'on ads'}, 'origin': 'auto'}]
    out = ag.fit_to_clip(planned, segments, [(84_000, 175_000)], 1.0, {'fill_quiet': True, 'stage': True, 'register': 'teaching'})
    kinds = [(ag.kind_of(g), g['size']) for g in out]
    # The line swap (the planner's own picture of the warm / cold contrast) is taken up onto the stage.
    assert ('fx:line-swap', 'stage') in kinds, kinds
    # Organic vs ads becomes a Wrong / right on the stage, its two sides lighting as said; the marker under it steps aside.
    compare = next(g for g in out if g['template'] == 'compare_marks')
    assert compare['fields']['items'].lower().split('\n')[0].startswith('organic') and compare['fields']['wrong'] == 'first'
    assert compare['size'] == 'stage' and len(compare['fields']['item_ms'].split('\n')) == 2
    assert 'fx:marker-highlight' not in [k for k, _ in kinds]
    # The number keeps its moment.
    assert any(ag.kind_of(g) == 'stat' for g in out)


def test_no_stage_moment_is_added_in_a_story_the_story_register_or_near_another():
    segments = [seg(t, at) for at, t in RUN4]
    story = ag.fit_to_clip([], segments, [(84_000, 175_000)], 1.0, {'fill_quiet': True, 'stage': True, 'register': 'story'})
    assert not any(g['template'] in ag.DIAGRAMS for g in story)
    # A staircase already on screen 20 s before: the contrast is near it (no second stage moment so soon).
    near = [seg('There are three things you need: a product, an offer, and eyeballs.', 128)] + segments
    stair = {'template': 'staircase', 'at_ms': 131_000, 'duration_ms': 8000, 'placement': 'middle', 'fields': {'items': 'a product\nan offer\neyeballs'}, 'origin': 'auto'}
    out = ag.fit_to_clip([stair], near, [(126_000, 175_000)], 1.0, {'fill_quiet': True, 'stage': True, 'register': 'teaching'})
    assert [g['template'] for g in out if g['size'] == 'stage'].count('compare_marks') == 0
    # A personal story stretch never gets one.
    personal = [seg('I remember when I was broke, my dad told me to stop.', 0), seg('I was scared and I cried.', 4),
                seg('I remember my organic content reached nobody, it was not enough.', 8), seg('Years ago I was scared when I spent money on ads.', 12)]
    assert gd.contrast_pairs(personal)
    assert not any(g['template'] in ag.DIAGRAMS for g in ag.fit_to_clip([], personal, [(0, 70_000)], 1.0, {'fill_quiet': True, 'stage': True, 'register': 'teaching'}))


def test_a_visual_of_three_or_more_items_is_a_stage_scene_not_a_small_card():
    rail3 = {'effect': 'state-chip-rail', 'states': 'Plan\nBuild\nLaunch'}
    rail2 = {'effect': 'state-chip-rail', 'states': 'Plan\nLaunch'}
    assert ag.graphic_size('fx', True, 'state-chip-rail', rail3) == 'stage'
    assert ag.graphic_size('fx', True, 'state-chip-rail', rail2) == 'card'
    assert ag.graphic_size('fx', False, 'state-chip-rail', rail3) == 'card'
    assert ag.graphic_size('icon_pop', True, None, {'items': 'a\nb\nc'}) == 'stage'
    stepper = {'effect': 'onboarding-stepper-flow', 'steps': 'Pick a topic\nWrite the hook\nFilm it'}
    assert ag.graphic_size('fx', True, 'onboarding-stepper-flow', stepper) == 'stage'
    # A number is never a list of items.
    assert ag.graphic_size('fx', True, 'count-up', {'effect': 'count-up', 'value': '1,200'}) == 'card'


def test_a_graphic_taken_up_onto_the_stage_stays_there_when_the_reel_is_made():
    timed = [(w, i * 400, i * 400 + 350, i) for i, w in enumerate('a warm audience will buy anything . A cold audience needs a better page .'.split())]
    spec = {'id': 'g-1', 'template': 'fx', 'word': 1, 'duration_ms': 3500, 'placement': 'top', 'origin': 'auto', 'size': 'stage',
            'fields': {'effect': 'line-swap', 'first': 'a warm audience will buy anything', 'second': 'A cold audience needs a better page', 'underline': 'better'}}
    graphics, _ = ed.editor_graphics([spec], timed, 8000, {'motion': True, 'stage': True})
    assert graphics and graphics[0]['size'] == 'stage'
    # With Stage layouts off it is a card again.
    off, _ = ed.editor_graphics([spec], timed, 8000, {'motion': True, 'stage': False})
    assert off and off[0]['size'] == 'card'
    plain, _ = ed.editor_graphics([{k: v for k, v in spec.items() if k != 'size'}], timed, 8000, {'motion': True, 'stage': True})
    assert plain and plain[0]['size'] == 'card'
