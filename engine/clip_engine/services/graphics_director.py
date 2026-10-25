"""The graphics director: which visual fits what is being said, like a pro editor would pick it.

The planners (auto_graphics for Create, edit_direction for Edit my recording / Combine) ask the model for graphics; this
module is the editor's judgment around that call, all in code and all checked against the words said:

- CUES (find_cues): what kind of moment each sentence is, from the transcript alone: a number (money, a count, a
  percent, a rating), two numbers or "from X to Y" (a trend), steps said out loud, a list of 3-5, a contrast ("instead
  of", "not X, it's Y"), something typed or asked, a named app, a screen, a call to action, and personal story or
  emotion (where an editor shows NOTHING but the face). Each cue names the visuals that fit it (CUE_VISUALS). The
  planner gets them as short hints; the code keeps graphics out of story stretches.
- REGISTER (teaching | story | minimal; the member's `register` setting, else detect_register): how dense the graphics
  are. Teaching: about one per 6.5 s under a minute, one per 10 s up to three minutes; story: about half that;
  minimal: only the hook, numbers and the call to action.
- KINDS: an Effect (`fx`) counts as its own kind ("fx:count-up"), so the variety rules (caps, no repeat within ~25 s,
  enough different kinds) treat effects as distinct visuals. Plain text cards (statement, quote, sticky notes, big
  words) are a fallback: at most about one per 45 s, and only when no richer visual fits their words; the "single most
  important line" effects (headline slam, word rise, center build) at most twice a video.
- ONE LOOK (video_look): one tone per video (light ink on dark, or dark ink on light), every card's look and every
  effect's theme from it, instead of a different card look each time.
- TIMING: an effect's beats land on the spoken words (fx_cue_times -> `cue_ms`), and it holds for its catalog time
  (short punches 1-3 s, frameworks longer while their items are said; nothing static over 8 s).
"""
from __future__ import annotations

import math
import re
from typing import Any, Optional, Sequence

from clip_engine.services import auto_graphics as ag

# ---------------------------------------------------------------------------
# The effects the planner may place (the rest of the 40 stay in the editor's gallery: decorative ones need an eye).
# ---------------------------------------------------------------------------

AUTO_FX = ag.AUTO_FX
NUMBER_FX = ('count-up', 'number-pop-in', 'conic-progress-ring', 'star-rating-fill', 'chart-story', 'decline-chart', 'gauge-dial', 'waffle-chart')
# A share said as a number: the ring, the gauge and the waffle chart take turns (one look per share, not the same dial each time).
SHARE_FX = ('conic-progress-ring', 'gauge-dial', 'waffle-chart')
# The magazine cover: an identity or title moment, at most once a video.
COVER_KINDS = frozenset(('fx:magazine-cover',))
COVER_MAX = 1
# Flanking words ("STEP [speaker] ONE"): only for a numbered step said, and only with the stage up.
STAGE_ONLY_FX = ('flanking-words',)
# "The single most important line": at most SLAM_MAX of these in a whole video (emphasis is spent, not spread).
SLAM_FX = ('headline-slam', 'per-word-rise', 'kinetic-center-build')
# The same family: the type takeover (the line in huge type over the whole frame, the head between its lines).
SLAM_KINDS = frozenset((*(f'fx:{e}' for e in SLAM_FX), 'takeover'))
SLAM_MAX = 2
# Plain text cards: a fallback, at most one per PLAIN_SECONDS of video (at least one). A headline pill, a title and a
# before / after are plain text too (a real planner reaches for them often): like the rest, each first tries an effect its
# words fit (a marker on its key word, a word rise, a line swap) and stays plain only under the cap.
PLAIN = ('statement', 'quote', 'sticky_notes', 'big_words', 'headline_pill', 'title', 'before_after')
PLAIN_SECONDS = 45
# Text cards that try an effect first even when their own caps allow them (the crossed-out list is not plain: it stays
# when no effect fits its words).
CONVERT_FIRST = PLAIN + ('strike_list',)
# Effects that need the speaker to be typing or asking a tool near them.
TYPING_FX = ('typed-prompt', 'typing-indicator')
TYPING_WORDS = frozenset(('type', 'typed', 'typing', 'prompt', 'prompted', 'asked', 'ask', 'message', 'messaged', 'text', 'texted',
                          'wrote', 'write', 'chatgpt', 'claude', 'gpt', 'reply', 'replied', 'search', 'searched', 'google', 'googled'))
REGISTERS = ('teaching', 'story', 'minimal')
# Minimal: the hook, the numbers and the call to action only.
MINIMAL_KINDS = frozenset(('stat', 'headline_pill', 'comment_cta', 'link_cta', 'chapter', *(f'fx:{e}' for e in NUMBER_FX), 'fx:cta-lockup'))
# Never dropped for a story stretch: the call to action and the hook.
STORY_EXEMPT = frozenset(('comment_cta', 'link_cta', 'chapter', 'fx:cta-lockup'))


def kind_of(g: dict) -> str:
    """A graphic's kind for the variety rules: its template, or "fx:<effect>" for an effect."""
    if g.get('template') == 'fx':
        return f"fx:{(g.get('fields') or {}).get('effect', '')}"
    return str(g.get('template'))


def effect_of(kind: str) -> Optional[str]:
    return kind[3:] if kind.startswith('fx:') else None


# ---------------------------------------------------------------------------
# Cues: what kind of moment each sentence is.
# ---------------------------------------------------------------------------

# Which visuals fit a cue, best first (templates, or fx:<effect>).
CUE_VISUALS = {
    'money': ('fx:count-up', 'fx:number-pop-in', 'stat'),
    'count': ('fx:count-up', 'fx:number-pop-in', 'stat'),
    'percent': ('fx:conic-progress-ring', 'fx:gauge-dial', 'fx:waffle-chart', 'fx:count-up', 'stat'),
    'rating': ('fx:star-rating-fill',),
    'trend': ('fx:chart-story', 'fx:mk-line-graph', 'fx:data-chart', 'fx:decline-chart', 'fx:animated-bar-chart'),
    'steps': ('staircase', 'funnel', 'journey', 'fx:flowchart', 'fx:onboarding-stepper-flow', 'fx:state-chip-rail'),
    # A numbered step said ("step one"): the two words huge around the speaker (with the stage up).
    'numbered_step': ('fx:flanking-words',),
    # Who the speaker is or what this is ("I'm a full-time creator"): the frame as a magazine cover (once a video).
    'identity': ('fx:magazine-cover',),
    'list': ('fx:marker-checklist-card', 'fx:state-chip-rail', 'checklist'),
    'contrast': ('fx:strikethrough-replace', 'compare_marks', 'strike_list'),
    'typing': ('fx:typed-prompt', 'fx:typing-indicator'),
    'brand': ('icon_pop',),
    'screen': ('fx:browser-device-stage', 'fx:device-frame-stage', 'browser_frame', 'screen_frame'),
    'cta': ('comment_cta', 'link_cta', 'fx:cta-lockup'),
    # The line the video turns on ("here's the thing: ...", "the truth is ..."): the single most important line.
    'punchline': ('takeover', 'fx:headline-slam', 'fx:per-word-rise'),
    'story': (),
    # Only with the member's own screenshots (place_media): a result shown, a before and after.
    'proof': ('fx:light-sweep-pass', 'fx:device-frame-stage', 'fx:browser-device-stage'),
    'before_after': ('fx:before-after-wipe', 'fx:split-tilt-cards', 'fx:comparison-split'),
}
# What marks the line a video turns on (the punchline): a turn into the point, said out loud.
_PUNCHLINE = (('here\'s', 'the', 'thing'), ('the', 'truth', 'is'), ('the', 'secret', 'is'), ('the', 'real', 'reason'),
              ('nobody', 'tells', 'you'), ('the', 'biggest', 'mistake'), ('if', 'you', 'remember', 'one', 'thing'),
              ('that\'s', 'the', 'whole', 'game'), ('the', 'one', 'thing'), ('this', 'changed', 'everything'),
              ('most', 'people', 'never'), ('stop', 'trying', 'to'),
              # The turn after a setup ("...but that doesn't mean I can't generate sales"), said out loud.
              ('but', 'that', "doesn't", 'mean'), ('but', 'that', 'does', 'not', 'mean'), ('the', 'crazy', 'part'), ('the', 'craziest', 'part'),
              ('the', 'key', 'is'), ('the', 'problem', 'is'), ('the', 'point', 'is'), ('the', 'best', 'part'))
# A punchline line short enough for the takeover's huge type (words).
PUNCHLINE_WORDS = (3, 9)
# The cues whose visual is the member's own picture: offered (as hints and placements) only when they added some.
MEDIA_CUES = ('screen', 'proof', 'before_after')
_PROOF = (('the', 'results'), ('my', 'results'), ('proof',), ('screenshot',), ('look', 'at', 'this'), ('check', 'this', 'out'),
          ('here', 'it', 'is'), ("here's", 'what'), ('this', 'post'), ('this', 'comment'), ('this', 'review'), ('this', 'message'),
          ('they', 'sent'), ('she', 'sent'), ('he', 'sent'), ('went', 'viral'), ('got', 'paid'), ('first', 'sale'), ('payout',))
_BEFORE_AFTER = (('before', 'and', 'after'), ('before',), ('used', 'to', 'look'), ('this', 'is', 'what', 'it', 'looked'))
_AFTER_WORDS = ('after', 'now', 'today', 'became', 'turned', 'into')
_MONEY = re.compile(r'^\$|^(dollars?|bucks|grand|revenue|sales|profit|income|earned|made|spent|paid)$')
_PERCENT_WORDS = ('percent', 'percentage', '%')
_RATING_WORDS = ('stars', 'star', 'rated', 'rating', 'reviews')
_COUNT_NOUNS_AFTER = ('million', 'thousand', 'billion', 'k', 'people', 'users', 'customers', 'clients', 'followers', 'views', 'sales',
                      'students', 'members', 'subscribers', 'times', 'hours', 'days', 'weeks', 'months', 'years', 'videos', 'posts')
_MONTHS = frozenset(('january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
                     'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'))
# "Three things", "two ways": a small count of these announces a framework (steps), not a figure to count up.
_FRAMEWORK_NOUNS = ('things', 'ways', 'steps', 'reasons', 'tips', 'rules', 'pillars', 'mistakes', 'secrets', 'parts', 'stages', 'phases',
                    'questions', 'options', 'types', 'levels', 'lessons', 'keys')
# Opposites said a sentence apart ("a warm audience will buy anything. A cold audience...") make a contrast.
_OPPOSITES = (('warm', 'cold'), ('old', 'new'), ('free', 'paid'), ('organic', 'paid'), ('organic', 'ads'), ('slow', 'fast'), ('hard', 'easy'), ('before', 'after'),
              ('wrong', 'right'), ('manual', 'automatic'), ('cheap', 'expensive'), ('broke', 'profitable'), ('beginner', 'expert'))
_STEP_WORDS = ('step', 'steps', 'phase', 'stage', 'process', 'framework')
# A numbered step: one of these words then a number ("step one", "rule #2", "part three").
_NUMBERED = ('step', 'rule', 'part', 'phase', 'tip', 'lesson', 'day', 'level', 'stage', 'pillar', 'secret', 'mistake')
_ORDINALS = frozenset(('one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'first', 'second', 'third',
                       'fourth', 'fifth', 'last', 'final'))
# An identity or title moment: the speaker says who they are or what this is.
_IDENTITY = (("i'm", 'a'), ("i'm", 'an'), ('i', 'am', 'a'), ('i', 'am', 'an'), ('my', 'name', 'is'), ('welcome', 'to'), ('i', 'became', 'a'),
             ('i', 'became', 'the'), ('they', 'call', 'me'), ('this', 'is', 'the', 'story'), ('meet', 'the'))
_CONTRAST = (('instead', 'of'), ('rather', 'than'), ('not', 'but'), ('wrong', 'way'), ('right', 'way'), ('stop',), ('versus',), ('vs',),
             ('it', "isn't"), ('it', 'is', 'not'), ("it's", 'not'), ('and', 'instead'), ('but', 'instead'), ('but', 'not'),
             ("doesn't", 'mean'), ('does', 'not', 'mean'), ('not', 'nearly'))
_CTA = (('comment',), ('link', 'in', 'bio'), ('the', 'link'), ('click',), ('subscribe',), ('follow', 'me'), ('follow', 'for'), ('dm', 'me'),
        ('send', 'me', 'a'), ('sign', 'up'), ('join',))
_SCREEN = (('website',), ('this', 'page'), ('dashboard',), ('as', 'you', 'can', 'see'), ('on', 'screen'), ('right', 'here'), ('this', 'app'),
           # A page named by what it is (the member's screenshot of it shows there).
           ('sales', 'page'), ('landing', 'page'), ('web', 'page'), ('home', 'page'), ('checkout', 'page'))
# Tools, apps and platforms said by name (an icon pops in; never their logo).
BRANDS = frozenset(('claude', 'chatgpt', 'gpt', 'openai', 'instagram', 'youtube', 'tiktok', 'facebook', 'meta', 'linkedin', 'twitter',
                    'shopify', 'canva', 'notion', 'zapier', 'stripe', 'gmail', 'google', 'slack', 'discord', 'skool', 'whop',
                    'kajabi', 'clickfunnels', 'gohighlevel', 'highlevel', 'capcut', 'figma', 'midjourney', 'gemini', 'perplexity'))
# Personal story and emotion: the face alone.
STORY_MARKERS = (('i', 'remember'), ('when', 'i', 'was'), ('years', 'ago'), ('growing', 'up'), ('back', 'then'), ('i', 'grew', 'up'),
                 ('my', 'mom'), ('my', 'dad'), ('my', 'wife'), ('my', 'husband'), ('my', 'son'), ('my', 'daughter'), ('my', 'family'),
                 ('my', 'kids'), ('my', 'mother'), ('my', 'father'), ('i', 'used', 'to'), ("i'll", 'never', 'forget'), ('one', 'day'),
                 ('that', 'night'), ('i', 'felt'), ('i', 'was', 'so'), ('i', 'realized'), ('at', 'the', 'time'), ('i', 'was', 'broke'))
EMOTION_WORDS = frozenset(('scared', 'afraid', 'terrified', 'cried', 'crying', 'tears', 'heartbroken', 'depressed', 'anxious', 'ashamed',
                           'embarrassed', 'lonely', 'grateful', 'blessed', 'hurt', 'painful', 'divorce', 'funeral', 'died', 'hospital',
                           'panic', 'hated', 'devastated', 'miserable', 'cancer', 'grief', 'heartbreak', 'shame', 'fear'))
FIRST_PERSON = frozenset(('i', "i'm", "i've", "i'd", "i'll", 'my', 'me', 'we', "we're", 'our', 'us'))
STORY_GAP_MS = 1500
STORY_MIN_MS = 3000
# A list item said between commas: this many words at most.
LIST_ITEM_WORDS = 4


def _sentences(segments: Sequence) -> list[list[dict]]:
    """The timed words said, as sentences (a sentence-ending word or a pause starts the next one)."""
    words = ag._spoken(segments)
    out: list[list[dict]] = []
    for w in words:
        if w['first'] or not out:
            out.append([])
        out[-1].append(w)
    return [s for s in out if s]


def _has(toks: Sequence[str], phrase: Sequence[str]) -> Optional[int]:
    n = len(phrase)
    for i in range(len(toks) - n + 1):
        if tuple(toks[i:i + n]) == tuple(phrase):
            return i
    return None


def _number_spans(sentence: list[dict]) -> list[tuple[int, str]]:
    """(word position, kind) of each number said in the sentence: money, percent, rating or count."""
    out = []
    toks = [w['tok'] for w in sentence]
    for i, w in enumerate(sentence):
        raw = w['raw'].strip().lower()
        if not (ag._HAS_DIGIT.search(raw) or (w['tok'] in ag.NUMBER_WORDS and i + 1 < len(toks) and toks[i + 1] in _COUNT_NOUNS_AFTER)
                or w['tok'] in ('hundred', 'thousand', 'million', 'billion') and (not out or out[-1][0] < i - 2)):
            continue
        if out and out[-1][0] >= i - 1:
            continue  # "3 million": one number
        near = toks[max(0, i - 2):i + 3]
        if '%' in raw or any(t in _PERCENT_WORDS for t in near):
            kind = 'percent'
        elif any(t in _RATING_WORDS for t in near) and re.fullmatch(r'[0-5](?:\.\d)?', raw.strip('.,')):
            kind = 'rating'
        elif raw.startswith('$') or any(_MONEY.match(t) for t in near):
            kind = 'money'
        else:
            # A bare "one", "two" (a step number, "number three") isn't a figure worth a graphic; nor is "three things" (a
            # framework announced: find_cues makes it a steps cue).
            if not ag._HAS_DIGIT.search(raw) and w['tok'] in ag.NUMBER_WORDS and (i and toks[i - 1] in ('step', 'number', 'tip', 'part')):
                continue
            if _framework_count(toks, i):
                continue
            # A date ("October 20th", "the 3rd") is not a figure.
            if re.fullmatch(r'\d{1,2}(st|nd|rd|th)[.,!?]?', raw) or (i and toks[i - 1] in _MONTHS):
                continue
            kind = 'count'
        out.append((i, kind))
    return out


def _framework_count(toks: Sequence[str], i: int) -> bool:
    """Token `i` is a small count announcing a framework ("three things", "2 ways", "two different ways")."""
    tok = toks[i].strip('.,!?')
    small = tok in ag.NUMBER_WORDS or (tok.isdigit() and 1 < int(tok) <= 10)
    return small and any(t in _FRAMEWORK_NOUNS for t in toks[i + 1:i + 3])


def number_value(sentence: list[dict], pos: int) -> str:
    """The number said at word `pos` as shown ("$8,188", "1,400", "3 million"), its scale word joined when said after it."""
    raw = sentence[pos]['raw'].strip().strip('.,!?;:"“”')
    nxt = sentence[pos + 1]['tok'] if pos + 1 < len(sentence) else ''
    if nxt in ('million', 'thousand', 'billion') and sentence[pos + 1]['raw'] != sentence[pos]['raw']:
        raw = f"{raw} {nxt}"
    return raw


def _list_items(sentence: list[dict]) -> list[str]:
    """Short parallel items said between commas ("emails, calls and meetings"): 3-5 of them, or []."""
    items, current = [], []
    for w in sentence:
        current.append(w['raw'].strip())
        raw = w['raw'].strip()
        if raw.endswith(',') or w['tok'] in ('and', 'or') and current[:-1]:
            if w['tok'] in ('and', 'or') and not raw.endswith(','):
                current.pop()
            items.append(' '.join(current).strip(' ,'))
            current = []
    if current:
        items.append(' '.join(current).strip(' ,.!?'))
    items = [i for i in items if i]
    # The items are the short run in the middle (the sentence's lead-in is longer).
    run: list[str] = []
    best: list[str] = []
    for item in items:
        if 1 <= len(item.split()) <= LIST_ITEM_WORDS:
            run.append(item)
            best = run if len(run) > len(best) else best
        else:
            run = []
    if 3 <= len(best) <= 5:
        # The first item carries the lead-in ("You need emails"): as long as the others at most.
        most = max(len(x.split()) for x in best[1:])
        if len(best[0].split()) > most:
            best = [' '.join(best[0].split()[-most:]), *best[1:]]
        return best
    return []


def numbered_step(sentence: list[dict]) -> Optional[tuple[int, str]]:
    """(when, "step one") for a numbered step said in the sentence (a step word, then a number or ordinal), else None."""
    for i, w in enumerate(sentence[:-1]):
        nxt = sentence[i + 1]
        num = nxt['tok'].lstrip('#')
        if w['tok'] in _NUMBERED and (num in _ORDINALS or (num.isdigit() and 0 < int(num) <= 20)):
            return int(w['start']), f"{w['raw'].strip(' ,.!?:;')} {nxt['raw'].strip(' ,.!?:;')}"
    return None


def is_story(sentence: list[dict]) -> bool:
    """A personal story or emotional line: first person, and a story marker ("I remember", "my dad", "years ago") or an
    emotion word, with no money or percent said (a result said is proof, not story)."""
    toks = [w['tok'] for w in sentence]
    if not any(t in FIRST_PERSON for t in toks):
        return False
    if any(kind in ('money', 'percent') for _, kind in _number_spans(sentence)):
        return False
    return any(_has(toks, m) is not None for m in STORY_MARKERS) or any(t in EMOTION_WORDS for t in toks)


def _said_text(sentence: list[dict], first: int = 0, count: Optional[int] = None) -> str:
    """The words as said from token `first` on (`count`: at most that many words): one word said once, even when it reads
    as several tokens ("$4,365" is the tokens 4 and 365, "can't-miss" two)."""
    out: list[str] = []
    previous = None
    for w in sentence[first:]:
        key = (w['start'], w['raw'])
        if key == previous:
            continue
        previous = key
        if count is not None and len(out) == count:
            break
        out.append(w['raw'].strip())
    return ' '.join(out)


def _clip_words(text: str, limit: int) -> str:
    """`text` cut to at most `limit` characters at a word boundary (an ellipsis when cut)."""
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(' ', 1)[0] if ' ' in text[:limit] else text[:limit]
    return cut.rstrip(' ,.;:') + '…'


def find_cues(segments: Sequence) -> list[dict]:
    """What kind of moment each sentence is: [{'kind', 'at_ms', 'end_ms', 'text', 'prefer'}] in time order. A sentence
    may carry several cues (a number and a list); story stretches are merged ('story', at least 3 s)."""
    cues: list[dict] = []
    stories: list[list[int]] = []
    steps_seen = 0
    marker_at = {m['at'] for m in ag._family(ag._markers(ag._spoken(segments)))}
    index = 0
    previous: list[str] = []
    for sentence in _sentences(segments):
        toks = [w['tok'] for w in sentence]
        start, end = sentence[0]['start'], sentence[-1]['end']
        text = _said_text(sentence)

        def add(kind: str, at: int, what: str = '', **extra: Any) -> None:
            cues.append({'kind': kind, 'at_ms': int(at), 'end_ms': int(end), 'text': (what or text)[:90], 'prefer': CUE_VISUALS[kind],
                         'sentence': text, **extra})

        if is_story(sentence):
            if stories and start - stories[-1][1] <= STORY_GAP_MS:
                stories[-1][1] = end
            else:
                stories.append([start, end])
            index += len(sentence)
            continue
        numbers = _number_spans(sentence)
        # (One cue per number said: "$8,188" reads as two tokens of one word.)
        numbers = [(pos, kind) for k, (pos, kind) in enumerate(numbers) if not k or sentence[pos]['start'] != sentence[numbers[k - 1][0]]['start']]
        for pos, kind in numbers:
            add(kind, sentence[pos]['start'], _said_text(sentence, max(0, pos - 1), 4), value=number_value(sentence, pos))
        if len(numbers) >= 2 or (_has(toks, ('from',)) is not None and _has(toks, ('to',)) is not None and numbers):
            add('trend', sentence[numbers[0][0]]['start'] if numbers else start)
        framework = next((k for k in range(len(toks)) if _framework_count(toks, k)), None)
        if any(index + k in marker_at for k in range(len(sentence))) or any(t in _STEP_WORDS for t in toks) or framework is not None:
            steps_seen += 1
            add('steps', sentence[framework]['start'] if framework is not None else start)
        step = numbered_step(sentence)
        if step:
            add('numbered_step', step[0], step[1])
        if any(_has(toks, p) is not None for p in _IDENTITY):
            add('identity', start)
        items = _list_items(sentence)
        if items:
            add('list', start, ', '.join(items))
        contrast = False
        for phrase in _CONTRAST:
            at = _has(toks, phrase)
            if at is not None and (phrase != ('not', 'but') or 'but' in toks[at:]):
                add('contrast', sentence[at]['start'])
                contrast = True
                break
        if not contrast:
            # Opposites a sentence apart ("a warm audience..." then "a cold audience..."): the second one turns it.
            here = set(toks)
            hit = next(((a, b) for a, b in _OPPOSITES if (a in here and b in previous) or (b in here and a in previous)), None)
            if hit:
                word = hit[0] if hit[0] in here else hit[1]
                add('contrast', next(w['start'] for w in sentence if w['tok'] == word))
        previous = toks
        if any(t in TYPING_WORDS for t in toks) and any(t in ('typed', 'prompt', 'asked', 'type', 'typing', 'message', 'messaged') for t in toks):
            add('typing', start)
        named = [w for w in sentence if w['tok'] in BRANDS]
        if named:
            add('brand', named[0]['start'], ', '.join(dict.fromkeys(w['raw'].strip(' ,.!?') for w in named)))
        if any(_has(toks, p) is not None for p in _SCREEN) or any('.com' in w['raw'].lower() for w in sentence):
            add('screen', start)
        if any(_has(toks, p) is not None for p in _CTA):
            add('cta', start)
        punch = punch_clause(sentence)
        if punch:
            add('punchline', punch[0], punch[1])
        if any(_has(toks, p) is not None for p in _PROOF):
            add('proof', start)
        if any(_has(toks, p) is not None for p in _BEFORE_AFTER) and any(t in _AFTER_WORDS for t in toks):
            add('before_after', start)
        index += len(sentence)
    for a, b in stories:
        if b - a >= STORY_MIN_MS:
            cues.append({'kind': 'story', 'at_ms': int(a), 'end_ms': int(b), 'text': '', 'prefer': ()})
    return sorted(cues, key=lambda c: (c['at_ms'], c['kind']))


def punch_clause(sentence: list[dict]) -> Optional[tuple[int, str]]:
    """The line a video turns on (a _PUNCHLINE phrase said), short enough for the takeover's huge type: the sentence
    when it is PUNCHLINE_WORDS long, else the clause (between commas) the phrase starts, when that is. (start ms, words
    as said) or None."""
    toks = [w['tok'] for w in sentence]
    at = min((i for i in (_has(toks, p) for p in _PUNCHLINE) if i is not None), default=None)
    if at is None:
        return None
    lo, hi = PUNCHLINE_WORDS
    if lo <= len(sentence) <= hi:
        return sentence[0]['start'], _said_text(sentence)
    # The clause: from the last comma before the phrase to the next comma after it.
    first = max((i + 1 for i in range(at) if sentence[i]['raw'].rstrip().endswith((',', ';', ':'))), default=0)
    last = next((i for i in range(at, len(sentence)) if sentence[i]['raw'].rstrip().endswith((',', ';', ':', '.', '!', '?'))), len(sentence) - 1)
    text = _said_text(sentence[:last + 1], first).strip(' ,;:')
    if not lo <= len(text.split()) <= hi:
        return None
    return sentence[first]['start'], text


def story_spans(cues: Sequence[dict]) -> list[tuple[int, int]]:
    return [(c['at_ms'], c['end_ms']) for c in cues if c['kind'] == 'story']


def in_story(g: dict, spans: Sequence[tuple[int, int]]) -> bool:
    """Half or more of the graphic plays during a personal story (the face stays alone there)."""
    a, b = g['at_ms'], g['at_ms'] + g['duration_ms']
    inside = sum(max(0, min(b, hi) - max(a, lo)) for lo, hi in spans)
    return inside >= 0.5 * max(1, b - a)


def cue_hints(segments: Sequence, limit: int = 40, label: Any = None, media: bool = False) -> str:
    """The cues as short planner hints, one per line ("12.4s money "$2,586 in sales" -> fx:count-up, stat"); `label(ms)`
    names a moment differently (Edit: the word index). Empty when there are none. The member's own screenshots go where a
    screen, a proof or a before and after is said (`media`: they added some; place_media puts them there, not the model)."""
    lines = []
    for c in find_cues(segments):
        if c['kind'] in ('proof', 'before_after') and not media:
            continue
        if media and c['kind'] in MEDIA_CUES:
            where = label(c['at_ms']) if label else f"{c['at_ms'] / 1000:.1f}s"
            lines.append(f'{where} {c["kind"]} "{_clip_words(c["text"], 50)}" -> the member\'s screenshot (added by the app: leave this moment free)')
            if len(lines) >= limit:
                break
            continue
        where = label(c['at_ms']) if label else f"{c['at_ms'] / 1000:.1f}s"
        if c['kind'] == 'story':
            end = label(c['end_ms']) if label else f"{c['end_ms'] / 1000:.1f}s"
            lines.append(f'{where}-{end} story/emotion -> NO graphic (face only)')
        else:
            # (The picture effects are never the model's to place.)
            prefer = [p for p in c['prefer'] if effect_of(p) not in ag.MEDIA_FX]
            lines.append(f'{where} {c["kind"]} "{_clip_words(c["text"], 50)}" -> {", ".join(prefer)}')
        if len(lines) >= limit:
            break
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Register: how dense the graphics are.
# ---------------------------------------------------------------------------

def clean_register(value: Any) -> Optional[str]:
    return value if value in REGISTERS else None


def detect_register(cues: Sequence[dict], total_ms: float) -> str:
    """'story' when personal stretches fill much of the video and little is taught; else 'teaching'."""
    if total_ms <= 0:
        return 'teaching'
    story = sum(c['end_ms'] - c['at_ms'] for c in cues if c['kind'] == 'story')
    taught = sum(1 for c in cues if c['kind'] in ('money', 'count', 'percent', 'rating', 'trend', 'steps', 'list', 'contrast', 'typing'))
    return 'story' if story / total_ms >= 0.4 and taught < total_ms / 20000 else 'teaching'


def seconds_per_graphic(register: str, seconds: float) -> float:
    """About one graphic per this many seconds: teaching 6.5 s under a minute, 10 s up to three minutes, 10.5 s past
    that; a story about half as many; minimal only the few moments it allows (a cap of one per 15 s)."""
    teaching = 6.5 if seconds <= 60 else 10.0 if seconds <= 180 else 10.5
    return {'teaching': teaching, 'story': teaching * 2, 'minimal': 15.0}.get(register, teaching)


def register_allows(kind: str, register: str) -> bool:
    return register != 'minimal' or kind in MINIMAL_KINDS


# ---------------------------------------------------------------------------
# Group caps: plain text cards and the "one most important line" effects.
# ---------------------------------------------------------------------------

def plain_cap(seconds: float) -> int:
    return max(1, round(max(0.0, seconds) / PLAIN_SECONDS))


def group_allows(kind: str, kept: Sequence[dict], seconds: float) -> bool:
    if kind in PLAIN:
        return sum(1 for k in kept if kind_of(k) in PLAIN) < plain_cap(seconds)
    if kind in SLAM_KINDS:
        return sum(1 for k in kept if kind_of(k) in SLAM_KINDS) < SLAM_MAX
    if kind in COVER_KINDS:
        return sum(1 for k in kept if kind_of(k) in COVER_KINDS) < COVER_MAX
    return True


# ---------------------------------------------------------------------------
# One look per video.
# ---------------------------------------------------------------------------

TONES = ('dark', 'light')
# The card look of each template in each tone (motion-graphics.ts GRAPHIC_VARIANTS): light ink on dark glass or color,
# or dark ink on white.
TONE_VARIANTS = {
    'dark': {'statement': 'glass', 'title': 'shadow', 'quote': 'dark', 'sticky_notes': 'polaroid', 'list': 'pills', 'checklist': 'dark',
             'stat': 'gradient'},
    'light': {'statement': 'card', 'title': 'card', 'quote': 'card', 'sticky_notes': 'notes', 'list': 'card', 'checklist': 'card',
              'stat': 'card'},
}


def video_look(options: Optional[dict]) -> dict:
    """The video's one look: {'tone'} from the member's choice (options['tone']), else light ink on dark (it reads over
    any footage)."""
    tone = (options or {}).get('tone')
    return {'tone': tone if tone in TONES else 'dark'}


def with_look(graphics: Sequence[dict], look: dict) -> list[dict]:
    """Every automatic card in the video's tone (a look the member picked stays); every effect themed the same way."""
    tone = look.get('tone', 'dark')
    out = []
    for g in graphics:
        t, fields = g['template'], g['fields']
        if t in TONE_VARIANTS[tone] and fields.get('variant') not in ag.VARIANTS.get(t, ()):
            fields = {**fields, 'variant': TONE_VARIANTS[tone][t]}
        elif t == 'fx' and fields.get('theme') not in TONES:
            fields = {**fields, 'theme': tone}
        elif t in THEMED and fields.get('theme') not in TONES:
            fields = {**fields, 'theme': tone}
        out.append({**g, 'fields': fields})
    return out


# Text templates whose classic look is a white card: the video's tone travels with them as `theme` (the renderer draws
# 'dark' on dark glass with light ink; text-fit.ts).
THEMED = ('lower_third', 'before_after', 'strike_list', 'headline_pill', 'comment_cta')
# On a light stage (the stage backdrops are light at the top) a white card would sit white on near-white: the stage takes
# the dark looks, and words with no card take dark ink.
STAGE_LOOKS = {'statement': 'glass', 'quote': 'dark', 'title': 'pill', 'list': 'pills', 'checklist': 'dark', 'stat': 'gradient'}
LIGHT_BACKDROPS = ('light', 'brand', 'grid', 'gradient')


def on_light_stage(g: dict) -> dict:
    """`g` as it reads on a light stage: a dark look (or the dark theme) for a white card, dark ink for words with no card.
    A look the member picked stays."""
    t, fields = g['template'], g['fields']
    if t in STAGE_LOOKS and fields.get('variant') in (None, '', 'card', 'shadow', 'notes', 'rows', 'chips'):
        return {**g, 'fields': {**fields, 'variant': STAGE_LOOKS[t]}}
    if t in THEMED:
        return {**g, 'fields': {**fields, 'theme': 'dark'}}
    if t == 'big_words':
        return {**g, 'fields': {**fields, 'theme': 'light'}}
    return g


# ---------------------------------------------------------------------------
# Effects: fields from the planner, sanity, words said, cue times and holds.
# ---------------------------------------------------------------------------

def fx_field_keys() -> list[str]:
    keys: list[str] = []
    for effect in AUTO_FX:
        for f in (ag.fx_catalog().get(effect) or {}).get('fields', []):
            if f['key'] not in keys:
                keys.append(f['key'])
    return keys


def fx_raw_fields(item: dict) -> dict:
    """The planner's effect fields (`fx_fields`: [{key, value}], else the same-named top-level fields) as a flat dict."""
    raw: dict[str, Any] = {'effect': item.get('effect')}
    pairs = item.get('fx_fields')
    if isinstance(pairs, list):
        for p in pairs[:16]:
            if isinstance(p, dict) and isinstance(p.get('key'), str) and isinstance(p.get('value'), (str, int, float)) and not isinstance(p.get('value'), bool):
                raw[p['key']] = p['value']
    elif isinstance(pairs, dict):
        raw.update({k: v for k, v in pairs.items() if isinstance(k, str)})
    effect = ag.fx_catalog().get(item.get('effect')) if isinstance(item.get('effect'), str) else None
    for f in (effect or {}).get('fields', []):
        if f['key'] not in raw and isinstance(item.get(f['key']), (str, list)) and item.get(f['key']):
            raw[f['key']] = item[f['key']]
    for key in ('backing', 'theme'):
        if item.get(key) is not None:
            raw[key] = item[key]
    return raw


def _num(text: str) -> Optional[float]:
    m = re.search(r'-?\d[\d,]*(?:\.\d+)?', text or '')
    try:
        return float(m.group(0).replace(',', '')) if m else None
    except ValueError:
        return None


def waffle_share(figure: str) -> Optional[float]:
    """The share (0-100) a waffle chart's figure says: "1 in 10" / "3 out of 4" / "2 of 5" or a percent ("90%", "90 percent");
    None when no number is said ("most" is not a number)."""
    text = (figure or '').lower()
    m = re.search(r'(\d+(?:\.\d+)?)\s*(?:in|out\s+of|of)\s*(\d+(?:\.\d+)?)', text)
    if m and float(m.group(2)) > 0:
        return float(m.group(1)) / float(m.group(2)) * 100
    m = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(?:%|percent)?\s*', text)
    return float(m.group(1)) if m else None


def fx_sane(fields: dict) -> bool:
    """An effect whose own fields make sense: a rating 0-5, a percent 0-100, a drop that drops, a chart with two
    numbers, a marked word inside its line."""
    e = fields.get('effect')
    if e == 'star-rating-fill':
        r = _num(fields.get('rating', ''))
        return r is not None and 0 < r <= 5
    if e == 'conic-progress-ring':
        p = _num(fields.get('progress', ''))
        return p is not None and 0 < p <= 100
    if e == 'gauge-dial':
        v, top = _num(fields.get('value', '')), _num(fields.get('max', '')) or 100.0
        return v is not None and top > 0 and 0 < v <= top
    if e == 'waffle-chart':
        share = waffle_share(fields.get('figure', ''))
        return share is not None and 0 < share <= 100
    if e == 'flanking-words':
        pair = [line.strip() for line in fields.get('words', '').split('\n') if line.strip()]
        return len(pair) == 2 and all(1 <= len(p.split()) <= 2 for p in pair)
    if e == 'magazine-cover':
        lines = [line.strip() for line in fields.get('lines', '').split('\n') if line.strip()]
        return 1 <= len(fields.get('masthead', '').split()) <= 2 and 2 <= len(lines) <= 3 and all(len(x.split()) <= 6 for x in lines)
    if e == 'decline-chart':
        a, b = _num(fields.get('start', '')), _num(fields.get('end', ''))
        return a is not None and b is not None and a > b
    if e == 'chart-story':
        return sum(1 for line in fields.get('data', '').split('\n') if _num(line) is not None) >= 2
    if e in ('count-up', 'number-pop-in'):
        # "Two ways", "three things": a small count announcing a framework is not a figure to count up (show the steps).
        unit = ' '.join(ag._tokens(' '.join(fields.get(k, '') for k in ('unit', 'suffix')))).split()
        return not (unit and unit[0] in _FRAMEWORK_NOUNS)
    if e in ('marker-highlight', 'vox-annotate'):
        return ag.accent_inside(fields.get('text', ''), fields.get('word', ''))
    if e in ('data-chart', 'mk-line-graph', 'animated-bar-chart'):
        # Numbers for every bar or point (three at least for a chart or a line), no more labels than numbers.
        data = [line for line in fields.get('data', '').split('\n') if line.strip()]
        labels = [line for line in fields.get('labels', '').split('\n') if line.strip()]
        least = 2 if e == 'animated-bar-chart' else 3
        return least <= len(data) <= 8 and all(_num(line) is not None for line in data) and len(labels) <= len(data) \
            and (e != 'animated-bar-chart' or _num(fields.get('value', '')) is not None)
    if e in ('flowchart', 'onboarding-stepper-flow'):
        steps = [line for line in fields.get('steps', '').split('\n') if line.strip()]
        return 2 <= len(steps) <= (6 if e == 'flowchart' else 5)
    if e in ag.MEDIA_FX:
        # A picture effect shows the member's own pictures: never placed without them.
        effect = ag.fx_catalog().get(e) or {}
        return all(fields.get(f['key']) for f in effect.get('fields', []) if f['kind'] == 'image' and f['required'])
    return True


# Short units on a number ("10x", "3k", "$", "%"): said as the unit, a word for it, or stuck to the number.
UNIT_WORDS = {'x': ('x', 'times'), 'k': ('k', 'thousand', 'grand'), 'm': ('m', 'million'), 'b': ('b', 'billion'), 'h': ('h', 'hours', 'hour'),
              'hrs': ('hours',), 'mins': ('minutes',), 'min': ('minutes', 'minute'), 'd': ('days', 'day'), 'yrs': ('years',)}
UNIT_FIELDS = ('prefix', 'suffix', 'unit')


def unit_said(fields: dict, heard: set[str]) -> bool:
    """An effect's number units are said ("10x": "ten x", "10 times" or "10x")."""
    for key in UNIT_FIELDS:
        for tok in ag._tokens(fields.get(key, '')):
            if ag._HAS_DIGIT.search(tok):
                return False
            if ag._said(tok, heard) or any(w in heard for w in UNIT_WORDS.get(tok, ())):
                continue
            if any(h.endswith(tok) and ag._HAS_DIGIT.search(h) for h in heard):
                continue
            return False
    return True


def fx_cue_units(fields: dict) -> list[str]:
    """The words (or items) an effect is timed to, in order (fx-catalog.ts fxCueUnits)."""
    effect = ag.fx_catalog().get(fields.get('effect'))
    cue = (effect or {}).get('cue')
    if not cue:
        return []
    value = fields.get(cue['field'], '')
    if cue['unit'] == 'item':
        return [line for line in value.split('\n') if line.strip()]
    words = value.split()
    return words if cue.get('cues') else words[:1]


def fx_cue_times(g: dict, segments: Sequence, window_ms: int = ag.STRICT_WINDOW_MS) -> Optional[list[int]]:
    """When each of an effect's cue words (or items) is said, in order (source ms); None when it has no cue or they
    aren't all said near it."""
    units = fx_cue_units(g['fields'])
    if not units:
        return None
    effect = ag.fx_catalog().get(g['fields'].get('effect')) or {}
    cue = effect.get('cue', {})
    line = g['fields'].get(cue.get('field', ''), '')
    if cue.get('unit') == 'word' and ag._words(line):
        # The words of one line: said together, in order (the run closest to the effect); its first word, or each one.
        spans = ag.word_spans({'template': 'title', 'at_ms': g['at_ms'], 'duration_ms': g['duration_ms'], 'fields': {'text': line}},
                              segments, window_ms)
        if spans:
            return [a for a, _ in spans][:len(units)]
        if len(units) > 1:
            return None
    probe = {'template': 'list', 'at_ms': g['at_ms'], 'duration_ms': g['duration_ms'], 'fields': {'items': '\n'.join(units)}}
    if all(ag._words(u) for u in units):
        return ag.item_times(probe, segments, window_ms)
    # A number cue ("4,215"): when that number is said.
    at = g['at_ms']
    want = ag._numbers(units[0])
    for w in ag._spoken(segments):
        if at - window_ms <= w['start'] <= at + g['duration_ms'] + window_ms and want and ag._numbers(w['raw']) and \
                abs(ag._numbers(w['raw'])[0] - want[0]) <= 1e-6 * max(1.0, abs(want[0])):
            return [w['start']]
    for w in ag._spoken(segments):
        if at - window_ms <= w['start'] <= at + g['duration_ms'] + window_ms and want and ag._numbers(w['raw']):
            return [w['start']]
    return None


def fx_words_ok(g: dict, segments: Sequence) -> bool:
    """An effect's extra checks beyond every said word being said near it: its fields make sense, its units are said,
    its list items are said in order, and a typing effect comes while the speaker talks about typing or asking."""
    fields = g['fields']
    if not fx_sane(fields):
        return False
    at, length = g['at_ms'], g['duration_ms']
    heard = {w for w, _ in ag._timed_words(segments, at - ag.STRICT_WINDOW_MS, at + length + ag.STRICT_WINDOW_MS)}
    if not unit_said(fields, heard):
        return False
    if fields.get('effect') in TYPING_FX and not heard & TYPING_WORDS:
        return False
    if fields.get('effect') == 'flanking-words':
        # A numbered step said: its words are the step word and its number ("Step" / "One").
        pair = [line.strip().lower() for line in fields.get('words', '').split('\n') if line.strip()]
        if not (pair and pair[0].split()[0].strip('#') in _NUMBERED and (pair[-1].lstrip('#') in _ORDINALS or pair[-1].lstrip('#').isdigit())):
            return False
    if fields.get('effect') == 'magazine-cover':
        # An identity or title moment said near it.
        spoken = [w for w in ag._spoken(segments) if at - ag.STRICT_WINDOW_MS <= w['start'] <= at + length + ag.STRICT_WINDOW_MS]
        toks = [w['tok'] for w in spoken]
        if not any(_has(toks, p) is not None for p in _IDENTITY):
            return False
    if fields.get('effect') == 'waffle-chart' and not ag._HAS_DIGIT.search(fields.get('figure', '')):
        return False
    effect = ag.fx_catalog().get(fields.get('effect')) or {}
    for f in effect.get('fields', []):
        if f['kind'] == 'list' and f['said'] and fields.get(f['key']) and any(ag._words(x) for x in fields[f['key']].split('\n')):
            probe = {'template': 'list', 'at_ms': at, 'duration_ms': length, 'fields': {'items': fields[f['key']]}}
            if ag.item_times(probe, segments) is None:
                return False
    return True


def fx_hold_ms(effect_id: str) -> int:
    effect = ag.fx_catalog().get(effect_id) or {}
    return int(round(float(effect.get('hold_s') or 3) * 1000))


# A list effect stays this long after its last item; a single-beat one leads its beat by at most FX_MAX_LEAD_MS.
FX_TAIL_MS = 1400
FX_MAX_LEAD_MS = 1800
FX_DEFAULT_LEAD_MS = 250
# A line shown whole before its beat (a marker, a swap's second line) starts at most this long before the beat.
FX_LINE_LEAD_MS = 6000


def fx_timed(g: dict, segments: Sequence) -> dict:
    """An effect placed on its spoken words: it starts so its main beat lands on the first cue word (its sync point
    before it), and holds its catalog time, or until a little after its last item is said (never over 8 s)."""
    times = fx_cue_times(g, segments)
    effect = ag.fx_catalog().get(g['fields'].get('effect')) or {}
    hold = fx_hold_ms(effect.get('id', ''))
    if not times:
        return {**g, 'duration_ms': int(max(ag.EDITOR_MIN_MS, min(ag.EDITOR_MAX_MS, max(hold, min(g['duration_ms'], hold + 1500)))))}
    lead = min(FX_MAX_LEAD_MS, int(float(effect.get('sync_s') or 0) * 1000)) or FX_DEFAULT_LEAD_MS
    at = max(0, times[0] - lead)
    # A line shown whole before its beat ("Most coaches lose clients", then the marker on "clients") starts on its first word.
    first = next((g['fields'].get(f['key'], '') for f in effect.get('fields', []) if f['said'] and f['kind'] == 'text' and g['fields'].get(f['key'])), '')
    if first and effect.get('cue', {}).get('field') != next((f['key'] for f in effect.get('fields', []) if f['said'] and g['fields'].get(f['key'])), None):
        said = ag.spoken_start({'template': 'title', 'at_ms': g['at_ms'], 'duration_ms': g['duration_ms'], 'fields': {'text': first}}, segments)
        if said is not None and times[0] - FX_LINE_LEAD_MS <= said < at:
            at = max(0, said - FX_DEFAULT_LEAD_MS // 2)
    end = max(at + hold, times[-1] + (FX_TAIL_MS if len(times) > 1 else hold - lead if hold > lead else 800))
    return {**g, 'at_ms': int(at), 'duration_ms': int(max(ag.EDITOR_MIN_MS, min(ag.EDITOR_MAX_MS, end - at)))}


def fx_cue_ms(g: dict, segments: Sequence) -> Optional[str]:
    """`cue_ms` for an effect (ms into it, in order, inside it), or None."""
    times = fx_cue_times(g, segments)
    if not times:
        return None
    rel = [max(0, min(g['duration_ms'] - 300, t - g['at_ms'])) for t in times]
    if any(b < a for a, b in zip(rel, rel[1:])):
        return None
    return '\n'.join(str(int(t)) for t in rel)


# ---------------------------------------------------------------------------
# Turning a card into an effect its own words fit (and back).
# ---------------------------------------------------------------------------

_STOP = frozenset(('the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'it', 'its', "it's", 'that', 'this', 'with',
                   'you', 'your', 'we', 'i', 'my', 'our', 'are', 'was', 'be', 'just', 'so', 'but', 'at', 'as', 'by', 'from', 'all',
                   # Filler a marker should never land on.
                   'going', 'gonna', 'about', 'actually', 'really', 'there', 'their', "there's", 'these', 'those', 'what', 'when', 'where',
                   'which', 'would', 'could', 'should', 'have', 'been', 'being', 'into', 'only', 'nearly', 'enough', 'because', 'even',
                   'every', 'something', 'anything', 'everything', 'thing', 'things', 'know', 'want', 'need', 'make', 'made', 'like',
                   'some', 'more', 'most', 'very', 'much', 'many', 'than', 'then', 'they', 'them', 'were', 'will', 'does', "doesn't",
                   "don't", "can't", 'cannot', 'when', 'comes', 'come', 'here', 'right', 'now', 'that\'s', 'today', 'tonight'))


def key_word(line: str, accent: str = '') -> str:
    """The word that carries a line: its accent when that sits inside it, else its longest real word."""
    if accent and ag.accent_inside(line, accent) and 1 <= len(accent.split()) <= 3:
        return accent
    words = [w.strip('.,!?;:"“”') for w in line.split()]
    # A real word (no contraction: "we're" carries nothing), four letters or more, not filler.
    words = [w for w in words if len(re.sub(r'[^A-Za-z]', '', w)) >= 4 and w.lower() not in _STOP and "'" not in w and '’' not in w]
    return max(words, key=len) if words else ''


def _split_number(value: str) -> Optional[tuple[str, str, str]]:
    """A stat's value as (prefix, number, suffix): "$4,215" -> ("$", "4,215", ""), "3 million" -> ("", "3", " million")."""
    m = re.fullmatch(r'\s*([$€£]?)\s*(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z%+]{0,10}(?: [A-Za-z]{1,10})?)\s*', value or '')
    if not m:
        return None
    suffix = m.group(3)
    return m.group(1), m.group(2), (f' {suffix}' if suffix and suffix[0].isalpha() and len(suffix) > 1 else suffix)


def share_of(g: dict) -> Optional[tuple[str, str]]:
    """A percent a graphic shows (a ring, a gauge in percent, a waffle chart, a stat or count up in percent) as (number, its
    figure "72%"), or None."""
    t, f = g['template'], g['fields']
    e = f.get('effect') if t == 'fx' else None
    value: Optional[float] = None
    if e == 'conic-progress-ring':
        value = _num(f.get('progress', ''))
    elif e == 'gauge-dial' and (_num(f.get('max', '')) or 100.0) == 100 and f.get('unit', '%') in ('%', ''):
        value = _num(f.get('value', ''))
    elif e == 'waffle-chart':
        value = waffle_share(f.get('figure', ''))
        if value is not None and '%' not in f.get('figure', '') and 'percent' not in f.get('figure', '').lower():
            # "1 in 10" stays a waffle (the ring would show a percent that was never said).
            return None
    elif (t == 'stat' and '%' in f.get('value', '')) or (e == 'count-up' and f.get('suffix', '').strip() == '%'):
        value = _num(f.get('value', ''))
    if value is None or not 0 < value <= 100:
        return None
    number = f'{value:g}'
    return number, f'{number}%'


def to_fx(g: dict, effect: str) -> Optional[dict]:
    """`g` as effect `effect`, with its own words (None when they don't fit it)."""
    t, f = g['template'], g['fields']
    line = ag._line_of(g)
    words = ag._plain_words(line)
    items = ag._items_of(g)
    fields: dict[str, str] = {'effect': effect}
    if effect == 'marker-highlight':
        word = key_word(line, f.get('accent', '') if t == 'statement' else f.get('phrase', '') if t == 'headline_pill' else '')
        if not 3 <= len(words) <= 14 or not word:
            return None
        fields.update(text=line, word=word)
    elif effect == 'headline-slam':
        if not 2 <= len(words) <= 5:
            return None
        fields['text'] = line
    elif effect == 'kinetic-center-build':
        if not 2 <= len(words) <= 6:
            return None
        fields['text'] = line
    elif effect == 'per-word-rise':
        if not 2 <= len(words) <= 9:
            return None
        fields['text'] = line
    elif effect == 'text-stagger':
        if not 2 <= len(words) <= 8:
            return None
        fields['text'] = line
    elif effect == 'state-chip-rail':
        if not 2 <= len(items) <= 5 or max(len(ag._plain_words(i)) for i in items) > 3:
            return None
        fields['states'] = '\n'.join(items)
    elif effect in ('count-up', 'number-pop-in'):
        parts = _split_number(f.get('value', '')) if t == 'stat' else None
        if not parts:
            return None
        prefix, number, suffix = parts
        if effect == 'count-up':
            fields.update(value=number, **({'prefix': prefix} if prefix else {}), **({'suffix': suffix} if suffix else {}))
        else:
            if prefix or len(number) > 5 or len(suffix.strip()) > 3:
                return None
            fields.update(value=number, **({'unit': suffix.strip()} if suffix.strip() else {}))
    elif effect in SHARE_FX:
        share = share_of(g)
        if share is None:
            return None
        number, said = share
        if effect == 'conic-progress-ring':
            fields.update(progress=number, label=f'{number}%')
        elif effect == 'gauge-dial':
            fields.update(value=number, unit='%', **({'label': f['label']} if t == 'fx' and f.get('label') and f.get('effect') == 'waffle-chart' else {}))
        else:
            fields.update(figure=said, **({'label': f['label']} if t == 'fx' and f.get('label') and f.get('effect') == 'gauge-dial' else {}))
    elif effect == 'strikethrough-replace':
        if t == 'strike_list' and len(items) == 1:
            before, after = items[0], f.get('final', '')
        elif t == 'compare_marks' and len(items) == 2:
            before, after = items if f.get('wrong') != 'second' else items[::-1]
        elif t == 'before_after':
            before, after = f.get('before', ''), f.get('after', '')
        else:
            return None
        if not before or not after or len(before.split()) > 4 or len(after.split()) > 5:
            return None
        fields.update(before=before, after=after)
    elif effect == 'line-swap':
        if t != 'before_after' or not f.get('before') or not f.get('after'):
            return None
        fields.update(first=f['before'], second=f['after'])
    elif effect == 'constellation-hub':
        if t not in ('orbit', 'idea_hub') or not f.get('text') or not 3 <= len(items) <= 6:
            return None
        fields.update(hub=f['text'], nodes='\n'.join(items))
    else:
        return None
    # Never cut: words longer than the effect holds don't fit it.
    for f in (ag.fx_catalog().get(effect) or {}).get('fields', []):
        if f.get('max') and f['kind'] == 'text' and len(fields.get(f['key'], '')) > f['max']:
            return None
    hold = fx_hold_ms(effect)
    length = max(hold, min(g['duration_ms'], hold + 2000))
    return {**g, 'template': 'fx', 'fields': fields, 'duration_ms': int(min(ag.EDITOR_MAX_MS, length)), 'converted_from': kind_of(g)}


def from_fx(g: dict, to: str) -> Optional[dict]:
    """An effect as a template its words fit (a count up as a stat, a chip rail as a checklist…), or None."""
    f = g['fields']
    e = f.get('effect')
    fields: dict[str, str] = {}
    if to == 'stat' and e in ('count-up', 'number-pop-in'):
        value = f"{f.get('prefix', '')}{f.get('value', '')}{f.get('suffix', '') or f.get('unit', '')}".strip()
        if not ag._HAS_DIGIT.search(value):
            return None
        fields['value'] = value
    elif to in ('checklist', 'list') and e == 'state-chip-rail':
        fields['items'] = f.get('states', '')
    elif to == 'strike_list' and e == 'strikethrough-replace':
        fields.update(items=f.get('before', ''), final=f.get('after', ''))
    elif to in ('orbit', 'idea_hub') and e == 'constellation-hub':
        fields.update(text=f.get('hub', ''), items=f.get('nodes', ''))
    elif to in ('headline_pill', 'title', 'statement') and f.get('text'):
        return ag.converted({**g, 'template': 'title', 'fields': {'text': f['text']}}, to)
    else:
        return None
    return {**g, 'template': to, 'fields': fields, 'duration_ms': int(min(ag.DEFAULT_MS.get(to, 3500) + 1500, max(g['duration_ms'], ag.MIN_MS))),
            'converted_from': kind_of(g)}


def convert(g: dict, to: str) -> Optional[dict]:
    """`g` as kind `to` (a template or fx:<effect>) with its own words, or None (words are checked by the caller)."""
    effect = effect_of(to)
    if effect:
        return to_fx(g, effect) if g['template'] != 'fx' or g['fields'].get('effect') != effect else None
    if g['template'] == 'fx':
        return from_fx(g, to)
    return ag.converted(g, to)


# What a card may become, best first: plain text cards try these before staying plain (when their cap allows).
CONVERSIONS = {
    # (Text cards try the effects outside the "most important line" group first: that group's two places in a video are
    # kept for the lines the planner marked as the turn of the video.)
    'statement': ('fx:marker-highlight', 'fx:text-stagger', 'fx:headline-slam', 'fx:per-word-rise', 'headline_pill', 'title', 'feature_tile', 'big_words'),
    'quote': ('fx:marker-highlight', 'fx:text-stagger', 'fx:per-word-rise', 'headline_pill', 'title', 'statement'),
    'title': ('fx:marker-highlight', 'fx:text-stagger', 'fx:headline-slam', 'fx:kinetic-center-build', 'fx:per-word-rise', 'big_words', 'headline_pill', 'statement'),
    'big_words': ('fx:headline-slam', 'fx:kinetic-center-build', 'fx:text-stagger', 'title', 'headline_pill'),
    'takeover': ('fx:headline-slam', 'fx:per-word-rise', 'title', 'headline_pill'),
    'headline_pill': ('fx:marker-highlight', 'fx:text-stagger', 'fx:per-word-rise', 'fx:headline-slam', 'fx:kinetic-center-build', 'statement', 'big_words', 'title'),
    'sticky_notes': ('fx:state-chip-rail', 'feature_tile', 'icon_pop', 'orbit', 'checklist', 'list', 'idea_hub'),
    'list': ('checklist', 'fx:state-chip-rail', 'feature_tile', 'icon_pop', 'orbit', 'sticky_notes'),
    'checklist': ('list', 'fx:state-chip-rail', 'feature_tile', 'icon_pop', 'sticky_notes'),
    'feature_tile': ('icon_pop', 'list', 'sticky_notes'),
    'icon_pop': ('feature_tile', 'orbit', 'list'),
    'orbit': ('fx:constellation-hub', 'icon_pop', 'feature_tile', 'idea_hub'),
    'stat': ('fx:count-up', 'fx:number-pop-in'),
    'strike_list': ('fx:strikethrough-replace',),
    'fx:text-stagger': ('fx:per-word-rise', 'fx:marker-highlight', 'headline_pill'),
    'before_after': ('fx:line-swap', 'fx:strikethrough-replace'),
    'compare_marks': ('fx:strikethrough-replace',),
    'fx:count-up': ('stat', 'fx:number-pop-in'),
    'fx:conic-progress-ring': ('fx:gauge-dial', 'fx:waffle-chart', 'fx:count-up'),
    'fx:gauge-dial': ('fx:waffle-chart', 'fx:conic-progress-ring', 'fx:count-up'),
    'fx:waffle-chart': ('fx:gauge-dial', 'fx:conic-progress-ring', 'fx:count-up'),
    'fx:number-pop-in': ('fx:count-up', 'stat'),
    'fx:marker-highlight': ('fx:per-word-rise', 'headline_pill', 'title'),
    'fx:headline-slam': ('fx:kinetic-center-build', 'fx:marker-highlight', 'headline_pill'),
    'fx:per-word-rise': ('fx:kinetic-center-build', 'fx:marker-highlight', 'headline_pill'),
    'fx:kinetic-center-build': ('fx:per-word-rise', 'fx:marker-highlight', 'headline_pill'),
    'fx:state-chip-rail': ('checklist', 'list'),
    'fx:strikethrough-replace': ('strike_list',),
    'fx:constellation-hub': ('orbit', 'idea_hub'),
}


# ---------------------------------------------------------------------------
# Quiet stretches: a long run of face and captions while the speaker explains gets a visual from its cues.
# ---------------------------------------------------------------------------

# A stretch with no graphic this long (teaching; a story: QUIET_STORY_MS) gets one where its words have a cue. Personal
# stories stay on the face (they are never filled), and so does the minimal register.
QUIET_MS = 6500
QUIET_STORY_MS = 20000
# Filled graphics keep this much free time to the graphics around them, and the video at most one per FILL_SECONDS.
QUIET_PAD_MS = 1200
FILL_SECONDS = 7.0
# The cues a quiet stretch is filled from, strongest first.
FILL_ORDER = ('money', 'percent', 'count', 'list', 'contrast', 'steps', 'punchline', 'identity', 'before_after')


def said_clause(sentence: str, most: int = 12) -> str:
    """The part of a sentence a marker shows: the whole of it when short, else its longest clause between commas that
    is 4-`most` words (as said, punctuation at the ends dropped); '' when none."""
    text = ' '.join(sentence.split()).strip(' .,!?;:"')
    if 4 <= len(text.split()) <= most:
        return text
    parts = [p.strip(' .,!?;:"') for p in re.split(r'[,;:]\s+', text)]
    parts = [p for p in parts if 4 <= len(p.split()) <= most]
    return max(parts, key=lambda p: len(p.split())) if parts else ''


def cue_graphic(cue: dict) -> list[dict]:
    """The graphics a cue could become, best first (each still checked against the words said by the caller): a number
    counts up (or pops in), a list becomes chips or a checklist, a contrast, a framework announced or the line the
    video turns on gets a marker on its key word (or rises word by word)."""
    at = max(0, int(cue['at_ms']) - 300)
    base = {'at_ms': at, 'duration_ms': 3500, 'placement': 'middle', 'origin': 'auto'}
    kind = cue['kind']
    out: list[Optional[dict]] = []
    if kind in ('money', 'count', 'percent') and cue.get('value') and ag._HAS_DIGIT.search(cue['value']):
        stat = {**base, 'template': 'stat', 'fields': {'value': cue['value']}}
        out += [to_fx(stat, 'count-up'), to_fx(stat, 'number-pop-in'), {**stat, 'duration_ms': 3000}]
        if kind == 'percent':
            out = [to_fx(stat, e) for e in SHARE_FX] + out
    elif kind == 'list':
        items = [i.strip() for i in cue['text'].split(', ') if i.strip()]
        # Only parallel items (short, none a clause of the sentence: "which people like you" is not an item).
        if any(len(i.split()) > 3 or i.split()[0].lower() in ('which', 'who', 'that', 'where', 'when') or i.split()[-1].lower() in _STOP
               for i in items):
            return []
        listed = {**base, 'duration_ms': 5000, 'template': 'checklist', 'fields': {'items': '\n'.join(items)}}
        out += [to_fx(listed, 'state-chip-rail'), listed]
    elif kind in ('contrast', 'steps', 'punchline', 'identity', 'before_after'):
        line = said_clause(cue.get('sentence') or cue['text'])
        if line:
            card = {**base, 'template': 'statement', 'fields': {'text': line}}
            out += [to_fx(card, 'marker-highlight'), to_fx(card, 'per-word-rise')]
    return [g for g in out if g is not None]


def quiet_gaps(kept: Sequence[dict], lo: float, hi: float, quiet: float) -> list[tuple[float, float]]:
    """The stretches between `lo` and `hi` (source ms) with no graphic for at least `quiet` ms."""
    spans = sorted((g['at_ms'], g['at_ms'] + g['duration_ms']) for g in kept if g.get('template') != 'chapter')
    out, at = [], lo
    for a, b in spans:
        if a - at >= quiet:
            out.append((at, a))
        at = max(at, b)
    if hi - at >= quiet:
        out.append((at, hi))
    return out


def fill_quiet(kept: list[dict], segments: Sequence, ranges: Sequence[Sequence[float]], speed: float, seconds: float,
               allowed: Sequence[str], clash: Any, register: Optional[str], lo: float, hi: float, limit: int) -> list[dict]:
    """Long quiet stretches (QUIET_MS of face and captions while the speaker explains) get a visual where their words have
    a cue (a number, a list, a contrast, a framework announced, the line that matters): the strongest cue of each stretch,
    checked like any planned graphic (every word said, the variety rules, never over another one), until the video has
    `limit` graphics. Personal stories and the minimal register stay as they are. Source time; `lo`/`hi`: the earliest
    start and the latest end allowed (out of the first second and the call to action's last seconds)."""
    if register == 'minimal' or 'fx' not in allowed or not ranges:
        return kept
    quiet = QUIET_STORY_MS if register == 'story' else QUIET_MS
    cues = [c for c in find_cues(segments) if c['kind'] in FILL_ORDER and lo <= c['at_ms'] <= hi]
    stories = story_spans(find_cues(segments))
    out = list(kept)
    tried: set[int] = set()
    # A number already on screen once (said again later) is not shown twice.
    shown = {n for g in kept for v in g['fields'].values() for n in ag._numbers(str(v))}
    cues = [c for c in cues if not (c.get('value') and any(abs(n - m) < 1e-6 * max(1.0, abs(n)) for n in ag._numbers(c['value']) for m in shown))]
    while len([g for g in out if g.get('template') != 'chapter']) < limit:
        placed = False
        for a, b in quiet_gaps(out, lo, hi, quiet):
            inside = [c for c in cues if a + QUIET_PAD_MS <= c['at_ms'] <= b - QUIET_PAD_MS and id(c) not in tried]
            for c in sorted(inside, key=lambda c: (FILL_ORDER.index(c['kind']), c['at_ms'])):
                tried.add(id(c))
                for g in cue_graphic(c):
                    g = ag._fits_words(g, segments)
                    if g is None or not register_allows(kind_of(g), register or 'teaching') or in_story(g, stories):
                        continue
                    end = g['at_ms'] + g['duration_ms']
                    if g['at_ms'] < a + QUIET_PAD_MS or g['at_ms'] < lo:
                        continue
                    if end > b - QUIET_PAD_MS:
                        # Shortened to end before the next graphic (an effect keeps most of its time), else not placed.
                        room = int(b - QUIET_PAD_MS - g['at_ms'])
                        if room < max(ag.EDITOR_MIN_MS, int(g['duration_ms'] * .7)):
                            continue
                        g = {**g, 'duration_ms': room}
                    span = ag.window(ranges, speed, g['at_ms'], g['duration_ms'])
                    if span is None or span[1] < ag.EDITOR_MIN_MS or not ag.variety_allows(g, out, seconds) or clash(g, out):
                        continue
                    out.append({**g, 'origin': 'auto', 'filled': True})
                    placed = True
                    break
                if placed:
                    break
            if placed:
                break
        if not placed:
            break
    return sorted(out, key=lambda g: g['at_ms'])


# The takeover a video gets on its punchline when the planner left it out (huge type, 2.6 s: about one line said).
ENSURE_TAKEOVER_MS = 2600
# What a takeover may push aside to get its moment: lighter graphics only (no diagram, number proof, the member's
# own pictures, a call to action or a logo).
ENSURE_KEEP_PRIORITY = 7
ENSURE_KEEP_TEMPLATES = ('comment_cta', 'link_cta', 'logo', 'chapter', 'screen_frame', 'browser_frame') + ag.DIAGRAMS


def ensure_kinds(kept: list[dict], segments: Sequence, ranges: Sequence[Sequence[float]], speed: float, seconds: float,
                 allowed: Sequence[str], clash: Any, register: Optional[str], lo: float, hi: float) -> list[dict]:
    """The kinds a pro edit never leaves out when their cue is there, added when the planner didn't place them: the
    type takeover on the line the video turns on (a punchline cue), once a video. It takes its moment from lighter
    graphics around it (ENSURE_KEEP_*), checked like any planned graphic (every word said, the variety and group rules,
    never over a story). Source time; `lo`/`hi`: the earliest start and latest end allowed."""
    if register == 'minimal' or 'takeover' not in allowed or any(kind_of(g) == 'takeover' for g in kept):
        return kept
    cues = find_cues(segments)
    stories = story_spans(cues)
    out = list(kept)
    for cue in (c for c in cues if c['kind'] == 'punchline' and lo <= c['at_ms'] <= hi):
        text = cue['text']
        g = {'template': 'takeover', 'at_ms': int(max(lo, cue['at_ms'] - 150)), 'duration_ms': ENSURE_TAKEOVER_MS, 'placement': 'middle',
             'origin': 'auto', 'fields': {'text': text, **({'accent': key_word(text)} if key_word(text) else {})}}
        g = ag._fits_words(g, segments)
        if g is None or in_story(g, stories) or g['at_ms'] + g['duration_ms'] > hi:
            continue
        span = ag.window(ranges, speed, g['at_ms'], g['duration_ms'])
        if span is None or span[1] < ag.EDITOR_MIN_MS:
            continue
        # Room on the timeline: lighter graphics overlapping it step aside; a heavier one keeps its moment.
        rest = [k for k in out if not clash(g, [k])]
        aside = [k for k in out if clash(g, [k])]
        if any(ag._priority(k) >= ENSURE_KEEP_PRIORITY or k['template'] in ENSURE_KEEP_TEMPLATES or kind_of(k) in ag.NUMBER_FAMILY for k in aside):
            continue
        # The one-most-important-line group (SLAM_MAX): the weakest other slam effect makes way.
        slams = [k for k in rest if kind_of(k) in SLAM_KINDS]
        if len(slams) >= SLAM_MAX:
            rest.remove(min(slams, key=lambda k: (ag._priority(k), -k['at_ms'])))
        if not ag.variety_allows(g, rest, seconds) or clash(g, rest):
            continue
        return sorted(rest + [{**g, 'origin': 'auto', 'filled': True}], key=lambda k: k['at_ms'])
    return out


# ---------------------------------------------------------------------------
# Stage moments: while the speaker teaches, a diagram or a stage scene every so often (the reference reels put one on
# every step of an explanation; the planner alone placed three in four minutes).
# ---------------------------------------------------------------------------

# A stretch of explaining this long with no stage or diagram moment gets one where its words have a cue (a list, steps,
# a framework, a contrast); the new one keeps at least STAGE_MIN_GAP_MS to the stage moments around it.
STAGE_EVERY_MS = 50000
STAGE_MIN_GAP_MS = 8000
# Graphics that already show a contrast or a list (the planner's): taken up onto the stage rather than replaced.
STAGE_COVERS = {
    'contrast': frozenset(('fx:line-swap', 'fx:strikethrough-replace', 'fx:caret-swap', 'fx:kinetic-type-swap', 'before_after', 'strike_list')),
    'list': frozenset(('list', 'checklist', 'fx:state-chip-rail', 'fx:marker-checklist-card', 'fx:onboarding-stepper-flow', 'icon_pop',
                       'feature_tile', 'sticky_notes')),
}
# Words that make a side of a contrast the wrong one ("organic content... not nearly enough").
_NEGATIONS = frozenset(('not', 'never', "don't", "won't", "can't", "isn't", "doesn't", "aren't", "wasn't", "shouldn't", 'no', 'stop',
                        'wrong', 'cannot', 'nothing', "didn't"))
# Words a list item never starts or ends with (a clause of the sentence, not an item).
_ITEM_OPENERS = ('which', 'who', 'that', 'where', 'when', 'what', 'how', 'why', 'if', 'because')
# Lead-ins dropped before comparing how sentences start ("And number three, we need...").
_LEAD_INS = frozenset(('and', 'so', 'then', 'also', 'now', 'next', 'finally', 'lastly', 'plus', 'but', 'okay', 'ok', 'first', 'second',
                       'third', 'fourth', 'fifth', 'number', 'step', 'one', 'two', 'three', 'four', 'five'))
# Sentences in a parallel run start within this long of each other.
PARALLEL_GAP_MS = 12000
# The second side of a contrast is said this soon after the first (a Wrong / right shows both cards).
CONTRAST_SIDES_MS = 10500
# What ends a parallel item ("a product that we can sell": "a product").
_ITEM_STOPS = frozenset(('that', 'which', 'who', 'to', 'so', 'because', 'and', 'but', 'for', 'with', 'when', 'if', 'where', 'is', 'are',
                         'will', 'can', 'we', 'you', 'i', 'they', 'it'))


def _words_of(sentence: list[dict]) -> list[dict]:
    """The sentence's words as said (a word read as several tokens once), each with its tokens."""
    out: list[dict] = []
    for w in sentence:
        if out and out[-1]['start'] == w['start'] and out[-1]['raw'] == w['raw']:
            out[-1]['toks'].append(w['tok'])
            continue
        out.append({'raw': w['raw'].strip(), 'tok': w['tok'], 'toks': [w['tok']], 'start': w['start'], 'end': w['end']})
    return out


def _clean_item(words: Sequence[dict]) -> str:
    return ' '.join(w['raw'] for w in words).strip(' ,.!?;:"“”')


def _phrase_after(words: list[dict], i: int, most: int = 3) -> list[dict]:
    """The item said from word `i`: an article, then up to `most` words, ending before a clause word or after a comma."""
    out: list[dict] = []
    for w in words[i:]:
        if out and (w['tok'] in _ITEM_STOPS or len([x for x in out if x['tok'] not in ('a', 'an', 'the')]) >= most):
            break
        out.append(w)
        if re.search(r'[,.!?;:]$', w['raw']):
            break
    while out and out[-1]['tok'] in _STOP:
        out.pop()
    return out if any(w['tok'] not in _STOP for w in out) else []


def parallel_runs(segments: Sequence) -> list[dict]:
    """Items said as sentences that start the same way ("We need a product... We need an offer... We need eyeballs"):
    [{'at_ms', 'end_ms', 'items', 'sentence'}], 3-5 items a run, each the words right after the shared start."""
    sentences = [_words_of(s) for s in _sentences(segments)]

    def stripped(words: list[dict]) -> list[dict]:
        k = 0
        while k < len(words) and (words[k]['tok'] in _LEAD_INS or words[k]['tok'].isdigit()):
            k += 1
        return words[k:]

    out: list[dict] = []
    i = 0
    while i < len(sentences):
        base = stripped(sentences[i])
        best: Optional[tuple[int, int]] = None  # (prefix length, run end)
        for n in (4, 3, 2):
            if len(base) <= n:
                continue
            prefix = [w['tok'] for w in base[:n]]
            j = i + 1
            while j < len(sentences) and j - i < 5:
                other = stripped(sentences[j])
                if len(other) <= n or [w['tok'] for w in other[:n]] != prefix or other[0]['start'] - sentences[j - 1][0]['start'] > PARALLEL_GAP_MS:
                    break
                j += 1
            if j - i >= 3:
                best = (n, j)
                break
        if best is None:
            i += 1
            continue
        n, j = best
        items = [_phrase_after(stripped(sentences[k]), n) for k in range(i, j)]
        if all(items):
            out.append({'at_ms': int(items[0][0]['start']), 'end_ms': int(sentences[j - 1][-1]['end']), 'items': [_clean_item(x) for x in items],
                        'sentence': ' '.join(w['raw'] for w in sentences[i])})
        i = j
    return out


# Words that open a relative clause: a negation after one is about something else ("a cold audience, people that don't
# know us").
_RELATIVE = frozenset(('that', 'who', 'which', 'whom', 'whose', 'where', 'when', 'if', 'because'))


def _negation(w: dict) -> bool:
    return w['tok'] in _NEGATIONS or w['tok'].endswith("n't")


def _side_negated(words: list[dict], i: int) -> bool:
    """The side said at word `i` is said with a negation: just before it ("don't use ads"), or after it in its own clause
    ("organic content reaches a few people, but not nearly enough"), never one inside a relative clause about it."""
    if any(_negation(w) for w in words[max(0, i - 3):i]):
        return True
    for w in words[i + 1:]:
        if w['tok'] in _RELATIVE:
            return False
        if _negation(w):
            return True
    return False


def contrast_pairs(segments: Sequence) -> list[dict]:
    """Opposites said close together ("organic content... not nearly enough." then "...spend money on ads"):
    [{'at_ms', 'end_ms', 'items': [first, second], 'wrong': 'first'|'second'|None}]. `wrong` is the side said with a
    negation when only one is."""
    sentences = [_words_of(s) for s in _sentences(segments)]
    out: list[dict] = []
    for k, cur in enumerate(sentences):
        for back in range(1, 4):
            if k - back < 0:
                break
            prev = sentences[k - back]
            hit = None
            for a, b in _OPPOSITES:
                for x, y in ((a, b), (b, a)):
                    pa = next((i for i, w in enumerate(prev) if x in w['toks']), None)
                    pb = next((i for i, w in enumerate(cur) if y in w['toks']), None)
                    if pa is not None and pb is not None and 0 < cur[pb]['start'] - prev[pa]['start'] <= CONTRAST_SIDES_MS:
                        hit = (pa, pb)
                        break
                if hit:
                    break
            if not hit:
                continue
            pa, pb = hit
            first = _phrase_after(prev, pa, 2)
            second = _phrase_after(cur, pb, 2)
            if not first or not second:
                continue
            neg_a, neg_b = _side_negated(prev, pa), _side_negated(cur, pb)
            out.append({'at_ms': int(first[0]['start']), 'end_ms': int(second[-1]['end']), 'items': [_clean_item(first), _clean_item(second)],
                        'wrong': 'first' if neg_a and not neg_b else 'second' if neg_b and not neg_a else None})
            break
    return out


def _steps_said(cues: Sequence[dict], at: float, end: float) -> bool:
    """Steps or a framework is announced in or just before this stretch ("three things", "the process")."""
    return any(c['kind'] in ('steps', 'numbered_step') and at - 8000 <= c['at_ms'] <= end for c in cues)


def stage_candidates(segments: Sequence, stage: bool) -> list[dict]:
    """The stage moments the words offer: [{'cue': kind, 'at_ms', 'end_ms', 'options': [graphic, ...]}] in time order.
    A list or a parallel run climbs a staircase when steps are announced (else a checklist on the stage), a contrast
    with one side negated is a Wrong / right; a contrast without one is a cue only (a graphic of the planner's that
    shows it is taken up onto the stage)."""
    cues = find_cues(segments)
    base = {'placement': 'middle', 'origin': 'auto'}
    out: list[dict] = []

    def listed(at: int, end: int, items: list[str]) -> list[dict]:
        joined = '\n'.join(items)
        options = []
        if _steps_said(cues, at, end) and 3 <= len(items) <= ag.ITEM_LIMITS['staircase']:
            options.append({**base, 'template': 'staircase', 'at_ms': at, 'duration_ms': end - at, 'fields': {'items': joined}})
        if stage:
            options.append({**base, 'template': 'checklist', 'at_ms': max(0, at - 300), 'duration_ms': max(5000, end - at + 1500), 'fields': {'items': joined}})
        return options

    for c in cues:
        if c['kind'] != 'list':
            continue
        items = [i.strip() for i in c['text'].split(', ') if i.strip()]
        if len(items) < 3 or any(len(i.split()) > 3 or i.split()[0].lower() in _ITEM_OPENERS or i.split()[-1].lower() in _STOP for i in items):
            continue
        out.append({'cue': 'list', 'at_ms': c['at_ms'], 'end_ms': c['end_ms'], 'options': listed(c['at_ms'], c['end_ms'], items)})
    for run in parallel_runs(segments):
        out.append({'cue': 'list', 'at_ms': run['at_ms'], 'end_ms': run['end_ms'], 'options': listed(run['at_ms'], run['end_ms'], run['items'])})
    for pair in contrast_pairs(segments):
        options = []
        if pair['wrong']:
            options.append({**base, 'template': 'compare_marks', 'at_ms': pair['at_ms'], 'duration_ms': pair['end_ms'] - pair['at_ms'],
                            'fields': {'items': '\n'.join(pair['items']), 'wrong': pair['wrong']}})
        out.append({'cue': 'contrast', 'at_ms': pair['at_ms'], 'end_ms': pair['end_ms'], 'options': options})
    return sorted(out, key=lambda c: c['at_ms'])


def _timed_stage(g: dict, segments: Sequence) -> Optional[dict]:
    """A stage moment on its words: a diagram from its first item to a little after its last (a Wrong / right's two
    sides may be said CONTRAST_SIDES_MS apart), a checklist while its items are said. None when they aren't all said."""
    if not ag.has_content(g['template'], g['fields']):
        return None
    g = ag.drop_unsaid_extras(g, segments)
    if g['template'] in ag.DIAGRAMS:
        probe = {**g, 'at_ms': g['at_ms'] - 300, 'duration_ms': g['duration_ms'] + 600}
        times = ag.item_times(probe, segments)
        if not times:
            return None
        gap = CONTRAST_SIDES_MS if g['template'] == 'compare_marks' else ag.DIAGRAM_ITEM_GAP_MS
        if any(b - a > gap for a, b in zip(times, times[1:])):
            return None
        at = max(0, times[0] - ag.DIAGRAM_LEAD_MS)
        end = max(times[-1] + ag.DIAGRAM_HOLD_MS, at + ag.DIAGRAM_MIN_MS)
        g = {**g, 'at_ms': int(at), 'duration_ms': int(min(end - at, ag.DIAGRAM_AUTO_MAX_MS))}
    else:
        times = ag.item_times(g, segments)
        if not times:
            return None
        at = max(0, times[0] - 300)
        g = {**g, 'at_ms': int(at), 'duration_ms': int(min(ag.EDITOR_MAX_MS, max(5000, times[-1] + 2200 - at)))}
    return g if ag.words_said(g, segments) else None


def ensure_stage(kept: list[dict], segments: Sequence, ranges: Sequence[Sequence[float]], speed: float, seconds: float,
                 allowed: Sequence[str], clash: Any, register: Optional[str], lo: float, hi: float, staged: Any, stage: bool,
                 limit: int) -> list[dict]:
    """While the speaker teaches, a stage or diagram moment at least every STAGE_EVERY_MS of explaining, where the words
    have a cue for one: a graphic of the planner's that already shows the cue is taken up onto the stage ('stage_up'),
    else a fitting diagram or stage card is added on the cue's words (its items lighting as said), taking its moment
    from lighter graphics around it. Never in a personal story, the story or minimal register, or past the video's count
    (`limit`); checked like any planned graphic. `staged(g)`: g shows on the stage. Source time."""
    if register not in (None, 'teaching') or not ranges:
        return kept
    stories = story_spans(find_cues(segments))
    out = list(kept)

    def explaining(a: float, b: float) -> float:
        """Teaching time between a and b (story stretches left out)."""
        return max(0.0, b - a) - sum(max(0, min(b, s1) - max(a, s0)) for s0, s1 in stories)

    def room(a: float, b: float) -> bool:
        """[a, b] sits in a long enough stretch without a stage moment, clear of the ones around it."""
        spans = sorted((g['at_ms'], g['at_ms'] + g['duration_ms']) for g in out if staged(g))
        before = max((e for s, e in spans if s <= a), default=lo)
        after = min((s for s, e in spans if s >= a), default=hi)
        if any(s < b + STAGE_MIN_GAP_MS and e > a - STAGE_MIN_GAP_MS for s, e in spans):
            return False
        return explaining(before, after) >= STAGE_EVERY_MS

    for cand in stage_candidates(segments, stage):
        if not lo <= cand['at_ms'] <= hi or in_story({'at_ms': cand['at_ms'], 'duration_ms': max(1, cand['end_ms'] - cand['at_ms'])}, stories):
            continue
        covers = STAGE_COVERS.get(cand['cue'], frozenset())
        mine = [g for g in out if kind_of(g) in covers and g['at_ms'] < cand['end_ms'] + 1500 and cand['at_ms'] - 1500 < g['at_ms'] + g['duration_ms']
                and not staged(g)]
        if stage and mine:
            g = mine[0]
            others = [k for k in out if k is not g]
            if not room(g['at_ms'], g['at_ms'] + g['duration_ms']):
                continue
            out = sorted(others + [{**g, 'stage_up': True}], key=lambda k: k['at_ms'])
            continue
        for option in cand['options']:
            if option['template'] not in allowed:
                continue
            g = _timed_stage(option, segments)
            if g is None or g['at_ms'] < lo or g['at_ms'] + g['duration_ms'] > hi or in_story(g, stories):
                continue
            span = ag.window(ranges, speed, g['at_ms'], g['duration_ms'])
            if span is None or span[1] < ag.EDITOR_MIN_MS or not room(g['at_ms'], g['at_ms'] + g['duration_ms']):
                continue
            # Its moment: lighter graphics overlapping it step aside; a heavier one (a number, a diagram, a picture, the
            # call to action) keeps its moment.
            rest = [k for k in out if not clash(g, [k])]
            aside = [k for k in out if clash(g, [k])]
            if any(ag._priority(k) >= ENSURE_KEEP_PRIORITY or k['template'] in ENSURE_KEEP_TEMPLATES or kind_of(k) in ag.NUMBER_FAMILY
                   or k.get('stage_up') for k in aside):
                continue
            if len([k for k in rest if k.get('template') != 'chapter']) >= limit or not ag.variety_allows(g, rest, seconds) or clash(g, rest):
                continue
            out = sorted(rest + [{**g, 'origin': 'auto', 'filled': True}], key=lambda k: k['at_ms'])
            break
    return out


# ---------------------------------------------------------------------------
# The planner's guidance (shared by Create and Edit my recording).
# ---------------------------------------------------------------------------

def compact_catalog() -> str:
    """One line per effect the planner may place: its fields (* required) and when to use / avoid it."""
    lines = []
    for e in AUTO_FX:
        effect = ag.fx_catalog().get(e)
        if not effect:
            continue
        fields = ','.join(f"{f['key']}{'*' if f['required'] else ''}" + (f"[{'|'.join(f.get('options', []))}]" if f['kind'] == 'choice' else '')
                          + (f"<={f['max']}" if f.get('max') and f['kind'] in ('text', 'list') and f['max'] < 60 else '')
                          + ('(list)' if f['kind'] == 'list' else '')
                          for f in effect['fields'] if f['said'] or f['kind'] == 'choice')
        lines.append(f"{e}({fields}): {effect['use_when']} Avoid: {effect['avoid_when']}")
    return '\n'.join(lines)


def director_rule(register: Optional[str] = None, comment: bool = False) -> str:
    """The cue -> visual map and the effects catalog, for the planner's prompt."""
    reg = {
        'story': 'REGISTER: story. Few graphics (about half the usual): numbers, a contrast, the call to action; long stretches of face.\n',
        'minimal': 'REGISTER: minimal. Only the hook, numbers said and the call to action get a graphic; nothing else.\n',
    }.get(register or '', '')
    return (
        '\nPICK THE VISUAL LIKE A PRO EDITOR: visualize the IDEA (a number counting, a framework building, a contrast striking '
        'through), not the sentence. Cue -> visual:\n'
        '- money / count / percent said -> fx count-up or number-pop-in (or "stat"); a share or score said as a number -> fx conic-progress-ring, gauge-dial or waffle-chart (take turns; '
        'waffle-chart for "1 in 10"; never for "most": only numbers said); a rating said -> '
        'fx star-rating-fill;\n'
        '- two numbers, "from X to Y", a trend -> fx chart-story (up) or decline-chart (down), only with the numbers said;\n'
        '- steps / a process -> "staircase", "funnel" or "journey" (labels light up as said, 6-15 s), or fx state-chip-rail;\n'
        '- a list of 3-5 -> fx marker-checklist-card or state-chip-rail, or "checklist";\n'
        '- "instead of" / wrong vs right -> fx strikethrough-replace or "compare_marks";\n'
        '- one idea with many parts -> fx constellation-hub, locked-nucleus-orbit, radial-surround, overwhelm-surround, or "orbit"/"idea_hub";\n'
        '- a named app or brand -> "icon_pop"; typing / a prompt / a message -> fx typed-prompt or typing-indicator;\n'
        '- a result quoted from a customer -> fx testimonial-proof-card (no name unless said);\n'
        '- THE single most important line -> "takeover" (the whole line in huge type over the frame, the speaker\'s head between its '
        'lines; 3-9 words exactly as said, "accent" = its key word; 1.5-3 s) or fx headline-slam, per-word-rise or kinetic-center-build '
        '(at most 2 of these in the whole video, together);\n'
        '- a key phrase -> fx marker-highlight or vox-annotate (word = the phrase\'s key word, inside text);\n'
        '- personal story or emotion -> NOTHING (the face and captions carry it);\n'
        '- a numbered step said ("step one") with the stage up -> fx flanking-words (words = the step word and its number, as said);\n'
        '- who the speaker is or what this is ("I\'m a full-time creator") -> fx magazine-cover (masthead = one or two words said, '
        '2-3 cover lines said; at most once a video);\n'
        + ('- a call to action (comment X / the link) -> "comment_cta" or fx cta-lockup.\n' if comment else
           '- a call to action (the link, sign up) -> fx cta-lockup (only at the end, words as said).\n') +
        'Plain text cards ("statement", "quote", "sticky_notes", "big_words", "title", "before_after", and headline pills) are a FALLBACK: '
        'at most one per 45 seconds together, only when nothing above fits; a key line is an effect (marker-highlight, per-word-rise, '
        'text-stagger), not a card. The app turns extra plain cards into effects or drops them.\n'
        + reg +
        'EFFECTS: template "fx", "effect" = its id, "fx_fields" = [{key, value}] with its fields (lists one item per line, numbers as '
        'said in digits); its words exactly as said, like any card. "seconds": short punches 1-3 s, frameworks while their items are '
        'said. Effects:\n' + compact_catalog() + '\n'
    )


def hints_block(hints: str) -> str:
    return ('CUES FOUND IN THE TRANSCRIPT (hints from the words; pick from them, skip weak ones):\n' + hints + '\n') if hints else ''


def graphics_count(seconds: float, register: str, base_limit: int) -> int:
    """At most this many graphics for a video this long in this register (never more than `base_limit`)."""
    pace = seconds_per_graphic(register, seconds)
    return max(1, min(base_limit, int(max(0.0, seconds) // pace) or 1))


def ceil_div(a: float, b: float) -> int:
    return int(math.ceil(a / b)) if b else 0


# ---------------------------------------------------------------------------
# The member's own screenshots: placed in code where a screen, a proof or a before and after is said.
# ---------------------------------------------------------------------------

# Two picture effects stay at least this far apart (each picture gets its moment, the face shows between).
MEDIA_GAP_MS = 6000


def clean_media(raw: Any) -> list[dict]:
    """The member's screenshots for the video ({id, box?, tall?}: an image id of the run, the part that matters as shares
    of the picture, a phone-shaped picture), checked; [] when there are none."""
    out = []
    for m in (raw if isinstance(raw, list) else [])[:6]:
        if not isinstance(m, dict) or not isinstance(m.get('id'), str) or not ag._PICTURE.match(m['id']):
            continue
        out.append({'id': m['id'], 'box': ag.fx_region(m.get('box')) if m.get('box') is not None else None, 'tall': m.get('tall') is True})
    return out


def media_graphic(kind: str, cue: dict, shots: Sequence[dict], segments: Sequence) -> Optional[dict]:
    """The picture effect for a media cue: a before and after (two pictures), a proof under a light sweep (or in a phone
    when the picture is phone-shaped) or a screen in a browser window or a phone; the member's box gets a hand-drawn
    circle (a screen) or underline (a proof). Words on it only as said: the chips say "Before" / "After" when those
    words are said."""
    fields: dict[str, str] = {}
    shot = shots[0]
    if kind == 'before_after':
        if len(shots) < 2:
            return None
        fields = {'effect': 'before-after-wipe', 'image': shots[0]['id'], 'image_b': shots[1]['id']}
        heard = {w for w, _ in ag._timed_words(segments, cue['at_ms'] - 1500, cue['end_ms'] + 1500)}
        if 'before' in heard:
            fields['label_a'] = 'Before'
        if 'after' in heard:
            fields['label_b'] = 'After'
    elif kind == 'proof':
        fields = {'effect': 'device-frame-stage' if shot['tall'] else 'light-sweep-pass', 'image': shot['id']}
        if shot['box']:
            fields.update(mark='underline', mark_box=', '.join(f'{round(n, 3):g}' for n in shot['box']))
    elif kind == 'screen':
        fields = {'effect': 'device-frame-stage' if shot['tall'] else 'browser-device-stage', 'image': shot['id']}
        if shot['box']:
            fields.update(mark='circle', mark_box=', '.join(f'{round(n, 3):g}' for n in shot['box']))
    else:
        return None
    hold = fx_hold_ms(fields['effect'])
    at = max(0, int(cue['at_ms']) - 250)
    length = int(max(ag.EDITOR_MIN_MS, min(ag.EDITOR_MAX_MS, max(hold, int(cue['end_ms']) + 700 - at))))
    return {'template': 'fx', 'at_ms': at, 'duration_ms': length, 'placement': 'middle', 'size': 'stage', 'fields': fields}


def place_media(graphics: Sequence[dict], segments: Sequence, media: Any, ranges: Sequence[Sequence[float]] = (),
                register: Optional[str] = None) -> list[dict]:
    """The member's screenshots on the moments they fit (a screen talked about, a result shown, a before and after),
    in the order they were added, each once; a graphic planned over one gives way to it. Nothing changes without
    screenshots, in the minimal register, or during a personal story."""
    shots = clean_media(media)
    if not shots or register == 'minimal':
        return list(graphics)
    cues = find_cues(segments)
    stories = story_spans(cues)
    lo = ranges[0][0] if ranges else 0
    hi = ranges[-1][1] if ranges else float('inf')
    out, placed, queue = list(graphics), [], list(shots)
    for c in cues:
        if c['kind'] not in MEDIA_CUES or not queue:
            continue
        need = 2 if c['kind'] == 'before_after' else 1
        if len(queue) < need:
            continue
        g = media_graphic(c['kind'], c, queue[:need], segments)
        if not g or g['at_ms'] < lo or g['at_ms'] + ag.EDITOR_MIN_MS > hi or in_story(g, stories):
            continue
        if any(abs(g['at_ms'] - p['at_ms']) < MEDIA_GAP_MS for p in placed):
            continue
        g['duration_ms'] = int(min(g['duration_ms'], hi - g['at_ms']))
        # The member's picture takes its moment: what was planned over it gives way.
        out = [k for k in out if not (k['at_ms'] < g['at_ms'] + g['duration_ms'] + ag.GAP_MS and g['at_ms'] < k['at_ms'] + k['duration_ms'] + ag.GAP_MS)]
        placed.append({**g, 'origin': 'auto'})
        queue = queue[need:]
    return sorted(out + placed, key=lambda g: g['at_ms'])


# ---------------------------------------------------------------------------
# My logos: the member's own logo images, popped in where the speaker names them.
# ---------------------------------------------------------------------------

# One logo pop at most this often, each logo at most LOGO_MAX_EACH times a video; each pop holds LOGO_MS.
LOGO_GAP_MS = 6000
LOGO_MAX_EACH = 2
LOGO_MS = 1500
# A pop starts this long before the name is said (it has landed as the word is heard).
LOGO_LEAD_MS = 150
MAX_LOGOS = 30
MAX_LOGO_NAMES = 8


def clean_logos(raw: Any) -> list[dict]:
    """The member's logos ({image, name, aliases}: `image` a run image name, or a library id before an edited reel is
    made), checked: each with its names to listen for (the name and its aliases, as word lists); [] when none."""
    out = []
    for item in (raw if isinstance(raw, list) else [])[:MAX_LOGOS]:
        if not isinstance(item, dict) or not isinstance(item.get('image'), str) or not ag._PICTURE.match(item['image']):
            continue
        names = [item.get('name')] + (list(item.get('aliases')) if isinstance(item.get('aliases'), list) else [])
        phrases: list[tuple[str, ...]] = []
        for name in names[:MAX_LOGO_NAMES]:
            toks = tuple(ag._tokens(name)) if isinstance(name, str) and len(name) <= 40 else ()
            if toks and len(toks) <= 4 and toks not in phrases:
                phrases.append(toks)
        if phrases:
            out.append({'image': item['image'], 'phrases': phrases})
    return out


def _token_is(tok: str, want: str, last: bool) -> bool:
    """A spoken token is the name's word: the same word, or (its last word) with a possessive ("Meta's"); never a plural."""
    return tok == want or (last and tok in (f"{want}'s", f"{want}'"))


def logo_mentions(segments: Sequence, logos: Sequence[dict]) -> list[dict]:
    """Every time a logo's name (or an alias) is said as whole words, in time order: [{'at_ms', 'end_ms', 'logo'}] (`logo`:
    its index). Matching is by whole words, case-insensitive ("Meta" in "Meta's ads", never in "metadata" or "Metas");
    at one moment the longest name wins."""
    words = ag._spoken(segments)
    toks = [w['tok'] for w in words]
    out: list[dict] = []
    i = 0
    while i < len(toks):
        best: Optional[tuple[int, int]] = None
        for k, logo in enumerate(logos):
            for phrase in logo['phrases']:
                n = len(phrase)
                if i + n <= len(toks) and all(_token_is(toks[i + j], phrase[j], j == n - 1) for j in range(n)) and (best is None or n > best[1]):
                    best = (k, n)
        if best is None:
            i += 1
            continue
        out.append({'at_ms': words[i]['start'], 'end_ms': words[i + best[1] - 1]['end'], 'logo': best[0]})
        i += best[1]
    return out


def place_logos(graphics: Sequence[dict], segments: Sequence, logos: Any, ranges: Sequence[Sequence[float]] = (), speed: float = 1.0,
                register: Optional[str] = None, lo: Optional[float] = None, hi: Optional[float] = None) -> list[dict]:
    """A logo pops in (white tile, "logo" template) as the speaker names it: at most one per LOGO_GAP_MS, each logo at
    most LOGO_MAX_EACH times, never during a personal story, never over another graphic, never in the minimal register,
    inside the kept cut (`ranges`, source ms; `lo`/`hi`: the earliest start and latest end allowed). Source time."""
    clean = clean_logos(logos)
    if not clean or register == 'minimal':
        return list(graphics)
    stories = story_spans(find_cues(segments))
    kept_ranges = [(float(a), float(b)) for a, b in ranges if b > a]
    out = list(graphics)
    placed: list[dict] = []
    used = [0] * len(clean)
    for m in logo_mentions(segments, clean):
        if used[m['logo']] >= LOGO_MAX_EACH:
            continue
        at = max(0, int(m['at_ms']) - LOGO_LEAD_MS)
        g = {'template': 'logo', 'at_ms': at, 'duration_ms': LOGO_MS, 'placement': 'middle', 'fields': {'image': clean[m['logo']]['image']}}
        end = at + LOGO_MS
        if (lo is not None and at < lo) or (hi is not None and end > hi):
            continue
        # Inside one kept stretch of the cut (a pop never straddles a cut).
        if kept_ranges and not any(a <= at and end <= b for a, b in kept_ranges):
            continue
        if in_story(g, stories):
            continue
        if any(abs(at - p['at_ms']) < LOGO_GAP_MS for p in placed):
            continue
        if any(at < k['at_ms'] + k['duration_ms'] + ag.GAP_MS and k['at_ms'] < end + ag.GAP_MS for k in out if k.get('template') != 'chapter'):
            continue
        used[m['logo']] += 1
        placed.append(g)
        out.append(g)
    return sorted(out, key=lambda g: g['at_ms'])
