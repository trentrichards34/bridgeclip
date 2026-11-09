"""Combine clips: shot types, framing, evening clips out, the clip order, and a real join of three phone-like clips
(one rotated, one at 29.97 fps, one filming a screen) checked for orientation, timing and sound/picture sync."""
import asyncio
import json
import os
import shutil
import subprocess

import numpy as np
import pytest

from clip_engine.services import combine_clips as cc
from clip_engine.services import edit_recording as er


def say(text, start, step=0.32, src=0, gap=0.04):
    out, t = [], start
    for token in text.split():
        out.append(er.Word(token, round(t * 1000), round((t + step - gap) * 1000), src))
        t += step
    return out


def _ffmpeg_ok():
    return shutil.which("ffmpeg") and shutil.which("ffprobe")


# ---------------------------------------------------------------------------
# Pure parts
# ---------------------------------------------------------------------------

def test_shot_type_thresholds():
    # A face in most frames, big enough: a talking head.
    assert cc.classify_shot(1.0, 0.3, 0.0) == "face"
    assert cc.classify_shot(0.5, 0.06, 0.6) == "face"
    # A tiny face (someone far away on a screen) doesn't make it a talking head; a big bright flat area makes a screen.
    assert cc.classify_shot(1.0, 0.05, 0.4) == "screen"
    assert cc.classify_shot(0.25, 0.2, 0.2) == "screen"
    # Little face and no screen found: still a screen shot (low face presence).
    assert cc.classify_shot(0.0, 0.0, 0.0) == "screen"
    assert cc.classify_shot(0.33, 0.2, 0.1) == "screen"
    # A face in some frames and no screen: kept as a talking head.
    assert cc.classify_shot(0.4, 0.2, 0.1) == "face"


def test_screen_crop_punches_in_toward_the_screen_and_stays_inside_the_frame():
    w, h, x, y = cc.screen_crop((1080, 1920), (0.5, 0.5))
    assert (w, h) == (938, 1670) and x == 71 and y == 125
    # Toward a screen at the top left, but weighted to the middle and never outside the picture.
    w, h, x, y = cc.screen_crop((1080, 1920), (0.0, 0.0))
    assert (x, y) == (0, 0)
    w2, h2, x2, y2 = cc.screen_crop((1080, 1920), (0.8, 0.3))
    assert 71 < x2 <= 1080 - w2 and 0 <= y2 < 125


def test_clips_are_evened_out_lightly_and_within_limits():
    clips = [{"shot": "face", "luma": 100}, {"shot": "face", "luma": 140}, {"shot": "screen", "luma": 200}, {"shot": "screen", "luma": 180}]
    targets = cc.luma_targets(clips)
    assert targets == {"face": 120.0, "screen": 190.0}
    # Half way, within ±0.08; a small difference is left alone.
    assert cc.brightness_shift(100, 120) == round(10 / 255, 4)
    assert cc.brightness_shift(20, 200) == cc.MAX_BRIGHTNESS
    assert cc.brightness_shift(120, 121) == 0.0
    assert cc.brightness_shift(None, 120) == 0.0
    assert cc.gain_db(-26.0) == 10.0 and cc.gain_db(-40.0) == 12.0 and cc.gain_db(-6.0) == -10.0 and cc.gain_db(None) == 0.0
    vf, af = cc.combine_filters({"shot": "screen", "size": [1080, 1920], "focus": [0.5, 0.5], "luma": 200, "lufs": -26.0}, 190.0)
    assert vf.startswith("crop=938:1670:71:125,eq=brightness=-0.0196") and af.startswith("volume=10.0dB,alimiter")
    assert cc.combine_filters({"shot": "face", "size": [1080, 1920], "luma": 120, "lufs": -16.0}, 120.0) == ("", "")


def test_the_body_plays_clip_by_clip_in_the_members_order_and_a_left_out_clip_plays_nothing():
    words = say("First clip says this.", 0.5, src=0) + say("Second clip says that.", 0.4, src=1) + say("Third clip closes.", 0.6, src=2)
    keep = [True] * len(words)
    pieces, timed = er.build_timeline(words, keep, None, None, order=[2, 0])
    assert [p.src for p in pieces] == [2, 0]
    assert [t[0] for t in timed] == ["Third", "clip", "closes.", "First", "clip", "says", "this."]
    # The hook can come from any clip (moved to the front), the rest keeps the order.
    hook = er.Span(4, 7)
    pieces, timed = er.build_timeline(words, keep, hook, None, order=[0, 1, 2])
    assert [t[0] for t in timed][:4] == ["Second", "clip", "says", "that."] and [p.src for p in pieces] == [1, 0, 2]


def test_the_plan_marks_clip_boundaries_and_checks_the_ai_order_and_proof():
    words = say("Look at my dashboard. Total earnings $8,188 this month.", 0.5, src=0) + say("You don't need a big audience.", 0.4, src=1)
    clips = [{"shot": "screen", "seconds": 7.7}, {"shot": "face", "seconds": 45.2}]
    text = er.format_transcript(words, [None] * len(words), ["IMG_2955.MOV", "IMG_2956.MOV"], clips)
    assert "--- Clip 1 (SCREEN: filming a screen, 7.7 s): IMG_2955.MOV ---" in text
    assert "--- Clip 2 (FACE: talking to camera, 45.2 s): IMG_2956.MOV ---" in text
    plan = er.validate_plan({}, words, [None] * len(words))
    money = next(i for i, w in enumerate(words) if w.text == "$8,188")
    good = er.combine_of({"order": [2, 1], "order_why": "Story first, then the proof.",
                          "proof": [{"word": money, "value": "$8,188", "label": "Total earnings"},
                                    {"word": money, "value": "$9,000", "label": "made up"}]}, words, plan, clips)
    assert good == {"ai_order": [1, 0], "order_why": "Story first, then the proof.", "proof": [{"word": money, "value": "$8,188", "label": "Total earnings"}]}
    # An order that misses or repeats a clip is dropped (and its why with it); a number not said is never shown.
    bad = er.combine_of({"order": [1, 1], "order_why": "x", "proof": [{"word": money, "value": "$9,000", "label": ""}]}, words, plan, clips)
    assert bad["ai_order"] is None and bad["order_why"] == ""
    # Without a usable proof from the AI, the first number said in each screen clip.
    assert bad["proof"] == [{"word": money, "value": "$8,188", "label": ""}]
    # Words in a face clip never get a proof graphic.
    assert er.proof_graphics([{"word": len(words) - 1, "value": "1", "label": ""}], words, plan["marks"], {0}) == []


# ---------------------------------------------------------------------------
# Real clips
# ---------------------------------------------------------------------------

def _clip(path, *, size, rate, seconds, color, words, rotate=None, volume=0.25, flash=None, screen=False):
    """A phone-like clip: a flat picture (a white screen with dark lines for `screen`), a tone where each word is said,
    and optionally a white flash with a 1 kHz beep at the same moment (to check sound and picture stay in step)."""
    expr = "+".join(f"between(t,{w.start_ms / 1000:.3f},{w.end_ms / 1000:.3f})" for w in words) or "0"
    audio = f"{volume}*sin(2*PI*300*t)*({expr})"
    video = f"color=c={color}:s={size}:r={rate}:d={seconds}"
    if screen:
        w, h = (int(v) for v in size.split("x"))
        video += "".join(f",drawbox=x={w // 6}:y={h // 5 + k * h // 12}:w={w * 2 // 3}:h={h // 40}:color=0x303030:t=fill" for k in range(6))
    if flash:
        a, b = flash
        video += f",drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,{a},{b})'"
        audio += f"+0.5*sin(2*PI*1000*t)*between(t,{a},{b})"
    tmp = path + ".tmp.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", video, "-f", "lavfi", "-i", f"aevalsrc='{audio}':s=48000:d={seconds}",
                    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", tmp], check=True)
    if rotate is not None:
        # Like a phone: the picture is stored sideways with a rotation tag.
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-display_rotation", str(rotate), "-i", tmp, "-c", "copy", path], check=True)
        os.remove(tmp)
    else:
        os.replace(tmp, path)


def _probe(path):
    return json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate,duration",
                                      "-show_entries", "format=duration", "-of", "json", path], capture_output=True, check=True).stdout)


def _lumas(path):
    text = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", path, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
                           "-an", "-f", "null", "-"], capture_output=True).stderr.decode()
    return [float(v) for v in __import__("re").findall(r"YAVG=([\d.]+)", text)]


def _beep_envelope(path, rate=1000):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "48000", "-af", "highpass=f=700,highpass=f=700,highpass=f=700",
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    samples = np.frombuffer(raw, dtype=np.float32)
    window = 48000 // rate
    n = len(samples) // window
    return np.sqrt((samples[:n * window].reshape(n, window) ** 2).mean(axis=1)), 1 / rate


@pytest.fixture(scope="module")
def three_clips(tmp_path_factory):
    if not _ffmpeg_ok():
        pytest.skip("needs FFmpeg")
    folder = tmp_path_factory.mktemp("combine")
    a_words = say("First I filmed this sideways.", 0.6, src=0)
    b_words = say("Then this one at a slower rate beep now", 0.5, src=1)
    c_words = say("And here is my screen.", 0.7, src=2)
    a, b, c = str(folder / "a.mov"), str(folder / "b.mp4"), str(folder / "c.mp4")
    # A: stored landscape 640x360 with a 90° rotation tag (upright it's 360x640); a mid-gray picture.
    _clip(a, size="640x360", rate=30, seconds=3.0, color="0x707070", words=a_words, rotate=90)
    # B: portrait at 29.97 fps, darker and quieter, with a white flash and a beep together at 2.42–2.66 s ("beep").
    beep = next(w for w in b_words if w.text == "beep")
    _clip(b, size="360x640", rate="30000/1001", seconds=3.5, color="0x404040", words=b_words, volume=0.08,
          flash=(beep.start_ms / 1000, beep.end_ms / 1000))
    # C: filming a screen: bright, flat, no face.
    _clip(c, size="360x640", rate=30, seconds=3.0, color="0xF0F0F0", words=c_words, screen=True)
    return {"folder": str(folder), "sources": [a, b, c], "words": a_words + b_words + c_words, "beep": beep}


@pytest.mark.skipif(not _ffmpeg_ok(), reason="needs FFmpeg")
def test_proxies_are_upright_30_fps_and_each_clip_is_looked_at(three_clips, tmp_path):
    root = str(tmp_path / "edit-run")
    os.makedirs(root)
    result = asyncio.run(cc.prepare_clips({"output_dir": root, "sources": three_clips["sources"]}, lambda *_: None))
    clips = {c["src"]: c for c in result["clips"]}
    for src in range(3):
        probe = _probe(clips[src]["proxy"])
        video = next(s for s in probe["streams"] if s["codec_type"] == "video")
        # Upright (the rotation tag applied) and at 30 fps, never upscaled.
        assert (video["width"], video["height"]) == (360, 640), (src, video)
        assert video["r_frame_rate"] == "30/1"
        assert any(s["codec_type"] == "audio" for s in probe["streams"])
        assert clips[src]["thumb"] and os.path.isfile(clips[src]["thumb"])
    saved = json.load(open(os.path.join(cc.clips_dir(root), cc.COMBINE_FILE)))["clips"]
    # The bright screen clip is a screen shot with a large bright area; the flat gray one has none.
    assert saved[2]["shot"] == "screen" and saved[2]["screen_share"] >= cc.SCREEN_SHARE and saved[0]["screen_share"] < cc.SCREEN_SHARE
    # Brightness and loudness are measured: the dark, quiet clip reads darker and quieter.
    assert saved[1]["luma"] < saved[0]["luma"] < saved[2]["luma"]
    assert saved[1]["lufs"] < saved[0]["lufs"]


@pytest.mark.skipif(not _ffmpeg_ok(), reason="needs FFmpeg")
def test_three_clips_join_in_order_upright_with_sound_and_picture_in_step(three_clips, tmp_path):
    root = str(tmp_path / "edit-run")
    os.makedirs(root)
    sources, words = three_clips["sources"], three_clips["words"]
    asyncio.run(cc.prepare_clips({"output_dir": root, "sources": sources}, lambda *_: None))
    # The member's order: the screen clip first, then A, then B (with dips between clips).
    config = {"output_dir": root, "sources": sources, "words": words, "keep": [True] * len(words), "hook": None, "cta": None,
              "popups": [], "sounds": [], "look": er.Look("", None, False, "pop", None), "title": "", "cost_usd": 0,
              "combine": {"order": [2, 0, 1], "transitions": False}, "sound_cache": str(tmp_path / "sounds")}
    result = asyncio.run(er.render_edit(config, lambda *_: None))
    out = result["path"]
    probe = _probe(out)
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    audio = next(s for s in probe["streams"] if s["codec_type"] == "audio")
    assert (video["width"], video["height"]) == (1080, 1920) and video["r_frame_rate"] == "30/1"
    pieces, timed = er.build_timeline(words, [True] * len(words), None, None, order=[2, 0, 1])
    total = er.reel_seconds(pieces)
    assert abs(float(probe["format"]["duration"]) - total) < 0.12
    assert abs(float(video["duration"]) - float(audio["duration"])) < 0.08
    assert [p.src for p in pieces] == [2, 0, 1]
    assert [t[0] for t in timed][:5] == ["And", "here", "is", "my", "screen."]
    # Each clip's dead air is trimmed: about its words plus a little air, not its whole length.
    assert total < 9.0 - 1.2
    # Sound and picture in step: the white flash and the beep land on the same frame (within one frame).
    lumas = _lumas(out)
    flash_frame = next(i for i, v in enumerate(lumas) if v > 200 and i / 30 > pieces[0].seconds + pieces[1].seconds)
    env, step = _beep_envelope(out)
    beep_at = next(i for i, v in enumerate(env) if v > 0.05) * step
    assert abs(flash_frame / 30 - beep_at) <= 1.5 / 30, (flash_frame / 30, beep_at)
    # The beep is where the timeline says the word is.
    beep_word = next(t for t in timed if t[0] == "beep")
    assert abs(beep_at - beep_word[1] / 1000) < 0.06
    # Evened out: the quiet clip is brought up toward the others, and the darker clip lightened (lightly).
    b_mid = (pieces[0].seconds + pieces[1].seconds + 0.3)
    assert lumas[int(b_mid * 30)] > 0x40 * 0.9  # not darker than it was


@pytest.mark.skipif(not _ffmpeg_ok(), reason="needs FFmpeg")
def test_transitions_dip_through_black_without_changing_the_length(three_clips, tmp_path):
    root = str(tmp_path / "edit-run")
    os.makedirs(root)
    sources, words = three_clips["sources"], three_clips["words"]
    asyncio.run(cc.prepare_clips({"output_dir": root, "sources": sources}, lambda *_: None))
    config = {"output_dir": root, "sources": sources, "words": words, "keep": [True] * len(words), "hook": None, "cta": None,
              "popups": [], "sounds": [], "look": er.Look("", None, False, "pop", None), "title": "", "cost_usd": 0,
              "combine": {"order": [0, 2], "transitions": True}, "sound_cache": str(tmp_path / "sounds")}
    out = asyncio.run(er.render_edit(config, lambda *_: None))["path"]
    pieces, _ = er.build_timeline(words, [True] * len(words), None, None, order=[0, 2])
    assert [p.src for p in pieces] == [0, 2]
    assert abs(float(_probe(out)["format"]["duration"]) - er.reel_seconds(pieces)) < 0.12
    lumas = _lumas(out)
    cut = round(pieces[0].seconds * 30)
    # Black right at the change of clip, the clips' own pictures either side of it.
    assert min(lumas[cut - 1:cut + 1]) < 30
    assert lumas[cut - 10] > 60 and lumas[cut + 10] > 150
