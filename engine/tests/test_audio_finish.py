"""Voice cleanup and background music (audio_finish): measured on speech-like test audio, no listening needed."""
import json
import os
import shutil

import numpy as np
import pytest

from clip_engine.services import audio_finish as af
from tests.speech_fixture import RATE, clean_speech, frame_power, masks, noisy_speech, read_audio, write_video

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg") or not shutil.which("ffprobe"), reason="needs FFmpeg")


def speech_to_pause_db(signal, speaking, pause):
    power = frame_power(signal)
    n = min(len(power), len(speaking))
    return 10 * np.log10(np.mean(power[:n][speaking[:n]]) / np.mean(power[:n][pause[:n]]))


def lag(reference, signal, seconds=6):
    n = min(len(reference), len(signal), RATE * seconds)
    corr = np.fft.irfft(np.fft.rfft(signal[:n], 2 * n) * np.conj(np.fft.rfft(reference[:n], 2 * n)))
    peak = int(np.argmax(corr))
    return peak if peak < n else peak - 2 * n


def envelope_match(clean, signal, speaking):
    """How closely the output's loudness follows the clean speech, frame by frame (1 = exactly)."""
    a, b = frame_power(clean), frame_power(signal)
    n = min(len(a), len(b), len(speaking))
    m = speaking[:n]
    return np.corrcoef(10 * np.log10(a[:n][m] + 1e-12), 10 * np.log10(b[:n][m] + 1e-12))[0, 1]


@pytest.fixture
def noisy_video(tmp_path):
    noisy, clean, active = noisy_speech(12.0, -34.0)
    path = str(tmp_path / "noisy.mkv")
    write_video(path, noisy, str(tmp_path / "noisy.wav"))
    return path, clean, active


def test_cleanup_reduces_noise_and_echo_without_hurting_speech(noisy_video, tmp_path):
    source, clean, active = noisy_video
    out = str(tmp_path / "clean.mp4")
    done = af.finish_audio(source, out, af.AudioPlan(voice_cleanup=True), str(tmp_path / "work"))
    assert done == {"voice_cleanup": True, "music": None}
    before, after = read_audio(source), read_audio(out)
    speaking, pause = masks(active)
    improvement = speech_to_pause_db(after, speaking, pause) - speech_to_pause_db(before, speaking, pause)
    assert improvement >= 10, f"only {improvement:.1f} dB quieter between words"
    # The words survive: the output follows the clean speech at least as well as the noisy input did.
    assert envelope_match(clean, after, speaking) >= envelope_match(clean, before, speaking) - 0.01
    assert envelope_match(clean, after, speaking) > 0.9
    # In sync with the picture (no filter delay left) and the same length.
    assert abs(lag(before, after)) <= 2
    assert abs(len(after) - len(before)) <= 1024
    # Even level for social: -14 LUFS.
    assert af._loudness(["-i", out]) == pytest.approx(-14.0, abs=0.5)


def test_cleanup_is_light_on_a_clean_recording(tmp_path):
    clean, active = clean_speech(10.0, seed=7)
    source = str(tmp_path / "clean.mkv")
    write_video(source, clean, str(tmp_path / "clean.wav"))
    out = str(tmp_path / "out.mp4")
    af.finish_audio(source, out, af.AudioPlan(voice_cleanup=True), str(tmp_path / "work"))
    speaking, _ = masks(active)
    assert envelope_match(clean, read_audio(out), speaking) > 0.95


def test_cleanup_settings_follow_the_recording():
    noisy = af.cleanup_graph("[s]", "[o]", af.VoiceProfile(-40.0, -15.0, (1.0, 2.0)), frozenset({"afftdn", "agate", "asendcmd", "concat", "asplit", "atrim"}))
    clean = af.cleanup_graph("[s]", "[o]", af.VoiceProfile(-100.0, -15.0, None), frozenset({"afftdn", "agate"}))
    assert "afftdn=nr=11.8" in noisy and "sn start" in noisy and "atrim=start=1.00:end=2.00" in noisy
    # A recording that is already clean gets no noise reduction at all, and no stage that isn't there is used.
    assert "afftdn" not in clean and "deesser" not in clean and "agate" in clean
    nothing = frozenset({"none"})
    assert af.cleanup_graph("[s]", "[o]", af.VoiceProfile(-30.0, -24.0), nothing) == "[s]volume=4.00dB,highpass=f=80:poles=2,lowpass=f=16000:poles=2[o]"


def talk_and_pause(tmp_path, seconds=24.0):
    """Speech for 3 s, silence for 3 s, repeated (a clear picture of ducking)."""
    clean, active = clean_speech(seconds, seed=4)
    t = np.arange(len(clean)) / RATE
    on = (np.floor(t / 3) % 2 == 0) & (t > 1) & (t < seconds - 2)
    path = str(tmp_path / "voice.mkv")
    write_video(path, clean * on, str(tmp_path / "voice.wav"))
    return path, active & on, on


def music_only(tmp_path, source, plan):
    """The music part of the mix: the mix minus the same render without music."""
    mixed, dry = str(tmp_path / "mix.mp4"), str(tmp_path / "dry.mp4")
    assert af.finish_audio(source, mixed, plan, str(tmp_path / "work"))["music"] == plan.music.track
    af.finish_audio(source, dry, af.AudioPlan(voice_cleanup=plan.voice_cleanup, keep_windows=plan.keep_windows,
                                              target_lufs=plan.target_lufs), str(tmp_path / "work"))
    a, b = read_audio(mixed), read_audio(dry)
    n = min(len(a), len(b))
    return a[:n] - b[:n], mixed


@pytest.mark.parametrize("track", ["calm-pad", "upbeat-pulse", "lofi-beat", "cinematic-swell"])
def test_music_ducks_under_speech_and_comes_back_in_pauses(tmp_path, track):
    source, _, on = talk_and_pause(tmp_path)
    music, mixed = music_only(tmp_path, source, af.AudioPlan(music=af.bundled_music(track)))
    t = np.arange(len(music)) / RATE
    phase = t % 3
    middle = (phase > 1.0) & (phase < 2.6) & (t > 3) & (t < 20)
    talking = middle & on[:len(music)]
    quiet = middle & ~on[:len(music)]
    under_speech = 10 * np.log10(np.mean(music[talking] ** 2))
    in_pauses = 10 * np.log10(np.mean(music[quiet] ** 2))
    assert in_pauses - under_speech >= 8, f"{track}: ducks only {in_pauses - under_speech:.1f} dB"
    assert in_pauses - under_speech <= 20
    # The music sits well under the voice while someone talks (about 20 dB by default).
    voice = read_audio(mixed)[:len(music)] - music
    under_voice = under_speech - 10 * np.log10(np.mean(voice[talking] ** 2))
    assert -27 <= under_voice <= -15, under_voice


def test_music_level_moves_the_music(tmp_path):
    source, _, on = talk_and_pause(tmp_path, 14.0)
    quiet, _ = music_only(tmp_path, source, af.AudioPlan(music=af.bundled_music("calm-pad"), music_level_db=-28))
    loud, _ = music_only(tmp_path, source, af.AudioPlan(music=af.bundled_music("calm-pad"), music_level_db=-14))
    assert 10 * np.log10(np.mean(loud ** 2) / np.mean(quiet ** 2)) == pytest.approx(14, abs=2)


def test_music_loops_for_a_long_video_and_fades_at_the_ends(tmp_path):
    seconds = 70.0  # longer than any bundled loop (32-40 s)
    path = str(tmp_path / "long.mkv")
    write_video(path, np.zeros(int(seconds * RATE)) + 1e-4 * np.sin(np.arange(int(seconds * RATE)) / 7), str(tmp_path / "long.wav"))
    out = str(tmp_path / "out.mp4")
    af.finish_audio(path, out, af.AudioPlan(music=af.bundled_music("calm-pad"), target_lufs=None), str(tmp_path / "work"))
    level = 10 * np.log10(frame_power(read_audio(out), RATE // 2) + 1e-12)
    body = level[6:-6]
    assert body.min() > body.max() - 12, "music drops out somewhere in the middle"
    assert level[0] < body.mean() - 3 and level[-1] < body.mean() - 3


@pytest.mark.parametrize("track", sorted(af.bundled_tracks()))
def test_bundled_tracks_loop_seamlessly(tmp_path, track):
    choice = af.bundled_music(track)
    loop = read_audio(af.prepare_music(choice, str(tmp_path)), channels=2)
    assert loop.shape[1] == choice.loop_samples
    # Played twice in a row, the join is no different from anywhere else in the loop: no click (a click is a sudden
    # bend in the waveform: a large second difference), no jump.
    twice = np.hstack([loop, loop])
    bend = np.abs(np.diff(twice, 2, axis=1)).max(axis=0)
    seam = choice.loop_samples - 1
    assert bend[seam - 2: seam + 1].max() <= np.percentile(bend, 99.9), f"{track}: a click where the loop repeats"
    step = np.abs(np.diff(twice, axis=1)).max(axis=0)
    assert step[seam] <= np.percentile(step, 99.9)
    assert choice.lufs == pytest.approx(-18.0, abs=0.5)
    assert 30 <= choice.loop_samples / RATE <= 60


def test_track_list_matches_the_files():
    with open(os.path.join(af.MUSIC_DIR, "tracks.json"), encoding="utf-8") as handle:
        listing = json.load(handle)["tracks"]
    assert [t["id"] for t in listing] == ["calm-pad", "upbeat-pulse", "lofi-beat", "cinematic-swell"]
    for item in listing:
        assert os.path.isfile(os.path.join(af.MUSIC_DIR, item["file"]))
    assert os.path.isfile(os.path.join(af.MUSIC_DIR, "LICENSE.txt"))


def test_their_clip_is_left_as_it_is_and_can_go_without_music(tmp_path):
    """Remix: the other creator's clip (2-6 s) keeps its own sound exactly; no music plays under it."""
    noisy, _, active = noisy_speech(12.0, -34.0)
    t = np.arange(len(noisy)) / RATE
    their = (t >= 2) & (t < 6)
    source = str(tmp_path / "remix.mkv")
    write_video(source, noisy, str(tmp_path / "remix.wav"))
    plan = af.AudioPlan(voice_cleanup=True, music=af.bundled_music("calm-pad"), keep_windows=[(2.0, 6.0)],
                        quiet_windows=[(2.0, 6.0)], target_lufs=None)
    music, mixed = music_only(tmp_path, source, plan)
    after = read_audio(mixed)[:len(noisy)]
    before = read_audio(source)[:len(after)]
    music = music[:len(after)]
    inside = their[:len(after)] & (t[:len(after)] > 2.1) & (t[:len(after)] < 5.9)
    # Their part: the same sound at the same level (the limiter aside), so the cleanup didn't touch it.
    assert np.corrcoef(before[:len(after)][inside], after[inside])[0, 1] > 0.995
    assert 10 * np.log10(np.mean(after[inside] ** 2) / np.mean(before[:len(after)][inside] ** 2)) == pytest.approx(0, abs=0.5)
    # No music under it, music elsewhere (what's left in their part is the AAC encoder's noise, about -50 dBFS).
    elsewhere = (t[:len(music)] > 7.5) & (t[:len(music)] < 10)
    assert 10 * np.log10(np.mean(music[elsewhere] ** 2) / (np.mean(music[inside[:len(music)]] ** 2) + 1e-20)) > 20
    assert 10 * np.log10(np.mean(music[inside[:len(music)]] ** 2)) < -45
    # And outside it, the member's part was cleaned up.
    speaking, pause = masks(active)
    frame_t = np.arange(len(speaking)) * 0.02
    member = (frame_t < 1.7) | (frame_t > 6.3)
    voice = after - music
    assert speech_to_pause_db(voice, speaking & member, pause & member) > speech_to_pause_db(before, speaking & member, pause & member) + 8


def test_parse_audio_checks_every_field(tmp_path):
    assert af.parse_audio(None) is None
    assert af.parse_audio({"voice_cleanup": False}) is None
    plan = af.parse_audio({"voice_cleanup": True, "music": {"track": "lofi-beat"}, "music_level_db": -24, "music_during_clip": True})
    assert plan.voice_cleanup and plan.music.track == "lofi-beat" and plan.music_level_db == -24 and plan.music_during_clip
    own = tmp_path / "song.mp3"
    own.write_bytes(b"x" * 100)
    assert af.parse_audio({"music": {"path": str(own)}}).music.path == str(own)
    for bad in ({"voice_cleanup": "yes"}, {"music": {"track": "nope"}}, {"music": {"path": "relative.mp3"}},
                {"music": {"path": str(tmp_path / "missing.mp3")}}, {"music": "calm-pad"}, {"music_level_db": -50},
                {"music_level_db": float("nan")}, {"music_during_clip": 1}, []):
        with pytest.raises(ValueError):
            af.parse_audio(bad)
    big = tmp_path / "big.wav"
    with open(big, "wb") as handle:
        handle.truncate(af.MAX_MUSIC_BYTES + 1)
    with pytest.raises(ValueError):
        af.own_music(str(big))
    with pytest.raises(ValueError):
        af.own_music(str(tmp_path / "song.ogg"))


def test_a_failure_keeps_the_video_and_says_so(tmp_path):
    broken = tmp_path / "broken.mp4"
    broken.write_bytes(b"not a video")
    warnings = []
    assert af.finish_in_place(str(broken), af.AudioPlan(voice_cleanup=True, music=af.bundled_music("calm-pad")), str(tmp_path / "w"), warnings) == {
        "voice_cleanup": False, "music": None}
    assert broken.read_bytes() == b"not a video"
    assert warnings == ["The voice cleanup and music couldn't be added this time, so the video keeps its own sound."]


def test_filter_delay_is_measured():
    assert af.filter_delay("anull") == 0
    assert 0 < af.filter_delay("afftdn=nr=12") < 9600
