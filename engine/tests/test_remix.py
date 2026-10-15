"""Remix: plan validation, checks, and an offline end-to-end render with OpenRouter mocked."""

import asyncio
import json
import os
import subprocess
from types import SimpleNamespace

import pytest

from clip_engine.services import remix_service as remix
from clip_engine.services.layout_analyzer import ClipLayoutPlan, LayoutType, ShotLayout
from clip_engine.services.rendering_service import RenderingService
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord, TranscriptionResult

from .test_audit_render import FFMPEG_WITH_ASS, needs_libass


def transcript(seconds=60, music_at=None):
    """One word every 0.4 s, sentences of 10 words."""
    segments = []
    t = 0
    n = 0
    while t + 4000 <= seconds * 1000:
        words = [TranscriptWord(f"word{n + i}{'.' if i == 9 else ''}", t + i * 400, t + i * 400 + 350) for i in range(10)]
        segments.append(TranscriptSegment(t, t + 3950, " ".join(w.word for w in words), "S1", words,
                                          audio_events=["(music)"] if music_at is not None and t <= music_at < t + 4000 else []))
        t += 4000
        n += 10
    return segments


def plan_item(start, end, **over):
    item = {
        "start": start, "end": end, "moment_quote": "word0 word1", "why_this_moment": "It states the claim.",
        "stance": "disagree_correct", "headline": "This coach says you must lose weight first",
        "intro": "He says you need to drop twenty pounds before your first pull-up. That is backwards, and here is why.",
        "beats": [{"text": "Strength comes first. Your lats and grip can get stronger at any body weight.", "broll": "pull up bar"},
                  {"text": "Start with dead hangs and negatives three times a week.", "broll": "gym hanging bar"}],
        "close": "Train the pull, not the scale. That is how our clients get their first rep.",
        "proof_used": [], "self_check": {"stands_alone": True, "attacks_person": False, "invented_claims": False},
    }
    item.update(over)
    return item


class TestPlanParsing:
    def test_snaps_to_words_and_caps_length(self):
        scripts = remix.parse_plan({"remixes": [plan_item(4.1, 30)]}, transcript(), "", 3)
        assert len(scripts) == 1
        s = scripts[0]
        assert s.start_ms == 4000 and s.end_ms - s.start_ms <= remix.MAX_EXCERPT_MS

    def test_short_excerpt_is_extended_to_the_minimum(self):
        s = remix.parse_plan({"remixes": [plan_item(8.0, 8.5)]}, transcript(), "", 1)[0]
        assert s.end_ms - s.start_ms >= remix.MIN_EXCERPT_MS

    def test_drops_attacks_invented_claims_overlaps_and_junk(self):
        items = [
            plan_item(4, 8, self_check={"stands_alone": True, "attacks_person": True, "invented_claims": False}),
            plan_item(4, 8, self_check={"stands_alone": True, "attacks_person": False, "invented_claims": True}),
            plan_item(12, 16),
            plan_item(13, 17),  # overlaps the one before
            plan_item(20, 24, intro=""),
            plan_item(400, 404),  # no words there
            "junk",
        ]
        scripts = remix.parse_plan({"remixes": items}, transcript(), "", 10)
        assert [s.start_ms for s in scripts] == [12000]

    def test_count_limit_and_hashtags_stripped(self):
        items = [plan_item(4 * i, 4 * i + 3, headline="This coach says you must lose weight first #fitness") for i in range(1, 6)]
        scripts = remix.parse_plan({"remixes": items}, transcript(), "", 2)
        assert len(scripts) == 2 and "#" not in scripts[0].headline

    def test_proof_must_come_from_the_brand_identity(self):
        brand = "Our clients get their first pull-up in 6 weeks, on average, without dieting."
        good = plan_item(4, 8, proof_used=["first pull-up in 6 weeks"])
        bad = plan_item(12, 16, proof_used=["90% of clients succeed"])
        scripts = remix.parse_plan({"remixes": [good, bad]}, transcript(), brand, 5)
        assert scripts[0].proof_used == ["first pull-up in 6 weeks"] and not scripts[0].notes
        assert scripts[1].proof_used == [] and any("Brand Identity" in n for n in scripts[1].notes)


class TestChecksAndPieces:
    def test_checks_flag_long_borrowing_missing_credit_and_music(self):
        script = remix.parse_plan({"remixes": [plan_item(4, 8)]}, transcript(), "", 1)[0]
        good = {c.id: c.ok for c in remix.run_checks(script, 4000, 30000, True, False, True)}
        assert all(good.values()) and "ai_label" in good
        bad = {c.id: c.ok for c in remix.run_checks(script, 12000, 20000, False, True, False)}
        assert not bad["short_excerpt"] and not bad["take_dominates"] and not bad["credited"] and not bad["music"]

    def test_estimates_and_filters(self):
        script = remix.parse_plan({"remixes": [plan_item(4, 8)]}, transcript(), "", 1)[0]
        assert remix.estimate_remix_cost(script, "lipsync") > remix.estimate_remix_cost(script, "voice") > 0
        assert remix.estimate_remix_cost(script, "lipsync") < 1.5
        assert remix.concat_filter(2) == "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]"
        assert remix.enable_expr([(0, 1.5), (3, 4)]) == "between(t,0.000,1.500)+between(t,3.000,4.000)"
        words = remix.estimated_words("one two three.", 1000, 2000)
        assert words[0].start_time_ms == 1000 and words[-1].end_time_ms <= 2000
        assert len(remix.words_to_segments(words)) == 1
        assert remix.safe_name("A/B: test?", "x") == "AB test"

    def test_prompt_mentions_the_angle_and_rules(self):
        prompt = remix.plan_system_prompt("myth_truth", 4)
        assert "Myth vs. truth" in prompt and "up to 4" in prompt and "never attack the person" in prompt


class FakeMedia:
    def __init__(self, ffmpeg, fail_avatar=False):
        self.ffmpeg = ffmpeg
        self.fail_avatar = fail_avatar
        self.cost_usd = 0.0
        self.speech_calls = []
        self.avatar_calls = 0

    async def aclose(self):
        pass

    async def speech(self, text, out_path, voice=None, model=remix.TTS_MODEL, reference=None, transcript=""):
        self.speech_calls.append((text, voice if model == remix.TTS_MODEL else ("clone", reference[:22], transcript)))
        seconds = max(1.0, len(text.split()) / 2.6)
        subprocess.run([self.ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds:.2f}",
                        "-c:a", "libmp3lame", out_path], check=True, timeout=60)
        self.cost_usd += 0.001
        return out_path

    async def avatar_video(self, photo, audio, text, out_path):
        self.avatar_calls += 1
        if self.fail_avatar:
            raise remix.RemixError("test failure")
        subprocess.run([self.ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x3355ff:s=360x640:r=30", "-i", audio,
                        "-shortest", "-c:v", "mpeg4", "-q:v", "3", "-c:a", "aac", out_path], check=True, timeout=60)
        self.cost_usd += 0.5
        return out_path


@needs_libass
@pytest.mark.parametrize("host,fail_avatar,order", [("lipsync", False, "moment_first"), ("lipsync", True, "take_first"), ("voice", False, "moment_first")])
def test_end_to_end_remix_offline(tmp_path, monkeypatch, host, fail_avatar, order):
    ffmpeg, ffprobe = FFMPEG_WITH_ASS
    monkeypatch.setattr(remix, "SHORT_VIDEO_MAX_S", 30)  # the 40 s test video stands in for a long one
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    source = tmp_path / "source.mp4"
    subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=40:r=30", "-f", "lavfi", "-i",
                    "sine=frequency=220:duration=40", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source)],
                   check=True, timeout=120)
    photo = tmp_path / "portrait.jpg"
    subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xcc8844:s=720x1280", "-frames:v", "1", str(photo)],
                   check=True, timeout=60)

    async def plan_layout(self, request, width, height, start, duration):
        return ClipLayoutPlan([ShotLayout(0, duration, LayoutType.TALKING_HEAD)], width, height)
    monkeypatch.setattr(RenderingService, "_plan_layout", plan_layout)
    monkeypatch.setattr(RenderingService, "_video_codec_args", lambda *a: ["-c:v", "mpeg4", "-q:v", "3"])
    monkeypatch.setattr(remix, "VIDEO_ARGS", ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p", "-r", "30"])
    keep = os.environ.get("REMIX_KEEP_OUTPUT")

    class FakeTranscription:
        async def transcribe(self, video, work):
            return TranscriptionResult(segments=transcript(40, music_at=4000), full_text="")

        async def transcribe_audio(self, path):
            raise RuntimeError("offline")
    import clip_engine.services.transcription_service as ts
    monkeypatch.setattr(ts, "TranscriptionService", FakeTranscription)

    calls = []

    async def fake_chat(client, payload):
        calls.append(payload)
        if payload["response_format"]["json_schema"]["name"] == "remix_grades":
            grades = [{"id": i, "hook": 8.5 - i * 3, "payoff": 8, "stands_alone": 8, "specificity": 7, "stance": 8,
                       "verdict": "Strong open.", "fix": "Name the drill."} for i in range(2)]
            return {"choices": [{"message": {"content": json.dumps({"grades": grades})}}]}, {"cost": 0.01}
        content = json.dumps({"remixes": [plan_item(4, 8), plan_item(20, 24, headline="A second moment people argue about")]})
        return {"choices": [{"message": {"content": content}}]}, {"cost": 0.05}
    monkeypatch.setattr(remix, "chat_completion", fake_chat)

    settings = SimpleNamespace(openrouter_api_key="test", openrouter_base_url="https://example.invalid/api/v1",
                               planner_model="test/model", get_planner_fallback_models=lambda: [], pexels_api_key=None)
    media = FakeMedia(ffmpeg, fail_avatar)
    progress = []
    config = remix.RemixConfig(sources=[str(source)], output_dir=str(tmp_path / "out"), angle="myth_truth", count=2, host=host,
                               voice="sarah", avatar_photo=str(photo), creator="Coach Example", brand_name="Pull-Up Lab",
                               brand_identity="We believe strength comes before weight loss.", order=order,
                               cta_keyword="pullup" if host == "voice" else "", cta_offer="my free pull-up plan" if host == "voice" else "")
    keyword = host == "voice"
    planned = asyncio.run(remix.Remixer(config, lambda d, p: progress.append((d, p)), media=media, settings=settings).plan())
    drafts = planned["drafts"]
    assert len(drafts) == 2 and drafts[0]["style"] == "myth_truth" and drafts[0]["creator"] == "Coach Example"
    assert drafts[0]["grade"]["letter"] == "A" and drafts[1]["grade"]["letter"] == "B" and drafts[0]["grade"]["fix"]
    assert "OPENS on the borrowed moment" in calls[0]["messages"][0]["content"] if order == "moment_first" else True
    assert media.speech_calls == [] and media.avatar_calls == 0  # nothing paid for before review
    if keyword:
        assert "Comment PULLUP" in calls[0]["messages"][0]["content"]
        assert drafts[0]["close"].endswith("Comment PULLUP and I'll send you my free pull-up plan.")
        assert "Comment PULLUP" in drafts[0]["post_caption"] and drafts[0]["post_caption"].endswith("Clip: Coach Example")
    else:
        assert "Comment" not in drafts[0]["close"] and drafts[0]["post_caption"].endswith("Clip: Coach Example")
    # The user edits the first take's opening line and approves both.
    edits = [{"id": 0, "headline": drafts[0]["headline"], "intro": "Hold on. That is the biggest myth about pull-ups.",
              "beats": drafts[0]["beats"], "close": "Train the pull, not the scale.",
              "post_caption": "Stop dieting for your first pull-up.\n\n1. Strength comes first."}, {"id": 1}]
    media2 = FakeMedia(ffmpeg, fail_avatar)
    result = asyncio.run(remix.Remixer(config, lambda d, p: progress.append((d, p)), media=media2, settings=settings).render(edits))
    media = media2

    assert len(result["remixes"]) == 2
    assert media.avatar_calls == 0  # lip-sync is off until OpenRouter takes audio: the photo presents
    assert all(voice == "sarah" for _, voice in media.speech_calls)
    first = result["remixes"][0]
    assert os.path.isfile(first["path"]) and first["path"].endswith(".mp4")
    probe = json.loads(subprocess.run([ffprobe, "-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json",
                                       first["path"]], capture_output=True, check=True, text=True).stdout)
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920)
    assert any(s["codec_type"] == "audio" for s in probe["streams"])
    checks = {c["id"]: c["ok"] for c in first["checks"]}
    assert checks["credited"] and checks["short_excerpt"] and not checks["music"]
    assert "ai_label" in checks
    assert not any("photo instead" in w for w in first["warnings"])
    manifest = json.load(open(first["manifest_path"]))
    if host != "voice":
        assert manifest["presenter"]["mode"] == "still"
    assert manifest["rights_lane"] == "commentary" and manifest["source"]["creator"] == "Coach Example"
    expected = ["excerpt", "host", "beat", "beat", "host"] if order == "moment_first" else ["host", "excerpt", "beat", "beat", "host"]
    assert [p["part"] for p in manifest["timeline"]] == expected
    excerpt_part = next(p for p in manifest["timeline"] if p["part"] == "excerpt")
    assert 2.4 <= excerpt_part["seconds"] <= remix.MAX_EXCERPT_MS / 1000 + 0.3
    assert manifest["script"]["intro"] == "Hold on. That is the biggest myth about pull-ups."
    assert manifest["grade"]["edited"] is True and manifest["order"] == order
    job = json.load(open(tmp_path / "out" / "job_output.json"))
    assert len(job["clips"]) == 2 and job["clips"][0]["s3_url"].startswith("file://") and job["clips"][0]["ai_generated"] is True
    assert job["source_video_title"].startswith("Remix")
    caption = job["clips"][0]["post_caption"]
    assert caption.startswith("Stop dieting for your first pull-up.") and caption.endswith("Clip: Coach Example")
    assert manifest["post_caption"] == caption
    if keyword:
        # The edit dropped the call to action; it is put back on the close and the caption.
        assert manifest["script"]["close"] == "Train the pull, not the scale. Comment PULLUP and I'll send you my free pull-up plan."
        assert "Comment PULLUP and I'll send you my free pull-up plan." in caption and checks["cta"]
        assert manifest["call_to_action"] == {"keyword": "PULLUP", "offer": "my free pull-up plan"}
    else:
        assert "cta" not in checks and manifest["call_to_action"] is None
    assert not os.path.exists(tmp_path / "out" / ".work")
    assert progress[-1][1] >= 90
    if keep:
        import shutil
        shutil.copy(first["path"], os.path.join(keep, f"{host}-{fail_avatar}.mp4"))


class TestHardening:
    def test_invented_numbers_drop_the_plan_but_brand_and_source_numbers_pass(self):
        brand = "Our clients get their first pull-up in 6 weeks. We have helped 100 people."
        invented = plan_item(4, 8, intro="Our members lost 40 pounds in 10 days doing this, and you can too, starting today.")
        from_brand = plan_item(12, 16, intro="We have helped 100 people get their first pull-up in 6 weeks without dieting first.")
        counting = plan_item(20, 24, intro="Here are 3 things he missed about pull-ups, and the last one matters most.")
        scripts = remix.parse_plan({"remixes": [invented, from_brand, counting]}, transcript(), brand, 5)
        assert [s.start_ms for s in scripts] == [12000, 20000]
        assert remix.unsupported_numbers("I made $53,847 and 97% more", "made $53,847") == ["97%"]

    def test_quote_comes_from_the_transcript_and_short_proof_does_not_verify(self):
        item = plan_item(4, 8, moment_quote="I never said anything like this", proof_used=["10", "helped"])
        script = remix.parse_plan({"remixes": [item]}, transcript(), "We have helped 100 people", 1)[0]
        assert script.moment_quote.startswith("word10 word11") and "never said" not in script.moment_quote
        assert script.proof_used == [] and script.notes

    def test_malformed_values_drop_only_that_plan(self):
        items = [plan_item(float("inf"), 8), plan_item(1e400, 2e400), plan_item(4, 8, beats=5), plan_item(12, 16, proof_used="abc"),
                 plan_item("x", 3), plan_item(20, 24)]
        scripts = remix.parse_plan({"remixes": items}, transcript(), "", 10)
        assert [s.start_ms for s in scripts] == [12000, 20000]
        assert scripts[0].proof_used == []


def _media(handler):
    import httpx
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)
    return remix.OpenRouterMedia("key", client=client, base_url="https://openrouter.test/api/v1")


@pytest.fixture
def fast_poll(monkeypatch):
    monkeypatch.setattr(remix, "AVATAR_POLL_SECONDS", 0)


def _avatar_files(tmp_path):
    photo, audio = tmp_path / "p.jpg", tmp_path / "a.mp3"
    photo.write_bytes(b"jpg")
    audio.write_bytes(b"mp3")
    return str(photo), str(audio), str(tmp_path / "out.mp4")


class TestAvatarClient:
    def test_success_sends_photo_and_voice_and_follows_a_file_redirect(self, tmp_path, fast_poll, monkeypatch):
        import httpx
        from clip_engine import network_policy
        checked = []
        monkeypatch.setattr(network_policy, "public_source_url", lambda url: checked.append(url) or True)
        seen = {}
        polls = iter([{"status": "in_progress"}, "<html>502</html>", {"status": "completed", "usage": {"cost": 0.4}}])

        def handler(request):
            if request.method == "POST":
                seen["body"] = json.loads(request.content)
                return httpx.Response(202, json={"id": "job_1", "status": "pending"})
            if request.url.path.endswith("/content"):
                return httpx.Response(302, headers={"location": "https://cdn.test/v.mp4"})
            body = next(polls)
            return httpx.Response(200, text=body) if isinstance(body, str) else httpx.Response(200, json=body)

        Real = httpx.AsyncClient

        class Plain:
            def __init__(self, *a, **k):
                self.client = Real(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"video")))
            async def __aenter__(self):
                return self.client
            async def __aexit__(self, *a):
                await self.client.aclose()
        media = _media(handler)
        monkeypatch.setattr(remix.httpx, "AsyncClient", Plain)
        photo, audio, out = _avatar_files(tmp_path)
        asyncio.run(media.avatar_video(photo, audio, "Hello there", out))
        refs = seen["body"]["input_references"]
        assert seen["body"]["model"] == remix.AVATAR_MODEL and seen["body"]["aspect_ratio"] == "9:16"
        assert refs[0]["type"] == "image_url" and refs[1]["type"] == "input_audio"
        assert open(out, "rb").read() == b"video" and media.cost_usd == pytest.approx(0.4)

    @pytest.mark.parametrize("final", [{"status": "cancelled"}, {"status": "failed", "error": "x"}, ["not", "a", "dict"]])
    def test_terminal_and_odd_statuses_raise_a_remix_error(self, tmp_path, fast_poll, final):
        import httpx
        polls = iter([final, {"status": "failed"}])

        def handler(request):
            if request.method == "POST":
                return httpx.Response(202, json={"id": "job_2"})
            return httpx.Response(200, json=next(polls))
        photo, audio, out = _avatar_files(tmp_path)
        with pytest.raises(remix.RemixError):
            asyncio.run(_media(handler).avatar_video(photo, audio, "Hi", out))

    def test_rejected_or_unreadable_start_raises_a_remix_error(self, tmp_path):
        import httpx
        photo, audio, out = _avatar_files(tmp_path)
        for response in (httpx.Response(400, text="bad audio"), httpx.Response(202, text="<html>"), httpx.Response(202, json={"id": "../x"})):
            with pytest.raises(remix.RemixError):
                asyncio.run(_media(lambda r, resp=response: resp).avatar_video(photo, audio, "Hi", out))

    def test_speech_retries_rate_limits_then_saves(self, tmp_path, monkeypatch):
        import httpx
        replies = iter([httpx.Response(429, headers={"retry-after": "1"}), httpx.Response(200, content=b"mp3data")])
        sleeps = []

        async def no_sleep(seconds):
            sleeps.append(seconds)
        monkeypatch.setattr(remix.asyncio, "sleep", no_sleep)
        out = str(tmp_path / "v.mp3")
        sent = []

        def reply(request):
            sent.append(json.loads(request.content))
            return next(replies)
        asyncio.run(_media(reply).speech("Hello", out, voice="sarah"))
        assert open(out, "rb").read() == b"mp3data" and sleeps == [1.0]
        assert sent[-1] == {"model": "elevenlabs/eleven-v3", "input": "Hello", "response_format": "mp3", "voice": "sarah"}
        with pytest.raises(remix.RemixError, match="API key"):
            asyncio.run(_media(lambda r: httpx.Response(401)).speech("Hello", out))
        # A rejected request is reported (and its reason logged), not retried.
        with pytest.raises(remix.RemixError, match=r"generate the voice \(400\)"):
            asyncio.run(_media(lambda r: httpx.Response(400, json={"error": {"message": "voice not found"}})).speech("Hello", out))

    def test_cloned_voice_sends_the_recording_and_transcript(self, tmp_path):
        import httpx
        sent = []

        def reply(request):
            sent.append(json.loads(request.content))
            return httpx.Response(200, content=b"mp3")
        out = str(tmp_path / "v.mp3")
        asyncio.run(_media(reply).speech("Hello", out, model=remix.CLONE_TTS_MODEL, reference="data:audio/mpeg;base64,AAAA", transcript="hi there"))
        assert sent[0] == {"model": "fish-audio/s2.1-pro", "input": "Hello", "response_format": "mp3", "input_references": [
            {"type": "input_audio", "input_audio": {"data": "data:audio/mpeg;base64,AAAA"}}, {"type": "text", "text": "hi there"}]}


def test_a_failed_remix_keeps_the_ones_already_made(tmp_path, monkeypatch):
    settings = SimpleNamespace(openrouter_api_key="k", openrouter_base_url="https://x.test/api/v1", planner_model="m",
                               get_planner_fallback_models=lambda: [], pexels_api_key=None)

    class Media:
        cost_usd = 0.0

        async def aclose(self):
            pass
    config = remix.RemixConfig(sources=["https://example.com/v", "https://example.com/broken"], output_dir=str(tmp_path), host="voice", count=3)
    scripts = remix.parse_plan({"remixes": [plan_item(4, 8), plan_item(12, 16), plan_item(20, 24)]}, transcript(), "", 3)

    async def source(src, work, single):
        if src.endswith("broken"):
            raise RuntimeError("download failed")
        video = tmp_path / "v.mp4"
        video.write_bytes(b"v")
        return str(video), {"url": src, "title": "t", "creator": "c", "platform": "youtube"}

    async def transcribe(video, work, allow_silence=False):
        return transcript()

    async def plan(segments, meta):
        return scripts

    async def grade(items):
        pass

    async def one(index, total, script, *rest):
        if index == 1:
            raise OSError("disk hiccup")
        return remix.RemixResult(str(tmp_path / f"{index}.mp4"), str(tmp_path / f"{index}.json"), script.headline, script.stance, 4.0, 25.0, 0.1, [], [],
                                 clip_index=index)
    remixer = remix.Remixer(config, media=Media(), settings=settings)
    for name, fn in (("_source", source), ("_transcribe", transcribe), ("_plan", plan), ("_grade", grade)):
        monkeypatch.setattr(remixer, name, fn)
    planned = asyncio.run(remixer.plan())
    assert len(planned["drafts"]) == 3 and any("Video 2 of 2: Skipped" in w for w in planned["warnings"])
    remixer = remix.Remixer(config, media=Media(), settings=settings)
    monkeypatch.setattr(remixer, "_one", one)
    result = asyncio.run(remixer.render([{"id": 0}, {"id": 1}, {"id": 2}, {"id": 99}, "junk"]))
    assert [os.path.basename(r["path"]) for r in result["remixes"]] == ["0.mp4", "2.mp4"]
    assert any("Remix 2 could not be made" in w for w in result["warnings"])
    assert os.path.isfile(tmp_path / "job_output.json") and not os.path.exists(tmp_path / ".work")
    job = json.load(open(tmp_path / "job_output.json"))
    assert [c["clip_index"] for c in job["clips"]] == [0, 2]


def test_a_render_where_nothing_works_keeps_the_plan_for_a_retry(tmp_path, monkeypatch):
    settings = SimpleNamespace(openrouter_api_key="k", openrouter_base_url="https://x.test/api/v1", planner_model="m",
                               get_planner_fallback_models=lambda: [], pexels_api_key=None)

    class Media:
        cost_usd = 0.0

        async def aclose(self):
            pass
    config = remix.RemixConfig(sources=["https://example.com/v"], output_dir=str(tmp_path), host="voice", count=1)
    scripts = remix.parse_plan({"remixes": [plan_item(4, 8)]}, transcript(), "", 1)
    video = tmp_path / "v.mp4"
    video.write_bytes(b"v")

    async def source(src, work, single):
        return str(video), {"url": src, "title": "t", "creator": "c", "platform": "youtube"}

    async def transcribe(video, work, allow_silence=False):
        return transcript()

    async def plan(segments, meta):
        return scripts

    async def grade(items):
        pass

    async def one(*args):
        raise remix.RemixError("OpenRouter reports insufficient credits.")
    remixer = remix.Remixer(config, media=Media(), settings=settings)
    for name, fn in (("_source", source), ("_transcribe", transcribe), ("_plan", plan), ("_grade", grade)):
        monkeypatch.setattr(remixer, name, fn)
    asyncio.run(remixer.plan())
    remixer = remix.Remixer(config, media=Media(), settings=settings)
    monkeypatch.setattr(remixer, "_one", one)
    with pytest.raises(remix.RemixError, match="credits"):
        asyncio.run(remixer.render([{"id": 0}]))
    assert os.path.isfile(tmp_path / ".work" / remix.PLAN_FILE) and not os.path.exists(tmp_path / "job_output.json")


def test_numbers_in_names_and_years_are_not_flagged():
    assert remix.unsupported_numbers("In 2024 during COVID-19 he worked 24/7 on a 9-5", "") == []
    assert remix.unsupported_numbers("He made $40,000", "") == ["$40,000"]


def test_edits_keep_limits_and_flag_new_numbers():
    script = remix.parse_plan({"remixes": [plan_item(4, 8)]}, transcript(), "", 1)[0]
    script.grade = {"letter": "B"}
    edited = remix.apply_edit(script, {"intro": "I made $9,999 last week doing this one thing every single day."}, "", "")
    assert edited.intro.startswith("I made $9,999") and any("numbers" in n for n in edited.notes) and edited.grade["edited"]
    checks = {c.id: c for c in remix.run_checks(edited, 4000, 30000, True, False, True)}
    assert not checks["proof"].ok
    assert remix.apply_edit(script, {}, "", "").grade == {"letter": "B"}
    with pytest.raises(remix.RemixError):
        remix.apply_edit(script, {"headline": "Too short"}, "", "")
    assert remix.grade_letter({"hook": 9, "payoff": 9, "stands_alone": 8, "specificity": 8, "stance": 8})[0] == "A"
    assert remix.grade_letter({"hook": 3, "payoff": 9, "stands_alone": 9, "specificity": 9, "stance": 9})[0] == "C"


class TestCallToActionAndCaption:
    def test_keyword_rules(self):
        assert remix.normalize_keyword(" sales ") == "SALES" and remix.normalize_keyword("pull-up") == "PULL-UP"
        assert remix.normalize_keyword("") == "" and remix.normalize_keyword(None) == ""
        for bad in ("two words", "x", "a" * 21, "-dash", "émoji"):
            with pytest.raises(ValueError):
                remix.normalize_keyword(bad)
        assert remix.has_cta("Comment “SALES” below", "SALES") and remix.has_cta("comment sales", "SALES")
        assert not remix.has_cta("Sales measure trust", "SALES") and not remix.has_cta("Comment SALESPEOPLE", "SALES")

    def test_close_gets_the_call_to_action_once(self):
        added = remix.ensure_cta("Train the pull, not the scale", "SALES", "my playbook.")
        assert added == "Train the pull, not the scale. Comment SALES and I'll send you my playbook."
        assert remix.ensure_cta(added, "SALES", "my playbook") == added
        assert remix.ensure_cta("Done!", "SALES", "") == "Done! Comment SALES and I'll send you the full breakdown."
        assert remix.ensure_cta("Done.", "", "x") == "Done."

    def test_caption_is_kept_checked_and_finalized(self):
        item = plan_item(4, 8, post_caption="Your biggest reel made $0.\n\n\n\n1.  Views measure attention.\n2. Sales measure trust.")
        script = remix.parse_plan({"remixes": [item]}, transcript(), "", 1)[0]
        # $0 is not in the brand identity or the transcript, so the AI caption is replaced by one built from the take.
        assert script.post_caption.startswith("This coach says") and "1. Strength comes first." in script.post_caption
        brand = "My reels made $0 while low-view posts brought clients."
        script = remix.parse_plan({"remixes": [item]}, transcript(), brand, 1)[0]
        assert script.post_caption == "Your biggest reel made $0.\n\n1. Views measure attention.\n2. Sales measure trust."
        final = remix.finalize_caption(script.post_caption, "SALES", "my playbook", "Alex Hormozi")
        assert final.endswith("Comment SALES and I'll send you my playbook.\n\nClip: Alex Hormozi")
        assert remix.finalize_caption(final, "SALES", "my playbook", "Alex Hormozi") == final

    def test_edits_restore_the_cta_and_flag_caption_numbers(self):
        script = remix.parse_plan({"remixes": [plan_item(4, 8)]}, transcript(), "", 1)[0]
        edit = {"headline": script.headline, "intro": script.intro, "beats": [{"text": b.text} for b in script.beats],
                "close": "Train the pull.", "post_caption": "We got 500 clients this way."}
        edited = remix.apply_edit(script, edit, "", "", "SALES", "")
        assert edited.close == "Train the pull. Comment SALES and I'll send you the full breakdown."
        assert edited.post_caption == "We got 500 clients this way." and any("caption has numbers" in n for n in edited.notes)
        assert {c.id: c.ok for c in remix.run_checks(edited, 4000, 30000, True, False, True, "SALES")}["cta"]
        edited.close = "Train the pull."
        assert {c.id: c.ok for c in remix.run_checks(edited, 4000, 30000, True, False, True, "SALES")}["cta"] is False

    def test_prompt_carries_the_keyword(self):
        prompt = remix.plan_system_prompt("lessons", 3, "moment_first", "SALES", "my playbook")
        assert 'Comment SALES and I\'ll send you' in prompt and '"my playbook"' in prompt and "POST CAPTION" in prompt
        assert "Comment" not in remix.plan_system_prompt("lessons", 3).split("POST CAPTION")[0].split("CALL TO ACTION")[1][:80]


def test_remix_speaks_with_the_avatars_cloned_voice(tmp_path):
    reference = tmp_path / "voice.mp3"
    reference.write_bytes(b"ID3voice")
    settings = SimpleNamespace(openrouter_api_key="k", openrouter_base_url="https://x.test/api/v1", planner_model="m",
                               get_planner_fallback_models=lambda: [], pexels_api_key=None)
    config = remix.RemixConfig(output_dir=str(tmp_path / "out"), sources=["x"], host="voice", voice_model=remix.CLONE_TTS_MODEL,
                               voice_reference=str(reference), voice_transcript="hello there")
    remixer = remix.Remixer(config, media=FakeMedia("ffmpeg"), settings=settings)
    voice = remixer._voice()
    assert voice["model"] == remix.CLONE_TTS_MODEL and voice["transcript"] == "hello there"
    assert voice["reference"] == "data:audio/mpeg;base64,SUQzdm9pY2U="
    with pytest.raises(remix.RemixError, match="cloned voice"):
        remix.Remixer(remix.RemixConfig(output_dir=str(tmp_path), host="voice", voice_model=remix.CLONE_TTS_MODEL), media=FakeMedia("ffmpeg"), settings=settings)
    missing = remix.Remixer(remix.RemixConfig(output_dir=str(tmp_path), host="voice", voice_model=remix.CLONE_TTS_MODEL,
                                              voice_reference=str(tmp_path / "gone.mp3")), media=FakeMedia("ffmpeg"), settings=settings)
    with pytest.raises(remix.RemixError, match="Clone the voice again"):
        missing._voice()


@needs_libass
@pytest.mark.parametrize("look", [None, {"look": "floating", "font": "condensed"}])
def test_silent_react_end_to_end(tmp_path, monkeypatch, look):
    ffmpeg, ffprobe = FFMPEG_WITH_ASS
    monkeypatch.setattr(remix, "SHORT_VIDEO_MAX_S", 30)  # the 40 s test video stands in for a long one
    monkeypatch.setenv("PATH", os.path.dirname(ffmpeg) + os.pathsep + os.environ.get("PATH", ""))
    source = tmp_path / "source.mp4"
    subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=40:r=30", "-f", "lavfi", "-i",
                    "sine=frequency=220:duration=40", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source)], check=True, timeout=120)
    reactions = {}
    for kind, color in (("listen", "0x2266aa"), ("nod", "0x22aa66"), ("point", "0xaa6622")):
        path = tmp_path / f"{kind}.mp4"
        # A portrait-like clip: the "face" sits at about 40% of the height, like a real reaction.
        subprocess.run([ffmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={color}:s=1080x1920:d=3:r=30", "-vf",
                        "drawbox=x=390:y=568:w=300:h=400:color=0xe0b090@1:t=fill,drawbox=x=240:y=1000:w=600:h=920:color=0x223344@1:t=fill",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], check=True, timeout=60)
        reactions[kind] = str(path)
    monkeypatch.setattr(remix, "VIDEO_ARGS", ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p", "-r", "30"])
    keep = os.environ.get("REMIX_KEEP_OUTPUT")

    class FakeTranscription:
        async def transcribe(self, video, work):
            return TranscriptionResult(segments=transcript(40), full_text="")
    import clip_engine.services.transcription_service as ts
    monkeypatch.setattr(ts, "TranscriptionService", FakeTranscription)
    calls = []

    async def fake_chat(client, payload):
        calls.append(payload)
        if payload["response_format"]["json_schema"]["name"] == "remix_grades":
            return {"choices": [{"message": {"content": json.dumps({"grades": [{"id": 0, "hook": 8, "payoff": 8, "stands_alone": 8, "specificity": 7,
                                                                                  "stance": 7, "verdict": "Strong.", "fix": "Sharper headline."}]})}}]}, {"cost": 0.01}
        item = {"start": 4, "end": 20, "moment_quote": "word10 word11", "why_this_moment": "Bold claim with a payoff.",
                "headline": "This creator says your best reel probably made nothing",
                "cues": [{"at": 0, "reaction": "listen"}, {"at": 5, "reaction": "nod"}, {"at": 6, "reaction": "point"},
                         {"at": 10, "reaction": "laugh"}, {"at": 11, "reaction": "point"}],
                "post_caption": "Your most viewed reel made nothing.\n\n1. Views measure attention.\n2. Sales measure trust.",
                "proof_used": [], "self_check": {"attacks_person": False, "invented_claims": False}}
        return {"choices": [{"message": {"content": json.dumps({"remixes": [item]})}}]}, {"cost": 0.05}
    monkeypatch.setattr(remix, "chat_completion", fake_chat)
    settings = SimpleNamespace(openrouter_api_key="test", openrouter_base_url="https://example.invalid/api/v1",
                               planner_model="test/model", get_planner_fallback_models=lambda: [], pexels_api_key=None)
    config = remix.RemixConfig(sources=[str(source)], output_dir=str(tmp_path / "out"), count=1, host="voice", creator="Coach Example",
                               format="silent", reactions=reactions, reactions_ai=True, cta_keyword="SALES", cta_offer="my playbook",
                               caption_preset="vintage", headline_look=look)
    planned = asyncio.run(remix.Remixer(config, media=FakeMedia(ffmpeg), settings=settings).plan())
    draft = planned["drafts"][0]
    assert "SILENT REACTION" in calls[0]["messages"][0]["content"] and "laugh" not in calls[0]["messages"][0]["content"].split("Use only:")[1]
    assert draft["format"] == "silent" and draft["estimate_usd"] == 0.0 and draft["grade"]["letter"] in "AB"
    # Only reactions the avatar has, spaced out, starting at 0.
    assert [c["reaction"] for c in draft["cues"]] == ["listen", "nod", "point"] and draft["cues"][2]["at"] == 11
    assert 12 <= (draft["end_ms"] - draft["start_ms"]) / 1000 <= 17
    assert draft["post_caption"].endswith("Clip: Coach Example") and "Comment SALES" in draft["post_caption"]

    media = FakeMedia(ffmpeg)
    edits = [{"id": 0, "headline": "This creator says your best reel made zero sales", "post_caption": draft["post_caption"]}]
    result = asyncio.run(remix.Remixer(config, media=media, settings=settings).render(edits))
    assert media.speech_calls == [] and media.avatar_calls == 0  # nothing voiced or animated
    out = result["remixes"][0]
    probe = json.loads(subprocess.run([ffprobe, "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json",
                                       out["path"]], capture_output=True, check=True, text=True).stdout)
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920)
    assert any(s["codec_type"] == "audio" for s in probe["streams"])
    assert abs(float(probe["format"]["duration"]) - out["duration_seconds"]) < 0.5
    checks = {c["id"]: c["ok"] for c in out["checks"]}
    assert checks["permission"] and checks["credited"] and checks["cta"] and "take_dominates" not in checks
    manifest = json.load(open(out["manifest_path"]))
    assert manifest["format"] == "silent" and manifest["rights_lane"] == "permission" and manifest["headline"].endswith("zero sales")
    assert manifest["presenter"]["ai_generated"] is True and out["cost_usd"] == 0.0
    from .test_background_split import _mean
    corner = _mean(ffmpeg, out["path"], 1.0, "crop=40:20:0:0")
    # The white bar by default; floating hook text leaves the reactions showing at the top.
    assert (corner.min() > 235) if look is None else (corner.max() < 235), corner
    job = json.load(open(tmp_path / "out" / "job_output.json"))
    assert job["clips"][0]["post_caption"].startswith("Your most viewed reel")
    if keep:
        import shutil
        shutil.copy(out["path"], os.path.join(keep, "silent.mp4"))


def test_headline_reports_how_far_floating_text_reaches(tmp_path):
    from clip_engine.services.rendering_service import RenderingService
    for look, floating in ((None, False), ({"look": "black"}, False), ({"look": "floating"}, True)):
        remixer = remix.Remixer(remix.RemixConfig(output_dir=str(tmp_path), host="voice", headline_look=look), media=FakeMedia("ffmpeg"),
                                settings=SimpleNamespace(openrouter_api_key="k", openrouter_base_url="https://example.invalid", planner_model="m",
                                                         get_planner_fallback_models=lambda: [], pexels_api_key=None))
        path, bar_h, clear_h = remixer._headline(RenderingService(), "in.mp4", str(tmp_path), 0, "This creator says your best reel made zero sales")
        assert path and clear_h > 150
        assert (bar_h == 0) is floating and (floating or clear_h == bar_h)
    assert remix.Remixer(remix.RemixConfig(output_dir=str(tmp_path), host="voice", headline_look={"look": "black"}), media=FakeMedia("ffmpeg"),
                         settings=SimpleNamespace(openrouter_api_key="k", openrouter_base_url="https://example.invalid", planner_model="m",
                                                  get_planner_fallback_models=lambda: [], pexels_api_key=None))._look.pad_color == "0x0E0E0E"


def test_redirect_to_a_private_host_is_refused(monkeypatch):
    import httpx
    from clip_engine import network_policy
    monkeypatch.setattr(network_policy, "public_source_url", lambda url: False)

    def handler(request):
        return httpx.Response(302, headers={"location": "https://10.0.0.5/secret"})
    media = remix.OpenRouterMedia.__new__(remix.OpenRouterMedia)
    media._client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://example.invalid")
    with pytest.raises(remix.RemixError):
        asyncio.run(media._download("https://example.invalid/videos/x/content", "/tmp/never.mp4"))


def test_review_caption_edits_arrive_as_postCaption():
    script = remix.parse_plan({"remixes": [plan_item(4, 8)]}, transcript(), "", 1)[0]
    edit = {"headline": script.headline, "intro": script.intro, "beats": [{"text": b.text} for b in script.beats],
            "close": script.close, "postCaption": "My own caption."}
    assert remix.apply_edit(script, edit, "", "").post_caption == "My own caption."


def test_lines_fit_the_review_limits_on_a_sentence():
    long = " ".join(["Strength comes first."] + ["word"] * 40)
    assert remix.fit_words(long, 35) == "Strength comes first." or len(remix.fit_words(long, 35).split()) <= 35
    two = "One two three four five six. Seven eight nine ten eleven twelve thirteen fourteen."
    assert remix.fit_words(two, 10) == "One two three four five six."
    assert remix.fit_words("short line", 35) == "short line"


def test_other_cta_wordings_are_replaced_not_doubled():
    std = "Comment SALES and I'll send you my plan."
    for close in ("Strength comes first. Comment the word SALES and I will send you my plan.",
                  "Strength comes first. Drop SALES in the comments for my plan.",
                  "Strength comes first. Comment SALES and I'll send you my plan."):
        settled = remix.settle_cta(close, "SALES", "my plan")
        assert settled.count("SALES") == 1 and settled.startswith("Strength comes first."), settled
    assert remix.settle_cta("Sales measure trust.", "SALES", "my plan") == "Sales measure trust. " + std


def test_caption_fits_and_credit_matches_whole_names():
    body = "x " * 1100
    final = remix.finalize_caption(body, "SALES", "my playbook", "Dan")
    assert len(final) <= remix.POSTED_CAPTION_CHARS and final.endswith("Comment SALES and I'll send you my playbook.\n\nClip: Dan")
    assert remix.finalize_caption("Stop dancing around it.", "", "", "Dan").endswith("Clip: Dan")
    assert remix.finalize_caption("Dan says stop.", "", "", "Dan") == "Dan says stop."


def test_long_tags_shrink_to_fit(tmp_path):
    w, _ = remix.tag_image("Original: " + "W" * 40, str(tmp_path / "t.png"), max_w=960)
    assert w <= 960


def test_cues_follow_the_cut_start():
    cues = remix.clean_cues([{"at": 0, "reaction": "listen"}, {"at": 5, "reaction": "nod"}], 20, ("listen", "nod"), 1.5)
    assert {"at": 6.5, "reaction": "nod"} in cues and cues[0]["at"] == 0.0


def test_a_recorded_cta_replaces_the_spoken_one():
    prompt = remix.plan_system_prompt("reaction", 2, keyword="SALES", offer="my plan", cta_clip=True)
    assert "recorded call to action plays right after the close" in prompt and "Comment SALES and I'll send you" in prompt  # caption keeps it
    script = remix.parse_plan({"remixes": [plan_item(4, 8)]}, transcript(), "", 1)[0]
    edit = {"headline": script.headline, "intro": script.intro, "beats": [{"text": b.text} for b in script.beats], "close": "Train the pull."}
    # The app passes no keyword for the close when a CTA clip ends the video.
    assert remix.apply_edit(script, edit, "", "", "", "").close == "Train the pull."
    config = remix.RemixConfig(output_dir="/tmp/x", cta_clip=True, cta_keyword="SALES")
    assert config.cta_clip is True


def test_short_video_detection():
    assert remix.is_short_video(25) and remix.is_short_video(180) and not remix.is_short_video(181)
    assert not remix.is_short_video(None) and not remix.is_short_video(0) and not remix.is_short_video("x")


def test_whole_reel_prompt_and_parse():
    prompt = remix.silent_system_prompt(1, ("listen", "nod"), whole_seconds=31.5)
    assert "exactly ONE take that reacts to the WHOLE video" in prompt and "end 31.5" in prompt and "Spread 4-8 cues" in prompt
    assert "Find up to" not in prompt
    long = remix.silent_system_prompt(3, ("listen", "nod"))
    assert "Find up to 3 moments" in long and "WHOLE video" not in long
    item = {"start": 6, "end": 14, "headline": "This coach says strength beats the scale every time",
            "cues": [{"at": 0, "reaction": "listen"}, {"at": 9, "reaction": "nod"}, {"at": 27, "reaction": "nod"}],
            "post_caption": "Strength first.\n\n1. Train the pull.", "proof_used": [], "self_check": {}}
    [script] = remix.parse_silent_plan({"remixes": [item, dict(item, headline="A second take that should not be kept")]},
                                       transcript(32), "", 3, ("listen", "nod"), whole_ms=31500)
    assert (script.start_ms, script.end_ms) == (0, 31500), "the whole reel, whatever times the model gave"
    assert [c["at"] for c in script.cues] == [0.0, 9.0, 27.0], "cues across the whole reel"


def test_a_reel_gets_one_take_and_a_long_video_several(tmp_path, monkeypatch):
    """Plan only: the count and the moment follow the video's length (Silent react and voiced)."""
    import clip_engine.services.transcription_service as ts
    from clip_engine.services.transcription_service import TranscriptionResult

    class FakeTranscription:
        async def transcribe(self, video, work):
            return TranscriptionResult(segments=transcript(40), full_text="")
    monkeypatch.setattr(ts, "TranscriptionService", FakeTranscription)
    seen = []

    async def fake_chat(client, payload):
        seen.append(payload["messages"][0]["content"])
        if payload["response_format"]["json_schema"]["name"] == "remix_grades":
            return {"choices": [{"message": {"content": json.dumps({"grades": []})}}]}, {"cost": 0}
        item = {"start": 4, "end": 20, "moment_quote": "word10", "why_this_moment": "Bold.", "headline": "This creator says your best reel made nothing",
                "cues": [{"at": 0, "reaction": "listen"}, {"at": 30, "reaction": "nod"}], "post_caption": "Hook.\n\n1. Point.",
                "proof_used": [], "self_check": {}}
        return {"choices": [{"message": {"content": json.dumps({"remixes": [item, dict(item, start=22, end=38, headline="Another take on the same video here")]})}}]}, {"cost": 0.01}
    monkeypatch.setattr(remix, "chat_completion", fake_chat)
    settings = SimpleNamespace(openrouter_api_key="t", openrouter_base_url="https://example.invalid/api/v1", planner_model="m",
                               get_planner_fallback_models=lambda: [], pexels_api_key=None)
    for seconds, expected in ((38.0, 1), (600.0, 2)):
        async def source(self, src, work, single, seconds=seconds):
            return "/tmp/x.mp4", {"url": src, "title": "T", "creator": "C", "platform": "Instagram", "duration_seconds": seconds}
        monkeypatch.setattr(remix.Remixer, "_source", source)
        config = remix.RemixConfig(sources=["https://www.instagram.com/p/x/"], output_dir=str(tmp_path / f"out{seconds}"), count=3, host="voice",
                                   format="silent", reactions={"listen": "/x/listen.mp4", "nod": "/x/nod.mp4"})
        drafts = asyncio.run(remix.Remixer(config, media=FakeMedia("ffmpeg"), settings=settings).plan())["drafts"]
        assert len(drafts) == expected, (seconds, len(drafts))
        if expected == 1:
            assert (drafts[0]["start_ms"], drafts[0]["end_ms"]) == (0, 38000)
            assert "WHOLE video" in seen[-2]


def test_no_hook_text_in_remix(tmp_path):
    from clip_engine.services.rendering_service import RenderingService
    remixer = remix.Remixer(remix.RemixConfig(output_dir=str(tmp_path), host="voice", headline_look={"look": "none"}), media=FakeMedia("ffmpeg"),
                            settings=SimpleNamespace(openrouter_api_key="k", openrouter_base_url="https://example.invalid", planner_model="m",
                                                     get_planner_fallback_models=lambda: [], pexels_api_key=None))
    assert remixer._headline(RenderingService(), "in.mp4", str(tmp_path), 0, "This creator says your best reel made zero sales") == (None, 0, 0)


def test_a_wordless_reel_still_works_for_silent_react(tmp_path, monkeypatch):
    import clip_engine.services.transcription_service as ts
    from clip_engine.services.transcription_service import TranscriptionResult

    class Silent:
        async def transcribe(self, video, work):
            return TranscriptionResult(segments=[], full_text="")
    monkeypatch.setattr(ts, "TranscriptionService", Silent)
    prompts = []

    async def fake_chat(client, payload):
        prompts.append(payload["messages"][1]["content"])
        if payload["response_format"]["json_schema"]["name"] == "remix_grades":
            return {"choices": [{"message": {"content": json.dumps({"grades": []})}}]}, {"cost": 0}
        item = {"start": 0, "end": 20, "headline": "This dancer turns a kitchen into a stage", "cues": [{"at": 0, "reaction": "listen"}],
                "post_caption": "Watch till the end.", "proof_used": [], "self_check": {}}
        return {"choices": [{"message": {"content": json.dumps({"remixes": [item]})}}]}, {"cost": 0.01}
    monkeypatch.setattr(remix, "chat_completion", fake_chat)

    async def source(self, src, work, single):
        return "/tmp/x.mp4", {"url": src, "title": "Kitchen dance", "creator": "C", "platform": "Instagram", "duration_seconds": 20.0}
    monkeypatch.setattr(remix.Remixer, "_source", source)
    settings = SimpleNamespace(openrouter_api_key="t", openrouter_base_url="https://example.invalid/api/v1", planner_model="m",
                               get_planner_fallback_models=lambda: [], pexels_api_key=None)
    config = remix.RemixConfig(sources=["https://www.instagram.com/p/x/"], output_dir=str(tmp_path / "o"), host="voice", format="silent",
                               reactions={"listen": "/x/listen.mp4"})
    drafts = asyncio.run(remix.Remixer(config, media=FakeMedia("ffmpeg"), settings=settings).plan())["drafts"]
    assert len(drafts) == 1 and (drafts[0]["start_ms"], drafts[0]["end_ms"]) == (0, 20000)
    assert "no speech" in prompts[0]
    # A voiced take still needs speech.
    voiced = remix.RemixConfig(sources=["https://www.instagram.com/p/x/"], output_dir=str(tmp_path / "v"), host="voice")
    with pytest.raises(remix.RemixError, match="No speech"):
        asyncio.run(remix.Remixer(voiced, media=FakeMedia("ffmpeg"), settings=settings).plan())
