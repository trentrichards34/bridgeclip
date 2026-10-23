"""Create (Automatic) again on the same video: a clip on the same moment keeps its headline when it still fits."""
from clip_engine.services.headline_memory import clean_kept_headlines, fits_clip, kept_headline, matching_kept, range_overlap

KEPT = [
    {"start_ms": 0, "end_ms": 20000, "headline": "He quit his job at 40 to build this"},
    {"start_ms": 60000, "end_ms": 75000, "headline": "The pitch nobody expected"},
]
SAID_A = "So at 40 I quit my job and started to build this thing from my garage"
SAID_B = "Then I gave the pitch and nobody in the room expected it"


def test_overlap_is_a_share_of_the_longer_range():
    assert range_overlap((0, 10000), (0, 10000)) == 1
    assert range_overlap((0, 10000), (4000, 14000)) == 0.6
    assert range_overlap((0, 10000), (20000, 30000)) == 0
    assert abs(range_overlap((0, 30000), (5000, 15000)) - 1 / 3) < 1e-9


def test_a_clip_on_the_same_moment_keeps_its_headline():
    assert kept_headline(1000, 21500, KEPT, SAID_A) == KEPT[0]["headline"]
    assert kept_headline(58000, 74000, KEPT, SAID_B) == KEPT[1]["headline"]


def test_a_new_moment_or_a_small_overlap_gets_a_new_headline():
    assert matching_kept(30000, 45000, KEPT) is None
    # Under 60% of the longer clip: a different clip.
    assert kept_headline(9000, 29000, KEPT, SAID_A) is None


def test_a_kept_headline_must_still_fit_what_is_said():
    # Its number isn't said in this clip.
    assert not fits_clip("He quit his job at 40 to build this", "I quit my job and started to build this")
    # None of its words are said.
    assert not fits_clip("The pitch nobody expected", "We moved to a new city last spring")
    assert kept_headline(1000, 21500, KEPT, "I quit my job and started to build this") is None
    assert fits_clip("The pitch nobody expected", SAID_B)


def test_saved_headlines_are_checked_as_given():
    raw = KEPT + [
        {"start_ms": 5, "end_ms": 5, "headline": "Empty range here"},
        {"start_ms": "0", "end_ms": 10, "headline": "Wrong type here"},
        {"start_ms": 0, "end_ms": 10, "headline": "one"},
        {"start_ms": 0, "end_ms": 10, "headline": "x" * 121},
        "not a clip",
    ]
    assert clean_kept_headlines(raw) == KEPT
    assert clean_kept_headlines(None) == []
    assert len(clean_kept_headlines([{"start_ms": i, "end_ms": i + 10, "headline": "Two words"} for i in range(100)])) == 60
