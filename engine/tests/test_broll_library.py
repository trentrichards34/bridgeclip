"""My B-roll library in the engine: the catalog, the planner's picks, AI shots and the request fields."""

import asyncio
import json
import os
import shutil
import subprocess

import httpx
import pytest

from clip_engine.services import broll_library as bl
from clip_engine.services.transcription_service import TranscriptSegment, TranscriptWord

ITEM = "l0123456789ab"


def catalog_file(tmp_path, shots, name="broll-catalog.json"):
    path = tmp_path / name
    path.write_text(json.dumps({"version": 1, "shots": shots}))
    return str(path)


def video_file(tmp_path, name="clip.mp4"):
    path = tmp_path / name
    path.write_bytes(b"not really a video")
    return str(path)


def shot(path, n=0, **extra):
    return {"id": f"{ITEM}:s{n}", "path": path, "kind": "video", "inS": 2.0, "outS": 8.0, "description": "Hands typing on a laptop at a desk",
            "tags": ["laptop", "typing", "desk"], "shotType": "hands", "me": False, "ai": False, **extra}


def segments(text, start_ms=0, step=400):
    words = [TranscriptWord(w, start_ms + i * step, start_ms + i * step + step - 50) for i, w in enumerate(text.split())]
    return [TranscriptSegment(start_ms, words[-1].end_time_ms, text, words=words)]


SETTINGS = type("S", (), {"openrouter_api_key": "k", "broll_model": "fast/model", "openrouter_base_url": "https://openrouter.ai/api/v1",
                          "get_broll_fallback_models": lambda self: []})()


class TestCatalog:
    def test_reads_valid_shots_and_drops_bad_ones(self, tmp_path):
        good = video_file(tmp_path)
        picture = tmp_path / "desk.jpg"
        picture.write_bytes(b"jpg")
        path = catalog_file(tmp_path, [
            shot(good),
            {**shot(good, 1), "path": "relative.mp4"},                      # not absolute
            {**shot(good, 2), "id": "../../etc"},                           # bad id
            {**shot(good, 3), "inS": 5, "outS": 4},                         # out before in
            {**shot(good, 4), "description": ""},                           # nothing described
            {**shot(str(tmp_path / "gone.mp4"), 5)},                        # file gone
            {**shot(good, 6), "kind": "image"},                             # an .mp4 is not a picture
            {**shot(str(picture), 7), "kind": "image", "inS": 0, "outS": 0, "shotType": "nonsense", "me": True},
            shot(good),                                                     # duplicate id
        ])
        shots = bl.load_catalog(path)
        assert [s.id for s in shots] == [f"{ITEM}:s0", f"{ITEM}:s7"]
        assert shots[0].seconds == 6.0 and shots[0].tags == ["laptop", "typing", "desk"]
        assert shots[1].kind == "image" and shots[1].shot_type == "other" and shots[1].me

    def test_a_wrong_file_or_version_is_refused(self, tmp_path):
        with pytest.raises(bl.BrollLibraryError):
            bl.load_catalog(str(tmp_path / "other.json"))
        bad = tmp_path / "broll-catalog.json"
        bad.write_text(json.dumps({"version": 2, "shots": []}))
        with pytest.raises(bl.BrollLibraryError):
            bl.load_catalog(str(bad))
        with pytest.raises(bl.BrollLibraryError):
            bl.load_catalog("relative/broll-catalog.json")

    def test_catalog_lines_are_compact(self, tmp_path):
        s = bl.parse_catalog({"version": 1, "shots": [shot(video_file(tmp_path), me=True)]})[0]
        assert s.line() == f"{ITEM}:s0 | 6.0s | hands | me | Hands typing on a laptop at a desk [laptop, typing, desk]"


def catalog(tmp_path, count=6):
    path = video_file(tmp_path)
    return {f"{ITEM}:s{n}": bl.CatalogShot(f"{ITEM}:s{n}", path, "video", 0.0, 4.0 if n else 1.0, f"shot {n}", [], "wide", False, False) for n in range(count)}


class TestNormalize:
    def test_known_shots_only_inside_the_cover_window_without_overlaps(self, tmp_path):
        cat = catalog(tmp_path)
        raw = [
            {"start": 0.5, "end": 3.0, "shot_id": f"{ITEM}:s1", "source_start": 0, "ai_prompt": ""},   # starts in the hook: moved after it
            {"start": 4.0, "end": 6.0, "shot_id": "l999999999999:s0", "source_start": 0, "ai_prompt": ""},  # unknown
            {"start": 5.0, "end": 7.5, "shot_id": f"{ITEM}:s2", "source_start": 9, "ai_prompt": ""},   # start clamped into the shot
            {"start": 7.0, "end": 9.0, "shot_id": f"{ITEM}:s3", "source_start": 0, "ai_prompt": ""},   # overlaps: trimmed
            {"start": 9.0, "end": 20.0, "shot_id": f"{ITEM}:s4", "source_start": 0, "ai_prompt": ""},  # longer than the shot: shortened
            {"start": 12.0, "end": 14.0, "shot_id": f"{ITEM}:s0", "source_start": 0, "ai_prompt": ""}, # a 1 s shot can't cover 1.5 s
        ]
        plan = bl.normalize_library_plan(raw, cat, 10_000, 30_000, 11_000)
        assert [(p.start_ms, p.end_ms, p.shot_id) for p in plan] == [
            (11_000, 13_000, f"{ITEM}:s1"), (15_000, 17_500, f"{ITEM}:s2"), (17_500, 19_000, f"{ITEM}:s3"), (19_000, 23_000, f"{ITEM}:s4")]
        assert plan[1].source_s == 1.5  # 4 s shot, 2.5 s moment: starts at most 1.5 s in

    def test_a_shot_is_used_once_unless_the_library_is_tiny(self, tmp_path):
        raw = [{"start": a, "end": a + 2, "shot_id": f"{ITEM}:s1", "source_start": 0, "ai_prompt": ""} for a in (0, 3, 6)]
        assert len(bl.normalize_library_plan(raw, catalog(tmp_path, 6), 0, 20_000, 0)) == 1
        assert len(bl.normalize_library_plan(raw, catalog(tmp_path, 2), 0, 20_000, 0)) == 3

    def test_ai_prompts_only_when_allowed_and_up_to_the_limit(self, tmp_path):
        raw = [{"start": a, "end": a + 2, "shot_id": "", "source_start": 0, "ai_prompt": "steam rising from a coffee cup"} for a in (0, 3, 6, 9)]
        assert bl.normalize_library_plan(raw, catalog(tmp_path), 0, 20_000, 0) == []
        plan = bl.normalize_library_plan(raw, catalog(tmp_path), 0, 20_000, 0, allow_ai=True, max_ai=2)
        assert [p.ai_prompt for p in plan] == ["steam rising from a coffee cup"] * 2 and all(p.shot_id is None for p in plan)

    def test_garbage_is_ignored(self, tmp_path):
        assert bl.normalize_library_plan("nope", catalog(tmp_path), 0, 9000, 0) == []
        assert bl.normalize_library_plan([None, {"start": "x"}, {"start": 1, "end": 2.2}], catalog(tmp_path), 0, 9000, 0) == []


def test_the_planner_gets_the_catalog_and_its_picks_are_checked(monkeypatch, tmp_path):
    seen = {}
    path = video_file(tmp_path)
    shots = bl.parse_catalog({"version": 1, "shots": [shot(path, 0), shot(path, 1, description="Coffee pouring into a mug", tags=["coffee"], me=True)]})

    async def fake_chat(client, payload):
        seen["payload"] = payload
        return {"choices": [{"message": {"content": json.dumps({"shots": [
            {"start": 1, "end": 3, "shot_id": f"{ITEM}:s1", "source_start": 1, "ai_prompt": ""},
            {"start": 4, "end": 6, "shot_id": "", "source_start": 0, "ai_prompt": "a sunrise over a quiet city street"},
            {"start": 6, "end": 8, "shot_id": "", "source_start": 0, "ai_prompt": "too many ai shots for this clip"},
        ]})}}], "usage": {"cost": 0.0012}}, {}

    monkeypatch.setattr(bl, "chat_completion", fake_chat)
    plan, cost = asyncio.run(bl.match_library_to_transcript(segments("every morning I pour my coffee and plan the day before the city wakes up"),
                                                            shots, 0, 9000, 500, allow_ai=True, max_ai=1, settings=SETTINGS, client=object()))
    prompt = seen["payload"]["messages"][1]["content"]
    assert f"{ITEM}:s1 | 6.0s | hands | me | Coffee pouring into a mug [coffee]" in prompt and "Cover from 0.5 s" in prompt
    assert "At most 1 AI shots" in seen["payload"]["messages"][0]["content"]
    assert [(p.start_ms, p.end_ms, p.shot_id, p.ai_prompt) for p in plan] == [
        (1000, 3000, f"{ITEM}:s1", None), (4000, 6000, None, "a sunrise over a quiet city street")]
    assert plan[0].path == path and plan[0].source_s == 3.0 and cost == 0.0012


def test_without_the_planner_shots_are_matched_by_their_words(monkeypatch, tmp_path):
    async def broken(client, payload):
        raise bl.OpenRouterError("down")

    monkeypatch.setattr(bl, "chat_completion", broken)
    path = video_file(tmp_path)
    shots = bl.parse_catalog({"version": 1, "shots": [shot(path, 0), shot(path, 1, description="Coffee pouring into a mug", tags=["coffee", "mug"])]})
    plan, cost = asyncio.run(bl.match_library_to_transcript(segments("I always start with coffee. Then the spreadsheet."), shots, 0, 8000, 0,
                                                            settings=SETTINGS, client=object()))
    assert cost == 0.0 and [p.shot_id for p in plan] == [f"{ITEM}:s1"]


def test_beats_get_the_best_matching_shot_once(tmp_path):
    path = video_file(tmp_path)
    shots = bl.parse_catalog({"version": 1, "shots": [shot(path, n, description=d, tags=t) for n, (d, t) in enumerate([
        ("Coffee pouring into a mug", ["coffee"]), ("A laptop with a spreadsheet", ["laptop", "spreadsheet"]),
        ("A city street at night", ["city", "night"]), ("Dog running on a beach", ["dog"])])]})
    picks = bl.match_beats(shots, ["morning coffee ritual", "budget spreadsheet laptop", "more coffee please", "quantum physics"])
    assert [p.description if p else None for p in picks] == ["Coffee pouring into a mug", "A laptop with a spreadsheet", None, None]


def test_shortlist_keeps_matches_and_the_member(tmp_path):
    path = video_file(tmp_path)
    many = [bl.CatalogShot(f"l{n:012x}:s0", path, "video", 0, 5, f"filler shot {n}", [], "wide", n % 50 == 0, False) for n in range(400)]
    many.append(bl.CatalogShot("lffffffffffff:s0", path, "video", 0, 5, "golden retriever puppy", ["dog"], "close", False, False))
    picked = bl.shortlist(many, "my puppy is a golden retriever", limit=40)
    assert len(picked) == 40 and picked[0].id == "lffffffffffff:s0"
    assert sum(1 for s in picked if s.me) == 8


class TestAiShots:
    AI = bl.AiSettings(kind="video", model="x-ai/grok-imagine-video-1.5-lite", max_shots=2, seconds=5, per_second_usd=0.02)

    def test_requests_are_vertical_silent_and_carry_the_rules(self):
        maker = bl.AiShotMaker(SETTINGS, self.AI, client=object())
        body = maker.video_request("A cup of coffee on a desk")
        assert body["model"] == "x-ai/grok-imagine-video-1.5-lite" and body["aspect_ratio"] == "9:16" and body["duration"] == 5
        assert body["generate_audio"] is False and body["resolution"] == "720p"
        assert body["prompt"].startswith("A cup of coffee on a desk. ") and "No text" in body["prompt"] and "no logos" in body["prompt"]
        assert maker.image_request("x")["aspect_ratio"] == "9:16"

    def test_a_video_job_is_started_polled_downloaded_and_its_cost_kept(self, tmp_path):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append((request.method, request.url.path))
            if request.method == "POST":
                assert json.loads(request.content)["generate_audio"] is False
                return httpx.Response(202, json={"id": "job_1", "status": "queued"})
            if request.url.path.endswith("/content"):
                return httpx.Response(200, content=b"\x00\x00\x00\x18ftypmp42video")
            return httpx.Response(200, json={"id": "job_1", "status": "completed", "usage": {"cost": 0.1}})

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                maker = bl.AiShotMaker(SETTINGS, self.AI, client=client, poll_seconds=0)
                out = str(tmp_path / "ai.mp4")
                await maker.make("coffee", out)
                return maker.cost_usd, out

        cost, out = asyncio.run(run())
        assert cost == 0.1 and os.path.getsize(out) > 0
        assert calls == [("POST", "/api/v1/videos"), ("GET", "/api/v1/videos/job_1"), ("GET", "/api/v1/videos/job_1/content")]

    def test_a_rejected_key_is_a_plain_error(self, tmp_path):
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401))) as client:
                await bl.AiShotMaker(SETTINGS, self.AI, client=client).make("coffee", str(tmp_path / "x.mp4"))

        with pytest.raises(bl.BrollLibraryError, match="API key"):
            asyncio.run(run())

    def test_ai_shots_are_handed_to_the_library_with_their_details_last(self, tmp_path):
        made = tmp_path / "made.mp4"
        made.write_bytes(b"video")
        incoming = tmp_path / "incoming"
        incoming.mkdir()
        target = bl.save_for_library(str(made), "a sunrise over a city", "x-ai/grok-imagine-video-1.5-lite", str(incoming))
        assert target and os.path.basename(target).startswith("ai-") and target.endswith(".mp4")
        details = json.loads(open(target[:-4] + ".json").read())
        assert details == {"prompt": "a sunrise over a city", "model": "x-ai/grok-imagine-video-1.5-lite"}
        assert sorted(os.listdir(incoming)) == sorted([os.path.basename(target), os.path.basename(target)[:-4] + ".json"])


class TestRequestFields:
    def test_sources_and_their_fields_are_checked(self, tmp_path):
        good = catalog_file(tmp_path, [shot(video_file(tmp_path))])
        ai = {"kind": "video", "model": "x-ai/grok-imagine-video-1.5-lite", "max_shots": 2, "seconds": 5, "per_second_usd": 0.02, "image_usd": 0.08}
        folder = tmp_path / "incoming"
        folder.mkdir()
        bl.validate_broll_config({})
        bl.validate_broll_config({"broll_enabled": True, "broll_source": "library", "broll_catalog_path": good})
        bl.validate_broll_config({"broll_enabled": True, "broll_source": "library_ai", "broll_catalog_path": good, "broll_ai": ai, "broll_ai_dir": str(folder)})
        bl.validate_broll_config({"broll_enabled": True, "broll_source": "ai", "broll_ai": ai, "broll_ai_dir": str(folder)})
        bl.validate_broll_config({"broll_enabled": True, "broll_source": "stock"})
        for bad in (
            {"broll_enabled": True, "broll_source": "giphy"},
            {"broll_source": "stock"},                                                    # b-roll off
            {"broll_enabled": True, "broll_catalog_path": good},                          # no source
            {"broll_enabled": True, "broll_source": "library"},                           # no catalog
            {"broll_enabled": True, "broll_source": "stock", "broll_catalog_path": good},
            {"broll_enabled": True, "broll_source": "ai", "broll_ai": {**ai, "max_shots": 9}, "broll_ai_dir": str(folder)},
            {"broll_enabled": True, "broll_source": "ai", "broll_ai": {**ai, "model": "../evil"}, "broll_ai_dir": str(folder)},
            {"broll_enabled": True, "broll_source": "ai", "broll_ai": ai, "broll_ai_dir": "relative"},
        ):
            with pytest.raises(ValueError):
                bl.validate_broll_config(bad)

    def test_the_bridge_passes_the_fields_to_the_pipeline_request(self, tmp_path):
        import bridge_runner
        source = tmp_path / "talk.mp4"
        source.write_bytes(b"x")
        good = catalog_file(tmp_path, [shot(video_file(tmp_path))])
        config = {"contract_version": 3, "job_id": "job1", "video_url": str(source), "layout_vision_enabled": False,
                  "broll_enabled": True, "broll_keep_hook": True, "broll_source": "library", "broll_catalog_path": good}
        bridge_runner.validate_config(config)
        with pytest.raises(ValueError):
            bridge_runner.validate_config({**config, "broll_source": "elsewhere"})


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")
def test_a_library_shot_is_conformed_to_the_frame_without_sound(tmp_path):
    source = str(tmp_path / "wide.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=6", "-f", "lavfi", "-i", "sine=duration=6",
                    "-shortest", "-c:v", "mpeg4", "-c:a", "aac", source], check=True)
    out = bl.conform_shot(source, "video", 2.0, 2.5, str(tmp_path / "out.mp4"), 360, 640)
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", out],
                                      capture_output=True, check=True).stdout)
    assert [s["codec_type"] for s in probe["streams"]] == ["video"]
    assert (probe["streams"][0]["width"], probe["streams"][0]["height"]) == (360, 640)
    assert 2.3 <= float(probe["format"]["duration"]) <= 2.7


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")
def test_a_finished_reel_gets_library_broll_in_place_and_keeps_its_sound(monkeypatch, tmp_path):
    base = str(tmp_path / "base.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=360x640:r=30:d=8", "-f", "lavfi", "-i", "sine=duration=8",
                    "-shortest", "-c:v", "mpeg4", "-q:v", "3", "-c:a", "aac", base], check=True)
    red = str(tmp_path / "red.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=6", "-c:v", "mpeg4", "-q:v", "3", red], check=True)
    path = catalog_file(tmp_path, [shot(red, 0, inS=0.0, outS=6.0, description="A red wall", tags=["red"])])

    async def fake_chat(client, payload):
        return {"choices": [{"message": {"content": json.dumps({"shots": [
            {"start": 1, "end": 3, "shot_id": f"{ITEM}:s0", "source_start": 0, "ai_prompt": ""},   # all in the hook: left out
            {"start": 4, "end": 6, "shot_id": f"{ITEM}:s0", "source_start": 0, "ai_prompt": ""},
        ]})}}], "usage": {"cost": 0.002}}, {}

    monkeypatch.setattr(bl, "chat_completion", fake_chat)
    monkeypatch.setattr(bl, "_client", lambda settings, title: type("C", (), {"aclose": staticmethod(lambda: asyncio.sleep(0))})())
    timed = [[w, 500 + i * 600, 1000 + i * 600, i] for i, w in enumerate("I paint every wall in my house red because red is bold".split())]
    warnings: list[str] = []
    cost = asyncio.run(bl.overlay_reel_broll(base, timed, 8.0, {"broll_source": "library", "broll_catalog_path": path}, str(tmp_path / "work"), warnings,
                                             settings=SETTINGS, width=360, height=640))
    assert cost == 0.002 and warnings == []
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", base], capture_output=True, check=True).stdout)
    assert sorted(s["codec_type"] for s in probe["streams"]) == ["audio", "video"]

    def pixel(at):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(at), "-i", base, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                             capture_output=True, check=True).stdout
        return tuple(raw[:3])

    assert pixel(1.5)[0] < 60, "the hook shows the speaker"
    assert pixel(3.5)[0] < 60, "a pick inside the hook is left out"
    assert pixel(5.0)[0] > 180, "b-roll where it matches, after the hook"
    assert pixel(7.0)[0] < 60, "the last moments show the speaker"


def test_edit_requests_carry_the_broll_fields(tmp_path):
    import edit_runner
    good = catalog_file(tmp_path, [shot(video_file(tmp_path))])
    source = video_file(tmp_path, "take.mp4")
    raw = {"mode": "render", "output_dir": str(tmp_path), "sources": [source], "words": [["hello", 0, 400, 0], ["there", 400, 800, 0], ["friend", 800, 1200, 0]],
           "keep": [True, True, True], "hook": None, "cta": None, "popups": [], "sounds": [], "headline": "", "include_captions": True, "caption_preset": "pop",
           "broll_source": "library", "broll_catalog_path": good}
    parsed = edit_runner.parse_request(raw)
    assert parsed["broll_source"] == "library" and parsed["broll_catalog_path"] == good
    with pytest.raises(ValueError):
        edit_runner.parse_request({**raw, "broll_source": "library", "broll_catalog_path": None})
    assert "broll_source" not in edit_runner.parse_request({k: v for k, v in raw.items() if not k.startswith("broll")})


class _Maker:
    """A stand-in AI maker: each call takes the next outcome (a cost, or an error to raise)."""

    def __init__(self, outcomes):
        self.ai = bl.AiSettings(kind="video", model="x-ai/grok-imagine-video-1.5-lite", max_shots=4, seconds=5, per_second_usd=0.02)
        self.outcomes = list(outcomes)
        self.cost_usd = 0.0
        self.calls = 0

    async def make(self, prompt, out):
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        self.cost_usd += outcome
        with open(out, "wb") as handle:
            handle.write(b"video")
        return out


def _ai_plan(n):
    return [bl.PlannedShot(3000 + k * 2000, 4500 + k * 2000, ai_prompt=f"a cup of coffee number {k}") for k in range(n)]


def test_a_rejected_key_mid_clip_keeps_the_cost_of_shots_already_made(monkeypatch, tmp_path):
    monkeypatch.setattr(bl, "conform_shot", lambda source, kind, s, seconds, out, w, h: shutil.copyfile(source, out) and out)
    maker = _Maker([0.1, bl.BrollLibraryError("OpenRouter rejected the API key. Check it in Settings."), 0.1])
    made = asyncio.run(bl.make_shots(_ai_plan(3), {}, str(tmp_path / "w"), 1080, 1920, maker=maker))
    assert made.ai_made == 1 and maker.calls == 2, "no more AI shots after the key is rejected"
    assert made.cost_usd == pytest.approx(0.1), "the shot already paid for is still counted"
    assert any("API key" in w for w in made.warnings)


def test_a_dropped_download_loses_one_shot_not_the_costs(monkeypatch, tmp_path):
    monkeypatch.setattr(bl, "conform_shot", lambda source, kind, s, seconds, out, w, h: shutil.copyfile(source, out) and out)
    maker = _Maker([0.1, httpx.ReadError("connection reset"), OSError("disk full"), 0.2])
    made = asyncio.run(bl.make_shots(_ai_plan(4), {}, str(tmp_path / "w"), 1080, 1920, maker=maker))
    assert made.ai_made == 2 and len(made.shots) == 2
    assert made.cost_usd == pytest.approx(0.3)
