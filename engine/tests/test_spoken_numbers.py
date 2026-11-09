"""Captions write spoken quantities as digits, keeping each number's words' timing."""

import asyncio

import pytest

from clip_engine.config import CaptionStyle
from clip_engine.services.caption_generator import CaptionGeneratorService, digitize_words
from clip_engine.services.spoken_numbers import digitize_text, number_spans
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord


@pytest.mark.parametrize("said, shown", [
    ("They raised fifteen billion dollars.", "They raised $15 billion."),
    ("fifteen billion", "15 billion"),
    ("FIFTEEN BILLION", "15 billion"),
    ("twenty five percent of people", "25% of people"),
    ("twenty-five percent", "25%"),
    ("fifty per cent", "50%"),
    ("one hundred percent", "100%"),
    ("zero percent", "0%"),
    ("a hundred", "100"),
    ("a hundred times", "100 times"),
    ("a hundred dollars", "$100"),
    ("a million reasons", "1 million reasons"),
    ("in two thousand twenty six we", "in 2026 we"),
    ("nineteen ninety five", "1995"),
    ("twenty twenty", "2020"),
    ("twenty nineteen", "2019"),
    ("three steps to win", "3 steps to win"),
    ("five minutes a day", "5 minutes a day"),
    ("ten tips", "10 tips"),
    ("the top ten", "the top 10"),
    ("three point five million views", "3.5 million views"),
    ("two million five hundred thousand", "2,500,000"),
    ("fifteen thousand", "15,000"),
    ("fifteen hundred dollars", "$1,500"),
    ("two hundred and fifty", "250"),
    ("forty two", "42"),
    ("15 billion dollars", "$15 billion"),
    ("I have 1,200 dollars", "I have $1,200"),
    ("15 percent", "15%"),
    ("five dollars", "$5"),
    ("one dollar", "$1"),
    # Plain uses of small numbers stay as said.
    ("one time", "one time"),
    ("one of them", "one of them"),
    ("no one cares", "no one cares"),
    ("the one thing", "the one thing"),
    ("three of us", "three of us"),
    ("seven", "seven"),
    ("one two three", "one two three"),
    ("two thirty pm", "two thirty pm"),
    ("one twenty five", "one twenty five"),
    ("15 people", "15 people"),
    ("a lot of people", "a lot of people"),
    ("one more time", "one more time"),
    ("hundreds of people", "hundreds of people"),
    # Punctuation around the number is kept.
    ("“twenty percent,” he said", "“20%,” he said"),
    ("It was fifteen billion.", "It was 15 billion."),
    # A number never runs past the end of a sentence or clause, and the punctuation stays.
    ("there were twenty. Five of them left", "there were 20. Five of them left"),
    ("we hit one million. Two weeks later", "we hit 1 million. 2 weeks later"),
    ("five hundred, six hundred people", "500, 600 people"),
    ("in twenty twenty. Five years later", "in 2020. 5 years later"),
    ("it was twenty, twenty five maybe", "it was 20, 25 maybe"),
    ("about fifteen. Percent of them", "about 15. Percent of them"),
    ("one hundred and. fifty", "100 and. 50"),
    ("I said one. Twenty five people", "I said one. 25 people"),
])
def test_spoken_numbers_as_digits(said, shown):
    assert digitize_text(said) == shown


def test_a_number_spans_its_words():
    spans = number_spans("They raised fifteen billion dollars today".split())
    assert [(s.first, s.last, s.text, s.value) for s in spans] == [(2, 4, "$15 billion", 15e9)]


def _w(text, start, end):
    return TranscriptWord(word=text, start_time_ms=start, end_time_ms=end)


def test_merged_number_keeps_the_times_of_its_words():
    words = [_w("They", 0, 200), _w("raised", 200, 500), _w("fifteen", 500, 900), _w("billion", 900, 1300),
             _w("dollars.", 1300, 1700), _w("One", 2000, 2200), _w("time", 2200, 2500)]
    out = digitize_words(words)
    assert [(w.word, w.start_time_ms, w.end_time_ms) for w in out] == [
        ("They", 0, 200), ("raised", 200, 500), ("$15 billion.", 500, 1700), ("One", 2000, 2200), ("time", 2200, 2500)]


def test_captions_show_digits(tmp_path):
    words = [_w("They", 0, 200), _w("raised", 200, 500), _w("fifteen", 500, 900), _w("billion", 900, 1300),
             _w("dollars", 1300, 1700), _w("twenty", 1800, 2000), _w("five", 2000, 2200), _w("percent", 2200, 2600)]
    out = tmp_path / "c.ass"
    style = CaptionStyle()
    asyncio.run(CaptionGeneratorService().generate_captions(
        transcript_segments=[TranscriptSegment(0, 2600, " ".join(w.word for w in words), words=words)],
        clip_start_ms=0, clip_end_ms=4000, output_path=str(out), caption_style=style,
    ))
    text = out.read_text()
    assert "$15 BILLION" in text and "25%" in text
    assert "FIFTEEN" not in text and "TWENTY" not in text and "PERCENT" not in text
    # The number is highlighted as one word: an event starts when "fifteen" did (0.50 s).
    starts = {line.split(",")[1] for line in text.splitlines() if line.startswith("Dialogue: 4,")}
    assert "0:00:00.50" in starts and "0:00:00.90" not in starts


def test_captions_without_word_timing_show_digits(tmp_path):
    out = tmp_path / "c.ass"
    style = CaptionStyle()
    style.word_by_word_highlight = False
    asyncio.run(CaptionGeneratorService().generate_captions(
        transcript_segments=[TranscriptSegment(0, 2000, "We grew twenty five percent", words=[])],
        clip_start_ms=0, clip_end_ms=2000, output_path=str(out), caption_style=style,
    ))
    assert "25%" in out.read_text() and "TWENTY" not in out.read_text()


def test_srt_shows_digits(tmp_path):
    words = [_w("a", 0, 100), _w("hundred", 100, 400), _w("dollars", 400, 800), _w("in", 800, 900),
             _w("two", 900, 1100), _w("thousand", 1100, 1400), _w("twenty", 1400, 1600), _w("six.", 1600, 1900)]
    path = CaptionGeneratorService().generate_srt([TranscriptSegment(0, 1900, "", words=words)], 0, 3000, str(tmp_path / "c.srt"))
    assert "$100 in 2026." in open(path).read()
