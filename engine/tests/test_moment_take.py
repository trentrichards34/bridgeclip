"""Remix "Moment + my take": the strongest moment inside each of the member's time ranges (only those stretches are
transcribed), cuts on whole sentences, one range or take failing without losing the others, and real FFmpeg renders
(the moment as the opener, then the member's take, optionally with the moment small in a box)."""

import asyncio
import json
import os
import subprocess
from types import SimpleNamespace

import numpy as np
import pytest

from clip_engine.services import moment_take as mt
from clip_engine.services import pause_react as pr
from clip_engine.services import remix_service as remix
from clip_engine.services import segmentation
from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.rendering_service import RenderingService
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord, TranscriptionResult

from .recompose_support import no_ai, recompose
from .test_audit_render import FFMPEG_WITH_ASS
from .test_camera_remix import FAST_VIDEO, SETTINGS, fake_write_matte
from .test_remix import FakeMedia


def sentence(text, start, end):
    """Words spread over [start, end] seconds, with small gaps."""
    items = text.split()
    step = (end - start) / len(items)
    return [TranscriptWord(w, round((start + i * step) * 1000), round((start + (i + 1) * step - 0.04) * 1000)) for i, w in enumerate(items)]


# What is said in the long video (its own clock).
SOURCE_WORDS = (sentence("This is the setup.", 5.5, 7.0) + sentence("Then he says fifteen billion scam ads run every day.", 7.4, 11.0)
                + sentence("That is wild.", 11.4, 12.4) + sentence("Anyway let us move on to the next topic now.", 14.0, 18.0)
                + sentence("The second big idea is that attention is the new oil.", 21.0, 25.0) + sentence("Nobody tells you this part.", 25.5, 27.0))
MEMBER_WORDS = sentence("Honestly that number scared me. Here is what I do about it.", 0.3, 4.5)


# ---------------------------------------------------------------------------
# Plain logic
# ---------------------------------------------------------------------------

def test_cuts_move_onto_whole_sentences_within_the_limits():
    # Asked for 8.0-11.2 s (mid-sentence): starts where the sentence starts, ends at its end, then on to the next
    # sentence's end to reach five seconds; never reaching into the neighboring words.
    assert mt.snap_moment(SOURCE_WORDS, 8000, 11200, 5000, 35000) == (7250, 12610)
    # Whole words only (a nudge): an edge inside a word moves to that word's edge.
    assert mt.snap_moment(SOURCE_WORDS, 7600, 10500, 5000, 35000, min_ms=1000, max_ms=40000, sentences=False) == (7250, 10620)
    # Too long for the moment: cut at the last whole word that fits.
    a, b = mt.snap_moment(SOURCE_WORDS, 5500, 27000, 5000, 35000, max_ms=8000)
    assert b - a <= 8000 + mt.LEAD_MS + mt.TAIL_MS and a == 5350
    # Held to the range, and nothing when no one speaks there.
    a, b = mt.snap_moment(SOURCE_WORDS, 20000, 27000, 21000, 26000)
    assert a >= 21000 and b <= 26000
    assert mt.snap_moment(SOURCE_WORDS, 30000, 34000, 28000, 35000) is None


def test_the_models_pick_is_checked():
    words, rng = mt.words_in(SOURCE_WORDS, 5000, 35000), (5000, 35000)
    pick = mt.parse_pick({"start_seconds": 8.0, "end_seconds": 11.2, "quote": "made up", "why": "  A huge   number. "}, words, rng, [])
    assert (pick["start_ms"], pick["end_ms"]) == (7250, 12610)
    # The quote is the transcript's own words, not the model's.
    assert pick["quote"] == "Then he says fifteen billion scam ads run every day. That is wild." and pick["why"] == "A huge number."
    # Outside the range: held to it. One already shown: refused. Nonsense: refused.
    inside = mt.parse_pick({"start_seconds": 1.0, "end_seconds": 9.0, "quote": "", "why": ""}, words, rng, [])
    assert inside and inside["start_ms"] >= 5000
    assert mt.parse_pick({"start_seconds": 8.0, "end_seconds": 11.2, "quote": "", "why": ""}, words, rng, [(7250, 12610)]) is None
    for bad in [None, [], {"start_seconds": "x"}, {"start_seconds": 9, "end_seconds": 8}, {"start_seconds": float("nan"), "end_seconds": 2},
                {"start_seconds": 40, "end_seconds": 50}]:
        assert mt.parse_pick(bad, words, rng, []) is None


def test_ranges_are_checked_and_fitted_to_the_video():
    assert mt.parse_ranges([[2220, 2520], [60, 70.123]]) == [(2220.0, 2520.0), (60.0, 70.12)]
    for bad in [[], [[1, 2]] * 4, [[10, 5]], [[0, 5]], [[0, 1300]], [[-1, 20]], [["0", 20]], [[True, 20]], [[0, float("inf")]], "x", [[0, 20, 30]]]:
        with pytest.raises(ValueError):
            mt.parse_ranges(bad)
    assert mt.fit_range(5, 35, 40, 1) == ((5, 35), None)
    shortened, note = mt.fit_range(20, 60, 40, 2)
    assert shortened == (20, 40) and note == "Range 2 (0:20–1:00) ran past the end of the video, so it stops at 0:40."
    with pytest.raises(mt.MomentTakeError, match=r"^Range 3 \(0:45–1:00\) starts after the video ends \(0:40\)"):
        mt.fit_range(45, 60, 40, 3)
    with pytest.raises(mt.MomentTakeError, match="past the end of the video"):
        mt.fit_range(35, 60, 40, 1)
    assert mt.clock(3723.4) == "1:02:03" and mt.clock(65) == "1:05"


# ---------------------------------------------------------------------------
# Planning, another moment, writing (mocked models), and real renders
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
    # The long video: a moving test pattern with a 1 kHz tone, 40 s.
    source = tmp_path / "podcast.mp4"
    subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=40:r=30", "-f", "lavfi", "-i",
                    "sine=frequency=1000:duration=40:sample_rate=48000", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source)],
                   check=True, timeout=120)
    # The member's take: a still person-ish picture with a steady 300 Hz "voice" (5 s), and one with no sound at all.
    take = tmp_path / "take.mp4"
    subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x406080:s=360x640:d=5:r=30", "-f", "lavfi", "-i",
                    "sine=frequency=300:duration=5:sample_rate=48000", "-vf", "drawbox=x=120:y=180:w=120:h=200:color=0xe0b090:t=fill",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(take)], check=True, timeout=120)
    mute = tmp_path / "mute.mp4"
    subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x305070:s=360x640:d=4:r=30", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", str(mute)], check=True, timeout=120)
    return SimpleNamespace(ffmpeg=ffmpeg, ffprobe=ffprobe, tmp=tmp_path, out=run, source=str(source), take=str(take), mute=str(mute))


def fake_ai(monkeypatch, picks=None):
    """Stand-ins for the paid steps: transcription of a stretch, the moment pick and the writing call."""
    calls = []
    picks = picks if picks is not None else {}

    async def speech_words(self, media, start, seconds, work, label, allow_silence=False):
        calls.append(("transcribe", label, round(start, 2), round(seconds, 2)))
        self.cost_usd += 0.001
        if label.startswith("range"):
            return [TranscriptWord(w.word, w.start_time_ms - round(start * 1000), w.end_time_ms - round(start * 1000))
                    for w in SOURCE_WORDS if w.start_time_ms >= start * 1000 and w.end_time_ms <= (start + seconds) * 1000]
        return list(MEMBER_WORDS) if remix.has_audio(media) else []
    monkeypatch.setattr(remix.Remixer, "_speech_words", speech_words)

    class FakeTranscription:
        async def transcribe_audio(self, path, **kw):
            calls.append(("transcribe-take", os.path.basename(path)))
            return TranscriptionResult(segments=[TranscriptSegment(MEMBER_WORDS[0].start_time_ms, MEMBER_WORDS[-1].end_time_ms, "x", None, list(MEMBER_WORDS))],
                                       full_text="", api_costs=SimpleNamespace(estimated_cost_usd=0.001))
    import clip_engine.services.transcription_service as ts
    monkeypatch.setattr(ts, "TranscriptionService", FakeTranscription)

    async def fake_chat(client, payload):
        name = payload["response_format"]["json_schema"]["name"]
        calls.append(("chat", name, payload))
        if name == "moment_pick":
            user = payload["messages"][1]["content"]
            key = next(k for k in picks if f"THE STRETCH: {k:.1f}s" in user)
            answer = picks[key].pop(0) if isinstance(picks[key], list) else picks[key]
            return {"choices": [{"message": {"content": json.dumps(answer)}}]}, {"cost": 0.02}
        body = {"headline": "He says 15 billion scam ads run every day. Here is my take",
                "post_caption": "That number scared me.\n\n1. Check the advertiser.\n2. Never pay from an ad.", "self_check": {"invented_claims": False}}
        return {"choices": [{"message": {"content": json.dumps(body)}}]}, {"cost": 0.01}
    monkeypatch.setattr(remix, "chat_completion", fake_chat)
    return calls


FIRST = {"start_seconds": 8.0, "end_seconds": 11.2, "quote": "fifteen billion scam ads", "why": "A shocking number."}
SECOND = {"start_seconds": 21.2, "end_seconds": 27.0, "quote": "attention is the new oil", "why": "A bold claim."}


def config(env, ranges, pip=False, recordings=None, write_ids=None, camera="filmed"):
    return remix.RemixConfig(output_dir=str(env.out), sources=[env.source], creator="@podcaster", host="camera", format="moment_take",
                             camera_layout=camera, cta_keyword="SCAM", cta_offer="my checklist", moment_ranges=ranges, moment_pip=pip,
                             recordings=recordings or {}, write_ids=write_ids or [])


def remixer(cfg, env):
    progress = []
    r = remix.Remixer(cfg, lambda detail, percent: progress.append(detail), media=FakeMedia(env.ffmpeg), settings=SETTINGS)
    return r, progress


def test_each_range_is_planned_on_its_own_and_a_failing_range_keeps_the_others(env, monkeypatch):
    calls = fake_ai(monkeypatch, {5.0: FIRST})
    r, progress = remixer(config(env, [[5, 35], [28, 38], [45, 60]]), env)
    result = asyncio.run(r.plan())
    [draft] = result["drafts"]
    assert draft["format"] == "moment_take" and (draft["start_ms"], draft["end_ms"]) == (7250, 12610)
    assert draft["moment"] == {"range_start_ms": 5000, "range_end_ms": 35000, "said": "", "picks": 1}
    assert draft["quote"].startswith("Then he says fifteen billion") and draft["headline"] == ""
    # Only the ranges inside the video were transcribed, each only as long as the range.
    assert [c for c in calls if c[0] == "transcribe"] == [("transcribe", "range-1", 5.0, 30.0), ("transcribe", "range-2", 28.0, 10.0)]
    # One planning call for the range with speech; it saw only that range's words.
    picks = [c[2] for c in calls if c[0] == "chat"]
    assert len(picks) == 1 and "THE STRETCH: 5.0s to 35.0s" in picks[0]["messages"][1]["content"]
    assert "fifteen billion" in picks[0]["messages"][1]["content"]
    assert result["warnings"] == [
        "Range 2 (0:28–0:38): no speech was found in it, so there is no moment to pick. Choose another part of the video.",
        "Range 3 (0:45–1:00) starts after the video ends (0:40). Choose a time inside the video.",
    ]
    assert any(p.startswith("Range 1 of 3: listening to 0:05–0:35") for p in progress) and any("Range 2 of 3: listening" in p for p in progress)
    assert result["cost_usd"] == pytest.approx(0.022) and abs(result["source_seconds"] - 40) < 0.1
    saved = json.load(open(os.path.join(env.out, ".work", remix.PLAN_FILE)))
    assert saved["scripts"][0]["range"] == [5000, 35000] and saved["scripts"][0]["tried"] == [[7250, 12610]]


def test_no_usable_range_says_why(env, monkeypatch):
    fake_ai(monkeypatch, {})
    with pytest.raises(remix.RemixError, match=r"^Range 1 \(0:45–1:00\) starts after the video ends"):
        asyncio.run(remixer(config(env, [[45, 60]]), env)[0].plan())
    with pytest.raises(remix.RemixError, match="no speech was found"):
        asyncio.run(remixer(config(env, [[29, 39]]), env)[0].plan())
    with pytest.raises(remix.RemixError, match="Add up to 3 time ranges"):
        asyncio.run(remixer(config(env, [[0, 5]]), env)[0].plan())


def test_another_moment_avoids_the_ones_already_shown(env, monkeypatch):
    calls = fake_ai(monkeypatch, {5.0: [FIRST, FIRST, {"start_seconds": 14.2, "end_seconds": 18.0, "quote": "", "why": "Next."}, FIRST, FIRST]})
    asyncio.run(remixer(config(env, [[5, 35]]), env)[0].plan())
    again = asyncio.run(remixer(config(env, []), env)[0].pick_another(0))
    draft = again["draft"]
    # The first answer repeated the moment already shown, so it asked again.
    assert draft["start_ms"] == 13850 and 5000 <= draft["end_ms"] - draft["start_ms"] <= 25000 and draft["moment"]["picks"] == 2
    assert again["cost_usd"] == pytest.approx(0.04)
    assert "ALREADY SHOWN TO THE CREATOR" in [c for c in calls if c[0] == "chat"][-1][2]["messages"][1]["content"]
    # Nothing else stands out: it says so and keeps the current one.
    with pytest.raises(remix.RemixError, match="no other moment stood out"):
        asyncio.run(remixer(config(env, []), env)[0].pick_another(0))
    saved = json.load(open(os.path.join(env.out, ".work", remix.PLAN_FILE)))
    assert saved["scripts"][0]["start_ms"] == 13850 and len(saved["scripts"][0]["tried"]) == 2


def plan_two(env, monkeypatch, pip=False, camera="filmed"):
    calls = fake_ai(monkeypatch, {5.0: FIRST, 20.0: SECOND})
    asyncio.run(remixer(config(env, [[5, 35], [20, 30]], pip=pip, camera=camera), env)[0].plan())
    recordings = {"0": {"reaction": {"path": env.take, "offset_s": 0}}, "1": {"reaction": {"path": env.mute, "offset_s": 0}}}
    return calls, recordings


def test_writing_each_take_and_one_without_sound(env, monkeypatch):
    calls, recordings = plan_two(env, monkeypatch)
    written = asyncio.run(remixer(config(env, [], recordings=recordings, write_ids=[0, 1]), env)[0].write())
    [draft] = written["drafts"]
    assert draft["id"] == 0 and draft["headline"].startswith("He says 15 billion")
    assert draft["post_caption"].endswith("Comment SCAM and I'll send you my checklist.\n\nClip: @podcaster")
    assert draft["moment"]["said"].startswith("Honestly that number scared me")
    assert written["warnings"] == ["Video 2: We couldn’t hear you in that recording. Record it again with your microphone on."]
    # One writing call per take, with the moment's words and what the member said.
    writes = [c[2] for c in calls if c[0] == "chat" and c[1] == "moment_take_write"]
    assert len(writes) == 1 and "fifteen billion" in writes[0]["messages"][1]["content"] and "scared me" in writes[0]["messages"][1]["content"]
    assert "Comment SCAM and I'll send you my checklist." in writes[0]["messages"][0]["content"]
    saved = json.load(open(os.path.join(env.out, ".work", remix.PLAN_FILE)))
    assert saved["scripts"][0]["member"]["words"][0][0] == "Honestly" and "member" not in saved["scripts"][1]


def gray_frames(path, size=(36, 64), crop=None):
    vf = (f"crop={crop}," if crop else "") + f"scale={size[0]}:{size[1]},format=gray"
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", vf, "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=120).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, size[1], size[0]).astype(np.int16)


def tone_levels(path, start, seconds, rate=48000):
    samples = pr.pcm(path, start, seconds, rate)
    spectrum = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
    freqs = np.fft.rfftfreq(len(samples), 1 / rate)
    level = lambda f: float(spectrum[(freqs > f - 20) & (freqs < f + 20)].max())  # noqa: E731
    return level(1000), level(300)


def samples(final, name, times):
    folder = os.environ.get("MOMENT_TAKE_SAMPLES")
    if folder:
        os.makedirs(folder, exist_ok=True)
        for t in times:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", final, "-frames:v", "1", os.path.join(folder, f"{name}-{t}.png")], check=True)


def test_render_the_moment_then_the_take_and_edit_the_hook_text(env, monkeypatch):
    calls, recordings = plan_two(env, monkeypatch)
    asyncio.run(remixer(config(env, [], recordings=recordings, write_ids=[0]), env)[0].write())
    before = len([c for c in calls if c[0].startswith("transcribe")])
    # The second moment nudged by the member (its end inside a word moves to that word's end).
    r, progress = remixer(config(env, [], recordings=recordings), env)
    result = asyncio.run(r.render([{"id": 0, "headline": "He says 15 billion scam ads run every day"},
                                   {"id": 1, "headline": "Attention is the new oil, he says", "start_ms": 21000, "end_ms": 26600}]))
    first, second = result["remixes"]
    assert first["format"] == "moment_take" and first["camera"] and not first["ai_presenter"]
    # Its take was transcribed when it was written; the second (never written) is transcribed now for its captions.
    assert len([c for c in calls if c[0].startswith("transcribe")]) == before + 1
    assert any("Video 1 of 2: cutting the moment" in p for p in progress) and any("Video 2 of 2: putting it together" in p for p in progress)

    # The moment (5.36 s on whole sentences), then the 5 s take.
    panel = os.path.join(env.out, ".edit", "clip_00", "panel.mp4")
    op = 5.36
    assert abs(remix.media_seconds(first["path"]) - (op + 5.0)) < 0.15
    frames = gray_frames(panel)
    assert abs(len(frames) - round((op + 5.0) * 30)) <= 2
    diffs = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
    join = round(op * 30)
    # The moment moves (no frozen frames past the first); the take (a still picture) doesn't; no black frames anywhere.
    assert np.median(diffs[1:join - 2]) > 1.0 and min(diffs[1:join - 2]) > 0.05 and max(diffs[join + 1:]) < 0.05, diffs
    assert frames.mean(axis=(1, 2)).min() > 20
    # Sound: the moment's tone, then the member's voice; quiet right at the join (the fades), picture and sound the same length.
    m1k, m300 = tone_levels(panel, 1.0, 2.0)
    t1k, t300 = tone_levels(panel, op + 1.0, 2.0)
    assert m300 < m1k * 0.1 and t1k < t300 * 0.1
    pcm = pr.pcm(panel, 0, op + 5.0, 48000)
    rms = lambda a, b: float(np.sqrt((pcm[int(a * 48000):int(b * 48000)] ** 2).mean()))  # noqa: E731
    assert rms(op - 0.02, op + 0.01) < rms(op - 1.0, op - 0.5) * 0.5
    assert abs(remix.stream_seconds(panel, "a") - remix.stream_seconds(panel, "v")) < 0.06

    manifest = json.load(open(first["manifest_path"]))
    assert manifest["source"]["excerpt"]["start_seconds"] == 7.25 and manifest["source"]["range"] == {"start_seconds": 5.0, "end_seconds": 35.0}
    assert manifest["presenter"]["moment_take"]["moment_in_box"] is False and manifest["rights_lane"] == "permission"
    assert {c["id"]: c["ok"] for c in first["checks"]} == {"permission": True, "credited": True, "moment": True, "cta": True, "presenter": True}
    # The nudged second moment, on whole words.
    second_manifest = json.load(open(second["manifest_path"]))
    assert second_manifest["source"]["excerpt"]["start_seconds"] == 20.85 and second_manifest["source"]["excerpt"]["end_seconds"] == 26.68
    job = json.load(open(os.path.join(env.out, "job_output.json")))
    assert [c["headline"] for c in job["clips"]] == ["He says 15 billion scam ads run every day", "Attention is the new oil, he says"]
    assert all(c["editable"] and c["description"] == "Original: @podcaster" and c["ai_generated"] is False for c in job["clips"])
    assert job["metrics"]["remix_kinds"] == ["camera"]
    samples(first["path"], "moment-take", (1.0, 7.5))

    # Edit hook text & captions: made again from the kept parts, no AI.
    no_ai(monkeypatch)
    edited = recompose(env.out, headline="Fifteen billion scam ads a day, really?")
    assert abs(edited["duration_seconds"] - (op + 5.0)) < 0.15 and edited["settings"]["headline"] == "Fifteen billion scam ads a day, really?"


def test_the_moment_can_stay_small_on_screen_while_you_talk(env, monkeypatch):
    calls, recordings = plan_two(env, monkeypatch, pip=True, camera="cutout")
    r, _ = remixer(config(env, [], recordings=recordings, pip=True, camera="cutout"), env)
    result = asyncio.run(r.render([{"id": 0, "headline": "He says 15 billion scam ads run every day"}]))
    [made] = result["remixes"]
    panel = os.path.join(env.out, ".edit", "clip_00", "panel.mp4")
    op = 5.36
    # During the take: the box (top right) moves, the member (cut out, below it) stays still.
    w, h = 1080, remix.OUT_H - 0
    box = gray_frames(panel, crop=f"300:150:{1080 - 40 - 432 + 20}:{mt.PIP_TOP + 40}")
    me = gray_frames(panel, crop="300:300:390:1200")
    join = round(op * 30)
    box_diffs = np.abs(np.diff(box, axis=0)).mean(axis=(1, 2))[join + 2:]
    me_diffs = np.abs(np.diff(me, axis=0)).mean(axis=(1, 2))[join + 2:]
    assert np.median(box_diffs) > 0.5 and max(me_diffs) < 0.5, (box_diffs, me_diffs)
    assert w and h
    manifest = json.load(open(made["manifest_path"]))
    assert manifest["presenter"]["moment_take"]["moment_in_box"] is True and manifest["presenter"]["layout"] == "cutout"
    # The credit stays on while their moment is on screen; the call to action sits under the box.
    data = json.load(open(os.path.join(env.out, ".edit", "clip_00", "edit.json")))
    assert data["tags"]["excerpt_windows"] == [[0.0, round(made["duration_seconds"], 3)]] or data["tags"]["excerpt_windows"][0][1] > op + 4
    assert data["tags"]["cta_y"] > mt.PIP_TOP
    samples(made["path"], "moment-take-box", (8.0,))


def test_bad_requests_are_refused(env, monkeypatch):
    fake_ai(monkeypatch, {})
    with pytest.raises(remix.RemixError, match="needs you on camera"):
        remix.Remixer(remix.RemixConfig(output_dir=str(env.out), host="voice", format="moment_take"), settings=SETTINGS)
    with pytest.raises(remix.RemixError, match="As filmed"):
        remix.Remixer(config(env, [[5, 35]], camera="greenscreen"), settings=SETTINGS)
    # No plan yet: writing or another moment says to start again.
    with pytest.raises(remix.RemixError, match="Start again"):
        asyncio.run(remixer(config(env, [], recordings={"0": {"reaction": {"path": env.take}}}), env)[0].write())
    with pytest.raises(remix.RemixError, match="Start again"):
        asyncio.run(remixer(config(env, []), env)[0].pick_another(0))
    assert remix.camera_recording({"reaction": {"path": "/nope.mp4"}}, "moment_take") is None
