"""Motion graphics outside the clip editor: on a reel from Edit my recording (each starts as its word is said, never
during a half-screen card, pop-ups give way to it, re-makes keep it) and on the member's part of a Remix (on the
take's clock, left out during a proof screenshot or outside the part of the take used, kept with the edit bundle)."""
import asyncio
import json
import os
import shutil
import subprocess
import sys

import numpy as np
import pytest
from PIL import Image

from clip_engine.services import edit_recording as er
from clip_engine.services import remix_layouts as rl
from clip_engine.services import react_thoughts as rt
from clip_engine.services.graphics_overlay import REEL_DIR, checked_graphics, overlapping

needs_ffmpeg = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="needs FFmpeg")
NAME = "c" * 64 + ".mov"


def red_render(folder, name=NAME, seconds=2.0, size=(108, 192)):
    """A transparent qtrle render (like main draws): a red box in the upper middle, see-through elsewhere."""
    os.makedirs(folder, exist_ok=True)
    frames = os.path.join(folder, "frames")
    os.makedirs(frames, exist_ok=True)
    w, h = size
    for i in range(round(seconds * 30)):
        im = Image.new("RGBA", size, (0, 0, 0, 0))
        im.paste((255, 0, 0, 255), (w // 4, h // 4, 3 * w // 4, h // 2))
        im.save(os.path.join(frames, f"{i:03d}.png"))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", os.path.join(frames, "%03d.png"), "-c:v", "qtrle",
                    "-pix_fmt", "argb", os.path.join(folder, name)], check=True)
    shutil.rmtree(frames)
    return name


def frame_at(path, t, out):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", path, "-frames:v", "1", out], check=True)
    return np.asarray(Image.open(out).convert("RGB")).astype(float)


def red_share(frame):
    """How much of the graphic's box (upper middle of the frame) is red."""
    box = frame[520:900, 300:780]
    return ((box[..., 0] > 180) & (box[..., 1] < 80) & (box[..., 2] < 80)).mean()


def say(text, start, step=0.32, src=0):
    out, t = [], start
    for token in text.split():
        out.append(er.Word(token, round(t * 1000), round((t + step - 0.04) * 1000), src))
        t += step
    return out


# ---------------------------------------------------------------------------
# The request and where graphics go
# ---------------------------------------------------------------------------

def test_reel_renders_live_in_their_own_folder_the_editor_sweep_leaves_alone(tmp_path):
    (tmp_path / ".graphics" / REEL_DIR).mkdir(parents=True)
    (tmp_path / ".graphics" / REEL_DIR / NAME).write_bytes(b"x" * 100)
    assert checked_graphics(tmp_path, [{"file": NAME, "start_ms": 100, "duration_ms": 900}], 5000, REEL_DIR)[0]["path"].endswith(f"reel/{NAME}")
    with pytest.raises(ValueError):
        checked_graphics(tmp_path, [{"file": NAME, "start_ms": 100, "duration_ms": 900}], 5000)  # not in .graphics/ itself
    with pytest.raises(ValueError):
        checked_graphics(tmp_path, [], 5000, "../x")
    assert overlapping(1000, 1000, [(1.5, 3.0)]) and not overlapping(1000, 400, [(1.5, 3.0)])


def test_edit_graphics_start_on_their_words_and_never_during_a_card():
    starts = {3: 1200, 7: 4000, 9: 9000}
    cards = [{"card": {"type": "stat", "title": "15", "items": ["x"]}, "start_ms": 3800, "seconds": 2.0}]
    warnings = []
    placed = er.place_graphics([{"file": NAME, "word": 3, "duration_ms": 2000}, {"file": NAME, "word": 7, "duration_ms": 2000},
                                {"file": NAME, "word": 5, "duration_ms": 2000}, {"file": NAME, "word": 9, "duration_ms": 3000}], starts, cards, 9.5, warnings)
    # Word 3 plays; word 7 lands on the card (left out); word 5 was cut; word 9 is trimmed to the end.
    assert placed == [{"file": NAME, "start_ms": 1200, "duration_ms": 2000}, {"file": NAME, "start_ms": 9000, "duration_ms": 500}]
    assert any("came during a card" in w for w in warnings) and any("word was cut" in w for w in warnings)


def test_the_edit_runner_checks_the_graphics_it_is_sent():
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "bridge"))
    import edit_runner
    words = [["Hi", 0, 300, 0], ["there", 300, 600, 0], ["friend.", 600, 900, 0]]
    base = {"mode": "render", "output_dir": "/tmp/x", "sources": ["/tmp/a.mp4"], "words": words, "keep": [True, True, True],
            "headline": "", "include_captions": False, "caption_preset": "pop"}
    good = edit_runner.parse_request({**base, "graphics": [{"file": NAME, "word": 1, "duration_ms": 2000}]})
    assert good["graphics"] == [{"file": NAME, "word": 1, "duration_ms": 2000}]
    for bad in ([{"file": "../x.mov", "word": 1, "duration_ms": 2000}], [{"file": NAME, "word": 3, "duration_ms": 2000}],
                [{"file": NAME, "word": 1, "duration_ms": 90000}], [{"file": NAME, "word": 1, "duration_ms": 2000, "x": 1}]):
        with pytest.raises(ValueError):
            edit_runner.parse_request({**base, "graphics": bad})


def test_the_remix_runner_checks_graphics_and_a_trimmed_take():
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "bridge"))
    import remix_runner
    assert remix_runner.parse_graphics({"0": [{"file": NAME, "at_ms": 2000, "duration_ms": 3000}]}, "clip_then_me", "render") == \
        {"0": [{"file": NAME, "at_ms": 2000, "duration_ms": 3000}]}
    for bad in ({"0": [{"file": NAME, "at_ms": -1, "duration_ms": 3000}]}, {"x": []}, {"0": [{"file": "a.mov", "at_ms": 0, "duration_ms": 3000}]}):
        with pytest.raises(ValueError):
            remix_runner.parse_graphics(bad, "clip_then_me", "render")
    with pytest.raises(ValueError):
        remix_runner.parse_graphics({"0": []}, "commentary", "render")
    with pytest.raises(ValueError):
        remix_runner.parse_graphics({"0": []}, "clip_then_me", "plan")
    take = "/tmp/take.mp4"
    parsed = remix_runner.parse_recordings({"0": {"reaction": {"path": take, "offset_s": 0, "trim": [1.5, 7.25]}}}, "clip_then_me")
    assert parsed["0"]["reaction"]["trim"] == [1.5, 7.25]
    for bad in ([7, 1], [0, 0.5], ["a", 2]):
        with pytest.raises(ValueError):
            remix_runner.parse_recordings({"0": {"reaction": {"path": take, "trim": bad}}}, "clip_then_me")
    with pytest.raises(ValueError):
        remix_runner.parse_recordings({"0": {"reaction": {"path": take, "trim": [0, 3]}}}, "silent")


def test_their_clips_box_can_be_asked_for_at_the_top_or_bottom():
    assert rl.parse_layout({"part1": "box", "box_at": "top"}, "react_thoughts")["box_at"] == "top"
    assert rl.parse_layout(None, "react_thoughts")["box_at"] == "auto"
    for raw, fmt in (({"part1": "phone", "box_at": "top"}, "react_thoughts"), ({"box_at": "bottom"}, "clip_then_me"), ({"box_at": "left"}, "react_thoughts")):
        with pytest.raises(ValueError):
            rl.parse_layout(raw, fmt)
    # A face just above the middle: the box goes under it by itself, or above it when asked (both have room).
    face = (400, 850, 160, 180)
    assert rt.part1_layout(face, 500, 240, 1920, 1500)["at"] == "bottom"
    assert rt.part1_layout(face, 500, 240, 1920, 1500, prefer="top")["at"] == "top"
    # Asked for a side without room: the other side, so the face is never covered.
    low = (400, 1100, 280, 320)
    assert rt.part1_layout(low, 700, 240, 1920, 1500, prefer="bottom")["at"] == "top"


# ---------------------------------------------------------------------------
# Rendered: a reel with a graphic, its card and pop-up, and the re-make
# ---------------------------------------------------------------------------

@needs_ffmpeg
def test_an_edited_reel_shows_its_graphic_on_its_word_and_a_remake_keeps_it(tmp_path):
    root = str(tmp_path / "edit-run")
    os.makedirs(root)
    source = str(tmp_path / "recording.mp4")
    words = say("Here are the three steps.", 0.3) + say("Fifteen billion messages wait.", 2.2) + say("Follow me for more tips.", 4.4)
    expr = "+".join(f"between(t,{w.start_ms / 1000:.3f},{w.end_ms / 1000:.3f})" for w in words)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x203040:s=640x360:r=30:d=7", "-f", "lavfi", "-i",
                    f"aevalsrc='0.25*sin(2*PI*300*t)*({expr})':s=48000:d=7", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", source], check=True)
    red_render(os.path.join(root, ".graphics", REEL_DIR), seconds=2.0)
    fifteen = next(i for i, w in enumerate(words) if w.text == "Fifteen")
    follow = next(i for i, w in enumerate(words) if w.text == "Follow")
    here = next(i for i, w in enumerate(words) if w.text == "three")
    look = er.Look("", None, False, "pop", None)
    config = {"output_dir": root, "sources": [source], "words": words, "keep": [True] * len(words), "hook": None, "cta": None,
              # A pop-up while the graphic plays gives way; a card on "Follow" leaves the second graphic out.
              "popups": [{"word": fifteen + 1, "text": "15 billion", "kind": "number"},
                         {"word": follow, "kind": "card", "card": {"type": "list", "title": "Follow me", "items": ["For more", "Tips"]}, "seconds": 2.0}],
              "sounds": [], "look": look, "title": "", "cost_usd": 0, "sound_cache": str(tmp_path / "sounds"),
              "graphics": [{"file": NAME, "word": fifteen, "duration_ms": 1300}, {"file": NAME, "word": follow, "duration_ms": 1500},
                           {"file": NAME, "word": here, "duration_ms": 900}]}
    result = asyncio.run(er.render_edit(config, lambda *_: None))
    out = result["path"]
    pieces, timed = er.build_timeline(words, config["keep"], None, None)
    at = {i: s / 1000 for _, s, _, i in timed}
    assert red_share(frame_at(out, at[fifteen] + 0.7, str(tmp_path / "during.png"))) > 0.5, "the graphic shows on its word"
    assert red_share(frame_at(out, at[here] - 0.4, str(tmp_path / "before.png"))) < 0.05
    assert at[fifteen] + 1.3 < at[follow], "the first graphic ends before the card"
    assert red_share(frame_at(out, (at[fifteen] + 1.3 + at[follow]) / 2, str(tmp_path / "after.png"))) < 0.05
    assert any("1 graphic was left out: it came during a card" in w for w in result["warnings"]), result["warnings"]
    assert any("came during a graphic" in w for w in result["warnings"])
    bundle = json.load(open(os.path.join(root, ".edit", "clip_00", "edit.json")))
    assert [g["start_ms"] for g in bundle["graphics"]] == [round(at[here] * 1000), round(at[fifteen] * 1000)]
    assert bundle["popups"] == [], "the pop-up that gave way isn't made again"
    shots = os.environ.get("REEL_GRAPHICS_SHOTS")
    if shots:
        os.makedirs(shots, exist_ok=True)
        frame_at(out, at[fifteen] + 0.7, os.path.join(shots, "edit-reel-graphic.png"))
    # "Edit hook text & captions" in the Library: the graphic is still there.
    again = os.path.join(root, ".recompose-test.mp4")
    asyncio.run(er.recompose_edit({"output_dir": root, "output_path": again, "headline": "New hook words", "headline_look": None,
                                   "include_captions": False, "caption_preset": "pop"}, lambda *_: None))
    assert red_share(frame_at(again, at[fifteen] + 0.7, str(tmp_path / "again.png"))) > 0.5


# ---------------------------------------------------------------------------
# Remix: the member's part
# ---------------------------------------------------------------------------

class FakeResult:
    def __init__(self, path, manifest, seconds, fmt):
        self.path, self.manifest_path, self.duration_seconds, self.format, self.warnings = path, manifest, seconds, fmt, []


@needs_ffmpeg
def test_remix_graphics_play_on_the_take_clock_and_stay_off_proof_screenshots(tmp_path):
    from clip_engine.services import remix_service as rs
    root = str(tmp_path / "remix-run")
    os.makedirs(root)
    video = os.path.join(root, "clip_00.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x406080:s=1080x1920:r=30:d=8", "-f", "lavfi", "-i",
                    "sine=frequency=300:d=8", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video], check=True)
    red_render(os.path.join(root, ".graphics", REEL_DIR), seconds=1.5)
    manifest = os.path.join(root, "clip_00.source.json")
    # Their clip for 2 s, then the take; a proof screenshot shows 5.5–7 s of the video.
    json.dump({"timeline": [{"part": "clip", "start_seconds": 0, "seconds": 2.0}, {"part": "take", "start_seconds": 2.0, "seconds": 6.0}],
               "presenter": {"clip_then_me": {"proofs": [{"start_seconds": 5.5, "seconds": 1.5, "label": "My post"}]}}}, open(manifest, "w"))
    bundle_dir = rs.edit_dir(root, "clip_00")
    os.makedirs(bundle_dir)
    json.dump({"version": rs.EDIT_VERSION, "kind": "panel"}, open(os.path.join(bundle_dir, "edit.json"), "w"))
    result = FakeResult(video, manifest, 8.0, "clip_then_me")
    remixer = rs.Remixer.__new__(rs.Remixer)
    # The take was trimmed to start 1 s in: a graphic at 2.5 s of the take plays at 2 + 1.5 = 3.5 s of the video.
    recording = {"reaction": {"path": "/x.mp4", "offset_s": 0.0, "trim": [1.0, 7.0]}}
    graphics = [{"file": NAME, "at_ms": 2500, "duration_ms": 1500}, {"file": NAME, "at_ms": 5000, "duration_ms": 1500}, {"file": NAME, "at_ms": 500, "duration_ms": 1000}]
    remixer._member_graphics(result, graphics, recording, root)
    assert red_share(frame_at(video, 4.2, str(tmp_path / "on.png"))) > 0.5
    assert red_share(frame_at(video, 3.2, str(tmp_path / "before.png"))) < 0.05
    assert red_share(frame_at(video, 6.2, str(tmp_path / "proof.png"))) < 0.05, "the one over the proof screenshot is left out"
    assert any("proof screenshot" in w for w in result.warnings) and any("outside the part of your take" in w for w in result.warnings)
    saved = json.load(open(os.path.join(bundle_dir, "edit.json")))
    assert saved["graphics"] == [{"file": NAME, "start_ms": 3500, "duration_ms": 1500}]
    shots = os.environ.get("REEL_GRAPHICS_SHOTS")
    if shots:
        os.makedirs(shots, exist_ok=True)
        frame_at(video, 4.2, os.path.join(shots, "remix-take-graphic.png"))


def test_a_trimmed_take_keeps_the_words_heard_in_the_part_used(tmp_path):
    from clip_engine.services import remix_service as rs
    take = tmp_path / "take.mp4"
    take.write_bytes(b"x" * 10)
    identity = rs.take_identity({"path": str(take), "offset_s": 0.0})
    saved = {"member": {"take": identity, "words": [["Um", 200, 500], ["Honestly", 1200, 1700], ["it", 1800, 1900], ["works.", 2000, 2400], ["Bye.", 6000, 6300]]}}
    remixer = rs.Remixer.__new__(rs.Remixer)
    words = asyncio.run(remixer._member_words(saved, {"path": str(take), "offset_s": 0.0, "trim": [1.0, 5.0]}, str(take), str(tmp_path), [], lambda *_: None, [1.0, 5.0]))
    assert [(w.word, w.start_time_ms) for w in words] == [("Honestly", 200), ("it", 800), ("works.", 1000)]
