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

    async def speech(self, text, voice, instructions, out_path):
        self.speech_calls.append((text, voice))
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
@pytest.mark.parametrize("host,fail_avatar", [("lipsync", False), ("lipsync", True), ("voice", False)])
def test_end_to_end_remix_offline(tmp_path, monkeypatch, host, fail_avatar):
    ffmpeg, ffprobe = FFMPEG_WITH_ASS
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

    async def fake_chat(client, payload):
        content = json.dumps({"remixes": [plan_item(4, 8), plan_item(20, 24, headline="A second moment people argue about")]})
        return {"choices": [{"message": {"content": content}}]}, {"cost": 0.05}
    monkeypatch.setattr(remix, "chat_completion", fake_chat)

    settings = SimpleNamespace(openrouter_api_key="test", openrouter_base_url="https://example.invalid/api/v1",
                               planner_model="test/model", get_planner_fallback_models=lambda: [], pexels_api_key=None)
    media = FakeMedia(ffmpeg, fail_avatar)
    progress = []
    config = remix.RemixConfig(source=str(source), output_dir=str(tmp_path / "out"), angle="myth_truth", count=2, host=host,
                               voice="nova", avatar_photo=str(photo), creator="Coach Example", brand_name="Pull-Up Lab",
                               brand_identity="We believe strength comes before weight loss.")
    result = asyncio.run(remix.Remixer(config, lambda d, p: progress.append((d, p)), media=media, settings=settings).run())

    assert len(result["remixes"]) == 2
    assert media.avatar_calls == (4 if host == "lipsync" else 0)
    assert all(voice == "nova" for _, voice in media.speech_calls)
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
    if fail_avatar:
        assert any("photo instead" in w for w in first["warnings"])
    manifest = json.load(open(first["manifest_path"]))
    assert manifest["rights_lane"] == "commentary" and manifest["source"]["creator"] == "Coach Example"
    assert [p["part"] for p in manifest["timeline"]] == ["host", "excerpt", "beat", "beat", "host"]
    assert 2.4 <= manifest["timeline"][1]["seconds"] <= remix.MAX_EXCERPT_MS / 1000 + 0.3
    assert not os.path.exists(tmp_path / "out" / ".work")
    assert progress[-1][1] >= 90
    if keep:
        import shutil
        shutil.copy(first["path"], os.path.join(keep, f"{host}-{fail_avatar}.mp4"))
