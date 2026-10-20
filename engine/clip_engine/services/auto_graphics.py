"""Automatic motion graphics for Create's Automatic clips.

When the member turns "Motion graphics: Auto" on, the clip planner (the same
paid call that picks the clips) also suggests up to three moments per clip for
an animated card: a number said out loud, a list of steps, a named tool or
person, a comparison, a line worth reading. This module turns those
suggestions into the clip editor's graphics (src/shared/motion-graphics.ts:
SOURCE time, `origin: 'auto'`) and drops anything it can't stand behind:

- every number on a card must be said within 3 seconds of the card's time;
- most of the card's words must be said near it (nothing made up);
- never two cards at once, never in the clip's first second, at most three.

Main draws the kept cards with the editor's templates after the run and lays
them over the finished clips (graphics_overlay); the editor shows them in the
Graphics row when the clip is opened, editable like any other graphic.
"""
from __future__ import annotations

import os
import math
import re
import secrets
from typing import Any, Iterable, Optional, Sequence

# Templates the planner may pick (never the logo or the arrow: those need the member's picture or eye).
AUTO_TEMPLATES = ('stat', 'title', 'list', 'checklist', 'before_after', 'quote', 'lower_third')
TEMPLATE_FIELDS = {
    'stat': ('value', 'label'), 'title': ('text',), 'list': ('title', 'items'), 'checklist': ('title', 'items'),
    'before_after': ('before', 'after'), 'quote': ('text', 'author'), 'lower_third': ('name', 'role'),
}
ALL_FIELDS = ('value', 'label', 'text', 'title', 'items', 'before', 'after', 'author', 'name', 'role')
PLACEMENTS = ('top', 'middle', 'bottom')
DEFAULT_MS = {'stat': 3500, 'title': 2500, 'list': 5000, 'lower_third': 4000, 'before_after': 4000, 'checklist': 5000, 'quote': 5000}
MAX_PER_CLIP = 3
# The planner may suggest a few more than are kept (the weakest go).
MAX_SUGGESTED = 6
MIN_MS, MAX_MS = 1500, 7000
# The editor's limits (motion-graphics.ts).
EDITOR_MIN_MS, EDITOR_MAX_MS = 800, 8000
MAX_FIELD_CHARS = 160
MAX_ITEMS = 5
MAX_ITEM_CHARS = 60
# Nothing in the clip's first second (the hook lands first).
FIRST_MS = 1000
# A number on a card must be said this close to the card's time; its words this close to the card.
NUMBER_WINDOW_MS = 3000
WORD_WINDOW_MS = 6000
MIN_WORD_SHARE = 0.75
# A card is moved later by at most this much to clear the first second, or dropped.
MAX_SHIFT_MS = 2500

_CONTROL = re.compile(r'[\x00-\x1f\x7f]')
_ITEM_NUMBER = re.compile(r'^\s*(?:\d{1,2}[.):]|[-•*])\s+')
_WORD = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")
_HAS_DIGIT = re.compile(r'\d')

GRAPHIC_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'properties': {
        'template': {'type': 'string', 'enum': list(AUTO_TEMPLATES)},
        'time': {'type': 'number', 'description': 'When the words on the card start being said, seconds from the start of the video.'},
        'seconds': {'type': 'number', 'description': 'How long the card stays on screen (2-6).'},
        'placement': {'type': 'string', 'enum': list(PLACEMENTS)},
        'value': {'type': 'string', 'description': 'stat: the number as said, e.g. "15 billion", "$1,200", "25%".'},
        'label': {'type': 'string', 'description': 'stat: a few words said about the number.'},
        'text': {'type': 'string', 'description': 'title or quote: the words as said.'},
        'title': {'type': 'string', 'description': 'list or checklist: a short heading said in the clip, or "".'},
        'items': {'type': 'array', 'items': {'type': 'string'}, 'description': 'list or checklist: 2-5 short points as said.'},
        'before': {'type': 'string', 'description': 'before_after: the first side, as said.'},
        'after': {'type': 'string', 'description': 'before_after: the second side, as said.'},
        'author': {'type': 'string', 'description': 'quote: who said it, only if their name is said; else "".'},
        'name': {'type': 'string', 'description': 'lower_third: the name of the person, tool or company as said.'},
        'role': {'type': 'string', 'description': 'lower_third: what they are, as said; else "".'},
    },
    'required': ['template', 'time', 'seconds', 'placement', *ALL_FIELDS],
    'additionalProperties': False,
}

MOTION_GRAPHICS_RULE = (
    '\nMOTION GRAPHICS: For every clip, "graphics" lists 0-3 moments where a short animated card on screen helps the viewer: '
    'a number or result said out loud ("stat": value and label), steps or a list said in order ("list" or "checklist": '
    'items), a tool, person or company named ("lower_third": name and role), a comparison ("before_after"), a line worth '
    'reading ("quote"), or a few punchy words ("title"). Use ONLY words said in the transcript at that moment. Copy every '
    'number exactly as said (write "fifteen billion" as "15 billion"); never add a number, name, claim or word that was '
    'not said. Keep cards short: a stat label under 6 words, list items under 5 words each, at most 5 items, a title or '
    'quote under 12 words. "time" is when those words start being said (seconds from the start of the video), at least '
    '1 second after the clip starts; "seconds" is how long the card stays (2-6). Cards in a clip never overlap. Prefer '
    'moments with numbers, lists, named tools or people, and comparisons; return [] when nothing fits. Set every field '
    'the template does not use to "" (items to []).'
)


def graphics_schema() -> dict[str, Any]:
    return {'type': 'array', 'items': GRAPHIC_SCHEMA, 'description': '0-3 motion graphic moments (see MOTION GRAPHICS).'}


def _text(value: Any, limit: int = MAX_FIELD_CHARS) -> str:
    if not isinstance(value, str):
        return ''
    return ' '.join(_CONTROL.sub(' ', value).split())[:limit].strip()


def _number(value: Any) -> Optional[float]:
    return float(value) if type(value) in (int, float) and math.isfinite(value) else None


def clean_fields(template: str, raw: dict) -> dict[str, str]:
    """The template's own fields, trimmed to the editor's limits; list items newline-separated."""
    fields: dict[str, str] = {}
    for key in TEMPLATE_FIELDS[template]:
        if key == 'items':
            items = raw.get('items')
            if isinstance(items, str):
                items = items.split('\n')
            lines = [_text(_ITEM_NUMBER.sub('', item), MAX_ITEM_CHARS) for item in items if isinstance(item, str)] if isinstance(items, list) else []
            lines = [line for line in lines if line][:MAX_ITEMS]
            if lines:
                fields['items'] = '\n'.join(lines)
        else:
            text = _text(raw.get(key))
            if text:
                fields[key] = text
    return fields


def has_content(template: str, fields: dict[str, str]) -> bool:
    """Enough words to draw a useful card (stricter than the editor: a stat needs its number, a list two points)."""
    if template == 'stat':
        return bool(_HAS_DIGIT.search(fields.get('value', '')))
    if template in ('title', 'quote'):
        return bool(fields.get('text'))
    if template in ('list', 'checklist'):
        return len(fields.get('items', '').split('\n')) >= 2 if fields.get('items') else False
    if template == 'lower_third':
        return bool(fields.get('name'))
    if template == 'before_after':
        return bool(fields.get('before') and fields.get('after'))
    return False


def parse_planned(raw: Any, start_ms: int, end_ms: int) -> list[dict]:
    """The planner's suggestions for one clip, checked for shape only (source ms; words are checked later)."""
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:MAX_SUGGESTED * 2]:
        if not isinstance(item, dict) or item.get('template') not in AUTO_TEMPLATES:
            continue
        time, seconds = _number(item.get('time')), _number(item.get('seconds'))
        if time is None:
            continue
        at_ms = round(time * 1000)
        if not start_ms <= at_ms < end_ms:
            continue
        template = item['template']
        duration = round(seconds * 1000) if seconds is not None else DEFAULT_MS[template]
        fields = clean_fields(template, item)
        if not has_content(template, fields):
            continue
        placement = item.get('placement') if item.get('placement') in PLACEMENTS else ('bottom' if template == 'lower_third' else 'top')
        out.append({'template': template, 'at_ms': at_ms, 'duration_ms': max(MIN_MS, min(MAX_MS, duration)),
                    'placement': placement, 'fields': fields})
        if len(out) >= MAX_SUGGESTED:
            break
    return out


# ---------------------------------------------------------------------------
# Words said near a card.
# ---------------------------------------------------------------------------

def _words_between(segments: Sequence, lo: int, hi: int) -> str:
    """The transcript's words said between lo and hi (source ms), in order."""
    parts = []
    for seg in segments:
        if seg.end_time_ms < lo or seg.start_time_ms > hi:
            continue
        words = getattr(seg, 'words', None) or []
        if words:
            parts.extend(w.word for w in words if w.end_time_ms >= lo and w.start_time_ms <= hi)
        else:
            parts.append(seg.text)
    return ' '.join(parts)


def _numbers(text: str) -> list[float]:
    from clip_engine.services.edit_recording import numbers_in
    try:
        return numbers_in(text)
    except Exception:
        return []


def _tokens(text: str) -> list[str]:
    return _WORD.findall(text.lower().replace('’', "'").replace('‘', "'"))


def _said(token: str, heard: set[str]) -> bool:
    if token in heard:
        return True
    # Plurals and possessives as said ("tool" / "tools", "brand's").
    base = token.split("'")[0]
    return base in heard or base.rstrip('s') in heard or f'{base}s' in heard


def words_said(graphic: dict, segments: Sequence) -> bool:
    """Every number on the card is said within 3 s of it; most of its words are said near it."""
    at, length = graphic['at_ms'], graphic['duration_ms']
    near_numbers = _numbers(_words_between(segments, at - NUMBER_WINDOW_MS, at + NUMBER_WINDOW_MS))
    for text in graphic['fields'].values():
        for line in text.split('\n'):
            for value in _numbers(line):
                if not any(abs(value - heard) <= 1e-6 * max(1.0, abs(value)) for heard in near_numbers):
                    return False
    heard = set(_tokens(_words_between(segments, at - WORD_WINDOW_MS, at + length + WORD_WINDOW_MS)))
    tokens = [t for text in graphic['fields'].values() for t in _tokens(text) if not _HAS_DIGIT.search(t)]
    if not tokens:
        return True
    return sum(_said(t, heard) for t in tokens) / len(tokens) >= MIN_WORD_SHARE


# ---------------------------------------------------------------------------
# Fitting cards to the finished cut.
# ---------------------------------------------------------------------------

def output_ms(ranges: Sequence[Sequence[float]], speed: float, t: float) -> Optional[float]:
    """Source time → output time through the cut and the speed (the editor's outputTime); None when cut out."""
    before = 0.0
    for a, b in ranges:
        if a <= t <= b:
            return (before + t - a) / speed
        before += b - a
    return None


def source_ms(ranges: Sequence[Sequence[float]], speed: float, out: float) -> Optional[float]:
    """Output time → source time; None past the clip's end."""
    left = out * speed
    for a, b in ranges:
        if left <= b - a:
            return a + left
        left -= b - a
    return None


def window(ranges: Sequence[Sequence[float]], speed: float, at: float, length: float) -> Optional[tuple[int, int]]:
    """(output start, on-screen length) of a card, with cut-out parts dropped (the editor's graphicWindow)."""
    s, e = at, at + length
    before, start, kept = 0.0, None, 0.0
    for a, b in ranges:
        lo, hi = max(a, s), min(b, e)
        if hi > lo:
            if start is None:
                start = before + lo - a
            kept += hi - lo
        before += b - a
    if start is None:
        return None
    return round(start / speed), round(kept / speed)


def _priority(g: dict) -> int:
    fields = ' '.join(g['fields'].values())
    score = {'stat': 6, 'list': 5, 'checklist': 5, 'before_after': 4, 'lower_third': 4, 'quote': 2, 'title': 1}[g['template']]
    return score + (2 if _HAS_DIGIT.search(fields) else 0)


def new_id(taken: set[str]) -> str:
    while True:
        gid = f'g-{secrets.token_hex(5)}'
        if gid not in taken:
            taken.add(gid)
            return gid


def fit_to_clip(planned: Iterable[dict], segments: Sequence, ranges: Sequence[Sequence[float]], speed: float) -> list[dict]:
    """The planned cards that survive the finished cut, as editor graphics (source time, origin 'auto').

    Checks the words, moves a card out of the first second (or drops it), keeps
    it inside the clip, keeps at most three that never overlap (numbers, lists
    and names first) and returns them in time order.
    """
    ranges = [(float(a), float(b)) for a, b in ranges if b > a]
    if not ranges or not 1 <= speed <= 2:
        return []
    clip_end = ranges[-1][1]
    candidates = []
    for g in planned:
        if g.get('template') not in AUTO_TEMPLATES or not isinstance(g.get('fields'), dict):
            continue
        if not words_said(g, segments):
            continue
        at, length = float(g['at_ms']), float(g['duration_ms'])
        out = output_ms(ranges, speed, at)
        if out is None:
            # Said in a part the cut removed: start where the clip picks up again.
            later = [a for a, _ in ranges if a > at]
            if not later or later[0] - at > MAX_SHIFT_MS:
                continue
            length -= later[0] - at
            at = later[0]
            out = output_ms(ranges, speed, at)
        if out is not None and out < FIRST_MS:
            moved = source_ms(ranges, speed, FIRST_MS)
            if moved is None or moved - at > MAX_SHIFT_MS:
                continue
            # It ends when it would have, a little shorter (dropped below if too short).
            length -= moved - at
            at = moved
        length = min(length, clip_end - at)
        span = window(ranges, speed, at, length)
        if span is None or length < EDITOR_MIN_MS or span[1] < EDITOR_MIN_MS or span[0] < FIRST_MS:
            continue
        candidates.append({**g, 'at_ms': int(math.ceil(at)), 'duration_ms': int(max(EDITOR_MIN_MS, min(EDITOR_MAX_MS, math.floor(length))))})
    kept: list[dict] = []
    for g in sorted(candidates, key=lambda g: (-_priority(g), g['at_ms'])):
        if len(kept) >= MAX_PER_CLIP:
            break
        if any(g['at_ms'] < k['at_ms'] + k['duration_ms'] and k['at_ms'] < g['at_ms'] + g['duration_ms'] for k in kept):
            continue
        kept.append(g)
    taken: set[str] = set()
    return [{'id': new_id(taken), 'template': g['template'], 'at_ms': g['at_ms'], 'duration_ms': g['duration_ms'],
             'placement': g['placement'] if g.get('placement') in PLACEMENTS else 'top', 'fields': dict(g['fields']), 'origin': 'auto'}
            for g in sorted(kept, key=lambda g: g['at_ms'])]


def checked_saved(raw: Any, duration_ms: int) -> list[dict]:
    """Graphics read back from a run (job_output metrics) for the editor: well-formed ones only, at most 12."""
    if not isinstance(raw, list):
        return []
    out, ids = [], set()
    for g in raw[:12]:
        if not isinstance(g, dict) or g.get('template') not in AUTO_TEMPLATES:
            continue
        gid, at, length = g.get('id'), g.get('at_ms'), g.get('duration_ms')
        if not isinstance(gid, str) or not re.fullmatch(r'[a-z0-9-]{4,40}', gid) or gid in ids:
            continue
        if type(at) is not int or type(length) is not int or not 0 <= at <= duration_ms or not EDITOR_MIN_MS <= length <= EDITOR_MAX_MS:
            continue
        fields = g.get('fields')
        if not isinstance(fields, dict):
            continue
        clean = clean_fields(g['template'], fields)
        if not clean:
            continue
        ids.add(gid)
        out.append({'id': gid, 'template': g['template'], 'at_ms': at, 'duration_ms': length,
                    'placement': g.get('placement') if g.get('placement') in PLACEMENTS else 'top', 'fields': clean, 'origin': 'auto'})
    return sorted(out, key=lambda g: g['at_ms'])


# ---------------------------------------------------------------------------
# What main needs to draw the cards after the run.
# ---------------------------------------------------------------------------

GRAPHICS_PLAN = 'auto-graphics.json'
# A 9:16 title card sits in the top 17% of the frame (rendering_service: the handle goes under it there).
TITLE_CARD_SHARE = 0.17


def run_settings(request) -> dict:
    """The run's Create settings in the shape the editor conversion reads (automatic_editor.parse_settings)."""
    from clip_engine.services.automatic_editor import parse_settings
    mark = request.brand_mark if isinstance(getattr(request, 'brand_mark', None), dict) else None
    return parse_settings({
        'aspect_ratio': request.aspect_ratio, 'layout_style': request.layout_style, 'include_captions': request.include_captions,
        'caption_preset': request.caption_preset or 'pop', 'include_title': request.include_title, 'title_style': request.title_style,
        'headline_look': request.headline_look, 'video_speed': request.video_speed, 'pacing': request.pacing,
        'background': bool(request.background_video_path), 'broll': bool(request.broll_enabled), 'hook_preview': bool(request.hook_preview),
        'headline_voice': request.headline_voice,
        'brand_mark': {'handle': str(mark.get('handle') or '')[:80], 'logo': bool(mark.get('logo_path')),
                       'position': mark.get('position') or 'bottom-right'} if mark else None,
    })


def _clip_face(output: dict, clip_index: Any) -> Optional[list[float]]:
    """The speaker's face in the finished clip (x, y, w, h as fractions of its frame), so main can place
    cards where they cover it least; None when there's no clip file or no face is found."""
    clip = next((c for c in output.get('clips') or [] if isinstance(c, dict) and c.get('clip_index') == clip_index), None)
    url = str((clip or {}).get('s3_url') or '')
    path = url[len('file://'):] if url.startswith('file://') else url
    if not path or not os.path.isfile(path):
        return None
    try:
        from clip_engine.services.remix_service import find_face
        face = find_face(path)
    except Exception:  # noqa: BLE001 - placement is a nicety; never fail the plan over it
        return None
    if not face:
        return None
    return [round(min(1.0, max(0.0, float(v))), 4) for v in face]


def write_graphics_plan(run, output: dict, request, segments, metadata, video_duration: float) -> Optional[dict]:
    """Write auto-graphics.json: the run's clips that have cards, as editor candidates (cut, framing, hook,
    captions and graphics, exactly as the editor will open them), plus what the editor can't know (a hook
    preview's length before the clip, a title card at the top). Main renders and lays the cards from it."""
    from pathlib import Path
    from clip_engine.config import get_settings
    from clip_engine.services.automatic_editor import build_candidates, draws_headline
    from clip_engine.services.manual_editor import atomic_json
    run = Path(run)
    settings = run_settings(request)
    duration_ms = round(video_duration * 1000)
    w, h = int(metadata.width), int(metadata.height)
    candidates, _ = build_candidates(run, output, settings, segments, w, h, duration_ms, get_settings().audio_padding_ms)
    layouts = {e.get('clip_index'): e for e in (output.get('metrics') or {}).get('clip_layouts', []) if isinstance(e, dict)}
    # The title card (rendering_service._overlays): drawn unless a headline bar is, or "No hook text" on a 9:16 clip.
    no_hook = (settings['title_style'] == 'headline' and (settings['headline_look'] or {}).get('look') == 'none'
               and settings['aspect_ratio'] == '9:16' and not settings['background'])
    title_card = settings['include_title'] and not draws_headline(settings) and not no_hook
    kept, clips = [], {}
    for c in candidates:
        if not c.get('graphics'):
            continue
        entry = layouts.get(c['library_clip']) or {}
        if settings['background'] and c['captions']:
            # Gameplay split: the captions ride the seam in the middle.
            c['caption_y'] = 0.5
        kept.append(c)
        teaser = entry.get('teaser_ms')
        clips[c['id']] = {'offset_ms': teaser if type(teaser) is int and 0 <= teaser <= 60_000 else 0,
                          'top': TITLE_CARD_SHARE if title_card else 0}
        face = _clip_face(output, c['library_clip'])
        if face:
            clips[c['id']]['face'] = face
    if not kept:
        return None
    automatic = {'omitted': [], 'estimated_cuts': 0, **({'brand_mark': settings['brand_mark']} if settings['brand_mark'] else {})}
    plan = {'version': 1, 'clips': clips, 'project': {
        'version': 1, 'revision': 0, 'title': str(output.get('source_video_title') or '')[:1024], 'duration_ms': duration_ms,
        'width': w, 'height': h, 'aspect_ratio': settings['aspect_ratio'], 'candidates': kept, 'transcript': [],
        'headline_voice': settings['headline_voice'], 'automatic': automatic}}
    atomic_json(run / GRAPHICS_PLAN, plan)
    return plan
