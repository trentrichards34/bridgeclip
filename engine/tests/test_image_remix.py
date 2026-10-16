"""Remix "React to an article or post": the member talks over a screenshot. Write (transcribe + headline/caption) and render."""

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
from clip_engine.services.openrouter import OpenRouterError
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord, TranscriptionResult

from .test_audit_render import FFMPEG_WITH_ASS
from .test_background_split import _mean
from .test_camera_remix import FAST_VIDEO, SETTINGS, fake_write_matte, make_line_recording, make_reaction_recording, probe
from .test_remix import FakeMedia

CREDIT = "The Wall Street Journal"
RED, BLUE, GREEN = (220, 30, 30), (30, 60, 220), (30, 180, 60)


def article_png(path, width=1080, height=4200):
    """A long article screenshot: red masthead at the top, gray text lines, a blue block at the very end."""
    img = Image.new("RGB", (width, height), (250, 250, 250))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, width, 700], fill=RED)
    for y in range(760, height - 700, 60):
        draw.rectangle([60, y, width - 60 - (y * 37) % 300, y + 26], fill=(90, 90, 90))
    draw.rectangle([0, height - 700, width, height], fill=BLUE)
    img.save(path)
    return str(path)


def post_png(path, size=1080):
    img = Image.new("RGB", (size, size), (255, 255, 255))
    ImageDraw.Draw(img).rectangle([0, 0, size, size], fill=GREEN)
    img.save(path)
    return str(path)


def words(text, start=200):
    return [TranscriptWord(w, start + i * 400, start + i * 400 + 300) for i, w in enumerate(text.split())]


@pytest.fixture
def env(tmp_path, monkeypatch):
    if FFMPEG_WITH_ASS is None:
        pytest.skip("FFmpeg with libass required")
    ffmpeg, ffprobe = FFMPEG_WITH_ASS
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    monkeypatch.setattr(remix, "VIDEO_ARGS", FAST_VIDEO)
    monkeypatch.setattr(segmentation, "write_matte", fake_write_matte)
    out = tmp_path / "run"
    (out / ".work").mkdir(parents=True)
    source = tmp_path / "noise.mp4"  # only its sound is used, by the WebM recording helper
    subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=64x36:d=10:r=30", "-f", "lavfi", "-i",
                    "anoisesrc=d=10:c=pink:seed=7:a=0.3", "-c:v", "libx264", "-c:a", "aac", str(source)], check=True, timeout=120)
    return SimpleNamespace(ffmpeg=ffmpeg, ffprobe=ffprobe, tmp=tmp_path, out=out, source=str(source))


def fake_services(monkeypatch, spoken="Hello this article says remote work pays less and I think that is wrong.", fail_images=False):
    calls = []

    class FakeTranscription:
        async def transcribe_audio(self, path):
            calls.append(("transcribe", path))
            found = words(spoken) if spoken else []
            segs = [TranscriptSegment(found[0].start_time_ms, found[-1].end_time_ms, spoken, None, found)] if found else []
            return TranscriptionResult(segments=segs, full_text=spoken, api_costs=SimpleNamespace(estimated_cost_usd=0.003))
    import clip_engine.services.transcription_service as ts
    monkeypatch.setattr(ts, "TranscriptionService", FakeTranscription)

    async def fake_chat(client, payload):
        calls.append(("chat", payload))
        content = payload["messages"][1]["content"]
        if fail_images and isinstance(content, list):
            raise OpenRouterError("This model does not support image input", retryable=False)
        body = {"headline": "The Wall Street Journal says remote workers earn less. He disagrees",
                "post_caption": "Remote work doesn't cost you money.\n\n1. Output beats office hours.\n2. Pick roles that pay for results.",
                "self_check": {"invented_claims": False}}
        return {"choices": [{"message": {"content": json.dumps(body)}}]}, {"cost": 0.01}
    monkeypatch.setattr(remix, "chat_completion", fake_chat)
    return calls


def config(env, image, recording, layout="greenscreen", **over):
    return remix.RemixConfig(output_dir=str(env.out), host="camera", format="image", camera_layout=layout, camera_talk=True,
                             image_source={"path": image, "credit": CREDIT}, cta_keyword="REMOTE", cta_offer="my checklist",
                             recordings={"0": {"reaction": {"path": recording, "offset_s": 0}}}, **over)


def test_write_transcribes_and_writes_from_the_screenshot(env, monkeypatch):
    image = post_png(env.out / ".work" / "source.png")
    recording = make_line_recording(env, env.tmp / "take.mp4", 4, (360, 640), 300)
    calls = fake_services(monkeypatch)
    result = asyncio.run(remix.Remixer(config(env, image, recording), media=FakeMedia(env.ffmpeg), settings=SETTINGS).write())
    [draft] = result["drafts"]
    assert draft["id"] == 0 and draft["format"] == "image" and draft["headline"].startswith("The Wall Street Journal says")
    assert draft["post_caption"].endswith("Comment REMOTE and I'll send you my checklist.\n\nSource: The Wall Street Journal")
    assert draft["quote"].startswith("Hello this article") and (draft["intro"], draft["beats"], draft["close"]) == ("", [], "")
    assert abs(draft["end_ms"] - 4000) < 150 and draft["start_ms"] == 0 and draft["source_index"] == 0
    assert (draft["source_title"], draft["creator"], draft["style"], draft["stance"]) == (CREDIT, CREDIT, "reaction", "add_nuance")
    assert draft["estimate_usd"] == 0.0 and result["cost_usd"] == pytest.approx(0.013)
    chat = [c[1] for c in calls if c[0] == "chat"]
    assert len(chat) == 1
    content = chat[0]["messages"][1]["content"]
    assert content[0]["type"] == "text" and "remote work pays less" in content[0]["text"] and CREDIT in content[0]["text"]
    assert content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert "Comment REMOTE" in chat[0]["messages"][0]["content"]
    saved = json.load(open(env.out / ".work" / remix.PLAN_FILE))
    assert saved["scripts"][0]["format"] == "image" and saved["sources"][0]["segments"]


def test_write_falls_back_to_text_when_the_model_takes_no_images(env, monkeypatch):
    image = article_png(env.out / ".work" / "source.png")
    assert len(remix.model_images(image)) == 3  # a long screenshot goes in tiles (4200 px at 1.4x its width each)
    recording = make_line_recording(env, env.tmp / "take.mp4", 3, (360, 640), 300)
    calls = fake_services(monkeypatch, fail_images=True)
    result = asyncio.run(remix.Remixer(config(env, image, recording), media=FakeMedia(env.ffmpeg), settings=SETTINGS).write())
    chat = [c[1] for c in calls if c[0] == "chat"]
    assert len(chat) == 2 and isinstance(chat[1]["messages"][1]["content"], str)
    assert "screenshot itself is not available" in chat[1]["messages"][0]["content"]
    assert result["drafts"][0]["headline"]


def test_write_without_speech_keeps_the_run(env, monkeypatch):
    image = post_png(env.out / ".work" / "source.png")
    recording = make_line_recording(env, env.tmp / "take.mp4", 3, (360, 640), 300)
    fake_services(monkeypatch, spoken="")
    with pytest.raises(remix.RemixError) as error:
        asyncio.run(remix.Remixer(config(env, image, recording), media=FakeMedia(env.ffmpeg), settings=SETTINGS).write())
    assert str(error.value) == remix.NO_SPEECH
    assert os.path.isfile(image) and os.path.isfile(recording) and os.path.isdir(env.out / ".work")
    # A video with no sound track at all says the same.
    mute = env.tmp / "mute.mp4"
    subprocess.run([env.ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=2:r=30", "-c:v", "libx264", str(mute)],
                   check=True, timeout=60)
    with pytest.raises(remix.RemixError, match="couldn’t hear you"):
        asyncio.run(remix.Remixer(config(env, image, str(mute)), media=FakeMedia(env.ffmpeg), settings=SETTINGS).write())


def test_image_needs_camera_and_a_screenshot(env):
    image = post_png(env.tmp / "post.png")
    with pytest.raises(remix.RemixError, match="on camera"):
        remix.Remixer(remix.RemixConfig(output_dir=str(env.out), host="voice", format="image", image_source={"path": image}),
                      media=FakeMedia("ffmpeg"), settings=SETTINGS)
    with pytest.raises(remix.RemixError, match="screenshot is missing"):
        remix.Remixer(remix.RemixConfig(output_dir=str(env.out), host="camera", format="image", image_source={"path": str(env.tmp / "x.png")}),
                      media=FakeMedia("ffmpeg"), settings=SETTINGS)
    bad = env.tmp / "fake.png"
    bad.write_bytes(b"<svg/>")
    with pytest.raises(remix.RemixError, match="could not be read"):
        remix.prepare_image(str(bad), str(env.tmp / "o.png"))


def write_then_render(env, monkeypatch, image, recording, layout, **over):
    calls = fake_services(monkeypatch)
    cfg = config(env, image, recording, layout, **over)
    draft = asyncio.run(remix.Remixer(cfg, media=FakeMedia(env.ffmpeg), settings=SETTINGS).write())["drafts"][0]
    transcribed = sum(1 for c in calls if c[0] == "transcribe")
    captured = []
    from clip_engine.services.caption_generator import CaptionGeneratorService
    original = CaptionGeneratorService.generate_captions

    async def spy(self, **kw):
        captured.append(" ".join(s.text for s in kw["transcript_segments"]))
        return await original(self, **kw)
    monkeypatch.setattr(CaptionGeneratorService, "generate_captions", spy)
    media = FakeMedia(env.ffmpeg)
    edit = {"id": 0, "headline": "The Wall Street Journal says remote workers earn less. He disagrees",
            "postCaption": "My take on remote pay.", "intro": "", "beats": [], "close": ""}
    result = asyncio.run(remix.Remixer(cfg, media=media, settings=SETTINGS).render([edit]))
    assert media.speech_calls == [] and sum(1 for c in calls if c[0] == "transcribe") == transcribed  # write's words are reused
    out = result["remixes"][0]
    info = probe(env.ffprobe, out["path"])
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920) and any(s["codec_type"] == "audio" for s in info["streams"])
    assert abs(float(info["format"]["duration"]) - draft["end_ms"] / 1000) < 0.3
    checks = {c["id"]: c for c in out["checks"]}
    assert checks["presenter"]["ok"] and checks["credited"]["ok"] and "music" not in checks and "ai_label" not in checks
    assert "share this article or post" in checks["permission"]["label"]
    manifest = json.load(open(out["manifest_path"]))
    assert manifest["format"] == "image" and manifest["presenter"]["mode"] == "camera" and manifest["presenter"]["layout"] == layout
    assert out["camera"] is True and out["ai_presenter"] is False and out["post_caption"].endswith("Source: The Wall Street Journal")
    assert "Comment REMOTE" in out["post_caption"]
    job = json.load(open(env.out / "job_output.json"))
    assert job["clips"][0]["ai_generated"] is False and job["clips"][0]["description"] == "Source: The Wall Street Journal"
    assert captured and "remote work pays" in captured[-1]  # their words, cut at the end of the take
    return SimpleNamespace(out=out, manifest=manifest, seconds=draft["end_ms"] / 1000)


def test_green_screen_scrolls_a_long_article(env, monkeypatch):
    image = article_png(env.out / ".work" / "source.png")
    recording = make_reaction_recording(env, env.tmp / "take.webm", 0, 0.0, size=(360, 640), seconds=5)
    run = write_then_render(env, monkeypatch, image, recording, "greenscreen")
    assert run.manifest["presenter"]["image_scrolls"] is True
    # The masthead (red) at the start, the end of the article (blue) at the end, in the area above the member.
    start = _mean(env.ffmpeg, run.out["path"], 0.2, "crop=60:60:20:500")
    end = _mean(env.ffmpeg, run.out["path"], run.seconds - 0.2, "crop=60:60:20:800")
    assert abs(start - np.array(RED)).max() < 40, start
    assert abs(end - np.array(BLUE)).max() < 40, end
    person = _mean(env.ffmpeg, run.out["path"], 1.0, "crop=40:40:520:1830")
    assert abs(person - np.array([32, 48, 64])).max() < 35, person


def test_green_screen_shows_a_square_post_whole(env, monkeypatch):
    image = post_png(env.out / ".work" / "source.jpg".replace(".jpg", ".png"))
    recording = make_line_recording(env, env.tmp / "take.mp4", 3, (640, 360), 300)
    run = write_then_render(env, monkeypatch, image, recording, "greenscreen")
    assert run.manifest["presenter"]["image_scrolls"] is False
    top = _mean(env.ffmpeg, run.out["path"], 1.0, "crop=60:60:20:600")
    assert abs(top - np.array(GREEN)).max() < 40, top


def test_cutout_with_the_article_as_the_box(env, monkeypatch):
    image = article_png(env.out / ".work" / "source.png")
    recording = make_line_recording(env, env.tmp / "take.mp4", 3, (640, 360), 300)
    run = write_then_render(env, monkeypatch, image, recording, "cutout", camera_backdrop="brand", camera_backdrop_color="#2040FF")
    side = _mean(env.ffmpeg, run.out["path"], 1.0, "crop=40:40:8:1380")
    assert abs(side - np.array([0x20, 0x40, 0xFF])).max() < 30, side
    box = _mean(env.ffmpeg, run.out["path"], 0.2, "crop=60:40:500:560")
    assert abs(box - np.array(RED)).max() < 40, box


def test_filmed_under_a_square_post(env, monkeypatch):
    image = post_png(env.out / ".work" / "source.png")
    recording = make_line_recording(env, env.tmp / "take.mp4", 3, (640, 360), 300)
    run = write_then_render(env, monkeypatch, image, recording, "filmed")
    bottom = _mean(env.ffmpeg, run.out["path"], 1.0, "crop=40:40:8:1380")
    assert abs(bottom - 128).max() < 25, bottom


def test_job_output_credits_the_source_of_an_article_or_post(tmp_path):
    results = [remix.RemixResult(str(tmp_path / f"{i}.mp4"), "m.json", "Headline here now", "add_nuance", 3.0, 3.0, 0.0, [], [],
                                 creator="The Wall Street Journal", clip_index=i, format=fmt)
               for i, fmt in enumerate(("image", "silent", "commentary"))]
    remix.write_job_output(str(tmp_path), results, [{"meta": {"title": "t"}}], 0.0)
    job = json.load(open(tmp_path / "job_output.json"))
    assert [c["description"] for c in job["clips"]] == ["Source: The Wall Street Journal", "Original: The Wall Street Journal",
                                                        "Original: The Wall Street Journal"]


def test_a_long_screenshot_is_read_once_and_cropped_before_resizing(env):
    import time
    tall = article_png(env.tmp / "tall.png", 1080, 16000)
    inputs, graph, scrolls, cut = remix.image_stage(tall, str(env.tmp), 1080, 1660, 330, 700, 20.0, 2, "stage")
    assert scrolls and not cut and "-loop" not in inputs and "loop=loop=-1:size=1" in graph
    # 20 seconds of the scrolling stage: read once and repeated, so far faster than real time.
    started = time.monotonic()
    # Inputs 0 and 1 stand in for the member and the matte (the stage reads inputs 2 and 3).
    subprocess.run([env.ffmpeg, "-v", "error", "-f", "lavfi", "-i", "nullsrc=s=16x16:d=1", "-f", "lavfi", "-i", "nullsrc=s=16x16:d=1",
                    *inputs, "-filter_complex", graph, "-map", "[stage]", "-t", "20", "-f", "null", "-"], check=True, timeout=300)
    assert time.monotonic() - started < 40
    # A narrow, very tall image: rows are cropped first (never resized to 1080 x 81000), and the cut is reported.
    narrow = env.tmp / "narrow.png"
    Image.new("RGB", (200, 15000), (200, 200, 200)).save(narrow)
    _, _, scrolls, cut = remix.image_stage(str(narrow), str(env.tmp), 1080, 1660, 330, 700, 10.0, 2, "stage")
    with Image.open(env.tmp / "stage-strip.png") as strip:
        assert strip.size[1] <= remix.MAX_SCROLL_HEIGHT + 1660 and scrolls and cut
    _, _, box_h, _, cut = remix.image_box(str(narrow), str(env.tmp), 960, 900, 10.0, 2, "box")
    with Image.open(env.tmp / "box-strip.png") as strip:
        assert strip.size == (948, remix.MAX_SCROLL_HEIGHT) and cut
    # A very wide one stays small too; anything thinner than 1:80 is refused.
    wide = env.tmp / "wide.png"
    Image.new("RGB", (8000, 100), (10, 10, 10)).save(wide)
    remix.image_stage(str(wide), str(env.tmp), 1080, 1660, 330, 700, 5.0, 2, "stage")
    Image.new("RGB", (200, 30000), (0, 0, 0)).save(env.tmp / "thin.png")
    with pytest.raises(remix.RemixError, match="long and thin"):
        remix.prepare_image(str(env.tmp / "thin.png"))


def test_model_images_are_upright(env):
    photo = Image.new("RGB", (400, 300), (255, 0, 0))
    exif = photo.getexif()
    exif[0x0112] = 6  # rotate 90 degrees when shown
    photo.save(env.tmp / "sideways.jpg", exif=exif)
    import base64
    import io
    [url] = remix.model_images(str(env.tmp / "sideways.jpg"))
    with Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))) as sent:
        assert sent.size == (300, 400)
    assert remix.prepare_image(str(env.tmp / "sideways.jpg")) == (300, 400)


def test_write_says_when_a_recording_cant_be_read(env, monkeypatch):
    image = post_png(env.out / ".work" / "source.png")
    recording = make_line_recording(env, env.tmp / "take.mp4", 3, (360, 640), 300)
    fake_services(monkeypatch)
    cfg = config(env, image, recording)
    cfg.recordings["0"]["reaction"]["offset_s"] = 50  # starts after it ends
    with pytest.raises(remix.RemixError) as error:
        asyncio.run(remix.Remixer(cfg, media=FakeMedia(env.ffmpeg), settings=SETTINGS).write())
    assert str(error.value) == remix.RECORDING_UNREADABLE
    assert not os.path.exists(env.out / ".work" / "image-check.png")


def test_a_new_take_after_write_is_transcribed_again(env, monkeypatch):
    image = post_png(env.out / ".work" / "source.png")
    recording = make_line_recording(env, env.tmp / "take.mp4", 3, (640, 360), 300)
    calls = fake_services(monkeypatch)
    cfg = config(env, image, recording, "filmed")
    asyncio.run(remix.Remixer(cfg, media=FakeMedia(env.ffmpeg), settings=SETTINGS).write())
    # They record again (same path, new file) before rendering.
    make_line_recording(env, env.tmp / "take.mp4", 4, (640, 360), 500)
    before = sum(1 for c in calls if c[0] == "transcribe")
    result = asyncio.run(remix.Remixer(cfg, media=FakeMedia(env.ffmpeg), settings=SETTINGS).render([{"id": 0}]))
    out = result["remixes"][0]
    assert sum(1 for c in calls if c[0] == "transcribe") == before + 1
    assert any("came from an earlier take" in w for w in out["warnings"])
    assert abs(out["duration_seconds"] - 4) < 0.3


def test_recompose_an_article_take(env, monkeypatch):
    from pathlib import Path
    from .recompose_support import bundle, no_ai, recompose, spy_captions
    image = article_png(env.out / ".work" / "source.png")
    recording = make_line_recording(env, env.tmp / "take.mp4", 3, (640, 360), 300)
    run = write_then_render(env, monkeypatch, image, recording, "cutout", camera_backdrop="brand", camera_backdrop_color="#2040FF")
    folder, data, size = bundle(run.out)
    assert set(data["files"]) == {"presenter", "matte", "image"} and run.out["editable"]["split"] is True
    no_ai(monkeypatch)
    captions = spy_captions(monkeypatch)
    edited = recompose(Path(run.out["path"]).parent, headline="The Journal says remote workers earn less", split=0.65,
                       headline_look={"look": "black", "color": "#FFFFFF", "font": "serif"}, include_captions=True, caption_preset="boxed")
    assert edited["settings"]["split"] > run.out["editable"]["split_value"] + 0.15  # capped so tags and captions fit under it
    # The long article box now reaches down past where the brand backdrop was; the black bar is on top; their words caption it.
    assert _mean(env.ffmpeg, edited["path"], 0.2, "crop=40:20:0:0").max() < 30
    # At y=1450: the member (skin tones) under the default box; inside the article box (a gray page) after.
    low = _mean(env.ffmpeg, run.out["path"], 0.2, "crop=60:40:500:1450")
    high = _mean(env.ffmpeg, edited["path"], 0.2, "crop=60:40:500:1450")
    assert np.ptp(low) > 20 and np.ptp(high) < 6 and high.min() > 150, (low, high)
    assert captions and "remote work pays" in captions[-1][0]
    assert json.load(open(run.out["manifest_path"]))["headline"] == "The Journal says remote workers earn less"
