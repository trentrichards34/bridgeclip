"""
Spoken numbers written as digits for captions ("fifteen billion" -> "15 billion", "twenty five percent" -> "25%").

The words of one number become one caption token spanning their times, so the karaoke timing keeps the original
word groups. Only clear quantities are converted: a number of two or more words, 10 or more, followed by
percent or dollars, or a small number (2-9) followed by a quantity word ("three steps"). "One time", "one of",
"no one" and other plain uses of small numbers are left as said. The word tables are shared with Edit my
recording's number check (edit_recording.numbers_in).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional, Sequence

UNITS = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
                                    "fifteen sixteen seventeen eighteen nineteen".split())}
TENS = {w: 10 * (i + 2) for i, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split())}
SCALES = {"hundred": 100, "thousand": 1e3, "k": 1e3, "million": 1e6, "m": 1e6, "mil": 1e6, "billion": 1e9, "b": 1e9, "bn": 1e9, "trillion": 1e12}

# Scales said as words (the short forms are only read after digits by edit_recording).
_BIG = {"thousand": 1e3, "million": 1e6, "billion": 1e9, "trillion": 1e12}
_NAMED = ("million", "billion", "trillion")
_PERCENT = ("percent", "%")
_DOLLARS = ("dollars", "dollar")
# A small number (2-9) is a quantity when one of these follows ("three steps", "five minutes").
QUANTITY_WORDS = frozenset((
    "seconds minutes hours days weeks months years decades times steps ways tips things reasons rules mistakes "
    "people kids children followers views likes subscribers sales clients customers students members pounds kilos "
    "miles reps sets ideas questions books videos posts hacks habits signs lessons secrets levels stages phases "
    "percent points dollars bucks grand"
).split())
_DIGITS = re.compile(r"^\d+(?:,\d{3})*(?:\.\d+)?$")
_LEAD = re.compile(r"^[\"'“‘(\[]+")
_TRAIL = re.compile(r"[\"'”’)\].,!?;:]+$")


@dataclass
class NumberSpan:
    """Words first..last (inclusive) are one number, shown as `text` (punctuation around it kept)."""

    first: int
    last: int
    text: str
    value: float


def _key(word: str) -> str:
    return _TRAIL.sub("", _LEAD.sub("", word.strip().lower().replace("’", "'")))


def _fmt(value: float, commas: bool) -> str:
    if abs(value - round(value)) < 1e-9:
        number = int(round(value))
        return f"{number:,}" if commas else str(number)
    return f"{value:,.6f}".rstrip("0").rstrip(".") if commas else f"{value:.6f}".rstrip("0").rstrip(".")


def _word_value(key: str) -> Optional[tuple[int, str]]:
    """A single number word's value and kind ('unit' 0-9, 'teen' 10-19, 'tens' 20-90), hyphens joined ("twenty-five")."""
    if key in UNITS:
        value = UNITS[key]
        return value, "unit" if value < 10 else "teen"
    if key in TENS:
        return TENS[key], "tens"
    parts = key.split("-")
    if len(parts) == 2 and parts[0] in TENS and parts[1] in UNITS and 0 < UNITS[parts[1]] < 10:
        return TENS[parts[0]] + UNITS[parts[1]], "compound"
    return None


class _Parse:
    """One number read from position i: its end (exclusive), value, the number words in it and how to show it."""

    def __init__(self, keys: Sequence[str], i: int):
        self.keys, self.start = keys, i
        self.end = i
        self.value = 0.0
        self.words = 0
        self.scale: Optional[str] = None  # million/billion/trillion said last ("15 billion")
        self.lead = 0.0  # the value before that scale
        self.digit_start = False
        self.small_only = True  # only 0-99 said, no scale (for years)
        self._read()

    def _peek(self, j: int) -> str:
        return self.keys[j] if j < len(self.keys) else ""

    def _read(self) -> None:
        keys, j = self.keys, self.start
        total = current = 0.0
        last = ""  # kind of the last word read
        if _DIGITS.match(keys[j] if j < len(keys) else ""):
            current = float(keys[j].replace(",", ""))
            self.digit_start, last, j = True, "digits", j + 1
            self.words = 1
        elif keys[j] in ("a", "an") and self._peek(j + 1) in ("hundred", *_BIG):
            current, last, j = 1.0, "a", j + 1
        while j < len(keys):
            key = keys[j]
            word = None if self.digit_start else _word_value(key)
            if word is not None:
                value, kind = word
                # A number word starts a number, follows a scale ("two hundred five") or completes a tens ("twenty five").
                fits = last in ("", "scale", "hundred", "and") or (last == "tens" and kind == "unit" and value > 0)
                if not fits:
                    break
                current += value
                last = "tens" if kind == "tens" else "unit"
                self.words += 1
                j += 1
                continue
            if key == "hundred" and last in ("unit", "tens", "a") and 0 < current < 100 and not self.digit_start:
                current *= 100
                last, j = "hundred", j + 1
                self.words += 1
                self.small_only = False
                continue
            if key in _BIG and last in ("unit", "tens", "a", "hundred", "digits", "point") and current > 0:
                if key in _NAMED and total == 0:
                    self.scale, self.lead = key, current
                else:
                    self.scale = None
                total += current * _BIG[key]
                current = 0.0
                last, j = "scale", j + 1
                self.words += 1
                self.small_only = False
                continue
            if key == "and" and last in ("hundred", "scale") and _word_value(self._peek(j + 1)) is not None:
                last, j = "and", j + 1
                continue
            if key == "point" and last in ("unit", "tens") and self._peek(j + 1) in UNITS and UNITS[self._peek(j + 1)] < 10:
                digits = ""
                k = j + 1
                while k < len(keys) and keys[k] in UNITS and UNITS[keys[k]] < 10:
                    digits += str(UNITS[keys[k]])
                    k += 1
                current = float(f"{int(current)}.{digits}")
                self.words += 1 + len(digits)
                last, j = "point", k
                continue
            break
        if self.scale is not None and current:
            self.scale = None  # "two million five hundred thousand": written out in full
        self.value = total + current
        self.end = j
        if self.scale is not None and last != "scale":
            self.scale = None


def number_spans(words: Sequence[str]) -> list[NumberSpan]:
    """The spoken quantities among caption words, as digits (see the module docstring for what counts)."""
    keys = [_key(word) for word in words]
    spans: list[NumberSpan] = []
    i = 0
    skip_next_adjacent = -1
    while i < len(keys):
        key = keys[i]
        starts = _DIGITS.match(key) or _word_value(key) is not None or (key in ("a", "an") and i + 1 < len(keys) and keys[i + 1] in ("hundred", *_BIG))
        if not starts:
            i += 1
            continue
        parse = _Parse(keys, i)
        if parse.end <= i or (parse.digit_start and parse.end == i + 1 and not _suffix(keys, parse.end)):
            # Digits on their own are already written as digits.
            i = max(i + 1, parse.end)
            continue
        end, value = parse.end, parse.value
        year = None
        # "twenty twenty six" -> 2026, "nineteen ninety" -> 1990.
        if parse.small_only and not parse.digit_start and value in (19, 20) and end < len(keys) and _word_value(keys[end]) is not None:
            second = _Parse(keys, end)
            if second.small_only and 10 <= second.value <= 99 and not _suffix(keys, second.end):
                year, end = int(value * 100 + second.value), second.end
        suffix = None if year else _suffix(keys, end)
        last = end - 1 + (len(suffix[1]) if suffix else 0)
        multi = parse.words >= 2 or keys[i] in ("a", "an")
        small_quantity = 2 <= value <= 9 and parse.words == 1 and end < len(keys) and keys[end] in QUANTITY_WORDS
        convert = year is not None or suffix is not None or multi or value >= 10 or small_quantity
        if convert and i == skip_next_adjacent and suffix is None:
            convert = False  # "two thirty", "one twenty five": a time or a list said out loud, left as said
        if not convert:
            skip_next_adjacent = end
            i = end
            continue
        if year is not None:
            shown = str(year)
        elif parse.scale is not None:
            shown = f"{_fmt(parse.lead, False)} {parse.scale}"
        else:
            shown = _fmt(value, value >= 10000 or (suffix is not None and suffix[0] == "$" and value >= 1000))
        if suffix and suffix[0] == "%":
            shown = f"{shown}%"
        elif suffix and suffix[0] == "$":
            shown = f"${shown}"
        lead = _LEAD.match(words[i].strip())
        trail = _TRAIL.search(words[last].strip())
        text = (lead.group(0) if lead else "") + shown + (trail.group(0).lstrip("%") if trail else "")
        spans.append(NumberSpan(first=i, last=last, text=text, value=float(year) if year else value))
        i = last + 1
    return spans


def _suffix(keys: Sequence[str], j: int) -> Optional[tuple[str, list[str]]]:
    """'%' or '$' when the number is followed by percent / per cent / dollars, with the words it takes."""
    if j < len(keys) and keys[j] in _PERCENT:
        return "%", [keys[j]]
    if j + 1 < len(keys) and keys[j] == "per" and keys[j + 1] == "cent":
        return "%", keys[j:j + 2]
    if j < len(keys) and keys[j] in _DOLLARS:
        return "$", [keys[j]]
    return None


def digitize_text(text: str) -> str:
    """A line of words with its spoken quantities as digits."""
    words = text.split()
    spans = number_spans(words)
    if not spans:
        return text
    out: list[str] = []
    i = 0
    for span in spans:
        out.extend(words[i:span.first])
        out.append(span.text)
        i = span.last + 1
    out.extend(words[i:])
    return " ".join(out)
