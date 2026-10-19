"""Pause & react: the member is the main picture; the video they react to plays in a box and
pauses on a held frame whenever they talk, then carries on when they stop.

Two ways in:
- Recorded in the app: the recorder logs when the member paused and played the original
  (recording time <-> original time), so the timeline is exact.
- A phone recording: the member paused the original (playing elsewhere) whenever they talked.
  detect_pauses() works the timeline out from the sound: talking = paused, quiet = playing, and
  where the phone mic hears the original at the expected spot it is playing (even if loud).

The assembled "original" track (assemble_original + mix_audio) has exactly the recording's length:
play stretches are the original's own frames and sound; pause stretches hold the frame the
original stopped on, in silence, while the member's voice plays at full level.
"""

from __future__ import annotations

import math
import os
import wave
from dataclasses import dataclass
from typing import Any, Optional

from clip_engine.services.media_process import run_media

FPS = 30
# The longest Pause & react video (and the longest recording used for one).
MAX_SECONDS = 300
MAX_SEGMENTS = 600
# A trimmed original can be longer than the video (the member stops before its end).
MAX_TRIM_SECONDS = 3600
MEDIA_GUARD = ["-protocol_whitelist", "file,pipe,fd", "-format_whitelist", "mov,matroska,webm,avi,flv,mpegts,wav,mp3"]

# Detection (phone recordings): mono 8 kHz, a decision every HOP_S from WINDOW_S of sound.
DETECT_RATE = 8000
HOP_S = 0.1
WINDOW_S = 0.5
# Normalized correlation between the phone's sound and the original's at the expected spot.
MATCH_SCORE = 0.3
LAG_S = 0.15
# Lost track of the original (talked over it, or a quiet pause): searched for again, up to this much of it at once.
REACQUIRE_SCORE = 0.42
REACQUIRE_S = 20.0
OFFSET_TEMPLATE_S = 3
OFFSET_SEARCH_S = 60
OFFSET_MIN_SCORE = 0.25

# Mixing: 48 kHz mono; the member's mic while the original plays (laughs, "wow") is kept but lowered.
MIX_RATE = 48000
DUCK_APP = 0.35
# A phone mic also hears the original from the speaker: kept low so it doesn't echo the clean original.
DUCK_UPLOAD = 0.1
RAMP_S = 0.02
# Segments read per FFmpeg call when assembling (each is its own seeked input, decoded with at most
# DECODE_THREADS threads, so a long 4K original doesn't hold dozens of decoders' frames at once).
VIDEO_BATCH = 10
DECODE_THREADS = 2


class PauseReactError(Exception):
    """A plain-language problem with a pause-and-react timeline or its files."""


@dataclass
class Segment:
    """A stretch of the recording (seconds) and what the original does meanwhile: 'play' from `at`
    (seconds into the original video) or 'pause' holding the frame at `at`."""
    start: float
    end: float
    kind: str
    at: float

    @property
    def length(self) -> float:
        return self.end - self.start


@dataclass
class Timeline:
    start: float
    end: float
    trim_start: float
    trim_end: float
    source: str
    segments: list[Segment]

    @property
    def duration(self) -> float:
        return self.end - self.start


def _number(value: Any, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise PauseReactError("The pause timeline is damaged. Record or upload your reaction again.")
    return float(value)


def parse_timeline(raw: Any) -> Timeline:
    """A timeline from the app, checked: contiguous segments from `start` to `end` (at most MAX_SECONDS),
    each 'play' or 'pause', with the original's time where it begins. Raises PauseReactError."""
    bad = "The pause timeline is damaged. Record or upload your reaction again."
    if not isinstance(raw, dict) or not set(raw) <= {"start", "end", "trim_start", "trim_end", "source", "segments"}:
        raise PauseReactError(bad)
    start = _number(raw.get("start"), 0, 4 * 3600)
    end = _number(raw.get("end"), 0, 4 * 3600)
    trim_start = _number(raw.get("trim_start"), 0, 4 * 3600)
    trim_end = _number(raw.get("trim_end"), 0, 4 * 3600)
    if end - start < 0.5 or end - start > MAX_SECONDS + 0.5 or trim_end - trim_start < 0.5 or trim_end - trim_start > MAX_TRIM_SECONDS:
        raise PauseReactError(bad)
    source = raw.get("source")
    if source not in ("app", "upload"):
        raise PauseReactError(bad)
    items = raw.get("segments")
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_SEGMENTS:
        raise PauseReactError(bad)
    segments: list[Segment] = []
    cursor = start
    for item in items:
        if not isinstance(item, dict) or set(item) != {"start", "end", "kind", "at"} or item.get("kind") not in ("play", "pause"):
            raise PauseReactError(bad)
        a, b = _number(item["start"], 0, 4 * 3600), _number(item["end"], 0, 4 * 3600)
        at = _number(item["at"], 0, 4 * 3600)
        if abs(a - cursor) > 0.002 or b <= a:
            raise PauseReactError(bad)
        segments.append(Segment(cursor, b, item["kind"], min(max(at, trim_start), trim_end)))
        cursor = b
    if abs(cursor - end) > 0.002:
        raise PauseReactError(bad)
    segments[-1].end = end
    return Timeline(start, end, trim_start, trim_end, source, merge_segments(segments))


def merge_segments(segments: list[Segment]) -> list[Segment]:
    """Neighbors that are really one stretch: two pauses on the same frame, or a play that continues the last."""
    out: list[Segment] = []
    for seg in segments:
        if out:
            last = out[-1]
            same_pause = seg.kind == last.kind == "pause" and abs(seg.at - last.at) < 0.5 / FPS
            continued = seg.kind == last.kind == "play" and abs(seg.at - (last.at + last.length)) < 0.5 / FPS
            if same_pause or continued:
                last.end = seg.end
                continue
        out.append(Segment(seg.start, seg.end, seg.kind, seg.at))
    return out


def frame_counts(timeline: Timeline) -> list[int]:
    """Frames per segment, from frame-rounded boundaries, so they add up to exactly the video's frames."""
    marks = [round((seg.start - timeline.start) * FPS) for seg in timeline.segments] + [round(timeline.duration * FPS)]
    return [max(0, b - a) for a, b in zip(marks, marks[1:])]


def original_positions(timeline: Timeline, source_seconds: float) -> list[tuple[str, float, int]]:
    """(kind, where in the original, frames) for each segment that has frames. A play that runs past the trim's end
    (or the original's) holds its last frame: it becomes a play of what's left plus a hold."""
    limit = min(timeline.trim_end, source_seconds)
    last = max(0.0, limit - 1.5 / FPS)
    pieces: list[tuple[str, float, int]] = []
    previous = ""
    for seg, frames in zip(timeline.segments, frame_counts(timeline)):
        kind_before, previous = previous, seg.kind
        if frames <= 0:
            continue
        at = min(max(seg.at, 0.0), last)
        if seg.kind == "play":
            available = int(max(0.0, limit - at) * FPS)
            if available >= frames:
                pieces.append(("play", at, frames))
                continue
            if available >= 1:
                pieces.append(("play", at, available))
            pieces.append(("pause", last, frames - available))
        else:
            # After a play: the frame showing when they paused (the one just before the play would carry on).
            # Before anything played (their intro), the clip's first frame.
            # (Past the end, the last frame, as a play running out holds.)
            pieces.append(("pause", max(0.0, at - 1.0 / FPS) if kind_before == "play" and seg.at < last else at, frames))
    return pieces


def _ffmpeg(args: list[str], timeout: float = 1800) -> None:
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args], timeout=timeout)
    if result.returncode != 0:
        raise PauseReactError("Putting the video together failed.")


def packet_count(path: str) -> int:
    result = run_media(["ffprobe", "-v", "error", *MEDIA_GUARD, "-select_streams", "v:0", "-count_packets", "-show_entries",
                        "stream=nb_read_packets", "-of", "csv=p=0", path], timeout=300)
    try:
        return int((result.stdout or b"").decode().strip().split(",")[0])
    except ValueError:
        return 0


def assemble_original(video: str, timeline: Timeline, source_seconds: float, look: str, out: str, work: str,
                      video_args: list[str]) -> str:
    """The original's picture on the recording's timeline (no sound): its own frames while it plays, the
    paused frame held while the member talks. Exactly round(duration * FPS) frames, so it lines up with them."""
    pieces = original_positions(timeline, source_seconds)
    total = sum(frames for *_, frames in pieces)
    if not pieces or total <= 0:
        raise PauseReactError("Your reaction is too short to use. Record it again.")
    chunks: list[str] = []
    for batch_index in range(0, len(pieces), VIDEO_BATCH):
        batch = pieces[batch_index:batch_index + VIDEO_BATCH]
        inputs: list[str] = []
        filters: list[str] = []
        for i, (kind, at, frames) in enumerate(batch):
            span = frames / FPS if kind == "play" else 0.4
            # Accurate seeking (decoding from the previous keyframe) half a frame early: the first frame is the one at `at`
            # even when `at` is a rounded frame time.
            inputs += ["-threads", str(DECODE_THREADS), "-ss", f"{max(0.0, at - 0.5 / FPS):.4f}", "-t", f"{span + 0.25:.4f}", *MEDIA_GUARD, "-i", video]
            if kind == "play":
                chain = f"fps={FPS},{look},tpad=stop_mode=clone:stop={frames},trim=end_frame={frames}"
            else:
                chain = f"fps={FPS},{look},trim=end_frame=1,tpad=stop_mode=clone:stop={frames - 1}"
            filters.append(f"[{i}:v:0]{chain},setpts=PTS-STARTPTS[s{i}]")
        graph = ";".join(filters) + ";" + "".join(f"[s{i}]" for i in range(len(batch))) + f"concat=n={len(batch)}:v=1:a=0[v]"
        chunk = out if len(pieces) <= VIDEO_BATCH else os.path.join(work, f"original-{batch_index // VIDEO_BATCH:03d}.mp4")
        _ffmpeg([*inputs, "-filter_complex", graph, "-map", "[v]", "-an", *video_args, chunk])
        chunks.append(chunk)
    if len(chunks) > 1:
        listing = os.path.join(work, "original-chunks.txt")
        with open(listing, "w", encoding="utf-8") as handle:
            for chunk in chunks:
                handle.write("file '" + chunk.replace("'", "'\\''") + "'\n")
        _ffmpeg(["-f", "concat", "-safe", "0", "-protocol_whitelist", "file,pipe,fd", "-i", listing, "-c", "copy", out])
    made = packet_count(out)
    if made != total:
        # A frame short or long somewhere (an unusual source): fitted to the exact length, holding the last frame.
        fixed = os.path.join(work, "original-fitted.mp4")
        _ffmpeg([*MEDIA_GUARD, "-i", out, "-vf", f"tpad=stop_mode=clone:stop={max(0, total - made) + 2},trim=end_frame={total},setpts=PTS-STARTPTS",
                 "-an", *video_args, fixed])
        os.replace(fixed, out)
    return out


def pcm(path: str, start: float, seconds: float, rate: int, af: str = "") -> Any:
    """Mono float32 samples of a file's sound from `start` (empty when it has none)."""
    import numpy as np
    limit = int(seconds * rate * 2) + 65536
    filters = "aresample=async=1:first_pts=0" + (f",{af}" if af else "")
    result = run_media(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{max(0.0, start):.3f}", *MEDIA_GUARD, "-i", path,
                        "-t", f"{seconds:.3f}", "-map", "0:a:0", "-vn", "-af", filters, "-ac", "1", "-ar", str(rate),
                        "-f", "s16le", "-"], timeout=600, max_output=limit)
    data = (result.stdout or b"") if result.returncode == 0 else b""
    data = data[:len(data) // 2 * 2]
    return np.frombuffer(data, np.int16).astype(np.float32) / 32768.0


def _smooth(values: Any, width: int) -> Any:
    """A centered moving average (the gain ramps at the joins)."""
    import numpy as np
    if width <= 1:
        return values
    padded = np.concatenate([np.full(width, values[0]), values, np.full(width, values[-1])])
    sums = np.cumsum(np.concatenate([[0.0], padded]))
    averaged = (sums[width:] - sums[:-width]) / width
    offset = width // 2
    return averaged[width - offset:width - offset + len(values)].astype(np.float32)


def mix_audio(original: Optional[Any], original_base: float, member: Any, timeline: Timeline, duck: float,
              source_seconds: float, rate: int = MIX_RATE) -> Any:
    """The finished sound (mono float32, exactly the timeline's length): the original's own sound while it plays
    (silence while paused), the member at full level while it's paused and at `duck` while it plays. Joins ramp
    over RAMP_S so nothing clicks. `original` holds the original's samples from `original_base` seconds."""
    import numpy as np
    total = int(round(timeline.duration * rate))
    mixed = np.zeros(total, np.float32)
    gain_member = np.ones(total, np.float32)
    limit = min(timeline.trim_end, source_seconds)
    ramp = max(2, int(RAMP_S * rate))
    half = ramp // 2
    for seg in timeline.segments:
        a = int(round((seg.start - timeline.start) * rate))
        b = min(total, int(round((seg.end - timeline.start) * rate)))
        if b <= a or seg.kind != "play":
            continue
        gain_member[a:b] = duck
        if original is None or not len(original):
            continue
        # This stretch of the original, reaching half a ramp past each end (so its fades are centered on the joins),
        # faded in and out: joins never click, and a jump in the original crossfades.
        first = int(round((seg.at - original_base) * rate))
        playable = max(0, min(b - a, int((limit - seg.at) * rate)))
        if playable <= 0:
            continue
        lo = max(0, first - half, first - a)
        hi = min(len(original), first + playable + half, first + (total - a))
        if hi <= lo:
            continue
        piece = original[lo:hi].astype(np.float32).copy()
        fade = min(ramp, len(piece) // 2)
        if fade > 0:
            window = np.linspace(0.0, 1.0, fade, dtype=np.float32)
            piece[:fade] *= window
            piece[-fade:] *= window[::-1]
        mixed[a + (lo - first):a + (hi - first)] += piece
    gain_member = _smooth(gain_member, ramp)
    if member is not None and len(member):
        voice = np.zeros(total, np.float32)
        voice[:min(total, len(member))] = member[:total]
        mixed = mixed + voice * gain_member
    return np.clip(mixed, -1.0, 1.0).astype(np.float32)


def write_wav(samples: Any, path: str, rate: int = MIX_RATE) -> str:
    import numpy as np
    data = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(data)
    return path


def has_audio(path: str) -> bool:
    result = run_media(["ffprobe", "-v", "error", *MEDIA_GUARD, "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path], timeout=60)
    return bool((result.stdout or b"").strip())


def build_original_track(video: str, member_media: str, timeline: Timeline, source_seconds: float, look: str, out: str,
                         work: str, video_args: list[str], audio_args: list[str], loudnorm: str) -> str:
    """The original on the recording's timeline with the finished sound (theirs and the member's), as one file."""
    picture = assemble_original(video, timeline, source_seconds, look, os.path.join(work, "original-picture.mp4"), work, video_args)
    played = [seg for seg in timeline.segments if seg.kind == "play"]
    original = None
    base = timeline.trim_start
    if played and has_audio(video):
        base = max(0.0, min(seg.at for seg in played))
        reach = min(min(timeline.trim_end, source_seconds), max(seg.at + seg.length for seg in played))
        if reach > base:
            original = pcm(video, base, reach - base + 0.1, MIX_RATE, loudnorm)
    member = pcm(member_media, 0.0, timeline.duration + 0.1, MIX_RATE, f"highpass=f=80,{loudnorm}") if has_audio(member_media) else None
    sound = mix_audio(original, base, member, timeline, DUCK_APP if timeline.source == "app" else DUCK_UPLOAD, source_seconds)
    wav = write_wav(sound, os.path.join(work, "pause-react-mix.wav"))
    _ffmpeg(["-i", picture, "-i", wav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", "alimiter=limit=0.95",
             *audio_args, "-t", f"{timeline.duration:.3f}", out])
    return out


# ---------------------------------------------------------------------------
# Phone recordings: working out the pauses from the sound
# ---------------------------------------------------------------------------

def _emphasis(samples: Any) -> Any:
    import numpy as np
    if len(samples) < 2:
        return samples
    return np.append(samples[0], samples[1:] - 0.97 * samples[:-1]).astype(np.float32)


def voice_activity(samples: Any, rate: int = DETECT_RATE) -> Any:
    """Per HOP_S: is there sound clearly above the recording's own background (someone talking, or the original
    playing loud enough to hear)? An adaptive threshold: 12 dB over the quietest tenth, at least -55 dBFS."""
    import numpy as np
    hop = int(HOP_S * rate)
    frame = int(0.02 * rate)
    count = len(samples) // hop
    if count == 0:
        return np.zeros(0, bool)
    framed = samples[:len(samples) // frame * frame].reshape(-1, frame) if len(samples) >= frame else np.zeros((0, frame))
    levels = 20 * np.log10(np.sqrt(np.mean(framed.astype(np.float64) ** 2, axis=1)) + 1e-9) if len(framed) else np.zeros(0)
    if not len(levels):
        return np.zeros(count, bool)
    threshold = max(float(np.percentile(levels, 10)) + 12.0, -55.0)
    loud = levels > threshold
    per_hop = hop // frame
    voiced = np.array([loud[i * per_hop:(i + 1) * per_hop].mean() > 0.3 if i * per_hop < len(loud) else False for i in range(count)])
    # Bridge the short gaps between words (up to 0.3 s), then drop lone blips (under 0.2 s).
    voiced = _fill_runs(voiced, False, 3)
    return _fill_runs(voiced, True, 1)


def _fill_runs(flags: Any, value: bool, max_len: int) -> Any:
    """Runs of `value` no longer than max_len hops, between runs of the other value, flipped."""
    out = flags.copy()
    i, n = 0, len(flags)
    while i < n:
        if flags[i] == value:
            j = i
            while j < n and flags[j] == value:
                j += 1
            if j - i <= max_len and i > 0 and j < n:
                out[i:j] = not value
            i = j
        else:
            i += 1
    return out


def _ncc(template: Any, haystack: Any) -> tuple[int, float]:
    """Best normalized correlation of template inside haystack: (lag in samples, score)."""
    import numpy as np
    n, m = len(template), len(haystack)
    if n == 0 or m < n:
        return 0, 0.0
    template = template - template.mean()
    energy = float(np.sqrt(np.sum(template * template)))
    if energy < 1e-4:
        return 0, 0.0
    size = 1 << int(math.ceil(math.log2(n + m)))
    corr = np.fft.irfft(np.fft.rfft(haystack, size) * np.conj(np.fft.rfft(template, size)), size)[:m - n + 1]
    sums = np.concatenate([[0.0], np.cumsum(haystack.astype(np.float64) ** 2)])
    local = np.sqrt(np.maximum(sums[n:n + m - n + 1] - sums[:m - n + 1], 0.0))
    # Near-silent stretches of the haystack match nothing (and would divide by almost zero).
    floor = 0.05 * float(np.sqrt(np.mean(haystack.astype(np.float64) ** 2))) * math.sqrt(n) + 1e-6
    score = np.where(local > floor, corr / (energy * local + 1e-6), 0.0)
    best = int(np.argmax(score))
    return best, float(score[best])


def find_offset(original: Any, phone: Any, rate: int = DETECT_RATE) -> tuple[Optional[float], float]:
    """Where the original's opening sound is heard in the phone recording (seconds) and how sure (0..1)."""
    from clip_engine.services.remix_service import find_audio_offset
    template = original[:int(OFFSET_TEMPLATE_S * rate)]
    return find_audio_offset(template, phone[:int((OFFSET_SEARCH_S + OFFSET_TEMPLATE_S) * rate)], rate, OFFSET_SEARCH_S)


def analyze(phone: Any, original: Any, rate: int = DETECT_RATE, offset: Optional[float] = None) -> dict:
    """The pause timeline of a phone recording, from its sound and the trimmed original's.

    Each HOP_S of the recording is 'play' or 'pause': before the original starts (the offset) it is paused on its
    first frame; afterwards it plays where the phone hears the original at the expected spot, pauses where the
    member talks, and plays through quiet. Returns {"duration", "offset", "confidence", "aligned_by", "raw":
    [[start, end, kind], ...], "first_voice", "last_voice"}."""
    import numpy as np
    phone = np.asarray(phone, np.float32)
    original = np.asarray(original, np.float32)
    duration = len(phone) / rate
    confidence = 0.0
    aligned_by = "start"
    if offset is None:
        found, confidence = find_offset(original, phone, rate) if len(original) >= rate and len(phone) >= rate else (None, 0.0)
        if found is not None and confidence >= OFFSET_MIN_SCORE:
            offset, aligned_by = float(found), "sound"
        else:
            offset = 0.0
    else:
        aligned_by = "given"
    hop = int(HOP_S * rate)
    window = int(WINDOW_S * rate)
    lag = int(LAG_S * rate)
    hops = len(phone) // hop
    voiced = voice_activity(phone, rate)
    phone_e = _emphasis(phone)
    original_e = _emphasis(original)
    original_level = float(np.sqrt(np.mean(original.astype(np.float64) ** 2))) if len(original) else 0.0
    kinds = ["pause"] * hops
    start_hop = int(math.ceil(offset / HOP_S - 1e-6))
    # The original's sample heard at the start of each hop (it starts at the offset).
    pointer = max(0, start_hop * hop - int(round(offset * rate)))
    centre = hop // 2 - window // 2
    # The last hop where the phone clearly heard the original where expected, and the pointer after it.
    matched_hop, matched_pointer = start_hop - 1, pointer
    for h in range(start_hop, hops):
        t = h * hop
        if pointer >= len(original):
            # The original has ended: it holds its last frame whatever happens.
            kinds[h] = "pause" if voiced[h] else "play"
            continue
        o0 = max(0, pointer + centre)
        piece = original_e[o0:pointer + centre + window]
        expected = t + (o0 - pointer)
        p0 = max(0, expected - lag)
        heard = phone_e[p0:expected + len(piece) + lag]
        level = original[o0:pointer + centre + window]
        active = len(piece) >= hop and float(np.sqrt(np.mean(level.astype(np.float64) ** 2))) > 0.15 * original_level
        best, score = _ncc(piece, heard) if active and len(heard) >= len(piece) else (0, 0.0)
        if active and score >= MATCH_SCORE:
            kind = "play"
            # Follow small drifts (the phone's clock, a stutter in the player): heard later means it's behind.
            pointer = max(0, pointer - ((p0 + best) - expected))
        elif voiced[h]:
            kind = "pause"
            between = h - matched_hop - 1
            if active and between >= 2 and h % 3 == 0:
                # Lost it: the original is somewhere between where it was last heard and where it would be had it played
                # all along (talked over while it kept playing, or paused in a quiet moment taken for playing).
                lo = max(0, matched_pointer + centre - int(0.5 * rate))
                hi = min(len(original_e), matched_pointer + centre + between * hop + int(0.5 * rate) + window, lo + int(REACQUIRE_S * rate))
                heard_now = phone_e[max(0, t + centre):t + centre + window]
                found, found_score = _ncc(heard_now, original_e[lo:hi]) if len(heard_now) == window and hi - lo > window else (0, 0.0)
                if found_score >= REACQUIRE_SCORE:
                    position = lo + found - centre
                    played = max(0, min(between, (position - matched_pointer) // hop))
                    stretch = list(range(matched_hop + 1, h))
                    # Of the hops since, `played` were playing: the talking ones are taken as the pauses first.
                    pauses = set([i for i in stretch if voiced[i]][:between - played])
                    pauses |= set([i for i in reversed(stretch) if not voiced[i]][:between - played - len(pauses)])
                    for i in stretch:
                        kinds[i] = "pause" if i in pauses else "play"
                    pointer = max(0, position)
                    kind = "play"
        else:
            kind = "play"
        kinds[h] = kind
        if kind == "play":
            pointer += hop
            if active and (score >= MATCH_SCORE or voiced[h]):
                matched_hop, matched_pointer = h, pointer
    raw: list[list[Any]] = []
    for h, kind in enumerate(kinds):
        a, b = round(h * HOP_S, 3), round((h + 1) * HOP_S, 3)
        if raw and raw[-1][2] == kind:
            raw[-1][1] = b
        else:
            raw.append([a, b, kind])
    if raw:
        raw[-1][1] = round(duration, 3)
    talk = np.flatnonzero(voiced)
    return {"duration": round(duration, 3), "offset": round(float(offset), 3), "confidence": round(float(confidence), 3),
            "aligned_by": aligned_by, "raw": raw,
            "first_voice": round(float(talk[0]) * HOP_S, 3) if len(talk) else None,
            "last_voice": round(float(talk[-1] + 1) * HOP_S, 3) if len(talk) else None}


def detect_pauses(recording: str, source: str, trim_start: float, trim_end: float) -> dict:
    """detect_pauses on files: the phone recording (up to MAX_SECONDS and a little) and the trimmed original."""
    phone = pcm(recording, 0.0, MAX_SECONDS + 30, DETECT_RATE) if has_audio(recording) else None
    if phone is None or len(phone) < DETECT_RATE:
        raise PauseReactError("We couldn’t hear anything in your recording. Upload one with sound.")
    span = max(0.5, min(trim_end - trim_start, MAX_SECONDS + 30))
    original = pcm(source, trim_start, span, DETECT_RATE) if has_audio(source) else []
    return analyze(phone, original)
