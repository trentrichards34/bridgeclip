"""Voice cleanup and background music for a finished video (local, free: FFmpeg filters only).

Voice cleanup is deliberately gentle, so it never sounds robotic:
  1. The recording is measured first (its noise floor and its speech level, in 100 ms steps), so every setting
     below fits this recording rather than a guess.
  2. A high-pass at 80 Hz (rumble, desk bumps, hum's lowest part), FFT noise reduction (afftdn) tracking the
     noise, set from the measured signal-to-noise ratio (6-15 dB of reduction: less on a clean recording), and a
     soft downward expander (agate, ratio 2, at most 12 dB) that lowers what's left of the noise and the room's
     echo tail between words without touching the words themselves.
  3. A light de-esser and a gentle compressor (2.5:1) even out the level, then the voice is set to the target
     loudness (two passes: measured with loudnorm, then an exact gain, with a peak limiter for safety).

Background music sits under the voice and ducks while someone talks: the music is looped (bundled tracks loop
seamlessly: see engine/assets/music) or trimmed to the video, faded in and out, and sidechain-compressed by the voice
so it drops about 12 dB under speech and comes back up in pauses. `music_level_db` is how far under the voice it
sits while someone talks (default -20 dB); in pauses it is DUCK_DB louder.

Remix keeps the other creator's clip as it is: `keep_windows` are left out of the cleanup, and `quiet_windows`
have no music.
"""
from __future__ import annotations

import functools
import json
import logging
import math
import os
import re
import shutil
import threading
import wave
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS, media_process, run_media

logger = logging.getLogger(__name__)

MUSIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "music"))
MUSIC_EXTENSIONS = (".mp3", ".wav", ".m4a")
MAX_MUSIC_BYTES = 30 * 1024 * 1024
# Music files: the bundled Ogg Opus tracks and members' own MP3, WAV and M4A (the mov demuxer).
MUSIC_INPUT_OPTIONS = ["-protocol_whitelist", "file,pipe,fd", "-format_whitelist", "ogg,mp3,wav,mov"]
TARGET_LUFS = -14.0
PEAK_LIMIT = 10 ** (-1.5 / 20)
DEFAULT_LEVEL_DB = -20.0
MIN_LEVEL_DB, MAX_LEVEL_DB = -30.0, -10.0
# How much louder the music is in pauses than under speech.
DUCK_DB = 12.0
# Analysis: 16 kHz mono in 100 ms frames.
ANALYSIS_RATE = 16000
FRAME = ANALYSIS_RATE // 10
# Where the cleaned voice sits before its compressor (speech's loud frames, RMS dBFS).
SPEECH_REF_DB = -20.0
TRACK_ID = re.compile(r"[a-z0-9-]{1,40}")
QUIET_SEARCH_S = 120.0
# The format every voice graph works in.
VOICE_FORMAT = "aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS"


class AudioFinishError(Exception):
    """The sound could not be finished; the video keeps its original sound."""


@dataclass
class MusicChoice:
    path: str
    # A bundled loop: the samples to keep (the file has a little extra at each end) and its loudness.
    loop_start: int = 0
    loop_samples: Optional[int] = None
    lufs: Optional[float] = None
    track: str = ""


@dataclass
class AudioPlan:
    voice_cleanup: bool = False
    music: Optional[MusicChoice] = None
    # How far under the voice the music sits while someone talks (dB).
    music_level_db: float = DEFAULT_LEVEL_DB
    # Seconds of the video left exactly as they are (Remix: the other creator's clip): no cleanup there.
    keep_windows: list = field(default_factory=list)
    # Seconds with no music (Remix: "Not during their clip").
    quiet_windows: list = field(default_factory=list)
    # The voice's loudness after cleanup; None keeps the video's own loudness (it was normalized already).
    target_lufs: Optional[float] = TARGET_LUFS
    # Remix: whether the music also plays under the other creator's clip (off: "Not during their clip").
    music_during_clip: bool = False

    @property
    def active(self) -> bool:
        return self.voice_cleanup or self.music is not None

    def summary(self) -> dict:
        """What the edit bundle and run settings record (re-making a video applies the same)."""
        return {"voice_cleanup": self.voice_cleanup, "music": self.music.track if self.music else None,
                "music_level_db": self.music_level_db}


# ---------------------------------------------------------------------------
# Choices from the app
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=1)
def bundled_tracks() -> dict[str, dict]:
    try:
        with open(os.path.join(MUSIC_DIR, "tracks.json"), encoding="utf-8") as handle:
            listing = json.load(handle)["tracks"]
        return {item["id"]: item for item in listing if isinstance(item, dict) and TRACK_ID.fullmatch(str(item.get("id")))}
    except (OSError, ValueError, KeyError, TypeError):
        logger.warning("The bundled music list could not be read")
        return {}


def bundled_music(track: str) -> MusicChoice:
    item = bundled_tracks().get(track)
    if not item:
        raise ValueError("Unknown music track")
    path = os.path.join(MUSIC_DIR, os.path.basename(str(item["file"])))
    if not os.path.isfile(path):
        raise ValueError("The music track is missing")
    return MusicChoice(path=path, loop_start=int(item.get("offset") or 0), loop_samples=int(item["samples"]),
                       lufs=float(item["lufs"]), track=track)


def own_music(path: str) -> MusicChoice:
    """A member's own track (copied into the app's music folder by main): checked again here."""
    if (not isinstance(path, str) or not os.path.isabs(path) or os.path.splitext(path)[1].lower() not in MUSIC_EXTENSIONS
            or not os.path.isfile(path) or os.path.islink(path) or os.path.getsize(path) > MAX_MUSIC_BYTES):
        raise ValueError("Invalid music file")
    return MusicChoice(path=path, track="own")


def parse_audio(raw: object) -> Optional[AudioPlan]:
    """The bridge config's "audio" ({voice_cleanup, music: {track} | {path}, music_level_db, music_during_clip}) or None.
    Raises ValueError for a malformed request."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("Invalid audio options")
    cleanup = raw.get("voice_cleanup", False)
    if type(cleanup) is not bool:
        raise ValueError("Invalid voice cleanup option")
    level = raw.get("music_level_db", DEFAULT_LEVEL_DB)
    if type(level) not in (int, float) or not math.isfinite(level) or not MIN_LEVEL_DB <= level <= MAX_LEVEL_DB:
        raise ValueError("Invalid music level")
    music = raw.get("music")
    choice = None
    if music is not None:
        if not isinstance(music, dict):
            raise ValueError("Invalid music choice")
        if isinstance(music.get("track"), str):
            choice = bundled_music(music["track"])
        elif isinstance(music.get("path"), str):
            choice = own_music(music["path"])
        else:
            raise ValueError("Invalid music choice")
    during = raw.get("music_during_clip", False)
    if type(during) is not bool:
        raise ValueError("Invalid music option")
    plan = AudioPlan(voice_cleanup=cleanup, music=choice, music_level_db=float(level), music_during_clip=during)
    return plan if plan.active else None


# ---------------------------------------------------------------------------
# Measuring
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=1)
def available_filters() -> frozenset[str]:
    """The filters this FFmpeg has (a stage whose filter is missing is left out, never failed)."""
    try:
        result = run_media(["ffmpeg", "-hide_banner", "-filters"], timeout=30)
        text = (result.stdout or b"").decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return frozenset()
    return frozenset(m.group(1) for m in re.finditer(r"^\s*[.A-Z|]{2,3}\s+(\w+)\s+\S+->\S+", text, re.M))


def _in_windows(t: float, windows: list) -> bool:
    return any(a <= t < b for a, b in windows)


def frame_levels(path: str) -> np.ndarray:
    """RMS level (dBFS) of every 100 ms of the audio (mono, 16 kHz), read as a stream (long recordings stay small)."""
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", *MEDIA_INPUT_OPTIONS, "-i", path, "-vn",
           "-ac", "1", "-ar", str(ANALYSIS_RATE), "-f", "s16le", "-"]
    levels: list[np.ndarray] = []
    pending = b""
    with media_process(cmd, timeout=1800) as (process, _stderr):
        while chunk := process.stdout.read(FRAME * 2 * 64):
            pending += chunk
            whole = len(pending) // (FRAME * 2) * FRAME * 2
            if not whole:
                continue
            frames = np.frombuffer(pending[:whole], "<i2").astype(np.float64).reshape(-1, FRAME) / 32768.0
            pending = pending[whole:]
            levels.append(20 * np.log10(np.maximum(np.sqrt(np.mean(frames ** 2, axis=1)), 1e-6)))
    return np.concatenate(levels) if levels else np.zeros(0)


@dataclass
class VoiceProfile:
    noise_db: float
    speech_db: float
    # The longest stretch of plain background noise (seconds), where the noise reduction learns the noise.
    quiet: Optional[tuple[float, float]] = None


def voice_profile(levels: np.ndarray, keep_windows: list = ()) -> VoiceProfile:
    """The noise floor (the quiet 10th percentile of the 100 ms frames, dBFS; digital silence counts as -100), the
    speech level (the loud 90th) and the longest steady quiet stretch, leaving out frames inside keep_windows."""
    times = np.arange(len(levels)) * 0.1
    usable = np.array([not _in_windows(t, list(keep_windows)) for t in times], bool) if len(keep_windows) else np.ones(len(levels), bool)
    clamped = np.maximum(levels, -100.0)
    live = clamped[usable]
    if live.size < 5 or np.percentile(live, 90) <= -90:
        raise AudioFinishError("Too little sound to measure")
    noise, speech = float(np.percentile(live, 10)), float(np.percentile(live, 90))
    # Searched in the first QUIET_SEARCH_S only: the noise reduction hears it first (see cleanup_graph).
    quiet_frames = usable & (clamped <= noise + 3.0) & (clamped > -90) & (times < QUIET_SEARCH_S)
    runs, run_start = [], None
    for i, flag in enumerate([*quiet_frames, False]):
        if flag and run_start is None:
            run_start = i
        elif not flag and run_start is not None:
            runs.append((run_start, i))
            run_start = None
    quiet = None
    # Background noise is steady; soft speech isn't. Only a steady stretch well under the speech is used.
    steady = [(a, b) for a, b in runs if b - a >= 3 and float(np.std(clamped[a:b])) <= 1.5]
    if steady and speech - noise >= 15:
        a, b = max(steady, key=lambda run: run[1] - run[0])
        start = a * 0.1 + 0.05
        quiet = (round(start, 2), round(min(b * 0.1 - 0.05, start + 1.0), 2))
    return VoiceProfile(noise, speech, quiet)


@functools.lru_cache(maxsize=4)
def filter_delay(chain: str) -> int:
    """How many samples `chain` delays the sound at 48 kHz (afftdn does: its FFT window), measured on noise."""
    import tempfile
    noise = (np.random.default_rng(1).uniform(-0.2, 0.2, 2 * 48000) * 32767).astype("<i2")
    with tempfile.TemporaryDirectory(prefix="delay-") as folder:
        probe_in = os.path.join(folder, "noise.wav")
        with wave.open(probe_in, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(48000)
            handle.writeframes(noise.tobytes())
        probe = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", probe_in, "-filter_complex",
                           f"[0:a]asplit=2[a][b];[b]{chain}[c];[a][c]amerge=inputs=2[out]", "-map", "[out]",
                           "-f", "f32le", "-"], timeout=60, max_output=2 * 48000 * 2 * 4 + 1024)
    data = np.frombuffer(probe.stdout or b"", np.float32)
    if probe.returncode != 0 or data.size < 2 * 48000:
        return 0
    pair = data[: data.size // 2 * 2].reshape(-1, 2)
    dry, wet = pair[:48000, 0].astype(np.float64), pair[:48000, 1].astype(np.float64)
    n = len(dry)
    corr = np.fft.irfft(np.fft.rfft(wet, 2 * n) * np.conj(np.fft.rfft(dry, 2 * n)))
    lag = int(np.argmax(corr[: n // 2]))
    return lag if lag < 9600 else 0


def cleanup_graph(source: str, out: str, profile: VoiceProfile, filters: frozenset[str] = frozenset()) -> str:
    """Filtergraph from label `source` (48 kHz, from 0 s) to label `out`: the voice cleaned up, same length and timing."""
    have = filters or available_filters()
    snr = max(0.0, profile.speech_db - profile.noise_db)
    gain = max(-20.0, min(30.0, SPEECH_REF_DB - profile.speech_db))
    noise = profile.noise_db + gain
    head = f"{source}volume={gain:.2f}dB,highpass=f=80:poles=2,lowpass=f=16000:poles=2"
    tail: list[str] = []
    if "afftdn" in have and snr < 60 and noise > -90:
        # Less reduction on a cleaner recording: 15 dB at 12 dB SNR or worse, 8 dB from 40 dB SNR.
        nr = max(8.0, min(15.0, 18.0 - 0.25 * snr))
        denoise = f"afftdn=nr={nr:.1f}:nf={max(-80.0, min(-20.0, noise + 6.0)):.1f}:rf=-60:tn=1"
        delay = filter_delay(f"afftdn=nr={nr:.1f}")
        if profile.quiet and {"asendcmd", "concat", "asplit", "atrim"} <= have:
            # The recording's own quiet stretch is played to the noise reduction first, so it knows the noise from the
            # first word; then that lead-in (and the filter's delay) is cut off again.
            a, b = profile.quiet
            lead = round((b - a) * 48000)
            head += (f",asplit=2[cq][cm];[cq]atrim=start={a:.2f}:end={b:.2f},asetpts=PTS-STARTPTS[cqs];"
                     f"[cqs][cm]concat=n=2:v=0:a=1,asendcmd=c='0.00 afftdn sn start;{max(0.05, (b - a) - 0.02):.2f} afftdn sn stop',"
                     f"{denoise},atrim=start_sample={lead + delay},asetpts=PTS-STARTPTS")
        else:
            head += f",{denoise}" + (f",atrim=start_sample={delay},asetpts=PTS-STARTPTS" if delay else "")
        if delay:
            # afftdn delays the sound by its window: that was cut off the front; pad the end back to length.
            head += f",apad=pad_len={delay}"
    if "agate" in have and snr > 10:
        # A soft expander between words: a little above the noise, well under the speech.
        threshold = min(noise + 6.0, SPEECH_REF_DB - 15.0)
        reduction = min(12.0, 0.4 * snr)
        tail.append(f"agate=threshold={10 ** (threshold / 20):.6f}:ratio=2:range={10 ** (-reduction / 20):.4f}"
                    ":attack=5:release=250:knee=4:detection=rms")
    if "deesser" in have:
        tail.append("deesser=i=0.25:m=0.5:f=0.5")
    if "acompressor" in have:
        tail.append("acompressor=threshold=-26dB:ratio=2.5:attack=8:release=120:knee=4:detection=rms")
    return head + "".join(f",{part}" for part in tail) + out


def _loudness(cmd_inputs: list[str], graph: str = "") -> Optional[float]:
    """Integrated loudness (LUFS) of input 0's sound (in the voice format), or of label [pre] when `graph` makes it;
    None for silence."""
    graph = (graph or f"[0:a]{VOICE_FORMAT}[pre]") + f";[pre]loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json[out]"
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-y", *cmd_inputs, "-filter_complex", graph,
                        "-map", "[out]", "-f", "null", "-"], timeout=1800)
    text = (result.stderr or b"").decode("utf-8", "replace")
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", text)
    if result.returncode != 0 or not match:
        raise AudioFinishError("The sound could not be measured")
    try:
        value = float(json.loads(match.group(0))["input_i"])
    except (ValueError, KeyError, TypeError):
        return None
    return value if math.isfinite(value) and value > -70 else None


def media_seconds(path: str) -> float:
    result = run_media(["ffprobe", "-v", "error", *MEDIA_INPUT_OPTIONS, "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", path], timeout=60)
    try:
        value = float((result.stdout or b"").decode().strip())
    except ValueError:
        value = 0.0
    if not math.isfinite(value) or value <= 0:
        raise AudioFinishError("The video's length could not be read")
    return value


def has_audio(path: str) -> bool:
    result = run_media(["ffprobe", "-v", "error", *MEDIA_INPUT_OPTIONS, "-select_streams", "a", "-show_entries", "stream=index",
                        "-of", "csv=p=0", path], timeout=60)
    return bool((result.stdout or b"").strip())


# ---------------------------------------------------------------------------
# The graph
# ---------------------------------------------------------------------------

def window_mask(windows: list, ramp: float) -> str:
    """An FFmpeg expression of t: 1 inside the windows, 0 well outside, ramping over `ramp` s just outside each."""
    terms = [f"clip(min(t-{a:.3f}+{ramp:.3f},{b:.3f}+{ramp:.3f}-t)/{ramp:.3f},0,1)" for a, b in windows]
    return f"min(1,{'+'.join(terms)})" if terms else "0"


def voice_graph(plan: AudioPlan, cleanup: Optional[VoiceProfile], clean_gain_db: float, orig_gain_db: float,
                filters: frozenset[str] = frozenset()) -> str:
    """[0:a] -> [voice]: cleaned (and set to its loudness), with keep_windows taken from the original."""
    if cleanup is None:
        return f"[0:a]{VOICE_FORMAT},volume={orig_gain_db:.2f}dB[voice]"
    if not plan.keep_windows:
        return f"[0:a]{VOICE_FORMAT}[src];" + cleanup_graph("[src]", "[cleaned]", cleanup, filters) + f";[cleaned]volume={clean_gain_db:.2f}dB[voice]"
    mask = window_mask(plan.keep_windows, 0.03)
    return (f"[0:a]{VOICE_FORMAT},asplit=2[orig][src];" + cleanup_graph("[src]", "[cleaned]", cleanup, filters) +
            f";[cleaned]volume={clean_gain_db:.2f}dB,asetnsamples=n=480:p=0,volume='1-{mask}':eval=frame[clean];"
            f"[orig]volume={orig_gain_db:.2f}dB,asetnsamples=n=480:p=0,volume='{mask}':eval=frame[kept];"
            "[clean][kept]amix=inputs=2:normalize=0:duration=first[voice]")


def music_graph(plan: AudioPlan, seconds: float, music_gain_db: float, voice_lufs: float) -> str:
    """[voice] + [1:a] -> [mix]: the music trimmed to the video, faded, ducked under the voice."""
    fade_in = min(1.5, seconds / 4)
    fade_out = min(2.0, seconds / 4)
    quiet = ""
    if plan.quiet_windows:
        quiet = f",asetnsamples=n=480:p=0,volume='1-{window_mask(plan.quiet_windows, 0.5)}':eval=frame"
    # The key is the voice at its final level. With the threshold DUCK_DB + 2 dB under its loudness and a 20:1 ratio,
    # the music drops about DUCK_DB under speech and comes back up within half a second of a pause.
    threshold = 10 ** ((voice_lufs - DUCK_DB - 2.0) / 20)
    return (f"[voice]asplit=2[spoken][key];"
            f"[1:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=N/SR/TB,atrim=duration={seconds:.3f},"
            f"volume={music_gain_db:.2f}dB,afade=t=in:st=0:d={fade_in:.3f},afade=t=out:st={max(0.0, seconds - fade_out):.3f}:d={fade_out:.3f}"
            f"{quiet}[bed];"
            f"[bed][key]sidechaincompress=threshold={threshold:.6f}:ratio=20:attack=15:release=400:knee=3:detection=rms[ducked];"
            f"[spoken][ducked]amix=inputs=2:normalize=0:duration=first[mix]")


# Bundled loops: the first LOOP_BLEND samples are blended with what the file holds right after the loop (the same
# music, decoded continuing on from the loop's end), so the lossy codec's tiny differences don't click at the join.
LOOP_BLEND = 2400


def prepare_music(choice: MusicChoice, work: str) -> str:
    """The music as a file to loop: a bundled track decoded to exactly its loop (so it repeats with no seam)."""
    if choice.loop_samples is None:
        return choice.path
    os.makedirs(work, exist_ok=True)
    out = os.path.join(work, f"music-{choice.track}.wav")
    if os.path.isfile(out):
        return out
    # Clips render in parallel: each writes its own part file, and the finished file is swapped in whole.
    part = f"{out}.{os.getpid()}-{threading.get_ident()}.part.wav"
    need = choice.loop_samples + LOOP_BLEND
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", *MUSIC_INPUT_OPTIONS, "-i", choice.path,
                        "-af", f"aresample=48000,atrim=start_sample={choice.loop_start}:end_sample={choice.loop_start + need}",
                        "-ac", "2", "-f", "f32le", "-"], timeout=300, max_output=need * 8 + 4096)
    data = np.frombuffer(result.stdout or b"", "<f4")
    if result.returncode != 0 or data.size < need * 2:
        raise AudioFinishError("The music could not be read")
    pcm = data[: need * 2].reshape(-1, 2).astype(np.float64)
    loop = pcm[: choice.loop_samples].copy()
    ramp = np.linspace(0.0, 1.0, LOOP_BLEND, endpoint=False)[:, None]
    loop[:LOOP_BLEND] = loop[:LOOP_BLEND] * ramp + pcm[choice.loop_samples:] * (1 - ramp)
    with wave.open(part, "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(48000)
        handle.writeframes((np.clip(loop, -1, 1) * 32767).round().astype("<i2").tobytes())
    os.replace(part, out)
    return out


def finish_audio(source: str, output: str, plan: AudioPlan, work: str, audio_args: Optional[list] = None) -> dict:
    """Write `output`: `source`'s picture as is, its sound cleaned up and/or with music under it.
    Returns what was done ({"voice_cleanup": bool, "music": track or None}). Raises AudioFinishError."""
    os.makedirs(work, exist_ok=True)
    if not has_audio(source):
        raise AudioFinishError("The video has no sound")
    seconds = media_seconds(source)
    filters = available_filters()
    inputs = [*MEDIA_INPUT_OPTIONS, "-i", source]
    profile: Optional[VoiceProfile] = None
    if plan.voice_cleanup:
        profile = voice_profile(frame_levels(source), plan.keep_windows)
        logger.info(f"Voice cleanup: noise {profile.noise_db:.1f} dBFS, speech {profile.speech_db:.1f} dBFS, quiet {profile.quiet}")
    original = _loudness(inputs) if (profile is None or plan.keep_windows or plan.target_lufs is None) else None
    cleaned = (_loudness(inputs, f"[0:a]{VOICE_FORMAT}[src];" + cleanup_graph("[src]", "[pre]", profile, filters))
               if profile is not None else original)
    target = plan.target_lufs if plan.target_lufs is not None else original
    clamp = lambda value: max(-24.0, min(24.0, value))  # noqa: E731
    clean_gain = clamp(target - cleaned) if (target is not None and cleaned is not None) else 0.0
    orig_gain = clamp(target - original) if (target is not None and original is not None and plan.target_lufs is not None) else 0.0
    voice_lufs = target if target is not None else TARGET_LUFS
    graph = voice_graph(plan, profile, clean_gain, orig_gain, filters)
    music_inputs: list[str] = []
    if plan.music is not None and "sidechaincompress" in filters:
        music_path = prepare_music(plan.music, work)
        music_lufs = plan.music.lufs
        if music_lufs is None:
            music_lufs = _loudness([*MUSIC_INPUT_OPTIONS, "-t", "120", "-i", music_path]) or -18.0
        level = max(MIN_LEVEL_DB, min(MAX_LEVEL_DB, plan.music_level_db))
        music_gain = clamp(voice_lufs + level + DUCK_DB - music_lufs)
        music_inputs = ["-stream_loop", "-1", *MUSIC_INPUT_OPTIONS, "-i", music_path]
        graph += ";" + music_graph(plan, seconds, music_gain, voice_lufs)
    elif plan.music is not None:
        logger.warning("Music left out: this FFmpeg has no sidechaincompress filter")
        graph += ";[voice]anull[mix]"
    else:
        graph += ";[voice]anull[mix]"
    limiter = f"alimiter=limit={PEAK_LIMIT:.4f}:attack=5:release=60:level=0:latency=1" if "alimiter" in filters else "anull"
    graph += f";[mix]{limiter},aresample=48000[a]"
    extension = os.path.splitext(output)[1].lower() or ".mp4"
    partial = output + ".audio.part" + extension
    container = ["-movflags", "+faststart"] if extension in (".mp4", ".mov", ".m4v") else []
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *inputs, *music_inputs,
                        "-filter_complex", graph, "-map", "0:v?", "-map", "[a]", "-c:v", "copy",
                        *(audio_args or ["-c:a", "aac", "-b:a", "192k"]), "-ar", "48000", "-t", f"{seconds:.3f}",
                        "-map_metadata", "0", *container, partial], timeout=3600)
    if result.returncode != 0:
        logger.warning(f"Audio finishing failed: {(result.stderr or b'')[-600:]!r}")
        try:
            os.remove(partial)
        except OSError:
            pass
        raise AudioFinishError("The sound could not be finished")
    os.replace(partial, output)
    return {"voice_cleanup": profile is not None, "music": plan.music.track if plan.music is not None and music_inputs else None}


def finish_in_place(path: str, plan: AudioPlan, work: str, warnings: Optional[list] = None) -> dict:
    """finish_audio over `path` itself. On any failure the video keeps its sound, with a warning for the member."""
    try:
        return finish_audio(path, path, plan, work)
    except Exception as error:  # noqa: BLE001 - the video is still good with its own sound
        logger.warning(f"Voice cleanup / music skipped: {type(error).__name__}: {error}")
        if warnings is not None:
            what = " and ".join(x for x in ("voice cleanup" if plan.voice_cleanup else "", "music" if plan.music else "") if x)
            warnings.append(f"The {what} couldn't be added this time, so the video keeps its own sound.")
        return {"voice_cleanup": False, "music": None}


# ---------------------------------------------------------------------------
# Kept with a run, so a video made again later (the editor, a new hook) sounds the same
# ---------------------------------------------------------------------------

RUN_AUDIO_DIR = ".audio"
RUN_AUDIO_FILE = "audio.json"


def save_run_audio(root: str, plan: AudioPlan) -> None:
    """Keep the run's choices and its own copy of the music (the member's file may be deleted later)."""
    folder = os.path.join(root, RUN_AUDIO_DIR)
    os.makedirs(folder, exist_ok=True)
    music = None
    if plan.music is not None:
        name = "music" + os.path.splitext(plan.music.path)[1].lower()
        target = os.path.join(folder, name)
        if os.path.abspath(plan.music.path) != os.path.abspath(target):
            shutil.copyfile(plan.music.path, target + ".part")
            os.replace(target + ".part", target)
        music = {"file": name, "track": plan.music.track, "loop_start": plan.music.loop_start,
                 "loop_samples": plan.music.loop_samples, "lufs": plan.music.lufs}
    data = {"version": 1, "voice_cleanup": plan.voice_cleanup, "music": music, "music_level_db": plan.music_level_db,
            "music_during_clip": plan.music_during_clip}
    with open(os.path.join(folder, RUN_AUDIO_FILE + ".tmp"), "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    os.replace(os.path.join(folder, RUN_AUDIO_FILE + ".tmp"), os.path.join(folder, RUN_AUDIO_FILE))


def load_run_audio(root: str) -> Optional[AudioPlan]:
    """The run's saved choices (save_run_audio), or None when it had none (or they can't be read)."""
    folder = os.path.join(str(root), RUN_AUDIO_DIR)
    try:
        with open(os.path.join(folder, RUN_AUDIO_FILE), encoding="utf-8") as handle:
            data = json.load(handle)
        level = float(data.get("music_level_db", DEFAULT_LEVEL_DB))
        music = None
        saved = data.get("music")
        if isinstance(saved, dict):
            path = os.path.join(folder, os.path.basename(str(saved["file"])))
            if os.path.isfile(path) and not os.path.islink(path):
                samples = saved.get("loop_samples")
                music = MusicChoice(path=path, loop_start=int(saved.get("loop_start") or 0),
                                    loop_samples=int(samples) if samples else None,
                                    lufs=float(saved["lufs"]) if saved.get("lufs") is not None else None,
                                    track=str(saved.get("track") or "own")[:40])
        plan = AudioPlan(voice_cleanup=data.get("voice_cleanup") is True, music=music,
                         music_level_db=max(MIN_LEVEL_DB, min(MAX_LEVEL_DB, level)),
                         music_during_clip=data.get("music_during_clip") is True)
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return plan if plan.active else None
