"""Remix "Me, on camera": recordings, sound alignment, the person cut-out, and real FFmpeg renders of every layout."""

import asyncio
import json
import os
import subprocess
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image, ImageDraw

from clip_engine.services import remix_service as remix
from clip_engine.services import segmentation
from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.rendering_service import RenderingService
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord, TranscriptionResult

from .test_audit_render import FFMPEG_WITH_ASS, needs_libass
from .test_background_split import _mean
from .test_remix import FakeMedia, plan_item, transcript

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
PORTRAIT = os.path.join(FIXTURES, "portrait_person.jpg")
ORANGE = (255, 128, 0)
BRAND = "#2040FF"
SETTINGS = SimpleNamespace(openrouter_api_key="test", openrouter_base_url="https://example.invalid/api/v1", planner_model="test/model",
                           get_planner_fallback_models=lambda: [], pexels_api_key=None)
FAST_VIDEO = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p", "-r", "30"]


def run(cmd, **kw):
    subprocess.run(cmd, check=True, timeout=180, **kw)


def probe(ffprobe, path):
    return json.loads(subprocess.run([ffprobe, "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration",
                                      "-of", "json", path], capture_output=True, check=True, text=True).stdout)


def person_png(path, width, height):
    """A stand-in person: gray wall, skin-colored head, dark shoulders (centered)."""
    img = Image.new("RGB", (width, height), (128, 128, 128))
    draw = ImageDraw.Draw(img)
    cx = width // 2
    draw.ellipse([cx - width * 0.07, height * 0.2, cx + width * 0.07, height * 0.55], fill=(224, 176, 144))
    draw.rectangle([cx - width * 0.09, height * 0.55, cx + width * 0.09, height], fill=(32, 48, 64))
    img.save(path)


def fake_write_matte(video, out, width, height, fps=30, timeout=0):
    """A fixed ellipse over the stand-in person (the real model needn't detect drawn shapes)."""
    mw, mh = segmentation.internal_size(width, height)
    img = Image.new("L", (mw, mh), 0)
    ImageDraw.Draw(img).ellipse([mw * 0.4, mh * 0.15, mw * 0.6, mh * 1.05], fill=255)
    png = out + ".png"
    img.save(png)
    seconds = remix.media_seconds(video)
    run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", str(fps), "-i", png, "-t", f"{seconds:.3f}", "-c:v", "ffv1",
         "-pix_fmt", "gray", out])
    return out


@pytest.fixture
def env(tmp_path, monkeypatch):
    if FFMPEG_WITH_ASS is None:
        pytest.skip("FFmpeg with libass required")
    ffmpeg, ffprobe = FFMPEG_WITH_ASS
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    monkeypatch.setattr(remix, "VIDEO_ARGS", FAST_VIDEO)
    monkeypatch.setattr(remix, "SHORT_VIDEO_MAX_S", 10)  # the 30 s source stands in for a long video
    monkeypatch.setattr(remix, "SILENT_MIN_MS", 3000)  # short moments keep the renders quick

    async def plan_layout(self, request, width, height, start, duration):
        return ClipLayoutPlan([ShotLayout(0, duration, LayoutType.TALKING_HEAD)], width, height)
    monkeypatch.setattr(RenderingService, "_plan_layout", plan_layout)
    monkeypatch.setattr(RenderingService, "_video_codec_args", lambda *a: ["-c:v", "mpeg4", "-q:v", "3"])
    # The moment: a solid orange picture with pink noise (unique, so it can be found by sound).
    source = tmp_path / "source.mp4"
    run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xff8000:s=640x360:d=30:r=30", "-f", "lavfi", "-i",
         "anoisesrc=d=30:c=pink:seed=7:a=0.3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source)])
    return SimpleNamespace(ffmpeg=ffmpeg, ffprobe=ffprobe, tmp=tmp_path, source=str(source))


def plan(env, monkeypatch, config, items):
    class FakeTranscription:
        async def transcribe(self, video, work):
            return TranscriptionResult(segments=transcript(30), full_text="")

        async def transcribe_audio(self, path):
            words = [TranscriptWord(w, 200 + i * 400, 500 + i * 400) for i, w in enumerate(["hello", "from", "me", "on", "camera."])]
            return TranscriptionResult(segments=[TranscriptSegment(200, 2100, " ".join(w.word for w in words), None, words)], full_text="",
                                       api_costs=SimpleNamespace(estimated_cost_usd=0.002))
    import clip_engine.services.transcription_service as ts
    monkeypatch.setattr(ts, "TranscriptionService", FakeTranscription)

    async def fake_chat(client, payload):
        if payload["response_format"]["json_schema"]["name"] == "remix_grades":
            return {"choices": [{"message": {"content": json.dumps({"grades": []})}}]}, {"cost": 0.0}
        return {"choices": [{"message": {"content": json.dumps({"remixes": items})}}]}, {"cost": 0.05}
    monkeypatch.setattr(remix, "chat_completion", fake_chat)
    return asyncio.run(remix.Remixer(config, media=FakeMedia(env.ffmpeg), settings=SETTINGS).plan())


def silent_item(start, end, headline="This creator says your best reel probably made nothing"):
    return {"start": start, "end": end, "moment_quote": "word10", "why_this_moment": "Bold.", "headline": headline,
            "cues": [{"at": 0, "reaction": "listen"}], "post_caption": "Views measure attention.\n\n1. Sales measure trust.",
            "proof_used": [], "self_check": {"attacks_person": False, "invented_claims": False}}


def make_reaction_recording(env, path, moment_start, delay, size=(640, 360), seconds=None):
    """The member filmed watching the moment: red until the clip starts `delay` seconds in, then the person.
    WebM (VP8 + Opus), variable frame rate, written to a pipe so it has no duration (like MediaRecorder)."""
    png = env.tmp / f"person-{size[0]}x{size[1]}.png"
    person_png(png, *size)
    seconds = seconds or delay + 6
    # Every 5th frame dropped and the rest jittered: timestamps like a busy webcam's.
    graph = (f"[0:v]drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:enable='lt(t,{delay})',fps=24,"
             f"select='not(eq(mod(n,5),4))',setpts='PTS+0.008*sin(N)/TB'[v];"
             f"[1:a]atrim=start={moment_start}:duration={max(0.5, seconds - delay)},asetpts=PTS-STARTPTS,adelay={int(delay * 1000)}:all=1,volume=0.6[c];"
             f"[2:a]volume=0.15[n];[c][n]amix=inputs=2:duration=longest:normalize=0,asetpts=N/SR/TB,atrim=duration={seconds}[a]")
    with open(path, "wb") as handle:
        subprocess.run([env.ffmpeg, "-v", "error", "-y", "-loop", "1", "-framerate", "24", "-t", str(seconds), "-i", str(png),
                        "-i", env.source, "-f", "lavfi", "-t", str(seconds), "-i", "anoisesrc=c=white:seed=3:a=0.2",
                        "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-fps_mode", "vfr",
                        "-c:v", "libvpx", "-b:v", "600k", "-deadline", "realtime", "-c:a", "libopus", "-f", "webm", "pipe:1"],
                       stdout=handle, check=True, timeout=180)
    return str(path)


def make_line_recording(env, path, seconds, size, freq):
    png = env.tmp / f"line-{size[0]}x{size[1]}.png"
    person_png(png, *size)
    run([env.ffmpeg, "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-i", str(png), "-f", "lavfi", "-i",
         f"sine=frequency={freq}:duration={seconds}", "-t", str(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", str(path)])
    return str(path)


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------

def test_audio_offset_is_found_by_cross_correlation():
    rate = remix.OFFSET_RATE
    rng = np.random.default_rng(1)
    clip = rng.standard_normal(rate * 8).astype(np.float32) * 0.3
    room = rng.standard_normal(rate * 20).astype(np.float32) * 0.1
    recording = room.copy()
    start = int(2.3 * rate)
    # Quieter, filtered and with the member's own noise on top: a speaker heard through a mic.
    heard = np.convolve(clip, [0.6, 0.3, 0.1], mode="same") * 0.5
    recording[start:start + len(heard)] += heard
    offset, confidence = remix.find_audio_offset(clip, recording)
    assert abs(offset - 2.3) < 0.005 and confidence > 0.5
    assert remix.find_audio_offset(np.zeros(rate * 4), recording) == (None, 0.0)
    _, unrelated = remix.find_audio_offset(rng.standard_normal(rate * 4), room)
    assert unrelated < remix.OFFSET_MIN_SCORE


def test_recordings_are_checked(tmp_path):
    clip = tmp_path / "me.webm"
    clip.write_bytes(b"webm")
    assert remix.camera_recording({"reaction": {"path": str(clip), "offset_s": 1.5}}, "silent") == {"reaction": {"path": str(clip), "offset_s": 1.5}}
    assert remix.camera_recording({"reaction": {"path": str(clip), "offset_s": None}}, "silent")["reaction"]["offset_s"] is None
    for bad in ({"reaction": {"path": "rel.webm"}}, {"reaction": {"path": str(tmp_path / "gone.webm")}},
                {"reaction": {"path": str(clip), "offset_s": -1}}, {"reaction": {"path": str(clip), "offset_s": True}}, None, "x"):
        assert remix.camera_recording(bad, "silent") is None
    take = {"intro": str(clip), "beats": [str(clip)], "close": str(clip)}
    assert remix.camera_recording(take, "commentary") == take
    assert remix.camera_recording(dict(take, beats=[str(tmp_path / "gone.mp4")]), "commentary") is None
    assert remix.camera_recording({"intro": str(clip)}, "commentary") is None


def test_camera_host_needs_no_avatar_reactions_or_voice(tmp_path):
    for fmt in ("commentary", "silent"):
        config = remix.RemixConfig(output_dir=str(tmp_path), host="camera", format=fmt, voice_model=remix.CLONE_TTS_MODEL)
        remix.Remixer(config, media=FakeMedia("ffmpeg"), settings=SETTINGS)
    for over in ({"camera_layout": "hologram"}, {"camera_backdrop": "beach"}, {"camera_backdrop_color": "blue"}):
        with pytest.raises(remix.RemixError):
            remix.Remixer(remix.RemixConfig(output_dir=str(tmp_path), host="camera", **over), media=FakeMedia("ffmpeg"), settings=SETTINGS)


def test_segmentation_finds_a_real_person():
    if not segmentation.available():
        pytest.skip("OpenCV DNN or the model is missing")
    import cv2
    photo = cv2.imread(PORTRAIT)
    for canvas in ("portrait", "landscape"):
        if canvas == "portrait":
            frame = cv2.resize(photo, (540, 920))
        else:
            frame = np.full((540, 960, 3), (90, 140, 120), np.uint8)
            frame[:, 330:647] = cv2.resize(photo, (317, 540))
        matte = segmentation.matte_image(frame)
        assert matte.shape == frame.shape[:2] and matte.dtype == np.uint8
        if canvas == "portrait":
            assert matte[300:500, 200:340].mean() > 240 and matte[:60, :60].mean() < 10
        else:
            assert matte[150:350, 440:530].mean() > 240 and matte[:, :250].mean() < 10 and matte[:, 720:].mean() < 10


def test_matte_video_is_written_frame_for_frame(tmp_path):
    if FFMPEG_WITH_ASS is None or not segmentation.available():
        pytest.skip("FFmpeg and the model are needed")
    ffmpeg, ffprobe = FFMPEG_WITH_ASS
    clip = tmp_path / "me.mp4"
    run([ffmpeg, "-v", "error", "-y", "-loop", "1", "-framerate", "30", "-i", PORTRAIT, "-t", "1",
         "-vf", "scale=720:1280,setsar=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(clip)])
    out = segmentation.write_matte(str(clip), str(tmp_path / "m.mkv"), 720, 1280, 30)
    frames = subprocess.run([ffprobe, "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                             "stream=nb_read_frames,width,height,pix_fmt", "-of", "json", out], capture_output=True, text=True, check=True).stdout
    stream = json.loads(frames)["streams"][0]
    assert (stream["width"], stream["height"], stream["pix_fmt"], int(stream["nb_read_frames"])) == (404, 720, "gray", 30)
    face = _mean(ffmpeg, out, 0.5, "crop=80:80:163:250")
    corner = _mean(ffmpeg, out, 0.5, "crop=40:40:0:0")
    assert face.min() > 235 and corner.max() < 20


def test_webcam_webm_and_phone_mov_recordings_decode(env):
    webm = make_reaction_recording(env, env.tmp / "cam.webm", 4.0, 1.0, seconds=3)
    with pytest.raises(remix.RemixError):
        remix.media_seconds(webm)  # MediaRecorder-style WebM: no duration in the file
    out = str(env.tmp / "cam-norm.mp4")
    seconds = remix.normalize_recording(webm, out, 60)
    info = probe(env.ffprobe, out)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert abs(seconds - 3) < 0.3 and video["r_frame_rate"] == "30/1" and any(s["codec_type"] == "audio" for s in info["streams"])
    # A phone video: MOV, portrait, no sound.
    mov = env.tmp / "phone.mov"
    run([env.ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:d=2:r=60", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(mov)])
    seconds = remix.normalize_recording(str(mov), str(env.tmp / "phone-norm.mp4"), 60)
    info = probe(env.ffprobe, str(env.tmp / "phone-norm.mp4"))
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert abs(seconds - 2) < 0.2 and (video["width"], video["height"]) == (1080, 1920) and any(s["codec_type"] == "audio" for s in info["streams"])
    with pytest.raises(remix.RemixError, match="could not be read"):
        bad = env.tmp / "bad.webm"
        bad.write_bytes(b"not a video")
        remix.normalize_recording(str(bad), str(env.tmp / "bad.mp4"), 60)


# ---------------------------------------------------------------------------
# Renders
# ---------------------------------------------------------------------------

def render_reaction(env, monkeypatch, layout, *, delay=2.3, offset=None, talk=False, backdrop="blur", items=None, recorded=("0",)):
    monkeypatch.setattr(segmentation, "write_matte", fake_write_matte)
    config = remix.RemixConfig(sources=[env.source], output_dir=str(env.tmp / f"out-{layout}"), count=2, host="camera", format="silent",
                               creator="Coach Example", camera_layout=layout, camera_backdrop=backdrop, camera_backdrop_color=BRAND,
                               camera_talk=talk, cta_keyword="SALES", cta_offer="my playbook")
    planned = plan(env, monkeypatch, config, items or [silent_item(4, 8)])
    assert all(d["estimate_usd"] == 0.0 for d in planned["drafts"])
    moment_start = planned["drafts"][0]["start_ms"] / 1000
    webm = make_reaction_recording(env, env.tmp / "me.webm", moment_start, delay)
    config.recordings = {key: {"reaction": {"path": webm, "offset_s": offset}} for key in recorded}
    captured = []
    from clip_engine.services.caption_generator import CaptionGeneratorService
    original = CaptionGeneratorService.generate_captions

    async def spy(self, **kw):
        captured.append(" ".join(s.text for s in kw["transcript_segments"]))
        return await original(self, **kw)
    monkeypatch.setattr(CaptionGeneratorService, "generate_captions", spy)
    media = FakeMedia(env.ffmpeg)
    result = asyncio.run(remix.Remixer(config, media=media, settings=SETTINGS).render([{"id": d["id"]} for d in planned["drafts"]]))
    assert media.speech_calls == [] and media.avatar_calls == 0
    out = result["remixes"][0]
    info = probe(env.ffprobe, out["path"])
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920)
    assert any(s["codec_type"] == "audio" for s in info["streams"])
    moment_s = (planned["drafts"][0]["end_ms"] - planned["drafts"][0]["start_ms"]) / 1000
    assert abs(float(info["format"]["duration"]) - moment_s) < 0.3
    checks = {c["id"]: c for c in out["checks"]}
    assert checks["presenter"]["ok"] and "ai_label" not in checks and checks["permission"]["ok"] and checks["credited"]["ok"]
    manifest = json.load(open(out["manifest_path"]))
    assert manifest["presenter"]["mode"] == "camera" and manifest["presenter"]["ai_generated"] is False and out["camera"] is True
    job = json.load(open(env.tmp / f"out-{layout}" / "job_output.json"))
    assert job["clips"][0]["ai_generated"] is False
    return SimpleNamespace(out=out, manifest=manifest, result=result, captions=captured, moment_s=moment_s)


@needs_libass
def test_live_reaction_filmed_found_by_sound_with_talk(env, monkeypatch):
    # Two moments planned, a recording for only the first: the second is skipped with a warning.
    items = [silent_item(4, 8), silent_item(16, 20, "A second creator claim people argue about")]
    run_ = render_reaction(env, monkeypatch, "filmed", talk=True, items=items)
    assert len(run_.result["remixes"]) == 1
    assert "No recording for “A second creator claim people argue about”, so it was skipped." in run_.result["warnings"]
    presenter = run_.manifest["presenter"]
    assert presenter["offset_found_by"] == "sound" and abs(presenter["offset_seconds"] - 2.3) < 0.05 and presenter["talk"]
    # Lined up: the red lead-in before the clip started is gone; the member's footage fills the bottom.
    bottom = _mean(env.ffmpeg, run_.out["path"], 0.3, "crop=40:40:8:1380")
    assert abs(bottom - 128).max() < 25, bottom
    # Talking: captions are the member's words, and the cost is the transcription.
    assert run_.captions and "hello from me on camera." in run_.captions[-1]
    assert run_.out["cost_usd"] == pytest.approx(0.002)


@needs_libass
def test_live_reaction_cutout_on_a_brand_color(env, monkeypatch):
    run_ = render_reaction(env, monkeypatch, "cutout", backdrop="brand", offset=2.3)
    assert run_.manifest["presenter"]["offset_found_by"] == "app" and run_.manifest["presenter"]["layout"] == "cutout"
    side = _mean(env.ffmpeg, run_.out["path"], 1.0, "crop=40:40:8:1380")
    assert abs(side - np.array([0x20, 0x40, 0xFF])).max() < 30, side
    # The member (dark shirt) in the middle, the clip box (orange) at the top.
    body = _mean(env.ffmpeg, run_.out["path"], 1.0, "crop=40:40:520:1800")
    assert abs(body - np.array([32, 48, 64])).max() < 30, body
    clip = _mean(env.ffmpeg, run_.out["path"], 1.0, "crop=40:40:520:600")
    assert abs(clip - np.array(ORANGE)).max() < 40, clip
    # Not talking: captions come from the moment's words.
    assert run_.captions and "word" in run_.captions[-1]


@needs_libass
def test_live_reaction_green_screen_with_an_unmatched_recording(env, monkeypatch):
    # The recording's sound doesn't contain the clip: it can't be lined up, so it starts with the clip.
    monkeypatch.setattr(remix, "pcm_mono", lambda path, start, seconds, rate=8000:
                        np.random.default_rng(int(start) + len(path)).standard_normal(int(seconds * rate)).astype(np.float32))
    run_ = render_reaction(env, monkeypatch, "greenscreen")
    assert "Couldn't line your recording up with the clip by sound; it starts with the clip." in run_.out["warnings"]
    assert run_.manifest["presenter"]["offset_found_by"] == "assumed"
    top = _mean(env.ffmpeg, run_.out["path"], 3.0, "crop=100:50:40:600")
    assert abs(top - np.array(ORANGE)).max() < 40, top
    person = _mean(env.ffmpeg, run_.out["path"], 3.0, "crop=40:40:520:1820")
    assert abs(person - np.array(ORANGE)).max() > 80, person


@needs_libass
def test_voiced_take_with_your_own_recordings(env, monkeypatch):
    monkeypatch.setattr(segmentation, "write_matte", fake_write_matte)
    config = remix.RemixConfig(sources=[env.source], output_dir=str(env.tmp / "out"), count=2, host="camera", creator="Coach Example",
                               camera_layout="greenscreen", cta_keyword="PULLUP", cta_offer="my plan")
    planned = plan(env, monkeypatch, config, [plan_item(4, 8), plan_item(20, 24, headline="A second moment people argue about")])
    assert len(planned["drafts"]) == 2 and all(d["estimate_usd"] == 0.0 for d in planned["drafts"])
    intro = make_line_recording(env, env.tmp / "intro.mp4", 2.5, (640, 360), 300)
    beat = make_line_recording(env, env.tmp / "beat.mp4", 2.0, (640, 360), 500)
    close = make_reaction_recording(env, env.tmp / "close.webm", 0, 0.0, size=(360, 640), seconds=2.5)
    config.recordings = {"0": {"intro": intro, "beats": [beat], "close": close}}
    captured = []
    from clip_engine.services.caption_generator import CaptionGeneratorService
    original = CaptionGeneratorService.generate_captions

    async def spy(self, **kw):
        captured.append(" ".join(s.text for s in kw["transcript_segments"]))
        return await original(self, **kw)
    monkeypatch.setattr(CaptionGeneratorService, "generate_captions", spy)
    media = FakeMedia(env.ffmpeg)
    result = asyncio.run(remix.Remixer(config, media=media, settings=SETTINGS).render([{"id": 0}, {"id": 1}]))
    assert media.speech_calls == [] and media.avatar_calls == 0
    assert len(result["remixes"]) == 1 and any("No recording for “A second moment" in w for w in result["warnings"])
    out = result["remixes"][0]
    info = probe(env.ffprobe, out["path"])
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920) and any(s["codec_type"] == "audio" for s in info["streams"])
    manifest = json.load(open(out["manifest_path"]))
    timeline = manifest["timeline"]
    assert [p["part"] for p in timeline] == ["excerpt", "host", "beat", "host"]
    assert abs(timeline[1]["seconds"] - 2.5) < 0.2 and abs(timeline[2]["seconds"] - 2.0) < 0.2 and abs(timeline[3]["seconds"] - 2.5) < 0.2
    assert manifest["presenter"] == {"mode": "camera", "layout": "greenscreen", "voice": "own", "ai_generated": False}
    assert manifest["models"]["voice"] is None
    checks = {c["id"]: c for c in out["checks"]}
    assert checks["presenter"]["ok"] and "ai_label" not in checks and out["ai_presenter"] is False
    assert captured and "hello from me on camera." in captured[-1]  # timed from their recordings, not the script
    assert out["cost_usd"] == pytest.approx(0.002)
    # The intro: the moment (orange) behind, the member cut out at the bottom.
    at = timeline[1]["start_seconds"] + 1.0
    top = _mean(env.ffmpeg, out["path"], at, "crop=100:50:40:700")
    assert abs(top - np.array(ORANGE)).max() < 50, top
    body = _mean(env.ffmpeg, out["path"], at, "crop=40:40:520:1840")
    assert abs(body - np.array([32, 48, 64])).max() < 35, body


def test_nothing_recorded_stops_the_render(env, monkeypatch):
    config = remix.RemixConfig(sources=[env.source], output_dir=str(env.tmp / "out"), count=1, host="camera", format="silent")
    planned = plan(env, monkeypatch, config, [silent_item(4, 8)])
    with pytest.raises(remix.RemixError, match="Record yourself"):
        asyncio.run(remix.Remixer(config, media=FakeMedia(env.ffmpeg), settings=SETTINGS).render([{"id": planned["drafts"][0]["id"]}]))


def _tone_level(samples, rate, freq, start, end):
    part = samples[int(start * rate):int(end * rate)]
    spectrum = np.abs(np.fft.rfft(part * np.hanning(len(part))))
    bins = np.fft.rfftfreq(len(part), 1 / rate)
    return spectrum[(bins > freq - 15) & (bins < freq + 15)].max()


def test_talking_ducks_the_clip_under_the_voice(env):
    """The clip (a 200 Hz tone) drops while the member (a 1 kHz tone, 2-4 s) speaks, and comes back after."""
    out = env.tmp / "mix.wav"
    graph = remix.voice_over_clip("0:a", "1:a", "a")
    run([env.ffmpeg, "-v", "error", "-y",
         "-f", "lavfi", "-i", "sine=frequency=1000:duration=6,volume='if(between(t,2,4),0.5,0)':eval=frame,aformat=channel_layouts=stereo",
         "-f", "lavfi", "-i", "sine=frequency=200:duration=6,volume=0.5,aformat=channel_layouts=stereo",
         "-filter_complex", graph, "-map", "[a]", "-ac", "1", "-ar", "16000", str(out)])
    import wave
    with wave.open(str(out)) as handle:
        samples = np.frombuffer(handle.readframes(handle.getnframes()), np.int16).astype(np.float32)
    before = _tone_level(samples, 16000, 200, 0.8, 1.8)
    during = _tone_level(samples, 16000, 200, 2.6, 3.8)
    after = _tone_level(samples, 16000, 200, 5.0, 5.9)
    assert during < before / 2, (before, during)  # at least 6 dB under the voice
    assert after > before * 0.7, (before, after)  # and back up once they stop
    assert _tone_level(samples, 16000, 1000, 2.6, 3.8) > before  # the voice is in front


def test_a_late_start_is_read_from_near_it(env):
    recording = make_line_recording(env, env.tmp / "long.mp4", 8, (320, 180), 300)
    out = str(env.tmp / "norm.mp4")
    # Starting at 5 s, reading begins a second early: 3 s of normalized recording for a 2 s part.
    seconds = remix.normalize_recording(recording, out, 3.0, start=5.0)
    assert remix.seek_point(5.0) == 4.0 and abs(seconds - 3.0) < 0.15
    assert remix.seek_point(0.4) == 0.0


def test_sound_that_starts_late_is_lined_up_on_the_video_timeline(env):
    """The offset is measured on the same timeline the cut uses, even when the recording's sound starts after its picture."""
    rate = remix.OFFSET_RATE
    clip = remix.pcm_mono(env.source, 4.0, 6.0)
    late = env.tmp / "late.mkv"
    # Picture from 0 s; sound from 0.5 s, and in it the clip begins 2 s later: 2.5 s on the video's timeline.
    sound = env.tmp / "sound.mka"
    run([env.ffmpeg, "-v", "error", "-y", "-ss", "2", "-t", "9", "-i", env.source, "-vn", "-c:a", "pcm_s16le", str(sound)])
    run([env.ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=160x90:d=10:r=30", "-itsoffset", "0.5", "-i", str(sound),
         "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-c:a", "pcm_s16le", str(late)])
    streams = json.loads(subprocess.run([env.ffprobe, "-v", "error", "-show_entries", "stream=codec_type,start_time", "-of", "json", str(late)],
                                        capture_output=True, text=True, check=True).stdout)["streams"]
    assert float(next(s for s in streams if s["codec_type"] == "audio")["start_time"]) > 0.4  # the fixture really starts late
    heard = remix.pcm_mono(str(late), 0.0, 9.0)
    offset, confidence = remix.find_audio_offset(clip, heard)
    assert confidence > remix.OFFSET_MIN_SCORE and abs(offset - 2.5) < 0.05, (offset, confidence)
    assert len(heard) >= int(9 * rate)
