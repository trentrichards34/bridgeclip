"""Audio tightening: pauses shortened, ends trimmed, sped up, normalized, words on the final clock."""
import json
import shutil
import subprocess

import pytest

from clip_engine.services import audio_tighten as at

needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="needs FFmpeg")

# Three 0.6 s "words" of tone: 0.5 s lead-in, a 1.0 s pause, a 0.3 s pause (kept), 0.9 s run-out. 4.5 s in all.
TONES = [(0.5, 1.1), (2.1, 2.7), (3.0, 3.6)]
WORDS = [{"word": "one", "start": 0.5, "end": 1.1}, {"word": "two", "start": 2.1, "end": 2.7},
         {"word": "three", "start": 3.0, "end": 3.6}]
SOURCE_S = 4.5


def make_take(path):
    gate = "+".join(f"between(t,{a},{b})" for a, b in TONES)
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    f"aevalsrc='0.4*sin(2*PI*330*t)*({gate})':s=44100:d={SOURCE_S}", "-ac", "1", "-c:a", "pcm_s16le", path],
                   check=True)
    return path


def sounding_gaps(path, min_s=0.1):
    """Silences inside the audio (not touching either end), measured with a short minimum."""
    spans = at.detect_silences(path, min_s=min_s)
    total = at.probe_duration(path)
    return [(a, b) for a, b in spans if a > 0.01 and b < total - 0.01], spans, total


def test_plan_shortens_long_pauses_and_trims_ends():
    silences = [(0.0, 0.5), (1.1, 2.1), (3.6, 4.5)]
    plan = at.plan_cuts(silences, WORDS, SOURCE_S, speed=1.15)
    assert plan.keeps == [(0.44, 1.24), (1.96, 3.9)]
    assert plan.cuts == [(0.0, 0.44), (1.24, 1.96), (3.9, 4.5)]
    assert plan.tightened_duration == pytest.approx(2.74)
    assert plan.final_duration == pytest.approx(2.74 / 1.15)


def test_remap_moves_words_onto_final_clock():
    plan = at.plan_cuts([(0.0, 0.5), (1.1, 2.1), (3.6, 4.5)], WORDS, SOURCE_S, speed=1.15)
    words = plan.remap_words(WORDS)
    assert words[0]["start"] == pytest.approx(0.06 / 1.15, abs=1e-3)
    assert words[0]["end"] == pytest.approx(0.66 / 1.15, abs=1e-3)
    # The 1.0 s pause now lasts 0.28 s before the speed-up.
    assert words[1]["start"] - words[0]["end"] == pytest.approx(0.28 / 1.15, abs=1e-3)
    # The short pause is untouched (apart from the speed).
    assert words[2]["start"] - words[1]["end"] == pytest.approx(0.3 / 1.15, abs=1e-3)
    assert plan.final_duration - words[2]["end"] == pytest.approx(0.3 / 1.15, abs=1e-3)
    # A time inside a cut lands on the join.
    assert plan.remap(1.5) == pytest.approx(plan.remap(1.24)) == pytest.approx(plan.remap(1.96))
    assert words[1]["word"] == "two"


def test_plan_round_trips_and_validates_speed():
    plan = at.plan_cuts([(1.1, 2.1)], WORDS, SOURCE_S)
    again = at.TightenPlan.from_dict(json.loads(json.dumps(plan.to_dict())))
    assert again.keeps == plan.keeps and again.speed == at.DEFAULT_SPEED and again.silences == plan.silences
    with pytest.raises(at.TightenError):
        at.plan_cuts([], WORDS, SOURCE_S, speed=3.0)


@needs_ffmpeg
def test_detects_the_take_pauses(tmp_path):
    take = make_take(str(tmp_path / "take.wav"))
    spans = at.detect_silences(take)
    assert len(spans) == 3
    for (a, b), (ea, eb) in zip(spans, [(0.0, 0.5), (1.1, 2.1), (3.6, 4.5)], strict=True):
        assert a == pytest.approx(ea, abs=0.03) and b == pytest.approx(eb, abs=0.03)


@needs_ffmpeg
def test_tighten_end_to_end(tmp_path):
    take = make_take(str(tmp_path / "take.wav"))
    out = str(tmp_path / "tight.wav")
    result = at.tighten(take, WORDS, out)
    assert result["duration"] == pytest.approx(2.74 / 1.15, abs=0.04)
    assert at.probe_duration(out) == pytest.approx(result["duration"], abs=0.05)

    gaps, _spans, total = sounding_gaps(out)
    # Both inner pauses survive: the long one cut to 0.28 s, the short one left at 0.3 s (each / 1.15).
    assert len(gaps) == 2
    assert gaps[0][1] - gaps[0][0] == pytest.approx(0.28 / 1.15, abs=0.04)
    assert gaps[1][1] - gaps[1][0] == pytest.approx(0.30 / 1.15, abs=0.04)

    words = result["words"]
    assert [w["word"] for w in words] == ["one", "two", "three"]
    # Each remapped word starts where the tone comes back in the final audio.
    assert words[1]["start"] == pytest.approx(gaps[0][1], abs=0.04)
    assert words[2]["start"] == pytest.approx(gaps[1][1], abs=0.04)
    assert words[0]["end"] == pytest.approx(gaps[0][0], abs=0.04)
    assert words[0]["start"] == pytest.approx(0.06 / 1.15, abs=0.03)
    # Tail: 0.3 s after the last word, sped up.
    assert total - words[2]["end"] == pytest.approx(0.3 / 1.15, abs=0.05)

    # Loudness lands on the target.
    probe = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", out, "-af",
                            "loudnorm=print_format=json", "-f", "null", "-"], capture_output=True, text=True, check=True)
    measured = json.loads(probe.stderr[probe.stderr.rindex("{"):])
    assert float(measured["input_i"]) == pytest.approx(at.TARGET_LUFS, abs=1.0)
    assert float(measured["input_tp"]) <= at.TARGET_TP + 0.5


@needs_ffmpeg
def test_retime_reuses_saved_plan(tmp_path):
    take = make_take(str(tmp_path / "take.wav"))
    first = at.tighten(take, WORDS, str(tmp_path / "a.wav"))
    calls = []
    original = at.detect_silences
    at.detect_silences = lambda *a, **k: calls.append(1) or original(*a, **k)
    try:
        again = at.retime(take, WORDS, first["plan"], str(tmp_path / "b.wav"), speed=1.0)
    finally:
        at.detect_silences = original
    assert not calls
    assert again["plan"]["keeps"] == first["plan"]["keeps"]
    assert again["duration"] == pytest.approx(2.74, abs=1e-3)
    assert at.probe_duration(str(tmp_path / "b.wav")) == pytest.approx(2.74, abs=0.03)
    assert again["words"][1]["start"] == pytest.approx(0.94, abs=1e-3)
