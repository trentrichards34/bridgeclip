"""Remix "Their clip, then me" and "React, then my thoughts": the b-roll rules (with a stand-in planner), and both
templates assembled from synthetic inputs (picture, sound and timing checked frame by frame)."""

import asyncio
import json
import os
import subprocess
from types import SimpleNamespace

import numpy as np
import pytest

from clip_engine.services import pause_react as pr
from clip_engine.services import react_thoughts as rt
from clip_engine.services import remix_service as remix
from clip_engine.services import segmentation
from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.rendering_service import RenderingService
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord, TranscriptionResult

from .recompose_support import no_ai, recompose
from .test_audit_render import FFMPEG_WITH_ASS
from .test_camera_remix import FAST_VIDEO, SETTINGS, fake_write_matte
from .test_remix import FakeMedia

V1, V2, IMG = "b0000000a", "b0000000b", "b0000000c"


# ---------------------------------------------------------------------------
# B-roll placement (plain logic)
# ---------------------------------------------------------------------------

def shot(start, end, item, query="city street"):
    return {"start": start, "end": end, "item": item, "query": query}


def test_broll_shots_are_held_to_the_rules():
    # A 12 s take: b-roll only between 2 s and 10.5 s.
    placed = rt.place_broll([
        shot(0.0, 1.0, V1),            # inside the first 2 s: moved to start at 2 s, stretched to 1.5 s
        shot(3.0, 3.4, V2),            # starts too close to the first one (less than 1 s of the member between): dropped
        shot(4.6, 12.0, "stock"),      # too long and past the last 1.5 s: cut to 4 s (then to 3.6 s: at most 60% covered)
        shot(9.0, 10.0, "nope"),       # an item that isn't theirs: dropped
        shot(9.7, 11.9, "stock", ""),  # stock with no search: dropped
    ], 12.0, [V1, V2], True)
    assert [(s["start"], s["end"], s["item"]) for s in placed] == [(2.0, 3.5, V1), (4.6, 8.2, V2)]
    # (The stock shot took the member's unused clip: their own clips come first.)
    for s in placed:
        assert rt.SHOT_MIN_S <= s["end"] - s["start"] <= rt.SHOT_MAX_S
        assert s["start"] >= rt.HEAD_S and s["end"] <= 12.0 - rt.TAIL_S
    # Stock turned off: stock shots are dropped (no own clip left to take their place).
    off = rt.place_broll([shot(2.5, 4.0, V1), shot(6.0, 8.0, "stock")], 12.0, [V1], False)
    assert [s["item"] for s in off] == [V1]
    # Stock on, own clips all used: it stays stock (item None) with its search.
    on = rt.place_broll([shot(2.5, 4.0, V1), shot(6.0, 8.0, "stock", "green field")], 12.0, [V1], True)
    assert [(s["item"], s["query"]) for s in on] == [(V1, "city street"), (None, "green field")]
    # At most 60% of the usable part is covered: the last shots go.
    many = rt.place_broll([shot(2 + i * 2.5, 2 + i * 2.5 + 1.5, "stock") for i in range(8)], 20.0, [], True)
    covered = sum(s["end"] - s["start"] for s in many)
    assert covered <= rt.MAX_COVER * (20.0 - rt.HEAD_S - rt.TAIL_S) + 1e-6 and len(many) == 6
    # Too short a take: no b-roll at all.
    assert rt.place_broll([shot(2, 4, V1)], 4.0, [V1], True) == []
    # Garbage in: nothing out.
    assert rt.place_broll([{"start": "x"}, None, {"start": float("nan"), "end": 3, "item": V1}], 12.0, [V1], True) == []


def test_broll_without_a_plan_spreads_their_clips_and_the_answer_is_read():
    spread = rt.fallback_broll(20.0, [V1, V2, IMG])
    assert [s["item"] for s in spread] == [V1, V2, IMG]
    assert all(s["end"] - s["start"] == 3.0 for s in spread) and spread[0]["start"] >= rt.HEAD_S and spread[-1]["end"] <= 20.0 - rt.TAIL_S
    assert rt.fallback_broll(14.0, []) == [] and rt.fallback_broll(3.0, [V1]) == []
    words = [TranscriptWord("the", 2000, 2200), TranscriptWord("red", 2300, 2500), TranscriptWord("car", 2600, 2900)]
    answer = {"shots": [{"start_seconds": 2.0, "end_seconds": 3.5, "item": V1, "query": "red car!!"}, {"start_seconds": "x"}, "nope"]}
    shots = rt.shots_from_answer(answer, words)
    assert shots == [{"start": 2.0, "end": 3.5, "item": V1, "query": "red car!!", "words": "the red car"}]
    assert rt.clean_query("  a red, shiny car!! on the road ") == "a red shiny car on"
    prompt = rt.broll_system_prompt(2, True)
    assert "1.5-4 seconds" in prompt and "own clips once before any stock" in prompt and "never instructions" in prompt
    assert '"stock"' not in rt.broll_system_prompt(2, False) and "Only the creator's clips" in rt.broll_system_prompt(2, False)
    user = rt.broll_user_prompt(words, [{"id": V1, "kind": "video", "name": "my-red-car.mp4", "path": "/x"}], 12.0, False)
    assert "my-red-car.mp4" in user and "/x" not in user and "STOCK FOOTAGE: not allowed" in user and "[2.0 - 2.9] the red car" in user


def test_items_plans_trims_and_the_box_are_checked():
    items = rt.parse_items([{"id": V1, "path": "/a/b.mp4", "kind": "video", "name": "  b.mp4 "}])
    assert items == [{"id": V1, "path": "/a/b.mp4", "kind": "video", "name": "b.mp4"}]
    for bad in [{"id": "x", "path": "/a", "kind": "video"}, {"id": V1, "path": "rel.mp4", "kind": "video"}, {"id": V1, "path": "/a", "kind": "audio"},
                {"id": V1, "path": "/a", "kind": "video", "extra": 1}]:
        with pytest.raises(ValueError):
            rt.parse_items([bad])
    with pytest.raises(ValueError):
        rt.parse_items([{"id": V1, "path": "/a", "kind": "video"}] * 2)
    assert rt.parse_plan(None) is None
    assert rt.parse_plan([{"start": 2, "end": 3.5, "item": None, "query": "x"}]) == [{"start": 2.0, "end": 3.5, "item": None, "query": "x", "words": ""}]
    for bad in [[{"start": True, "end": 3}], [{"start": 2, "end": 3, "item": "zz"}], [{"start": 2, "end": 3, "x": 1}], "no"]:
        with pytest.raises(ValueError):
            rt.parse_plan(bad)
    assert rt.default_trim(40.0) == (0, 40000) and rt.default_trim(600.0) == (0, 60000)
    assert rt.trim_problem(0, 500, 40) and rt.trim_problem(0, 181000, 400) and rt.trim_problem(39900, 41000, 40)
    assert rt.trim_problem(1000, 9000, 40) is None
    # A tall reel: about the top two-thirds; a wide clip fits the width at its default size.
    assert rt.box_split(360, 640, 1080, 1920, 60) == rt.BOX_SPLIT_MAX
    # (No taller than the room above the captions.)
    assert rt.box_split(360, 640, 1080, 1920, 60, room=900) == round(900 / 1920, 3)
    assert rt.box_split(1920, 1080, 1080, 1920, 60) is None
    assert 0.3 <= rt.box_split(1080, 1080, 1080, 1920, 60) <= 0.62


def test_caption_lines_never_cross_the_cut():
    words = [TranscriptWord("Buy", 6000, 6300), TranscriptWord("it", 6350, 6900), TranscriptWord("Honestly", 7300, 7700), TranscriptWord("no.", 7800, 8000)]
    assert [s.text for s in remix.words_to_segments(words)] == ["Buy it Honestly no."]
    assert [s.text for s in remix.words_to_segments(words, [7.0])] == ["Buy it.", "Honestly no."]


# ---------------------------------------------------------------------------
# Planning, writing (stand-in models) and real renders
# ---------------------------------------------------------------------------

@pytest.fixture
def env(tmp_path, monkeypatch):
    if FFMPEG_WITH_ASS is None:
        pytest.skip("FFmpeg with libass required")
    ffmpeg, ffprobe = FFMPEG_WITH_ASS
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    monkeypatch.setattr(remix, "VIDEO_ARGS", FAST_VIDEO)
    monkeypatch.setattr(segmentation, "write_matte", fake_write_matte)

    async def plan_layout(self, request, width, height, start, duration):
        return ClipLayoutPlan([ShotLayout(0, duration, LayoutType.TALKING_HEAD)], width, height)
    monkeypatch.setattr(RenderingService, "_plan_layout", plan_layout)
    monkeypatch.setattr(RenderingService, "_video_codec_args", lambda *a: ["-c:v", "mpeg4", "-q:v", "3"])
    run = tmp_path / "run"
    run.mkdir()

    def make(name, args):
        path = str(tmp_path / name)
        subprocess.run([ffmpeg, "-v", "error", "-y", *args, path], check=True, timeout=120)
        return path
    enc = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
    # Their reel: a moving test pattern (tall) with a 1 kHz tone, 12 s.
    reel = make("reel.mp4", ["-f", "lavfi", "-i", "testsrc2=s=360x640:d=12:r=30", "-f", "lavfi", "-i", "sine=frequency=1000:duration=12:sample_rate=48000",
                             *enc, "-c:a", "aac"])
    # The member's take (their thoughts): a still person-ish picture with a steady 300 Hz "voice", 12 s.
    take = make("take.mp4", ["-f", "lavfi", "-i", "color=c=0x406080:s=360x640:d=12:r=30", "-f", "lavfi", "-i", "sine=frequency=300:duration=12:sample_rate=48000",
                             "-vf", "drawbox=x=120:y=180:w=120:h=200:color=0xe0b090:t=fill", *enc, "-c:a", "aac"])
    # Part 1, watching their clip: a different still with a 500 Hz sound that must never be heard (the clip's sound plays).
    watch = make("watch.mp4", ["-f", "lavfi", "-i", "color=c=0x305070:s=360x640:d=14:r=30", "-f", "lavfi", "-i", "sine=frequency=500:duration=14:sample_rate=48000",
                               "-vf", "drawbox=x=100:y=420:w=160:h=200:color=0xe0b090:t=fill", *enc, "-c:a", "aac"])
    # Their own b-roll: a short red clip (looped to length) and a yellow picture; stock footage is green.
    red = make("red-car.mp4", ["-f", "lavfi", "-i", "color=c=0xd02020:s=640x360:d=1:r=30", *enc])
    yellow = str(tmp_path / "yellow.png")
    from PIL import Image
    Image.new("RGB", (800, 600), (230, 200, 30)).save(yellow)
    green = make("stock.mp4", ["-f", "lavfi", "-i", "color=c=0x20c040:s=360x640:d=5:r=30", *enc])
    return SimpleNamespace(ffmpeg=ffmpeg, ffprobe=ffprobe, tmp=tmp_path, out=run, reel=reel, take=take, watch=watch, red=red, yellow=yellow, green=green)


def sentence(text, start, end):
    items = text.split()
    step = (end - start) / len(items)
    return [TranscriptWord(w, round((start + i * step) * 1000), round((start + (i + 1) * step - 0.04) * 1000)) for i, w in enumerate(items)]


CLIP_WORDS = sentence("This serum changed my skin in a week.", 0.5, 3.5) + sentence("Buy it now.", 6.0, 7.5)
MEMBER_WORDS = sentence("Honestly I tried it and nothing changed. Here is what actually works for my skin.", 0.4, 11.0)
BROLL_ANSWER = {"shots": [
    {"start_seconds": 0.5, "end_seconds": 2.5, "item": V1, "query": "red car"},
    {"start_seconds": 4.5, "end_seconds": 6.0, "item": IMG, "query": "skin cream"},
    {"start_seconds": 5.0, "end_seconds": 7.0, "item": V1, "query": "overlap"},
    {"start_seconds": 7.5, "end_seconds": 9.5, "item": "stock", "query": "green field"},
]}


def fake_ai(monkeypatch, broll=None):
    calls = []

    async def speech_words(self, media, start, seconds, work, label, allow_silence=False):
        calls.append(("transcribe", label, round(start, 2), round(seconds, 2)))
        self.cost_usd += 0.001
        if label == "clip":
            return [TranscriptWord(w.word, w.start_time_ms - round(start * 1000), w.end_time_ms - round(start * 1000))
                    for w in CLIP_WORDS if w.start_time_ms >= start * 1000 and w.end_time_ms <= (start + seconds) * 1000]
        return list(MEMBER_WORDS) if remix.has_audio(media) else []
    monkeypatch.setattr(remix.Remixer, "_speech_words", speech_words)

    class FakeTranscription:
        async def transcribe_audio(self, path, **kw):
            calls.append(("transcribe-render", os.path.basename(path)))
            return TranscriptionResult(segments=[TranscriptSegment(MEMBER_WORDS[0].start_time_ms, MEMBER_WORDS[-1].end_time_ms, "x", None, list(MEMBER_WORDS))],
                                       full_text="", api_costs=SimpleNamespace(estimated_cost_usd=0.001))
    import clip_engine.services.transcription_service as ts
    monkeypatch.setattr(ts, "TranscriptionService", FakeTranscription)

    async def fake_chat(client, payload):
        name = payload["response_format"]["json_schema"]["name"]
        calls.append(("chat", name, payload))
        if name == "react_broll_plan":
            return {"choices": [{"message": {"content": json.dumps(broll if broll is not None else BROLL_ANSWER)}}]}, {"cost": 0.004}
        body = {"headline": "This serum changed her skin in a week? Not mine", "post_caption": "I tried it.\n\n1. Nothing changed.\n2. Here is what works.",
                "self_check": {"invented_claims": False}}
        return {"choices": [{"message": {"content": json.dumps(body)}}]}, {"cost": 0.01}
    monkeypatch.setattr(remix, "chat_completion", fake_chat)

    async def fake_stock(self, queries, cache):
        calls.append(("stock", list(queries)))
        return [STOCK_PATH["path"] for _ in queries]
    monkeypatch.setattr(remix.Remixer, "_broll", fake_stock)
    return calls


STOCK_PATH = {"path": None}


def config(env, fmt, recordings=None, trim=None, items=None, stock=False, plan=None, camera="filmed", source=None):
    return remix.RemixConfig(output_dir=str(env.out), sources=[source or env.reel], creator="@skincoach", host="camera", format=fmt,
                             camera_layout=camera, cta_keyword="GLOW", cta_offer="my routine", recordings=recordings or {},
                             clip_trim=trim, broll_items=items or [], broll_stock=stock, broll_plan=plan)


def remixer(cfg, env, pexels=None):
    progress = []
    settings = SimpleNamespace(**{**vars(SETTINGS), "pexels_api_key": pexels})
    r = remix.Remixer(cfg, lambda detail, percent: progress.append(detail), media=FakeMedia(env.ffmpeg), settings=settings)
    return r, progress


def gray_frames(path, size=(36, 64), crop=None):
    vf = (f"crop={crop}," if crop else "") + f"scale={size[0]}:{size[1]},format=gray"
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", vf, "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=120).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, size[1], size[0]).astype(np.int16)


def rgb_at(path, t, crop):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", path, "-frames:v", "1", "-vf", f"crop={crop},scale=1:1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True, timeout=60).stdout
    return tuple(raw[:3])


def tone(path, start, seconds, freq, rate=48000):
    samples = pr.pcm(path, start, seconds, rate)
    spectrum = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
    freqs = np.fft.rfftfreq(len(samples), 1 / rate)
    return float(spectrum[(freqs > freq - 20) & (freqs < freq + 20)].max())


def samples(final, name, times):
    folder = os.environ.get("REACT_TEMPLATE_SAMPLES")
    if folder:
        os.makedirs(folder, exist_ok=True)
        for t in times:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", final, "-frames:v", "1", os.path.join(folder, f"{name}-{t}.png")], check=True)


def test_preparing_a_clip_is_free_and_a_long_video_suggests_moment_take(env, monkeypatch):
    calls = fake_ai(monkeypatch)
    result = asyncio.run(remixer(config(env, "clip_then_me"), env)[0].plan())
    [draft] = result["drafts"]
    assert (draft["format"], draft["start_ms"], draft["end_ms"], draft["creator"]) == ("clip_then_me", 0, 12000, "@skincoach")
    assert result["cost_usd"] == 0 and calls == [] and result["warnings"] == []
    long = str(env.tmp / "long.mp4")
    subprocess.run([env.ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=200:r=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", long],
                   check=True, timeout=120)
    result = asyncio.run(remixer(config(env, "react_thoughts", source=long), env)[0].plan())
    assert (result["drafts"][0]["format"], result["drafts"][0]["end_ms"]) == ("react_thoughts", 60000)
    assert result["warnings"] == ["This video is 3:20 long, so only its first minute is used for now. Trim it to the part you want (up to 3 minutes), "
                                  "or use Moment + my take to have the AI find the best moments in a long video."]
    with pytest.raises(remix.RemixError, match="needs you on camera"):
        remix.Remixer(remix.RemixConfig(output_dir=str(env.out), host="voice", format="react_thoughts"), settings=SETTINGS)
    with pytest.raises(remix.RemixError, match="As filmed"):
        remix.Remixer(config(env, "clip_then_me", camera="greenscreen"), settings=SETTINGS)


def test_their_clip_then_me_written_and_made_from_the_trimmed_clip(env, monkeypatch):
    calls = fake_ai(monkeypatch)
    asyncio.run(remixer(config(env, "clip_then_me"), env)[0].plan())
    recordings = {"0": {"reaction": {"path": env.take, "offset_s": 0}}}
    written = asyncio.run(remixer(config(env, "clip_then_me", recordings=recordings, trim=[300, 7300]), env)[0].write())
    [draft] = written["drafts"]
    assert (draft["start_ms"], draft["end_ms"], draft["headline"]) == (300, 7300, "This serum changed her skin in a week? Not mine")
    assert draft["post_caption"].endswith("Comment GLOW and I'll send you my routine.\n\nClip: @skincoach")
    # Their take (up to 3 minutes) and only the trimmed part of their clip were heard; one writing call saw both.
    assert [c for c in calls if c[0] == "transcribe"] == [("transcribe", "take", 0.0, 180.0), ("transcribe", "clip", 0.3, 7.0)]
    [write] = [c[2] for c in calls if c[0] == "chat"]
    assert "This serum changed my skin" in write["messages"][1]["content"] and "Honestly I tried it" in write["messages"][1]["content"]
    assert "someone else's short clip (the moment), then the creator gives their own take" in write["messages"][0]["content"]
    assert written["cost_usd"] == pytest.approx(0.012)

    before = len(calls)
    r, progress = remixer(config(env, "clip_then_me", recordings=recordings, trim=[300, 7300]), env)
    result = asyncio.run(r.render([{"id": 0, "headline": "This serum changed her skin in a week? Not mine"}]))
    [made] = result["remixes"]
    # Nothing heard again: their words and the clip's were kept from writing.
    assert not [c for c in calls[before:] if c[0].startswith("transcribe")]
    assert made["format"] == "clip_then_me" and made["camera"] and not made["ai_presenter"]
    panel = os.path.join(env.out, ".edit", "clip_00", "panel.mp4")
    op = 7.0
    assert abs(remix.media_seconds(made["path"]) - (op + 12.0)) < 0.2
    frames = gray_frames(panel)
    assert abs(len(frames) - round((op + 12.0) * 30)) <= 2
    diffs = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
    join = round(op * 30)
    chip = round(remix.TAKE_CHIP_S * 30)
    # Their clip moves all the way through; the take (a still picture) doesn't once the chip has gone; no black frames.
    assert min(diffs[1:join - 2]) > 0.05 and max(diffs[join + chip + 2:]) < 0.05, diffs
    assert frames.mean(axis=(1, 2)).min() > 20
    # Sound: the clip's tone, then the member's; picture and sound the same length.
    assert tone(panel, 1.0, 2.0, 300) < tone(panel, 1.0, 2.0, 1000) * 0.1
    assert tone(panel, op + 2.0, 3.0, 1000) < tone(panel, op + 2.0, 3.0, 300) * 0.1
    assert abs(remix.stream_seconds(panel, "a") - remix.stream_seconds(panel, "v")) < 0.06
    # Captions: the clip's words from its start, then the member's after the cut.
    data = json.load(open(os.path.join(env.out, ".edit", "clip_00", "edit.json")))
    assert data["words"][0][:2] == ["This", 200]
    member = [w for w in data["words"] if w[0] == "Honestly"]
    assert member and member[0][1] >= op * 1000
    assert data["tags"]["excerpt_windows"] == [[0.0, op]] and data["tags"]["credit_text"] == "Original: @skincoach" and data["tags"]["cuts"] == [op]
    manifest = json.load(open(made["manifest_path"]))
    assert manifest["format"] == "clip_then_me" and manifest["source"]["trim"] == {"start_seconds": 0.3, "end_seconds": 7.3}
    assert manifest["presenter"]["clip_then_me"] == {"clip_seconds": 7.0, "take_seconds": 12.0}
    assert {c["id"]: c["ok"] for c in made["checks"]} == {"permission": True, "credited": True, "moment": True, "cta": True, "presenter": True}
    assert made["checks"][2]["label"] == "Their clip is 7.0s, then your take (12s)"
    job = json.load(open(os.path.join(env.out, "job_output.json")))
    assert job["clips"][0]["description"] == "Original: @skincoach" and job["metrics"]["remix_kinds"] == ["camera"]
    samples(made["path"], "clip-then-me", (2.0, 7.5, 12.0))
    # Edit hook text & captions: made again from the kept parts, no AI.
    no_ai(monkeypatch)
    edited = recompose(env.out, headline="Seven days, this serum? Not for me")
    assert abs(edited["duration_seconds"] - (op + 12.0)) < 0.2


def test_react_then_my_thoughts_with_their_own_broll_and_stock(env, monkeypatch):
    STOCK_PATH["path"] = env.green
    calls = fake_ai(monkeypatch)
    items = [{"id": V1, "path": env.red, "kind": "video", "name": "red-car.mp4"}, {"id": IMG, "path": env.yellow, "kind": "image", "name": "yellow.png"}]
    asyncio.run(remixer(config(env, "react_thoughts"), env)[0].plan())
    # Part 1 recorded here: their clip started 1.0 s into the recording. Part 2: their thoughts.
    recordings = {"0": {"reaction": {"path": env.watch, "offset_s": 1.0}, "thoughts": {"path": env.take, "offset_s": 0}}}
    cfg = lambda **kw: config(env, "react_thoughts", recordings=recordings, trim=[2000, 10000], items=items, stock=True, **kw)  # noqa: E731
    r, _ = remixer(cfg(), env, pexels="pexels-key")
    written = r_written = asyncio.run(r.write())
    assert r_written["drafts"][0]["format"] == "react_thoughts"
    # One writing call and one cheap b-roll planning call; the plan is held to the rules.
    names = [c[1] for c in calls if c[0] == "chat"]
    assert names == ["moment_take_write", "react_broll_plan"]
    planner = [c[2] for c in calls if c[0] == "chat"][1]
    assert "red-car.mp4" in planner["messages"][1]["content"] and env.red not in planner["messages"][1]["content"]
    plan = written["broll_plan"]
    assert [(s["start"], s["end"], s["item"]) for s in plan] == [(2.0, 3.5, V1), (4.5, 6.0, IMG), (7.5, 9.5, None)]
    assert plan[2]["query"] == "green field" and written["take_seconds"] == pytest.approx(12.0, abs=0.1)
    assert written["cost_usd"] == pytest.approx(0.016)
    # Without a Pexels key, stock isn't planned (and the member is told why).
    r2, _ = remixer(cfg(), env, pexels=None)
    no_key = asyncio.run(r2.replan_broll())
    assert all(s["item"] for s in no_key["broll_plan"]) and any("Pexels key" in w for w in no_key["warnings"])

    # Made with the plan as the member left it (they removed nothing; the replan above didn't change what main sends).
    before = len(calls)
    r3, progress = remixer(cfg(plan=plan), env, pexels="pexels-key")
    result = asyncio.run(r3.render([{"id": 0, "headline": "This serum changed her skin in a week? Not mine"}]))
    [made] = result["remixes"]
    assert [c for c in calls[before:] if c[0] == "stock"] == [("stock", ["green field"])]
    assert not [c for c in calls[before:] if c[0] in ("chat", "transcribe", "transcribe-render")]
    assert any("Video 1 of 1: adding your b-roll" in p for p in progress)
    panel = os.path.join(env.out, ".edit", "clip_00", "panel.mp4")
    op = 8.0
    total = op + 12.0
    assert abs(remix.media_seconds(made["path"]) - total) < 0.2
    frames = gray_frames(panel)
    assert abs(len(frames) - round(total * 30)) <= 2 and frames.mean(axis=(1, 2)).min() > 20
    assert abs(remix.stream_seconds(panel, "a") - remix.stream_seconds(panel, "v")) < 0.06

    # Part 1: their clip (moving) in a big box at the top with its own sound; the member (still) visible under it; never the
    # member's part-1 microphone.
    data = json.load(open(os.path.join(env.out, ".edit", "clip_00", "edit.json")))
    panel_h = data["compose"]["panel_h"]
    box = gray_frames(panel, crop="300:400:390:200")[: round(op * 30) - 2]
    below = gray_frames(panel, crop=f"1080:{panel_h - 1450}:0:1450")[: round(op * 30) - 2]
    assert np.median(np.abs(np.diff(box, axis=0)).mean(axis=(1, 2))) > 0.5
    assert np.abs(np.diff(below, axis=0)).mean(axis=(1, 2)).max() < 0.5
    assert tone(panel, 1.0, 3.0, 500) < tone(panel, 1.0, 3.0, 1000) * 0.1
    # Part 2: the member's voice all the way through, under the b-roll too; the clip's tone is gone.
    for a in (op + 0.5, op + 2.5, op + 5.0, op + 8.2, op + 10.8):
        assert tone(panel, a, 0.8, 1000) < tone(panel, a, 0.8, 300) * 0.1, a
    # The b-roll at its times (red clip, yellow picture, green stock), the member before, between and after.
    center = "200:200:440:900"
    red, yellow, green = rgb_at(panel, op + 2.7, center), rgb_at(panel, op + 5.2, center), rgb_at(panel, op + 8.5, center)
    assert red[0] > 150 and red[1] < 80, red
    assert yellow[0] > 180 and yellow[1] > 150 and yellow[2] < 90, yellow
    assert green[1] > 150 and green[0] < 80, green
    for t in (op + 1.5, op + 4.0, op + 7.0, op + 10.8):
        member = rgb_at(panel, t, "40:40:20:1000")
        assert abs(member[0] - 0x40) < 30 and abs(member[2] - 0x80) < 30, (t, member)

    manifest = json.load(open(made["manifest_path"]))
    assert manifest["format"] == "react_thoughts"
    assert [(b["source"], b["name"], b["seconds"]) for b in manifest["presenter"]["react_thoughts"]["broll"]] == [
        ("yours", "red-car.mp4", 1.5), ("yours", "yellow.png", 1.5), ("stock", "green field", 2.0)]
    assert {c["id"] for c in made["checks"]} == {"permission", "credited", "parts", "broll", "cta", "presenter"}
    assert "3 b-roll shots over your words (2 yours, 1 stock)" in [c["label"] for c in made["checks"]]
    samples(made["path"], "react-thoughts", (3.0, 8.6, 10.7, 13.2, 16.5))
    no_ai(monkeypatch)
    edited = recompose(env.out, headline="I tried the one week serum so you don't have to")
    assert abs(edited["duration_seconds"] - total) < 0.2


def test_react_then_my_thoughts_unplanned_or_changed(env, monkeypatch):
    """Never written (the member typed the hook text): the b-roll is planned when it's made; a planner that answers
    nothing usable spreads their clips; the member's own edit to the plan (a shot removed) is what's made."""
    calls = fake_ai(monkeypatch, broll={"shots": []})
    items = [{"id": V1, "path": env.red, "kind": "video", "name": "red-car.mp4"}]
    asyncio.run(remixer(config(env, "react_thoughts"), env)[0].plan())
    recordings = {"0": {"reaction": {"path": env.watch, "offset_s": None}, "thoughts": {"path": env.take}}}
    r, _ = remixer(config(env, "react_thoughts", recordings=recordings, trim=[2000, 6000], items=items), env)
    result = asyncio.run(r.render([{"id": 0, "headline": "My honest take on this serum"}]))
    [made] = result["remixes"]
    # Their words transcribed for captions, a planning call (twice: nothing usable), then their clip spread evenly.
    assert [c[1] for c in calls if c[0] == "chat"] == ["react_broll_plan", "react_broll_plan"]
    manifest = json.load(open(made["manifest_path"]))
    assert [b["source"] for b in manifest["presenter"]["react_thoughts"]["broll"]] == ["yours"]
    assert any("spread evenly" in w for w in result["warnings"])
    # The phone video of them watching was lined up by sound (none here: it says so and starts with the clip).
    assert manifest["presenter"]["react_thoughts"]["clip_seconds"] == pytest.approx(4.0, abs=0.05)
    # An empty plan from the member (every shot removed): nothing is laid over their thoughts.
    asyncio.run(remixer(config(env, "react_thoughts"), env)[0].plan())
    r2, _ = remixer(config(env, "react_thoughts", recordings=recordings, trim=[2000, 6000], items=items, plan=[]), env)
    again = asyncio.run(r2.render([{"id": 0, "headline": "My honest take on this serum"}]))["remixes"][0]
    assert json.load(open(again["manifest_path"]))["presenter"]["react_thoughts"]["broll"] == []
    assert remix.camera_recording({"reaction": {"path": env.watch}}, "react_thoughts") is None


# ---------------------------------------------------------------------------
# Part 1 around the member's face
# ---------------------------------------------------------------------------

def overlaps(a, b):
    """Two (x, y, w, h) boxes share any pixel."""
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def test_part1_box_never_covers_the_face():
    out_h, top_from, caption_line = 1920, 300, 1500
    for natural in (552, 1100, 1700):
        for fy in range(260, 1700, 40):
            for fh in (180, 320, 480):
                if fy + fh > out_h - 20:
                    continue
                face = (300, fy, 400, fh)
                place = rt.part1_layout(face, natural, top_from, out_h, caption_line)
                if place["at"] == "fallback":
                    continue
                grown = (300, fy - round(fh * rt.FACE_GROW_TOP), 400, fh + round(fh * (rt.FACE_GROW_TOP + rt.FACE_GROW_BOTTOM)))
                box = (60, place["box_y"], 960, place["box_h"])
                credit = (40, place["credit_y"], 1000, 54)
                assert place["box_h"] <= rt.BOX_SPLIT_MAX * out_h
                assert place["box_y"] >= top_from and place["box_y"] + place["box_h"] <= out_h - rt.BOTTOM_SAFE
                # The face (with hair, chin and a margin) is never under the box or the credit.
                assert not overlaps(box, (grown[0], grown[1] - rt.FACE_MARGIN + 1, grown[2], grown[3] + 2 * rt.FACE_MARGIN - 2)), (face, place)
                assert not overlaps(credit, grown) and not overlaps(credit, box), (face, place)
                # A face low in the frame puts the box at the top; high, at the bottom (when there's room there).
                if fy + fh / 2 > out_h / 2 and place["at"] == "bottom":
                    assert fy - round(fh * rt.FACE_GROW_TOP) - rt.FACE_MARGIN - rt.CREDIT_ROOM - top_from < min(rt.BOX_MIN_PX, natural)
                # Captions don't sit on the face or the box when there's room for them.
                cap = (40, place["caption_y"] - rt.CAPTION_HALF, 1000, 2 * rt.CAPTION_HALF)
                assert not overlaps(cap, box), (face, place)
                if place["caption_clear"]:
                    assert not overlaps(cap, box) and not overlaps(cap, grown), (face, place)
    # No face, or no room either side: the box at the top with the member framed lower, as before.
    assert rt.part1_layout(None, 552, top_from, out_h, caption_line) == {"at": "fallback"}
    assert rt.part1_layout((300, 500, 400, 900), 552, top_from, out_h, caption_line) == {"at": "fallback"}
    assert rt.part1_layout((300, 1100, 400, 300), 552, top_from, out_h, caption_line)["at"] == "top"
    assert rt.part1_layout((300, 360, 400, 300), 552, top_from, out_h, caption_line)["at"] == "bottom"


def test_face_in_frame_follows_the_cover_crop():
    # A 9:16 recording into a 1080 x 1700 panel under a 220 px hook bar: scaled to 1080 x 1920, 30% of the extra cut at the top.
    assert rt.face_in_frame((0.25, 0.5, 0.5, 0.25), (360, 640), 1080, 1700, 220) == (270, 960 - 66 + 220, 540, 480)
    assert rt.face_in_frame(None, (360, 640), 1080, 1700, 220) is None


@pytest.mark.parametrize("face_top, expect", [(420, "top"), (60, "bottom")])
def test_react_then_my_thoughts_part1_keeps_the_face_in_view(env, monkeypatch, face_top, expect):
    """A stand-in face detector reports the skin-colored box drawn into the member's part-1 recording: their clip's box
    goes where it doesn't cover it, the credit goes under the box, and the face shows in the finished video."""
    fake_ai(monkeypatch)
    watch = str(env.tmp / f"watch-{face_top}.mp4")
    subprocess.run([env.ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x305070:s=360x640:d=14:r=30", "-f", "lavfi", "-i",
                    "sine=frequency=500:duration=14:sample_rate=48000", "-vf", f"drawbox=x=100:y={face_top}:w=160:h=160:color=0xe0b090:t=fill",
                    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", watch], check=True, timeout=120)
    found = []

    def fake_find_face(path, samples=remix.FACE_SAMPLES):
        found.append(os.path.basename(path))
        return (100 / 360, face_top / 640, 160 / 360, 160 / 640) if os.path.basename(path) == "presenter.mp4" else None
    monkeypatch.setattr(remix, "find_face", fake_find_face)
    asyncio.run(remixer(config(env, "react_thoughts"), env)[0].plan())
    recordings = {"0": {"reaction": {"path": watch, "offset_s": 1.0}, "thoughts": {"path": env.take, "offset_s": 0}}}
    r, _ = remixer(config(env, "react_thoughts", recordings=recordings, trim=[2000, 8000], plan=[]), env)
    [made] = asyncio.run(r.render([{"id": 0, "headline": "This serum changed her skin in a week? Not mine"}]))["remixes"]
    assert "presenter.mp4" in found
    data = json.load(open(os.path.join(env.out, ".edit", "clip_00", "edit.json")))
    part1 = data["tags"]["part1"]
    box, face = part1["box"], part1["face"]
    assert part1["at"] == expect and box and face
    assert not overlaps(box, (face[0], face[1] - rt.FACE_MARGIN, face[2], face[3] + 2 * rt.FACE_MARGIN)), part1
    assert box[3] <= rt.BOX_SPLIT_MAX * remix.OUT_H + 1
    credit_y = data["tags"]["credit_y"]
    assert credit_y >= box[1] + box[3] and not overlaps((40, credit_y, 1000, 54), face)
    # In the finished video (part 1), the face's middle is the skin color and the box's middle shows their moving clip.
    final = made["path"]
    cx, cy = face[0] + face[2] // 2, face[1] + face[3] // 2
    skin = rgb_at(final, 2.0, f"20:20:{cx - 10}:{cy - 10}")
    assert abs(skin[0] - 0xe0) < 40 and abs(skin[1] - 0xb0) < 40 and abs(skin[2] - 0x90) < 40, skin
    box_mid = gray_frames(final, crop=f"200:200:{box[0] + box[2] // 2 - 100}:{box[1] + box[3] // 2 - 100}")[:150]
    assert np.median(np.abs(np.diff(box_mid, axis=0)).mean(axis=(1, 2))) > 0.5
    samples(final, f"react-thoughts-face-{expect}", (2.0,))
