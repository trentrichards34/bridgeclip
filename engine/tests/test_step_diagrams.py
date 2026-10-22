"""Chapter headers and diagrams (Travis's step-by-step reel style): chapters built only from words said, diagrams
whose items are said in order (timed to them), one diagram per section, a Visual scene on the solid backdrop
around each diagram, the hook handing over to the first chapter, the Serif clean captions."""

from clip_engine.config import get_caption_preset
from clip_engine.services.auto_graphics import (
    DIAGRAMS, chapter_graphics, chapter_said, checked_saved, checked_saved_scenes, clean_fields, diagram_span, find_chapters,
    fit_to_clip, on_stage, parse_planned, stage_scenes_for,
)
from clip_engine.services.rendering_service import chapter_hand_over_s
from clip_engine.services.stage_scenes import backdrop_colors, caption_mode, parse_scenes
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord


def line(start, text, step=400):
    words = text.split()
    timed = [TranscriptWord(word, start + i * step, start + i * step + step - 50) for i, word in enumerate(words)]
    return TranscriptSegment(start, timed[-1].end_time_ms, text, words=timed)


TALK = [
    line(0, "Here is how to sell digital products in 2026."),
    line(5_000, "Step one is to come up with your idea. It has to be urgent, useful, unique and problem solving."),
    line(16_000, "Step two, get clear on your avatar. Don't focus on demographics, focus on transformation."),
    line(26_000, "Step number three: build the automated pitch process."),
    line(30_000, "Create a sales page, set up basic emails, establish a delivery system, then launch."),
]


def test_chapters_come_only_from_words_said():
    chapters = find_chapters(TALK)
    assert [(c['label'], c['title']) for c in chapters] == [
        ('Step #1.', 'Come Up With Your Idea'), ('Step #2.', 'Get Clear On Your Avatar'), ('Step #3.', 'Build The Automated Pitch Process')]
    # Each starts just before its marker is said.
    assert chapters[0]['at_ms'] == 5_000 - 100 and chapters[1]['at_ms'] == 16_000 - 100


def test_no_structure_no_chapters():
    # A lone "step two", "my number one tip" or "the first time" isn't a structure.
    assert find_chapters([line(0, "This is step two of my plan and my number one tip."), line(6000, "The first time I tried it, it failed.")]) == []
    # Ordinals at sentence starts are one ("first… second…"); "first of all" isn't.
    talk = [line(0, "First, write the offer. Second, record the video. Finally, post it.")]
    assert [(c['label'], c['title']) for c in find_chapters(talk)] == [('First.', 'Write The Offer'), ('Second.', 'Record The Video'), ('Finally.', 'Post It')]
    assert find_chapters([line(0, "First of all, thanks. Second of all, hi.")]) == []


def test_made_up_step_numbers_and_titles_are_rejected():
    ok = {'template': 'chapter', 'at_ms': 4_900, 'duration_ms': 10_000, 'fields': {'label': 'Step #1.', 'title': 'Come Up With Your Idea'}}
    assert chapter_said(ok, TALK)
    # A number that wasn't said there, a title word that wasn't said, a marker far from the header.
    assert not chapter_said({**ok, 'fields': {**ok['fields'], 'label': 'Step #4.'}}, TALK)
    assert not chapter_said({**ok, 'fields': {**ok['fields'], 'label': 'Tip #1.'}}, TALK)
    assert not chapter_said({**ok, 'fields': {**ok['fields'], 'title': 'Come Up With A Winning Idea'}}, TALK)
    assert not chapter_said({**ok, 'at_ms': 12_000}, TALK)


def test_chapter_graphics_cover_each_section_until_the_next():
    chapters = chapter_graphics(TALK, [(4_000, 40_000)], 1.0)
    assert [c['fields']['label'] for c in chapters] == ['Step #1.', 'Step #2.', 'Step #3.']
    assert chapters[0]['at_ms'] == 4_900 and chapters[0]['at_ms'] + chapters[0]['duration_ms'] == 15_900 - 150
    # The last one stays to the clip's end; a start that was cut out moves to where the clip picks up.
    assert chapters[-1]['at_ms'] + chapters[-1]['duration_ms'] == 40_000
    moved = chapter_graphics(TALK, [(4_000, 4_800), (6_000, 40_000)], 1.0)
    assert moved[0]['at_ms'] == 6_000
    # A clip that starts after the first marker gets only the sections said in it.
    assert [c['fields']['label'] for c in chapter_graphics(TALK, [(17_000, 40_000)], 1.0)] == ['Step #3.']


def planned(template, time, items, **fields):
    return {'template': template, 'time': time, 'seconds': 6, 'placement': 'middle', 'items': items, **fields}


def test_diagrams_are_parsed_and_checked_against_words_said():
    raw = [planned('idea_hub', 9.0, ['urgent', 'useful', 'unique', 'problem solving'], text='', icon='idea'),
           planned('staircase', 31.0, ['Create a sales page', 'set up basic emails', 'establish a delivery system'], title='Build the pitch',
                   icons=['file', 'mail', 'gift']),
           planned('compare_marks', 18.0, ['focus on demographics', 'focus on transformation'], notes=['', ''], wrong='first'),
           planned('funnel', 31.0, ['only', 'two']),  # a diagram needs three items
           planned('growth', 31.0, ['a', 'b', 'c'], style='bars')]
    kept = parse_planned(raw, 0, 40_000)
    assert [g['template'] for g in kept] == ['idea_hub', 'staircase', 'compare_marks', 'growth']
    assert kept[0]['fields'] == {'items': 'urgent\nuseful\nunique\nproblem solving', 'icon': 'idea'}
    assert kept[2]['fields'] == {'items': 'focus on demographics\nfocus on transformation', 'wrong': 'first'}
    assert kept[3]['fields']['style'] == 'bars'
    assert clean_fields('compare_marks', {'items': ['a', 'b'], 'wrong': 'third', 'notes': 'x\ny'}) == {'items': 'a\nb', 'notes': 'x\ny'}
    assert clean_fields('idea_hub', {'items': ['a', 'b', 'c'], 'icon': 'brandlogo'}) == {'items': 'a\nb\nc'}


def test_diagram_items_must_be_said_in_order_and_unsaid_extras_are_dropped():
    opts = {'stage': True, 'chapters': True}
    hub = parse_planned([planned('idea_hub', 9.0, ['urgent', 'useful', 'unique', 'problem solving'], text='Viral idea')], 0, 40_000)
    out = fit_to_clip(hub, TALK, [(4_000, 40_000)], 1.0, opts)
    diagrams = [g for g in out if g['template'] in DIAGRAMS]
    assert len(diagrams) == 1
    g = diagrams[0]
    # "Viral idea" isn't said near it: the words under the icon go, the diagram stays.
    assert 'text' not in g['fields'] and g['size'] == 'stage'
    # On screen from just before the first item to a little after the last; each item timed as said.
    said = [w.start_time_ms for w in TALK[1].words if w.word.strip(',.') in ('urgent', 'useful', 'unique', 'problem')]
    assert g['at_ms'] == said[0] - 700
    assert [g['at_ms'] + int(t) for t in g['fields']['item_ms'].split('\n')] == said
    assert 6_000 <= g['duration_ms'] <= 15_000
    # Items out of order, or one not said: no diagram.
    swapped = parse_planned([planned('idea_hub', 9.0, ['useful', 'urgent', 'unique'])], 0, 40_000)
    assert not [g for g in fit_to_clip(swapped, TALK, [(4_000, 40_000)], 1.0, opts) if g['template'] in DIAGRAMS]
    made_up = parse_planned([planned('funnel', 9.0, ['urgent', 'useful', 'viral'])], 0, 40_000)
    assert not [g for g in fit_to_clip(made_up, TALK, [(4_000, 40_000)], 1.0, opts) if g['template'] in DIAGRAMS]


def test_one_diagram_per_section_and_chapters_ride_along():
    opts = {'stage': True, 'chapters': True}
    raw = parse_planned([planned('idea_hub', 9.0, ['urgent', 'useful', 'unique']),
                         planned('growth', 10.0, ['useful', 'unique', 'problem solving']),
                         planned('compare_marks', 18.5, ['focus on demographics', 'focus on transformation'], wrong='first')], 0, 40_000)
    out = fit_to_clip(raw, TALK, [(4_000, 40_000)], 1.0, opts)
    assert [g['template'] for g in out if g['template'] in DIAGRAMS] == ['idea_hub', 'compare_marks']
    assert [g['fields']['label'] for g in out if g['template'] == 'chapter'] == ['Step #1.', 'Step #2.', 'Step #3.']
    assert all(g['origin'] == 'auto' for g in out)
    # Without the option (B-roll videos) there are no chapters.
    assert not [g for g in fit_to_clip(raw, TALK, [(4_000, 40_000)], 1.0, {'stage': True}) if g['template'] == 'chapter']
    # Saved and read back for the editor (a chapter may last the whole section).
    saved = checked_saved(out, 60_000)
    assert [g['template'] for g in saved] == [g['template'] for g in out]
    assert any(g['template'] == 'chapter' and g['duration_ms'] > 8000 for g in saved)


def test_visual_scene_on_the_solid_backdrop_around_each_diagram():
    diagram = {'template': 'staircase', 'at_ms': 31_000, 'duration_ms': 8_000, 'size': 'stage', 'fields': {}}
    card = {'template': 'statement', 'at_ms': 12_000, 'duration_ms': 3_000, 'size': 'stage', 'fields': {}}
    scenes = stage_scenes_for([card, diagram], 4_000, 40_000, 'grid', 'arch')
    assert {s['scene'] for s in scenes} == {'stage', 'visual'}
    visual = next(s for s in scenes if s['scene'] == 'visual')
    assert visual['backdrop'] == 'solid' and visual['start_ms'] <= 31_000 and visual['end_ms'] >= 39_000
    assert checked_saved_scenes([{k: v - 4_000 if k.endswith('_ms') else v for k, v in visual.items()}], 40_000)
    assert on_stage(diagram, []) and parse_scenes([visual])[0].backdrop == 'solid'
    # Solid: the brand color (royal blue without one), the member's own captions on it.
    assert backdrop_colors('solid')[0] == (0x1F, 0x4E, 0x9C) and backdrop_colors('solid', '#112233')[0] == (0x11, 0x22, 0x33)
    assert caption_mode('solid') == ''


def test_diagram_span_follows_its_items():
    g = {'template': 'funnel', 'at_ms': 30_000, 'duration_ms': 6_000, 'fields': {'items': 'create a sales page\nset up basic emails\nestablish a delivery system'}}
    a, length = diagram_span(g, TALK)
    assert a == 30_000 - 700 and length >= 6_000


def test_hook_hands_over_to_the_first_chapter():
    keeps = [(0, 4_000), (6_000, 20_000)]  # window ms
    assert chapter_hand_over_s(12_000, keeps, 1_000) == (4_000 + 11_000 - 6_000) / 1000
    # In a cut-out part: where the clip picks up again; past the clip or missing: none.
    assert chapter_hand_over_s(6_000, keeps, 1_000) == 4.0
    assert chapter_hand_over_s(30_000, keeps, 1_000) is None and chapter_hand_over_s(None, keeps, 0) is None


def test_serif_clean_captions():
    style = get_caption_preset('serif_clean')
    assert style.font_name == 'Instrument Serif' and not style.italic and style.lowercase and not style.uppercase
    assert style.max_words_per_line == 3 and style.outline_width == 0 and not style.entrance_pop
