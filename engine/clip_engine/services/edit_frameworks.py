"""The Paid Creators Triple Hook for Edit my recording's and Combine clips' headline (the text on screen).

Create clips already plans and grades with the frameworks (framework_grader, hook_ideas, intelligence_planner). Here
the same Triple Hook Playbook shapes a member's own headline: the spoken hook line and the headline together should
stack the qualifier, the main statement and the twist. The headline supplies what the line is missing, using only
words the member said (edit_recording.headline_said), exact numbers first, in their own voice (their own words are).

- A headline that only repeats its hook line becomes said words that add a missing element.
- Every hook gets up to three headline options that stack more of the Triple Hook (src/shared/triple-hook.ts shows
  which elements the line and each option have, quoted, and uses an option in one click).

Only the text: which line opens the video and what is cut stay exactly as planned. The element detection is a
plain-words heuristic (patterns from the Playbook), mirrored in src/shared/triple-hook.ts.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

from clip_engine.services import edit_recording as er
from clip_engine.services.framework_grader import _normalize

logger = logging.getLogger(__name__)

ROLES = ("qualifier", "main_statement", "twist")
ROLE_NAMES = {"qualifier": "qualifier", "main_statement": "main statement", "twist": "twist", "stakes": "stakes"}
MAX_OPTIONS = 3
MAX_QUOTE_WORDS = 24
HEADLINE_MIN_WORDS = 3

# ---------------------------------------------------------------------------
# Triple Hook elements in plain words
# ---------------------------------------------------------------------------

_NUMW = (r"(?:\d[\d,]*(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|"
         r"forty|fifty|hundred|a hundred|a thousand|thousand|million|billion)")
_SCALE = r"(?:\s(?:hundred|thousand|million|billion))?"
_UNITS = (r"(?:people|leads|clients|customers|sales|buyers|followers|views|subscribers|students|members|steps|ways|things|"
          r"tips|reasons|lessons|modules|offers|courses|products|orders|deals|signups|downloads|likes|comments|shares|copies|books|days|weeks|months|years|hours|minutes|times|videos|posts|calls)")
SPECIFIC = [
    r"\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million|thousand|billion)\b)?",
    rf"\b{_NUMW}{_SCALE}\s?(?:%|percent\b|x\b|k\b|dollars\b|bucks\b)",
    rf"\b{_NUMW}{_SCALE}(?:\s[a-z]+)?\s{_UNITS}\b",
]
VAGUE_RESULT = [
    r"\b(?:make|made|making|earn|earned|earning|generat\w*)\b(?:\s\S+){0,5}?\s(?:money|profit|income|sales|revenue)\b",
    r"\bprofitable\b", r"\bwent from\b", r"\b(?:doubled|tripled)\b",
]
QUALIFIER = [
    r"\byou(?:'re| are) (?:not |never )?(?:going to|gonna) believe\b",
    r"\bi (?:probably )?(?:shouldn't|should not) (?:be )?(?:tell|say|shar)\w*",
    r"\b(?:everyone|everybody|most people) (?:thinks?|says?|tells? you|believes?)\b",
    r"\bthis is (?:the moment|embarrassing)\b",
    r"\bcontroversial\b",
    r"\bnot to (?:flex|brag)\b",
    r"\bembarrassing to admit\b",
    r"\bi can(?:'t|not| not) stress this enough\b",
    r"\bnobody (?:tells|talks|will tell)\b",
    r"\bhere's the (?:truth|thing)\b", r"\bthe truth is\b",
    r"\bi(?:'m| am) (?:going to|gonna) prove\b",
    r"\bas an? [a-z]+(?: [a-z]+)?, (?:we|you) (?:both )?know\b",
    r"\bmost people are (?:petrified|scared|afraid|terrified)\b",
    r"\bi never thought\b",
]
TWIST = [
    r"\bwithout\b",
    r"\b(?:do not|don't|dont|doesn't|does not) (?:have to|need)\b",
    r"\bno need to\b",
    r"\b(?:despite|even though|even if)\b",
    r"\binstead\b",
    r"\bneither did i\b",
    r"\bi(?:'m| am) (?:a )?(?:virtual )?nobody\b",
    r"\bnot (?:an?|some) (?:influencer|celebrity|expert|guru)\b",
    r"\b(?:told me not to|breaking the (?:number one |first )?rule)\b",
    r"\bonly (?:worked|spent|took|needed|had|used)\b",
]
STAKES = [r"\bor (?:i|we) (?:have to|lose|pay|owe)\b", r"\bif (?:i|we) (?:don't|fail|lose)\b", r"\bon the line\b", r"\bor else\b"]
# The how: a headline never gives it away ("Don't show them that until the end").
METHOD = [
    r"\bhere's how\b", r"\bthe (?:secret|trick|key|answer) is\b", r"\b(?:step|tip) (?:one|1|number one)\b",
    r"\bwhat (?:i|you) (?:do|did) (?:is|was)\b", r"\ball you (?:have|need) to do is\b",
    r"\bthe way (?:i|you) (?:do|did) (?:it|this|that) is\b", r"\bfirst,? you\b",
]
RESULT_WORDS = re.compile(r"\b(?:made|make|making|generat\w*|earn\w*|profit\w*|revenue|sales|grew|doubled|tripled)\b", re.I)

# Weak words a quoted fragment does not start on.
LEAD_FILLERS = {"so", "and", "okay", "ok", "alright", "well", "yeah", "anyway", "basically", "look", "hey", "hi", "hello", "yo",
                "um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "hmm", "mm"} | er.FILLERS
# Words that start a sentence the transcription ran on into the last one ("…on ads Now that's…").
STARTERS = {"Now", "So", "But", "And", "Then", "Okay", "Alright", "Yesterday", "Today"}
DANGLING = {"a", "an", "the", "to", "and", "of", "that", "in", "on", "for", "with", "or", "but", "my", "your", "our", "is", "was"}


def _clean(text: str) -> str:
    return " ".join(str(text or "").replace("’", "'").split())


def _find(patterns: list[str], text: str) -> Optional[re.Match]:
    hits = [m for m in (re.search(p, text, re.I) for p in patterns) if m]
    return min(hits, key=lambda m: m.start()) if hits else None


def _starter(token: str) -> bool:
    return token.strip(".,!?;:") in STARTERS


def _ends_clause(token: str) -> bool:
    return bool(re.search(r"[.!?;:,—–][\"')\]”’]*$", token))


def _quote(text: str, a: int, b: int, max_words: int = MAX_QUOTE_WORDS) -> str:
    """The clause of `text` around characters a..b, verbatim (at most `max_words` words, leading filler dropped)."""
    tokens = [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]
    if not tokens:
        return ""
    first = next((k for k, (_, e) in enumerate(tokens) if e > a), 0)
    last = max([k for k, (s, _) in enumerate(tokens) if s < b] or [first])
    word = lambda k: text[tokens[k][0]:tokens[k][1]]  # noqa: E731
    left = first
    while left > 0 and not _ends_clause(word(left - 1)) and not _starter(word(left)):
        left -= 1
    right = last
    while right < len(tokens) - 1 and not _ends_clause(word(right)) and not _starter(word(right + 1)):
        right += 1
    while right - left + 1 > max_words:
        # Trim the side farther from the match.
        if (first - left) > (right - last):
            left += 1
        else:
            right -= 1
    while left < first and _key(word(left)) in LEAD_FILLERS:
        left += 1
    return text[tokens[left][0]:tokens[right][1]].strip(" ,;:—–\"“”")


def _key(token: str) -> str:
    return er.norm(token)


def detect_elements(text: str) -> dict[str, Any]:
    """The Triple Hook elements in a line or a headline: {qualifier, main_statement, twist, stakes} as exact quotes
    (None when absent), and `specific` (the main statement carries an exact number)."""
    text = _clean(text)
    out: dict[str, Any] = {"qualifier": None, "main_statement": None, "twist": None, "stakes": None, "specific": False}
    if not text:
        return out
    for role, patterns in (("qualifier", QUALIFIER), ("twist", TWIST), ("stakes", STAKES)):
        m = _find(patterns, text)
        if m:
            out[role] = _quote(text, m.start(), m.end())
    m = _find(SPECIFIC, text)
    if m:
        out["main_statement"], out["specific"] = _quote(text, m.start(), m.end()), True
    else:
        m = _find(VAGUE_RESULT, text)
        if m:
            out["main_statement"] = _quote(text, m.start(), m.end())
    return out


def roles_of(elements: dict) -> set[str]:
    return {role for role in ROLES if elements.get(role)}


def reveals_method(text: str) -> bool:
    return _find(METHOD, _clean(text)) is not None


def has_money(text: str) -> bool:
    return bool(re.search(SPECIFIC[0], text))


# ---------------------------------------------------------------------------
# The opening
# ---------------------------------------------------------------------------

def _kept(words: list[er.Word], marks: list[Optional[str]], start: int, end: int) -> list[int]:
    return [i for i in range(start, end + 1) if marks[i] is None]


def line_text(words: list[er.Word], marks: list[Optional[str]], start: int, end: int) -> str:
    return " ".join(words[i].text for i in _kept(words, marks, start, end))


def _similar(a: str, b: str) -> bool:
    ta, tb = _normalize(a).split(), _normalize(b).split()
    if not ta or not tb:
        return False
    shared = len(set(ta) & set(tb))
    return shared / max(1, min(len(set(ta)), len(set(tb)))) >= 0.75


def _units(words: list[er.Word], marks: list[Optional[str]], skip: set[int]) -> list[tuple[int, str]]:
    """Kept sentences (as said) outside `skip`: (first word index, text). A capitalized "Now"/"So"… mid-line starts a
    new one (transcripts often run sentences together)."""
    out: list[tuple[int, str]] = []
    for line in er.lines_of(words):
        current: list[int] = []
        quoted, inside = False, False

        def flush() -> None:
            # Someone else's words, quoted ("people are saying, 'I don't have…'"), are never the member's headline.
            if current and not quoted:
                out.append((current[0], " ".join(words[k].text for k in current)))
        for i in line:
            marks_quote = len(re.findall(r"[\"“”]", words[i].text))
            if marks[i] is not None or i in skip or (current and _starter(words[i].text)):
                flush()
                current, quoted = [], False
                if marks[i] is not None or i in skip:
                    inside = inside != bool(marks_quote % 2)
                    continue
            if marks_quote or inside:
                quoted = True
            inside = inside != bool(marks_quote % 2)
            current.append(i)
        flush()
    return out


def headline_candidates(words: list[er.Word], marks: list[Optional[str]], skip: set[int], have: dict) -> list[dict]:
    """Short phrases the member said that add a missing Triple Hook element to the opening, best first:
    {text, adds: [roles], score}. Exact numbers (money first) and results rank higher; anything that gives away the
    how, quotes someone else or dangles is dropped or ranked down."""
    present = roles_of(have)
    out: list[dict] = []
    seen: set[str] = set()
    for _, sentence in _units(words, marks, skip):
        found = detect_elements(sentence)
        for role in (*ROLES, "stakes"):
            quote = found.get(role)
            if not quote:
                continue
            quote = _quote(quote, 0, len(quote), er.MAX_HOOK_TEXT_WORDS)
            n = len(quote.split())
            key = _normalize(quote)
            if key in seen or n < HEADLINE_MIN_WORDS or n > er.MAX_HOOK_TEXT_WORDS or len(quote) > er.MAX_HOOK_TEXT_CHARS:
                continue
            seen.add(key)
            if re.search(r"[\"“”]", quote) or reveals_method(quote) or not er.headline_said(quote, words):
                continue
            mine = detect_elements(quote)
            adds = [r for r in ROLES if mine.get(r) and r not in present]
            upgrade = bool(mine["specific"]) and not have.get("specific")
            if not adds and not upgrade:
                continue
            score = 3.0 * len(adds) + (2.0 if upgrade else 0.0) + (2.0 if has_money(quote) else 0.0) + (1.0 if mine["specific"] else 0.0)
            score += 1.0 if RESULT_WORDS.search(quote) else 0.0
            score -= 0.15 * max(0, n - 6)
            if _key(quote.split()[0]) in ("that", "it", "this", "they", "he", "she", "which"):
                score -= 1.5
            if _key(quote.split()[-1]) in DANGLING:
                score -= 1.5
            if not adds and upgrade:
                adds = ["main_statement"]
            text = quote[0].upper() + quote[1:]
            out.append({"text": text.rstrip(",;:."), "adds": adds, "score": round(score, 2)})
    out.sort(key=lambda c: -c["score"])
    return out


def _lead_lower(text: str) -> str:
    """A fragment that now follows another: its first letter lowercased (not "I", "I'm" or a name-like all-caps word)."""
    first = text.split()[0] if text.split() else ""
    if re.match(r"^I(?:'|$)", first) or first.isupper():
        return text
    return text[:1].lower() + text[1:]


def compose(parts: list[tuple[str, str]]) -> str:
    """Said fragments (role, text) joined into one headline in Triple Hook order: "qualifier: main statement, twist"."""
    rank = {"qualifier": 0, "main_statement": 1, "twist": 2, "stakes": 3}
    ordered = sorted(parts, key=lambda p: rank.get(p[0], 1))
    out = ordered[0][1].strip().rstrip(".!,;:")
    for k, (role, text) in enumerate(ordered[1:], 1):
        text = text.strip().rstrip(".!,;:")
        joint = ": " if k == 1 and ordered[0][0] == "qualifier" else ", "
        out += joint + (text if role == "qualifier" else _lead_lower(text))
    return out


def _coverage(said_roles: set[str], said_specific: bool, text: str) -> tuple[set[str], bool]:
    """What the opening stacks with `text` as its headline: the spoken line's elements plus the headline's."""
    found = detect_elements(text)
    return said_roles | roles_of(found), bool(said_specific or found["specific"])


def headline_options(words: list[er.Word], marks: list[Optional[str]], skip: set[int], spoken: str, headline: str) -> list[dict]:
    """Up to three headlines of said words that stack more of the Triple Hook with the spoken line than `headline`,
    losing nothing it has (an exact number stays): the headline with a missing element joined on when it fits, or a
    phrase alone. Best first: [{text, adds}]."""
    said, current = detect_elements(spoken), detect_elements(headline)
    have = {**{r: said[r] or current[r] for r in ROLES}, "specific": bool(said["specific"] or current["specific"])}
    now_roles, now_specific = roles_of(have), bool(have["specific"])
    found: list[tuple[tuple, dict]] = []
    seen = {_normalize(headline)}
    for rank, c in enumerate(headline_candidates(words, marks, skip, have)):
        tries = []
        if headline.strip() and roles_of(current):
            main_role = next((r for r in ROLES if current.get(r)), "main_statement")
            tries.append(compose([(main_role, headline), (c["adds"][0] if c["adds"] else "main_statement", c["text"])]))
        tries.append(c["text"])
        for text in tries:
            key = _normalize(text)
            if (key in seen or len(text.split()) > er.MAX_HOOK_TEXT_WORDS or len(text) > er.MAX_HOOK_TEXT_CHARS
                    or not er.headline_said(text, words) or _key(text.split()[-1]) in DANGLING
                    or (has_money(headline) and not has_money(text))):
                continue
            roles, specific = _coverage(roles_of(said), bool(said["specific"]), text)
            if roles >= now_roles and (specific or not now_specific) and (roles > now_roles or (specific and not now_specific)):
                seen.add(key)
                found.append(((-len(roles), -int(specific), rank), {"text": text, "adds": c["adds"]}))
                break
    found.sort(key=lambda item: item[0])
    return [option for _, option in found[:MAX_OPTIONS]]


def stack_headlines(plan: dict, words: list[er.Word], replace: bool = True) -> None:
    """Each hook's headline and the Triple Hook, in place: a headline that only repeats its line becomes said words
    that add a missing element (the old text is kept as "repeated"), and each hook gets its headline options. The
    marks, spans and order are never touched. `replace` False: options only (a kept headline stays as it is)."""
    marks: list[Optional[str]] = plan["marks"]
    cta = plan.get("cta")
    for hook in plan.get("hooks") or []:
        spoken = line_text(words, marks, hook["start"], hook["end"])
        skip = set(range(hook["start"], hook["end"] + 1)) | (set(range(cta["start"], cta["end"] + 1)) if cta else set())
        text = hook.get("text") or ""
        if replace and (not text.strip() or _similar(text, spoken)):
            best = next(iter(headline_candidates(words, marks, skip, detect_elements(spoken))), None)
            if best and _normalize(best["text"]) != _normalize(text):
                hook["repeated"] = text
                hook["text"] = text = best["text"]
        hook["options"] = headline_options(words, marks, skip, spoken, text)
