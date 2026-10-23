"""Edit my recording: retakes, the plan check, cutting on word boundaries, sound effects and a real render."""
import asyncio
import json
import math
import os
import re
import shutil
import subprocess

import numpy as np
import pytest
from PIL import Image

from clip_engine.services import edit_recording as er


def say(text, start, step=0.32, src=0, gap=0.04):
    """Words of a line, evenly spaced from `start` seconds."""
    out = []
    t = start
    for token in text.split():
        out.append(er.Word(token, round(t * 1000), round((t + step - gap) * 1000), src))
        t += step
    return out


def script(*lines, src=0):
    """Lines as (text, start seconds)."""
    words = []
    for text, start in lines:
        words += say(text, start, src=src)
    return words


def kept_text(words, marks):
    return " ".join(w.text for w, m in zip(words, marks) if m is None)


# ---------------------------------------------------------------------------
# Retakes, restarts, fillers
# ---------------------------------------------------------------------------

def test_a_take_rejected_aloud_is_cut_with_the_words_that_reject_it():
    words = script(("Most coaches charge too little for their time.", 0), ("No, again.", 3.5),
                   ("Most coaches charge way too little for their time.", 5))
    marks = er.analyze_takes(words)
    assert kept_text(words, marks) == "Most coaches charge way too little for their time."
    assert marks[:8] == ["rejected"] * 8
    assert marks[8:10] == ["cue", "cue"]


def test_the_last_complete_take_of_a_line_said_again_is_kept():
    words = script(("Here is the first tip you need.", 0), ("Here is the first tip you need to know.", 3),
                   ("Post at the same time every day.", 6.5))
    marks = er.analyze_takes(words)
    assert kept_text(words, marks) == "Here is the first tip you need to know. Post at the same time every day."
    assert set(marks[:7]) == {"retake"}


def test_a_passage_of_several_lines_recorded_again_keeps_only_the_second_go():
    words = script(("Pricing is not about your costs.", 0), ("It is about the result you sell.", 2.5),
                   ("Pricing is not about your costs at all.", 6), ("It is about the result you sell.", 9))
    marks = er.analyze_takes(words)
    assert kept_text(words, marks) == "Pricing is not about your costs at all. It is about the result you sell."


def test_an_unfinished_retake_after_a_complete_one_is_cut():
    words = script(("The secret is consistency over intensity.", 0), ("The secret is", 3.2), ("Then you rest.", 5))
    marks = er.analyze_takes(words)
    assert kept_text(words, marks) == "The secret is consistency over intensity. Then you rest."


def test_scratch_that_inside_a_line_cuts_what_came_before_it():
    words = script(("The best time to post is scratch that the best time to post is the morning.", 0))
    marks = er.analyze_takes(words)
    assert kept_text(words, marks) == "the best time to post is the morning."


def test_a_restart_midway_through_a_sentence_and_filler_words_are_cut():
    words = script(("So the first thing so the first thing you do is um plan your week.", 0))
    marks = er.analyze_takes(words)
    assert kept_text(words, marks).lower() == "so the first thing you do is plan your week."
    assert "filler" in marks


def test_lines_that_only_start_alike_and_a_no_that_answers_a_question_are_kept():
    words = script(("You need to sleep more at night.", 0), ("You need to eat less sugar every day.", 3),
                   ("Do you need a big audience?", 6), ("No.", 8), ("You need the right one.", 9))
    marks = er.analyze_takes(words)
    assert all(m is None for m in marks), marks


# ---------------------------------------------------------------------------
# Numbers said aloud
# ---------------------------------------------------------------------------

def test_numbers_in_digits_and_words():
    assert er.numbers_in("fifteen billion scam ads") == [15e9]
    assert er.numbers_in("15B") == [15e9]
    assert er.numbers_in("$1,200 a month and 3.5 million views") == [1200, 3.5e6]
    assert er.numbers_in("twenty five percent") == [25]
    assert er.numbers_in("one hundred and twenty") == [120]
    assert er.unsupported_numbers("15 billion ads", "he said fifteen billion scam ads") == []
    assert er.unsupported_numbers("$50 a day", "he said fifteen billion") == [50]


def test_numbers_in_decimals_halves_and_a_hundred():
    assert er.numbers_in("three point five") == [3.5]
    assert er.numbers_in("one point two million") == [1.2e6]
    assert er.numbers_in("three point one four") == [3.14]
    assert er.numbers_in("one and a half million") == [1.5e6]
    assert er.numbers_in("half a million views") == [5e5]
    assert er.numbers_in("a hundred") == [100]
    assert er.numbers_in("a thousand people and a million views") == [1000, 1e6]
    assert er.numbers_in("two hundred and fifty") == [250]
    # Words that only look like part of a number stay out.
    assert er.numbers_in("the point is five") == [5]
    assert er.numbers_in("it was a big deal") == []
    assert er.numbers_in("one and then two") == [1, 2]
    assert er.unsupported_numbers("3.5 million", "it hit three point five million") == []
    assert er.unsupported_numbers("1.5M", "one and a half million") == []


# ---------------------------------------------------------------------------
# The model's plan, checked against the words
# ---------------------------------------------------------------------------

def plan_words():
    return script(("Hi I'm Sam.", 0), ("Most coaches lose 3 clients a month to one mistake.", 1.5),
                  ("They never follow up after the first call.", 5.5), ("Fifteen billion messages go unanswered.", 8.5),
                  ("Follow me for more.", 11.5), ("Okay hook:", 13), ("Most coaches lose 3 clients a month to one mistake.", 14))


def test_the_plan_is_clamped_to_real_words_and_never_shows_what_was_not_said():
    words = plan_words()
    base = er.analyze_takes(words)
    n = len(words)
    hook_start = next(i for i in range(n) if words[i].start_ms >= 14000)
    raw = {
        "hooks": [{"start": hook_start, "end": n + 50, "text": "Coaches lose 30 clients a month", "why": "a number"},
                  {"start": 3, "end": 2, "text": "backwards", "why": ""},
                  {"start": 3, "end": 12, "text": "One mistake costs coaches clients", "why": "the problem"}],
        "cuts": [{"start": 0, "end": 2, "reason": "off_topic"}, {"start": -5, "end": -1, "reason": "filler"}],
        "cta": {"present": True, "start": 26, "end": 29},
        "popups": [{"word": 21, "text": "15 billion", "kind": "number"}, {"word": 6, "text": "$50", "kind": "number"},
                   {"word": 15, "text": "Follow up", "kind": "keyword"}, {"word": 9999, "text": "x", "kind": "keyword"},
                   {"word": 16, "text": "Invented term", "kind": "keyword"}, {"word": 23, "text": "messages", "kind": "keyword"}],
        "sounds": [{"word": 21, "sound": "pop"}, {"word": 22, "sound": "pop"}, {"word": 15, "sound": "laser"}],
    }
    plan = er.validate_plan(raw, words, base)
    hook = plan["hooks"][0]
    # The end is clamped to the last word; the invented 30 is replaced by their own words.
    assert hook["start"] == hook_start and hook["end"] == n - 1
    assert hook["text"].startswith("Most coaches lose 3 clients")
    assert [h["start"] for h in plan["hooks"]] == [hook_start, 3]
    # The hook said first is cut (it plays once, as the opening); "Hi I'm Sam" is cut as asked.
    marks = plan["marks"]
    assert all(marks[i] == "retake" for i in range(3, 13))
    assert marks[0:3] == ["off_topic"] * 3
    # $50 was never said, word 9999 doesn't exist, the term is invented, and "messages" is too close to the one before.
    assert [p["text"] for p in plan["popups"]] == ["Follow up", "15 billion"]
    assert plan["cta"] == {"start": 26, "end": 29}
    assert [s["sound"] for s in plan["sounds"]] == ["whoosh", "pop"]
    assert plan["sounds"][0]["at"] == "title"


def test_a_plan_that_cuts_almost_everything_keeps_only_the_local_cuts():
    words = plan_words()
    base = er.analyze_takes(words)
    plan = er.validate_plan({"hooks": [], "cuts": [{"start": 0, "end": len(words) - 1, "reason": "retake"}],
                             "cta": {"present": False, "start": 0, "end": 0}, "popups": [], "sounds": []}, words, base)
    assert sum(1 for m in plan["marks"] if m is None) > len(words) // 2
    assert plan["notes"]
    assert plan["hooks"] and plan["hooks"][0]["why"] == "Your first line."


def test_the_basic_plan_without_the_ai_pops_up_numbers_said_as_digits():
    words = script(("We grew 300 percent in 6 months.", 0))
    plan = er.basic_plan(words, er.analyze_takes(words))
    assert [p["text"] for p in plan["popups"]] == ["300 percent"]
    assert [s["sound"] for s in plan["sounds"]] == ["whoosh", "pop"]
    review = er.review_of(words, plan, "basic", 0, [])
    assert review["hook"] == 0 and review["words"][0][:4] == ["We", 0, 280, 0]


# ---------------------------------------------------------------------------
# The cut
# ---------------------------------------------------------------------------

def test_pieces_start_and_end_between_words_on_the_frame_grid_with_the_hook_first_and_the_cta_last():
    words = script(("First line here.", 0), ("Cut this part.", 1.2), ("Body line now.", 2.4), ("Follow for more.", 6.0), ("Hook line here.", 8.0))
    keep = [True] * len(words)
    for i in range(3, 6):
        keep[i] = False
    pieces, timed = er.build_timeline(words, keep, er.Span(12, 14), er.Span(9, 11))
    order = [i for *_, i in timed]
    assert order == [12, 13, 14, 0, 1, 2, 6, 7, 8, 9, 10, 11]
    for piece in pieces:
        assert abs(piece.start * er.FPS - round(piece.start * er.FPS)) < 1e-4
        assert abs(piece.end * er.FPS - round(piece.end * er.FPS)) < 1e-4
    by_src_words = sorted(words, key=lambda w: w.start_ms)
    for piece in pieces:
        for w in by_src_words:
            s, e = w.start_ms / 1000, w.end_ms / 1000
            inside = piece.start <= s and e <= piece.end
            outside = e <= piece.start + 1 / er.FPS or s >= piece.end - 1 / er.FPS
            assert inside or outside, f"{w.text} is cut by {piece}"
    # The cut words ("Cut this part.") are in no piece.
    for i in range(3, 6):
        s, e = words[i].start_ms / 1000, words[i].end_ms / 1000
        assert not any(p.start < e - 1 / er.FPS and p.end > s + 1 / er.FPS for p in pieces)
    # Reel times run on without gaps between pieces, word by word.
    assert timed[0][1] >= 0 and all(b[1] >= a[1] for a, b in zip(timed, timed[1:]))
    assert abs(er.reel_seconds(pieces) - (timed[-1][2] / 1000 + er.PAD_AFTER)) < 0.1


def test_a_long_pause_inside_kept_speech_is_tightened():
    words = say("one two", 0) + say("three four", 3.0)
    pieces, timed = er.build_timeline(words, [True] * 4, None, None)
    assert len(pieces) == 2
    gap = timed[2][1] - timed[1][2]
    assert gap <= er.SHORT_PAUSE * 1000 + 40


# ---------------------------------------------------------------------------
# A real render
# ---------------------------------------------------------------------------

def _ffmpeg_ok():
    return shutil.which("ffmpeg") and shutil.which("ffprobe")


def make_recording(path, seconds=9.0, size="640x360"):
    """A landscape 'recording': a test picture and a 300 Hz tone where each word is said (silence between)."""
    words = script(("Most coaches lose clients.", 0.5), ("Um.", 2.0), ("They never follow up.", 2.8),
                   ("Fifteen billion messages wait.", 5.0), ("Follow me.", 7.4))
    expr = "+".join(f"between(t,{w.start_ms / 1000:.3f},{w.end_ms / 1000:.3f})" for w in words)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=s={size}:r=30:d={seconds}",
                    "-f", "lavfi", "-i", f"aevalsrc='0.25*sin(2*PI*300*t)*({expr})':s=48000:d={seconds}",
                    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path], check=True)
    return words


def loudness(path, start=None, duration=None):
    args = ["ffmpeg", "-nostdin", "-hide_banner", "-nostats", *(["-ss", str(start)] if start is not None else []), "-i", path,
            *(["-t", str(duration)] if duration else []), "-af", "loudnorm=print_format=json", "-f", "null", "-"]
    text = subprocess.run(args, capture_output=True).stderr.decode()
    data = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", text).group(0))
    return float(data["input_i"]), float(data["input_tp"])


def band_rms(path, start, duration, highpass=2500):
    text = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-ss", str(start), "-i", path, "-t", str(duration),
                           "-af", f"highpass=f={highpass},highpass=f={highpass},astats=metadata=0:reset=0", "-f", "null", "-"],
                          capture_output=True).stderr.decode()
    match = re.findall(r"RMS level dB:\s*(-?[\d.]+|-inf)", text)
    value = match[-1] if match else "-inf"
    return -200.0 if value == "-inf" else float(value)


def frame_at(path, t, out):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", path, "-frames:v", "1", out], check=True)
    return np.asarray(Image.open(out).convert("RGB")).astype(float)


@pytest.mark.skipif(not _ffmpeg_ok(), reason="needs FFmpeg")
def test_a_render_cuts_on_words_frames_to_9_16_mixes_sound_effects_and_normalizes_loudness(tmp_path, monkeypatch):
    root = str(tmp_path / "edit-run")
    os.makedirs(root)
    source = str(tmp_path / "recording.mp4")
    words = make_recording(source)
    marks = er.analyze_takes(words)
    assert [w.text for w, m in zip(words, marks) if m] == ["Um."]
    keep = [m is None for m in marks]
    n = len(words)
    hook = er.Span(next(i for i, w in enumerate(words) if w.text == "Fifteen"), next(i for i, w in enumerate(words) if w.text == "wait."))
    cta = er.Span(n - 2, n - 1)
    fifteen = hook.start
    look = er.Look("Most coaches lose clients", {"look": "floating", "color": "#FFFFFF", "font": "clean"}, True, "pop", None)
    config = {"output_dir": root, "sources": [source], "words": words, "keep": keep, "hook": hook, "cta": cta,
              "popups": [{"word": fifteen, "text": "15 billion", "kind": "number"}],
              "sounds": [{"at": "title", "sound": "whoosh"}, {"at": fifteen + 1, "sound": "pop"}],
              "look": look, "title": "", "cost_usd": 0.01, "sound_cache": str(tmp_path / "sounds")}
    result = asyncio.run(er.render_edit(config, lambda *_: None))
    out = result["path"]
    assert out == os.path.join(root, "clip_00.mp4") and os.path.isfile(out)
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height", "-show_entries",
                                       "format=duration", "-of", "json", out], capture_output=True, check=True).stdout)
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920)
    pieces, timed = er.build_timeline(words, keep, hook, cta)
    seconds = float(probe["format"]["duration"])
    assert abs(seconds - er.reel_seconds(pieces)) < 0.15
    # The hook ("Fifteen billion messages wait.") opens the reel; "Follow me." ends it; "Um." is gone.
    assert [t for t, *_ in timed][:4] == ["Fifteen", "billion", "messages", "wait."]
    assert [t for t, *_ in timed][-2:] == ["Follow", "me."]
    assert "Um." not in [t for t, *_ in timed]
    # Social loudness: about -14 LUFS, true peak under -1 dBTP.
    integrated, peak = loudness(out)
    assert abs(integrated - er.TARGET_LUFS) <= 1.0, integrated
    assert peak <= -1.0, peak
    # The hook text's swipe: broadband sound in the first half second, which the 300 Hz voice never has.
    voice_only = timed[2][1] / 1000
    assert band_rms(out, 0.0, 0.5) > band_rms(out, voice_only, 0.4) + 15
    # The pop-up: a light card over the picture while "billion" is said, gone two seconds later.
    pop_t = timed[1][1] / 1000 + 0.5
    later = timed[-3][1] / 1000
    with_card, without = frame_at(out, pop_t, str(tmp_path / "a.png")), frame_at(out, later, str(tmp_path / "b.png"))
    region = (slice(420, 560), slice(380, 700))
    assert with_card[region].mean() > without[region].mean() + 40
    # Saved for the Library: job_output.json, and the parts to re-make it.
    job = json.load(open(os.path.join(root, "job_output.json")))
    assert job["clips"][0]["editable"]["settings"]["headline"] == "Most coaches lose clients"
    assert job["metrics"]["edit_recording"] is True
    assert os.path.isfile(os.path.join(root, ".edit", "clip_00", "base.mp4"))
    # Re-made with new hook text and no captions: same length, same sound.
    again = os.path.join(root, ".recompose-test.mp4")
    remade = asyncio.run(er.recompose_edit({"output_dir": root, "output_path": again, "headline": "One mistake costs coaches clients",
                                             "headline_look": {"look": "black", "color": "#FFFFFF", "font": "serif"},
                                             "include_captions": False, "caption_preset": "pop"}, lambda *_: None))
    assert abs(remade["duration_seconds"] - seconds) < 0.15
    assert remade["settings"]["headline"] == "One mistake costs coaches clients"
    shots = os.environ.get("EDIT_RECORDING_SHOTS")
    if shots:
        os.makedirs(shots, exist_ok=True)
        for k, t in enumerate((0.3, pop_t, seconds - 0.4)):
            frame_path(out, t, os.path.join(shots, f"reel-{k}.png"))


def frame_path(path, t, out):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", path, "-frames:v", "1", out], check=True)
    return out


# ---------------------------------------------------------------------------
# Edit styles: cards, pacing, punch-in, pinned images and the two openings
# ---------------------------------------------------------------------------

def card_words():
    return script(("Here are the three steps.", 0), ("Write the hook, film one take, post at noon.", 1.6),
                  ("We went from 500 to 2,000 views a day.", 5.0), ("I asked can you cut my retakes and it said done in seconds.", 8.5))


def test_cards_are_checked_against_what_was_said_and_numbered_after_the_pop_ups():
    words = card_words()
    base = er.analyze_takes(words)
    raw = {"hooks": [], "cuts": [], "cta": {"present": False, "start": 0, "end": 0},
           "popups": [{"word": 19, "text": "2,000", "kind": "number"}], "sounds": [],
           "cards": [
               {"word": 0, "seconds": 9, "type": "list", "title": "The three steps", "items": ["Write the hook", "Film one take", "Post at noon"]},
               {"word": 19, "seconds": 3, "type": "stat", "title": "2,000", "items": ["views a day"]},
               {"word": 20, "seconds": 3, "type": "compare", "title": "", "items": ["500 views", "2,000 views"]},
               {"word": 35, "seconds": 4, "type": "chat", "title": "ignored", "items": ["Can you cut my retakes?", "Done in seconds."]},
           ]}
    plan = er.validate_plan(raw, words, base)
    cards = [p for p in plan["popups"] if p["kind"] == "card"]
    # The list (its time clamped to 5 s); the stat at "2,000"; the compare is too close to it; the chat is kept (title dropped).
    assert [c["card"]["type"] for c in cards] == ["list", "stat", "chat"]
    assert cards[0]["seconds"] == 5.0 and cards[0]["card"]["items"] == ["Write the hook", "Film one take", "Post at noon"]
    assert cards[2]["card"] == {"type": "chat", "title": "", "items": ["Can you cut my retakes?", "Done in seconds."]}
    ids = [p["id"] for p in plan["popups"]]
    assert len(set(ids)) == len(ids) and cards[0]["id"] == 1
    review = er.review_of(words, plan, "ai", 0, [])
    assert sum(1 for p in review["popups"] if p["kind"] == "card") == 3
    # 10,000 was never said; "growth secrets" and "mystery tactics" were never said; a one-item list isn't a list.
    assert er._cards([{"word": 22, "seconds": 3, "type": "stat", "title": "10,000", "items": ["views a day"]},
                      {"word": 24, "seconds": 3, "type": "list", "title": "Growth secrets nobody shares", "items": ["Buy followers", "Mystery tactics"]},
                      {"word": 26, "seconds": 3, "type": "list", "title": "Only one", "items": ["Write the hook"]}], words, base, 0) == []
    assert er.clean_card({"type": "stat", "title": "big", "items": ["no number"]}) is None
    assert er.clean_card({"type": "compare", "title": "", "items": ["<b>x</b>", "y"]})["items"][0] == "b x /b"
    assert "cards" in er.PLAN_SCHEMA["required"]


def test_the_edit_style_sets_how_long_a_pause_may_run():
    words = say("one two", 0) + say("three four", 1.0) + say("five six", 2.8)
    calm, _ = er.build_timeline(words, [True] * 6, None, None, max_gap=0.9, short_pause=0.35)
    fast, timed = er.build_timeline(words, [True] * 6, None, None, max_gap=0.35, short_pause=0.12)
    assert len(calm) == 2 and len(fast) == 3
    assert er.reel_seconds(fast) < er.reel_seconds(calm)
    assert timed[2][1] - timed[1][2] <= 0.12 * 1000 + 40


def test_what_the_edit_dropped_from_the_raw_takes():
    from clip_engine.services import edit_visuals as ev
    pieces = [er.Piece(0, 1.0, 3.0), er.Piece(0, 5.0, 6.0), er.Piece(1, 0.0, 2.0)]
    assert ev.dropped_ranges(pieces, [8.0, 4.0]) == [(0.0, 1.0), (3.0, 5.0), (6.0, 8.0), (10.0, 12.0)]
    windows = er.card_windows([{"card": {}, "start_ms": 200, "seconds": 3}, {"card": {}, "start_ms": 3000, "seconds": 3},
                               {"card": {}, "start_ms": 6000, "seconds": 5}], 9.0)
    assert [(a, b) for a, b, _ in windows] == [(1.2, 4.2), (6.0, 8.85)]


def mean_rgb(frame, rows, cols=slice(0, 1080)):
    return frame[rows, cols].reshape(-1, 3).mean(axis=0)


@pytest.mark.skipif(not _ffmpeg_ok(), reason="needs FFmpeg")
def test_a_fast_explainer_render_has_a_raw_opening_a_cut_out_a_half_screen_card_and_a_pinned_logo(tmp_path):
    from clip_engine.services import segmentation
    root = str(tmp_path / "edit-run")
    os.makedirs(root)
    source = str(tmp_path / "recording.mp4")
    words = make_recording(source)
    marks = er.analyze_takes(words)
    keep = [m is None for m in marks]
    fifteen = next(i for i, w in enumerate(words) if w.text == "Follow")
    they = next(i for i, w in enumerate(words) if w.text == "They")
    logo = str(tmp_path / "logo.png")
    img = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
    from PIL import ImageDraw
    ImageDraw.Draw(img).ellipse((20, 20, 280, 280), fill=(240, 40, 200, 255))
    img.save(logo)
    look = er.Look("Most coaches lose clients", {"look": "floating", "color": "#2F5BFF", "font": "clean"}, True, "pop", None, ("progress_bar",))
    config = {"output_dir": root, "sources": [source], "words": words, "keep": keep, "hook": None, "cta": None,
              "popups": [{"word": they, "kind": "card", "card": {"type": "list", "title": "They never follow up", "items": ["Follow up", "Messages wait"]},
                          "seconds": 2.0}],
              "sounds": [], "look": look, "title": "", "cost_usd": 0, "sound_cache": str(tmp_path / "sounds"),
              "pacing": {"max_gap": 0.35, "short_pause": 0.12, "punch_on_cuts": True}, "recipe": "fast",
              "images": [logo], "pins": [{"image": logo, "word": fifteen}], "cutout_intro": True, "raw_intro": True}
    result = asyncio.run(er.render_edit(config, lambda *_: None))
    out = result["path"]
    pieces, timed = er.build_timeline(words, keep, None, None, 0.35, 0.12)
    total = er.reel_seconds(pieces)
    seconds = float(json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", out],
                                              capture_output=True, check=True).stdout)["format"]["duration"])
    # The raw opening (3.5 s) comes first, then the reel.
    assert abs(seconds - (total + er.RAW_INTRO_SECONDS)) < 0.25, (seconds, total)
    intro = frame_at(out, 3.2, str(tmp_path / "intro.png"))
    wave = intro[1290:1520, 90:990]
    red = ((wave[..., 0] > 180) & (wave[..., 1] < 90) & (wave[..., 2] < 90)).sum()
    assert red > 200, "the dropped stretches are marked red on the waveform"
    assert intro[:200].mean() < 40, "a dark card"
    # The card: the top half is the light card while it shows; the speaker is in the bottom half.
    at = er.RAW_INTRO_SECONDS + max(er.CARD_EARLIEST_S, timed[[i for *_, i in timed].index(they)][1] / 1000) + 1.0
    card = frame_at(out, at, str(tmp_path / "card.png"))
    assert mean_rgb(card, slice(300, 900)).mean() > 200
    assert mean_rgb(card, slice(1100, 1500)).mean() < 200
    # The pinned logo pops up, centered, on "Follow".
    pin_t = er.RAW_INTRO_SECONDS + timed[[i for *_, i in timed].index(fifteen)][1] / 1000 + 0.35
    pinned = frame_at(out, pin_t, str(tmp_path / "pin.png"))
    center = pinned[700:840, 470:610]
    assert ((center[..., 0] > 200) & (center[..., 1] < 90) & (center[..., 2] > 160)).mean() > 0.5
    bundle = json.load(open(os.path.join(root, ".edit", "clip_00", "edit.json")))
    assert bundle["recipe"] == "fast" and bundle["look_extras"] == ["progress_bar"]
    assert len(bundle["cards"]) == 1 and len(bundle["pins"]) == 1 and bundle["raw_intro"] == "raw-intro.mp4"
    if segmentation.available():
        assert bundle["cutout"]["seconds"] == er.CUTOUT_SECONDS
    # Re-made with new hook text: the opening, card and logo are kept.
    again = os.path.join(root, ".recompose-test.mp4")
    remade = asyncio.run(er.recompose_edit({"output_dir": root, "output_path": again, "headline": "New words",
                                             "headline_look": None, "include_captions": False, "caption_preset": "pop"}, lambda *_: None))
    assert abs(remade["duration_seconds"] - seconds) < 0.25
    card2 = frame_at(again, at, str(tmp_path / "card2.png"))
    assert mean_rgb(card2, slice(300, 900)).mean() > 200
    shots = os.environ.get("EDIT_RECORDING_SHOTS")
    if shots:
        os.makedirs(shots, exist_ok=True)
        for k, t in enumerate((1.0, 3.2, er.RAW_INTRO_SECONDS + 0.8, at, pin_t)):
            frame_path(out, t, os.path.join(shots, f"recipe-{k}.png"))
