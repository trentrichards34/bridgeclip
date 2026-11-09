"""The call to action the speaker SAYS ("click the link below", "comment GUIDE", "follow for more"), found in the
transcript without any AI call, and the graphic that shows it.

Shared by Create's automatic graphics (ai_clipping_pipeline, source time) and Edit my recording / Combine clips
(edit_recording.render_edit, reel time). Deterministic: the same words always give the same answer.

- find_spoken_cta: the strongest call to action said near the end (or inside the span the edit plan marked as the
  call to action), with its kind (link, comment, dm, follow, save, share), the words on the button (exactly as said:
  "Hit the link"), where the link is (as said: "below", "in my bio"), a comment or DM keyword when one is said, a
  short line said right after it ("Get all the details") and its timing. Nothing is made up: every word shown is a
  word the speaker said, in the order said.
- cta_graphic: the editor graphic for it: `link_cta` (a button a pointer taps, an arrow toward the link), or
  `comment_cta` for a comment keyword. Timed to the words, held about 2-4 s, a card (never the stage: the speaker's
  face stays on screen for the call to action) in the band that covers the face least (cta_placement): over a
  talking head that is the top, above the head (the band over the captions would cover the mouth).
- with_cta: the clip's graphics with it added when none shows a call to action there already: automatic graphics in
  its way give way; the member's own graphics win.
"""
from __future__ import annotations

import re
import secrets
from typing import Any, Optional, Sequence

KINDS = ('link', 'comment', 'dm', 'follow', 'save', 'share')
# The strongest kind wins when several are said (a link is what the call is for; "follow" is often an extra).
PRIORITY = {'link': 5, 'comment': 4, 'dm': 4, 'follow': 2, 'save': 2, 'share': 1}
# Without a span from the plan, a call to action counts in the last this-much of the video (the larger of the two).
TAIL_MS = 25_000
TAIL_SHARE = 0.3
# The graphic: on just before its first word, held this long after the last (2-4 s in all).
LEAD_MS = 150
HOLD_MS = 2200
MIN_MS, MAX_MS = 2500, 4000
SHORTEST_MS = 1500
# The member's comment keyword shows over a clip's last seconds (rendering_service: "Comment KEYWORD").
KEYWORD_TAIL_MS = 4000
# Words between a phrase's parts, at most.
MAX_FILLER = 3
MAX_BUTTON_WORDS = 6
MAX_LEAD_WORDS = 5
# A pause this long ends a phrase (word timings without punctuation).
PAUSE_MS = 320
CTA_TEMPLATES = ('link_cta', 'comment_cta')

_PUNCT = re.compile(r"[^\w'$%-]+", re.UNICODE)
_END = re.compile(r'[.!?…;:]["\')\]]*$')
_COMMA = re.compile(r',["\')\]]*$')
_KEYWORD = re.compile(r'^[A-Za-z0-9][A-Za-z0-9-]{0,19}$')

LINK_VERBS = frozenset(('click', 'tap', 'hit', 'press', 'use', 'check', 'smash', 'visit', 'open', 'follow'))
LINK_FILLER = frozenset(('the', 'that', 'this', 'my', 'our', 'on', 'out', 'a', 'first', 'special', 'free', 'little'))
LINK_NOUNS = frozenset(('link', 'links'))
# Words that make the line about what happens (a tutorial: "then you click the link and it opens"), not a request.
DESCRIBING = frozenset(('you', 'i', 'we', 'they', 'he', 'she', 'people', 'someone', 'it', 'when', 'if', 'once', "you'll", "i'll", "we'll", 'will',
                        'can', 'could', 'would', 'might', 'gonna', 'should', 'who', 'then', 'after', 'before', 'until', 'they'))
# Before an imperative: the start of a sentence, a pause, or one of these.
OPENERS = frozenset(('just', 'so', 'and', 'now', 'then', 'go', 'simply', 'please', 'to', 'guys', 'ahead', 'definitely', 'make', 'sure',
                     'right', 'okay', 'ok', 'all', 'yeah', 'also', 'or', 'first', 'today'))
# Where the link is (consecutive words, as said); the arrow points down for these.
WHERE_PHRASES = (
    ('down', 'below'), ('below',), ('in', 'my', 'bio'), ('in', 'the', 'bio'), ('in', 'bio'), ('in', 'my', 'profile'),
    ('on', 'my', 'profile'), ('in', 'the', 'description'), ('in', 'the', 'caption'), ('in', 'the', 'comments'),
    ('in', 'the', 'pinned', 'comment'), ('down', 'there'), ('right', 'here'), ('on', 'screen'), ('where', 'you', 'see', 'it'),
)
POINTS_DOWN = re.compile(r'\b(below|bio|profile|description|caption|comments?|down)\b', re.IGNORECASE)
# A short line right after the call ("get all the details") starts with one of these.
LEAD_STARTS = frozenset(('get', 'grab', 'learn', 'see', 'download', 'claim', 'join', 'watch', 'start', 'find', 'book', 'save', 'access'))
STOP_AFTER = frozenset(('and', 'so', 'but', 'because', 'let', "let's", 'if', 'then', 'or', 'cause', "'cause", 'which', 'that', 'who'))
SIGNUP = (
    (('sign', 'up'), ()), (('signup',), ()), (('register',), ('now', 'today', 'here', 'below', 'for')),
    (('join',), ('now', 'today', 'us', 'free', 'for', 'the', 'my', 'our')),
    (('grab',), ('it', 'yours', 'your', 'a', 'this', 'the')), (('get',), ('access', 'yours', 'instant')),
    (('download',), ('it', 'the', 'my', 'this', 'yours')), (('claim',), ('your', 'yours', 'it', 'the')),
    (('apply',), ('now', 'today', 'here', 'below')), (('book',), ('a', 'your')),
)
# After "comment": words that aren't the keyword (the keyword is the first word that is not one of these).
NOT_KEYWORD = frozenset(('the', 'word', 'words', 'below', 'down', 'and', 'a', 'an', 'with', 'your', 'you', 'if', 'what', 'on', 'this',
                         'that', 'it', 'me', 'for', 'to', 'in', 'here', 'now', 'please', 'just', 'letter', 'phrase', 'emoji', 'yes',
                         'so', 'i', "i'll", 'we', 'section', 'box', 'let', 'about', 'which', 'right', 'something', 'anything',
                         'one', 'some', 'more', 'all', 'too', 'thoughts', 'think'))
NOUN_BEFORE = frozenset(('a', 'the', 'that', 'this', 'your', 'my', 'his', 'her', 'their', 'one', 'every', 'each', 'no', 'any', 'first', 'top', 'his'))


def _token(raw: str) -> str:
    return _PUNCT.sub('', str(raw).lower().replace('’', "'")).strip("'-")


def _display(raw: str) -> str:
    """A word as shown: its letters, without the punctuation around it."""
    return re.sub(r'^[“"‘(\[]+|[”"’)\],.;:!?…]+$', '', str(raw).strip())


def _capital(text: str) -> str:
    return text[:1].upper() + text[1:] if text else text


class _Words:
    """The words in order (text, start ms, end ms) with what ends a phrase."""

    def __init__(self, words: Sequence[Sequence[Any]]):
        self.raw: list[str] = []
        self.tok: list[str] = []
        self.start: list[int] = []
        self.end: list[int] = []
        for w in words:
            if not isinstance(w, (list, tuple)) or len(w) < 3:
                continue
            tok = _token(w[0])
            if not tok:
                continue
            self.raw.append(str(w[0]))
            self.tok.append(tok)
            self.start.append(int(w[1]))
            self.end.append(max(int(w[1]), int(w[2])))

    def __len__(self) -> int:
        return len(self.tok)

    def at(self, i: int) -> str:
        return self.tok[i] if 0 <= i < len(self.tok) else ''

    def breaks_after(self, i: int) -> bool:
        """A sentence ends (or the speaker pauses) after word i."""
        if i < 0:
            return True
        if i + 1 >= len(self.tok):
            return True
        return bool(_END.search(self.raw[i]) or _COMMA.search(self.raw[i])) or self.start[i + 1] - self.end[i] >= PAUSE_MS

    def opens(self, i: int) -> bool:
        """Word i can start a request: a new sentence or pause before it, or an opener ("just", "so", "go")."""
        return self.breaks_after(i - 1) or self.at(i - 1) in OPENERS or self.at(i - 1) in ('ahead', "let's")

    def text(self, a: int, b: int) -> str:
        return ' '.join(w for w in (_display(self.raw[k]) for k in range(a, b + 1)) if w)

    def matches(self, i: int, phrase: Sequence[str]) -> bool:
        return all(self.at(i + k) == p for k, p in enumerate(phrase))


def _where_at(w: _Words, i: int, reach: int = 4) -> Optional[tuple[int, int]]:
    """A where phrase starting within `reach` words of i (filler words "is", "it's", "that's", "the link" between)."""
    k = i
    for _ in range(reach + 1):
        for phrase in WHERE_PHRASES:
            if w.matches(k, phrase):
                return k, k + len(phrase) - 1
        if w.at(k) not in ('is', "it's", "that's", 'the', 'link', 'thats', 'its', 'at', 'which', 'in', 'my', 'right', 'down', 'up', 'there'):
            return None
        if k > i and w.breaks_after(k - 1):
            return None
        k += 1
    return None


def _lead_after(w: _Words, i: int) -> Optional[tuple[int, int]]:
    """A short line said right after word i ("get all the details"), up to MAX_LEAD_WORDS words, or None."""
    k = i + 1
    if w.at(k) in ('and', 'to') and w.at(k + 1) in LEAD_STARTS:
        k += 1
    if w.at(k) not in LEAD_STARTS:
        return None
    end = k
    while end + 1 < len(w) and end - k + 1 < MAX_LEAD_WORDS and not w.breaks_after(end) and w.at(end + 1) not in STOP_AFTER:
        end += 1
    if end - k + 1 < 2 or (end + 1 < len(w) and not w.breaks_after(end) and w.at(end + 1) not in STOP_AFTER):
        return None
    return k, end


def _keyword_after(w: _Words, i: int, reach: int = 3) -> Optional[int]:
    """The comment (or DM) keyword said after word i: the first word that isn't filler ("the word GUIDE")."""
    for k in range(i + 1, min(len(w), i + 1 + reach)):
        tok = w.at(k)
        if tok in NOT_KEYWORD:
            if w.breaks_after(k) and tok not in ('word', 'the'):
                return None
            continue
        shown = _display(w.raw[k]).strip('"“”\'')
        return k if _KEYWORD.match(shown) else None
    return None


def _candidates(w: _Words, lo: int, hi: int) -> list[dict]:
    out: list[dict] = []

    def add(kind: str, a: int, b: int, end: Optional[int] = None, **extra: Any) -> None:
        out.append({'kind': kind, 'a': a, 'b': b, 'end': end if end is not None else b, **extra})

    for i in range(lo, hi + 1):
        tok = w.at(i)
        prev = w.at(i - 1)
        # Someone described doing it ("then you click the link"), not a request (a sentence break before ends that).
        described = prev in DESCRIBING and not w.breaks_after(i - 1)
        # "click the link", "tap the link below", "hit the link where you see it", "check out the link in my bio" (a verb
        # and "link" is a request unless someone is described doing it: "then you click the link").
        if tok in LINK_VERBS and not described:
            for k in range(i + 1, min(len(w), i + 2 + MAX_FILLER)):
                if w.at(k) in LINK_NOUNS:
                    add('link', i, k)
                    break
                if w.at(k) not in LINK_FILLER or w.breaks_after(k):
                    break
        # "link in my bio", "the link is below", "link down below" (no verb: the words up from "link").
        # (Not when a request just before already leads to it: "sign up at the link below" is "Sign up", below.)
        if tok in LINK_NOUNS and not any(c['kind'] == 'link' and c['a'] >= i - 6 for c in out):
            where = _where_at(w, i + 1, 3)
            if where and POINTS_DOWN.search(w.text(*where)) and not described:
                add('link', i, where[1], button_where=True)
        # "sign up", "join now", "grab yours", "get access", "download it".
        for phrase, nexts in SIGNUP:
            if w.matches(i, phrase) and w.opens(i) and not described:
                b = i + len(phrase) - 1
                if nexts and w.at(b + 1) not in nexts:
                    continue
                # The phrase as said, up to its object ("grab your copy", "join the waitlist"), never past a pause.
                end = b
                while end + 1 < len(w) and end - i + 1 < 4 and not w.breaks_after(end) and nexts and w.at(end + 1) not in STOP_AFTER \
                        and (w.at(end + 1) in nexts or w.at(end) in nexts) and w.at(end + 1) not in LINK_VERBS:
                    end += 1
                add('link', i, end, signup=True)
        # "comment GUIDE", "comment the word AI below", "comment below".
        if tok == 'comment' and prev not in NOUN_BEFORE and not described and (w.opens(i) or prev in ('and',)):
            key = _keyword_after(w, i)
            add('comment', i, key if key is not None else i, keyword=_display(w.raw[key]).strip('"“”\'').upper() if key is not None else '')
        # "type GUIDE below", "drop AI in the comments".
        if tok in ('type', 'drop', 'write', 'put') and w.opens(i) and not described:
            key = _keyword_after(w, i, 2)
            if key is not None and any(w.at(k) in ('comments', 'comment', 'below') for k in range(key + 1, key + 5)):
                add('comment', i, key, keyword=_display(w.raw[key]).strip('"“”\'').upper())
        # "leave a comment", "drop a comment", "let me know in the comments".
        if tok in ('leave', 'drop') and w.at(i + 1) in ('a', 'me') and w.at(i + 2) == 'comment' and w.opens(i):
            add('comment', i, i + 2, keyword='')
        if w.matches(i, ('let', 'me', 'know', 'in', 'the', 'comments')) and w.opens(i):
            add('comment', i, i + 5, keyword='')
        # "DM me", "send me a DM", "message me" (and a keyword: "DM me GUIDE", "DM me the word AI").
        if (tok == 'dm' and w.at(i + 1) == 'me') or (tok == 'message' and w.at(i + 1) == 'me' and prev not in NOUN_BEFORE):
            if w.opens(i) and not described:
                key = _keyword_after(w, i + 1)
                add('dm', i, i + 1, end=key if key is not None else i + 1,
                    keyword=_display(w.raw[key]).strip('"“”\'').upper() if key is not None else '')
        if w.matches(i, ('send', 'me', 'a')) and w.at(i + 3) in ('dm', 'message') and w.opens(i):
            key = _keyword_after(w, i + 3)
            add('dm', i, i + 3, end=key if key is not None else i + 3,
                keyword=_display(w.raw[key]).strip('"“”\'').upper() if key is not None else '')
        # "follow for more", "follow me", "hit follow", "subscribe".
        if tok == 'follow' and w.opens(i) and not described and w.at(i + 1) in ('me', 'for', 'along', 'us', 'the', 'my', 'this'):
            end = i + 1
            while end + 1 < len(w) and end - i + 1 < 4 and not w.breaks_after(end) and w.at(end + 1) not in STOP_AFTER and w.at(end + 1) not in LINK_VERBS:
                end += 1
            add('follow', i, end)
        if tok == 'hit' and w.at(i + 1) in ('follow', 'subscribe') and w.opens(i):
            add('follow', i, i + 1)
        if tok in ('subscribe', 'subscribed') and w.opens(i) and not described:
            add('follow', i, i)
        # "save this (for later)", "bookmark this".
        if tok in ('save', 'bookmark') and w.at(i + 1) in ('this', 'it') and w.opens(i) and not described:
            end = i + 1
            if w.at(i + 2) in ('video', 'post', 'reel'):
                end = i + 2
            if w.at(end + 1) == 'for' and w.at(end + 2) == 'later':
                end += 2
            add('save', i, end)
        # "share this with a friend", "send this to someone".
        if (tok == 'share' and w.at(i + 1) in ('this', 'it')) or (tok == 'send' and w.at(i + 1) == 'this' and w.at(i + 2) == 'to'):
            if w.opens(i) and not described:
                end = i + 1
                while end + 1 < len(w) and end - i + 1 < 6 and not w.breaks_after(end) and w.at(end + 1) not in STOP_AFTER:
                    end += 1
                add('share', i, end)
    return out


def find_spoken_cta(words: Sequence[Sequence[Any]], span: Optional[tuple[int, int]] = None,
                    window: Optional[tuple[int, int]] = None) -> Optional[dict]:
    """The call to action the speaker says, or None.

    `words`: (text, start ms, end ms) in order. `span`: (first, last) word index of the call to action the edit plan
    marked (searched first, with a few words around it). `window`: (start ms, end ms) of the video (default: the
    words' own span); without a span, only the last max(TAIL_MS, TAIL_SHARE) of it counts.

    Returns {kind, text, where, keyword, lead, start_ms, end_ms, first, last} (first/last: word indices into the
    words given, after empty ones are skipped), every text field words the speaker said."""
    w = _Words(words)
    if not len(w):
        return None
    found: list[dict] = []
    if span is not None and isinstance(span, (tuple, list)) and len(span) == 2:
        a, b = max(0, int(span[0]) - 2), min(len(w) - 1, int(span[1]) + 2)
        if a <= b:
            found = _candidates(w, a, b)
    if not found:
        start, end = window if window else (w.start[0], w.end[-1])
        tail = max(TAIL_MS, (end - start) * TAIL_SHARE)
        lo = next((k for k in range(len(w)) if w.start[k] >= end - tail), len(w))
        found = _candidates(w, lo, len(w) - 1)
    if not found:
        return None
    # One request per phrase: a candidate inside the words of an earlier one ("click the link below to grab it")
    # belongs to it.
    described, last = [], -1
    for c in sorted(found, key=lambda c: (c['a'], -PRIORITY[c['kind']])):
        if c['a'] <= last:
            continue
        d = _describe(w, c)
        described.append((c, d))
        last = d['last']
    return max(described, key=lambda cd: (PRIORITY[cd[0]['kind']], cd[0]['a']))[1]


def _describe(w: _Words, c: dict) -> dict:
    kind, a, b, end = c['kind'], c['a'], c['b'], c['end']
    button = w.text(a, min(b, a + MAX_BUTTON_WORDS - 1))
    where = ''
    if kind == 'link' and not c.get('button_where'):
        spot = _where_at(w, b + 1)
        if spot:
            where = w.text(*spot)
            end = max(end, spot[1])
    keyword = c.get('keyword') or ''
    if kind == 'dm' and keyword:
        button = f'{button} {keyword}'
    lead = ''
    if kind in ('link', 'dm', 'comment'):
        after = _lead_after(w, end)
        if after:
            lead = _capital(w.text(*after))
            end = after[1]
    text = _capital(button)
    if kind == 'link' and text.lower().startswith('link'):
        text = 'Link' + text[4:]
    if kind == 'dm':
        text = re.sub(r'^dm\b', 'DM', text, flags=re.IGNORECASE)
    return {'kind': kind, 'text': text, 'where': where, 'keyword': keyword if kind in ('comment', 'dm') else '', 'lead': lead,
            'start_ms': w.start[a], 'end_ms': w.end[end], 'first': a, 'last': end}


def points_down(fields: dict) -> bool:
    """The arrow points down: where the link is (or the button's own words) says below, bio, description…"""
    return bool(POINTS_DOWN.search(f"{fields.get('where', '')} {fields.get('text', '')}"))


# ---------------------------------------------------------------------------
# The graphic
# ---------------------------------------------------------------------------

# Where a card's content sits on a 9:16 frame with captions on (graphic-layout.graphicBox, content anchored to its band
# edge): the top band from under the platform's top bar, the bottom one just over the captions.
TOP_SPAN = (0.08, 0.30)
BOTTOM_SPAN = (0.47, 0.62)


def cta_placement(face: Optional[Sequence[float]]) -> str:
    """'top' or 'bottom': the one that covers the face (x, y, w, h fractions) least; top without a face (a talking
    head's face sits in the middle, under the top band)."""
    if not face or len(face) != 4 or not face[3] > 0:
        return 'top'
    a, b = float(face[1]), float(face[1]) + float(face[3])
    cover = lambda span: max(0.0, min(b, span[1]) - max(a, span[0]))  # noqa: E731
    return 'bottom' if cover(BOTTOM_SPAN) < cover(TOP_SPAN) - 0.01 else 'top'


def clean_keyword(value: Any) -> str:
    text = str(value or '').strip().strip('"“”\'').upper()
    return text if _KEYWORD.match(text) else ''


def cta_graphic(cta: dict, clip_start: int, clip_end: int, keyword: str = '', keyword_shown: bool = False,
                taken: Optional[set] = None, face: Optional[Sequence[float]] = None) -> Optional[dict]:
    """The editor graphic for a spoken call to action (times in the clip's own clock: ms), or None.

    `keyword`: the member's comment keyword (Settings); `keyword_shown`: the clip already shows it at its end (Create's
    "Comment KEYWORD", the comment box extra), so a comment request gets no second prompt and nothing else plays over
    those last seconds."""
    if not cta or cta.get('kind') not in KINDS:
        return None
    member = clean_keyword(keyword)
    end_limit = clip_end - (KEYWORD_TAIL_MS if keyword_shown and member else 0)
    if cta['kind'] == 'comment':
        if keyword_shown and member:
            return None
        said = clean_keyword(cta.get('keyword'))
        # The member's keyword when the speaker says it (or asks for comments without one); else the word they say.
        chosen = member if member and (not said or said == member) else said
        if not chosen:
            template, fields = 'link_cta', {'text': cta['text'], 'kind': 'comment'}
        else:
            template, fields = 'comment_cta', {'keyword': chosen, 'lead': 'Comment'}
    else:
        template = 'link_cta'
        fields = {'text': cta['text'], 'kind': cta['kind']}
        if cta.get('where'):
            fields['where'] = cta['where']
    if template == 'link_cta' and cta.get('lead'):
        fields['lead'] = cta['lead']
    at = max(clip_start, int(cta['start_ms']) - LEAD_MS)
    length = max(MIN_MS, min(MAX_MS, int(cta['end_ms']) + HOLD_MS - at))
    if at + length > end_limit:
        # Near the end: start a little earlier (never before its words come) or play shorter.
        length = end_limit - at
    if length < SHORTEST_MS:
        return None
    taken = taken if taken is not None else set()
    gid = _new_id(taken)
    return {'id': gid, 'template': template, 'at_ms': int(at), 'duration_ms': int(length), 'placement': cta_placement(face), 'fields': fields,
            'origin': 'auto', 'size': 'card'}


def _new_id(taken: set) -> str:
    while True:
        gid = f'g-{secrets.token_hex(5)}'
        if gid not in taken:
            taken.add(gid)
            return gid


def _overlap(a: dict, b: dict) -> bool:
    return a['at_ms'] < b['at_ms'] + b['duration_ms'] and b['at_ms'] < a['at_ms'] + a['duration_ms']


def with_cta(graphics: Sequence[dict], cta_g: Optional[dict], min_ms: int = 800, gap_ms: int = 150) -> list[dict]:
    """`graphics` with the call to action graphic added (in time order), unless one already shows a call to action
    near it (the planner's or the member's comment prompt, a call to action the member added) or one of the member's
    own graphics plays then. Automatic graphics in its way end just before it (when at least `min_ms` is left) or go;
    so does a logo pop (a short pop as a name is said, often the product named in the ask: the ask's graphic wins).
    Chapter headers stay (their own band at the top)."""
    out = [dict(g) for g in graphics or []]
    if not cta_g:
        return out
    near = {**cta_g, 'at_ms': cta_g['at_ms'] - 1000, 'duration_ms': cta_g['duration_ms'] + 2000}
    if any(g.get('template') in CTA_TEMPLATES and _overlap(g, near) for g in out):
        return out
    if any(g.get('origin') in ('member', 'chat') and g.get('template') not in ('chapter', 'logo') and _overlap(g, cta_g) for g in out):
        return out
    kept = []
    for g in out:
        if g.get('template') == 'chapter' or not _overlap(g, cta_g):
            kept.append(g)
            continue
        room = cta_g['at_ms'] - gap_ms - g['at_ms']
        if g['at_ms'] < cta_g['at_ms'] and room >= min_ms:
            fields = dict(g.get('fields') or {})
            for key in ('word_ms', 'item_ms'):
                if fields.get(key):
                    fields[key] = '\n'.join(str(min(int(t), max(0, room - 300))) for t in str(fields[key]).split('\n') if t.strip().isdigit())
            kept.append({**g, 'duration_ms': int(room), 'fields': fields})
    kept.append(dict(cta_g))
    return sorted(kept, key=lambda g: g['at_ms'])


def clear_scenes(scenes: Sequence[dict], window: Optional[tuple[int, int]], min_scene_ms: int = 1200) -> list[dict]:
    """Stage or Visual scenes cut around `window` (start ms, end ms): the speaker's face stays on screen for the call
    to action (pieces shorter than `min_scene_ms` go)."""
    if not window:
        return [dict(s) for s in scenes or []]
    a, b = window
    out = []
    for s in scenes or []:
        for lo, hi in ((s['start_ms'], min(s['end_ms'], a)), (max(s['start_ms'], b), s['end_ms'])):
            if hi - lo >= min_scene_ms:
                out.append({**s, 'start_ms': int(lo), 'end_ms': int(hi)})
    return sorted(out, key=lambda s: s['start_ms'])


# ---------------------------------------------------------------------------
# The two pipelines
# ---------------------------------------------------------------------------

def segment_words(segments: Sequence[Any], lo: float, hi: float) -> list[tuple[str, int, int]]:
    """(text, start ms, end ms) of each word said between lo and hi (TranscriptSegment-like objects with words)."""
    out = []
    for seg in segments or []:
        if getattr(seg, 'end_time_ms', 0) < lo or getattr(seg, 'start_time_ms', 0) > hi:
            continue
        for word in getattr(seg, 'words', None) or []:
            s, e = int(word.start_time_ms), int(word.end_time_ms)
            if lo <= s < hi:
                out.append((str(word.word), s, e))
    return out


def create_cta(segments: Sequence[Any], ranges: Sequence[Sequence[float]], keyword: str = '', keyword_shown: bool = False,
               taken: Optional[set] = None) -> Optional[dict]:
    """Create (source time): the clip's call to action graphic from the words kept in its `ranges` (the finished
    cut's source spans), or None. Words cut out of the clip never show."""
    spans = [(int(a), int(b)) for a, b in ranges or [] if b > a]
    if not spans:
        return None
    words = [w for w in segment_words(segments, spans[0][0], spans[-1][1]) if any(a <= w[1] < b for a, b in spans)]
    # Measure the clip's tail on its output clock (cuts removed), so a cut-heavy clip isn't searched too far back.
    total = sum(b - a for a, b in spans)
    cta = find_spoken_cta(words, window=(spans[-1][1] - total, spans[-1][1]))
    if not cta:
        return None
    return cta_graphic(cta, spans[0][0], spans[-1][1], keyword, keyword_shown, taken)


def edit_cta(timed: Sequence[Sequence[Any]], span: Optional[tuple[int, int]], total_ms: int, offset_ms: int = 0,
             keyword: str = '', keyword_shown: bool = False, taken: Optional[set] = None,
             face: Optional[Sequence[float]] = None) -> Optional[dict]:
    """Edit my recording / Combine clips (reel time + `offset_ms`): the reel's call to action graphic from its timed
    words (text, start ms, end ms, word index), using the plan's call to action span (word indices) when it has one."""
    rows = [t for t in timed or [] if len(t) >= 4 and _token(t[0])]
    words = [(str(t[0]), int(t[1]) + offset_ms, int(t[2]) + offset_ms) for t in rows]
    local_span = None
    if span is not None:
        positions = [k for k, t in enumerate(rows) if span[0] <= int(t[3]) <= span[1]]
        if positions:
            local_span = (positions[0], positions[-1])
    end = offset_ms + int(total_ms)
    cta = find_spoken_cta(words, local_span, window=(offset_ms, end))
    if not cta:
        return None
    return cta_graphic(cta, offset_ms, end, keyword, keyword_shown, taken, face)
