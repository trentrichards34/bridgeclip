"""Automatic direction for Edit my recording and Combine clips: motion graphics, chapter headers and stage scenes.

The edit's one paid planning call (edit_recording.plan_edit) also asks for the reel's motion graphics, with the
same templates, guidance and checks as Create's Motion graphics: Auto (auto_graphics.py), anchored on WORD indices
(the plan's words) instead of seconds, because the cut, the hook moved first and the member's changes on the review
screen all move the reel's clock:

- plan time (plan_graphics): every suggestion is checked against the words actually kept, on a "virtual" clock (each
  take or clip after the last, so their times never collide): words said (every word for the newer templates,
  MEANING_WORDS always), numbers exactly as said, items in order, about one graphic per 9-10 s, never two at once, and
  varied in code (auto_graphics' variety rules: per-template caps, no template twice in a row or within 25 s of itself,
  over-used cards turned into richer templates their words fit, a look per card). What survives goes to the review
  screen as word-anchored graphics (origin 'auto').
- render time (editor_graphics): the reel's own word timing (after the cut) places each one again: on its first
  spoken word, items lighting up as they're said, word-by-word cards, diagrams on screen while they're talked
  through; chapter headers when the talk says its structure out loud ("step one… step two…"); and with Stage
  layouts on, a stage scene around the big cards and a Visual scene around each diagram (auto_graphics.stage_scenes_for).

The reel then becomes a clip editor project (edit_project): the kept, ordered footage is the editor's source, so every
graphic, scene, the hook text and captions are editable there and Bake renders them.
"""
from __future__ import annotations

import copy
import logging
import math
import os
import re
from typing import Any, Optional, Sequence

from clip_engine.services import auto_graphics as ag
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord

logger = logging.getLogger(__name__)

# The planner's templates on an edited reel: Create's automatic ones and big words behind the speaker. The headline pill is
# a card here (a bold line, then the key words on a color box), never the hook: the reel has its own hook text.
EDIT_TEMPLATES = ag.AUTO_TEMPLATES + ('big_words',)
# About one graphic per this many seconds (the owner's first real runs: ~25 in a 4-minute reel is right, and fewer but
# richer beats more); the hard cap is one per SECONDS_PER_GRAPHIC, the guidance asks for one per 9.5-11 s.
SECONDS_PER_GRAPHIC = 9.0
TARGET_SECONDS_LOW, TARGET_SECONDS_HIGH = 11.0, 9.5
# Free time kept between two graphics on an edited reel (the face shows between them).
GAP_BETWEEN_MS = 1200
MAX_GRAPHICS = ag.MAX_GRAPHICS
# Each take or clip on the plan's virtual clock starts this long after the one before ends.
SOURCE_GAP_MS = 10_000
# Kept words closer than this are one stretch of the virtual cut.
STRETCH_GAP_MS = 2000
MEMBER_FIELD_CHARS = 800
GRAPHIC_ID = re.compile(r'^[a-z0-9-]{4,40}$')
# Templates whose renders the editor can make again (every editor template).
EDITOR_TEMPLATES = ag.SAVED_TEMPLATES + ('logo', 'highlight', 'screen_frame')


def _pace(register: Optional[str]) -> float:
    """How much sparser than a teaching reel (a story: half as many graphics; minimal: about a quarter)."""
    return {'story': 2.0, 'minimal': 4.0}.get(register or '', 1.0)


def graphics_limit(seconds: float, register: Optional[str] = None) -> int:
    """How many graphics a reel this long keeps at most: one per SECONDS_PER_GRAPHIC (a story or minimal reel: fewer),
    at least 3 (2 for a story or minimal one)."""
    pace = SECONDS_PER_GRAPHIC * _pace(register)
    return max(3 if not register or register == 'teaching' else 2, min(MAX_GRAPHICS, int(max(0.0, seconds) // pace)))


def graphics_target(seconds: float, register: Optional[str] = None) -> tuple[int, int]:
    """The number of graphics the guidance asks for (low, high): one per 9.5-11 s for teaching (fewer in a story)."""
    pace = _pace(register)
    high = max(2, min(graphics_limit(seconds, register), round(max(0.0, seconds) / (TARGET_SECONDS_HIGH * pace))))
    return max(2 if pace == 1.0 else 1, min(high, round(max(0.0, seconds) / (TARGET_SECONDS_LOW * pace)))), high


# ---------------------------------------------------------------------------
# The planner: schema and guidance
# ---------------------------------------------------------------------------

def graphic_item_schema() -> dict[str, Any]:
    """One graphic in the plan: auto_graphics' card fields, anchored on the word index where its first word is said."""
    item = copy.deepcopy(ag.GRAPHIC_SCHEMA)
    props = item['properties']
    del props['time']
    props['word'] = {'type': 'integer', 'description': 'Index of the word where the FIRST word on the graphic is said (a diagram: its first item).'}
    props['template'] = {'type': 'string', 'enum': list(EDIT_TEMPLATES)}
    props['text']['description'] += ' big_words: 1-3 punchy words exactly as said.'
    props['seconds']['description'] = 'How long it stays on screen: 2-6 for a card, 6-15 for a diagram, long enough for its words to be said.'
    item['required'] = ['template', 'word', 'seconds', 'placement', *ag.ALL_FIELDS, 'effect', 'fx_fields']
    return item


def graphics_schema() -> dict[str, Any]:
    return {'type': 'array', 'items': graphic_item_schema(), 'description': 'The motion graphics, in the order they play (see MOTION GRAPHICS).'}


def direction_rule(seconds: float, options: Optional[dict] = None) -> str:
    """The planner's guidance for an edited reel's graphics (`seconds`: about how long the recording is). `options`:
    stage, cta_keyword, register (teaching | story | minimal), hints (graphics_director.cue_hints, by word index)."""
    from clip_engine.services.graphics_director import director_rule, hints_block, plain_cap
    options = options or {}
    register = options.get('register') if options.get('register') in ('teaching', 'story', 'minimal') else None
    low, high = graphics_target(seconds, register)
    minutes = max(1.0, seconds / 60)
    statements = ag.template_cap('statement', seconds)
    keyword = ag.clean_keyword(options.get('cta_keyword'))
    rule = (
        '\n\nMOTION GRAPHICS ("graphics"). This video must look PRODUCED, like the best short-form creators\' edits, not like a '
        'raw talking head with captions, and not like a slideshow of the same white card. FEWER BUT BETTER: while the speaker '
        'explains something, a rich graphic lands on the point (a number counting up, icons popping in, a diagram lighting up '
        'item by item); between graphics the face shows. Personal moments, jokes, the punch line and the call to action stay on '
        'the face alone.\n'
        f'AMOUNT: about one graphic per {10 * _pace(register):.0f} seconds: for this recording about {f"{low} to {high}" if low < high else high} '
        f'(never more than {graphics_limit(seconds, register)}). '
        'Spread them over the WHOLE video (not all at the start), never two at once.\n'
        f'VARIETY BUDGET (about {minutes:.0f} minute{"s" if minutes >= 1.5 else ""}): never the same template twice in a row and never '
        f'the same template (or the same effect) within 25 seconds of itself; at most 2 "statement" per minute and {statements} in the '
        f'whole video; at most 2 "sticky_notes" in the whole video; at most 2 "quote"; plain text cards together at most '
        f'{plain_cap(seconds)}; use at least 7 different kinds (each effect counts as its own) in a video over two minutes. '
        'Extra cards past these limits are changed or dropped by the app, so pick the right visual the first time.\n'
        'BAD (from a real run, do not repeat): ten white serif "statement" cards in one reel ("I\'m using AI to do exactly that", '
        '"we only need three things", "This animation", "I\'ve built a", "this is gonna be controversial"); five "sticky_notes" '
        'stacks; a "compare_marks" sitting 15 seconds with one lonely card; a statement made of half a sentence. '
        'A line that is just talk (no number, no list, no contrast, no named things) gets NO graphic.\n'
        'MENU, best first: pick the richest visual the words support.\n'
        '1. a number, price or result said -> "stat" (value exactly as said in digits, label 1-5 of their words) or an fx number effect;\n'
        '2. apps, sites, tools or channels named -> "icon_pop": items = the names as said, icons = one generic icon each (video for '
        'YouTube, camera for Instagram, message for a chat app, mail for email, chart for analytics); never a brand logo;\n'
        '3. 3-6 tools, features or channels said as parts of one thing -> "orbit" (text = that one thing if said); one to three '
        'features named -> "feature_tile" with icons;\n'
        '4. when the speaker lists 3-6 parallel items in one section, a DIAGRAM that stays 6-15 s while they talk it through (at most '
        'one per section): steps that build -> "staircase" (items bottom to top, icons); a process that narrows -> "funnel"; '
        'milestones -> "journey"; things that grow -> "growth"; qualities of one thing -> "idea_hub"; "not X, but Y" -> '
        '"compare_marks" (items X then Y, wrong "first"; only when said within about 6 seconds). Its "word" is where its FIRST item is '
        'said; each item 1-4 words exactly as said. A video that walks through numbered steps or "three things" gets a diagram;\n'
        '5. one to three punchy words -> "big_words" (huge type behind the speaker, 1-4 per video); a key phrase -> "headline_pill" '
        '(text = the first words, phrase = the key words right after, e.g. text "Use any website\'s", phrase "hidden API");\n'
        '6. "not X, not Y, just Z" -> "strike_list" (items "scraping", "brittle selectors", final "just a typed client", accent '
        '"typed client"); a before and after -> "before_after"; steps said quickly -> "checklist"; a person or company introduced -> '
        '"lower_third";\n'
        '7. only for a real one-line thesis (a full thought, under 12 words) -> "statement" (e.g. text "Skip the scraping.", accent '
        '"scraping"); a line quoted from someone -> "quote"; 2-3 short parallel phrases -> "sticky_notes" (rarely).\n'
        'The app gives the whole video one look in the brand colors; you only pick the visual and the words.\n'
        'Chapter headers ("Step #1. Come up with your idea") are added automatically when the speaker numbers the sections out loud: '
        'do not make graphics for the step names themselves; put the section\'s diagram or list on its points instead.\n'
        'When the speaker shows a screen they filmed (a page, a dashboard, an app), the screen is the visual: put at most a "stat" '
        'or a short "headline_pill" there, never a stack of cards over it.\n'
    ) + director_rule(register, bool(keyword))
    if options.get('stage'):
        rule += ('Stage layouts are on: statement, strike_list, sticky_notes, list, checklist, orbit and feature_tile go on a stage at the '
                 'top of the frame with the speaker in a card below, and diagrams fill the frame. Then back to the full face for '
                 'personal lines.\n')
    if keyword:
        rule += (f'- the speaker asks viewers to comment: "comment_cta" with keyword exactly "{keyword}" and lead "Comment", where they '
                 'ask.\n')
    hints = options.get('hints') if isinstance(options.get('hints'), str) else ''
    rule += hints_block(hints[:6000])
    rule += (
        'Rules: use ONLY words said at that moment, in the order said, from words you keep (never from cut words). Copy every '
        'number exactly as said (write "three million" as "3 million"); never add a number, name, claim or word that was not said. '
        'Keep it short: a stat label under 6 words, items under 5 words each, a statement or quote under 12 words. Never put a graphic '
        'on the hook span (the hook text shows there) or on the call to action. "seconds" is how long it stays: long enough for all '
        'its words to be said. Set every field the template does not use to "" (items, icons and notes to [], effect to "", '
        'fx_fields to []).'
    )
    return rule


# ---------------------------------------------------------------------------
# Plan time: suggestions checked against the words kept
# ---------------------------------------------------------------------------

def virtual_offsets(words: Sequence[Any]) -> dict[int, int]:
    """Each source's start on the plan's virtual clock (ms): one after another, SOURCE_GAP_MS apart."""
    ends: dict[int, int] = {}
    for w in words:
        ends[w.src] = max(ends.get(w.src, 0), int(w.end_ms))
    # From SOURCE_GAP_MS: the reel opens on its hook, so the plan's first kept word isn't the reel's first second.
    offsets, clock = {}, SOURCE_GAP_MS
    for src in sorted(ends):
        offsets[src] = clock
        clock += ends[src] + SOURCE_GAP_MS
    return offsets


def kept_segments(words: Sequence[Any], keep: Sequence[bool], offsets: dict[int, int]) -> list[TranscriptSegment]:
    """The kept words as transcript segments on the virtual clock (a new segment at a sentence end or a long pause)."""
    segments: list[TranscriptSegment] = []
    current: list[TranscriptWord] = []

    def flush() -> None:
        if current:
            segments.append(TranscriptSegment(current[0].start_time_ms, current[-1].end_time_ms, ' '.join(w.word for w in current),
                                              words=list(current)))
            current.clear()

    last_src = None
    for i, w in enumerate(words):
        if not keep[i]:
            continue
        start, end = offsets[w.src] + int(w.start_ms), offsets[w.src] + int(w.end_ms)
        if current and (w.src != last_src or start - current[-1].end_time_ms >= 700 or len(current) >= 40):
            flush()
        current.append(TranscriptWord(w.text, start, max(start, end)))
        last_src = w.src
        if re.search(r'[.!?…]["\')\]]*$', w.text):
            flush()
    flush()
    return segments


def kept_ranges(words: Sequence[Any], keep: Sequence[bool], offsets: dict[int, int]) -> list[tuple[int, int]]:
    """The kept stretches on the virtual clock (words closer than STRETCH_GAP_MS join)."""
    ranges: list[list[int]] = []
    for i, w in enumerate(words):
        if not keep[i]:
            continue
        a, b = offsets[w.src] + int(w.start_ms), offsets[w.src] + int(w.end_ms)
        if ranges and a - ranges[-1][1] < STRETCH_GAP_MS:
            ranges[-1][1] = max(ranges[-1][1], b + 150)
        else:
            ranges.append([max(0, a - 80), b + 150])
    return [(a, b) for a, b in ranges if b > a]


def _clock(words: Sequence[Any], keep: Sequence[bool], offsets: dict[int, int]) -> list[tuple[int, int]]:
    """(virtual start ms, word index) of each kept word, in time order."""
    return sorted((offsets[w.src] + int(w.start_ms), i) for i, w in enumerate(words) if keep[i])


def anchor_word(at_ms: float, clock: Sequence[tuple[int, int]]) -> Optional[int]:
    """The kept word a graphic starts on: the first one said at or just before `at_ms` (within 150 ms), else the next."""
    for start, i in clock:
        if start >= at_ms - 150:
            return i
    return None


def word_hints(words: Sequence[Any], marks: Sequence[Optional[str]], limit: int = 40) -> str:
    """The transcript's cues (graphics_director.find_cues) as planner hints anchored on word indices ("w123 money …"),
    from the words likely kept."""
    from clip_engine.services.graphics_director import cue_hints
    if not words:
        return ''
    keep = [m is None for m in marks]
    offsets = virtual_offsets(words)
    clock = _clock(words, keep, offsets)

    def label(ms: float) -> str:
        word = anchor_word(ms, clock)
        return f'w{word}' if word is not None else f'w{clock[-1][1]}' if clock else 'w0'
    try:
        return cue_hints(kept_segments(words, keep, offsets), limit, label)
    except Exception as error:  # noqa: BLE001 - hints are a nicety: the plan goes ahead without them
        logger.warning(f"Cue hints skipped: {type(error).__name__}")
        return ''


TEXT_TEMPLATES = ('statement', 'title', 'big_words', 'quote')


def drops_meaning(graphic: dict, segments: Sequence[TranscriptSegment]) -> bool:
    """A text card that leaves out a word turning its line around ("not", "never", "no", "can't"…) said between its own
    words: "organic content, going viral" from "not organic content, not going viral" says the opposite of what was said."""
    fields = graphic['fields']
    if graphic['template'] not in TEXT_TEMPLATES and not (graphic['template'] == 'fx' and fields.get('text')):
        return False
    text = ' '.join(fields.get(k, '') for k in ('text', 'subline'))
    want = ag._tokens(text)
    if len(want) < 2:
        return False
    said = ag._timed_spans(segments, graphic['at_ms'] - ag.STRICT_WINDOW_MS, graphic['at_ms'] + graphic['duration_ms'] + ag.STRICT_WINDOW_MS)
    tokens = [t for t, _, _ in said]
    # Where the card's words are said, in order (each within a few words of the one before).
    for start in range(len(tokens)):
        if not ag._same(want[0], tokens[start]):
            continue
        k, ok = start + 1, True
        for w in want[1:]:
            hit = next((m for m in range(k, min(len(tokens), k + 4)) if ag._same(w, tokens[m])), None)
            if hit is None:
                ok = False
                break
            k = hit + 1
        if ok:
            between = tokens[start:k]
            flips = [t for t in between if (t in ag.MEANING_WORDS or t.endswith("n't")) and t not in want]
            return bool(flips)
    return False


def plan_register(words: Sequence[Any], marks: Sequence[Optional[str]], options: Optional[dict] = None) -> str:
    """The reel's style register: the member's (options['register']), else read from the kept words (teaching or story)."""
    options = options or {}
    if options.get('register') in ('teaching', 'story', 'minimal'):
        return options['register']
    from clip_engine.services.graphics_director import detect_register, find_cues
    keep = [m is None for m in marks]
    offsets = virtual_offsets(words)
    segments = kept_segments(words, keep, offsets)
    kept_ms = sum(w.end_ms - w.start_ms for i, w in enumerate(words) if keep[i])
    return detect_register(find_cues(segments), kept_ms) if segments else 'teaching'


def plan_graphics(raw: Any, words: Sequence[Any], marks: Sequence[Optional[str]], options: Optional[dict] = None,
                  avoid: Sequence[tuple[int, int]] = ()) -> list[dict]:
    """The planner's graphics, checked against the kept words, as word-anchored review graphics (origin 'auto').

    `words`: edit_recording.Word (text, start_ms, end_ms, src); `marks`: each word's cut reason (None: kept);
    `avoid`: word spans (start, end) no graphic may start in (the hook, the call to action)."""
    options = dict(options or {})
    if not isinstance(raw, list) or not words:
        return []
    keep = [m is None for m in marks]
    offsets = virtual_offsets(words)
    segments = kept_segments(words, keep, offsets)
    ranges = kept_ranges(words, keep, offsets)
    if not segments or not ranges:
        return []
    # (The reel's first second is checked on the reel itself: here the first kept stretch starts a little earlier.)
    ranges[0] = (ranges[0][0] - ag.FIRST_MS - 500, ranges[0][1])
    kept_seconds = sum(b - a for a, b in ranges) / 1000
    # The register: the member's, else what the words say (a story gets about half as many).
    if options.get('register') not in ('teaching', 'story', 'minimal'):
        from clip_engine.services.graphics_director import detect_register, find_cues
        options['register'] = detect_register(find_cues(segments), kept_seconds * 1000)
    limit = graphics_limit(kept_seconds, options['register'])
    blocked = {i for a, b in avoid for i in range(max(0, a), min(len(words), b + 1))}
    planned = []
    for item in raw[:MAX_GRAPHICS * 2]:
        if not isinstance(item, dict) or type(item.get('word')) is not int or not 0 <= item['word'] < len(words):
            continue
        w = words[item['word']]
        if item['word'] in blocked:
            continue
        planned.append({**item, 'time': (offsets[w.src] + int(w.start_ms)) / 1000})
    opts = {**options, 'templates': ['big_words'], 'max_cards': limit, 'headline_off': False, 'chapters': False, 'pill_cards': True,
            'gap_ms': GAP_BETWEEN_MS}
    checked = ag.parse_planned(planned, 0, ranges[-1][1] + 1, opts)
    checked = [g for g in checked if not drops_meaning(g, segments)]
    fitted = ag.fit_to_clip(checked, segments, ranges, 1.0, opts)
    clock = _clock(words, keep, offsets)
    out, taken = [], set()
    for g in fitted:
        if g['template'] == 'chapter':
            continue
        word = anchor_word(g['at_ms'], clock)
        if word is None or word in blocked:
            continue
        fields = {k: v for k, v in g['fields'].items() if k not in ('item_ms', 'word_ms', 'cue_ms')}
        out.append({'id': ag.new_id(taken), 'template': g['template'], 'word': word, 'duration_ms': int(g['duration_ms']),
                    'placement': g['placement'], 'fields': fields, 'origin': 'auto',
                    **({'depth': 'behind'} if g['template'] == 'big_words' else {})})
    return sorted(out, key=lambda g: g['word'])[:MAX_GRAPHICS]


# ---------------------------------------------------------------------------
# Render time: the graphics on the reel's own clock
# ---------------------------------------------------------------------------

def reel_segments(timed: Sequence[Sequence[Any]], offset_ms: int = 0) -> list[TranscriptSegment]:
    """The reel's words (text, start ms, end ms, word index) as transcript segments, shifted by `offset_ms`."""
    segments: list[TranscriptSegment] = []
    current: list[TranscriptWord] = []

    def flush() -> None:
        if current:
            segments.append(TranscriptSegment(current[0].start_time_ms, current[-1].end_time_ms, ' '.join(w.word for w in current),
                                              words=list(current)))
            current.clear()

    for t, s, e, *_ in timed:
        if current and (int(s) + offset_ms - current[-1].end_time_ms >= 700 or len(current) >= 14):
            flush()
        current.append(TranscriptWord(str(t), int(s) + offset_ms, max(int(s), int(e)) + offset_ms))
        if re.search(r'[.!?…]["\')\]]*$', str(t)):
            flush()
    flush()
    return segments


def _member_fields(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, value in raw.items():
        if isinstance(key, str) and re.fullmatch(r'[a-z_]{1,20}', key) and isinstance(value, str) and key not in ('item_ms', 'word_ms', 'cue_ms'):
            out[key] = re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', ' ', value)[:MEMBER_FIELD_CHARS]
    return out


def _start_of(word: int, starts: dict[int, int], order: Sequence[int]) -> Optional[int]:
    """The reel time of `word`, or of the next word still in the reel (at most 3 on), when it was cut."""
    if word in starts:
        return starts[word]
    for later in range(word + 1, word + 4):
        if later in starts:
            return starts[later]
    return None


def shortened(g: dict, length: int) -> dict:
    """A graphic made shorter, its words' and items' times kept inside it."""
    fields = dict(g['fields'])
    for key in ('word_ms', 'item_ms'):
        if fields.get(key):
            fields[key] = '\n'.join(str(min(int(t), max(0, length - 300))) for t in fields[key].split('\n'))
    return {**g, 'duration_ms': int(length), 'fields': fields}


def settle(graphics: list[dict]) -> list[dict]:
    """Graphics in time order that never overlap: one that runs into the next ends just before it when enough is left
    (MIN_TRIMMED_MS), else the weaker of the two goes."""
    out: list[dict] = []
    for g in sorted(graphics, key=lambda g: g['at_ms']):
        while out and g['at_ms'] < out[-1]['at_ms'] + out[-1]['duration_ms']:
            prev = out[-1]
            room = g['at_ms'] - ag.GAP_MS - prev['at_ms']
            if room >= ag.MIN_TRIMMED_MS:
                out[-1] = shortened(prev, room)
                break
            if ag._priority(prev) >= ag._priority(g):
                g = None
                break
            out.pop()
        if g is not None:
            out.append(g)
    return out


def card_graphic(card: dict) -> Optional[tuple[str, dict[str, str]]]:
    """A half-screen card (edit_recording.clean_card) as the editor graphic that says the same."""
    kind, title, items = card.get('type'), card.get('title') or '', [i for i in card.get('items') or [] if i]
    if kind == 'list' and len(items) >= 2:
        return 'list', {'title': title, 'items': '\n'.join(items[:5])}
    if kind == 'stat' and title:
        return 'stat', {'value': title, **({'label': items[0]} if items else {})}
    if kind == 'compare' and len(items) >= 2:
        return 'before_after', {'before': items[0], 'after': items[1]}
    if kind == 'chat' and len(items) >= 2:
        return 'quote', {'text': items[1][:ag.MAX_FIELD_CHARS]}
    return None


def editor_graphics(specs: Sequence[dict], timed: Sequence[Sequence[Any]], total_ms: int, options: Optional[dict] = None,
                    offset_ms: int = 0, popups: Sequence[dict] = (), pins: Sequence[dict] = ()) -> tuple[list[dict], list[str]]:
    """The reel's editor graphics (source time = reel time + `offset_ms`, the length of an opening before it).

    `specs`: the review's graphics ({id, template, word, duration_ms, placement, fields, origin, size?, depth?}): the
    automatic ones (origin 'auto') are timed again on the reel's words (and left out when their words were cut); the
    member's are placed as they set them. `popups`: number and keyword pop-ups and half-screen cards ({word, text,
    kind, card?, seconds?}), as graphics; `pins`: pinned images ({word, image: a .graphics/images name}) as Logo pops.
    `options`: motion (automatic graphics on), stage, chapters, cta_keyword. Returns (graphics, warnings)."""
    options = dict(options or {})
    starts = {int(i): int(s) for _, s, _, i, *_ in timed}
    order = [int(i) for *_, i in timed]
    segments = reel_segments(timed, offset_ms)
    end_ms = offset_ms + int(total_ms)
    warnings: list[str] = []
    taken: set[str] = set()
    auto, member, extras = [], [], []
    lost = 0
    for spec in specs or []:
        if not isinstance(spec, dict) or spec.get('template') not in EDITOR_TEMPLATES or type(spec.get('word')) is not int:
            continue
        at = _start_of(spec['word'], starts, order)
        if at is None:
            lost += 1
            continue
        at += offset_ms
        fields = _member_fields(spec.get('fields'))
        length = spec.get('duration_ms') if type(spec.get('duration_ms')) is int else ag.DEFAULT_MS.get(spec['template'], 3500)
        gid = spec['id'] if isinstance(spec.get('id'), str) and GRAPHIC_ID.match(spec['id']) and spec['id'] not in taken else ag.new_id(taken)
        taken.add(gid)
        g = {'id': gid, 'template': spec['template'], 'at_ms': at, 'duration_ms': length,
             'placement': spec.get('placement') if spec.get('placement') in ag.PLACEMENTS else 'top', 'fields': fields}
        if spec.get('origin') == 'auto' and spec['template'] in EDIT_TEMPLATES:
            if options.get('motion', True):
                auto.append(g)
            continue
        member.append({**g, 'origin': 'member' if spec.get('origin') != 'chat' else 'chat',
                       **({'size': spec['size']} if spec.get('size') in ('compact', 'card', 'stage') else {}),
                       **({'depth': 'behind'} if spec.get('depth') == 'behind' and spec['template'] in ('big_words', 'title', 'statement', 'headline_pill') else {})})
    for p in popups or []:
        at = starts.get(p.get('word')) if isinstance(p, dict) else None
        if at is None:
            continue
        if p.get('kind') == 'card':
            made = card_graphic(p.get('card') or {})
            if not made:
                continue
            template, fields = made
            length = round(float(p.get('seconds') or 3.0) * 1000)
        else:
            template, fields = ('stat', {'value': p['text']}) if p.get('kind') == 'number' and re.search(r'\d', p.get('text') or '') \
                else ('title', {'text': p.get('text') or ''})
            length = 1800
        extras.append({'id': ag.new_id(taken), 'template': template, 'at_ms': at + offset_ms, 'duration_ms': length, 'placement': 'top',
                       'fields': fields, 'origin': 'auto'})
    for pin in pins or []:
        at = starts.get(pin.get('word')) if isinstance(pin, dict) else None
        if at is None or not isinstance(pin.get('image'), str):
            continue
        extras.append({'id': ag.new_id(taken), 'template': 'logo', 'at_ms': at + offset_ms, 'duration_ms': 1500, 'placement': 'middle',
                       'fields': {'image': pin['image']}, 'origin': 'member'})
    # The automatic ones: on their first spoken word, items as said, diagrams while talked through (each on its own: they
    # were picked and spaced at plan time; the cut can bring two closer, which is settled below); chapter headers.
    # Each was picked, varied and given its look at plan time: here it is only timed again (no variety pass on one card).
    opts = {'stage': bool(options.get('stage')), 'chapters': False, 'cta_keyword': options.get('cta_keyword') or '',
            'templates': ['big_words'], 'max_cards': MAX_GRAPHICS, 'pill_cards': True, 'variety': False}
    ranges = [(offset_ms, end_ms)]
    fitted: list[dict] = []
    for g in auto:
        one = ag.fit_to_clip([g], segments, ranges, 1.0, opts)
        if not one:
            lost += 1
            continue
        fitted.append({**one[0], 'id': g['id'], **({'depth': 'behind'} if g['template'] == 'big_words' else {})})
    fitted = settle(fitted)
    if options.get('chapters') and options.get('motion', True):
        fitted += ag.fit_to_clip([], segments, ranges, 1.0, {**opts, 'chapters': True})
    # The member's graphics win their time: an automatic one that would play over one gives way (chapters stay: own band).
    kept = [g for g in fitted if g['template'] == 'chapter' or not any(
        g['at_ms'] < m['at_ms'] + m['duration_ms'] and m['at_ms'] < g['at_ms'] + g['duration_ms'] for m in member)]
    # Pop-ups, cards and pinned images give way to a graphic at their time (as they always have): one that a graphic
    # starts into ends just before it when enough of it is left, else it is left out.
    def fit(x: dict, others: Sequence[dict]) -> Optional[dict]:
        for o in sorted(others, key=lambda o: o['at_ms']):
            if o['template'] == 'chapter' or not (x['at_ms'] < o['at_ms'] + o['duration_ms'] and o['at_ms'] < x['at_ms'] + x['duration_ms']):
                continue
            room = o['at_ms'] - ag.GAP_MS - x['at_ms']
            if room < ag.EDITOR_MIN_MS:
                return None
            x = {**x, 'duration_ms': room}
        return x
    shown: list[dict] = []
    for x in sorted(extras, key=lambda x: x['at_ms']):
        placed_x = fit(x, [*kept, *member, *shown])
        if placed_x:
            shown.append(placed_x)
    if len(shown) < len(extras):
        gave = len(extras) - len(shown)
        warnings.append(f"{gave} pop-up{'s' if gave != 1 else ''} or pinned image{'s' if gave != 1 else ''} left out: "
                        f"{'they' if gave != 1 else 'it'} came during a graphic.")
    placed = []
    for g in [*kept, *member, *shown]:
        length = int(max(ag.EDITOR_MIN_MS, min(ag.editor_max_ms(g['template']), g['duration_ms'], end_ms - g['at_ms'])))
        if g['at_ms'] >= end_ms - ag.EDITOR_MIN_MS or g['at_ms'] < 0:
            continue
        placed.append({**g, 'at_ms': int(g['at_ms']), 'duration_ms': length})
    placed.sort(key=lambda g: g['at_ms'])
    if len(placed) > MAX_GRAPHICS:
        placed = placed[:MAX_GRAPHICS]
    if lost:
        warnings.append(f"{lost} graphic{'s were' if lost != 1 else ' was'} left out: {'their words were' if lost != 1 else 'its words were'} cut.")
    return placed, warnings


# A filmed screen (a stretch without a face) this long gets one framed moment: the same footage in a Screen recording
# window on a dark Visual scene (like the target reels' browser frame), at most FRAME_MAX_MS, at most MAX_FRAMES a reel.
FRAME_MIN_WINDOW_MS = 4500
FRAME_MIN_MS, FRAME_MAX_MS = 3500, 6000
MAX_FRAMES = 3
# Cards that read as a white slab over a busy page; over a filmed screen they take a darker look (SCREEN_VARIANTS).
SCREEN_SHARE = 0.5


def screen_aware(graphics: list[dict], windows: Sequence[tuple[int, int]], stage: bool) -> tuple[list[dict], list[dict]]:
    """Graphics made for a reel's filmed screens (`windows`, reel ms): an automatic card mostly over a screen takes its
    darker look, so no white slab sits on a busy page; and with Stage layouts on, the first free stretch of each long
    screen window is framed: that very footage in a Screen recording window on a dark Visual scene. Returns
    (graphics, the Visual scenes for the frames)."""
    out = []
    last: dict[str, str] = {}
    for g in sorted(graphics, key=lambda g: g['at_ms']):
        a, b = g['at_ms'], g['at_ms'] + g['duration_ms']
        inside = sum(max(0, min(b, hi) - max(a, lo)) for lo, hi in windows)
        looks = ag.SCREEN_VARIANTS.get(g['template'])
        if g.get('origin') == 'auto' and looks and inside >= SCREEN_SHARE * (b - a) and g['fields'].get('variant') not in looks:
            # A darker look, not the one the last card of this template had.
            pick = next((v for v in looks if v != last.get(g['template'])), looks[0])
            g = {**g, 'fields': {**g['fields'], 'variant': pick}}
        if g['fields'].get('variant'):
            last[g['template']] = g['fields']['variant']
        out.append(g)
    if not stage:
        return out, []
    frames, scenes = [], []
    taken = {g['id'] for g in out}
    for lo, hi in sorted(windows):
        if len(frames) >= MAX_FRAMES or hi - lo < FRAME_MIN_WINDOW_MS:
            continue
        busy = sorted((g['at_ms'], g['at_ms'] + g['duration_ms']) for g in out if g['template'] != 'chapter' and g['at_ms'] < hi and g['at_ms'] + g['duration_ms'] > lo)
        start = lo + 200
        spot = None
        for a, b in [*busy, (hi, hi)]:
            if min(a, hi - 200) - start >= FRAME_MIN_MS:
                spot = (start, min(a - ag.GAP_MS, hi - 200, start + FRAME_MAX_MS))
                break
            start = max(start, b + ag.GAP_MS)
        if spot is None or spot[1] - spot[0] < FRAME_MIN_MS:
            continue
        a, b = int(spot[0]), int(spot[1])
        frames.append({'id': ag.new_id(taken), 'template': 'screen_frame', 'at_ms': a, 'duration_ms': b - a, 'placement': 'top',
                       'fields': {'video': 'source', 'from': f'{a / 1000:.3f}', 'shape': 'square'}, 'origin': 'auto', 'size': 'stage'})
        scenes.append({'scene': 'visual', 'start_ms': a, 'end_ms': b, 'backdrop': 'dark'})
    return sorted(out + frames, key=lambda g: g['at_ms']), scenes


def editor_scenes(graphics: Sequence[dict], total_ms: int, brand: Optional[str], avoid: Sequence[tuple[int, int]] = (),
                  framed: Sequence[dict] = ()) -> list[dict]:
    """Stage scenes around the stage-size graphics and Visual scenes around the diagrams (auto_graphics.stage_scenes_for),
    cut around `avoid` (reel ms: stretches that show a screen the speaker filmed, which are the visual already); `framed`:
    the Visual scenes of the screens framed in a window (screen_aware), which sit inside those stretches."""
    from clip_engine.services.stage_scenes import MAX_SCENES, MIN_SCENE_MS, auto_look
    backdrop, card = auto_look(brand)
    scenes = ag.stage_scenes_for(graphics, 0, int(total_ms), backdrop, card)
    if avoid:
        cut = []
        for s in scenes:
            pieces = [(s['start_ms'], s['end_ms'])]
            for a, b in avoid:
                pieces = [p for lo, hi in pieces for p in ((lo, min(hi, a)), (max(lo, b), hi)) if p[1] - p[0] >= MIN_SCENE_MS]
            cut.extend({**s, 'start_ms': lo, 'end_ms': hi} for lo, hi in pieces)
        scenes = cut
    for f in framed:
        if not any(f['start_ms'] < s['end_ms'] and s['start_ms'] < f['end_ms'] for s in scenes) and f['end_ms'] - f['start_ms'] >= MIN_SCENE_MS:
            scenes.append(dict(f))
    return ag.checked_saved_scenes(sorted(scenes, key=lambda s: s['start_ms'])[:MAX_SCENES], int(total_ms))


def size_for_scenes(graphics: list[dict], scenes: Sequence[dict]) -> list[dict]:
    """A stage card outside any stage or visual scene (cut around a screen) is drawn as a card again."""
    out = []
    for g in graphics:
        if g.get('size') == 'stage' and g.get('origin') == 'auto' and g['template'] not in ag.DIAGRAMS and not ag.on_stage(g, scenes):
            g = {**g, 'size': 'card'}
        out.append(g)
    return out


# ---------------------------------------------------------------------------
# The editor project
# ---------------------------------------------------------------------------

CANDIDATE_ID = 'edit-reel'


# Directed reels: the hook text fades out after this many seconds (or hands over to the first chapter header).
DIRECTED_HOOK_HIDE_S = 5
# A hook bar pads the whole reel down; on a directed reel it floats on a matching box instead, so the stage gets the top.
FLOATING_BOX = {'white': 'light', 'black': 'dark', 'brand': 'brand'}


def directed_hook_look(raw: Optional[dict]) -> dict:
    """The hook look on a directed reel (Motion graphics on): a bar becomes floating text on the same colors, and it
    hides after DIRECTED_HOOK_HIDE_S unless the member chose when it hides. Both can be changed in the editor's Hook tab."""
    from clip_engine.services.rendering_service import parse_headline_look
    look = parse_headline_look(raw)
    if look.look == 'none':
        return look.as_dict()
    if look.look in FLOATING_BOX:
        look.text_bg = FLOATING_BOX[look.look]
        look.look = 'floating'
    if look.hide_after_s is None:
        look.hide_after_s = DIRECTED_HOOK_HIDE_S
    return look.as_dict()


def candidate_look_extras(look: Any) -> Optional[dict]:
    """The member's look extras for the editor's clip (the ones its bake draws), with their color and keyword."""
    ids = [x for x in getattr(look, 'look_extras', ()) or () if x in ('keyword_pill', 'accent_words', 'progress_bar', 'comment_box', 'punch_zoom', 'broll_tags')]
    if not ids:
        return None
    color = getattr(look, 'look_extras_color', None)
    keyword = getattr(look, 'look_extras_keyword', '') or ''
    return {'ids': ids, **({'color': color.upper()} if isinstance(color, str) and re.fullmatch(r'#[0-9A-Fa-f]{6}', color) else {}),
            **({'keyword': keyword} if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,23}', keyword) else {})}


def edit_project(title: str, total_ms: int, segments: Sequence[TranscriptSegment], look: Any, graphics: list[dict],
                 scenes: list[dict], brand_mark: Optional[dict], preview_id: str, width: int = 1080, height: int = 1920,
                 directed: bool = False) -> dict:
    """The editor project for an edited reel: one ready clip covering the whole reel (the editor's source), with its
    hook text, captions, look extras, graphics and scenes. Baking it (main) replaces the reel in the Library (clip 0).
    `directed`: Motion graphics on (the hook floats and hides after a few seconds: directed_hook_look)."""
    from clip_engine.services.automatic_editor import editor_rows
    from clip_engine.services.manual_editor import default_crop, utf16_prefix, validate_candidate, validate_candidate_list
    hook_text = ' '.join((look.headline or '').split())
    hook_look = dict(look.headline_look or {'look': 'white', 'color': '#FFFFFF', 'font': 'clean'})
    if directed:
        hook_look = directed_hook_look(hook_look)
    hook = {'text': utf16_prefix(hook_text, 200), 'look': hook_look} if hook_text else None
    extras = candidate_look_extras(look)
    candidate = {
        'id': CANDIDATE_ID, 'title': utf16_prefix(title, 200) or 'My recording', 'ranges': [[0, int(total_ms)]],
        'scenes': [{'at_ms': 0, 'layout': 'fill', 'crops': [default_crop(width, height, width / height)]}],
        'captions': bool(look.include_captions), 'caption_preset': look.caption_preset, 'video_speed': 1, 'status': 'ready',
        'caption_edits': [], 'caption_suppression_ranges': [], 'caption_y': None, 'hook': hook, 'cta_id': None,
        'score': 0, 'reason': 'Edit my recording', 'review': None, 'exports': [], 'requires_visual_context': False, 'library_clip': 0,
        **({'graphics': graphics} if graphics else {}), **({'stage_scenes': scenes} if scenes else {}),
        **({'look_extras': extras} if extras else {}),
    }
    validate_candidate(candidate, int(total_ms), len(segments))
    validate_candidate_list([candidate])
    project = {'version': 1, 'revision': 0, 'title': utf16_prefix(title, 1024) or 'My recording', 'width': width, 'height': height,
               'duration_ms': int(total_ms), 'aspect_ratio': '9:16', 'candidates': [candidate],
               'transcript': editor_rows(list(segments), int(total_ms)), 'headline_voice': 'creator', 'preview_id': preview_id,
               'frame_preview': True}
    if brand_mark:
        project['brand_mark'] = brand_mark
    return project


def saved_brand_mark(mark: Optional[dict], root: str) -> Optional[dict]:
    """The brand mark as the editor project keeps it (the logo copied into the run as .brand-logo.png)."""
    if not mark or mark.get('position') not in ('top-left', 'top-right', 'bottom-left', 'bottom-right'):
        return None
    logo = mark.get('logo_path')
    has_logo = bool(logo) and os.path.realpath(logo) == os.path.realpath(os.path.join(root, '.brand-logo.png')) and os.path.isfile(logo)
    handle = str(mark.get('handle') or '')[:80]
    if not handle and not has_logo:
        return None
    return {'handle': handle, 'logo': has_logo, 'position': mark['position']}


def transcript_json(segments: Sequence[TranscriptSegment]) -> dict:
    return {'segments': [{'start_time_ms': s.start_time_ms, 'end_time_ms': s.end_time_ms, 'text': s.text, 'speaker_label': None,
                          'audio_events': [], 'words': [{'word': w.word, 'start_time_ms': w.start_time_ms, 'end_time_ms': w.end_time_ms}
                                                        for w in s.words]} for s in segments]}


def screen_windows(timed: Sequence[Sequence[Any]], words: Sequence[Any], screens: set[int], offset_ms: int = 0) -> list[tuple[int, int]]:
    """Reel stretches (ms) whose words come from screen clips (Combine clips: a laptop or monitor filmed)."""
    out: list[list[int]] = []
    for _, s, e, i, *_ in timed:
        if words[int(i)].src not in screens:
            continue
        a, b = int(s) + offset_ms, int(e) + offset_ms
        if out and a - out[-1][1] < 1500:
            out[-1][1] = b
        else:
            out.append([a, b])
    return [(a, b) for a, b in out if b - a >= 800]


# Faceless stretches: sampled every FACE_STEP_MS; this many in a row without a face is a filmed screen (or b-roll).
FACE_STEP_MS = 1500
FACELESS_RUN = 2


def faceless_windows(video: str, start_ms: int, end_ms: int) -> list[tuple[int, int]]:
    """Stretches of the reel (ms) where no face shows for a while: a screen, a page or b-roll filmed mid-take. They are
    the visual already, so no stage goes over them (the speaker card would show a cropped screen). One small, fast pass
    over the video (a frame every FACE_STEP_MS)."""
    try:
        import cv2
        import numpy as np
        from clip_engine.services.look_extras import FACE_MODEL
        from clip_engine.services.media_process import run_media
        if not os.path.isfile(FACE_MODEL) or end_ms - start_ms < FACE_STEP_MS * FACELESS_RUN:
            return []
        w, h = 270, 480
        result = run_media(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{start_ms / 1000:.3f}", "-i", video, "-t", f"{(end_ms - start_ms) / 1000:.3f}",
                            "-an", "-vf", f"fps=1000/{FACE_STEP_MS},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], timeout=900,
                           max_output=(math.ceil((end_ms - start_ms) / FACE_STEP_MS) + 4) * w * h * 3)
        data = result.stdout or b""
        frames = len(data) // (w * h * 3)
        if result.returncode != 0 or not frames:
            return []
        detector = cv2.FaceDetectorYN.create(FACE_MODEL, "", (w, h), 0.7, 0.3, 50)
        seen = []
        for k in range(frames):
            frame = np.frombuffer(data, dtype=np.uint8, count=w * h * 3, offset=k * w * h * 3).reshape(h, w, 3)
            _, faces = detector.detect(frame)
            seen.append(faces is not None and len(faces) > 0)
    except Exception as error:  # noqa: BLE001 - without it the stage may go over a screen; the reel is still made
        logger.warning(f"Face check skipped: {type(error).__name__}")
        return []
    out: list[tuple[int, int]] = []
    k = 0
    while k < len(seen):
        if seen[k]:
            k += 1
            continue
        j = k
        while j < len(seen) and not seen[j]:
            j += 1
        if j - k >= FACELESS_RUN:
            out.append((int(start_ms + k * FACE_STEP_MS), int(min(end_ms, start_ms + j * FACE_STEP_MS))))
        k = j
    return out


def overlaps(a: tuple[float, float], windows: Sequence[tuple[float, float]]) -> bool:
    return any(a[0] < hi and a[1] > lo for lo, hi in windows)


def round_ms(value: float) -> int:
    return int(math.floor(value))
