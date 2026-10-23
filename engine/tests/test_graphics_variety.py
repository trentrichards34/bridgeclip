"""Variety in code (auto_graphics' variety rules, shared by Create and Edit my recording): per-template caps scaled by
length, no template twice in a row or within ~25 s of itself, over-used cards turned into richer templates their words
fit (still checked against what was said), looks given in turn, and a long video using many templates."""
from collections import Counter

from clip_engine.services import auto_graphics as ag
from clip_engine.services import edit_direction as ed
from clip_engine.services import edit_recording as er


def say(text, start, step=0.32):
    out, t = [], start
    for token in text.split():
        out.append(er.Word(token, round(t * 1000), round((t + step - 0.04) * 1000), 0))
        t += step
    return out


def item(template, word, seconds=3.5, **fields):
    out = {'template': template, 'word': word, 'seconds': seconds, 'placement': 'top'}
    for k in ag.ALL_FIELDS:
        out[k] = fields.get(k, [] if k in ('items', 'icons', 'notes') else '')
    return out


LINES = [
    "I'm using AI to do exactly that.", 'We only need three things to win.', 'This animation was made automatically.',
    'You can actually make a profit.', 'I have built a tool that solves that.', 'This is going to be controversial.',
    'A full sales page ready to sell.', 'Teaches people their first pull up.', 'I am a virtual nobody online.',
    'Focus on making a really good offer.', 'Cold audience, people that do not know us.', 'Platform built it, knows everything.',
    'Finding new people, getting new buyers.', 'Pre-written copy, design is done.', 'We spent money on ads today.',
    'Content, offers and emails in one place.',
]


def long_talk():
    """About 4 minutes: one line every 15 s."""
    words, starts = [], []
    for k, line in enumerate(LINES):
        starts.append(len(words))
        words += say(line, 2.0 + k * 15.0)
        # Talk in between (no graphic for it), so the whole 4 minutes is speech.
        words += say(' '.join(['and', 'so', 'yeah'] * 11), 2.0 + k * 15.0 + 3.0, step=0.36)
    return words, starts


def first(words, text, after=0):
    return next(i for i, w in enumerate(words) if i >= after and w.text.strip('.,').lower() == text.lower())


def over_repetitive(words, starts):
    """The owner's first real run in miniature: the planner latched onto statements and sticky notes."""
    raw = []
    for k in range(10):
        text = LINES[k].rstrip('.')
        raw.append(item('statement', starts[k], text=text, accent=text.split()[-1]))
    raw.append(item('sticky_notes', starts[10], items=['Cold audience', 'people that do not know us']))
    raw.append(item('sticky_notes', starts[11], items=['Platform built it', 'knows everything']))
    raw.append(item('sticky_notes', starts[12], items=['Finding new people', 'getting new buyers']))
    raw.append(item('sticky_notes', starts[13], items=['Pre-written copy', 'design is done']))
    raw.append(item('sticky_notes', starts[15], items=['Content', 'offers', 'emails']))
    return raw


def test_caps_scale_with_length():
    assert ag.template_cap('statement', 240) == 4 and ag.template_cap('statement', 60) == 2 and ag.template_cap('statement', 20) == 1
    assert ag.template_cap('sticky_notes', 240) == 2 and ag.template_cap('sticky_notes', 30) == 1
    assert ag.template_cap('stat', 240) == 6
    assert ag.same_gap_ms(240) == 25000 and ag.same_gap_ms(40) == 10000 and ag.same_gap_ms(10) == 8000
    assert ag.min_distinct(240) == ag.MIN_DISTINCT_LONG and ag.min_distinct(30) == 0
    # About one per 9-10 s on an edited reel (the owner's ~25 for 4 minutes), with a hard cap.
    assert ed.graphics_limit(240) == 26 and ed.graphics_target(240) == (22, 25)


def test_an_over_repetitive_plan_comes_out_varied_and_capped():
    words, starts = long_talk()
    marks = [None] * len(words)
    raw = over_repetitive(words, starts)
    out = ed.plan_graphics(raw, words, marks, {'stage': True})
    counts = Counter(ag.kind_of(g) for g in out)
    seconds = (words[-1].end_ms - words[0].start_ms) / 1000
    # Plain text cards are a fallback (about one per 45 s), sticky notes at most twice.
    assert sum(counts[k] for k in ('statement', 'quote', 'sticky_notes', 'big_words')) <= max(1, round(seconds / 45)) + 1, counts
    assert counts['statement'] <= 4 and counts['sticky_notes'] <= 2, counts
    # The rest became richer visuals their words fit (effects count as their own kinds).
    assert len(counts) >= 6, counts
    assert {'headline_pill', 'big_words', 'fx:marker-highlight', 'fx:headline-slam', 'fx:per-word-rise'} & set(counts), counts
    assert {'feature_tile', 'icon_pop', 'orbit', 'checklist', 'list', 'idea_hub', 'fx:state-chip-rail'} & set(counts), counts
    # Never the same kind twice in a row, never within 25 s of itself.
    seq = sorted(out, key=lambda g: g['word'])
    for a, b in zip(seq, seq[1:]):
        assert ag.kind_of(a) != ag.kind_of(b) or words[b['word']].start_ms - words[a['word']].start_ms >= 40000, (a, b)
    by = {}
    for g in seq:
        by.setdefault(ag.kind_of(g), []).append(words[g['word']].start_ms)
    assert all(b - a >= 25000 for t in by.values() for a, b in zip(t, t[1:]))
    # Every word on every card was said there, in order (the usual checks ran on the converted cards too).
    said = ' '.join(w.text.lower() for w in words)
    for g in out:
        for key in ('text', 'phrase', 'items', 'states', 'word'):
            for line in g['fields'].get(key, '').split('\n'):
                for token in ag._tokens(line):
                    assert token in ag._tokens(said), (g, token)


def test_conversions_keep_the_words_and_their_order():
    g = {'template': 'statement', 'at_ms': 0, 'duration_ms': 3500, 'fields': {'text': "I'm gonna give you the blueprint", 'accent': 'blueprint'}}
    pill = ag.converted(g, 'headline_pill')
    assert pill['fields'] == {'text': "I'm gonna give you the", 'phrase': 'blueprint'}
    assert ag.converted(g, 'big_words')['fields'] == {'text': 'blueprint'}
    assert ag.converted(g, 'feature_tile') is None  # a sentence isn't a feature
    mid = {**g, 'fields': {'text': "I've built a tool that solves that", 'accent': 'tool'}}
    assert ag.converted(mid, 'headline_pill')['fields'] == {'text': "I've built a", 'phrase': 'tool that solves that'}
    notes = {'template': 'sticky_notes', 'at_ms': 0, 'duration_ms': 4000, 'fields': {'items': 'Content\noffers\nemails'}}
    tile = ag.converted(notes, 'feature_tile')
    assert tile['fields']['items'] == 'Content\noffers\nemails' and tile['fields']['icons'] == 'image\ngift\nmail'
    assert ag.converted(notes, 'orbit')['fields']['icons'] == 'image\ngift\nmail'
    # An icon row needs an icon for every item (never a letter guess).
    assert ag.converted({**notes, 'fields': {'items': 'Cold audience\nzorbs'}}, 'icon_pop') is None


def test_looks_rotate_per_template_and_are_kept_when_set():
    gs = [{'template': t, 'at_ms': i * 1000, 'duration_ms': 900, 'fields': {}} for i, t in enumerate(['statement', 'stat', 'statement', 'statement', 'stat'])]
    out = ag.with_variants(gs)
    looks = [(g['template'], g['fields']['variant']) for g in out]
    assert looks == [('statement', 'glass'), ('stat', 'gradient'), ('statement', 'bold'), ('statement', 'card'), ('stat', 'badge')]
    mine = ag.with_variants([{**gs[0], 'fields': {'variant': 'bold'}}, gs[2]])
    assert [g['fields']['variant'] for g in mine] == ['bold', 'card']
    # One-look templates get none.
    assert 'variant' not in ag.with_variants([{'template': 'orbit', 'at_ms': 0, 'duration_ms': 900, 'fields': {}}])[0]['fields']


def test_a_variant_is_read_back_and_never_checked_as_words():
    fields = ag.clean_fields('statement', {'text': 'Skip the scraping.', 'accent': 'scraping', 'variant': 'glass'}, ag.SAVED_FIELDS)
    assert fields['variant'] == 'glass'
    assert 'variant' not in ag.clean_fields('statement', {'text': 'x', 'variant': 'neon'}, ag.SAVED_FIELDS)
    assert 'variant' not in ag.clean_fields('orbit', {'items': ['a', 'b', 'c'], 'variant': 'glass'}, ag.SAVED_FIELDS)
    saved = ag.checked_saved([{'id': 'g-aaaa1', 'template': 'stat', 'at_ms': 0, 'duration_ms': 2000, 'fields': {'value': '$5', 'variant': 'badge'}}], 10000)
    assert saved[0]['fields']['variant'] == 'badge'
    # "glass" is never a word that has to be said.
    segments = [er_segment('Skip the scraping today.', 0)]
    card = {'template': 'statement', 'at_ms': 0, 'duration_ms': 2000, 'fields': {'text': 'Skip the scraping', 'variant': 'glass'}}
    assert ag.words_said(card, segments)


def er_segment(text, start_ms):
    from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord
    words = [TranscriptWord(w, start_ms + i * 300, start_ms + i * 300 + 260) for i, w in enumerate(text.split())]
    return TranscriptSegment(words[0].start_time_ms, words[-1].end_time_ms, text, words=words)


def test_a_diagram_whose_items_are_said_far_apart_is_left_out():
    segments = [er_segment('Organic content is slow.', 0), er_segment('So we spend money on ads.', 12000)]
    g = {'template': 'compare_marks', 'at_ms': 0, 'duration_ms': 14000, 'fields': {'items': 'Organic content\nmoney on ads', 'wrong': 'first'}}
    assert ag.diagram_span(g, segments) is None
    near = [er_segment('Organic content is slow.', 0), er_segment('So we spend money on ads.', 3000)]
    assert ag.diagram_span(g, near) is not None


def test_cards_over_a_filmed_screen_take_a_dark_look_and_a_long_screen_gets_framed():
    graphics = [
        {'id': 'g-aaaa1', 'template': 'statement', 'at_ms': 10000, 'duration_ms': 3000, 'placement': 'top', 'fields': {'text': 'x y', 'variant': 'card'}, 'origin': 'auto'},
        {'id': 'g-aaaa2', 'template': 'stat', 'at_ms': 30000, 'duration_ms': 3000, 'placement': 'top', 'fields': {'value': '$5', 'variant': 'card'}, 'origin': 'auto'},
        {'id': 'g-aaaa3', 'template': 'statement', 'at_ms': 11000, 'duration_ms': 2000, 'placement': 'top', 'fields': {'text': 'x y'}, 'origin': 'member'},
    ]
    out, scenes = ed.screen_aware(graphics, [(9000, 20000)], stage=True)
    by = {g['id']: g for g in out}
    assert by['g-aaaa1']['fields']['variant'] == 'glass' and by['g-aaaa2']['fields']['variant'] == 'card'
    # Two over screens in a row take different dark looks; one already dark keeps its own.
    two = [{**graphics[0], 'id': f'g-bbbb{i}', 'at_ms': 10000 + i * 4000, 'duration_ms': 3000} for i in range(3)]
    two[2]['fields'] = {'text': 'x y', 'variant': 'bold'}
    looks = [g['fields']['variant'] for g in ed.screen_aware(two, [(9000, 30000)], stage=False)[0]]
    assert looks == ['glass', 'bold', 'bold'], looks
    assert 'variant' not in by['g-aaaa3']['fields']  # the member's own stays as set
    frames = [g for g in out if g['template'] == 'screen_frame']
    assert len(frames) == 1 and frames[0]['at_ms'] >= 13000 and frames[0]['duration_ms'] <= ed.FRAME_MAX_MS
    assert frames[0]['fields']['video'] == 'source' and scenes == [{'scene': 'visual', 'start_ms': frames[0]['at_ms'],
                                                                   'end_ms': frames[0]['at_ms'] + frames[0]['duration_ms'], 'backdrop': 'dark'}]
    # Without Stage layouts: only the darker looks.
    out, scenes = ed.screen_aware(graphics, [(9000, 20000)], stage=False)
    assert scenes == [] and not any(g['template'] == 'screen_frame' for g in out)


def test_create_clips_are_varied_too():
    """Create's Motion graphics: Auto uses the same rules (a 45-s clip keeps one sticky-notes card and differing looks)."""
    segs = [er_segment('Cold audience, people that do not know us.', 2000), er_segment('Content, offers and emails in one place.', 12000),
            er_segment('Finding new people, getting new buyers.', 22000), er_segment('We spent 500 dollars and made 900 dollars.', 32000)]
    planned = [
        {'template': 'sticky_notes', 'at_ms': 2000, 'duration_ms': 4000, 'placement': 'top', 'fields': {'items': 'Cold audience\npeople that do not know us'}},
        {'template': 'sticky_notes', 'at_ms': 12000, 'duration_ms': 4000, 'placement': 'top', 'fields': {'items': 'Content\noffers\nemails'}},
        {'template': 'sticky_notes', 'at_ms': 22000, 'duration_ms': 4000, 'placement': 'top', 'fields': {'items': 'Finding new people\ngetting new buyers'}},
    ]
    out = ag.fit_to_clip(planned, segs, [(0, 45000)], 1.0, {})
    kinds = [ag.kind_of(g) for g in out]
    # Sticky notes are a fallback: at most one, the others richer visuals their words fit.
    assert kinds.count('sticky_notes') <= 1 and len(set(kinds)) >= 2, kinds
    assert all(g['fields'].get('variant') in ag.VARIANTS[g['template']] for g in out if g['template'] in ag.VARIANTS)
