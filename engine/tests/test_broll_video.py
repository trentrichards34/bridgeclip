"""B-roll video: the timeline builder (slots on word boundaries that cover the whole voiceover, shots matched to what
is said, reuse rules, AI gap fill capped), the planner's answer checked, graphics only from words said, the pieces
and the assembled video exact to the frame, the editor project valid for the clip editor, and the runner's checks."""

import asyncio
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from clip_engine.services import broll_video as bv
from clip_engine.services.broll_library import CatalogShot

ROOT = Path(__file__).resolve().parents[2]


def say(text, start=0, step=320, gaps=None):
    """Words of `text` from `start` ms, `step` apart; `gaps` adds a pause after the word at that index (ms)."""
    out, t = [], start
    for i, word in enumerate(text.split()):
        out.append(bv.Word(word, t, t + step - 40))
        t += step + (gaps or {}).get(i, 0)
    return out


def shot(n, description, tags=(), seconds=6.0, me=False, kind="video", item=None):
    item = item or f"l{n:012x}"
    return CatalogShot(f"{item}:s{n % 10}", f"/lib/{item}.mp4" if kind == "video" else f"/lib/{item}.jpg", kind, 0.0,
                       seconds if kind == "video" else 0.0, description, list(tags), "medium", me, False)


SCRIPT = ("I filmed my morning routine today. First the coffee, then the laptop and my notes. "
          "Most people skip planning, but planning is what makes the day work. Here is my dashboard, and it shows 8,188 views. "
          "So write your plan tonight, and follow me for more.")


def timeline(gaps=None):
    words = say(SCRIPT, 200, 330, gaps)
    return words, words[-1].end_ms + 400


# ---------------------------------------------------------------------------
# Slots
# ---------------------------------------------------------------------------

def test_slots_cover_the_whole_voiceover_with_no_gaps_or_overlaps():
    words, total = timeline()
    slots = bv.speech_slots(words, total)
    assert slots[0].start_ms == 0 and slots[-1].end_ms == total
    for a, b in zip(slots, slots[1:]):
        assert a.end_ms == b.start_ms
    assert all(bv.MIN_SLOT_MS <= s.length_ms <= bv.MAX_SLOT_MS for s in slots), [s.length_ms for s in slots]
    assert [s.index for s in slots] == list(range(len(slots)))


def test_cuts_land_between_words_and_prefer_sentence_ends():
    words, total = timeline()
    slots = bv.speech_slots(words, total)
    for s in slots[1:]:
        # Never inside a word.
        assert not any(w.start_ms < s.start_ms < w.end_ms for w in words), s.start_ms
    ends = {w.end_ms for w in words if w.text[-1] in ".!?,"}
    # Most cuts follow a sentence's end or a comma (within the cut lead).
    after_phrase = sum(1 for s in slots[1:] if any(0 <= s.start_ms - e <= 330 for e in ends))
    assert after_phrase >= len(slots[1:]) * 0.6, (after_phrase, len(slots) - 1)
    # Every word is said in exactly one slot.
    said = " ".join(s.text for s in slots)
    assert said.split() == [w.text for w in words]


def test_pauses_beat_plain_word_boundaries():
    words = say("one two three four five six seven eight nine ten eleven twelve", 0, 330, {6: 500})
    total = words[-1].end_ms + 300
    slots = bv.speech_slots(words, total)
    pause_cut = words[7].start_ms - bv.CUT_LEAD_MS
    assert any(abs(s.start_ms - pause_cut) <= 1 for s in slots[1:]), [s.start_ms for s in slots]


def test_long_silence_gets_cuts_of_its_own_and_a_short_voiceover_one_slot():
    words = say("hello there", 0) + say("and we are back", 12000)
    total = words[-1].end_ms + 200
    slots = bv.speech_slots(words, total)
    assert slots[-1].end_ms == total and all(s.length_ms <= bv.MAX_SLOT_MS for s in slots)
    short = bv.speech_slots(say("hi there"), 2000)
    assert [(s.start_ms, s.end_ms) for s in short] == [(0, 2000)]


def test_words_are_checked_and_sorted():
    words = bv.parse_words([["b", 500, 700], ["a", 100, 520], ["", 1, 2], ["x", "1", 2], ["late", 9000, 9100], [3, 1, 2]], 5000)
    assert [(w.text, w.start_ms, w.end_ms) for w in words] == [("a", 100, 500), ("b", 500, 700)]


# ---------------------------------------------------------------------------
# Shots
# ---------------------------------------------------------------------------

LIBRARY = [
    shot(1, "Steam rising from a coffee mug on a kitchen counter", ["coffee", "kitchen", "morning"]),
    shot(2, "Hands typing on a laptop keyboard at a desk", ["laptop", "typing", "desk"]),
    shot(3, "A paper notebook with handwritten notes and a pen", ["notes", "notebook", "planning"]),
    shot(4, "The creator talking to the camera in a home office", ["talking", "office"], me=True),
    shot(5, "An analytics dashboard on a monitor showing views", ["dashboard", "views", "analytics", "screen"]),
    shot(6, "A city street at sunrise", ["street", "city", "sunrise"]),
    shot(7, "A calendar on the wall with plans written in", ["calendar", "plan", "tonight"]),
    shot(8, "A phone showing a social media profile with a follow button", ["phone", "follow", "social"]),
    shot(9, "Sunlight through a window onto a plant", ["window", "plant", "light"]),
    shot(10, "Walking outside with a backpack", ["walking", "outside"], me=True),
    shot(11, "A whiteboard with arrows and boxes", ["whiteboard", "plan"]),
    shot(12, "Close up of a keyboard and a mouse", ["keyboard", "mouse"]),
]


def test_every_slot_gets_a_shot_matched_to_what_is_said_with_no_repeats():
    words, total = timeline()
    slots = bv.speech_slots(words, total)
    shots = bv.assign_shots(slots, LIBRARY)
    bv.check_timeline(slots, shots, total)
    ids = [s.shot_id for s in shots]
    assert len(set(ids)) == len(ids), ids
    by_text = {s.words: s.shot_id for s in shots}
    # The dashboard line shows the dashboard; the coffee line the coffee.
    assert any("dashboard" in text and sid == LIBRARY[4].id for text, sid in by_text.items()), by_text
    # The coffee shot goes with the morning routine and the coffee (its own line or the one before).
    at = next(k for k, s in enumerate(shots) if s.shot_id == LIBRARY[0].id)
    assert any("coffee" in shots[k].words for k in (at, at + 1)), by_text
    assert any("notes" in text and sid in (LIBRARY[1].id, LIBRARY[2].id) for text, sid in by_text.items()), by_text


def test_personal_lines_prefer_shots_of_the_member():
    slot = bv.Slot(0, 0, 2500, "I love my mornings")
    me, other = shot(1, "A person at a desk", me=True), shot(2, "A person at a desk")
    assert bv.match_score(me, slot) > bv.match_score(other, slot)


def test_a_small_library_is_reused_but_never_twice_in_a_row_and_from_a_later_part():
    words, total = timeline()
    slots = bv.speech_slots(words, total)
    small = [shot(1, "coffee mug", ["coffee"], seconds=12), shot(2, "laptop desk", ["laptop"], seconds=12), shot(3, "notes", ["notes"], seconds=12)]
    shots = bv.assign_shots(slots, small)
    bv.check_timeline(slots, shots, total)
    ids = [s.shot_id for s in shots]
    assert all(a != b for a, b in zip(ids, ids[1:])), ids
    assert set(ids) == {s.id for s in small}
    first = {}
    for s in shots:
        if s.shot_id in first:
            assert s.reused and s.source_s != first[s.shot_id], (s.shot_id, s.source_s)
        else:
            first[s.shot_id] = s.source_s


def test_a_big_enough_library_is_never_reused_even_when_matches_repeat():
    slots = [bv.Slot(k, k * 2500, (k + 1) * 2500, "coffee coffee") for k in range(4)]
    lib = [shot(1, "coffee mug", ["coffee"]), shot(2, "a desk"), shot(3, "a window"), shot(4, "a plant"), shot(5, "a street")]
    shots = bv.assign_shots(slots, lib)
    assert len({s.shot_id for s in shots}) == 4


def test_short_shots_are_slowed_a_little_or_skipped():
    assert bv.shot_speed(shot(1, "x", seconds=3.0), 2500) == 1.0
    assert bv.shot_speed(shot(1, "x", seconds=2.0), 2500) == 0.8
    assert bv.shot_speed(shot(1, "x", seconds=1.0), 2500) is None
    assert bv.shot_speed(shot(1, "x", kind="image"), 4000) == 1.0


def test_ai_fills_gaps_only_where_nothing_matches_and_is_capped():
    slots = [bv.Slot(k, k * 2500, (k + 1) * 2500, text) for k, text in enumerate(["coffee time", "a rocket launch", "deep ocean fish", "volcano lava"])]
    lib = [shot(1, "coffee mug", ["coffee"]), shot(2, "a desk"), shot(3, "a window"), shot(4, "a plant")]
    picks = {1: {"shot_id": None, "source_start": None, "ai_prompt": "A rocket lifting off at dawn"},
             2: {"shot_id": None, "source_start": None, "ai_prompt": "Fish swimming in deep blue water"},
             3: {"shot_id": None, "source_start": None, "ai_prompt": "Glowing lava flowing at night"}}
    shots = bv.assign_shots(slots, lib, picks, allow_ai=True, max_ai=2)
    bv.check_timeline(slots, shots, 10000)
    assert [bool(s.ai_prompt) for s in shots] == [False, True, True, False]
    assert shots[0].shot_id == lib[0].id
    # AI off: the prompts are ignored and the library fills everything.
    shots = bv.assign_shots(slots, lib, picks, allow_ai=False)
    assert not any(s.ai_prompt for s in shots) and all(s.shot_id for s in shots)


def test_the_planners_answer_is_checked():
    slots = [bv.Slot(k, k * 2500, (k + 1) * 2500, "x") for k in range(3)]
    raw = {"slots": [{"slot": 0, "shot_id": LIBRARY[1].id, "source_start": 1.5, "ai_prompt": ""},
                     {"slot": 0, "shot_id": LIBRARY[2].id, "source_start": 0, "ai_prompt": ""},
                     {"slot": 1, "shot_id": "l999999999999:s1", "source_start": 0, "ai_prompt": "A red balloon in the sky"},
                     {"slot": 9, "shot_id": LIBRARY[3].id}, {"slot": "2"}, "junk"], "graphics": []}
    picks = bv.parse_plan(raw, slots, LIBRARY)
    assert picks == {0: {"shot_id": LIBRARY[1].id, "source_start": 1.5, "ai_prompt": ""},
                     1: {"shot_id": None, "source_start": 0.0, "ai_prompt": "A red balloon in the sky"}}
    shots = bv.assign_shots(slots, LIBRARY, picks)
    assert shots[0].shot_id == LIBRARY[1].id and shots[0].source_s == 1.5
    assert all(s.shot_id for s in shots)


def test_planner_is_one_call_with_the_slots_and_shots_and_its_cost(monkeypatch):
    seen = {}

    async def fake(client, payload):
        seen["payload"] = payload
        return {"choices": [{"message": {"content": json.dumps({"slots": [{"slot": 0, "shot_id": LIBRARY[0].id, "source_start": 0, "ai_prompt": ""}],
                                                                "graphics": [{"template": "stat", "time": 0.4, "seconds": 3}]})}}],
                "usage": {"cost": 0.004}}, {}

    monkeypatch.setattr(bv, "chat_completion", fake)

    class S:
        openrouter_api_key = "sk-test"
        openrouter_base_url = "https://example.invalid/api/v1"
        broll_model = "google/gemini-3.8-flash"

        def get_broll_fallback_models(self):
            return []

    slots = [bv.Slot(0, 0, 2500, "coffee first")]
    picks, graphics, cost = asyncio.run(bv.plan_with_model(slots, LIBRARY, False, 0, True, {}, S()))
    assert picks[0]["shot_id"] == LIBRARY[0].id and cost == 0.004 and graphics[0]["template"] == "stat"
    user = seen["payload"]["messages"][1]["content"]
    assert "0 | 0.00-2.50 | coffee first" in user and LIBRARY[0].id in user
    assert "Never write ai_prompt" in seen["payload"]["messages"][0]["content"]
    # No key: no call, nothing paid.
    S.openrouter_api_key = ""
    assert asyncio.run(bv.plan_with_model(slots, LIBRARY, False, 0, True, {}, S())) == ({}, [], 0.0)


# ---------------------------------------------------------------------------
# Graphics
# ---------------------------------------------------------------------------

def test_graphics_only_from_words_said():
    words, total = timeline()
    segments = bv.timed_segments(words)
    stats = bv.spoken_numbers(words)
    assert stats and stats[0]["fields"] == {"value": "8,188", "label": "views"}
    kept = bv.fit_graphics(stats, segments, total, {"headline_off": True, "stage": False}, from_planner=False)
    assert kept and kept[0]["template"] == "stat" and kept[0]["origin"] == "auto" and kept[0]["size"] != "stage"
    made_up = [{"template": "stat", "time": 3.0, "seconds": 3, "value": "$50,000", "label": "in sales", "placement": "middle"}]
    assert bv.fit_graphics(made_up, segments, total, {"headline_off": True}) == []


def test_caption_lines_break_at_sentences_and_pauses():
    words = say("Hello there. This is a test of lines", 0, 300, {4: 900})
    segments = bv.timed_segments(words)
    assert [s.text for s in segments] == ["Hello there.", "This is a", "test of lines"]


# ---------------------------------------------------------------------------
# Making it (FFmpeg)
# ---------------------------------------------------------------------------

ffmpeg = shutil.which("ffmpeg")
needs_ffmpeg = pytest.mark.skipif(not ffmpeg, reason="needs FFmpeg")


def make_clip(path, color, seconds=4, size="640x360"):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={color}:s={size}:r=30:d={seconds}",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", path], check=True)


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_entries", "stream=codec_type,width,height,nb_read_frames,duration",
                          "-of", "json", path], capture_output=True, check=True).stdout
    return json.loads(out)["streams"]


@needs_ffmpeg
@pytest.mark.parametrize("fade", [False, True])
def test_pieces_and_video_are_exact_to_the_frame(tmp_path, fade):
    clips = []
    for k, color in enumerate(["red", "green", "blue"]):
        p = str(tmp_path / f"c{k}.mp4")
        make_clip(p, color)
        clips.append(p)
    voice = str(tmp_path / "voice.m4a")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=300:d=6.2", "-c:a", "aac", voice], check=True)
    shots = [bv.TimelineShot(0, 0, 2100, "a", path=clips[0]), bv.TimelineShot(1, 2100, 4000, "b", path=clips[1], speed=0.8),
             bv.TimelineShot(2, 4000, 6200, "c", path=clips[2])]
    edges = bv.frame_edges(shots)
    assert edges == [0, 63, 120, 186]
    pieces = []
    for k, s in enumerate(shots):
        out = str(tmp_path / f"p{k}.mp4")
        bv.conform_piece(s.path, "video", 0.0, bv.piece_frames(edges, k, fade), s.speed, out, 270, 480)
        pieces.append(out)
        assert int(probe(out)[0]["nb_read_frames"]) == bv.piece_frames(edges, k, fade)
    out = str(tmp_path / "video.mp4")
    bv.assemble(pieces, voice, 6200, out, fade, edges)
    streams = {s["codec_type"]: s for s in probe(out)}
    assert (streams["video"]["width"], streams["video"]["height"]) == (270, 480)
    assert abs(int(streams["video"]["nb_read_frames"]) - 186) <= 1
    assert abs(float(streams["audio"]["duration"]) - 6.2) < 0.06
    # The picture at each slot's middle is that slot's clip (cover-cropped, no black bars).
    for k, (rgb, at) in enumerate([((255, 0, 0), 1.0), ((0, 128, 0), 3.0), ((0, 0, 255), 5.0)]):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(at), "-i", out, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                             capture_output=True, check=True).stdout
        assert all(abs(a - b) < 40 for a, b in zip(raw, rgb)), (k, list(raw))


def test_editor_project_is_one_ready_clip_the_editor_accepts():
    words, total = timeline()
    segments = bv.timed_segments(words)
    hook = {"text": "My morning plan", "look": {"look": "floating", "color": "#FFFFFF", "font": "clean", "textBg": "dark", "hideAfterS": 5}}
    graphics = bv.fit_graphics(bv.spoken_numbers(words), segments, total, {"headline_off": False}, from_planner=False)
    project = bv.editor_project("My morning plan", total, 1080, 1920, segments, {"captions": True, "caption_preset": "pop", "hook": hook, "cta_id": None},
                                graphics, "a" * 32)
    c = project["candidates"][0]
    assert project["aspect_ratio"] == "9:16" and project["preview_id"] == "a" * 32 and project["duration_ms"] == total
    assert c["status"] == "ready" and c["ranges"] == [[0, total]] and c["hook"] == hook and c["graphics"] == graphics
    assert c["scenes"] == [{"at_ms": 0, "layout": "fill", "crops": [[0, 0.0, 1, 1]]}]
    assert len(project["transcript"]) == len(segments)
    # The app's own parser reads it (src/shared/clip-editor.ts parseEditorProject) in the TS tests; the engine's here.
    from clip_engine.services.manual_editor import validate_candidate
    validate_candidate(c, total, len(segments))
    wide = bv.editor_project("x", total, 1920, 1080, segments, {"captions": True, "caption_preset": "pop", "hook": hook}, [], "b" * 32)
    assert wide["aspect_ratio"] == "16:9" and wide["candidates"][0]["hook"] is None


# ---------------------------------------------------------------------------
# The runner's checks
# ---------------------------------------------------------------------------

def runner():
    sys.path.insert(0, str(ROOT / "bridge"))
    import broll_video_runner
    return broll_video_runner


def good_request(tmp_path):
    run = tmp_path / "broll-video-12345678-1234-1234-1234-123456789abc"
    (run / ".broll-video").mkdir(parents=True)
    return {"mode": "build", "output_dir": str(run), "voice": str(run / ".broll-video" / "voice.m4a"), "words": [["hi", 0, 300]], "total_ms": 3000,
            "catalog_path": str(run / ".broll-video" / "broll-catalog.json"), "shot_ids": None, "allow_ai": False, "aspect": "9:16", "fade": False,
            "title": "Hi", "captions": True, "caption_preset": "pop", "hook": None, "graphics": True, "media_id": "c" * 32}


def test_runner_checks_the_request(tmp_path):
    r = runner()
    request = good_request(tmp_path)
    assert r.parse_build(request)["title"] == "Hi"
    for bad in ({"output_dir": str(tmp_path)}, {"total_ms": 999}, {"total_ms": 10 ** 9}, {"words": []}, {"shot_ids": ["nope"]}, {"aspect": "1:1"},
                {"fade": "yes"}, {"broll_ai": {"kind": "video"}}, {"allow_ai": True, "broll_ai": {"kind": "video"}}, {"caption_preset": "../x"},
                {"hook": {"text": "", "look": {}}}, {"cta_id": "x"}, {"cta_keyword": "lower"}, {"media_id": "x"}, {"extra": 1}, {"voice": "rel.m4a"}):
        with pytest.raises((ValueError, Exception)):
            r.parse_build({**request, **bad})
    swap = {"mode": "swap", "output_dir": request["output_dir"], "slot": 2, "shot_id": None, "catalog_path": request["catalog_path"], "media_id": "d" * 32, "revision": 1}
    assert r.parse_swap(swap)["slot"] == 2
    for bad in ({"slot": -1}, {"shot_id": "l1"}, {"revision": "1"}, {"media_id": "z"}):
        with pytest.raises(ValueError):
            r.parse_swap({**swap, **bad})


def test_working_files_must_be_inside_the_run(tmp_path):
    folder = tmp_path / "work"
    folder.mkdir()
    (folder / "voice.m4a").write_bytes(b"x")
    assert bv.check_inside(str(folder / "voice.m4a"), str(folder)).endswith("voice.m4a")
    (tmp_path / "outside.m4a").write_bytes(b"x")
    os.symlink(tmp_path / "outside.m4a", folder / "link.m4a")
    for path in (str(tmp_path / "outside.m4a"), str(folder / "link.m4a"), str(folder / "missing.m4a")):
        with pytest.raises(ValueError):
            bv.check_inside(path, str(folder))


def test_shots_with_words_on_them_stay_out_from_under_the_hook_text():
    slots = [bv.Slot(k, k * 2500, (k + 1) * 2500, "the ads dashboard") for k in range(3)]
    headline = shot(1, "A news headline about ads on a dashboard", ["ads", "dashboard"])
    headline.text = True
    plain_shot = shot(2, "A dashboard on a monitor", ["dashboard"])
    other = shot(3, "A city street")
    shots = bv.assign_shots(slots, [headline, plain_shot, other], hook_ms=3000)
    # The first slot (under the hook) doesn't get the headline shot, even though it names more of what is said.
    assert shots[0].shot_id != headline.id
    assert headline.id in [s.shot_id for s in shots[1:]]
    # No hook: the best match goes first.
    assert bv.assign_shots(slots, [headline, plain_shot, other])[0].shot_id == headline.id


def test_the_catalog_keeps_the_written_on_flag():
    from clip_engine.services.broll_library import parse_catalog
    shots = parse_catalog({"version": 1, "shots": [
        {"id": "l000000000001:s0", "path": "/a/x.mp4", "kind": "video", "inS": 0, "outS": 4, "description": "A headline", "tags": [], "shotType": "text", "text": True},
        {"id": "l000000000002:s0", "path": "/a/y.mp4", "kind": "video", "inS": 0, "outS": 4, "description": "A street", "tags": [], "shotType": "wide"}]})
    assert [s.text for s in shots] == [True, False]


def test_ai_shots_paid_for_before_a_rejected_key_are_still_counted(monkeypatch, tmp_path):
    from clip_engine.services.broll_library import AiSettings, BrollLibraryError

    class FakeMaker:
        instances = []

        def __init__(self, settings, ai):
            self.ai, self.cost_usd, self.calls, self.closed = ai, 0.0, 0, False
            FakeMaker.instances.append(self)

        async def make(self, prompt, out):
            self.calls += 1
            if self.calls == 2:
                raise BrollLibraryError("OpenRouter rejected the API key. Check it in Settings.")
            self.cost_usd += 0.1
            Path(out).write_bytes(b"video")
            return out

        async def aclose(self):
            self.closed = True

    monkeypatch.setattr(bv, "AiShotMaker", FakeMaker)
    monkeypatch.setattr(bv, "conform_piece", lambda *args: Path(args[5]).write_bytes(b"piece") or args[5])
    library = shot(1, "Hands typing on a laptop", ("laptop",), seconds=8)
    shots = [bv.TimelineShot(k, k * 2000, (k + 1) * 2000, ai_prompt=f"a cup of coffee on a desk {k}", words="coffee") for k in range(3)]
    ai = AiSettings(kind="video", model="x-ai/grok-imagine-video-1.5-lite", max_shots=3, seconds=5, per_second_usd=0.02)
    spent, warnings = {"usd": 0.0}, []
    cost = asyncio.run(bv.make_pieces(shots, {library.id: library}, str(tmp_path / "pieces"), 1080, 1920, False, ai, None, None,
                                      lambda *a: None, warnings, spent))
    maker = FakeMaker.instances[0]
    assert maker.calls == 2, "no more AI shots once the key is rejected"
    assert cost == pytest.approx(0.1) and spent["usd"] == pytest.approx(0.1), "the shot already paid for is reported"
    assert maker.closed
    assert shots[1].shot_id == library.id and shots[2].shot_id == library.id, "the gaps get library shots instead"
    assert any("API key" in w for w in warnings)
