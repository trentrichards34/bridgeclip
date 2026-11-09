"""
Audio tightening: the raw TTS take made snappy, with the word clock moved onto the final audio.

  1. Pauses: FFmpeg silencedetect (-35 dB, at least 0.45 s). Each such pause is cut down so 0.28 s of it remains,
     cut symmetrically around its midpoint (half the kept pause on each side, so the breath stays natural).
  2. Ends: the head is trimmed to 0.06 s before the first word, the tail to 0.3 s after the last.
  3. Speed: the joined audio is time-stretched by a speed factor (default x1.15) with pitch kept (atempo).
  4. Loudness: two-pass loudnorm to -14 LUFS integrated, -1.5 dBTP, LRA 11; mono, 192 kbps when written as MP3.

Every word time goes through the same cut list and is divided by the speed, so captions and cues sit on the FINAL
audio clock. The plan (kept spans + speed) is a small JSON-able object: a timing-only change (new speed, different
pause length) re-cuts the saved raw take with no new TTS call.
"""

from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass, field
from typing import Optional

from clip_engine.services.media_process import run_media

NOISE_DB = -35.0
MIN_PAUSE_S = 0.45
KEEP_PAUSE_S = 0.28
HEAD_S = 0.06
TAIL_S = 0.3
DEFAULT_SPEED = 1.15
MIN_SPEED, MAX_SPEED = 0.5, 2.0
TARGET_LUFS, TARGET_TP, TARGET_LRA = -14.0, -1.5, 11.0
SAMPLE_RATE = 44100
# 5 ms fades at every join so a cut never clicks; they change no durations.
JOIN_FADE_S = 0.005
# Local files only; the raw take is MP3 (TTS) or WAV.
AUDIO_GUARD = ["-protocol_whitelist", "file,pipe,fd", "-format_whitelist", "mp3,wav,mov,matroska,webm,ogg,flac"]


class TightenError(RuntimeError):
    """The audio could not be measured or re-cut."""


@dataclass
class TightenPlan:
    """What to keep of the raw take (source seconds, in order) and how fast to play it."""
    source_duration: float
    keeps: list[tuple[float, float]]
    speed: float = DEFAULT_SPEED
    silences: list[tuple[float, float]] = field(default_factory=list)

    @property
    def cuts(self) -> list[tuple[float, float]]:
        """The removed spans (source seconds), the complement of `keeps`."""
        out, at = [], 0.0
        for a, b in self.keeps:
            if a > at + 1e-9:
                out.append((at, a))
            at = b
        if self.source_duration > at + 1e-9:
            out.append((at, self.source_duration))
        return out

    @property
    def tightened_duration(self) -> float:
        """Length after the cuts, before the speed change."""
        return sum(b - a for a, b in self.keeps)

    @property
    def final_duration(self) -> float:
        return self.tightened_duration / self.speed

    def remap(self, t: float) -> float:
        """A source time on the final audio clock. A time inside a cut lands on the join."""
        out = 0.0
        for a, b in self.keeps:
            if t <= a:
                break
            if t < b:
                return (out + t - a) / self.speed
            out += b - a
        return out / self.speed

    def remap_words(self, words: list[dict]) -> list[dict]:
        timed = []
        for w in words:
            start = self.remap(float(w["start"]))
            end = max(start, self.remap(float(w["end"])))
            timed.append({**w, "start": round(start, 3), "end": round(end, 3)})
        return timed

    def to_dict(self) -> dict:
        return {"source_duration": self.source_duration, "keeps": [list(k) for k in self.keeps], "speed": self.speed,
                "silences": [list(s) for s in self.silences]}

    @classmethod
    def from_dict(cls, data: dict) -> "TightenPlan":
        return cls(source_duration=float(data["source_duration"]),
                   keeps=[(float(a), float(b)) for a, b in data["keeps"]],
                   speed=float(data.get("speed", DEFAULT_SPEED)),
                   silences=[(float(a), float(b)) for a, b in data.get("silences", [])])


def probe_duration(path: str) -> float:
    result = run_media(["ffprobe", "-v", "error", *AUDIO_GUARD, "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       timeout=60)
    try:
        value = float((result.stdout or b"").decode().strip())
    except ValueError:
        raise TightenError("The voice audio could not be read.") from None
    if not math.isfinite(value) or value <= 0:
        raise TightenError("The voice audio is empty.")
    return value


def detect_silences(path: str, noise_db: float = NOISE_DB, min_s: float = MIN_PAUSE_S,
                    duration: Optional[float] = None) -> list[tuple[float, float]]:
    """Silent spans (seconds) of at least `min_s` below `noise_db`. A silence still open at the end runs to the end."""
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", *AUDIO_GUARD, "-i", path,
                        "-af", f"silencedetect=noise={noise_db}dB:d={min_s}", "-f", "null", "-"], timeout=600)
    if result.returncode != 0:
        raise TightenError("The voice audio could not be scanned for pauses.")
    text = (result.stderr or b"").decode("utf-8", "replace")
    spans: list[tuple[float, float]] = []
    start: Optional[float] = None
    for kind, value in re.findall(r"silence_(start|end):\s*(-?[\d.]+)", text):
        if kind == "start":
            start = max(0.0, float(value))
        elif start is not None:
            spans.append((start, float(value)))
            start = None
    if start is not None:
        spans.append((start, duration if duration is not None else probe_duration(path)))
    return spans


def _merge(spans: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out: list[list[float]] = []
    for a, b in sorted(spans):
        if b <= a:
            continue
        if out and a <= out[-1][1] + 1e-9:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def plan_cuts(silences: list[tuple[float, float]], words: list[dict], duration: float, speed: float = DEFAULT_SPEED,
              min_pause: float = MIN_PAUSE_S, keep_pause: float = KEEP_PAUSE_S, head: float = HEAD_S,
              tail: float = TAIL_S) -> TightenPlan:
    """The cut list for a take: shortened pauses plus the trimmed head and tail."""
    if not (MIN_SPEED <= speed <= MAX_SPEED):
        raise TightenError(f"Speed must be between {MIN_SPEED} and {MAX_SPEED}.")
    cuts: list[tuple[float, float]] = []
    first = min((float(w["start"]) for w in words), default=None)
    last = max((float(w["end"]) for w in words), default=None)
    for a, b in silences:
        a, b = max(0.0, a), min(duration, b)
        length = b - a
        if length + 1e-9 < min_pause or length <= keep_pause:
            continue
        # Lead-in and run-out silence belong to the head / tail rules, which keep their own margins.
        if (first is not None and (a + b) / 2 < first) or (last is not None and (a + b) / 2 > last):
            continue
        mid, half_cut = (a + b) / 2, (length - keep_pause) / 2
        cuts.append((mid - half_cut, mid + half_cut))
    if first is not None and last is not None:
        if first - head > 0:
            cuts.append((0.0, first - head))
        if last + tail < duration:
            cuts.append((last + tail, duration))
    keeps, at = [], 0.0
    for a, b in _merge(cuts):
        if a > at:
            keeps.append((round(at, 4), round(a, 4)))
        at = max(at, b)
    if duration > at:
        keeps.append((round(at, 4), round(duration, 4)))
    if not keeps:
        raise TightenError("Nothing would be left of the voice after tightening.")
    return TightenPlan(source_duration=duration, keeps=keeps, speed=speed, silences=list(silences))


def _tempo_chain(speed: float) -> str:
    if abs(speed - 1.0) < 1e-6:
        return "anull"
    return f"atempo={speed:.6f}"


def _graph(plan: TightenPlan) -> str:
    """Filter graph: the kept spans joined (with tiny fades), then the tempo change. Output label [t]."""
    parts, labels = [], []
    for i, (a, b) in enumerate(plan.keeps):
        length = b - a
        fade = min(JOIN_FADE_S, length / 4)
        parts.append(f"[0:a]atrim=start={a:.4f}:end={b:.4f},asetpts=PTS-STARTPTS,"
                     f"afade=t=in:d={fade:.4f},afade=t=out:st={max(0.0, length - fade):.4f}:d={fade:.4f}[k{i}]")
        labels.append(f"[k{i}]")
    joined = "".join(labels) + f"concat=n={len(labels)}:v=0:a=1[j]"
    return ";".join([*parts, joined, f"[j]aformat=channel_layouts=mono,{_tempo_chain(plan.speed)}[t]"])


def _measure(src: str, graph: str) -> dict:
    """Pass one of loudnorm. Empty when the audio is silent (nothing to normalize)."""
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", *AUDIO_GUARD, "-i", src, "-filter_complex",
                        graph + f";[t]loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json[m]",
                        "-map", "[m]", "-f", "null", "-"], timeout=1800)
    text = (result.stderr or b"").decode("utf-8", "replace")
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", text)
    if result.returncode != 0 or not match:
        raise TightenError("The voice could not be measured for loudness.")
    data = json.loads(match.group(0))
    try:
        measured = {k: float(data[k]) for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")}
    except (KeyError, TypeError, ValueError):
        raise TightenError("The voice could not be measured for loudness.") from None
    return measured if all(math.isfinite(v) for v in measured.values()) else {}


def _loudnorm(measured: dict) -> str:
    if not measured:
        return "anull"
    return (f"loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA={TARGET_LRA}:measured_I={measured['input_i']}:"
            f"measured_TP={measured['input_tp']}:measured_LRA={measured['input_lra']}:"
            f"measured_thresh={measured['input_thresh']}:offset={measured['target_offset']}:linear=true")


def render(src: str, plan: TightenPlan, out_path: str) -> str:
    """Writes the tightened, sped-up, normalized voice. MP3 (192 kbps mono) or WAV by extension."""
    graph = _graph(plan)
    measured = _measure(src, graph)
    final = graph + f";[t]{_loudnorm(measured)},aresample={SAMPLE_RATE}[out]"
    codec = ["-c:a", "pcm_s16le"] if out_path.lower().endswith(".wav") else ["-c:a", "libmp3lame", "-b:a", "192k"]
    tmp = out_path + ".part" + os.path.splitext(out_path)[1]
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *AUDIO_GUARD, "-i", src,
                        "-filter_complex", final, "-map", "[out]", "-ac", "1", "-ar", str(SAMPLE_RATE), *codec, tmp],
                       timeout=1800)
    if result.returncode != 0 or not os.path.exists(tmp):
        if os.path.exists(tmp):
            os.remove(tmp)
        raise TightenError("The voice could not be tightened.")
    os.replace(tmp, out_path)
    return out_path


def tighten(src: str, words: list[dict], out_path: str, speed: float = DEFAULT_SPEED,
            plan: Optional[TightenPlan] = None, **plan_options) -> dict:
    """Tighten the raw take `src` whose raw word times are `words`.

    Returns {words, plan, duration}: the words on the final clock, the plan to keep (re-time with
    `retime` later without a new TTS call) and the planned final length in seconds. Pass `plan` to reuse a saved cut
    list as it is.
    """
    if plan is None:
        duration = probe_duration(src)
        silences = detect_silences(src, duration=duration)
        plan = plan_cuts(silences, words, duration, speed=speed, **plan_options)
    render(src, plan, out_path)
    return {"words": plan.remap_words(words), "plan": plan.to_dict(), "duration": round(plan.final_duration, 3)}


def retime(src: str, words: list[dict], saved_plan: dict, out_path: str, speed: Optional[float] = None,
           **plan_options) -> dict:
    """Re-cut the saved raw take with new timing settings, reusing the saved silence scan (no TTS, no re-scan)."""
    old = TightenPlan.from_dict(saved_plan)
    plan = plan_cuts(old.silences, words, old.source_duration, speed=old.speed if speed is None else speed, **plan_options)
    return tighten(src, words, out_path, plan=plan)
