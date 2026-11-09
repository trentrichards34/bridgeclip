"""Stage moments that never sit dead (the owner's run 5: a Wrong / right held 12 s on a full blue frame, the speaker gone,
one dim card waiting for its side): a Wrong / right is up from its first side's word (or just before its second side when
the two are said far apart) to about 1.5 s after its second side, then back to the face; nothing on a diagram sits still
longer than STATIC_MAX_MS; and an automatic stage moment keeps the speaker's card under it unless the diagram needs the
whole frame."""
from clip_engine.services import auto_graphics as ag
from clip_engine.services import edit_direction as ed
from clip_engine.services import graphics_director as gd

from .test_stage_balance import RUN4, fx, seg


def test_a_wrong_right_said_far_apart_comes_in_just_before_its_second_side_and_leaves_soon_after():
    # Organic content (150.35 s), then ads 10 s later: in 2.2 s before "ads", out 1.7 s after it.
    at, length = ag.diagram_window('compare_marks', [150_350, 160_400])
    assert at == 160_400 - ag.COMPARE_SETUP_MS and at + length == 160_400 + ag.COMPARE_HOLD_MS
    assert length <= 4_500
    # Said close together: from the first side's word.
    at, length = ag.diagram_window('compare_marks', [20_000, 22_500])
    assert at == 19_700 and at + length == 22_500 + ag.COMPARE_HOLD_MS
    # Never a flash: at least COMPARE_MIN_MS.
    _, length = ag.diagram_window('compare_marks', [20_000, 20_400])
    assert length >= ag.COMPARE_MIN_MS


def test_the_real_runs_wrong_right_holds_about_four_seconds_with_both_sides_timed():
    segments = [seg(t, at) for at, t in RUN4]
    # The planner's picks there (run 4), as test_stage_balance has them.
    planned = [fx(88_900, 'vox-annotate', 3500, text='especially cold audience', word='cold audience'),
               fx(93_300, 'line-swap', 4000, first='a warm audience will buy anything.', second='A cold audience', underline='cold'),
               fx(158_800, 'marker-highlight', 3300, text='We spend money on ads.', word='ads'),
               {'template': 'stat', 'at_ms': 162_800, 'duration_ms': 3000, 'placement': 'top', 'fields': {'value': '$4,365', 'label': 'on ads'}, 'origin': 'auto'}]
    out = ag.fit_to_clip(planned, segments, [(84_000, 175_000)], 1.0, {'fill_quiet': True, 'stage': True, 'register': 'teaching'})
    compare = next(g for g in out if g['template'] == 'compare_marks')
    assert compare['duration_ms'] <= 4_500, compare
    times = [int(t) for t in compare['fields']['item_ms'].split('\n')]
    # The first side was said before it came in: it shows as it comes in; the second lands on its word.
    assert times[0] == 0 and abs(times[1] - ag.COMPARE_SETUP_MS) <= 300
    # The mention meant is the one closest before "ads" (150 s), not the earlier one (144.5 s).
    assert ag.item_times(compare, segments)[0] > 150_000


def test_nothing_on_a_diagram_sits_still_longer_than_the_static_limit():
    assert ag.STATIC_MAX_MS <= 8_000 and ag.DIAGRAM_ITEM_GAP_MS <= ag.STATIC_MAX_MS
    # Items said 7.5 s apart: left out (the diagram would sit half built).
    far = [seg('There are three steps: a product.', 0), seg('Then an offer.', 7.5), seg('And then eyeballs.', 15)]
    g = {'template': 'staircase', 'at_ms': 0, 'duration_ms': 15_000, 'fields': {'items': 'a product\nan offer\neyeballs'}}
    assert ag.diagram_span(g, far) is None
    near = [seg('There are three steps: a product.', 0), seg('Then an offer.', 3), seg('And then eyeballs.', 6)]
    at, length = ag.diagram_span(g, near)
    times = ag.item_times(g, near)
    beats = [at] + times + [at + length]
    assert max(b - a for a, b in zip(beats, beats[1:])) <= ag.STATIC_MAX_MS


def test_stage_moments_keep_the_speaker_unless_the_diagram_needs_the_whole_frame():
    small = {'template': 'compare_marks', 'at_ms': 10_000, 'duration_ms': 4_000, 'size': 'stage', 'fields': {'items': 'organic content\nads'}}
    stair = {'template': 'staircase', 'at_ms': 20_000, 'duration_ms': 8_000, 'size': 'stage', 'fields': {'items': 'a product\nan offer\neyeballs'}}
    big = {'template': 'growth', 'at_ms': 40_000, 'duration_ms': 9_000, 'size': 'stage', 'fields': {'items': 'a\nb\nc\nd\ne'}}
    scenes = ag.stage_scenes_for([small, stair, big], 0, 60_000, 'grid', 'arch')
    assert [(s['scene'], s['backdrop']) for s in scenes] == [('stage', 'solid'), ('stage', 'solid'), ('visual', 'solid')]
    assert scenes[0].get('card') == 'arch' and 'card' not in scenes[2]
    assert not ag.needs_full_frame(small) and not ag.needs_full_frame(stair) and ag.needs_full_frame(big)
    # A stage around a diagram is in use (it is never dropped as an empty stage).
    assert ed.scenes_in_use(scenes, [small, stair, big]) == scenes
    # The Wrong / right never needs the whole frame, however long its words.
    assert not ag.needs_full_frame({**small, 'fields': {'items': 'a\nb\nc\nd\ne'}})


def test_a_wrong_right_taken_up_at_plan_time_holds_on_its_words():
    segments = [seg(t, at) for at, t in RUN4]
    option = {'template': 'compare_marks', 'at_ms': 150_350, 'duration_ms': 10_350, 'placement': 'middle', 'origin': 'auto',
              'fields': {'items': 'organic content\nads', 'wrong': 'first'}}
    timed = gd._timed_stage(option, segments)
    assert timed and timed['duration_ms'] <= 4_500
