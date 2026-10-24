"""Automatic motion graphics for Create's Automatic clips.

When the member turns "Motion graphics: Auto" on, the clip planner (the same
paid call that picks the clips) also suggests moments per clip for an animated
visual, by the pattern of what is said: a contrast ("not X, not Y, just Z") is a
crossed-out list, a core claim a statement, short parallel phrases sticky
notes, steps a list, a number a stat counter, named tools an icon row, the hook
a headline (when the member's hook text is off), a request to comment the
comment prompt (with the member's keyword). This module turns those suggestions
into the clip editor's graphics (src/shared/motion-graphics.ts: SOURCE time,
`origin: 'auto'`) and drops anything it can't stand behind:

- every number on a card must be said within 3 seconds of the card's time;
- most of the card's words must be said near it; for the newer templates every
  word, with accents inside their text and items said in order (nothing made up);
- each card starts on its first spoken word, list items come in as they're said;
- never two at once, never in the clip's first second (the hook headline aside),
  never in the comment keyword's last seconds, about one per 6.5 s.

With "Stage layouts" on, the big pattern cards are stage size and the clip gets
a stage scene around each (stage_scenes.suggest_scenes), rendered with the clip.

Main draws the kept cards with the editor's templates after the run and lays
them over the finished clips (graphics_overlay); the editor shows them in the
Graphics row when the clip is opened, editable like any other graphic.
"""
from __future__ import annotations

import json
import os
import math
import re
import secrets
from functools import lru_cache
from typing import Any, Iterable, Optional, Sequence

# Templates the planner may pick (never the logo, the arrow or the browser window: those need the member's
# picture or eye). headline_pill only when the member's own hook text is off; comment_cta only with a CTA keyword.
# Diagrams: white line art (on a solid backdrop in a Visual scene, or a blue panel over the video) whose labels light up as said.
DIAGRAMS = ('staircase', 'funnel', 'journey', 'growth', 'idea_hub', 'compare_marks')
# 'fx': an Effect (a HyperFrames unit; data/fx_catalog.json, from src/shared/fx-catalog.ts) with its own fields: the planner
# may place the AUTO_FX ones (graphics_director.py picks and checks them).
AUTO_TEMPLATES = ('stat', 'title', 'list', 'checklist', 'before_after', 'quote', 'lower_third',
                  'statement', 'sticky_notes', 'strike_list', 'headline_pill', 'icon_pop', 'comment_cta', 'orbit', 'feature_tile') + DIAGRAMS + ('fx',
                  # The type takeover: the single most important line in huge type, the speaker's head between its lines.
                  'takeover')
AUTO_FX = (
    'count-up', 'number-pop-in', 'conic-progress-ring', 'star-rating-fill', 'chart-story', 'decline-chart', 'trust-strip',
    'headline-slam', 'per-word-rise', 'kinetic-center-build', 'kinetic-type-swap', 'line-swap', 'caret-swap', 'marker-highlight', 'text-stagger',
    'vox-annotate', 'scramble-reveal', 'ticker-takeover', 'typed-prompt', 'typing-indicator', 'strikethrough-replace',
    'marker-checklist-card', 'constellation-hub', 'locked-nucleus-orbit', 'radial-surround', 'overwhelm-surround', 'state-chip-rail',
    'notification-stack', 'testimonial-proof-card', 'cta-lockup',
    # Charts and flows with every number and label said (CreatorClips' own units, remade from HyperFrames blocks).
    'data-chart', 'animated-bar-chart', 'mk-line-graph', 'flowchart', 'onboarding-stepper-flow',
    # Shares, steps and identity moments (CreatorClips' own units in HyperFrames' style).
    'gauge-dial', 'waffle-chart', 'flanking-words', 'magazine-cover',
)
# Placed automatically only on a YouTube video's branded cold open (longform.py): a calm title lockup of words said.
LONGFORM_FX = ('titlecard-lockup',)
# Effects on the member's own screenshots and photos: never asked of the model (it can't see the pictures); the
# director places them in code where a screen, a proof or a before and after is said, only when the member added
# screenshots for the video (graphics_director.place_media).
MEDIA_FX = ('browser-device-stage', 'device-frame-stage', 'before-after-wipe', 'comparison-split', 'split-tilt-cards',
            'paper-collage-reveal', 'torn-paper-rip', 'light-sweep-pass')
# A picture field: a run image name (or, before an edited reel is made, one of its image ids).
_PICTURE = re.compile(r'^[A-Za-z0-9._-]{1,80}$')
TEMPLATE_FIELDS = {
    'stat': ('value', 'label'), 'title': ('text',), 'list': ('title', 'items', 'icons'), 'checklist': ('title', 'items', 'icons'),
    'before_after': ('before', 'after'), 'quote': ('text', 'author'), 'lower_third': ('name', 'role'),
    'statement': ('text', 'accent', 'subline'), 'sticky_notes': ('items',), 'strike_list': ('items', 'final', 'accent'),
    'headline_pill': ('text', 'phrase'), 'icon_pop': ('items', 'icons'), 'comment_cta': ('keyword', 'lead'),
    'orbit': ('text', 'items', 'icons'), 'feature_tile': ('items', 'icons'),
    'staircase': ('title', 'items', 'icons'), 'funnel': ('title', 'items'), 'journey': ('title', 'items'),
    'idea_hub': ('text', 'items', 'icon'), 'compare_marks': ('items', 'notes', 'wrong'), 'growth': ('title', 'items', 'style'),
    'fx': ('effect',), 'takeover': ('text', 'accent'),
}
# Templates a saved run may carry (the editor's other templates are never automatic).
SAVED_TEMPLATES = AUTO_TEMPLATES + ('browser_frame', 'big_words', 'chapter', 'link_cta')
SAVED_FIELDS = {**TEMPLATE_FIELDS, 'browser_frame': ('domain', 'title', 'accent', 'subline'), 'big_words': ('text', 'style', 'vertical', 'motion'),
                'chapter': ('label', 'title', 'style'), 'growth': ('title', 'items', 'style'),
                # The spoken call to action (spoken_cta.py): added after the planner's cards, never planned.
                'link_cta': ('text', 'where', 'kind', 'lead')}
ALL_FIELDS = ('value', 'label', 'text', 'title', 'items', 'before', 'after', 'author', 'name', 'role',
              'accent', 'subline', 'final', 'phrase', 'icons', 'keyword', 'lead', 'notes', 'wrong', 'icon')
# The newer templates are held to every word (the older ones to most words, as before).
STRICT_TEMPLATES = ('statement', 'sticky_notes', 'strike_list', 'headline_pill', 'icon_pop', 'comment_cta', 'orbit', 'feature_tile', 'big_words',
                    'takeover') + DIAGRAMS
# Drawn on the stage (top ~56% of a 9:16 frame) when Stage layouts are on; the rest stay cards.
STAGE_TEMPLATES = ('statement', 'strike_list', 'sticky_notes', 'browser_frame', 'list', 'checklist', 'orbit', 'feature_tile')
# Most items each template shows (motion-graphics.ts GRAPHIC_ITEM_LIMITS).
ITEM_LIMITS = {'sticky_notes': 3, 'strike_list': 4, 'icon_pop': 4, 'orbit': 6, 'feature_tile': 3,
               'staircase': 6, 'funnel': 5, 'journey': 5, 'growth': 6, 'idea_hub': 6, 'compare_marks': 2}
MIN_ITEMS = {'sticky_notes': 2, 'strike_list': 1, 'icon_pop': 2, 'list': 2, 'checklist': 2, 'orbit': 3, 'feature_tile': 1,
             'staircase': 3, 'funnel': 3, 'journey': 3, 'growth': 3, 'idea_hub': 3, 'compare_marks': 2}
# Templates whose items are revealed as they are said (item_ms).
ITEM_TEMPLATES = ('list', 'checklist', 'sticky_notes', 'strike_list', 'icon_pop', 'orbit', 'feature_tile') + DIAGRAMS
# Text cards whose words build one by one: each word comes in as it is said (word_ms; motion-graphics.ts WORD_TIMED_TEMPLATES).
WORD_TIMED = ('big_words', 'title', 'statement', 'headline_pill', 'takeover')
# A word-timed card starts at most this early and holds this long after its last word ends (WORD_LEAD_MS, WORD_HOLD_MS).
WORD_LEAD_MS = 100
WORD_HOLD_MS = 700
# A type takeover is one short line said (words), on screen 1.5-3 s plus its hold.
TAKEOVER_WORDS = (3, 9)
TAKEOVER_MAX_MS = 3600
# Generic icons the Icon row can draw (mirror of GRAPHIC_ICONS in src/shared/motion-graphics.ts; never brand logos).
GRAPHIC_ICONS = (
    'globe', 'mail', 'message', 'video', 'camera', 'mic', 'phone', 'laptop', 'code', 'terminal', 'database', 'file', 'search', 'link',
    'chart', 'trending', 'dollar', 'users', 'user', 'calendar', 'clock', 'check', 'zap', 'rocket', 'sparkles', 'star', 'heart',
    'cart', 'card', 'lock', 'settings', 'bot', 'brain', 'book', 'target', 'idea', 'play', 'image', 'dashboard', 'megaphone', 'gift', 'trophy',
)
PLACEMENTS = ('top', 'middle', 'bottom')
# Fields that hold choices, icons or times rather than words said (never checked against the transcript).
NON_WORD_FIELDS = ('icons', 'item_ms', 'word_ms', 'cue_ms', 'keyword', 'icon', 'wrong', 'style', 'variant', 'panel', 'labels', 'dot',
                   'effect', 'backing', 'theme')
# Each template's looks (mirror of GRAPHIC_VARIANTS in src/shared/motion-graphics.ts). The first is the classic look, drawn
# when a graphic has no `variant` field (graphics saved before looks existed); ROTATION is the order automatic graphics
# take them in, so repeats of a template never look the same twice in a row.
VARIANTS = {
    'statement': ('card', 'glass', 'bold'),
    'title': ('card', 'pill', 'shadow'),
    'quote': ('card', 'dark', 'accent'),
    'sticky_notes': ('notes', 'polaroid', 'index'),
    'list': ('card', 'chips', 'pills'),
    'checklist': ('card', 'dark', 'rows'),
    'stat': ('card', 'gradient', 'badge'),
}
ROTATION = {
    'statement': ('glass', 'bold', 'card'), 'title': ('pill', 'shadow', 'card'), 'quote': ('dark', 'accent', 'card'),
    'sticky_notes': ('polaroid', 'index', 'notes'), 'list': ('chips', 'pills', 'card'), 'checklist': ('rows', 'dark', 'card'),
    'stat': ('gradient', 'badge', 'card'),
}
# Looks that read on a busy screen (no big white slab over the page), for a card over a filmed screen; taken in turn
# so repeats still differ.
SCREEN_VARIANTS = {'statement': ('glass', 'bold'), 'title': ('pill', 'shadow'), 'quote': ('dark', 'accent'), 'list': ('pills', 'chips'),
                   'checklist': ('dark', 'rows'), 'stat': ('gradient', 'badge'), 'sticky_notes': ('polaroid', 'index')}
DEFAULT_MS = {'stat': 3500, 'title': 2500, 'list': 5000, 'lower_third': 4000, 'before_after': 4000, 'checklist': 5000, 'quote': 5000,
              'statement': 3500, 'sticky_notes': 4000, 'strike_list': 5000, 'headline_pill': 3500, 'icon_pop': 3500, 'comment_cta': 3500,
              'browser_frame': 5000, 'orbit': 4500, 'feature_tile': 3500, 'big_words': 2500,
              'staircase': 9000, 'funnel': 8000, 'journey': 9000, 'growth': 9000, 'idea_hub': 8000, 'compare_marks': 7000, 'chapter': 15000, 'fx': 3500, 'takeover': 2500}
# Cards per clip: about one per 6.5 s of the finished clip, at most five a minute (and never more than 12).
SECONDS_PER_CARD = 6.5
CARDS_PER_MINUTE = 5
MAX_PER_CLIP = 12
# The planner may suggest a few more than are kept (the weakest go).
MAX_SUGGESTED = 10
MIN_MS, MAX_MS = 1500, 7000
# The editor's limits (motion-graphics.ts): most graphics 0.8-8 s, a diagram up to 16 s, a chapter header up to 3 minutes.
EDITOR_MIN_MS, EDITOR_MAX_MS = 800, 8000
DIAGRAM_MAX_MS, CHAPTER_MAX_MS = 16000, 180000
# A diagram stays on while it is talked through: from just before its first item to a little after its last (6-15 s).
DIAGRAM_MIN_MS, DIAGRAM_AUTO_MAX_MS = 6000, 15000
DIAGRAM_LEAD_MS, DIAGRAM_HOLD_MS = 700, 2600
# A diagram's items are said at most this far apart (one after the next).
DIAGRAM_ITEM_GAP_MS = 8000
# Without chapter headers, two diagrams are at least this far apart (one per section).
DIAGRAM_GAP_MS = 12000


def editor_max_ms(template: str) -> int:
    """The longest the editor lets a graphic of this kind last (motion-graphics.ts graphicMaxMs)."""
    return CHAPTER_MAX_MS if template == 'chapter' else DIAGRAM_MAX_MS if template in DIAGRAMS else EDITOR_MAX_MS
MAX_FIELD_CHARS = 160
MAX_ITEMS = 5
MAX_ITEM_CHARS = 60
# Nothing in the clip's first second (the hook lands first), except the hook headline itself.
FIRST_MS = 1000
# A hook headline starts in the clip's first 1.5 s and its words are said in the first 6 s.
HOOK_START_MS = 1500
HOOK_WORDS_MS = 6000
# With a comment keyword, the clip's last 4 s (the second half of a very short clip) show "Comment KEYWORD":
# no card then (rendering_service._brand_overlays).
CTA_TAIL_MS = 4000
# A number on a card must be said this close to the card's time; its words this close to the card.
NUMBER_WINDOW_MS = 3000
WORD_WINDOW_MS = 6000
MIN_WORD_SHARE = 0.75
# Words that flip what a line means: on a card they must always be said (the 75% share can't carry them).
MEANING_WORDS = frozenset(('not', 'no', 'never', 'none', 'nothing', 'nobody', 'without', 'cannot', 'neither', 'nor', 'less', 'more',
                           'least', 'most', 'only', 'stop', 'avoid', 'lose', 'lost'))
# A strict card's words (and its items, in order) are said within this much of it.
STRICT_WINDOW_MS = 2000
# A card starts on its first spoken word when that word is said this close to the suggested time.
SNAP_MS = 2500
# Comment prompts need the speaker to ask for the comment this close to the card.
COMMENT_WORDS = ('comment', 'type', 'drop', 'write', 'reply', 'dm', 'message')
# Between two cards; a card cut short by a stronger one keeps at least this much.
GAP_MS = 150
MIN_TRIMMED_MS = 1200
# With free time kept between graphics, a card cut short to make room keeps at least this much (long enough to read).
PAD_TRIMMED_MS = 2200
# A card is moved later by at most this much to clear the first second, or dropped.
MAX_SHIFT_MS = 2500

_CONTROL = re.compile(r'[\x00-\x1f\x7f]')
_ITEM_NUMBER = re.compile(r'^\s*(?:\d{1,2}[.):]|[-•*])\s+')
_WORD = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")
_HAS_DIGIT = re.compile(r'\d')
_KEYWORD = re.compile(r'^[A-Za-z0-9][A-Za-z0-9 _-]{0,23}$')

FX_CATALOG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'fx_catalog.json')


@lru_cache(maxsize=1)
def fx_catalog() -> dict[str, dict]:
    """The Effects catalog by effect id (data/fx_catalog.json): fields, jobs, use_when, avoid_when, hold, sound."""
    try:
        with open(FX_CATALOG_PATH, encoding='utf-8') as f:
            data = json.load(f)
        return {e['id']: e for e in data.get('effects', []) if isinstance(e, dict) and isinstance(e.get('id'), str)}
    except (OSError, ValueError):
        return {}


GRAPHIC_SCHEMA: dict[str, Any] = {
    'type': 'object',
    'properties': {
        'template': {'type': 'string', 'enum': list(AUTO_TEMPLATES)},
        'time': {'type': 'number', 'description': 'When the first word on the card is said, seconds from the start of the video.'},
        'seconds': {'type': 'number', 'description': 'How long the card stays on screen (2-6), long enough for its words to be said.'},
        'placement': {'type': 'string', 'enum': list(PLACEMENTS)},
        'value': {'type': 'string', 'description': 'stat: the number as said, e.g. "15 billion", "$1,200", "25%".'},
        'label': {'type': 'string', 'description': 'stat: a few words said about the number.'},
        'text': {'type': 'string', 'description': 'title, quote, statement or headline_pill: the words as said; orbit: the one thing '
                                                  'they all connect to (1-2 words as said), or "".'},
        'title': {'type': 'string', 'description': 'list, checklist or a diagram: a short heading said in the clip, or "".'},
        'items': {'type': 'array', 'items': {'type': 'string'},
                  'description': 'list/checklist: 2-5 points; sticky_notes: 2-3 short phrases; strike_list: 1-4 things rejected; '
                                 'icon_pop: 2-4 tools, apps or channels named; orbit: 3-6 tools, features or channels said that all '
                                 'connect to one thing; feature_tile: 1-3 features or capabilities named (1-3 words each); staircase, '
                                 'funnel, journey, growth, idea_hub: 3-6 parallel items (1-4 words each); compare_marks: exactly 2 (the '
                                 'wrong way, the right way). Each as said, in the order said.'},
        'before': {'type': 'string', 'description': 'before_after: the first side, as said.'},
        'after': {'type': 'string', 'description': 'before_after: the second side, as said.'},
        'author': {'type': 'string', 'description': 'quote: who said it, only if their name is said; else "".'},
        'name': {'type': 'string', 'description': 'lower_third: the name of the person, tool or company as said.'},
        'role': {'type': 'string', 'description': 'lower_third: what they are, as said; else "".'},
        'accent': {'type': 'string', 'description': 'statement: the key word(s) of text, drawn in italics; strike_list: the key word(s) of final. Must appear in that text.'},
        'subline': {'type': 'string', 'description': 'statement: a short second line as said, or "".'},
        'final': {'type': 'string', 'description': 'strike_list: the better choice, as said (e.g. "just a typed client").'},
        'phrase': {'type': 'string', 'description': 'headline_pill: the key words of the hook, drawn on a color box.'},
        'icons': {'type': 'array', 'items': {'type': 'string', 'enum': list(GRAPHIC_ICONS)},
                  'description': 'icon_pop, orbit, feature_tile, staircase (and optionally list, checklist): one generic icon per item, in '
                                 'order (never a brand logo).'},
        'keyword': {'type': 'string', 'description': 'comment_cta: the comment keyword, exactly as given.'},
        'notes': {'type': 'array', 'items': {'type': 'string'}, 'description': 'compare_marks: a short line under each card, as said, or [].'},
        'wrong': {'type': 'string', 'enum': ['first', 'second', ''], 'description': 'compare_marks: which card is the wrong way (gets the red cross).'},
        'icon': {'type': 'string', 'enum': ['', *GRAPHIC_ICONS], 'description': 'idea_hub: the center icon (default "idea", a light bulb).'},
        'lead': {'type': 'string', 'description': 'comment_cta: the word over the keyword ("Comment"), or "".'},
        'effect': {'type': 'string', 'enum': ['', *AUTO_FX], 'description': 'fx: the effect (see EFFECTS); else "".'},
        'fx_fields': {'type': 'array', 'description': 'fx: the effect\'s fields as said, e.g. [{"key": "value", "value": "4,215"}, '
                                                      '{"key": "prefix", "value": "$"}]; else [].',
                      'items': {'type': 'object', 'additionalProperties': False, 'required': ['key', 'value'],
                                'properties': {'key': {'type': 'string'}, 'value': {'type': 'string'}}}},
    },
    'required': ['template', 'time', 'seconds', 'placement', *ALL_FIELDS, 'effect', 'fx_fields'],
    'additionalProperties': False,
}

_RULE_HEAD = (
    '\nMOTION GRAPHICS: For every clip, "graphics" lists moments where a short animated visual on screen helps the viewer. '
    'Not every second needs one, but a good clip has a visual about every 6-8 seconds while the speaker explains something '
    '(at most {limit} per minute). Pick the pattern that fits what is said:\n'
    '- a contrast like "not X, not Y, just Z" -> "strike_list": items X, Y (the rejected things), final Z, accent the key word of Z;\n'
    '- a core claim (rarely: see PICK THE VISUAL) -> "statement": text as said, accent = its key word(s) (inside text), subline only if said;\n'
    '- 2-3 short parallel phrases said one after another -> "sticky_notes": items, each 1-4 words;\n'
    '- steps or a list -> "list" (or "checklist" for things to do), items in order;\n'
    '- a number or result said -> "stat": value and label;\n'
    '- tools, apps, sites or channels named -> "icon_pop": items = the names as said, icons = one generic icon each from the list '
    '(e.g. mail for email, video for YouTube, camera for Instagram, message for a chat app, chart for analytics); never a brand logo;\n'
    '- several tools or features (3-6) said as all part of one thing ("ads, landing pages, emails, all in the same account") -> '
    '"orbit": items = each as said, icons = one generic icon each, text = the one thing they connect to if said;\n'
    '- one to three features or capabilities named ("competitor research", "auto reports") -> "feature_tile": items as said, icons;\n'
    '- when the speaker lists 3-6 parallel items in one section, a DIAGRAM (on screen 6-15 s while they talk it through, at most one '
    'per section): steps that build on each other -> "staircase" (items bottom to top, icons); a process that narrows or filters -> '
    '"funnel"; milestones from zero to a goal -> "journey"; things that scale up or grow -> "growth"; qualities of one thing -> '
    '"idea_hub" (text = that thing if said); "not X, but Y" -> "compare_marks" (items X then Y, wrong "first"). "time" is when the '
    'first item is said; each item 1-4 words exactly as said;\n'
    '- a person or company introduced -> "lower_third"; a before/after comparison -> "before_after"; a line worth reading -> "quote"; '
    'a few punchy words -> "title".\n'
)
_RULE_TAIL = (
    'Use ONLY words said in the transcript at that moment, in the order said. Copy every number exactly as said (write '
    '"fifteen billion" as "15 billion"); never add a number, name, claim or word that was not said. Keep cards short: a stat '
    'label under 6 words, items under 5 words each, a title, quote or statement under 12 words. "time" is when the FIRST word on '
    'the card is said (seconds from the start of the video), at least 1 second after the clip starts; "seconds" is how long it '
    'stays (2-6), long enough for all its words to be said. Visuals in a clip never overlap. Return [] when nothing fits. Set every '
    'field the template does not use to "" (items and icons to []).'
)


def clean_keyword(value: Any) -> str:
    text = ' '.join(str(value or '').split())
    return text if _KEYWORD.match(text) else ''


def motion_graphics_rule(options: Optional[dict] = None) -> str:
    """The planner's motion graphics rule for this run (`options`: headline_off, cta_keyword)."""
    options = options or {}
    rule = _RULE_HEAD.format(limit=CARDS_PER_MINUTE)
    if options.get('headline_off'):
        rule += ("- the clip's hook (its first seconds): \"headline_pill\" starting as the clip starts: text = the first words as said, "
                 "phrase = the key words that follow, as said (only this one may start in the first second);\n")
    keyword = clean_keyword(options.get('cta_keyword'))
    if keyword:
        rule += (f'- the speaker asks viewers to comment: "comment_cta" with keyword exactly "{keyword}" and lead "Comment", at the moment '
                 'they ask (never in the last 4 seconds: the keyword shows there already);\n')
    from clip_engine.services.graphics_director import director_rule, hints_block
    register = options.get('register') if options.get('register') in ('teaching', 'story', 'minimal') else None
    hints = options.get('hints') if isinstance(options.get('hints'), str) else ''
    return rule + director_rule(register, bool(keyword)) + hints_block(hints[:6000]) + _RULE_TAIL


MOTION_GRAPHICS_RULE = motion_graphics_rule()


def graphics_schema() -> dict[str, Any]:
    return {'type': 'array', 'items': GRAPHIC_SCHEMA, 'description': '0-3 motion graphic moments (see MOTION GRAPHICS).'}


def _text(value: Any, limit: int = MAX_FIELD_CHARS) -> str:
    if not isinstance(value, str):
        return ''
    return ' '.join(_CONTROL.sub(' ', value).split())[:limit].strip()


def _number(value: Any) -> Optional[float]:
    return float(value) if type(value) in (int, float) and math.isfinite(value) else None


def _lines(value: Any, limit: int) -> list[str]:
    if isinstance(value, str):
        value = value.split('\n')
    if not isinstance(value, list):
        return []
    lines = [_text(_ITEM_NUMBER.sub('', item), MAX_ITEM_CHARS) for item in value if isinstance(item, str)]
    return [line for line in lines if line][:limit]


def fx_clean_fields(raw: dict) -> dict[str, str]:
    """An effect's fields: a known effect, then its own fields by kind (text, number, list one per line, choice);
    nothing else. Empty when the effect is unknown."""
    effect = fx_catalog().get(raw.get('effect')) if isinstance(raw.get('effect'), str) else None
    if not effect:
        return {}
    fields = {'effect': effect['id']}
    for f in effect['fields']:
        value = raw.get(f['key'])
        if f['kind'] == 'image':
            if isinstance(value, str) and _PICTURE.match(value):
                fields[f['key']] = value
            continue
        if f['kind'] == 'region':
            box = fx_region(value)
            if box:
                fields[f['key']] = ', '.join(f'{round(n, 3):g}' for n in box)
            continue
        if f['kind'] == 'list':
            lines = _lines(value, 8)
            if lines:
                fields[f['key']] = '\n'.join(_cut(line, f.get('max', MAX_ITEM_CHARS)) for line in lines)
        elif f['kind'] == 'choice':
            if value in f.get('options', ()):
                fields[f['key']] = value
        elif f['kind'] == 'number':
            text = _text(str(value) if type(value) in (int, float) else value, 24)
            if _HAS_DIGIT.search(text):
                fields[f['key']] = text
        else:
            text = _cut(_text(value), f.get('max', MAX_FIELD_CHARS))
            if text:
                fields[f['key']] = text
    if raw.get('backing') == 'none':
        fields['backing'] = 'none'
    # The video's one look (graphics_director.with_look): 'light' or 'dark' theme tokens.
    if raw.get('theme') in ('light', 'dark'):
        fields['theme'] = raw['theme']
    return fields


def fx_region(value: Any) -> Optional[tuple[float, float, float, float]]:
    """A region on a picture (x, y, w, h as shares of it, as text or a list), or None when it isn't one inside it
    (fx-catalog.ts fxRegion)."""
    parts = value if isinstance(value, (list, tuple)) else re.split(r'[\s,]+', str(value or '').strip())
    try:
        nums = [float(p) for p in parts if p != '']
    except (TypeError, ValueError):
        return None
    if len(nums) != 4 or any(not math.isfinite(n) for n in nums):
        return None
    x, y, w, h = nums
    if x < 0 or y < 0 or w < 0.01 or h < 0.01 or x + w > 1.001 or y + h > 1.001:
        return None
    return x, y, w, h


def _cut(text: str, limit: int) -> str:
    """Text at most `limit` characters, cut at a word (never half a word on screen)."""
    if len(text) <= limit:
        return text
    cut = text[:limit + 1].rsplit(' ', 1)[0] if ' ' in text[:limit + 1] else ''
    return cut.rstrip(' ,;:-')


def fx_too_long(raw: dict) -> bool:
    """A planned effect with a text or item longer than the effect holds (cut, it would show words not said as said)."""
    effect = fx_catalog().get(raw.get('effect')) if isinstance(raw.get('effect'), str) else None
    for f in (effect or {}).get('fields', []):
        value, limit = raw.get(f['key']), f.get('max')
        if not limit or f['kind'] not in ('text', 'list'):
            continue
        parts = value if isinstance(value, list) else str(value or '').split('\n') if f['kind'] == 'list' else [str(value or '')]
        if any(len(' '.join(str(p).split())) > limit for p in parts):
            return True
    return False


def fx_has_content(fields: dict[str, str]) -> bool:
    """A known effect with its required fields filled (fx-catalog.ts fxHasContent)."""
    effect = fx_catalog().get(fields.get('effect'))
    return bool(effect) and all(not f['required'] or bool(fields.get(f['key'])) for f in effect['fields']) \
        and (not effect.get('either') or any(fields.get(k) for k in effect['either']))


def clean_fields(template: str, raw: dict, fields_of: Optional[dict] = None) -> dict[str, str]:
    """The template's own fields, trimmed to the editor's limits; list items and icons newline-separated."""
    if template == 'fx':
        return fx_clean_fields(raw)
    fields: dict[str, str] = {}
    for key in (fields_of or TEMPLATE_FIELDS)[template]:
        if key == 'items':
            lines = _lines(raw.get('items'), ITEM_LIMITS.get(template, MAX_ITEMS))
            if lines:
                fields['items'] = '\n'.join(lines)
        elif key == 'icons':
            names = raw.get('icons')
            names = names.split('\n') if isinstance(names, str) else names if isinstance(names, list) else []
            # One per item; an unknown name (a brand, a typo) draws the item's letter instead.
            count = len(fields['items'].split('\n')) if fields.get('items') else ITEM_LIMITS['icon_pop']
            icons = [str(n).strip().lower() if str(n).strip().lower() in GRAPHIC_ICONS else '' for n in names[:count]]
            if any(icons):
                fields['icons'] = '\n'.join(icons)
        elif key == 'keyword':
            keyword = clean_keyword(raw.get('keyword'))
            if keyword:
                fields['keyword'] = keyword
        elif key == 'notes':
            notes = raw.get('notes')
            notes = notes.split('\n') if isinstance(notes, str) else notes if isinstance(notes, list) else []
            notes = [_text(n, MAX_ITEM_CHARS) if isinstance(n, str) else '' for n in notes[:2]]
            if any(notes):
                fields['notes'] = '\n'.join(notes).rstrip('\n')
        elif key == 'wrong':
            if raw.get('wrong') in ('first', 'second'):
                fields['wrong'] = raw['wrong']
        elif key == 'icon':
            icon = str(raw.get('icon') or '').strip().lower()
            if icon in GRAPHIC_ICONS:
                fields['icon'] = icon
        elif key == 'style':
            style = str(raw.get('style') or '')
            if style in ({'chapter': ('serif_caps', 'sans', 'pill'), 'growth': ('plants', 'bars')}.get(template) or
                         ('serif', 'sans', 'mixed')):
                fields['style'] = style
        else:
            text = _text(raw.get(key))
            if text:
                fields[key] = text
    if raw.get('variant') in VARIANTS.get(template, ()):
        fields['variant'] = raw['variant']
    # The video's one look on the white-card templates and words with no card (graphics_director.with_look, on_light_stage).
    if raw.get('theme') in ('light', 'dark') and template in ('lower_third', 'before_after', 'strike_list', 'headline_pill', 'comment_cta', 'big_words'):
        fields['theme'] = raw['theme']
    return fields


def has_content(template: str, fields: dict[str, str]) -> bool:
    """Enough words to draw a useful card (stricter than the editor: a stat needs its number, a list two points)."""
    items = fields.get('items', '').split('\n') if fields.get('items') else []
    if template == 'fx':
        return fx_has_content(fields)
    if template == 'stat':
        return bool(_HAS_DIGIT.search(fields.get('value', '')))
    if template in ('title', 'quote', 'statement', 'big_words'):
        return bool(fields.get('text'))
    if template == 'takeover':
        return TAKEOVER_WORDS[0] <= len(str(fields.get('text') or '').split()) <= TAKEOVER_WORDS[1]
    if template in MIN_ITEMS and template != 'strike_list':
        return len(items) >= MIN_ITEMS[template]
    if template == 'strike_list':
        return len(items) >= 1 and bool(fields.get('final'))
    if template == 'lower_third':
        return bool(fields.get('name'))
    if template == 'before_after':
        return bool(fields.get('before') and fields.get('after'))
    if template == 'headline_pill':
        return bool(fields.get('text') and fields.get('phrase'))
    if template == 'comment_cta':
        return bool(fields.get('keyword'))
    return False


# Templates a caller may allow on top of AUTO_TEMPLATES (Edit my recording: big words behind the speaker).
EXTRA_TEMPLATES = ('big_words',)
# Most graphics any one video keeps (the clip editor's MAX_GRAPHICS_PER_CLIP). A YouTube video keeps more: about
# GRAPHICS_PER_10_MIN per ten minutes, at most MAX_GRAPHICS_LONG (graphics_cap; src/shared/motion-graphics.ts graphicsCap).
MAX_GRAPHICS = 60
GRAPHICS_PER_10_MIN = 60
MAX_GRAPHICS_LONG = 180


def graphics_cap(total_ms: float, long_form: bool = False) -> int:
    """How many graphics a video may keep: a reel MAX_GRAPHICS; a YouTube video GRAPHICS_PER_10_MIN per ten minutes
    (never fewer than a reel), at most MAX_GRAPHICS_LONG."""
    if not long_form:
        return MAX_GRAPHICS
    import math
    return max(MAX_GRAPHICS, min(MAX_GRAPHICS_LONG, math.ceil(max(0.0, float(total_ms)) / 600_000 * GRAPHICS_PER_10_MIN)))


def _options(options: Optional[dict]) -> dict:
    options = options if isinstance(options, dict) else {}
    extra = tuple(t for t in options.get('templates') or () if t in EXTRA_TEMPLATES) if isinstance(options.get('templates'), (list, tuple)) else ()
    limit = options.get('max_cards')
    return {'headline_off': bool(options.get('headline_off')), 'cta_keyword': clean_keyword(options.get('cta_keyword')),
            'stage': bool(options.get('stage')), 'chapters': bool(options.get('chapters')), 'templates': AUTO_TEMPLATES + extra,
            'max_cards': int(limit) if type(limit) is int and 0 < limit <= MAX_GRAPHICS_LONG else None,
            # Variety rules (caps, spacing, conversions, looks): on unless a caller turns them off.
            'variety': options.get('variety') is not False,
            # Headline pills as cards anywhere in the video (Edit my recording), not only as the clip's hook.
            'pill_cards': bool(options.get('pill_cards')),
            # A YouTube video's extra automatic effects (LONGFORM_FX).
            'extra_fx': tuple(e for e in options.get('extra_fx') or () if e in LONGFORM_FX) if isinstance(options.get('extra_fx'), (list, tuple)) else (),
            # Long quiet stretches get a visual from their cues (graphics_director.fill_quiet; Edit my recording).
            'fill_quiet': bool(options.get('fill_quiet')),
            # Free time kept between two graphics (ms), so they don't run back to back.
            'gap_ms': int(options['gap_ms']) if type(options.get('gap_ms')) is int and 0 <= options['gap_ms'] <= 10000 else 0,
            # How dense (teaching | story | minimal; None: detected from the words) and the video's one look.
            'register': options.get('register') if options.get('register') in ('teaching', 'story', 'minimal') else None,
            'tone': options.get('tone') if options.get('tone') in ('light', 'dark') else None,
            # The member's logos (My logos), already in the run's images: popped in where they are named.
            'logos': options.get('logos') if isinstance(options.get('logos'), list) else []}


def parse_planned(raw: Any, start_ms: int, end_ms: int, options: Optional[dict] = None) -> list[dict]:
    """The planner's suggestions for one clip, checked for shape only (source ms; words are checked later).

    `options`: headline_off (a hook headline may be suggested), cta_keyword (comment prompts use exactly it)."""
    if not isinstance(raw, list):
        return []
    opts = _options(options)
    out = []
    most = max(MAX_SUGGESTED, opts['max_cards'] or 0)
    for item in raw[:most * 2]:
        if not isinstance(item, dict) or item.get('template') not in opts['templates']:
            continue
        template = item['template']
        if template == 'headline_pill' and not (opts['headline_off'] or opts['pill_cards']):
            continue
        if template == 'comment_cta':
            if not opts['cta_keyword'] or clean_keyword(item.get('keyword')).lower() != opts['cta_keyword'].lower():
                continue
            item = {**item, 'keyword': opts['cta_keyword']}
        if template == 'fx':
            from clip_engine.services.graphics_director import fx_raw_fields
            if item.get('effect') not in AUTO_FX and item.get('effect') not in opts['extra_fx']:
                continue
            item = {**item, **fx_raw_fields(item)}
            if fx_too_long(item):
                continue
        time, seconds = _number(item.get('time')), _number(item.get('seconds'))
        if time is None:
            continue
        at_ms = round(time * 1000)
        if not start_ms <= at_ms < end_ms:
            continue
        duration = round(seconds * 1000) if seconds is not None else DEFAULT_MS[template]
        fields = clean_fields(template, item, SAVED_FIELDS)
        if template == 'fx' and fields:
            # An effect holds about its catalog time (short punches 1-3 s); its words then place it (graphics_director.fx_timed).
            from clip_engine.services.graphics_director import fx_hold_ms
            hold = fx_hold_ms(fields['effect'])
            duration = max(hold, min(duration, hold + 2500))
        if not has_content(template, fields):
            continue
        placement = item.get('placement') if item.get('placement') in PLACEMENTS else (
            'bottom' if template == 'lower_third' else 'middle' if template in ('title', 'comment_cta') else 'top')
        top = DIAGRAM_AUTO_MAX_MS if template in DIAGRAMS else 3000 if template == 'takeover' else MAX_MS
        out.append({'template': template, 'at_ms': at_ms, 'duration_ms': max(MIN_MS, min(top, duration)),
                    'placement': placement, 'fields': fields})
        if len(out) >= most:
            break
    return out


# ---------------------------------------------------------------------------
# Words said near a card.
# ---------------------------------------------------------------------------

def _timed_words(segments: Sequence, lo: float, hi: float) -> list[tuple[str, int]]:
    """(token, start ms) of each word said between lo and hi (source ms), in order. Segments without word
    timings spread their words evenly."""
    out: list[tuple[str, int]] = []
    for seg in segments:
        if seg.end_time_ms < lo or seg.start_time_ms > hi:
            continue
        words = getattr(seg, 'words', None) or []
        if words:
            for w in words:
                if w.end_time_ms >= lo and w.start_time_ms <= hi:
                    out.extend((t, int(w.start_time_ms)) for t in _tokens(w.word))
        else:
            tokens = _tokens(seg.text)
            step = (seg.end_time_ms - seg.start_time_ms) / max(1, len(tokens))
            out.extend((t, int(seg.start_time_ms + i * step)) for i, t in enumerate(tokens) if lo <= seg.start_time_ms + i * step <= hi)
    return out


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
    # Plurals and possessives as said ("tool" / "tools", "brand's"). Only a possessive 's is dropped: "can't" or
    # "won't" is never "can" or "won" (that would turn what was said around).
    if "'" in token and not token.endswith("'s"):
        return False
    base = token[:-2] if token.endswith("'s") else token
    return base in heard or base.rstrip('s') in heard or f'{base}s' in heard


def _digits_said(graphic: dict, heard: set[str]) -> bool:
    """A token with a digit that isn't read as a number ("3rd", "v2", "Web3") is said exactly as on the card."""
    for key, text in graphic['fields'].items():
        if key in NON_WORD_FIELDS:
            continue
        for token in _tokens(text):
            if _HAS_DIGIT.search(token) and not _numbers(token) and token not in heard:
                return False
    return True


def _same(token: str, heard: str) -> bool:
    return _said(token, {heard})


def _words(text: str) -> list[str]:
    """A card's words as checked against the transcript (numbers are checked on their own)."""
    return [t for t in _tokens(text) if not _HAS_DIGIT.search(t)]


def accent_inside(text: str, accent: str) -> bool:
    """The accent's words appear in the text, together and in order (any case and punctuation)."""
    want, words = _tokens(accent), _tokens(text)
    if not want:
        return True
    return any(words[i:i + len(want)] == want for i in range(len(words) - len(want) + 1))


def _card_lines(graphic: dict) -> list[str]:
    """The card's items in order, then its final line (strike_list)."""
    f = graphic['fields']
    lines = [line for line in f.get('items', '').split('\n') if line.strip()]
    if graphic['template'] == 'strike_list' and f.get('final'):
        lines.append(f['final'])
    return lines


def item_times(graphic: dict, segments: Sequence, window_ms: int = STRICT_WINDOW_MS) -> Optional[list[int]]:
    """When each item (then a crossed-out list's final line) is said, in order, as source ms; None when they
    aren't all said in that order near the card."""
    lines = _card_lines(graphic)
    if not lines:
        return []
    at, length = graphic['at_ms'], graphic['duration_ms']
    said = _timed_words(segments, at - window_ms, at + length + window_ms)
    times, cursor = [], 0
    for line in lines:
        words = _words(line)
        if not words:
            return None
        found = None
        for j in range(cursor, len(said)):
            if _same(words[0], said[j][0]):
                # The rest of the item follows closely (within a few words).
                rest, k = words[1:], j + 1
                for w in rest:
                    hit = next((m for m in range(k, min(len(said), k + 4)) if _same(w, said[m][0])), None)
                    if hit is None:
                        break
                    k = hit + 1
                else:
                    found = (j, k)
                    break
        if found is None:
            return None
        times.append(said[found[0]][1])
        cursor = found[1]
    return times


def _timed_spans(segments: Sequence, lo: float, hi: float) -> list[tuple[str, int, int]]:
    """(token, start ms, end ms) of each word said between lo and hi (source ms), in order (words with timings only)."""
    out: list[tuple[str, int, int]] = []
    for seg in segments:
        if seg.end_time_ms < lo or seg.start_time_ms > hi:
            continue
        for w in getattr(seg, 'words', None) or []:
            if w.end_time_ms >= lo and w.start_time_ms <= hi:
                out.extend((t, int(w.start_time_ms), int(w.end_time_ms)) for t in _tokens(w.word))
    return out


def card_words(template: str, fields: dict) -> list[str]:
    """The words a word-timed card shows, in reading order (motion-graphics.ts cardWords)."""
    split = lambda text: ' '.join(str(text or '').split()).split(' ') if str(text or '').strip() else []  # noqa: E731
    if template == 'big_words':
        return split(fields.get('text'))[:3]
    if template == 'headline_pill':
        return split(fields.get('text')) + split(fields.get('phrase'))
    if template == 'statement':
        return split(fields.get('text')) + split(fields.get('subline'))
    if template == 'takeover':
        return split(fields.get('text'))[:TAKEOVER_WORDS[1]]
    return split(fields.get('text'))


def word_spans(graphic: dict, segments: Sequence, window_ms: int = STRICT_WINDOW_MS) -> Optional[list[tuple[int, int]]]:
    """When each word on a word-timed card is said, in order: (start, end) source ms per card word, from the words
    said near the card (a word may be followed by up to two others before the next); None when they aren't all."""
    words = card_words(graphic['template'], graphic['fields'])
    if not words:
        return None
    at = graphic['at_ms']
    said = _timed_spans(segments, at - window_ms, at + graphic['duration_ms'] + window_ms)
    best = None
    for start in range(len(said)):
        out, k, ok = [], start, True
        for n, word in enumerate(words):
            tokens = _tokens(word)
            if not tokens:
                # Punctuation only: shown with the word before it.
                out.append(out[-1] if out else (said[start][1], said[start][2]))
                continue
            limit = k + 1 if n == 0 else min(len(said), k + 3)
            hit = next((m for m in range(k, min(limit, len(said))) if _same(tokens[0], said[m][0]) or said[m][0] == tokens[0]), None)
            if hit is None:
                ok = False
                break
            end = said[min(len(said) - 1, hit + len(tokens) - 1)][2]
            out.append((said[hit][1], end))
            k = hit + len(tokens)
        if ok and (best is None or abs(out[0][0] - at) < abs(best[0][0] - at)):
            best = out
    return best


def next_start(kept: Sequence[dict], g: dict) -> Optional[int]:
    """The start of the next card after `g` (source ms), or None."""
    later = [k['at_ms'] for k in kept if k['at_ms'] > g['at_ms']]
    return min(later) if later else None


def word_timed(g: dict, segments: Sequence, clip_end: float, following: Optional[int], earliest: Optional[float] = None) -> dict:
    """A word-timed card with each word's spoken time (word_ms, ms into the card) and on screen until WORD_HOLD_MS after
    its last word ends (within the clip and before the next card). Unchanged when its words can't all be timed.
    `earliest`: it never starts before this (the previous card's end, the clip's first second), even for an early word."""
    spans = word_spans(g, segments)
    if not spans:
        return g
    at = g['at_ms']
    if spans[0][0] - at > WORD_LEAD_MS or spans[0][0] < at:
        # Start just before the first word (never earlier than it was placed when that was already early enough).
        at = max(0, spans[0][0] - WORD_LEAD_MS) if spans[0][0] >= at else max(spans[0][0], earliest if earliest is not None else 0, 0)
        at = min(at, g['at_ms']) if spans[0][0] < g['at_ms'] else at
    end = max(at + g['duration_ms'], spans[-1][1] + WORD_HOLD_MS)
    limit = min(clip_end, following - GAP_MS if following is not None else clip_end,
                at + (TAKEOVER_MAX_MS if g['template'] == 'takeover' else EDITOR_MAX_MS))
    length = int(max(EDITOR_MIN_MS, min(end, limit) - at))
    offsets = [max(0, min(length - 300, t - at)) for t, _ in spans]
    return {**g, 'at_ms': int(at), 'duration_ms': length, 'fields': {**g['fields'], 'word_ms': '\n'.join(str(int(o)) for o in offsets)}}


def _strict_said(graphic: dict, segments: Sequence) -> bool:
    """Every word on a newer card is said near it; accents sit inside their text; items are said in order;
    an icon row's icons are generic ones; a comment prompt comes when the speaker asks for comments."""
    t, f = graphic['template'], graphic['fields']
    at, length = graphic['at_ms'], graphic['duration_ms']
    if t in ('orbit', 'feature_tile', 'staircase') and any(n and n not in GRAPHIC_ICONS for n in f.get('icons', '').split('\n')):
        return False
    if t == 'statement' and f.get('accent') and not accent_inside(f.get('text', ''), f['accent']):
        return False
    if t == 'strike_list' and f.get('accent') and not accent_inside(f.get('final', ''), f['accent']):
        return False
    if t == 'icon_pop' and any(n and n not in GRAPHIC_ICONS for n in f.get('icons', '').split('\n')):
        return False
    heard = {w for w, _ in _timed_words(segments, at - STRICT_WINDOW_MS, at + length + STRICT_WINDOW_MS)}
    checked = {k: v for k, v in f.items() if k not in NON_WORD_FIELDS and k != 'accent'}
    if t == 'comment_cta':
        near = {w for w, _ in _timed_words(segments, at - NUMBER_WINDOW_MS, at + NUMBER_WINDOW_MS)}
        if not any(w in near for w in COMMENT_WORDS):
            return False
        if checked.get('lead', '').lower() in ('comment', ''):
            checked.pop('lead', None)
    if not all(_said(w, heard) for text in checked.values() for w in _words(text)):
        return False
    if t in ('sticky_notes', 'strike_list', 'icon_pop', 'orbit', 'feature_tile') + DIAGRAMS and item_times(graphic, segments) is None:
        return False
    return True


def words_said(graphic: dict, segments: Sequence) -> bool:
    """Every number on the card is said within 3 s of it; most of its words are said near it (every word, close
    by and in order, for the newer templates)."""
    at, length = graphic['at_ms'], graphic['duration_ms']
    effect_id = graphic['fields'].get('effect') if graphic['template'] == 'fx' else None
    if graphic['template'] == 'fx':
        # An effect: only the fields it shows as words or numbers (fx_catalog 'said'), every word said near it.
        effect = fx_catalog().get(graphic['fields'].get('effect'))
        if not effect:
            return False
        from clip_engine.services.graphics_director import UNIT_FIELDS, fx_words_ok
        if not fx_words_ok(graphic, segments):
            return False
        # (Units like "x" or "k" on a number are checked by fx_words_ok.)
        said = {f['key'] for f in effect['fields'] if f['said'] and f['key'] not in UNIT_FIELDS}
        fields = {k: v for k, v in graphic['fields'].items() if k in said}
        if fields.get('value') and _HAS_DIGIT.search(fields['value']):
            # A number with its unit as said ("3" + " million" is 3 million; "10" + "x" is 10).
            unit = graphic['fields'].get('suffix') or graphic['fields'].get('unit') or ''
            fields['value'] = f"{fields['value']}{unit if unit[:1] in ('%', ' ') or len(unit) <= 2 else ' ' + unit}"
        graphic = {**graphic, 'fields': fields}
    near_numbers = _numbers(_words_between(segments, at - NUMBER_WINDOW_MS, at + NUMBER_WINDOW_MS))
    # An effect's list of numbers (a chart's bars, a line's points) is said while it builds: each one while it shows.
    lists = {f['key'] for f in (fx_catalog().get(effect_id) or {}).get('fields', []) if f['kind'] == 'list'} if effect_id else set()
    along = _numbers(_words_between(segments, at - NUMBER_WINDOW_MS, at + length + NUMBER_WINDOW_MS)) if lists else []
    for key, text in graphic['fields'].items():
        if key in NON_WORD_FIELDS and key not in lists:
            continue
        for line in text.split('\n'):
            for value in _numbers(line):
                if not any(abs(value - heard) <= 1e-6 * max(1.0, abs(value)) for heard in (along if key in lists else near_numbers)):
                    return False
    if graphic['template'] in STRICT_TEMPLATES or graphic['template'] == 'fx':
        strict_heard = {w for w, _ in _timed_words(segments, at - STRICT_WINDOW_MS, at + length + STRICT_WINDOW_MS)}
        return _digits_said(graphic, strict_heard) and _strict_said(graphic, segments)
    heard = set(_tokens(_words_between(segments, at - WORD_WINDOW_MS, at + length + WORD_WINDOW_MS)))
    if not _digits_said(graphic, heard):
        return False
    tokens = [t for key, text in graphic['fields'].items() if key not in NON_WORD_FIELDS for t in _tokens(text) if not _HAS_DIGIT.search(t)]
    if not tokens:
        return True
    if any((t in MEANING_WORDS or t.replace('’', "'").endswith("n't")) and not _said(t, heard) for t in tokens):
        return False
    return sum(_said(t, heard) for t in tokens) / len(tokens) >= MIN_WORD_SHARE


def spoken_start(graphic: dict, segments: Sequence) -> Optional[int]:
    """When the card's first word is said near its suggested time (source ms), or None."""
    f, t = graphic['fields'], graphic['template']
    first_text = (_card_lines(graphic) or [''])[0] if t in ITEM_TEMPLATES else ''
    if t in ('list', 'checklist') and f.get('title'):
        first_text = f['title']
    for key in ('text', 'value', 'name', 'before'):
        if not first_text and f.get(key):
            first_text = f[key]
    if t == 'comment_cta':
        first_text = 'comment'
    words = _tokens(first_text)[:3]
    if not words:
        return None
    at = graphic['at_ms']
    said = _timed_words(segments, at - SNAP_MS, at + SNAP_MS + 2000)

    def match(i: int, w: str) -> bool:
        return said[i][0] == w if _HAS_DIGIT.search(w) else _same(w, said[i][0])

    hits = []
    for j in range(len(said)):
        if not match(j, words[0]) or abs(said[j][1] - at) > SNAP_MS:
            continue
        # The card's next words follow (one word between them at most), so a common first word doesn't mislead.
        k = j + 1
        for w in words[1:]:
            hit = next((m for m in range(k, min(len(said), k + 2)) if match(m, w)), None)
            if hit is None:
                break
            k = hit + 1
        else:
            hits.append(said[j][1])
    if not hits and t == 'comment_cta':
        hits = [ms for w, ms in said if w in COMMENT_WORDS and abs(ms - at) <= SNAP_MS]
    return min(hits, key=lambda ms: abs(ms - at)) if hits else None


# ---------------------------------------------------------------------------
# Chapter headers: a talk with an explicit structure ("step one… step two…", "first… second…") gets a title at
# the top for each section, built ONLY from words said: the label from the marker ("Step #1." only when "step one"
# or "step number one" is said), the title from the words right after it.
# ---------------------------------------------------------------------------

NUMBER_WORDS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10}
ORDINALS = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5, 'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10}
# Words that number a section when followed by a number ("step two", "tip number three").
SECTION_WORDS = ('step', 'tip', 'rule', 'lesson', 'part', 'phase', 'mistake', 'secret', 'reason', 'way', 'number')
# Words after an ordinal that still mark a section ("the second thing", "second step").
ORDINAL_THEN = ('thing', 'step', 'one', 'tip', 'rule', 'part', 'way', 'reason', 'mistake', 'is')
# Filler between the marker and the title ("step one IS TO come up with…", "step two, YOU NEED TO get clear…").
TITLE_SKIP = frozenset(('is', 'to', 'and', 'so', 'the', 'thing', 'things', 'that', 'you', 'we', 'i', 'are', 'was', 'um', 'uh', 'like', 'well',
                        'okay', 'ok', 'basically', 'gonna', 'going', 'want', 'wanna', 'need', 'have', 'got', 'gotta', 'has', 'should',
                        'must', 'will', 'be', 'just', 'of', 'all', 'off', 'then', 'now', 'here', 'do', "you're", "we're", "i'm",
                        "you've", "let's", 'lets', 'step', 'number', 'actually', 'really', 'which', 'what', 'about'))
# Words a title never ends on.
TITLE_TRAIL = frozenset(('and', 'the', 'a', 'an', 'to', 'of', 'so', 'that', 'is', 'because', 'with', 'for', 'your', 'you', 'on',
                         'in', 'or', 'but', 'my', 'our', 'this', 'at', 'by', 'from', 'as', 'are', 'be', 'if', 'like', 'um', 'uh'))
TITLE_MAX_WORDS = 6
# Between sentences: a pause this long, or a word ending a sentence.
SENTENCE_GAP_MS = 450
# A chapter starts just before its marker; the next one ends this one.
CHAPTER_LEAD_MS = 100
# Where the marker must be said around a chapter's start, and its title words after it.
CHAPTER_MARKER_MS = 1500
CHAPTER_TITLE_MS = 9000
_LABEL = re.compile(r'^(?:(step|tip|rule|lesson|part|phase|mistake|secret|reason|way) )?#(\d{1,2})\.$', re.I)


def _spoken(segments: Sequence) -> list[dict]:
    """Every timed word said, in order: its token(s), its start and end (source ms), whether a sentence starts
    with it and whether one ends with it."""
    out: list[dict] = []
    for seg in segments:
        words = getattr(seg, 'words', None) or []
        for k, w in enumerate(words):
            raw = str(w.word or '')
            toks = _tokens(raw) or []
            for j, tok in enumerate(toks):
                # (A word read as several tokens, "$8,188.", ends its sentence on its last token only.)
                out.append({'tok': tok, 'raw': raw, 'start': int(w.start_time_ms), 'end': int(w.end_time_ms),
                            'first': k == 0 and j == 0, 'ends': j == len(toks) - 1 and bool(re.search(r'[.!?:;]["”’]?$', raw.strip()))})
    for i, w in enumerate(out):
        if i and (out[i - 1]['ends'] or w['start'] - out[i - 1]['end'] >= SENTENCE_GAP_MS):
            w['first'] = True
        if i == 0:
            w['first'] = True
    return out


def _number_at(words: list[dict], i: int) -> Optional[int]:
    if i >= len(words):
        return None
    tok = words[i]['tok']
    if tok in NUMBER_WORDS:
        return NUMBER_WORDS[tok]
    return int(tok) if tok.isdigit() and 1 <= int(tok) <= 10 else None


def _markers(words: list[dict]) -> list[dict]:
    """Section markers said: {'kind', 'n', 'label', 'at' (index of the marker's first word), 'after' (index after it)}."""
    found = []
    for i, w in enumerate(words):
        tok = w['tok']
        if tok in SECTION_WORDS:
            j = i + 1
            if tok != 'number' and j < len(words) and words[j]['tok'] == 'number':
                j += 1
            n = _number_at(words, j)
            # "number one" counts only at a sentence start ("my number one tip" isn't a section).
            if n is not None and (tok != 'number' or w['first'] or (i and words[i - 1]['tok'] in ('and', 'so', 'now'))):
                label = f'{tok.capitalize()} #{n}.' if tok != 'number' else f'#{n}.'
                found.append({'kind': tok, 'n': n, 'label': label, 'at': i, 'after': j + 1})
        elif tok in ORDINALS or tok in ('next', 'finally', 'lastly'):
            # "First, …", "The second thing…", "And the next step…": at a sentence start.
            k = i
            while k > 0 and words[k - 1]['tok'] in ('the', 'and', 'so', 'now', 'my', 'your') and not words[k]['first']:
                k -= 1
            if not words[k]['first']:
                continue
            j = i + 1
            if tok in ('next',):
                if j >= len(words) or words[j]['tok'] not in ORDINAL_THEN:
                    continue
            elif j < len(words) and words[j]['tok'] in ('of',):
                continue  # "first of all"
            label = (tok.capitalize() if tok in ORDINALS else 'Next' if tok == 'next' else tok.capitalize()) + '.'
            found.append({'kind': 'ordinal', 'n': ORDINALS.get(tok, 0), 'label': label, 'at': i, 'after': j})
    return found


def _family(markers: list[dict]) -> list[dict]:
    """The markers of the talk's structure: a numbered kind said with at least two numbers in a row (1 then 2, …),
    or ordinals starting with "first" and followed by a second one. Others (a lone "step two") are left out."""
    best: list[dict] = []
    for kind in {m['kind'] for m in markers}:
        group = [m for m in markers if m['kind'] == kind]
        if kind == 'ordinal':
            # From "first", then later ordinals in order (next / finally continue it).
            seq, want = [], 1
            for m in group:
                if m['n'] == want or (m['n'] == 0 and seq):
                    seq.append(m)
                    want = (m['n'] or want - 1) + 1
            ok = len(seq) >= 2 and seq[0]['n'] == 1
        else:
            seq, last = [], 0
            for m in group:
                if m['n'] == last + 1 or (not seq and m['n'] >= 1):
                    seq.append(m)
                    last = m['n']
                elif seq and m['n'] == last:
                    continue
            ok = len(seq) >= 2 and all(b['n'] == a['n'] + 1 for a, b in zip(seq, seq[1:]))
        if ok and len(seq) > len(best):
            best = seq
    return sorted(best, key=lambda m: m['at'])


def _title_case(word: str) -> str:
    clean = re.sub(r"^[^\w$#]+|[^\w%']+$", '', word)
    if not clean:
        return ''
    return clean if clean.isupper() and len(clean) > 1 else clean[:1].upper() + clean[1:]


def _title_after(words: list[dict], start: int, stop: int) -> str:
    """The section's title: the words said right after its marker (filler skipped), to the end of that sentence,
    at most six words, never ending on a small word."""
    i = start
    while i < stop and words[i]['tok'] in TITLE_SKIP:
        if words[i]['ends']:
            return ''
        i += 1
    picked: list[str] = []
    seen_raw = None
    while i < stop and len(picked) < TITLE_MAX_WORDS:
        w = words[i]
        if i > start and w['first'] and picked:
            break
        if w['raw'] is not seen_raw:
            picked.append(w['raw'])
            seen_raw = w['raw']
        if w['ends']:
            break
        i += 1
    while picked and _tokens(picked[-1]) and _tokens(picked[-1])[-1] in TITLE_TRAIL:
        picked.pop()
    return ' '.join(t for t in (_title_case(p) for p in picked) if t)


def find_chapters(segments: Sequence) -> list[dict]:
    """The talk's sections, from its explicit structure: [{'label', 'title', 'at_ms'}] in source time (at_ms: when
    the marker is said). Empty when the talk has no structure said out loud."""
    words = _spoken(segments)
    family = _family(_markers(words))
    out = []
    for k, m in enumerate(family):
        stop = family[k + 1]['at'] if k + 1 < len(family) else len(words)
        title = _title_after(words, m['after'], stop)
        if not title:
            continue
        out.append({'label': m['label'], 'title': title, 'at_ms': max(0, words[m['at']]['start'] - CHAPTER_LEAD_MS)})
    return out


def chapter_said(graphic: dict, segments: Sequence) -> bool:
    """A chapter header's words are said where it starts: its label's number (or ordinal) said as a section marker
    within 1.5 s, and every word of its title said, in order, in the seconds after. A made-up step number or title
    word fails."""
    f, at = graphic.get('fields') or {}, int(graphic.get('at_ms', 0))
    label, title = ' '.join(str(f.get('label') or '').split()), str(f.get('title') or '')
    words = [w for w in _spoken(segments) if at - CHAPTER_MARKER_MS <= w['start'] <= at + CHAPTER_TITLE_MS]
    if label:
        near = [m for m in _markers(words) if abs(words[m['at']]['start'] - at) <= CHAPTER_MARKER_MS]
        if not any(m['label'].lower() == label.lower() for m in near):
            return False
    want = _tokens(title)
    if not want:
        return bool(label)
    toks, k = [w['tok'] for w in words], 0
    for t in want:
        hit = next((m for m in range(k, len(toks)) if _same(t, toks[m])), None)
        if hit is None:
            return False
        k = hit + 1
    return True


def chapter_graphics(segments: Sequence, ranges: Sequence[Sequence[float]], speed: float, tail_src: Optional[float] = None) -> list[dict]:
    """Chapter headers for a clip (source time): one per section said in it, each until the next starts (or the clip
    ends, before the comment keyword's last seconds), moved to where the clip picks up when its start is cut out."""
    if not ranges:
        return []
    clip_start, clip_end = ranges[0][0], min(ranges[-1][1], tail_src if tail_src is not None else ranges[-1][1])
    found = [c for c in find_chapters(segments) if clip_start - CHAPTER_LEAD_MS <= c['at_ms'] < clip_end - 1500]
    out = []
    for k, c in enumerate(found):
        at = max(clip_start, c['at_ms'])
        if output_ms(ranges, speed, at) is None:
            later = [a for a, _ in ranges if a > at]
            if not later:
                continue
            at = later[0]
        end = found[k + 1]['at_ms'] - GAP_MS if k + 1 < len(found) else clip_end
        length = int(min(CHAPTER_MAX_MS, end - at))
        if length < 1500:
            continue
        g = {'template': 'chapter', 'at_ms': int(at), 'duration_ms': length, 'placement': 'top',
             'fields': {'label': c['label'], 'title': c['title'][:MAX_FIELD_CHARS]}}
        if chapter_said({**g, 'at_ms': c['at_ms']}, segments):
            out.append(g)
    return out


def drop_unsaid_extras(graphic: dict, segments: Sequence) -> dict:
    """A diagram without its title, center words or card notes when those aren't all said near it (its items are
    checked on their own: the diagram stands without the rest)."""
    if graphic['template'] not in DIAGRAMS:
        return graphic
    at, length = graphic['at_ms'], graphic['duration_ms']
    heard = {w for w, _ in _timed_words(segments, at - STRICT_WINDOW_MS, at + length + STRICT_WINDOW_MS)}
    fields = dict(graphic['fields'])
    for key in ('title', 'text', 'notes'):
        if key in fields and not all(_said(w, heard) for w in _words(fields[key])):
            del fields[key]
    return {**graphic, 'fields': fields}


def diagram_span(graphic: dict, segments: Sequence) -> Optional[tuple[int, int]]:
    """When a diagram is on screen (source ms): from just before its first item is said to a little after its last
    (6-15 s), or None when its items aren't all said in order near it."""
    times = item_times(graphic, segments)
    if not times:
        return None
    # Items said far apart leave the diagram sitting half built (a Wrong / right with one lonely card for 15 s): left out.
    if any(b - a > DIAGRAM_ITEM_GAP_MS for a, b in zip(times, times[1:])):
        return None
    at = max(0, times[0] - DIAGRAM_LEAD_MS)
    end = max(times[-1] + DIAGRAM_HOLD_MS, at + DIAGRAM_MIN_MS)
    return int(at), int(min(end - at, DIAGRAM_AUTO_MAX_MS))


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


_PRIORITY = {'stat': 6, 'strike_list': 6, 'list': 5, 'checklist': 5, 'statement': 3, 'headline_pill': 5, 'sticky_notes': 3,
             'icon_pop': 4, 'before_after': 4, 'lower_third': 4, 'comment_cta': 3, 'quote': 2, 'title': 1, 'browser_frame': 4,
             'orbit': 5, 'feature_tile': 4, 'big_words': 3, **{t: 7 for t in DIAGRAMS}, 'fx': 5,
             # The type takeover is the planner's one most important line: it keeps its moment over the text cards.
             'takeover': 6}
# Effects by kind: the proof and the frameworks first, the emphasis effects like a headline pill.
_FX_PRIORITY = {'chart-story': 7, 'decline-chart': 7, 'marker-checklist-card': 7, 'constellation-hub': 6, 'radial-surround': 6,
                'state-chip-rail': 6, 'strikethrough-replace': 6, 'count-up': 6, 'number-pop-in': 6, 'conic-progress-ring': 6,
                'star-rating-fill': 6, 'testimonial-proof-card': 6, 'cta-lockup': 3,
                'data-chart': 7, 'mk-line-graph': 7, 'animated-bar-chart': 6, 'flowchart': 7, 'onboarding-stepper-flow': 6,
                # The member's own screenshots: what they chose to show wins its moment.
                **{e: 9 for e in MEDIA_FX}}


def _priority(g: dict) -> int:
    fields = ' '.join(v for k, v in g['fields'].items() if k not in ('item_ms', 'word_ms', 'cue_ms', 'effect'))
    base = _FX_PRIORITY.get(g['fields'].get('effect'), 5) if g['template'] == 'fx' else _PRIORITY.get(g['template'], 1)
    return base + (2 if _HAS_DIGIT.search(fields) else 0)


def max_cards(output_length_ms: float, register: Optional[str] = None) -> int:
    """How many cards a clip of this (finished) length gets: about one per 6.5 s, at most five a minute; with a register
    (graphics_director.seconds_per_graphic), its pace: teaching one per 6.5 s under a minute and one per 10 s up to three,
    a story about half, minimal only a few."""
    seconds = max(0.0, output_length_ms / 1000)
    if register:
        from clip_engine.services.graphics_director import graphics_count
        return graphics_count(seconds, register, MAX_PER_CLIP)
    by_pace = int(seconds // SECONDS_PER_CARD)
    by_minute = max(4, math.ceil(CARDS_PER_MINUTE * seconds / 60))
    return max(1, min(MAX_PER_CLIP, by_pace, by_minute))


def graphic_size(template: str, stage: bool, effect: Optional[str] = None) -> str:
    """'stage' for the big pattern cards when Stage layouts are on; 'card' otherwise. Diagrams are always stage size: in a
    Visual scene with Stage layouts on, else over the video on their blue panel; so are the member's screenshots (a
    picture needs the room to be read)."""
    if template in DIAGRAMS or (stage and template in STAGE_TEMPLATES) or (template == 'fx' and effect in MEDIA_FX):
        return 'stage'
    # With Stage layouts on, an effect the catalog sizes for the stage (a flowchart, a hub, a chart of several numbers)
    # gets the stage: as a card over the speaker its labels are too small to read on a phone.
    if template == 'fx' and stage and effect and (effect == 'flanking-words' or fx_catalog().get(effect, {}).get('size') == 'stage'):
        return 'stage'
    return 'card'


def new_id(taken: set[str]) -> str:
    while True:
        gid = f'g-{secrets.token_hex(5)}'
        if gid not in taken:
            taken.add(gid)
            return gid


# ---------------------------------------------------------------------------
# Variety: the planner tends to latch onto one or two templates (ten serif statement cards, five sticky notes in one
# reel). The code, not the model, keeps a video varied: each template has a cap scaled by the video's length, a template
# never comes back within a while of itself (nor twice in a row), and a card that breaks a cap becomes a richer template
# its own words fit (a statement a headline pill, big words or a title; sticky notes feature tiles, icons, an orbit or a
# checklist), checked against what was said like any other card, or it is left out. Each kept card then gets a look
# (VARIANTS), taken in turn per template so repeats never look alike.
# ---------------------------------------------------------------------------

# (most per minute, most in one video) per template; anything not listed: VARIETY_DEFAULT.
VARIETY_CAPS = {
    'statement': (2, 4), 'sticky_notes': (1, 2), 'quote': (1, 2), 'title': (1, 3), 'big_words': (1.5, 4), 'headline_pill': (1, 3),
    'stat': (3, 6), 'list': (1, 3), 'checklist': (1, 3), 'before_after': (1, 2), 'strike_list': (1, 2), 'icon_pop': (1.5, 4),
    'orbit': (1, 3), 'feature_tile': (1.5, 4), 'lower_third': (1, 2), 'comment_cta': (1, 2), 'browser_frame': (1, 3), 'takeover': (1, 2),
    **{d: (1, 2) for d in DIAGRAMS},
    # Effects count as their own kinds ("fx:count-up"); numbers come back more often than the rest.
    'fx:count-up': (3, 6), 'fx:number-pop-in': (2, 4), 'fx:conic-progress-ring': (1, 2), 'fx:star-rating-fill': (1, 2),
    'fx:chart-story': (1, 2), 'fx:decline-chart': (1, 2), 'fx:marker-highlight': (1.5, 4), 'fx:cta-lockup': (1, 1),
    'fx:data-chart': (1, 2), 'fx:mk-line-graph': (1, 2), 'fx:animated-bar-chart': (1, 2), 'fx:flowchart': (1, 2), 'fx:onboarding-stepper-flow': (1, 2),
}
VARIETY_DEFAULT = (1.5, 4)
# A template never comes back sooner than this after itself (a short clip: a quarter of its length, at least 8 s) and
# never as the very next graphic unless SAME_ADJACENT times that far on.
SAME_GAP_MS = 25000
SAME_GAP_MIN_MS = 8000
SAME_ADJACENT = 1.6
# A video this long uses at least this many different templates when its words allow (MIN_DISTINCT_LONG over 2 minutes).
DISTINCT_FROM_S = 120
MIN_DISTINCT_LONG = 7
MIN_DISTINCT_MID = 5
# What a card that breaks a cap may become, best first (each only when its words fit and are said).
CONVERSIONS = {
    'statement': ('headline_pill', 'big_words', 'title', 'feature_tile'),
    'quote': ('headline_pill', 'statement', 'big_words', 'title'),
    'title': ('big_words', 'headline_pill', 'statement'),
    'big_words': ('title', 'headline_pill', 'statement'),
    'headline_pill': ('statement', 'big_words', 'title'),
    'sticky_notes': ('feature_tile', 'icon_pop', 'orbit', 'checklist', 'list', 'idea_hub'),
    'list': ('checklist', 'feature_tile', 'icon_pop', 'orbit', 'sticky_notes'),
    'checklist': ('list', 'feature_tile', 'icon_pop', 'sticky_notes'),
    'feature_tile': ('icon_pop', 'list', 'sticky_notes'),
    'icon_pop': ('feature_tile', 'orbit', 'list'),
    'orbit': ('icon_pop', 'feature_tile', 'idea_hub'),
}
# A generic icon for an item from its words (decoration only: never words on the card). First match wins.
ICON_WORDS = (
    ('dollar', ('money', 'dollar', 'dollars', 'cash', 'sales', 'sale', 'sell', 'profit', 'profitable', 'revenue', 'income', 'paid', 'price', 'pay', 'earn', 'earning', 'earnings')),
    ('megaphone', ('ads', 'ad', 'advertising', 'marketing', 'promote', 'promoting', 'campaign', 'traffic')),
    ('users', ('people', 'audience', 'followers', 'users', 'customers', 'clients', 'community', 'team', 'buyers', 'members', 'eyeballs')),
    ('video', ('video', 'videos', 'youtube', 'reel', 'reels', 'clip', 'clips', 'shorts', 'tiktok', 'film')),
    ('camera', ('instagram', 'photo', 'photos', 'camera')),
    ('mail', ('email', 'emails', 'mail', 'newsletter', 'inbox')),
    ('message', ('chat', 'message', 'messages', 'dm', 'dms', 'comment', 'comments', 'questions', 'question', 'ask')),
    ('globe', ('website', 'site', 'page', 'pages', 'landing', 'web', 'online', 'internet', 'funnel')),
    ('gift', ('product', 'products', 'offer', 'offers', 'course', 'bonus', 'digital')),
    ('bot', ('ai', 'bot', 'claude', 'gpt', 'chatgpt', 'automation', 'automatically', 'automate', 'automated')),
    ('clock', ('time', 'hours', 'hour', 'minutes', 'minute', 'daily', 'week', 'weekly', 'day', 'days', 'fast')),
    ('trending', ('grow', 'growth', 'scale', 'scaling', 'increase', 'results', 'consistent', 'consistently')),
    ('chart', ('data', 'analytics', 'numbers', 'stats', 'reports', 'report', 'metrics', 'roas')),
    ('image', ('content', 'post', 'posts', 'posting', 'design', 'designs', 'creative', 'animations', 'animation')),
    ('target', ('goal', 'goals', 'target', 'niche', 'avatar', 'focus')),
    ('zap', ('viral', 'quick', 'instant', 'easy', 'simple')),
    ('rocket', ('launch', 'start', 'starting', 'build', 'building', 'business')),
    ('book', ('learn', 'lesson', 'lessons', 'module', 'modules', 'teach', 'teaches', 'blueprint', 'guide', 'written')),
    ('idea', ('idea', 'ideas', 'think', 'mindset')),
    ('search', ('research', 'search', 'find', 'figure', 'figuring')),
    ('check', ('done', 'ready', 'finished', 'works', 'proven')),
    ('heart', ('love', 'trust', 'connection', 'care')),
    ('lock', ('secret', 'private', 'safe')),
    ('settings', ('system', 'systems', 'process', 'setup', 'tools', 'tool')),
)
_ICON_OF = {w: icon for icon, words in ICON_WORDS for w in words}


def icon_for(text: str) -> str:
    """A generic icon for an item from its words ('' when none fits)."""
    for token in _tokens(text):
        if token in _ICON_OF:
            return _ICON_OF[token]
    return ''


def kind_of(g: dict) -> str:
    """A graphic's kind for the variety rules: its template, or "fx:<effect>" for an effect."""
    from clip_engine.services.graphics_director import kind_of as kind
    return kind(g)


def template_cap(template: str, seconds: float) -> int:
    """The most graphics of one kind (a template, or fx:<effect>) a video this long keeps."""
    per_minute, total = VARIETY_CAPS.get(template, VARIETY_DEFAULT)
    return max(1, min(total, math.ceil(per_minute * max(0.0, seconds) / 60 - 1e-9)))


def same_gap_ms(seconds: float) -> int:
    """How long before a template may come back (25 s; a quarter of a short clip, at least 8 s)."""
    return int(min(SAME_GAP_MS, max(SAME_GAP_MIN_MS, seconds * 1000 / 4)))


def min_distinct(seconds: float) -> int:
    return MIN_DISTINCT_LONG if seconds > DISTINCT_FROM_S else MIN_DISTINCT_MID if seconds > 60 else 0


def _plain_words(text: str) -> list[str]:
    return ' '.join(str(text or '').split()).split(' ') if str(text or '').strip() else []


def _letters(text: str) -> int:
    return len(re.findall(r'[A-Za-z0-9]', text or ''))


def _items_of(g: dict) -> list[str]:
    f = g['fields']
    t = g['template']
    if t in ('statement', 'quote', 'title', 'big_words', 'headline_pill', 'takeover'):
        return []
    if t == 'fx':
        from clip_engine.services.graphics_director import fx_cue_units
        return fx_cue_units(f) if (fx_catalog().get(f.get('effect')) or {}).get('cue', {}).get('unit') == 'item' else []
    return [line for line in f.get('items', '').split('\n') if line.strip()]


def _line_of(g: dict) -> str:
    """A text card's line, as said (a headline pill's two parts together)."""
    f = g['fields']
    if g['template'] == 'headline_pill':
        return ' '.join(x for x in (f.get('text', ''), f.get('phrase', '')) if x)
    if g['template'] == 'fx':
        return f.get('text', '') if 'text' in f else ''
    return f.get('text', '')


def _icons(items: Sequence[str], need_all: bool) -> Optional[str]:
    icons = [icon_for(i) for i in items]
    if need_all and not all(icons):
        return None
    if not any(icons):
        return None if need_all else ''
    return '\n'.join(icons)


def converted(g: dict, to: str) -> Optional[dict]:
    """`g` as template `to` with its own words (in the order said), or None when they don't fit `to`. Words are checked
    again by the caller (words_said)."""
    t, f = g['template'], g['fields']
    fields: dict[str, str] = {}
    line = _line_of(g)
    words = _plain_words(line)
    items = _items_of(g)
    if to == 'headline_pill':
        if not 2 <= len(words) <= 10 or t not in ('statement', 'quote', 'title', 'big_words', 'takeover'):
            return None
        # The key words (the statement's accent) start the color box; else its last third does.
        accent = [_tokens(w) for w in _plain_words(f.get('accent', ''))] if t == 'statement' else []
        keys = [_tokens(w) for w in words]
        starts = [i for i in range(1, len(words) - len(accent) + 1) if accent and keys[i:i + len(accent)] == accent]
        cut = starts[-1] if starts else len(words) - max(1, round(len(words) / 3))
        fields = {'text': ' '.join(words[:cut]), 'phrase': ' '.join(words[cut:])}
    elif to == 'big_words':
        accent = _plain_words(f.get('accent', '')) if t == 'statement' else []
        pick = accent if 1 <= len(accent) <= 3 else words if 1 <= len(words) <= 3 else []
        if not pick or _letters(' '.join(pick)) < 4:
            return None
        fields = {'text': ' '.join(pick)}
    elif to == 'title':
        if not 1 <= len(words) <= 7:
            return None
        fields = {'text': line}
    elif to == 'statement':
        if not 2 <= len(words) <= 12:
            return None
        fields = {'text': line}
        accent = f.get('phrase') if t == 'headline_pill' else ''
        if accent:
            fields['accent'] = accent
    elif to in ('feature_tile', 'icon_pop', 'orbit', 'idea_hub', 'list', 'checklist', 'sticky_notes'):
        lines = items or ([line] if line and to == 'feature_tile' else [])
        if not lines:
            return None
        most = ITEM_LIMITS.get(to, MAX_ITEMS)
        if not MIN_ITEMS.get(to, 1) <= len(lines) <= most:
            return None
        longest = max(len(_plain_words(x)) for x in lines)
        if to in ('feature_tile', 'icon_pop', 'orbit') and longest > 3:
            return None
        if to in ('sticky_notes', 'idea_hub') and longest > 4:
            return None
        fields = {'items': '\n'.join(lines)}
        if to in ('feature_tile', 'icon_pop', 'orbit', 'list', 'checklist'):
            icons = _icons(lines, need_all=to in ('icon_pop', 'orbit'))
            if icons is None:
                return None
            if icons:
                fields['icons'] = icons
        if to in ('list', 'checklist') and f.get('title'):
            fields['title'] = f['title']
        if to == 'idea_hub' and t == 'orbit' and f.get('text'):
            fields['text'] = f['text']
    else:
        return None
    if to in DIAGRAMS:
        length = g['duration_ms']
    elif to in WORD_TIMED:
        # Word-timed cards are fitted to their words afterwards (word_timed): start from the template's usual length.
        length = min(max(g['duration_ms'], MIN_MS), DEFAULT_MS[to] + 1000)
    else:
        length = min(max(g['duration_ms'], MIN_MS), DEFAULT_MS[to] + 1500)
    return {**g, 'template': to, 'fields': fields, 'duration_ms': int(length), 'converted_from': t}


# Numbers come back sooner than the rest (a result, then the next result): their own kind waits this long.
NUMBER_KINDS = ('stat', 'fx:count-up', 'fx:number-pop-in')
NUMBER_GAP_MS = 12000


def _same_too_close(g: dict, kept: Sequence[dict], seconds: float, adjacent: bool = True) -> bool:
    kind = kind_of(g)
    gap = min(same_gap_ms(seconds), NUMBER_GAP_MS) if kind in NUMBER_KINDS else same_gap_ms(seconds)
    same = [k for k in kept if kind_of(k) == kind]
    if any(abs(k['at_ms'] - g['at_ms']) < gap for k in same):
        return True
    if not adjacent or kind in NUMBER_KINDS:
        return False
    # The very next graphic of the same template (nothing else between them), unless far apart.
    for k in same:
        lo, hi = sorted((k['at_ms'], g['at_ms']))
        if hi - lo < gap * SAME_ADJACENT and not any(lo < o['at_ms'] < hi for o in kept if o['template'] != 'chapter' and kind_of(o) != kind):
            return True
    return False


def variety_allows(g: dict, kept: Sequence[dict], seconds: float, adjacent: bool = True) -> bool:
    """`g` keeps the video varied: under its template's cap and not too soon after (or before) itself (`adjacent`: nor
    as the very next graphic, unless far apart; checked once every card is placed: no_repeats_in_a_row)."""
    if g['template'] == 'chapter':
        return True
    from clip_engine.services.graphics_director import group_allows
    kind = kind_of(g)
    if sum(1 for k in kept if kind_of(k) == kind) >= template_cap(kind, seconds) or not group_allows(kind, kept, seconds):
        return False
    return not _same_too_close(g, kept, seconds, adjacent)


def _fits_words(g: dict, segments: Sequence) -> Optional[dict]:
    """A converted card checked like a planned one: its words said, items in order; a diagram on its span. None when not."""
    if not has_content(g['template'], g['fields']) or not words_said(g, segments):
        return None
    if g['template'] == 'fx':
        from clip_engine.services.graphics_director import fx_timed
        return fx_timed(g, segments)
    if g['template'] in DIAGRAMS:
        span = diagram_span(g, segments)
        if span is None:
            return None
        g = {**g, 'at_ms': span[0], 'duration_ms': span[1]}
    elif g['template'] in ITEM_TEMPLATES and g['template'] not in ('list', 'checklist') and item_times(g, segments) is None:
        return None
    return g


def varied(g: dict, kept: Sequence[dict], segments: Sequence, seconds: float, allowed: Sequence[str], adjacent: bool = True) -> Optional[dict]:
    """`g` as it can join `kept`: unchanged when the variety rules allow it, else the first richer template its words fit
    (and that the rules allow), else None. (Cards are placed strongest first: a weaker one placed later between two of a
    kind is fine; no_repeats_in_a_row checks the final order once more.)"""
    from clip_engine.services.graphics_director import CONVERSIONS as TO, CONVERT_FIRST, convert
    kind = kind_of(g)
    # A plain text card (a headline pill, a title, a before / after too) is a fallback: a richer visual its words fit
    # (an effect first) comes first.
    plain = kind in CONVERT_FIRST
    if not plain and variety_allows(g, kept, seconds, adjacent):
        return g
    for to in TO.get(kind, ()):
        if (to.split(':')[0] if to.startswith('fx:') else to) not in allowed:
            continue
        c = convert(g, to)
        if c is None or not variety_allows(c, kept, seconds, adjacent):
            continue
        c = _fits_words(c, segments)
        if c is not None and variety_allows(c, kept, seconds, adjacent):
            return c
    if plain and variety_allows(g, kept, seconds, adjacent):
        return g
    return None


def no_repeats_in_a_row(kept: list[dict], segments: Sequence, seconds: float, allowed: Sequence[str], clash: Any) -> list[dict]:
    """Two graphics of the same template one after the other (closer than SAME_ADJACENT times the template's gap): the
    weaker becomes another template its words fit, or is left out."""
    out = sorted(kept, key=lambda g: g['at_ms'])
    changed = True
    while changed:
        changed = False
        shown = [g for g in out if g['template'] != 'chapter']
        for a, b in zip(shown, shown[1:]):
            if kind_of(a) != kind_of(b) or b['at_ms'] - a['at_ms'] >= same_gap_ms(seconds) * SAME_ADJACENT:
                continue
            weak = a if _priority(a) < _priority(b) else b
            rest = [g for g in out if g is not weak]
            c = varied(weak, rest, segments, seconds, allowed, adjacent=True)
            if c is not None and kind_of(c) != kind_of(weak) and not clash(c, rest):
                out[out.index(weak)] = c
            else:
                out.remove(weak)
            changed = True
            break
    return out


def widen(kept: list[dict], segments: Sequence, seconds: float, allowed: Sequence[str], clash: Any) -> list[dict]:
    """A video that still uses too few templates: some cards of the most used ones become templates not used yet (when
    their words fit and the rules allow). `clash(g, others)`: True when g would overlap another card."""
    from clip_engine.services.graphics_director import CONVERSIONS as TO, convert
    want = min_distinct(seconds)
    used = {kind_of(k) for k in kept if k['template'] != 'chapter'}
    if not want or len(used) >= want:
        return kept
    out = list(kept)
    for _ in range(len(out)):
        used = {kind_of(k) for k in out if k['template'] != 'chapter'}
        if len(used) >= want:
            break
        counts = {t: sum(1 for k in out if kind_of(k) == t) for t in used}
        changed = False
        for k in sorted((k for k in out if counts.get(kind_of(k), 0) > 1), key=lambda k: (-counts[kind_of(k)], k['at_ms'])):
            rest = [x for x in out if x is not k]
            for to in TO.get(kind_of(k), ()):
                if to in used or (to.split(':')[0] if to.startswith('fx:') else to) not in allowed:
                    continue
                c = convert(k, to)
                c = _fits_words(c, segments) if c is not None else None
                if c is None or not variety_allows(c, rest, seconds, adjacent=True) or clash(c, rest):
                    continue
                out[out.index(k)] = c
                changed = True
                break
            if changed:
                break
        if not changed:
            break
    return out


def with_variants(graphics: Sequence[dict]) -> list[dict]:
    """Each automatic card without a look gets the next one of its template (ROTATION), so repeats differ; cards that
    already have one keep it."""
    turn: dict[str, int] = {}
    out = []
    for g in sorted(graphics, key=lambda g: g['at_ms']):
        t = g['template']
        if t in ROTATION:
            fields = g['fields']
            if fields.get('variant') not in VARIANTS[t]:
                looks = ROTATION[t]
                fields = {**fields, 'variant': looks[turn.get(t, 0) % len(looks)]}
            turn[t] = (ROTATION[t].index(fields['variant']) + 1) if fields['variant'] in ROTATION[t] else turn.get(t, 0) + 1
            g = {**g, 'fields': fields}
        out.append(g)
    return out


def with_list_icons(g: dict) -> dict:
    """A list or checklist (drawn as icon rows in some looks) gets a generic icon per item when its words suggest one."""
    if g['template'] not in ('list', 'checklist') or g['fields'].get('icons'):
        return g
    icons = _icons(_items_of(g), need_all=False)
    return {**g, 'fields': {**g['fields'], 'icons': icons}} if icons else g


def fit_to_clip(planned: Iterable[dict], segments: Sequence, ranges: Sequence[Sequence[float]], speed: float,
                options: Optional[dict] = None) -> list[dict]:
    """The planned cards that survive the finished cut, as editor graphics (source time, origin 'auto').

    Checks the words, starts each card on its first spoken word, moves a card out of the first second (or drops
    it; a hook headline may open the clip), keeps it inside the clip and out of the comment keyword's last
    seconds, keeps about one per 6.5 s that never overlap (numbers, contrasts and lists first), sets each one's
    size (stage cards when Stage layouts are on) and its items' reveal times, and returns them in time order.
    `options`: headline_off, cta_keyword, stage (see parse_planned).
    """
    opts = _options(options)
    ranges = [(float(a), float(b)) for a, b in ranges if b > a]
    if not ranges or not 1 <= speed <= 2:
        return []
    from clip_engine.services import graphics_director as director
    clip_end = ranges[-1][1]
    total_out = sum(b - a for a, b in ranges) / speed
    # The director (with the variety rules on: planning, not re-timing one graphic): the moments in the clip, its register,
    # the story stretches that stay on the face.
    register, stories = None, []
    if opts['variety']:
        clip_segments = [seg for seg in segments if seg.end_time_ms >= ranges[0][0] and seg.start_time_ms <= clip_end]
        cues = director.find_cues(clip_segments)
        register = opts['register'] or director.detect_register(cues, total_out * speed)
        stories = director.story_spans(cues)
    # The comment keyword's tail (output time), when the clip shows one.
    tail = max(total_out / 2, total_out - CTA_TAIL_MS) if opts['cta_keyword'] else total_out
    candidates = []
    for g in planned:
        template = g.get('template')
        if template not in opts['templates'] or not isinstance(g.get('fields'), dict):
            continue
        if template == 'headline_pill' and not (opts['headline_off'] or opts['pill_cards']):
            continue
        if template == 'comment_cta' and (not opts['cta_keyword'] or g['fields'].get('keyword', '').lower() != opts['cta_keyword'].lower()):
            continue
        g = {**g, 'fields': {k: v for k, v in g['fields'].items() if k not in ('item_ms', 'word_ms', 'cue_ms')}}
        g = drop_unsaid_extras(g, segments)
        if not words_said(g, segments):
            continue
        if register and not director.register_allows(director.kind_of(g), register):
            continue
        if template == 'fx' and g['fields'].get('effect') in director.STAGE_ONLY_FX and not opts['stage']:
            continue  # Flanking words sit around the speaker's card: only with the stage up.
        if template in DIAGRAMS:
            # On screen while it is talked through: from its first item to a little after its last.
            span = diagram_span(g, segments)
            if span is None:
                continue
            g = {**g, 'at_ms': span[0], 'duration_ms': span[1]}
        if template == 'fx':
            # Its beat lands on the spoken word; it holds its catalog time.
            g = director.fx_timed(g, segments)
        if stories and director.kind_of(g) not in director.STORY_EXEMPT and director.in_story(g, stories):
            continue
        at, length = float(g['at_ms']), float(g['duration_ms'])
        start = spoken_start(g, segments) if template not in DIAGRAMS and template != 'fx' else None
        if start is not None and start != at:
            # On its first word, ending when it would have (at least its usual length when it moved later).
            end = max(at + length, start + min(length, DEFAULT_MS[template]))
            at, length = float(start), end - start
        out = output_ms(ranges, speed, at)
        if out is None:
            # Said in a part the cut removed: start where the clip picks up again.
            later = [a for a, _ in ranges if a > at]
            if not later or later[0] - at > MAX_SHIFT_MS:
                continue
            length -= later[0] - at
            at = later[0]
            out = output_ms(ranges, speed, at)
        if template == 'headline_pill' and not opts['pill_cards']:
            # The hook headline opens the clip: it starts as the clip does, its words said in the first seconds.
            if out is None or out > HOOK_START_MS or (source_ms(ranges, speed, HOOK_WORDS_MS) or clip_end) < at:
                continue
            length += at - ranges[0][0]
            at = ranges[0][0]
        elif out is not None and out < FIRST_MS:
            moved = source_ms(ranges, speed, FIRST_MS)
            if moved is None or moved - at > MAX_SHIFT_MS:
                continue
            # It ends when it would have, a little shorter (dropped below if too short).
            length -= moved - at
            at = moved
        length = min(length, clip_end - at)
        span = window(ranges, speed, at, length)
        if span is None:
            continue
        if span[0] + span[1] > tail:
            # Out of the comment keyword's seconds: shortened to end before them, or dropped.
            keep_out = tail - span[0]
            if keep_out < EDITOR_MIN_MS:
                continue
            length = min(length, (source_ms(ranges, speed, tail) or clip_end) - at)
            span = window(ranges, speed, at, length)
            if span is None:
                continue
        if length < EDITOR_MIN_MS or span[1] < EDITOR_MIN_MS or (span[0] < FIRST_MS and (template != 'headline_pill' or opts['pill_cards'])):
            continue
        candidates.append({**g, 'at_ms': int(math.ceil(at)), 'duration_ms': int(max(EDITOR_MIN_MS, min(editor_max_ms(template), math.floor(length))))})
    tail_src = source_ms(ranges, speed, tail) or clip_end
    chapters = chapter_graphics(segments, ranges, speed, tail_src) if opts['chapters'] else []
    # One diagram per section: the sections are the chapters when there are some.
    section = lambda t: sum(1 for c in chapters if c['at_ms'] <= t)  # noqa: E731
    kept: list[dict] = []
    limit = opts['max_cards'] or max_cards(total_out, register)
    seconds = total_out / 1000
    # The templates a card may become to keep the video varied (a headline pill only where it is a card, not the hook).
    allowed = [t for t in opts['templates'] if t not in ('headline_pill', 'comment_cta') or (t == 'headline_pill' and opts['pill_cards'])]
    pad = opts['gap_ms']

    def diagram_near(g: dict, others: Sequence[dict]) -> bool:
        return g['template'] in DIAGRAMS and any(k['template'] in DIAGRAMS and (
            section(k['at_ms']) == section(g['at_ms']) if chapters else abs(k['at_ms'] - g['at_ms']) < DIAGRAM_GAP_MS) for k in others)

    def overlapping(g: dict, others: Sequence[dict]) -> bool:
        return any(g['at_ms'] < k['at_ms'] + k['duration_ms'] + pad and k['at_ms'] < g['at_ms'] + g['duration_ms'] + pad for k in others)

    for g in sorted(candidates, key=lambda g: (-_priority(g), g['at_ms'])):
        if len(kept) >= limit:
            break
        # (A Create clip's hook headline opens the clip as it is: it is never turned into an effect.)
        if opts['variety'] and not (g['template'] == 'headline_pill' and not opts['pill_cards']):
            g = varied(g, kept, segments, seconds, allowed)
            if g is None:
                continue
            # A card turned into an effect is timed again on its words (an effect leads its beat): never back into the
            # clip's first second or past its end.
            first_src = source_ms(ranges, speed, FIRST_MS) or ranges[0][0]
            if g['at_ms'] < first_src:
                left = g['duration_ms'] - (first_src - g['at_ms'])
                if left < EDITOR_MIN_MS:
                    continue
                g = {**g, 'at_ms': int(math.ceil(first_src)), 'duration_ms': int(left)}
            g = {**g, 'duration_ms': int(min(g['duration_ms'], clip_end - g['at_ms']))}
            if g['duration_ms'] < EDITOR_MIN_MS:
                continue
        if diagram_near(g, kept):
            continue
        if g['template'] == 'fx':
            # An effect that leads its beat may start a little later (its beat lands a touch late) rather than crowd the one before.
            before = [k['at_ms'] + k['duration_ms'] + pad + GAP_MS for k in kept
                      if k['at_ms'] <= g['at_ms'] < k['at_ms'] + k['duration_ms'] + pad + GAP_MS]
            shift = max(before) - g['at_ms'] if before else 0
            if 0 < shift <= director.FX_MAX_LEAD_MS:
                g = {**g, 'at_ms': g['at_ms'] + shift}
        # (With free time kept between graphics, `pad` counts as part of each one.)
        clash = [k for k in kept if g['at_ms'] < k['at_ms'] + k['duration_ms'] + pad and k['at_ms'] < g['at_ms'] + g['duration_ms'] + pad]
        if clash:
            # A card that starts first and runs into a stronger one ends just before it (when enough is left);
            # one as strong that started earlier makes room the same way.
            earlier = [k for k in clash if k['at_ms'] <= g['at_ms']]
            # Only the free time between them crowded: the earlier one ends a little sooner when it keeps PAD_TRIMMED_MS.
            in_pad = pad and not any(g['at_ms'] < k['at_ms'] + k['duration_ms'] and k['at_ms'] < g['at_ms'] + g['duration_ms'] for k in clash)
            if len(earlier) == 1 and len(clash) == 1 and (_priority(earlier[0]) <= _priority(g) or in_pad) \
                    and g['at_ms'] - GAP_MS - pad - earlier[0]['at_ms'] >= (PAD_TRIMMED_MS if pad else MIN_TRIMMED_MS):
                k = earlier[0]
                kept[kept.index(k)] = {**k, 'duration_ms': g['at_ms'] - GAP_MS - pad - k['at_ms']}
            else:
                end = min(k['at_ms'] for k in clash) - GAP_MS - pad
                if earlier or end - g['at_ms'] < (PAD_TRIMMED_MS if pad else MIN_TRIMMED_MS):
                    continue
                g = {**g, 'duration_ms': end - g['at_ms']}
        kept.append(g)
    if opts['variety']:
        crowded = lambda g, others: overlapping(g, others) or diagram_near(g, others)  # noqa: E731
        kept = no_repeats_in_a_row(kept, segments, seconds, allowed, crowded)
        kept = widen(kept, segments, seconds, allowed, crowded)
        # Long quiet stretches while the speaker explains get a visual from their own cues (numbers, lists, contrasts); up
        # to one graphic per FILL_SECONDS: the filled ones may go past the planner's count. (Edit my recording: a long talk.)
        fill_limit = max(limit, int(seconds // director.FILL_SECONDS))
        if opts['fill_quiet']:
            kept = director.fill_quiet(kept, segments, ranges, speed, seconds, allowed, crowded, register,
                                       max(ranges[0][0], source_ms(ranges, speed, FIRST_MS) or ranges[0][0]), source_ms(ranges, speed, tail) or clip_end, fill_limit)
        kept = [with_list_icons({k: v for k, v in g.items() if k != 'converted_from'}) for g in kept]
        # One look for the whole video (the member's tone, else light ink on dark), effects themed the same way.
        kept = director.with_look(kept, director.video_look(opts))
        if opts['logos']:
            # The member's logos where they are named (My logos): out of the first second and the comment keyword's seconds.
            kept = director.place_logos(kept, segments, opts['logos'], ranges, speed, register,
                                        source_ms(ranges, speed, FIRST_MS) or ranges[0][0], source_ms(ranges, speed, tail) or clip_end)
    taken: set[str] = set()
    out_list = []
    # Word-timed cards may start a little earlier (on their first word), never over the card before, into the clip's
    # first second, or into the comment keyword's last seconds.
    first_src = source_ms(ranges, speed, FIRST_MS) or ranges[0][0]
    tail_src = source_ms(ranges, speed, tail) or clip_end
    previous_end: Optional[float] = None
    for g in sorted(kept, key=lambda g: g['at_ms']):
        fields = dict(g['fields'])
        if g['template'] in ITEM_TEMPLATES:
            times = item_times(g, segments)
            if times and all(g['at_ms'] - 300 <= t < g['at_ms'] + g['duration_ms'] - 300 for t in times):
                # Each item comes in as it is said (ms into the card, source time).
                fields['item_ms'] = '\n'.join(str(max(0, t - g['at_ms'])) for t in times)
        if g['template'] == 'fx':
            # The effect's beats on the spoken words (ms into it): its cue words or items as said.
            cues = director.fx_cue_ms(g, segments)
            if cues:
                fields['cue_ms'] = cues
        if g['template'] in WORD_TIMED:
            floor = max(ranges[0][0], previous_end + GAP_MS if previous_end is not None else ranges[0][0],
                        first_src if g['template'] != 'headline_pill' or opts['pill_cards'] else ranges[0][0])
            g = word_timed(g, segments, min(clip_end, tail_src), next_start(kept, g), floor)
            if g.get('fields', {}).get('word_ms'):
                fields['word_ms'] = g['fields']['word_ms']
        previous_end = g['at_ms'] + g['duration_ms']
        size = graphic_size(g['template'], opts['stage'], g['fields'].get('effect'))
        if size == 'stage' and opts['variety'] and g['template'] not in DIAGRAMS:
            # On the (light) stage: the dark looks, so no white card sits on near-white.
            fields = director.on_light_stage({**g, 'fields': fields})['fields']
        out_list.append({'id': new_id(taken), 'template': g['template'], 'at_ms': g['at_ms'], 'duration_ms': g['duration_ms'],
                         'placement': g['placement'] if g.get('placement') in PLACEMENTS else 'top', 'fields': fields, 'origin': 'auto',
                         'size': size})
    # Chapter headers sit in their own band at the very top (the hook hands over to the first one).
    for c in chapters:
        out_list.append({'id': new_id(taken), **c, 'origin': 'auto', 'size': 'card'})
    return sorted(out_list, key=lambda g: g['at_ms'])


def stage_scenes_for(graphics: Sequence[dict], start_ms: int, end_ms: int, backdrop: str = 'light', card: str = 'rounded') -> list[dict]:
    """Scenes (source time, face left out) around a clip's stage-size graphics (stage_scenes.suggest_scenes): a
    Visual scene on the solid backdrop (the brand color, else royal blue) around each diagram, so its white line art
    fills the frame under the chapter header; a Stage scene around the other stage cards."""
    from clip_engine.services.stage_scenes import MIN_SCENE_MS, STAGE_PAD_AFTER_MS, stage_open_ms, suggest_scenes
    if end_ms <= start_ms:
        return []
    staged = [g for g in graphics if isinstance(g, dict) and g.get('size') == 'stage']
    shifted = [{**g, 'at_ms': g['at_ms'] - start_ms} for g in staged if g.get('template') not in DIAGRAMS]
    scenes = [s for s in suggest_scenes(shifted, end_ms - start_ms, backdrop, card) if s['scene'] != 'face'] if shifted else []
    visual = []
    for g in sorted((g for g in staged if g.get('template') in DIAGRAMS), key=lambda g: g['at_ms']):
        a = max(0, stage_open_ms(g) - start_ms)
        b = min(end_ms - start_ms, g['at_ms'] + g['duration_ms'] - start_ms + STAGE_PAD_AFTER_MS)
        if visual and a - visual[-1]['end_ms'] < MIN_SCENE_MS:
            visual[-1]['end_ms'] = max(visual[-1]['end_ms'], b)
        elif b - a >= MIN_SCENE_MS:
            visual.append({'scene': 'visual', 'start_ms': a, 'end_ms': b, 'backdrop': 'solid'})
    if visual:
        # The visual scenes win: stage scenes are cut around them (pieces under the minimum are dropped).
        kept = []
        for s in scenes:
            pieces = [(s['start_ms'], s['end_ms'])]
            for v in visual:
                pieces = [p for lo, hi in pieces for p in ((lo, min(hi, v['start_ms'])), (max(lo, v['end_ms']), hi)) if p[1] - p[0] >= MIN_SCENE_MS]
            kept.extend({**s, 'start_ms': lo, 'end_ms': hi} for lo, hi in pieces)
        scenes = sorted(kept + visual, key=lambda s: s['start_ms'])
    return [{**s, 'start_ms': s['start_ms'] + start_ms, 'end_ms': s['end_ms'] + start_ms} for s in scenes]


def on_stage(graphic: dict, scenes: Sequence[dict]) -> bool:
    """Most of a graphic (80%) plays during a stage scene (source time); a diagram is always drawn stage size (in its
    Visual scene, or over the video on its blue panel)."""
    if graphic.get('template') in DIAGRAMS:
        return True
    a, b = graphic['at_ms'], graphic['at_ms'] + graphic['duration_ms']
    inside = sum(max(0, min(b, s['end_ms']) - max(a, s['start_ms'])) for s in scenes if s.get('scene') in ('stage', 'visual'))
    return inside >= 0.8 * (b - a)


def checked_saved(raw: Any, duration_ms: int) -> list[dict]:
    """Graphics read back from a run (job_output metrics) for the editor: well-formed ones only, at most MAX_GRAPHICS."""
    if not isinstance(raw, list):
        return []
    out, ids = [], set()
    for g in raw[:MAX_GRAPHICS]:
        if not isinstance(g, dict) or g.get('template') not in SAVED_TEMPLATES:
            continue
        gid, at, length = g.get('id'), g.get('at_ms'), g.get('duration_ms')
        if not isinstance(gid, str) or not re.fullmatch(r'[a-z0-9-]{4,40}', gid) or gid in ids:
            continue
        if type(at) is not int or type(length) is not int or not 0 <= at <= duration_ms or not EDITOR_MIN_MS <= length <= editor_max_ms(g['template']):
            continue
        fields = g.get('fields')
        if not isinstance(fields, dict):
            continue
        clean = clean_fields(g['template'], fields, SAVED_FIELDS)
        if not clean:
            continue
        for key in ('item_ms', 'word_ms', 'cue_ms'):
            times = fields.get(key)
            if isinstance(times, str) and re.fullmatch(r'\d{1,5}(\n\d{1,5}){0,15}', times):
                clean[key] = times
        ids.add(gid)
        out.append({'id': gid, 'template': g['template'], 'at_ms': at, 'duration_ms': length,
                    'placement': g.get('placement') if g.get('placement') in PLACEMENTS else 'top', 'fields': clean, 'origin': 'auto',
                    **({'size': g['size']} if g.get('size') in ('compact', 'card', 'stage') else {})})
    return sorted(out, key=lambda g: g['at_ms'])


def checked_saved_scenes(raw: Any, duration_ms: int) -> list[dict]:
    """Stage scenes read back from a run (source time) for the editor: checked like the editor's (none on any doubt)."""
    if not isinstance(raw, list) or not raw or len(raw) > 60:
        return []
    out = []
    for s in raw:
        if not isinstance(s, dict) or s.get('scene') not in ('stage', 'visual') \
                or s.get('backdrop', 'light') not in ('light', 'dark', 'brand', 'grid', 'gradient', 'solid') or s.get('card', 'rounded') not in ('rounded', 'arch'):
            return []
        a, b = s.get('start_ms'), s.get('end_ms')
        if type(a) is not int or type(b) is not int or a < 0 or b > duration_ms or b - a < 1200 or (out and a < out[-1]['end_ms']):
            return []
        out.append({'scene': s['scene'], 'start_ms': a, 'end_ms': b, **({'backdrop': s['backdrop']} if s.get('backdrop', 'light') != 'light' else {}),
                    **({'card': 'arch'} if s['scene'] == 'stage' and s.get('card') == 'arch' else {})})
    return out


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
