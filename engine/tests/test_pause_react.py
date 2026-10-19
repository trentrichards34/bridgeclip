"""Remix "Pause & react": the timeline (from the app's log or worked out from a phone recording's sound),
the assembled original (played and held frames, mixed sound), and real FFmpeg renders of both layouts."""

import asyncio
import json
import os
import subprocess
import wave
from types import SimpleNamespace

import numpy as np
import pytest

from clip_engine.services import pause_react as pr
from clip_engine.services import remix_service as remix
from clip_engine.services import segmentation
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord, TranscriptionResult

from .recompose_support import no_ai, recompose
from .test_audit_render import FFMPEG_WITH_ASS
from .test_camera_remix import FAST_VIDEO, SETTINGS, fake_write_matte
from .test_remix import FakeMedia

RATE = pr.DETECT_RATE


# ---------------------------------------------------------------------------
# Synthetic sound: "speech" is noise with a syllable-like rhythm
# ---------------------------------------------------------------------------

def speechy(seconds, seed, rate=RATE, level=0.3, rhythm=4.0):
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * rate)) / rate
    envelope = (0.55 + 0.45 * np.sin(2 * np.pi * rhythm * t + seed)) ** 2
    return (rng.standard_normal(len(t)) * level * envelope).astype(np.float32)


def room(seconds, seed=99, rate=RATE):
    return (np.random.default_rng(seed).standard_normal(int(seconds * rate)) * 0.002).astype(np.float32)


def kinds_at(raw, t):
    for a, b, kind in raw:
        if a <= t < b:
            return kind
    return raw[-1][2]


def agreement(raw, truth, step=0.1, margin=0.35):
    """Share of sample points (away from the true boundaries) where the detected kind matches."""
    checked = hits = 0
    for a, b, kind in truth:
        t = a + margin
        while t < b - margin:
            checked += 1
            hits += kinds_at(raw, t) == kind
            t += step
    return hits / max(1, checked)


def test_vad_alone_finds_the_talking_stretches():
    # No original heard (headphones): talking = paused, quiet = playing.
    parts, truth, t = [], [], 0.0
    for seconds, talk in [(1.5, False), (2.0, True), (3.0, False), (1.2, True), (2.5, False), (2.0, True), (1.0, False)]:
        parts.append(speechy(seconds, int(t * 10) + 1) if talk else room(seconds, int(t * 10)))
        truth.append([t, t + seconds, "pause" if talk else "play"])
        t += seconds
    phone = np.concatenate(parts)
    result = pr.analyze(phone, np.zeros(0, np.float32))
    assert result["aligned_by"] == "start" and result["offset"] == 0.0
    assert abs(result["duration"] - t) < 0.01
    assert agreement(result["raw"], truth) >= 0.95, result["raw"]
    assert abs(result["first_voice"] - 1.5) <= 0.2 and abs(result["last_voice"] - 12.2) <= 0.3


def test_phone_recording_offset_and_pauses_from_the_sound():
    # The member talks for 2 s, starts the original (heard at half level), pauses it to talk, plays on (a quiet bit of the
    # original included), talks over it while it keeps playing (found again), then talks with it paused at the end.
    original = speechy(30, 7, level=0.25, rhythm=3.0)
    original[int(6.0 * RATE):int(7.5 * RATE)] *= 0.0  # a silent moment in the original
    member = lambda s, seed: speechy(s, seed, level=0.35)  # noqa: E731
    pieces, truth, at = [], [], 0.0

    def play(seconds, talk_over=False):
        nonlocal at
        clip = original[int(at * RATE):int((at + seconds) * RATE)] * 0.5
        if talk_over:
            clip = clip + member(seconds, 77)
        pieces.append(clip + room(seconds, len(pieces)))
        start = sum(len(p) for p in pieces[:-1]) / RATE
        truth.append([start, start + seconds, "play"])
        at += seconds

    def talk(seconds, seed):
        start = sum(len(p) for p in pieces) / RATE
        pieces.append(member(seconds, seed) + room(seconds, seed))
        truth.append([start, start + seconds, "pause"])

    talk(2.0, 11)
    play(4.0)
    talk(2.5, 12)
    play(4.0)   # includes the original's silent moment (6.0-7.5 s into it)
    talk(1.5, 13)
    play(5.0)
    talk(2.0, 14)
    phone = np.concatenate(pieces)
    result = pr.analyze(phone, original[:int(25 * RATE)])
    assert result["aligned_by"] == "sound" and abs(result["offset"] - 2.0) < 0.05, result
    assert result["confidence"] >= pr.OFFSET_MIN_SCORE
    assert agreement(result["raw"], truth) >= 0.9, result["raw"]
    # Before the original starts, it's held on its first frame.
    assert kinds_at(result["raw"], 1.0) == "pause"


def test_talking_over_a_playing_original_is_found_again():
    original = speechy(30, 5, level=0.25, rhythm=3.0)
    member = speechy(3, 21, level=0.5)
    # Plays 0-4, then the member talks loudly over it for 3 s while it keeps playing (4-7), then it plays on.
    phone = np.concatenate([original[:int(4 * RATE)] * 0.5, original[int(4 * RATE):int(7 * RATE)] * 0.5 + member,
                            original[int(7 * RATE):int(12 * RATE)] * 0.5]) + room(12)
    result = pr.analyze(phone, original)
    # Wherever it was classed afterwards, the pointer caught up: the end plays and is heard at the right spot.
    assert kinds_at(result["raw"], 10.0) == "play" and kinds_at(result["raw"], 11.5) == "play"
    paused = sum(b - a for a, b, kind in result["raw"] if kind == "pause")
    assert paused < 1.0, result["raw"]


def write_wav(samples, path, rate=RATE):
    data = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(data)
    return str(path)


@pytest.fixture
def tools(monkeypatch):
    if FFMPEG_WITH_ASS is None:
        pytest.skip("FFmpeg with libass required")
    ffmpeg, ffprobe = FFMPEG_WITH_ASS
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    return SimpleNamespace(ffmpeg=ffmpeg, ffprobe=ffprobe)


def test_detect_pauses_from_files_finds_a_delayed_original(tools, tmp_path):
    original = speechy(20, 3, level=0.3, rhythm=3.0)
    source = write_wav(original, tmp_path / "original.wav")
    delay = 3.4
    phone = np.concatenate([room(delay), original[:int(5 * RATE)] * 0.4 + room(5, 1), speechy(2, 9, level=0.4), original[int(5 * RATE):int(9 * RATE)] * 0.4])
    recording = write_wav(phone, tmp_path / "phone.wav")
    result = pr.detect_pauses(recording, source, 0.0, 20.0)
    assert result["aligned_by"] == "sound" and abs(result["offset"] - delay) < 0.05, result
    assert kinds_at(result["raw"], delay + 2.0) == "play" and kinds_at(result["raw"], delay + 6.0) == "pause"
    # Trimmed: the original from 5 s on is heard 10.4 s into the phone recording.
    trimmed = pr.detect_pauses(recording, source, 5.0, 20.0)
    assert trimmed["aligned_by"] == "sound" and abs(trimmed["offset"] - (delay + 7.0)) < 0.05, trimmed
    silent = write_wav(np.zeros(RATE // 2), tmp_path / "short.wav")
    with pytest.raises(pr.PauseReactError):
        pr.detect_pauses(silent, source, 0.0, 20.0)


# ---------------------------------------------------------------------------
# The timeline from the app
# ---------------------------------------------------------------------------

def timeline(segments, trim=(2.0, 20.0), source="app"):
    return {"start": segments[0][0], "end": segments[-1][1], "trim_start": trim[0], "trim_end": trim[1], "source": source,
            "segments": [{"start": a, "end": b, "kind": k, "at": at} for a, b, k, at in segments]}


def test_timelines_are_checked_and_tidied():
    parsed = pr.parse_timeline(timeline([(0, 1.5, "play", 2.0), (1.5, 3.0, "pause", 3.5), (3.0, 4.5, "play", 3.5), (4.5, 6.0, "play", 5.0)]))
    # A play that carries on from the one before is one stretch.
    assert [(s.kind, s.start, s.end, s.at) for s in parsed.segments] == [("play", 0, 1.5, 2.0), ("pause", 1.5, 3.0, 3.5), ("play", 3.0, 6.0, 3.5)]
    assert pr.frame_counts(parsed) == [45, 45, 90] and parsed.duration == 6.0
    # The original's time is kept inside the trim.
    assert pr.parse_timeline(timeline([(0, 2, "play", 0.5)])).segments[0].at == 2.0
    bad = [
        timeline([(0, 1, "play", 2), (1.5, 3, "pause", 3)]),          # a gap
        timeline([(0, 1, "jump", 2)]),                                   # unknown kind
        timeline([(0, 400, "play", 2)]),                                 # longer than five minutes
        timeline([(0, 0.2, "play", 2)]),                                 # too short
        {**timeline([(0, 2, "play", 2)]), "source": "web"},
        {**timeline([(0, 2, "play", 2)]), "extra": 1},
        {**timeline([(0, 2, "play", 2)]), "segments": [{"start": 0, "end": 2, "kind": "play", "at": float("nan")}]},
        {**timeline([(0, 2, "play", 2)]), "segments": [{"start": 0, "end": 2, "kind": "play", "at": True}]},
        timeline([(0, 1, "play", 2)] * 2), "nope", None,
    ]
    for value in bad:
        with pytest.raises(pr.PauseReactError):
            pr.parse_timeline(value)
    too_many = [(i * 0.5, i * 0.5 + 0.5, "play" if i % 2 else "pause", 2.0 + i) for i in range(pr.MAX_SEGMENTS + 1)]
    with pytest.raises(pr.PauseReactError):
        pr.parse_timeline(timeline(too_many))


def test_original_positions_hold_the_paused_frame_and_the_last_one():
    parsed = pr.parse_timeline(timeline([(0, 1.5, "pause", 2.0), (1.5, 3.0, "play", 2.0), (3.0, 4.0, "pause", 3.5), (4.0, 7.0, "play", 3.5)],
                                        trim=(2.0, 5.0)))
    pieces = pr.original_positions(parsed, source_seconds=30.0)
    # Their intro holds the clip's first frame; after a play, the frame it stopped on; past the trim's end, its last frame.
    assert pieces[0] == ("pause", 2.0, 45)
    assert pieces[1] == ("play", 2.0, 45)
    assert pieces[2][0] == "pause" and abs(pieces[2][1] - (3.5 - 1 / 30)) < 1e-6 and pieces[2][2] == 30
    assert pieces[3] == ("play", 3.5, 45) and pieces[4][0] == "pause" and pieces[4][2] == 45 and abs(pieces[4][1] - (5.0 - 1.5 / 30)) < 1e-6
    assert sum(p[2] for p in pieces) == 210


def test_mix_ducks_the_member_while_it_plays_and_ramps_the_joins():
    rate = 48000
    parsed = pr.parse_timeline(timeline([(0, 1.0, "play", 2.0), (1.0, 2.0, "pause", 3.0), (2.0, 3.0, "play", 3.0)]))
    original = np.full(int(10 * rate), 0.5, np.float32)  # from 0 s
    member = np.full(int(3 * rate), 0.2, np.float32)
    mixed = pr.mix_audio(original, 0.0, member, parsed, 0.35, 30.0, rate)
    assert len(mixed) == 3 * rate
    middle = lambda a, b: float(np.mean(mixed[int(a * rate):int(b * rate)]))  # noqa: E731
    assert abs(middle(0.2, 0.8) - (0.5 + 0.2 * 0.35)) < 1e-3
    assert abs(middle(1.2, 1.8) - 0.2) < 1e-3
    assert abs(middle(2.2, 2.8) - (0.5 + 0.2 * 0.35)) < 1e-3
    # No jumps bigger than a ramp step: joins fade over RAMP_S.
    assert float(np.max(np.abs(np.diff(mixed)))) < 0.5 / (pr.RAMP_S * rate) * 1.5


# ---------------------------------------------------------------------------
# Real renders
# ---------------------------------------------------------------------------

@pytest.fixture
def env(tools, tmp_path, monkeypatch):
    monkeypatch.setattr(remix, "VIDEO_ARGS", FAST_VIDEO)
    monkeypatch.setattr(segmentation, "write_matte", fake_write_matte)
    from clip_engine.services.rendering_service import RenderingService
    monkeypatch.setattr(RenderingService, "_video_codec_args", lambda *a: ["-c:v", "mpeg4", "-q:v", "3"])
    run = tmp_path / "run"
    run.mkdir()
    # The original: a moving test pattern (every frame differs) with a 1 kHz tone.
    source = tmp_path / "original.mp4"
    subprocess.run([tools.ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=20:r=30", "-f", "lavfi", "-i",
                    "sine=frequency=1000:duration=20:sample_rate=48000", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source)],
                   check=True, timeout=120)
    # The member: a still person-ish picture with a steady 300 Hz "voice" (so levels can be measured).
    recording = tmp_path / "me.mp4"
    subprocess.run([tools.ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x406080:s=360x640:d=6.2:r=30", "-f", "lavfi", "-i",
                    "sine=frequency=300:duration=6.2:sample_rate=48000", "-vf", "drawbox=x=120:y=180:w=120:h=200:color=0xe0b090:t=fill",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(recording)], check=True, timeout=120)
    return SimpleNamespace(**vars(tools), tmp=tmp_path, out=run, source=str(source), recording=str(recording))


def fake_ai(monkeypatch, spoken="This coach says lose weight first and that is wrong"):
    calls = []

    class FakeTranscription:
        async def transcribe_audio(self, path, **kw):
            calls.append(("transcribe", os.path.basename(path)))
            if "original" in os.path.basename(path):
                found = [TranscriptWord(w, 100 + i * 300, 350 + i * 300) for i, w in enumerate("lose weight before your first pull up".split())]
            else:
                # The member's words, spread over the whole take (some fall in play stretches).
                found = [TranscriptWord(w, 200 + i * 550, 600 + i * 550) for i, w in enumerate(spoken.split())]
            return TranscriptionResult(segments=[TranscriptSegment(found[0].start_time_ms, found[-1].end_time_ms, " ".join(w.word for w in found), None, found)],
                                       full_text="", api_costs=SimpleNamespace(estimated_cost_usd=0.002))
    import clip_engine.services.transcription_service as ts
    monkeypatch.setattr(ts, "TranscriptionService", FakeTranscription)

    async def fake_chat(client, payload):
        calls.append(("chat", payload))
        body = {"headline": "This coach says lose weight first. I say not so fast",
                "post_caption": "You don't need to lose weight first.\n\n1. Train the pull.\n2. The scale follows.",
                "self_check": {"invented_claims": False}}
        return {"choices": [{"message": {"content": json.dumps(body)}}]}, {"cost": 0.01}
    monkeypatch.setattr(remix, "chat_completion", fake_chat)
    return calls


APP_TIMELINE = [(0, 1.5, "play", 2.0), (1.5, 3.0, "pause", 3.5), (3.0, 4.5, "play", 3.5), (4.5, 6.0, "pause", 5.0)]


def config(env, layout="box", tl=None, captions="member", camera="filmed", **over):
    return remix.RemixConfig(output_dir=str(env.out), sources=[env.source], creator="@coach", host="camera", format="pause_react",
                             camera_layout=camera, pause_layout=layout, pause_captions=captions, cta_keyword="PULL", cta_offer="my plan",
                             recordings={"0": {"reaction": {"path": env.recording, "offset_s": 0},
                                               "timeline": tl or timeline(APP_TIMELINE)}}, **over)


def gray_frames(path, size=(64, 36)):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={size[0]}:{size[1]},format=gray", "-f", "rawvideo", "-"],
                         capture_output=True, check=True, timeout=120).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, size[1], size[0]).astype(np.int16)


def tone_levels(path, start, seconds, rate=48000):
    samples = pr.pcm(path, start, seconds, rate)
    spectrum = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
    freqs = np.fft.rfftfreq(len(samples), 1 / rate)
    level = lambda f: float(spectrum[(freqs > f - 20) & (freqs < f + 20)].max())  # noqa: E731
    return level(1000), level(300)


def test_prepare_write_and_render_a_box_layout(env, monkeypatch):
    calls = fake_ai(monkeypatch)
    prepared = asyncio.run(remix.Remixer(config(env), media=FakeMedia(env.ffmpeg), settings=SETTINGS).plan())
    [draft] = prepared["drafts"]
    assert draft["format"] == "pause_react" and draft["end_ms"] == 20000 and abs(prepared["source_seconds"] - 20) < 0.1
    assert not calls, "getting the video ready is free"
    written = asyncio.run(remix.Remixer(config(env), media=FakeMedia(env.ffmpeg), settings=SETTINGS).write())
    [draft] = written["drafts"]
    assert draft["headline"].startswith("This coach says") and draft["post_caption"].endswith("Comment PULL and I'll send you my plan.\n\nClip: @coach")
    chat = [c[1] for c in calls if c[0] == "chat"]
    assert len(chat) == 1 and "pauses whenever the creator talks" in chat[0]["messages"][0]["content"]
    assert "lose weight before your first pull up" in chat[0]["messages"][1]["content"]
    # In-app recordings keep every word (the mic hears only the member).
    assert draft["quote"].startswith("This coach says lose weight")

    result = asyncio.run(remix.Remixer(config(env), media=FakeMedia(env.ffmpeg), settings=SETTINGS).render([{"id": 0, "headline": draft["headline"]}]))
    [made] = result["remixes"]
    assert made["format"] == "pause_react" and made["camera"] and not made["ai_presenter"]
    final = made["path"]
    assert abs(remix.media_seconds(final) - 6.0) < 0.1
    folder = os.path.join(env.out, ".edit", "clip_00")
    moment = os.path.join(folder, "moment.mp4")
    frames = gray_frames(moment)
    assert len(frames) == 180
    diffs = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
    # Frames 45-89 and 135-179 are held (the frame the original stopped on); the plays move every frame.
    held = list(range(45, 89)) + list(range(135, 179))
    assert max(diffs[i] for i in held) < 1.0, diffs
    assert min(diffs[i] for i in list(range(0, 44)) + list(range(90, 134))) > 1.0, diffs
    # The held frame is the last one played (no jump into the pause), and the play carries on from it.
    assert np.abs(frames[45] - frames[44]).mean() < 1.0 and np.abs(frames[90] - frames[89]).mean() > 1.0
    assert np.abs(frames[90] - frames[89]).mean() < np.abs(frames[90] - frames[0]).mean()
    # No black frames anywhere.
    assert frames.mean(axis=(1, 2)).min() > 20
    # Sound: the original's tone only while it plays; the member's voice full while paused, lowered while it plays.
    play_1k, play_300 = tone_levels(moment, 0.3, 0.9)
    pause_1k, pause_300 = tone_levels(moment, 1.8, 0.9)
    assert pause_1k < play_1k * 0.05 and play_300 < pause_300 * 0.6
    play2_1k, _ = tone_levels(moment, 3.3, 0.9)
    assert play2_1k > play_1k * 0.5
    # Continuous sound end to end (no dropouts at the joins), and the final video's sound lasts as long as its picture.
    samples = pr.pcm(final, 0, 6.0, 48000)
    windows = samples[:len(samples) // 2400 * 2400].reshape(-1, 2400)
    assert np.sqrt((windows ** 2).mean(axis=1)).min() > 0.01 and abs(len(samples) / 48000 - 6.0) < 0.06
    manifest = json.load(open(made["manifest_path"]))
    assert manifest["presenter"]["pause_react"] == {"arrangement": "box", "timeline_from": "app", "pauses": 2, "original_seconds": 3.0, "captions": "member"}
    assert made["editable"]["split"] is True
    job = json.load(open(os.path.join(env.out, "job_output.json")))
    assert job["clips"][0]["editable"]["split"] is True and job["metrics"]["remix_kinds"] == ["camera"]
    sample = os.environ.get("PAUSE_REACT_SAMPLES")
    if sample:
        os.makedirs(sample, exist_ok=True)
        for t in (0.8, 2.2):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", final, "-frames:v", "1", os.path.join(sample, f"box-{t}.png")], check=True)

    # Edit hook text & captions: re-made from the bundle with no AI.
    no_ai(monkeypatch)
    edited = recompose(env.out, headline="I tried the lose weight first advice", split=0.4)
    assert abs(edited["duration_seconds"] - 6.0) < 0.1 and edited["settings"]["headline"] == "I tried the lose weight first advice"


def test_split_layout_both_captions_and_a_phone_timeline(env, monkeypatch):
    fake_ai(monkeypatch)
    # A phone recording: the output starts 0.2 s in; words while the original plays are the original's, so they're dropped.
    tl = timeline([(0.2, 2.0, "pause", 2.0), (2.0, 4.0, "play", 2.0), (4.0, 6.0, "pause", 4.0)], source="upload", trim=(2.0, 3.0))
    cfg = lambda: config(env, layout="split", tl=tl, captions="both", camera="cutout")  # noqa: E731
    asyncio.run(remix.Remixer(cfg(), media=FakeMedia(env.ffmpeg), settings=SETTINGS).plan())
    written = asyncio.run(remix.Remixer(cfg(), media=FakeMedia(env.ffmpeg), settings=SETTINGS).write())
    saved = json.load(open(os.path.join(env.out, ".work", remix.PLAN_FILE)))
    member = saved["sources"][0]["meta"]["member"]["words"]
    # Words at 0.2-2.0 s and 4.0-6.0 s of the recording (0-1.8 s and 3.8-5.8 s of the video) only.
    assert member and all(a / 1000 + 0.2 < 2.0 or a / 1000 + 0.2 >= 3.9 for _, a, _b in member), member
    assert written["drafts"][0]["quote"]
    seen = []
    from clip_engine.services.caption_generator import CaptionGeneratorService
    original = CaptionGeneratorService.generate_captions

    async def spy(self, **kw):
        seen.append(" ".join(s.text for s in kw["transcript_segments"]))
        return await original(self, **kw)
    monkeypatch.setattr(CaptionGeneratorService, "generate_captions", spy)
    result = asyncio.run(remix.Remixer(cfg(), media=FakeMedia(env.ffmpeg), settings=SETTINGS).render([{"id": 0}]))
    [made] = result["remixes"]
    assert abs(remix.media_seconds(made["path"]) - 5.8) < 0.1
    # The original only played 1 s (its trim), then held its last frame.
    frames = gray_frames(os.path.join(env.out, ".edit", "clip_00", "moment.mp4"))
    assert len(frames) == 174
    diffs = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
    assert max(diffs[:53]) < 1.0 and min(diffs[55:83]) > 1.0 and max(diffs[85:]) < 1.0, diffs
    # Captions: the member's words and the original's while it plays.
    assert seen and "pull" in seen[0] and "coach" in seen[0]
    assert made["editable"]["split"] is False
    manifest = json.load(open(made["manifest_path"]))
    assert manifest["presenter"]["pause_react"]["arrangement"] == "split" and manifest["presenter"]["layout"] == "cutout"
    sample = os.environ.get("PAUSE_REACT_SAMPLES")
    if sample:
        os.makedirs(sample, exist_ok=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "2.5", "-i", made["path"], "-frames:v", "1", os.path.join(sample, "split-2.5.png")], check=True)


def test_a_new_take_after_writing_is_transcribed_again(env, monkeypatch):
    calls = fake_ai(monkeypatch)
    phone = timeline(APP_TIMELINE, source="upload")
    asyncio.run(remix.Remixer(config(env, tl=phone), media=FakeMedia(env.ffmpeg), settings=SETTINGS).plan())
    asyncio.run(remix.Remixer(config(env, tl=phone), media=FakeMedia(env.ffmpeg), settings=SETTINGS).write())
    before = len([c for c in calls if c[0] == "transcribe"])
    # A phone recording's pauses moved: which words are the member's changed, so they're transcribed again for the captions.
    moved = timeline([(0, 2.0, "play", 2.0), (2.0, 3.0, "pause", 4.0), (3.0, 6.0, "play", 4.0)], source="upload")
    result = asyncio.run(remix.Remixer(config(env, tl=moved), media=FakeMedia(env.ffmpeg), settings=SETTINGS)
                         .render([{"id": 0, "headline": "This coach says lose weight first"}]))
    assert len([c for c in calls if c[0] == "transcribe"]) == before + 1
    assert any("changed your recording or its pauses" in w for w in result["remixes"][0]["warnings"])


def test_bad_inputs_are_refused(env, monkeypatch):
    fake_ai(monkeypatch)
    with pytest.raises(remix.RemixError):
        remix.Remixer(remix.RemixConfig(output_dir=str(env.out), host="still", format="pause_react", avatar_photo=None), settings=SETTINGS)
    with pytest.raises(remix.RemixError):
        remix.Remixer(config(env, layout="side"), settings=SETTINGS)
    assert remix.camera_recording({"reaction": {"path": env.recording}, "timeline": {"start": 0}}, "pause_react") is None
    assert remix.camera_recording({"reaction": {"path": "/nope.mp4"}, "timeline": timeline(APP_TIMELINE)}, "pause_react") is None
    # No pause plan saved yet: writing says to start again.
    with pytest.raises(remix.RemixError, match="Start again"):
        asyncio.run(remix.Remixer(config(env), media=FakeMedia(env.ffmpeg), settings=SETTINGS).write())


def test_assembly_in_batches_keeps_every_frame_and_the_sound_in_step(env, monkeypatch):
    # Many short stretches, assembled a few at a time and joined: still exactly the recording's frames and length.
    monkeypatch.setattr(pr, "VIDEO_BATCH", 3)
    segments, t, at = [], 0.0, 2.0
    for i in range(8):
        kind = "play" if i % 2 == 0 else "pause"
        segments.append((round(t, 3), round(t + 0.7, 3), kind, round(at, 3)))
        if kind == "play":
            at += 0.7
        t += 0.7
    parsed = pr.parse_timeline(timeline(segments))
    work = env.tmp / "assembly"
    work.mkdir()
    out = pr.build_original_track(env.source, env.recording, parsed, 20.0, remix.MOMENT_LOOK, str(work / "moment.mp4"), str(work),
                                  FAST_VIDEO, remix.AUDIO_ARGS, remix.LOUDNORM)
    frames = gray_frames(out)
    assert len(frames) == round(parsed.duration * 30) == 168
    assert abs(remix.media_seconds(out) - parsed.duration) < 0.05
    diffs = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
    # Each pause (frames 21-41, 63-83, ...) is held; each play moves; no black frames at the joins.
    for start in (21, 63, 105, 147):
        assert max(diffs[start:start + 20]) < 1.0, (start, diffs[start:start + 21])
    assert min(diffs[1:20]) > 1.0 and frames.mean(axis=(1, 2)).min() > 20
    assert len(list(work.glob("original-0*.mp4"))) == 3
