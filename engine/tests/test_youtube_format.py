"""YouTube videos (landscape, long) from Edit my recording: the format suggestion, landscape layout math, the long-form
pacing profile, key-line captions, sectioned planning, chapters, chunked bakes (memory stays bounded on a 20-minute
video) and a real picture-in-picture render made into a 16:9 editor project."""
import asyncio
import json
import os
import resource
import shutil
import subprocess

import numpy as np
import pytest
from PIL import Image

from clip_engine.services import edit_recording as er
from clip_engine.services import longform as lf


def say(text, start, step=0.32, src=0):
    out, t = [], start
    for token in text.split():
        out.append(er.Word(token, round(t * 1000), round((t + step - 0.04) * 1000), src))
        t += step
    return out


def timed_of(words):
    return [(w.text, w.start_ms, w.end_ms, i) for i, w in enumerate(words)]


# ---------------------------------------------------------------------------
# Format suggestion
# ---------------------------------------------------------------------------

def test_long_or_landscape_recordings_are_suggested_as_youtube_and_short_vertical_ones_as_reels():
    assert lf.suggest_format(1080, 1920, 45) == "reel"
    assert lf.suggest_format(1080, 1920, 179) == "reel"
    assert lf.suggest_format(1080, 1920, 180) == "youtube"
    assert lf.suggest_format(1920, 1080, 26 * 60) == "youtube"
    assert lf.suggest_format(1920, 1080, 90) == "youtube"
    # A short landscape clip (a webcam take for a reel) stays a reel; an unreadable size goes by length only.
    assert lf.suggest_format(1920, 1080, 30) == "reel"
    assert lf.suggest_format(None, None, 200) == "youtube"
    assert lf.suggest_format(1000, 1000, 120) == "reel"


def test_the_bridge_takes_a_youtube_format_and_its_layout_and_keeps_reels_as_they_were():
    import edit_runner
    words = [["Hello", 0, 400, 0], ["world.", 450, 900, 0], ["Again.", 1000, 1400, 0]]
    base = {"mode": "render", "output_dir": "/tmp/edit-x", "sources": ["/tmp/a.mp4"], "words": words, "keep": [True] * 3, "popups": [], "sounds": []}
    reel = edit_runner.parse_request(base)
    assert "format" not in reel and "youtube" not in reel
    yt = edit_runner.parse_request({**base, "format": "youtube", "youtube": {"pip_size": "medium"}, "chapters": [{"word": 0, "title": "Hello world"}]})
    assert yt["format"] == "youtube" and yt["youtube"] == {**lf.DEFAULT_YOUTUBE, "pip_size": "medium"}
    assert yt["chapters"] == [{"word": 0, "title": "Hello world"}]
    for bad in ({"format": "tiktok"}, {"youtube": {"pip_size": "huge"}, "format": "youtube"}, {"youtube": {}},
                {"format": "youtube", "chapters": [{"word": 9, "title": "x"}]}, {"format": "youtube", "youtube": {"captions": "none"}}):
        with pytest.raises(ValueError):
            edit_runner.parse_request({**base, **bad})
    plan = edit_runner.parse_request({"mode": "plan", "output_dir": "/tmp/x", "sources_count": 1, "words": words, "format": "youtube"})
    assert plan["format"] == "youtube"
    assert "format" not in edit_runner.parse_request({"mode": "plan", "output_dir": "/tmp/x", "sources_count": 1, "words": words})


# ---------------------------------------------------------------------------
# Landscape layout math
# ---------------------------------------------------------------------------

def test_the_webcam_card_is_large_on_the_right_or_in_the_corner_and_the_screen_fits_beside_it():
    for size in lf.PIP_SIZES:
        for corner in lf.PIP_CORNERS:
            x, y, w, h = lf.pip_rect(size, corner)
            assert all(v % 2 == 0 for v in (x, y, w, h))
            assert x >= 0 and y >= 0 and x + w <= 1920 - 38 and y + h <= 1080 - 38
    # On the right: a tall card (3:4), vertically centered, about 30% of the width when large (not a tiny corner).
    x, y, w, h = lf.pip_rect("large", "right")
    assert abs(w / h - 3 / 4) < 0.01 and abs((y + h / 2) - 540) <= 2 and 0.28 <= w / 1920 <= 0.32
    assert lf.pip_rect("small", "right")[2] < lf.pip_rect("medium", "right")[2] < w
    # In the corner: 16:9, at the bottom right.
    cx, cy, cw, ch = lf.pip_rect("medium", "bottom_right")
    assert abs(cw / ch - 16 / 9) < 0.02 and cx + cw == 1920 - 40 and cy + ch == 1080 - 40
    # The screen sits whole left of a right-side card (never under it), centered; with a corner card it fills the frame.
    sx, sy, sw, sh = lf.screen_rect("right", "large", 1920, 1080)
    assert sx >= 40 and sx + sw <= x - 16 and abs(sw / sh - 16 / 9) < 0.01
    assert lf.screen_rect("bottom_right", "large", 1920, 1080) == (0, 0, 1920, 1080)
    # A 16:10 screen is fitted, not stretched.
    _, _, w2, h2 = lf.screen_rect("bottom_right", "large", 1440, 900)
    assert abs(w2 / h2 - 1.6) < 0.01
    # The share box the editor keeps (graphics stay clear of the card).
    box = lf.pip_share_box("large", "right")
    assert abs(box[0] * 1920 - x) < 1 and abs(box[2] * 1920 - w) < 1


def test_the_card_mask_is_rounded(tmp_path):
    path = lf.card_mask(str(tmp_path / "m.png"), 300, 400)
    a = np.asarray(Image.open(path))
    assert a.shape == (400, 300) and a[0, 0] < 10 and a[200, 150] > 250 and a[0, 150] > 200


# ---------------------------------------------------------------------------
# Long-form pacing
# ---------------------------------------------------------------------------

def g(at_s, template="stat", origin="auto", **extra):
    return {"id": f"g-{int(at_s * 1000):07d}{template[:3]}", "template": template, "at_ms": int(at_s * 1000), "duration_ms": 3000,
            "placement": "top", "fields": dict(extra.pop("fields", {})), "origin": origin, **extra}


def test_the_cold_open_is_dense_and_branded_then_the_video_is_light():
    total = 26 * 60_000
    profile = lf.pacing_profile(total)
    assert profile["cold_open_ms"] == 90_000 and profile["cold_gap_ms"] == 5000 and profile["body_gap_ms"] == 12_000
    assert lf.cold_open_ms(4 * 60_000) == 60_000 and lf.cold_open_ms(60_000) == 24_000
    words = [g(t, "fx", fields={"effect": "per-word-rise"}) for t in (2, 4, 9, 15)]
    words.append(g(20, "fx", fields={"effect": "count-up"}))
    words.append(g(30, "statement", depth="behind"))
    body = [g(t, "statement") for t in (100, 140)] + [g(t, "stat") for t in (120, 125, 150, 300)] + [g(200, "fx", fields={"effect": "count-up"})]
    member = [g(126, "title", origin="member")]
    cta = [g(1500, "link_cta")]
    out = lf.pace_graphics(words + body + member + cta, total)
    at = [x["at_ms"] // 1000 for x in out]
    # Cold open: one every 5+ s (4 s after 2 s is dropped); words cards are full-screen brand cards, the number an overlay.
    assert at[:5] == [2, 9, 15, 20, 30]
    assert [x.get("size") for x in out[:3]] == ["stage"] * 3
    assert out[3]["size"] == "compact" and out[3]["placement"] == "bottom"
    assert "depth" not in out[4]
    # Body: no plain words cards, 12+ s apart; the member's own card and the call to action always stay.
    body_at = [x["at_ms"] // 1000 for x in out if 90 <= x["at_ms"] // 1000 < 1400 and x["origin"] == "auto"]
    assert body_at == [120, 150, 200, 300]
    assert any(x["origin"] == "member" for x in out) and out[-1]["template"] == "link_cta"
    # A long screen demo (no visual over it) keeps nothing automatic inside it.
    demo = lf.pace_graphics(body, total, demos=[(110_000, 160_000)])
    assert [x["at_ms"] // 1000 for x in demo] == [200, 300]
    # A story register is sparser.
    assert lf.pacing_profile(total, "story")["body_gap_ms"] > profile["body_gap_ms"]


def test_captions_show_on_key_lines_only():
    words = (say("Welcome back to the channel today.", 1) + say("I made 1,220 dollars in seven days.", 100) + say("So anyway let us go.", 110)
             + say("Here is the biggest mistake people make.", 140) + say("This is a normal line here.", 300))
    timed = timed_of(words)
    total = 320_000
    quiet = lf.caption_quiet(timed, total, "key", cold_ms=60_000)
    assert lf.caption_quiet(timed, total, "all") == []
    def shown(ms):
        return not any(a <= ms < b for a, b in quiet)
    # The cold-open line, the number line and the strong line are captioned; the others are quiet.
    assert shown(words[0].start_ms + 50) and shown(words[7].start_ms + 50) and shown(words[22].start_ms + 50)
    assert not shown(words[16].start_ms + 50) and not shown(words[-2].start_ms)
    assert all(b - a >= 100 for a, b in quiet) and all(quiet[i][1] <= quiet[i + 1][0] for i in range(len(quiet) - 1))


# ---------------------------------------------------------------------------
# Sectioned planning
# ---------------------------------------------------------------------------

def long_talk(minutes=25):
    """About 160 words a minute, in 10-word sentences."""
    words, t, n = [], 0.5, 0
    while t < minutes * 60:
        line = " ".join(f"word{n + k}" for k in range(9)) + f" end{n}."
        words += say(line, t, 0.37)
        t += 10 * 0.37 + 0.5
        n += 10
    return words


def test_a_long_transcript_is_planned_in_sections_that_end_on_lines():
    words = long_talk(25)
    sections = lf.plan_sections(words)
    assert len(sections) == pytest.approx(len(words) / lf.SECTION_WORDS, abs=1)
    assert sections[0][0] == 0 and sections[-1][1] == len(words)
    assert all(a < b and b - a <= lf.SECTION_WORDS for a, b in sections)
    assert all(sections[i][1] == sections[i + 1][0] for i in range(len(sections) - 1))
    assert all(words[b - 1].text.endswith(".") for _, b in sections[:-1])
    # Short transcripts are one call.
    assert lf.plan_sections(words[:500]) == [(0, 500)]
    # Each section's transcript keeps the global word indices.
    text = lf.section_transcript(words, [None] * len(words), [], *sections[1])
    assert f" {sections[1][0]}:" in " " + text.split("] ", 1)[1] and f"{sections[1][1]}:" not in text


def test_section_plans_merge_into_one_plan_with_hooks_from_the_first_part_and_the_cta_from_the_last():
    sections = [(0, 100), (100, 200), (200, 300)]
    raws = [{"hooks": [{"start": 3, "end": 8, "text": "x", "why": ""}, {"start": 150, "end": 160}], "cuts": [{"start": 5, "end": 6, "reason": "filler"}],
             "cta": {"present": False, "start": 0, "end": 0}, "sounds": [], "graphics": [{"word": 10}, {"word": 120}], "chapter": "Getting started"},
            None,
            {"hooks": [{"start": 210, "end": 215}], "cuts": [{"start": 250, "end": 251, "reason": "retake"}, {"start": 50, "end": 51}],
             "cta": {"present": True, "start": 290, "end": 299}, "sounds": [{"word": 260, "sound": "pop"}], "graphics": [{"word": 220}], "chapter": "The results"}]
    merged = lf.merge_section_plans(raws, sections)
    assert [h["start"] for h in merged["hooks"]] == [3]
    assert [(c["start"], c["end"]) for c in merged["cuts"]] == [(5, 6), (250, 251)]
    assert merged["cta"] == {"present": True, "start": 290, "end": 299}
    assert [x["word"] for x in merged["graphics"]] == [10, 220]
    assert merged["chapters"] == [{"word": 0, "title": "Getting started"}, {"word": 200, "title": "The results"}]


def test_planning_a_long_youtube_video_makes_one_call_per_section_and_merges_them(monkeypatch):
    from clip_engine.config import Settings
    words = long_talk(22)
    calls = []

    async def fake(client, payload):
        system, user = payload["messages"][0]["content"], payload["messages"][1]["content"]
        calls.append((system, user))
        assert "TRANSCRIPT (data)" in user and "LONG LANDSCAPE YOUTUBE VIDEO" in system
        assert "chapter" in payload["response_format"]["json_schema"]["schema"]["properties"]
        idx = [int(x.split(":")[0]) for x in user.split("TRANSCRIPT (data)\n", 1)[1].split() if ":" in x and x.split(":")[0].isdigit()]
        lo, hi = min(idx), max(idx) + 1
        part = {"hooks": [{"start": lo, "end": lo + 9, "text": f"word{lo} word{lo + 1}", "why": ""}] if lo == 0 else [], "cuts": [],
                "cta": {"present": False, "start": 0, "end": 0}, "sounds": [], "graphics": [],
                "chapter": f"{words[lo + 10].text} {words[lo + 11].text}" if lo else "not said here"}
        return {"choices": [{"message": {"content": json.dumps(part)}}]}, {"cost": 0.01}

    monkeypatch.setattr(er, "chat_completion", fake)
    monkeypatch.setattr("clip_engine.config.get_settings", lambda: Settings(_env_file=None, openrouter_api_key="test"))
    review = asyncio.run(er.plan_edit({"format": "youtube", "words": words, "names": ["talk.mp4"],
                                       "direction": {"stage": True}}, lambda *a: None))
    sections = lf.plan_sections(words)
    assert len(sections) >= 3 and len(calls) == len(sections)
    assert "PART 1 of" in calls[0][0] and "Give the hooks" in calls[0][0] and "Leave hooks empty" in calls[1][0]
    assert "THE COLD OPEN (the first" in calls[0][0] and "THE COLD OPEN (the first" not in calls[1][0]
    assert review["format"] == "youtube" and review["hooks"][0]["start"] == 0 and review["cost_usd"] == pytest.approx(0.01 * len(sections))
    # The made-up title of part 1 is dropped (not said there); the others are said there, so they stay.
    assert [c["word"] for c in review["chapters"]] == [lo for lo, _ in sections[1:]]


# ---------------------------------------------------------------------------
# Chapters
# ---------------------------------------------------------------------------

def test_chapters_start_at_zero_last_ten_seconds_and_use_words_said():
    words = []
    for m in range(12):
        words += say(f"So now chapter {m} begins with this topic.", m * 60 + 1) + say("More words here about it.", m * 60 + 20)
    timed = timed_of(words)
    total = 12 * 60_000
    chapters = lf.chapters_for(timed, total)
    assert chapters[0]["at_ms"] == 0 and 3 <= len(chapters) <= 12
    assert all(chapters[i + 1]["at_ms"] - chapters[i]["at_ms"] >= 10_000 for i in range(len(chapters) - 1))
    said = {w.text.strip(".").lower() for w in words}
    for c in chapters:
        assert all(t.strip(".,").lower() in said for t in c["title"].split()), c
        assert not c["title"].lower().startswith("so ")
    text = lf.chapters_text(chapters)
    assert text.splitlines()[0].startswith("0:00 ") and len(text.splitlines()) == len(chapters)
    # A short video gets none (YouTube needs 3 of at least 10 s).
    assert lf.chapters_for(timed_of(say("Too short to split.", 0)), 20_000) == []
    # The director's titles are kept only when said.
    assert lf.said_title("chapter 3 begins", [w.text for w in words]) == "chapter 3 begins"
    assert lf.said_title("Secret method", [w.text for w in words]) == ""
    titled = lf.chapters_for(timed, total, {next(i for i, w in enumerate(words) if w.text == "4"): "chapter 4 begins"})
    assert any(c["title"] == "chapter 4 begins" for c in titled)


# ---------------------------------------------------------------------------
# Chunked bakes
# ---------------------------------------------------------------------------

def test_chunks_cut_where_no_graphic_plays_and_cover_the_video():
    total = 20 * 60_000
    busy = [(235_000, 250_000), (480_000, 482_000)]
    chunks = lf.chunk_ranges(total, busy)
    assert chunks[0][0] == 0 and chunks[-1][1] == total
    assert all(chunks[i][1] == chunks[i + 1][0] for i in range(len(chunks) - 1))
    assert all(not (a < cut < b) for cut, _ in chunks for a, b in busy)
    assert lf.chunk_ranges(60_000) == [(0, 60_000)]


def test_chunk_commands_seek_each_part_and_join_with_the_videos_own_sound():
    from clip_engine.services.graphics_overlay import chunk_commands
    graphics = [{"path": "/x/a.mov", "start_ms": 10_000, "duration_ms": 3000}, {"path": "/x/b.mov", "start_ms": 500_000, "duration_ms": 3000}]
    parts, join, listing = chunk_commands("/x/v.mp4", graphics, "/x/out.mp4", 1920, 1080, ["-c:v", "libx264"], 20 * 60_000, 30.0)
    assert len(parts) == 5 and listing.endswith(".parts.txt")
    first, second, third = parts[0][1], parts[1][1], parts[2][1]
    assert first[first.index("-ss") + 1] == "0.000000" and "/x/a.mov" in first and "/x/b.mov" not in first
    assert "-an" in first and "0:a?" not in first and first[first.index("-frames:v") + 1] == str(240 * 30)
    assert "/x/b.mov" in third and "/x/a.mov" not in second
    # The graphic's time is on its chunk's clock.
    assert "+20.000/TB" in third[third.index("-filter_complex") + 1]
    assert join[join.index("-f") + 1] == "concat" and "1:a?" in join and join[-1] == "/x/out.mp4"


def _mov(path, seconds, size):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=0x2F5BFF@0.8:s={size}:d={seconds}:r=30,format=argb",
                    "-c:v", "qtrle", path], check=True)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")
def test_a_twenty_minute_bake_completes_in_chunks_and_ffmpeg_memory_stays_bounded(tmp_path):
    """A synthetic 20-minute 16:9 video (low resolution) with graphics across it: laid in chunks, the result is whole
    (length, sound), each chunk's graphics land, and no FFmpeg the bake ran used more than about 2 GB."""
    from clip_engine.services.graphics_overlay import overlay_graphics
    from clip_engine.services.rendering_service import RenderingService
    seconds, size = 20 * 60, "256x144"
    video = str(tmp_path / "long.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=black:s={size}:r=30:d={seconds}", "-f", "lavfi", "-i",
                    f"sine=f=220:d={seconds}", "-c:v", "libx264", "-preset", "ultrafast", "-g", "300", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    "-b:a", "48k", "-shortest", video], check=True)
    mov = str(tmp_path / "g.mov")
    _mov(mov, 3, size)
    graphics = [{"path": mov, "start_ms": 20_000 + k * 37_000, "duration_ms": 3000} for k in range(30)]
    before = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    asyncio.run(overlay_graphics(RenderingService(), video, graphics))
    peak_mb = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024
    out = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", video],
                                    capture_output=True, check=True).stdout)
    assert abs(float(out["format"]["duration"]) - seconds) < 1.0
    assert {s["codec_type"] for s in out["streams"]} == {"video", "audio"}
    # The graphics landed in later chunks too (blue where a graphic plays, black between).
    for at, blue in ((20 + 29 * 37 + 1.5, True), (20 + 29 * 37 + 10, False), (20 + 13 * 37 + 1.0, True)):
        frame = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(at), "-i", video, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo",
                                "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
        assert (frame[2] > 100) == blue, (at, list(frame))
    assert not [f for f in os.listdir(tmp_path) if ".part" in f or f.endswith(".parts.txt")]
    assert peak_mb < 2048 or before / 1024 >= 2048, f"FFmpeg peak {peak_mb:.0f} MB"


# ---------------------------------------------------------------------------
# A real picture-in-picture render made into a 16:9 editor project
# ---------------------------------------------------------------------------

@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")
def test_camera_plus_screen_renders_a_landscape_picture_in_picture_project(tmp_path):
    root = str(tmp_path / "edit-run")
    os.makedirs(root)
    camera, screen = str(tmp_path / "cam.mp4"), str(tmp_path / "screen.mp4")
    words = (say("I made 1,220 dollars in seven days.", 0.5) + say("Here is my dashboard right now.", 4.0)
             + say("The biggest mistake is waiting.", 8.0) + say("Follow for more.", 11.5))
    seconds = 13
    expr = "+".join(f"between(t,{w.start_ms / 1000:.3f},{w.end_ms / 1000:.3f})" for w in words)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=s=640x360:r=30:d={seconds}", "-f", "lavfi", "-i",
                    f"aevalsrc='0.25*sin(2*PI*300*t)*({expr})':s=48000:d={seconds}", "-c:v", "libx264", "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", camera], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=0xF4F4F4:s=960x600:r=30:d={seconds}", "-c:v", "libx264",
                    "-preset", "ultrafast", "-pix_fmt", "yuv420p", screen], check=True)
    marks = er.analyze_takes(words)
    stat = {"id": "g-stat01", "template": "stat", "word": 2, "duration_ms": 3000, "placement": "top", "fields": {"value": "$1,220", "label": "in seven days"},
            "origin": "auto"}
    look = er.Look("", None, True, "pop", None)
    config = {"output_dir": root, "sources": [camera], "words": words, "keep": [m is None for m in marks], "hook": None,
              "cta": er.Span(len(words) - 3, len(words) - 1), "popups": [], "sounds": [], "look": look, "title": "My YouTube video", "cost_usd": 0,
              "format": "youtube", "youtube": {**lf.DEFAULT_YOUTUBE, "pip_size": "large", "pip_corner": "right"}, "chapters": [],
              "screen": {"path": screen, "offset_ms": 0, "style": "screen_top", "split": 0.45, "fit": "fit", "zoom": False, "auto": False},
              "sound_design": {"on": True, "register": "teaching"},
              "editor": {"graphics": [stat], "pins": [], "motion": True, "stage": True, "brand_color": "#1FA463", "cta_keyword": ""}}
    result = asyncio.run(er.render_edit(config, lambda *_: None))
    assert result["editor"] is True and result["format"] == "youtube"
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate", "-of", "json",
                                       os.path.join(root, "editor-source.mp4")], capture_output=True, check=True).stdout)
    v = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (v["width"], v["height"], v["r_frame_rate"]) == (1920, 1080, "30/1")
    project = json.load(open(os.path.join(root, "editor-project.json")))
    assert (project["width"], project["height"], project["aspect_ratio"]) == (1920, 1080, "16:9")
    assert project["youtube"]["pip"] == lf.pip_share_box("large", "right") and project["youtube"]["captions"] == "key"
    c = project["candidates"][0]
    assert "stage_scenes" not in c and c["scenes"][0]["crops"] == [[0.0, 0.0, 1.0, 1.0]]
    # The number line opens the cold open: its stat is an overlay over the screen (lower third), not a card.
    s = next(x for x in c["graphics"] if x["template"] == "stat")
    assert s["size"] == "compact" and s["placement"] == "bottom"
    job = json.load(open(os.path.join(root, "job_output.json")))
    assert job["metrics"]["format"] == "youtube" and job["format"] == "youtube"
    # The picture: the light screen on the left, the camera's test picture in the rounded card on the right.
    frame = np.asarray(Image.open(_frame(os.path.join(root, "editor-source.mp4"), 2.0, str(tmp_path / "f.png"))).convert("RGB")).astype(float)
    x, y, w, h = lf.pip_rect("large", "right")
    sx, sy, sw, sh = lf.screen_rect("right", "large", 960, 600)
    assert frame[sy + sh // 2, sx + sw // 2].mean() > 200
    card = frame[y + h // 4:y + 3 * h // 4, x + w // 4:x + 3 * w // 4]
    assert card.std() > 30
    # The rounded corner shows the backdrop, not the camera.
    assert abs(frame[y + 2, x + 2] - frame[y + h // 2, x + w // 2]).sum() > 0


def _frame(path, t, out):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", path, "-frames:v", "1", out], check=True)
    return out
