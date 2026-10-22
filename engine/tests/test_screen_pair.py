"""Camera + screen: lining the two recordings up, the layout plan, the editor scenes, the bubble and inset layouts in
the editor's export, and the runner's request checks."""
import json
import os
import shutil
import subprocess
import sys

import numpy as np
import pytest

from clip_engine.services import screen_pair as sp
from clip_engine.services.layout_analyzer import LayoutType
from clip_engine.services.manual_editor import manual_plan, validate_candidate

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "bridge"))

RATE = sp.SYNC_RATE
HAVE_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def speech(seconds, seed=3, rate=RATE):
    """Syllable-like bursts with pauses, roughly speech-shaped."""
    rng = np.random.default_rng(seed)
    x = np.zeros(int(seconds * rate), np.float32)
    t = 0.0
    while t < seconds - 0.5:
        d, a = rng.uniform(0.08, 0.35), rng.uniform(0.2, 1.0)
        i0, i1 = int(t * rate), int((t + d) * rate)
        tt = np.arange(i1 - i0) / rate
        f = rng.uniform(120, 260)
        x[i0:i1] += a * np.sin(np.linspace(0, np.pi, i1 - i0)) * (np.sin(2 * np.pi * f * tt) + 0.5 * np.sin(4 * np.pi * f * tt)
                                                                   + 0.3 * rng.standard_normal(i1 - i0))
        t += d + (rng.uniform(0.02, 0.15) if rng.random() < 0.8 else rng.uniform(0.3, 1.2))
    return x


def as_screen_mic(camera, offset, seconds=40, seed=9):
    """What a laptop microphone hears of the same voice, starting `offset` s after the camera: duller, quieter, noisier."""
    rng = np.random.default_rng(seed)
    k = int(round(offset * RATE))
    x = camera[k:].copy() if k >= 0 else np.concatenate([np.zeros(-k, np.float32), camera])
    x = np.convolve(x, np.ones(5) / 5, mode="same") * 0.3 + 0.02 * rng.standard_normal(x.size)
    return x[:int(seconds * RATE)].astype(np.float32)


@pytest.mark.parametrize("offset", [2.37, -1.5, 0.0, 12.0, 0.733])
def test_offset_found_by_sound(offset):
    camera = speech(60)
    found, confidence = sp.audio_offset(camera, as_screen_mic(camera, offset))
    assert abs(found - offset) < 0.002
    assert confidence >= sp.MIN_CONFIDENCE


def test_unrelated_sound_is_not_trusted():
    camera = speech(60)
    _, confidence = sp.audio_offset(camera, np.random.default_rng(1).standard_normal(30 * RATE).astype(np.float32))
    assert confidence < sp.MIN_CONFIDENCE
    _, other = sp.audio_offset(camera, speech(30, seed=77))
    assert other < sp.MIN_CONFIDENCE


def test_overlap_and_creation_times():
    assert sp.overlap_ms(2.37, 45.0, 40.0) == (2370, 42370)
    assert sp.overlap_ms(-5.0, 30.0, 20.0) == (0, 15000)
    assert sp.overlap_ms(31.0, 30.0, 20.0) is None
    assert sp.parse_created("2026-10-21T13:27:18.000000Z") == pytest.approx(1792589238.0)
    assert sp.parse_created("1970-01-01T00:00:00.000000Z") is None
    assert sp.parse_created("not a date") is None


def _wav_video(path, audio, offset_meta=None, with_audio=True, seconds=12):
    """A small video file (a test picture) with this sound, and a creation_time."""
    wav = path + ".wav"
    import wave
    with wave.open(wav, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes((np.clip(audio[:seconds * RATE], -1, 1) * 30000).astype(np.int16).tobytes())
    args = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=s=320x180:r=30:d={seconds}"]
    if with_audio:
        args += ["-i", wav, "-c:a", "aac", "-shortest"]
    args += ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
    if offset_meta is not None:
        args += ["-metadata", f"creation_time={offset_meta}"]
    subprocess.run([*args, path], check=True)
    os.remove(wav)


@pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg")
def test_sync_pair_by_sound_then_by_file_times(tmp_path):
    camera_audio = speech(14)
    camera = str(tmp_path / "camera.mp4")
    _wav_video(camera, camera_audio, "2026-10-21T13:27:18.000000Z", seconds=14)
    screen = str(tmp_path / "screen.mov")
    _wav_video(screen, as_screen_mic(camera_audio, 2.37, seconds=11), "2026-10-21T13:27:20.000000Z", seconds=11)
    result = sp.sync_pair(camera, screen, str(tmp_path / "work"))
    assert result["method"] == "audio" and abs(result["offset_ms"] - 2370) <= 15, result
    assert result["overlap_ms"][0] == result["offset_ms"]
    # No sound on the screen recording: when each file says it was made (seconds apart).
    silent = str(tmp_path / "silent.mov")
    _wav_video(silent, camera_audio, "2026-10-21T13:27:20.000000Z", with_audio=False, seconds=11)
    result = sp.sync_pair(camera, silent, str(tmp_path / "work"))
    assert (result["method"], result["offset_ms"], result["screen_audio"]) == ("time", 2000, False)
    # Neither: nothing to go on (the member lines it up by hand).
    bare = str(tmp_path / "bare.mov")
    _wav_video(bare, camera_audio, None, with_audio=False, seconds=11)
    assert sp.sync_pair(camera, bare, str(tmp_path / "work"))["method"] == "none"


# ---------------------------------------------------------------------------
# Layouts
# ---------------------------------------------------------------------------

def words_every(seconds, step=0.4, text="word"):
    out, t, i = [], 0.1, 0
    while t + step < seconds:
        out.append([f"{text}{i}", round(t * 1000), round((t + step - 0.05) * 1000), i])
        t += step
        i += 1
    return out


def test_plan_sections_face_for_hook_and_cta_style_elsewhere():
    words = words_every(20)
    sections = sp.plan_sections(20000, words, "screen_top", hook_end_ms=2600, cta_start_ms=17000)
    assert [k for _, k in sections] == ["face", "screen_top", "face"]
    assert sections[0][0] == 0
    # Switches land between words, never inside one.
    for at, _ in sections[1:]:
        assert not any(s < at < e for _, s, e, _ in words)
    assert 2400 <= sections[1][0] <= 2800 and 16800 <= sections[2][0] <= 17200
    # Off: the member's style all the way through.
    assert sp.plan_sections(20000, words, "bubble", hook_end_ms=2600, cta_start_ms=17000, auto=False) == [(0, "bubble")]


def test_plan_sections_screen_alone_when_busy_and_pointed_at():
    words = words_every(20)
    # "click this" said while the screen is busy from 6 s to 11 s.
    words[20][0], words[21][0] = "click", "this"
    activity = [0.2] * 100
    for i in range(30, 55):
        activity[i] = 6.0
    sections = sp.plan_sections(20000, words, "face_top", activity=activity)
    kinds = dict((k, a) for a, k in sections)
    assert "screen" in kinds and 5500 <= kinds["screen"] <= 6600
    # Busy but nobody points at it: stays the style.
    quiet = [w[:] for w in words]
    quiet[20][0], quiet[21][0] = "and", "so"
    assert "screen" not in [k for _, k in sp.plan_sections(20000, quiet, "face_top", activity=activity)]


def test_plan_sections_no_screen_shows_face_and_short_parts_merge():
    words = words_every(12)
    sections = sp.plan_sections(12000, words, "screen_top", uncovered=[(9000, 12000)], auto=False)
    assert [k for _, k in sections] == ["screen_top", "face"] and abs(sections[1][0] - 9000) <= 400
    # A part under MIN_SECTION_MS joins its neighbor.
    assert sp.merge_short([(0, "face"), (2000, "screen"), (2500, "face")], 6000) == [(0, "face")]


def test_uncovered_ranges_on_the_reels_clock():
    from clip_engine.services.edit_recording import Piece
    pieces = [Piece(0, 0.0, 3.0), Piece(0, 5.0, 8.0), Piece(0, 40.0, 44.0)]
    # The screen ran from camera 2 s to 42 s.
    assert sp.uncovered_ranges(pieces, 2.0, 40.0) == [(0, 2000), (8000, 10000)]


GEOM = sp.geometry_for(1920, 1080)


def project_with(scenes, duration=10000):
    c = {"id": "screen-reel", "title": "Demo", "ranges": [[0, duration]], "scenes": scenes, "captions": True, "caption_preset": "pop",
         "video_speed": 1, "status": "baked", "caption_edits": [], "caption_suppression_ranges": [], "caption_y": None, "hook": None}
    return {"width": sp.CANVAS_W, "height": sp.CANVAS_H, "duration_ms": duration, "candidates": [c]}, c


def test_scenes_for_each_layout_are_valid_editor_scenes():
    sections = [(0, "face"), (2000, "screen_top"), (5000, "face_top"), (6500, "screen"), (8000, "bubble")]
    scenes = sp.scenes_for(sections, 10000, GEOM, 0.45, "fit")
    project, c = project_with(scenes)
    validate_candidate(c, 10000)
    assert [s["layout"] for s in scenes] == ["fill", "split", "split", "inset", "bubble"]
    assert scenes[1]["split"] == 0.45 and scenes[2]["split"] == 0.55
    plan = manual_plan(project, c)
    kinds = [(s.layout, s.content_box is not None, s.manual_bubble is not None) for s in plan.shots]
    assert kinds[3] == (LayoutType.SCREEN, True, False) and kinds[4] == (LayoutType.SCREEN, True, True)
    # Fit: the top crop holds all of the screen.
    x, y, w, h = scenes[1]["crops"][0]
    cx, cy, cw, ch = GEOM.normalized(GEOM.content)
    assert x <= cx + 1e-6 and y <= cy + 1e-6 and x + w >= cx + cw - 1e-6 and y + h >= cy + ch - 1e-6


def test_slow_zoom_is_a_gentle_push_toward_the_busy_part():
    sections = [(0, "screen_top")]
    box = (GEOM.content[0] + 100, GEOM.content[1] + 100, GEOM.content[0] + 600, GEOM.content[1] + 400)
    scenes = sp.scenes_for(sections, 8000, GEOM, 0.45, "fit", focus={0: box}, zoom=True)
    assert len(scenes) == 2 and scenes[1]["at_ms"] == 400 and 100 <= scenes[1]["transition_ms"] <= 5000
    project, c = project_with(scenes, 8000)
    validate_candidate(c, 8000)
    before, after = scenes[0]["crops"][0], scenes[1]["crops"][0]
    assert after[2] < before[2] and after[2] >= before[2] / sp.MAX_PUSH - 1e-6
    # The busy part is most of the screen: nothing to push toward.
    whole = (GEOM.content[0], GEOM.content[1], GEOM.content[0] + GEOM.content[2], GEOM.content[1] + GEOM.content[3])
    assert len(sp.scenes_for(sections, 8000, GEOM, 0.45, "fit", focus={0: whole}, zoom=True)) == 1


def test_editor_rejects_bad_new_layouts():
    scenes = sp.scenes_for([(0, "screen"), (3000, "bubble")], 10000, GEOM, 0.45, "fit")
    _, c = project_with([{**scenes[1], "crops": scenes[1]["crops"][:1]}])
    with pytest.raises(ValueError):
        validate_candidate({**c, "scenes": [{**scenes[1], "at_ms": 0, "crops": scenes[1]["crops"][:1]}]}, 10000)
    with pytest.raises(ValueError):
        validate_candidate({**c, "scenes": [scenes[0], {**scenes[0], "at_ms": 3000, "transition_ms": 600}]}, 10000)


@pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg")
def test_bubble_and_inset_render(tmp_path):
    """The export's filter for the two new layouts runs, and the bubble is round with the screen around it."""
    from PIL import Image
    from clip_engine.services.layout_renderer import shot_chain
    source = str(tmp_path / "canvas.mp4")
    # The canvas: a red camera region and a green-and-blue screen region (blurred blue around a green screen).
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=red:s={sp.CANVAS_W}x{sp.CANVAS_H}:r=30:d=1", "-vf",
                    f"drawbox=x=1080:y=0:w=1920:h=1920:color=blue:t=fill,drawbox=x={GEOM.content[0]}:y={GEOM.content[1]}:w={GEOM.content[2]}:h={GEOM.content[3]}:color=green:t=fill",
                    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", source], check=True)
    for kind in ("screen", "bubble"):
        project, c = project_with(sp.scenes_for([(0, kind)], 1000, GEOM, 0.45, "fit"), 1000)
        shot = manual_plan(project, c).shots[0]
        graph = shot_chain(0, shot, sp.CANVAS_W, sp.CANVAS_H, 1080, 1920)
        out = str(tmp_path / f"{kind}.png")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", source, "-filter_complex", f"[0:v]trim=duration=0.2[t0];{graph}", "-map", "[v0]",
                        "-frames:v", "1", out], check=True)
        img = Image.open(out).convert("RGB")
        assert img.size == (1080, 1920)
        r, g, b = img.getpixel((540, 960))
        assert g > 100 and r < 60 and b < 60, (kind, img.getpixel((540, 960)))  # the screen (ffmpeg green is 0,128,0)
        if kind == "bubble":
            from clip_engine.services.layout_renderer import BUBBLE_MARGIN, BUBBLE_SIZE
            d = round(1080 * BUBBLE_SIZE / 2) * 2
            cx = 1080 - 1080 * BUBBLE_MARGIN - d / 2
            cy = 960 + 1080 * 9 / 16 / 2
            assert img.getpixel((int(cx), int(cy)))[0] > 180  # the face (red) in the bubble's middle
            assert img.getpixel((int(cx + d * 0.48), int(cy + d * 0.48)))[0] < 120  # its corner is not face: it's round
            ring = img.getpixel((int(cx), int(cy - d / 2 - 4)))
            assert min(ring) > 200  # the white ring


def test_runner_checks_the_screen_requests(tmp_path):
    from edit_runner import parse_request
    out = str(tmp_path)
    base = {"mode": "render", "output_dir": out, "sources": ["/v/camera.mov"], "words": [["hi", 0, 300, 0], ["there", 320, 600, 0]],
            "keep": [True, True], "hook": None, "cta": None, "popups": [], "sounds": [], "headline": "", "include_captions": True,
            "caption_preset": "pop", "title": "x", "cost_usd": 0}
    screen = {"path": "/v/screen.mov", "offset_ms": 2370, "style": "screen_top", "split": 0.45, "fit": "fit", "zoom": True, "auto": True}
    assert parse_request({**base, "screen": screen})["screen"] == {**screen, "split": 0.45}
    for bad in ({**screen, "path": "relative.mov"}, {**screen, "offset_ms": 2.5}, {**screen, "style": "face"}, {**screen, "split": 0.9},
                {**screen, "fit": "stretch"}, {**screen, "zoom": 1}, {**screen, "extra": 1}, {k: v for k, v in screen.items() if k != "auto"}):
        with pytest.raises(ValueError):
            parse_request({**base, "screen": bad})
    with pytest.raises(ValueError):
        parse_request({**base, "sources": ["/v/a.mov", "/v/b.mov"], "words": [["hi", 0, 300, 0], ["there", 320, 600, 1]], "screen": screen})
    assert parse_request({"mode": "sync", "output_dir": out, "camera": "/v/a.mov", "screen": "/v/b.mov"})["mode"] == "sync"
    with pytest.raises(ValueError):
        parse_request({"mode": "sync", "output_dir": out, "camera": "a.mov", "screen": "/v/b.mov"})
    preview = {"mode": "screen_preview", "output_dir": out, "camera": "/v/a.mov", "screen": "/v/b.mov", "offset_ms": -1500, "at_ms": 0,
               "output_path": os.path.join(out, "p.mp4")}
    assert parse_request(preview)["offset_ms"] == -1500
    with pytest.raises(ValueError):
        parse_request({**preview, "output_path": "/elsewhere/p.mp4"})
    with pytest.raises(ValueError):
        parse_request({**preview, "offset_ms": 10 ** 9})
