"""Sound design: the bundled library (manifest, licenses), the planner (timing, takes, density, registers) and a real
mix checked by measuring it (onsets where the graphics land, loudness and true peak in range)."""
import json
import os
import re
import shutil
import subprocess

import numpy as np
import pytest

from clip_engine.services import sound_design as sd

SFX = sd.SFX_DIR


# ---------------------------------------------------------------------------
# The library
# ---------------------------------------------------------------------------

def test_the_manifest_lists_every_file_with_its_action_take_peak_source_and_a_free_license():
    manifest = json.load(open(os.path.join(SFX, "manifest.json")))
    files = {os.path.relpath(os.path.join(root, name), SFX).replace(os.sep, "/")
             for root, _, names in os.walk(SFX) for name in names if name.endswith(".ogg")}
    listed = [s["file"] for s in manifest["sounds"]]
    assert sorted(listed) == sorted(files) and len(set(listed)) == len(listed)
    assert 50 <= len(listed) <= 80
    for sound in manifest["sounds"]:
        assert sound["action"] in sd.ACTIONS and sound["file"].startswith(sound["action"] + "/")
        assert 0 <= sound["peak_ms"] <= sound["duration_ms"] <= 2500
        # CC0 (Kenney) or our own noise; never anything from soundcn's "wow" folder (Blizzard's).
        assert sound["license"].startswith("CC0-1.0") or sound["license"].startswith("Made for CreatorClips")
        assert ("kenney_" in sound["source"]) == sound["license"].startswith("CC0-1.0")
        assert "wow" not in sound["source"].lower()
    # Four to eight takes of every action, so repeats rotate.
    for action in sd.ACTIONS:
        takes = sorted(s["take"] for s in manifest["sounds"] if s["action"] == action)
        assert takes == list(range(len(takes))) and 4 <= len(takes) <= 8 and manifest["actions"][action] == len(takes)
    # No synthesized tones: the tone-only "ding" is gone, and the library is small.
    assert not any("ding" in name for name in listed)
    total = sum(os.path.getsize(os.path.join(SFX, name)) for name in listed)
    assert total < 3 * 1024 * 1024
    license_text = open(os.path.join(SFX, "LICENSE.txt"), encoding="utf-8").read()
    assert "CC0" in license_text and "Kenney" in license_text and "wow" in license_text


def test_every_manifest_entry_is_a_real_file_the_engine_loads_with_its_peak_inside_and_a_free_license():
    manifest = json.load(open(os.path.join(SFX, "manifest.json")))
    lib = sd.library()
    loaded = {sound.path for sounds in lib.values() for sound in sounds}
    license_text = open(os.path.join(SFX, "LICENSE.txt"), encoding="utf-8").read()
    for sound in manifest["sounds"]:
        # The engine only loads names like "whoosh/air-short.ogg"; one that doesn't match would be silently dropped.
        assert re.fullmatch(r"[a-z]+/[a-z0-9-]+\.ogg", sound["file"]), sound["file"]
        path = os.path.join(SFX, sound["file"])
        assert os.path.isfile(path) and not os.path.islink(path) and path in loaded
        assert 0 <= sound["peak_ms"] < sound["duration_ms"] and sound["level_db"] < 0
        # CC0 (Kenney) or our own.
        assert sound["license"] in ("CC0-1.0 (public domain dedication), Kenney (www.kenney.nl)",
                                    "Made for CreatorClips from shaped noise (scripts/sfx/build_library.py); MIT, with the engine")
        # LICENSE.txt names its pack (Kenney) or the files we made (whoosh/air-*, riser/air-rise-*).
        if sound["license"].startswith("CC0"):
            pack = re.match(r"Kenney, (.+?) \(kenney_", sound["source"]).group(1)
            assert pack.lower() in license_text.lower(), pack
        else:
            assert sound["file"].startswith(("whoosh/air-", "riser/air-rise-"))
    assert sum(len(sounds) for sounds in lib.values()) == len(manifest["sounds"])


def test_each_bundled_file_is_48k_mono_opus_peaking_under_full_scale_with_its_peak_where_the_manifest_says():
    lib = sd.library()
    for action, sounds in lib.items():
        for sound in sounds:
            probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels",
                                               "-of", "json", sound.path], capture_output=True, check=True).stdout)["streams"][0]
            assert (probe["codec_name"], probe["sample_rate"], probe["channels"]) == ("opus", "48000", 1), sound.path
            samples = sd.decode(sound.path, 3.0)
            assert float(np.abs(samples).max()) < 0.89  # about -3 dBFS, with the codec's overshoot
            peak, duration, level = sd.measure(samples)
            assert abs(peak - sound.peak_ms) <= 2 and abs(duration - sound.duration_ms) <= 2 and abs(level - sound.level_db) < 0.2


# ---------------------------------------------------------------------------
# Cues from the timeline
# ---------------------------------------------------------------------------

def test_graphics_map_to_the_sound_of_what_they_do_and_hints_win():
    cues = sd.cues_from_events([
        {"kind": "graphic", "template": "title", "at_ms": 1000, "end_ms": 3000},
        {"kind": "graphic", "template": "stat", "at_ms": 4000, "end_ms": 6000},
        {"kind": "graphic", "template": "list", "at_ms": 7000, "end_ms": 9000, "size": "compact"},
        {"kind": "graphic", "template": "list", "at_ms": 10000, "end_ms": 14000, "size": "stage"},
        {"kind": "graphic", "template": "link_cta", "at_ms": 16000, "end_ms": 19000},
        {"kind": "graphic", "template": "quote", "at_ms": 20000, "end_ms": 22000, "sound": "none"},
        {"kind": "graphic", "template": "quote", "at_ms": 23000, "end_ms": 25000, "sound": "paper"},
        {"kind": "scene", "at_ms": 26000, "end_ms": 28000},
        {"kind": "hook", "at_ms": 0},
        {"kind": "nonsense", "at_ms": 5},
        {"kind": "graphic", "template": "title", "at_ms": -5},
    ], 40000)
    got = [(c.at_ms, c.action, c.kind) for c in cues]
    assert (1000, "impact", "graphic") in got and (4000, "pop", "graphic") in got
    assert (7000, "swipe", "graphic") in got  # a small card: a swipe, not a whoosh
    assert (10000, "whoosh", "graphic") in got and (14000, "whoosh", "graphic_out") in got  # a stage card in and out
    assert (16000, "click", "graphic") in got and next(c for c in cues if c.at_ms == 16000).payoff
    assert not any(c.at_ms == 20000 for c in cues) and (23000, "paper", "graphic") in got
    assert (26000, "whoosh", "scene") in got and (28000, "whoosh", "scene_out") in got
    assert (0, "swipe", "hook") in got and len(cues) == 10


def test_an_fx_effect_uses_its_catalog_sound_on_its_main_beat(monkeypatch):
    monkeypatch.setattr(sd, "fx_hints", lambda: {"count-up": ("tick", 1.72), "logo-wall": ("none", None)})
    cues = sd.cues_from_events([{"kind": "graphic", "template": "fx", "effect": "count-up", "at_ms": 2000, "end_ms": 5500},
                                {"kind": "graphic", "template": "fx", "effect": "logo-wall", "at_ms": 6000, "end_ms": 9000},
                                {"kind": "graphic", "template": "fx", "effect": "unknown", "at_ms": 9500, "end_ms": 11000}], 20000)
    # A number effect lands with a soft pop (numbers take turns between a pop and a tick once planned).
    assert [(c.at_ms, c.action) for c in cues] == [(3720, "pop")] and cues[0].number


# ---------------------------------------------------------------------------
# The plan
# ---------------------------------------------------------------------------

def _graphics(times, template="stat", total=60000):
    return sd.cues_from_events([{"kind": "graphic", "template": template, "at_ms": t, "end_ms": t + 2000} for t in times], total)


def test_each_peak_lands_one_frame_after_its_picture():
    plan = sd.plan_sounds(sd.cues_from_events([{"kind": "graphic", "template": "list", "at_ms": 5000, "end_ms": 8000},
                                               {"kind": "graphic", "template": "stat", "at_ms": 12000, "end_ms": 14000}], 20000), 20000)
    # (A card that just appears gets a soft swipe: a whoosh is for real movement, a scene or a big card.)
    assert [(p.action, p.peak_at_ms) for p in plan] == [("swipe", 5033), ("pop", 12033)]
    for p in plan:
        assert p.start_ms + p.sound.peak_ms == p.peak_at_ms and p.trim_ms == 0
    # The swipe starts before the card, so its rush peaks just as the card is there.
    assert plan[0].start_ms < 5000


def test_a_sound_at_the_very_start_skips_the_part_before_its_peak():
    plan = sd.plan_sounds(sd.cues_from_events([{"kind": "hook", "at_ms": 0}], 10000), 10000)
    assert len(plan) == 1 and plan[0].start_ms == 0 and plan[0].trim_ms == plan[0].sound.peak_ms - sd.FRAME_MS


def test_takes_rotate_so_the_same_file_never_plays_twice_in_a_row():
    plan = sd.plan_sounds(_graphics([2000, 6000, 10000, 14000, 18000, 22000]), 60000)
    files = [p.sound.path for p in plan]
    assert len(files) == 6 and all(a != b for a, b in zip(files, files[1:]))
    # Numbers take turns between a soft pop and a key tick, each rotating through its takes: six different files.
    assert [p.action for p in plan] == ["pop", "tick"] * 3 and len(set(files)) == 6


def test_a_long_run_of_one_action_uses_many_different_takes():
    # Eight scene changes (each one a whoosh in and a whoosh out): sixteen whooshes, rotating through every take, so a
    # busy video uses the whole library before any whoosh comes back, and never the same one twice in a row.
    events = [{"kind": "scene", "at_ms": 2000 + i * 7000, "end_ms": 5000 + i * 7000} for i in range(8)]
    plan = sd.plan_sounds(sd.cues_from_events(events, 60000), 60000)
    whooshes = [p.sound.path for p in plan if p.action == "whoosh"]
    files = [p.sound.path for p in plan]
    assert len(whooshes) >= 8 and all(a != b for a, b in zip(files, files[1:]))
    assert len(set(whooshes)) == min(len(whooshes), len(sd.library()["whoosh"])) >= 8
    # Ticks and pops for numbers: more files in play than the four-take library had.
    plan = sd.plan_sounds(_graphics(range(2000, 50000, 3000)), 60000)
    numbers = [p.sound.path for p in plan if p.action in ("pop", "tick")]
    assert len(set(numbers)) > 8


def test_sounds_keep_apart_and_under_the_average_cap():
    # Twenty graphics in 20 s: teaching keeps them 1.2 s apart and about one per 4 s.
    plan = sd.plan_sounds(_graphics(range(500, 20000, 1000), total=20000), 20000)
    peaks = [p.peak_at_ms for p in plan]
    assert len(plan) == 5 and all(b - a >= 1200 for a, b in zip(peaks, peaks[1:]))


def test_priority_decides_what_stays_when_cues_crowd():
    cues = sd.cues_from_events([{"kind": "punch", "at_ms": 3000}, {"kind": "graphic", "template": "title", "at_ms": 3400, "end_ms": 5000},
                                {"kind": "scene", "at_ms": 9000, "end_ms": 12000}, {"kind": "broll", "at_ms": 9500, "end_ms": 11000}], 30000)
    plan = sd.plan_sounds(cues, 30000)
    assert [(p.kind, p.action) for p in plan] == [("graphic", "impact"), ("scene", "whoosh"), ("scene_out", "whoosh")]


def test_one_riser_into_the_call_to_action_with_room_before_it():
    cues = sd.cues_from_events([{"kind": "graphic", "template": "stat", "at_ms": 3000, "end_ms": 5000},
                                {"kind": "graphic", "template": "stat", "at_ms": 18200, "end_ms": 19000},
                                {"kind": "graphic", "template": "link_cta", "at_ms": 19000, "end_ms": 22000},
                                {"kind": "graphic", "template": "comment_cta", "at_ms": 25000, "end_ms": 28000}], 30000)
    plan = sd.plan_sounds(cues, 30000)
    risers = [p for p in plan if p.action == "riser"]
    assert len(risers) == 1 and risers[0].peak_at_ms == 19033
    # It builds into an impact on the payoff, and nothing else plays while it builds.
    assert any(p.action == "impact" and p.peak_at_ms == 19033 for p in plan)
    assert not any(p.action == "pop" and 18000 <= p.peak_at_ms < 19033 for p in plan)
    # A story or minimal register has no riser.
    assert not [p for p in sd.plan_sounds(cues, 30000, "story") if p.action == "riser"]
    assert not [p for p in sd.plan_sounds(cues, 30000, "minimal") if p.action == "riser"]


def test_registers_scale_how_much_plays():
    events = [{"kind": "hook", "at_ms": 0}, {"kind": "scene", "at_ms": 20000, "end_ms": 26000},
              *({"kind": "graphic", "template": t, "at_ms": at, "end_ms": at + 2500}
                for t, at in (("stat", 4000), ("quote", 8000), ("list", 12000), ("title", 16000), ("headline_pill", 30000),
                              ("logo", 34000), ("chapter", 38000))),
              {"kind": "punch", "at_ms": 42000}, {"kind": "broll", "at_ms": 46000, "end_ms": 49000}]
    cues = sd.cues_from_events(events, 60000)
    teaching, story, minimal = (sd.plan_sounds(cues, 60000, r) for r in sd.REGISTERS)
    assert len(teaching) > len(story) > len(minimal) >= 2
    # A story has no typing ticks, punches or b-roll swooshes; minimal keeps the hook, scenes and the biggest moments.
    assert not any(p.action == "tick" or p.kind in ("punch", "broll") for p in story)
    assert {p.kind for p in minimal} <= {"hook", "scene", "graphic"}
    assert all(p.kind != "graphic" or p.action in ("impact", "pop", "whoosh") for p in minimal)
    # Story is softer than teaching for the same hit.
    gains = {r: {p.peak_at_ms: p.gain_db for p in plan} for r, plan in zip(sd.REGISTERS, (teaching, story, minimal))}
    assert gains["story"][33] < gains["teaching"][33]


def test_the_ais_extras_play_only_while_something_is_on_screen():
    cues = sd.cues_from_events([{"kind": "graphic", "template": "stat", "at_ms": 5000, "end_ms": 9000},
                                {"kind": "extra", "at_ms": 7500, "sound": "ding"},
                                {"kind": "extra", "at_ms": 15000, "sound": "whoosh"}], 30000)
    plan = sd.plan_sounds(cues, 30000)
    assert [(p.kind, p.action, p.peak_at_ms) for p in plan] == [("graphic", "pop", 5033), ("extra", "pop", 7533)]


def test_the_members_own_sounds_come_first_for_their_action():
    own = sd.Sound("/sounds/pop/mine.wav", "pop", 10, 200, -18.0, own=True)
    plan = sd.plan_sounds(_graphics([2000, 6000], "icon_pop") + sd.cues_from_events([{"kind": "graphic", "template": "title", "at_ms": 14000}], 60000),
                          60000, palette={"pop": (own,)})
    assert [p.sound.own for p in plan] == [True, True, False]
    assert plan[0].start_ms == 2033 - 10


def test_hits_sit_over_the_bed_and_under_the_voice():
    voice = sd.TARGET_LUFS + sd.VOICE_PEAK_OVER_LUFS
    for music_db in (-30, -26, -20, -14, -10):
        bed_in_pauses = voice + music_db + 12
        level = sd.hit_level_db("whoosh", "graphic", "teaching", music_db)
        assert level <= voice - 3
        assert level >= min(bed_in_pauses + 3, voice - 9)
    assert sd.hit_level_db("tick", "graphic", "teaching", None) < sd.hit_level_db("impact", "graphic", "teaching", None) < voice


def test_a_bake_request_is_checked():
    assert sd.parse_request(None) is None
    req = sd.parse_request({"register": "story", "music_db": -20, "events": [{"kind": "hook", "at_ms": 0}], "palette": []})
    assert req.register == "story" and req.music_db == -20.0
    for bad in ({"register": "loud"}, {"music_db": 5}, {"events": "x"}, {"palette": [{"path": "rel.wav", "action": "pop"}]},
                {"palette": [{"path": "/a.wav", "action": "laser"}]}, {"extra": 1}):
        with pytest.raises(ValueError):
            sd.parse_request(bad)
    sd.validate_candidate_sound({"on": True, "register": "teaching", "cues": [{"at_ms": 10, "kind": "punch"}]}, 1000)
    for bad in ({"on": 1, "register": "teaching"}, {"on": True, "register": "x"}, {"on": True, "register": "story", "cues": [{"at_ms": 5000, "kind": "punch"}]},
                {"on": True, "register": "story", "cues": [{"at_ms": 5, "kind": "graphic"}]}):
        with pytest.raises(ValueError):
            sd.validate_candidate_sound(bad, 1000)


def test_a_members_sound_is_checked_and_measured(tmp_path):
    good = str(tmp_path / "clap.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=d=0.3:a=0.5", "-af", "afade=t=out:st=0.05:d=0.25", good], check=True)
    sound = sd.own_sound(good, "pop")
    assert sound.own and 0 <= sound.peak_ms < 80 and 280 <= sound.duration_ms <= 320
    long = str(tmp_path / "long.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=d=6:a=0.3", long], check=True)
    for path, action in ((long, "pop"), (good, "laser"), (str(tmp_path / "missing.wav"), "pop"), ("clap.wav", "pop")):
        with pytest.raises(sd.SoundDesignError):
            sd.own_sound(path, action)
    warnings = []
    palette = sd.palette_of([{"path": good, "action": "pop"}, {"path": long, "action": "pop"}], warnings)
    assert [s.path for s in palette["pop"]] == [good] and len(warnings) == 1


# ---------------------------------------------------------------------------
# A real mix, measured
# ---------------------------------------------------------------------------

def _make_clip(path, seconds=12.0):
    """A clip with a 'voice' (a 220 Hz tone rising and falling like speech) and quiet low 'music' under it."""
    voice = "0.3*sin(2*PI*220*t)*(0.55+0.45*sin(2*PI*0.7*t))"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=gray:s=320x568:r=30:d={seconds}",
                    "-f", "lavfi", "-i", f"aevalsrc='{voice}':s=48000:d={seconds}",
                    "-f", "lavfi", "-i", f"anoisesrc=d={seconds}:c=brown:a=0.02",
                    "-filter_complex", "[1:a][2:a]amix=inputs=2:normalize=0[a]", "-map", "0:v", "-map", "[a]",
                    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", path], check=True)


def _ebur128(path):
    text = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                          capture_output=True).stderr.decode()
    summary = text[text.rindex("Summary:"):]
    return float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1)), float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary).group(1))


def _onsets(path, highpass=3000):
    """Times (ms) where high-band energy jumps: the effects (the 220 Hz voice and the quiet music have little up there)."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-af", f"highpass=f={highpass},highpass=f={highpass}", "-ac", "1",
                          "-ar", "48000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, "<f4").astype(np.float64)
    hop = 480  # 10 ms
    energy = np.array([np.sum(x[i:i + hop] ** 2) for i in range(0, len(x) - hop, hop)])
    floor = np.median(energy) + 1e-12
    loud = energy > floor * 30
    starts = [i * 10 for i in range(1, len(loud)) if loud[i] and not loud[i - 1]]
    return starts, energy


@pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="needs FFmpeg")
def test_a_clip_with_graphics_gets_its_sounds_at_the_right_times_and_social_loudness(tmp_path):
    clip = str(tmp_path / "clip.mp4")
    _make_clip(clip)
    events = [{"kind": "graphic", "template": "staircase", "at_ms": 2000, "end_ms": 4500},
              {"kind": "graphic", "template": "stat", "at_ms": 5500, "end_ms": 7000},
              {"kind": "scene", "at_ms": 8000, "end_ms": 11500}]
    request = sd.SoundRequest("teaching", -20.0, events, [])
    before = _ebur128(clip)
    placed = sd.design_in_place(clip, request, 12000, str(tmp_path / "work"))
    assert [(p["action"], p["peak_ms"]) for p in placed] == [("whoosh", 2033), ("pop", 5533), ("whoosh", 8033)]
    integrated, peak = _ebur128(clip)
    print(f"loudness before {before}, after: {integrated} LUFS, true peak {peak} dBTP")
    assert abs(integrated - sd.TARGET_LUFS) <= 1.0 and peak <= -1.0
    # Exactly three bursts of high-band energy (the effects: the voice and music have little up there), each peaking
    # where its picture lands plus one frame.
    starts, energy = _onsets(clip)
    assert len(starts) == len(placed), (starts, placed)
    for p, start in zip(placed, starts):
        assert p["start_ms"] - 60 <= start <= p["peak_ms"] + 30
        lo, hi = (p["peak_ms"] - 300) // 10, (p["peak_ms"] + 300) // 10
        loudest = (lo + int(np.argmax(energy[lo:hi]))) * 10
        assert abs(loudest - p["peak_ms"]) <= 40, (loudest, p)


@pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="needs FFmpeg")
def test_an_editor_bake_mixes_the_clips_sounds_where_its_graphics_land(monkeypatch, tmp_path):
    """The clip editor's export (run_editor) with main's `sound` request: the clip is rendered, its effects mixed at the
    graphics' times on the finished clip's clock, and its loudness set for social; the clip keeps its sound setting."""
    import asyncio
    from dataclasses import asdict
    from clip_engine.services import rendering_service
    from clip_engine.services.manual_editor import run_editor
    from clip_engine.services.rendering_service import RenderingService
    from tests.test_manual_editor import transcript

    renderer = RenderingService()
    monkeypatch.setattr(renderer.settings, "local_mode", True)
    renderer._verify_ffmpeg()
    monkeypatch.setattr(rendering_service, "get_output_dimensions", lambda _: (180, 320))
    source = tmp_path / "editor-source.mp4"
    voice = "0.3*sin(2*PI*220*t)*(0.55+0.45*sin(2*PI*0.7*t))"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=180x320:r=30:d=12", "-f", "lavfi", "-i",
                    f"aevalsrc='{voice}':s=48000:d=12", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-ar", "48000", "-shortest", str(source)], check=True)
    sound = {"on": True, "register": "teaching", "music_db": -20, "cues": []}
    c = {"id": "candidate-1", "title": "Reel", "ranges": [[0, 2000], [4000, 12000]], "scenes": [{"at_ms": 0, "layout": "fill", "crops": [[0, 0, 1, 1]]}],
         "captions": False, "caption_preset": "pop", "video_speed": 1, "status": "ready", "score": 0.8, "reason": "", "review": None, "exports": [],
         "sound": sound}
    project = {"version": 1, "revision": 0, "width": 180, "height": 320, "duration_ms": 12000, "aspect_ratio": "9:16",
               "candidates": [c], "transcript": [asdict(s) for s in transcript()]}
    (tmp_path / "editor-project.json").write_text(json.dumps(project))
    (tmp_path / "transcript.json").write_text(json.dumps({"segments": [asdict(s) for s in transcript()]}))
    (tmp_path / "job_output.json").write_text(json.dumps({"clips": [], "total_clips": 0, "editor_project": True}))
    # As main sends it (sound-design.ts bakeSoundEvents): graphics and a scene on the finished clip's clock (10 s long).
    events = [{"kind": "graphic", "template": "list", "at_ms": 1500, "end_ms": 3500, "size": "stage"},
              {"kind": "graphic", "template": "stat", "at_ms": 4500, "end_ms": 6000, "size": "card"},
              {"kind": "scene", "at_ms": 7000, "end_ms": 9600}]
    asyncio.run(run_editor({"run": str(tmp_path), "revision": 0, "candidate_id": c["id"], "action": "export",
                            "sound": {"register": "teaching", "music_db": -20, "events": events, "palette": []}}))
    output = json.loads((tmp_path / "job_output.json").read_text())["clips"][0]
    clip = output["s3_url"]
    assert output["duration_ms"] == 10000
    planned = sd.plan_sounds(sd.cues_from_events(events, 10000), 10000, "teaching", -20.0)
    # Three in 10 s (one per 4 s at most): the scene's way back out is the one left out.
    assert [(p.action, p.peak_at_ms) for p in planned] == [("whoosh", 1533), ("pop", 4533), ("whoosh", 7033)]
    starts, energy = _onsets(clip)
    assert len(starts) == len(planned), (starts, [p.start_ms for p in planned])
    for p, start in zip(planned, starts):
        assert p.start_ms - 60 <= start <= p.peak_at_ms + 30, (start, p)
        lo, hi = (p.peak_at_ms - 300) // 10, (p.peak_at_ms + 300) // 10
        assert abs((lo + int(np.argmax(energy[lo:hi]))) * 10 - p.peak_at_ms) <= 40
    integrated, peak = _ebur128(clip)
    print(f"editor bake: {integrated} LUFS, true peak {peak} dBTP")
    assert abs(integrated - sd.TARGET_LUFS) <= 1.0 and peak <= -1.0
    saved = json.loads((tmp_path / "editor-project.json").read_text())["candidates"][0]
    assert saved["status"] == "baked" and saved["sound"] == sound
    # A malformed request is refused before anything renders.
    from clip_engine.services.manual_editor import EditorError
    saved_project = json.loads((tmp_path / "editor-project.json").read_text())
    saved_project["candidates"][0]["status"] = "ready"
    (tmp_path / "editor-project.json").write_text(json.dumps(saved_project))
    with pytest.raises((EditorError, ValueError)):
        asyncio.run(run_editor({"run": str(tmp_path), "revision": saved_project["revision"], "candidate_id": c["id"], "action": "export",
                                "sound": {"register": "loud"}}))


def test_edit_runner_checks_the_sound_design_options():
    import edit_runner
    from tests.test_edit_recording import script
    words = script(("Most coaches lose clients.", 0.5))
    base = {"mode": "render", "output_dir": "/tmp/x", "sources": ["/tmp/a.mp4"], "words": [[w.text, w.start_ms, w.end_ms, 0] for w in words],
            "keep": [True] * len(words), "look": {"headline": "Hook", "include_captions": True, "caption_preset": "pop"}}
    assert "sound_design" not in edit_runner.parse_request(base)
    parsed = edit_runner.parse_request({**base, "sound_design": {"on": True, "register": "story"},
                                        "sound_palette": [{"path": "/sounds/pop/a.wav", "action": "pop"}]})
    assert parsed["sound_design"] == {"on": True, "register": "story"} and parsed["sound_palette"] == [{"path": "/sounds/pop/a.wav", "action": "pop"}]
    for bad in ({"sound_design": {"on": "yes"}}, {"sound_design": {"on": True, "register": "loud"}}, {"sound_design": {"on": True, "x": 1}},
                {"sound_design": {"on": True}, "sound_palette": [{"path": "rel.wav", "action": "pop"}]},
                {"sound_design": {"on": True}, "sound_palette": [{"path": "/a.wav", "action": "laser"}]},
                {"sound_palette": []}):
        with pytest.raises(ValueError):
            edit_runner.parse_request({**base, **bad})
