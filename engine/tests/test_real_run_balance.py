"""What a real run (the owner's 4-minute reel, Oct 24) showed and the rules that came from it: every number graphic is
one family (about one per 22 s, never two close together, never one value twice in a minute; "two ways" is a framework,
not a figure), the takeover lands on the line the video turns on when the planner left it out, the sound families vary
(never three in a row, numbers on soft pops and ticks taking turns, whooshes only for real movement), and a saved small
hook look still renders big."""
import pytest
from PIL import Image

from clip_engine.services import auto_graphics as ag
from clip_engine.services import graphics_director as gd
from clip_engine.services import sound_design as sd
from clip_engine.services.rendering_service import FLOATING_FONT_SIZES, RenderingService, RenderRequest, TitleStyle
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord


def seg(text, start_s, step=0.35):
    words, t = [], start_s
    for token in text.split():
        words.append(TranscriptWord(token, round(t * 1000), round((t + step - 0.05) * 1000)))
        t += step
    return TranscriptSegment(words[0].start_time_ms, words[-1].end_time_ms, text, words=words)


def stat(at_ms, value, label=''):
    return {'template': 'stat', 'at_ms': at_ms, 'duration_ms': 3000, 'placement': 'top', 'fields': {'value': value, 'label': label}, 'origin': 'auto'}


def count(at_ms, value, prefix=''):
    return {'template': 'fx', 'at_ms': at_ms, 'duration_ms': 3000, 'placement': 'top', 'fields': {'effect': 'count-up', 'value': value, 'prefix': prefix},
            'origin': 'auto'}


# --- numbers are one family -----------------------------------------------------

def test_number_graphics_are_one_family_spaced_out_and_never_the_same_value_twice_in_a_minute():
    seconds = 240.0
    kept = [stat(22_000, '3 years')]
    # Another kind of number graphic right after one: too close (the family's gap), whatever its template.
    assert not ag.number_family_allows(count(30_000, '12'), kept, seconds)
    assert ag.number_family_allows(count(22_000 + ag.number_family_gap_ms(seconds), '12'), kept, seconds)
    # The same value again within a minute: never (the real run showed $4,365, then $4,000, then $4,365 in 15 s).
    shown = [stat(165_000, '$4,365', 'on ads')]
    assert not ag.number_family_allows(count(200_000, '4,365', '$'), shown, seconds)
    assert ag.number_family_allows(count(200_000, '8,188', '$'), shown, seconds)
    assert ag.number_family_allows(count(226_000, '4,365', '$'), shown, seconds)
    # At most about one per 22 s of video.
    full = [stat(t, str(i + 1)) for i, t in enumerate(range(0, 240_000, 20_000))][:ag.number_family_cap(seconds)]
    assert ag.number_family_cap(seconds) == 11 and not ag.number_family_allows(stat(239_000, '99'), full, seconds)
    # Other graphics are not numbers: always allowed by this rule.
    marker = {'template': 'fx', 'at_ms': 23_000, 'duration_ms': 3000, 'fields': {'effect': 'marker-highlight', 'text': 'a b c', 'word': 'b'}}
    assert ag.number_family_allows(marker, kept, seconds)
    # A short clip spaces them less (a quarter of it), never closer than 8 s.
    assert ag.number_family_gap_ms(40) == 10_000 and ag.number_family_gap_ms(20) == ag.NUMBER_FAMILY_MIN_GAP_MS


def test_a_small_count_announcing_a_framework_is_not_a_figure():
    assert not gd.fx_sane({'effect': 'number-pop-in', 'value': '2', 'unit': 'ways'})
    assert not gd.fx_sane({'effect': 'count-up', 'value': '3', 'suffix': 'things'})
    assert gd.fx_sane({'effect': 'number-pop-in', 'value': '1,400', 'unit': 'times'})
    assert gd.fx_sane({'effect': 'count-up', 'value': '4,365', 'prefix': '$', 'suffix': 'on ads'})


def test_the_real_runs_number_picks_are_balanced_on_the_reel():
    # The numbers the owner's run showed, said where he said them (seconds), and the planner's picks for each.
    lines = [(22, 'we have been incredibly profitable for 3 years'), (71, 'it reaches 3 million people every single week'),
             (75.5, 'it has 12 lessons in it'), (165, 'yesterday I spent $4,365 on ads'), (170, 'I said I only have $4,000'),
             (179.5, 'but I spent $4,365 on ads'), (196, 'we ended up generating $8,188 in sales'), (205, 'I tried 1,400 times to go viral'),
             (228, 'I am bringing 1,000 people in')]
    segments = [seg(text, at) for at, text in lines]
    planned = [stat(22_000, '3 years', 'incredibly profitable'), stat(71_000, '3 million', 'people every single week'), count(75_500, '12'),
               stat(165_000, '$4,365', 'on ads'), count(170_000, '4,000', '$'), count(179_500, '4,365', '$'), stat(196_000, '$8,188'),
               {**count(205_000, '1,400'), 'fields': {'effect': 'number-pop-in', 'value': '1,400', 'unit': 'times'}}, count(228_000, '1,000')]
    out = ag.fit_to_clip(planned, segments, [(0, 241_000)], 1.0, {'fill_quiet': False})
    numbers = [g for g in out if ag.kind_of(g) in ag.NUMBER_FAMILY]
    assert 3 <= len(numbers) <= ag.number_family_cap(241)
    starts = [g['at_ms'] for g in numbers]
    assert all(b - a >= ag.number_family_gap_ms(241) for a, b in zip(starts, starts[1:])), starts
    values = [(g['at_ms'], n) for g in numbers for n in ag._shown_numbers(g)]
    assert not any(v == w and 0 < abs(a - b) < ag.NUMBER_SAME_VALUE_MS for a, v in values for b, w in values)


# --- the takeover on the punchline ------------------------------------------------

def test_the_line_a_video_turns_on_is_found_inside_a_long_sentence():
    segments = [seg("But that doesn't mean that I can't generate sales, because I've ignored all of that noise.", 10)]
    cue = next(c for c in gd.find_cues(segments) if c['kind'] == 'punchline')
    assert cue['text'] == "But that doesn't mean that I can't generate sales"


def test_a_takeover_lands_on_the_punchline_when_the_planner_left_it_out():
    segments = [seg('I post every day and the views are fine.', 2), seg("But that doesn't mean that I can't generate sales, because I focus.", 12),
                seg('Here is the process I use every week.', 22)]
    clash = lambda g, others: any(g['at_ms'] < k['at_ms'] + k['duration_ms'] + 1200 and k['at_ms'] < g['at_ms'] + g['duration_ms'] + 1200 for k in others)  # noqa: E731
    marker = {'template': 'fx', 'at_ms': 12_100, 'duration_ms': 3000, 'placement': 'top', 'origin': 'auto',
              'fields': {'effect': 'marker-highlight', 'text': 'I post every day', 'word': 'post'}}
    out = gd.ensure_kinds([marker], segments, [(0, 30_000)], 1.0, 30.0, ag.AUTO_TEMPLATES, clash, 'teaching', 1000, 29_000)
    takeover = [g for g in out if g['template'] == 'takeover']
    assert len(takeover) == 1 and takeover[0]['fields']['text'].startswith("But that doesn't mean")
    assert marker not in out, 'a lighter graphic steps aside for it'
    # Once a video; never on a minimal reel; never over a number (a heavier graphic keeps its moment).
    assert gd.ensure_kinds(out, segments, [(0, 30_000)], 1.0, 30.0, ag.AUTO_TEMPLATES, clash, 'teaching', 1000, 29_000) == out
    assert gd.ensure_kinds([marker], segments, [(0, 30_000)], 1.0, 30.0, ag.AUTO_TEMPLATES, clash, 'minimal', 1000, 29_000) == [marker]
    number = stat(12_300, '$4,365')
    assert gd.ensure_kinds([number], segments, [(0, 30_000)], 1.0, 30.0, ag.AUTO_TEMPLATES, clash, 'teaching', 1000, 29_000) == [number]


# --- sound families vary ------------------------------------------------------------

# The owner's run as its bake sent it (sound-design.ts bakeSoundEvents, his editor-project.json): the hook, his graphics
# and stage scenes, and the AI's four whooshes.
HIS_EVENTS = [
    {'kind': 'hook', 'at_ms': 0},
    {'kind': 'graphic', 'template': 'fx', 'effect': 'marker-highlight', 'at_ms': 7700, 'end_ms': 10700, 'size': 'card'},
    {'kind': 'graphic', 'template': 'fx', 'effect': 'headline-slam', 'at_ms': 18520, 'end_ms': 20520, 'size': 'card'},
    {'kind': 'graphic', 'template': 'stat', 'at_ms': 22667, 'end_ms': 25667, 'size': 'card'},
    {'kind': 'graphic', 'template': 'staircase', 'at_ms': 35287, 'end_ms': 48313, 'size': 'stage'},
    {'kind': 'scene', 'at_ms': 35207, 'end_ms': 48313}, {'kind': 'scene', 'at_ms': 52700, 'end_ms': 58700},
    {'kind': 'graphic', 'template': 'stat', 'at_ms': 71627, 'end_ms': 74627, 'size': 'card'},
    {'kind': 'graphic', 'template': 'fx', 'effect': 'count-up', 'at_ms': 75887, 'end_ms': 78887, 'size': 'card'},
    {'kind': 'graphic', 'template': 'fx', 'effect': 'line-swap', 'at_ms': 96500, 'end_ms': 99967, 'size': 'card'},
    {'kind': 'scene', 'at_ms': 102200, 'end_ms': 108200},
    {'kind': 'graphic', 'template': 'fx', 'effect': 'number-pop-in', 'at_ms': 142933, 'end_ms': 144933, 'size': 'card'},
    {'kind': 'graphic', 'template': 'stat', 'at_ms': 165513, 'end_ms': 168513, 'size': 'card'},
    {'kind': 'graphic', 'template': 'fx', 'effect': 'count-up', 'at_ms': 170493, 'end_ms': 173493, 'size': 'card'},
    {'kind': 'scene', 'at_ms': 173822, 'end_ms': 179750},
    {'kind': 'graphic', 'template': 'fx', 'effect': 'count-up', 'at_ms': 179900, 'end_ms': 182900, 'size': 'card'},
    {'kind': 'graphic', 'template': 'stat', 'at_ms': 196573, 'end_ms': 199573, 'size': 'card'},
    {'kind': 'extra', 'at_ms': 198247, 'sound': 'whoosh'},
    {'kind': 'graphic', 'template': 'fx', 'effect': 'number-pop-in', 'at_ms': 205327, 'end_ms': 207327, 'size': 'card'},
    {'kind': 'scene', 'at_ms': 215450, 'end_ms': 220780},
    {'kind': 'graphic', 'template': 'link_cta', 'at_ms': 232710, 'end_ms': 236640, 'size': 'card'},
]


def test_no_sound_family_plays_three_times_in_a_row_and_numbers_take_turns():
    plan = sd.plan_sounds(sd.cues_from_events(HIS_EVENTS, 241_133), 241_133, 'teaching', None)
    actions = [p.action for p in plan if p.action != 'riser']
    assert all(not (a == b == c) for a, b, c in zip(actions, actions[1:], actions[2:])), actions
    # Numbers land on soft pops and ticks, taking turns, a little under the other hits.
    numbers = [p for p in plan if any(abs(p.peak_at_ms - sd.FRAME_MS - e['at_ms']) < 2500 and (e.get('template') == 'stat' or e.get('effect') in sd.NUMBER_EFFECTS)
                                      for e in HIS_EVENTS if e['kind'] == 'graphic') and p.kind == 'graphic' and p.action in sd.NUMBER_ACTIONS]
    assert len(numbers) >= 4 and {p.action for p in numbers} == {'pop', 'tick'}
    # Each family rotates through at least three takes when it plays three times or more.
    for action in {p.action for p in plan}:
        files = [p.sound.path for p in plan if p.action == action]
        if len(files) >= 3:
            assert len(set(files)) >= 3, (action, files)


def test_a_whoosh_is_for_real_movement_and_a_small_card_gets_a_soft_swipe():
    cues = sd.cues_from_events([{'kind': 'graphic', 'template': 'fx', 'effect': 'headline-slam', 'at_ms': 1000, 'end_ms': 3000, 'size': 'card'},
                                {'kind': 'graphic', 'template': 'list', 'at_ms': 5000, 'end_ms': 8000, 'size': 'card'},
                                {'kind': 'graphic', 'template': 'staircase', 'at_ms': 10000, 'end_ms': 16000, 'size': 'stage'},
                                {'kind': 'scene', 'at_ms': 20000, 'end_ms': 25000}], 40000)
    got = {(c.at_ms, c.action) for c in cues}
    assert (1000 + 580, 'swipe') in got or (1000, 'swipe') in got
    assert (5000, 'swipe') in got and (10000, 'whoosh') in got and (20000, 'whoosh') in got


def test_a_third_repeat_of_a_family_takes_its_stand_in_or_a_minor_one_is_left_out():
    cues = [sd.Cue(1000, 'whoosh', 'scene', 80), sd.Cue(5000, 'whoosh', 'scene_out', 50), sd.Cue(9000, 'whoosh', 'scene', 80),
            sd.Cue(13000, 'whoosh', 'scene_out', 50), sd.Cue(17000, 'whoosh', 'scene', 80)]
    plan = sd.plan_sounds(cues, 30_000)
    assert [p.action for p in plan] == ['whoosh', 'whoosh', 'swipe', 'whoosh', 'whoosh']
    minor = [sd.Cue(1000, 'whoosh', 'scene', 80), sd.Cue(5000, 'whoosh', 'scene', 80), sd.Cue(9000, 'whoosh', 'extra', 20, window=(8000, 9500))]
    assert [p.action for p in sd.plan_sounds(minor + [sd.Cue(8500, 'pop', 'graphic', 70, window=(8000, 9500))], 30_000)] == ['whoosh', 'whoosh', 'pop']


# --- a saved small hook still reads -------------------------------------------------

def _hook(tmp_path, look, text):
    request = RenderRequest('in.mp4', str(tmp_path / 'o.mp4'), 0, 1000, 64, 64, title_style=TitleStyle.HEADLINE, headline_text=text, headline_look=look)
    return RenderingService()._headline_bar_image(request, 1080, 1920, False)


@pytest.mark.parametrize('font', ['serif', 'clean'])
def test_a_saved_small_floating_hook_renders_at_the_minimum_size_in_its_own_font_and_box(tmp_path, font):
    # His saved look: floating text on a dark box, in the serif.
    path, bar = _hook(tmp_path, {'look': 'floating', 'color': '#FFFFFF', 'font': font, 'textBg': 'dark'}, 'You do not have to be an influencer')
    img = Image.open(path).convert('RGBA')
    alpha = img.getchannel('A')
    rows = [y for y in range(img.height) if any(alpha.getpixel((x, y)) > 200 for x in range(0, img.width, 4))]
    assert bar == 0 and rows
    # The box behind the lines: at least two lines at the smallest floating size (1.22 lines each), on the dark box.
    lines_h = rows[-1] - rows[0]
    assert lines_h >= 2 * FLOATING_FONT_SIZES[-1] * 1.2, lines_h
    assert img.getpixel((540, (rows[0] + rows[-1]) // 2))[3] > 200


# --- one screen frame per stretch of screen ------------------------------------------

def test_two_overlapping_screen_windows_never_get_two_frames_over_each_other():
    from clip_engine.services import edit_direction as ed
    out, scenes = ed.screen_aware([], [(52_500, 70_000), (52_787, 66_000)], stage=True)
    frames = sorted((g['at_ms'], g['at_ms'] + g['duration_ms']) for g in out if g['template'] == 'screen_frame')
    assert frames and all(b[0] >= a[1] for a, b in zip(frames, frames[1:])), frames
    assert len(scenes) == len(frames)
