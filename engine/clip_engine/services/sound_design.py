"""Sound design: recorded sound effects that follow what happens on screen.

Every sound has a cause in the picture (HyperFrames' sound rules): a whoosh for a scene change or a big card moving
in fast, a soft key tick for text arriving line by line, a pop for a badge or a number landing, a click for a pointer
pressing a button, an impact for a big word slamming in, and one riser into the payoff (the call to action), once.

1. Cues come from the timeline (`events`): each graphic's entrance (and a big one's exit), stage scene changes, the
   hook text, b-roll cuts and punch-in zooms. The AI's planned sounds are only extras that must pass the same rules
   (and only while a graphic or b-roll is on screen: a stretch of plain talking stays clean).
2. plan_sounds picks which cues sound, in priority order, keeping them apart (a register sets how far and how many:
   teaching gets the most, a personal story little, minimal only the hook, scene changes and the biggest moments).
   Each sound's peak lands one frame (33 ms) after its picture; takes rotate so no two neighbors repeat; the member's
   own sounds for an action ("My sounds") are used before the built-in ones.
3. The mix: each hit sits a few dB over the music bed and under the voice (levels from the member's music setting),
   then the whole sound is set to -14 LUFS with true peaks under -1 dBTP (measured first, then one exact gain and a
   limiter at 4x the rate).

The built-in sounds are in engine/assets/sfx (manifest.json: each file's action, take, peak and level; LICENSE.txt:
where each came from, all CC0 or our own).
"""
from __future__ import annotations

import functools
import json
import logging
import math
import os
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

import numpy as np

from clip_engine.services.media_process import MEDIA_INPUT_OPTIONS, run_media

logger = logging.getLogger(__name__)

SFX_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets", "sfx"))
FX_CATALOG = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "fx_catalog.json"))
RATE = 48000
ACTIONS = ("whoosh", "swipe", "pop", "tick", "click", "impact", "riser", "paper")
REGISTERS = ("teaching", "story", "minimal")
DEFAULT_REGISTER = "teaching"
# Light reaches the eye before sound reaches the ear: a sound's peak lands one frame after its picture.
FRAME_MS = 33
TARGET_LUFS = -14.0
TARGET_TP = -1.5
TARGET_LRA = 11.0
MAX_PLACEMENTS = 80
# Members' own sounds: the same audio types as their music (plus Ogg), kept short.
OWN_EXTENSIONS = (".mp3", ".wav", ".m4a", ".ogg")
MAX_OWN_BYTES = 5 * 1024 * 1024
MAX_OWN_SECONDS = 4.0
MAX_OWN_RISER_SECONDS = 6.0
SOUND_INPUT_OPTIONS = ["-protocol_whitelist", "file,pipe,fd", "-format_whitelist", "ogg,mp3,wav,mov"]


class SoundDesignError(Exception):
    """The sound effects could not be mixed; the video keeps its sound as it was."""


# ---------------------------------------------------------------------------
# The library
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Sound:
    path: str
    action: str
    peak_ms: int
    duration_ms: int
    level_db: float
    own: bool = False


@functools.lru_cache(maxsize=4)
def library(folder: str = SFX_DIR) -> dict[str, tuple[Sound, ...]]:
    """The built-in sounds by action, in take order (from manifest.json)."""
    with open(os.path.join(folder, "manifest.json"), encoding="utf-8") as handle:
        manifest = json.load(handle)
    out: dict[str, list[Sound]] = {action: [] for action in ACTIONS}
    for item in sorted(manifest["sounds"], key=lambda s: (s["action"], s["take"])):
        if item["action"] in out and re.fullmatch(r"[a-z]+/[a-z0-9-]+\.ogg", item["file"]):
            out[item["action"]].append(Sound(os.path.join(folder, item["file"]), item["action"], int(item["peak_ms"]),
                                             int(item["duration_ms"]), float(item["level_db"])))
    return {action: tuple(sounds) for action, sounds in out.items()}


def decode(path: str, max_seconds: float) -> np.ndarray:
    """A sound file as mono float samples (RATE Hz), at most `max_seconds` long."""
    limit = int(max_seconds * RATE) + RATE // 10
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", *SOUND_INPUT_OPTIONS, "-i", path,
                        "-t", f"{max_seconds + 0.1:.2f}", "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
                       timeout=60, max_output=limit * 4 + 4096)
    if result.returncode != 0:
        raise SoundDesignError("The sound could not be read")
    return np.frombuffer(result.stdout or b"", "<f4").astype(np.float64)


def measure(samples: np.ndarray) -> tuple[int, int, float]:
    """(peak ms, duration ms, level dB): the loudest 5 ms from the start, the length, the loudest 100 ms (RMS dBFS; a
    shorter sound counts as 100 ms with silence after it, as it sounds in the mix).
    The same measures as the built-in library's (scripts/sfx/build_library.py)."""
    if samples.size == 0 or not np.any(samples):
        raise SoundDesignError("The sound is silent")
    window = int(0.005 * RATE)
    energy = np.convolve(samples ** 2, np.ones(window) / window, mode="same")
    peak = int(round(int(np.argmax(energy)) / RATE * 1000))
    window = int(0.1 * RATE)
    padded = np.pad(samples, (0, max(0, window - samples.size)))
    level = 10 * math.log10(max(float(np.convolve(padded ** 2, np.ones(window) / window, mode="valid").max()), 1e-12))
    return peak, int(round(samples.size / RATE * 1000)), round(level, 2)


def own_sound(path: str, action: str) -> Sound:
    """A member's sound (from "My sounds"), checked: a known action, an audio file of a known type, small and short."""
    if action not in ACTIONS:
        raise SoundDesignError("Unknown action")
    if not isinstance(path, str) or not os.path.isabs(path) or os.path.splitext(path)[1].lower() not in OWN_EXTENSIONS:
        raise SoundDesignError("Not a sound file")
    if os.path.islink(path) or not os.path.isfile(path) or not 0 < os.path.getsize(path) <= MAX_OWN_BYTES:
        raise SoundDesignError("The sound file is missing or too big")
    longest = MAX_OWN_RISER_SECONDS if action == "riser" else MAX_OWN_SECONDS
    samples = decode(path, longest)
    if samples.size > longest * RATE:
        raise SoundDesignError("The sound is too long")
    peak, duration, level = measure(samples)
    return Sound(path, action, peak, duration, level, own=True)


def palette_of(raw: Any, warnings: Optional[list] = None) -> dict[str, tuple[Sound, ...]]:
    """The member's own sounds by action ([{path, action}], from main); ones that can't be used are left out."""
    out: dict[str, list[Sound]] = {}
    skipped = 0
    for item in (raw if isinstance(raw, list) else [])[:200]:
        try:
            if not isinstance(item, dict):
                raise SoundDesignError("Malformed")
            sound = own_sound(item.get("path"), item.get("action"))
        except (SoundDesignError, OSError) as error:
            logger.info(f"Own sound left out: {error}")
            skipped += 1
            continue
        out.setdefault(sound.action, []).append(sound)
    if skipped and warnings is not None:
        warnings.append(f"{skipped} of your sounds couldn't be used (each must be an MP3, WAV, M4A or Ogg file under "
                        f"{int(MAX_OWN_SECONDS)} seconds), so built-in sounds played instead.")
    return {action: tuple(sorted(sounds, key=lambda s: os.path.basename(s.path).lower())) for action, sounds in out.items()}


@functools.lru_cache(maxsize=2)
def fx_hints(path: str = FX_CATALOG) -> dict[str, tuple[str, Optional[float]]]:
    """The 'fx' effects' sound hints: effect id -> (sound or 'none', its main beat in seconds or None). Empty when the
    catalog isn't there."""
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    out = {}
    for effect in data.get("effects") or []:
        if isinstance(effect, dict) and isinstance(effect.get("id"), str):
            sync = effect.get("sync_s")
            out[effect["id"]] = (str(effect.get("sound") or "none"), float(sync) if isinstance(sync, (int, float)) and sync > 0 else None)
    return out


# ---------------------------------------------------------------------------
# Cues: what happens on screen
# ---------------------------------------------------------------------------

# The sound each graphic makes as it arrives.
TEMPLATE_SOUND = {
    "stat": "pop", "title": "impact", "list": "whoosh", "lower_third": "swipe", "logo": "pop", "before_after": "whoosh",
    "checklist": "whoosh", "quote": "tick", "highlight": "swipe", "statement": "tick", "sticky_notes": "paper",
    "strike_list": "whoosh", "browser_frame": "whoosh", "icon_pop": "pop", "headline_pill": "tick", "comment_cta": "tick",
    "link_cta": "click", "big_words": "impact", "orbit": "pop", "feature_tile": "pop", "screen_frame": "whoosh",
    "chapter": "whoosh", "staircase": "whoosh", "funnel": "whoosh", "journey": "whoosh", "growth": "whoosh",
    "idea_hub": "pop", "compare_marks": "whoosh",
    # Edit my recording's own layers: half-screen cards, number/keyword pop-ups and pinned images.
    "card": "whoosh", "popup": "pop", "pin": "pop",
}
# The moments that matter most (and the ones a minimal register keeps).
BIG_TEMPLATES = frozenset({"title", "big_words", "stat", "statement", "chapter", "card", "staircase", "funnel", "journey",
                           "growth", "idea_hub", "compare_marks"})
CTA_TEMPLATES = frozenset({"link_cta", "comment_cta"})
# The AI's planned sound names (edit_recording's plan): the action each stands for. No tones: a "ding" is a pop.
AI_SOUND_ACTION = {"whoosh": "whoosh", "pop": "pop", "click": "click", "ding": "pop", "thud": "impact"}
EVENT_KINDS = ("hook", "graphic", "scene", "broll", "punch", "extra")
PRIORITY = {"cta": 95, "hook": 90, "scene": 80, "big": 75, "graphic": 70, "broll": 55, "scene_out": 50, "graphic_out": 40,
            "punch": 30, "extra": 20}


@dataclass
class Cue:
    at_ms: int
    action: str
    kind: str
    priority: int
    # Where the sound may cause a riser in front of it (the payoff).
    payoff: bool = False
    big: bool = False
    # A graphic's time on screen (extras need one around them).
    window: Optional[tuple[int, int]] = None


@dataclass(frozen=True)
class Register:
    min_gap_ms: int
    # At most one sound per this many seconds, on average.
    per_seconds: float
    kinds: frozenset
    trim_db: float
    riser: bool
    skip_actions: frozenset = frozenset()


REGISTER = {
    "teaching": Register(1200, 4.0, frozenset({"hook", "graphic", "graphic_out", "scene", "scene_out", "broll", "punch", "extra"}), 0.0, True),
    # A personal story: only what the picture does, softer and sparser; no typing or clicks, no riser.
    "story": Register(2500, 8.0, frozenset({"hook", "graphic", "scene"}), -3.0, False, frozenset({"tick", "click"})),
    # Minimal: the hook, scene changes and the biggest moments.
    "minimal": Register(3000, 10.0, frozenset({"hook", "scene", "big", "cta"}), -1.0, False, frozenset({"tick"})),
}


def _int(value: Any, lo: int, hi: int) -> Optional[int]:
    if type(value) in (int, float) and math.isfinite(value) and lo <= value <= hi:
        return int(round(value))
    return None


def cues_from_events(events: Iterable[Any], total_ms: int) -> list[Cue]:
    """Cues (on the video's clock) from timeline events, each {kind, at_ms, ...}:
    - graphic: template, end_ms, optional size ('compact' | 'card' | 'stage'), effect (an 'fx' unit) and sound (a hint
      that wins over the template's own sound; 'none' for silence)
    - scene: a stage scene, at_ms to end_ms (a whoosh in, and one back to the speaker)
    - hook: the hook text arriving; broll: a b-roll shot cutting in; punch: a punch-in zoom
    - extra: one of the AI's planned sounds (sound: its name)
    Anything malformed is left out."""
    hints = fx_hints()
    cues: list[Cue] = []
    for event in list(events)[:400]:
        if not isinstance(event, dict) or event.get("kind") not in EVENT_KINDS:
            continue
        at = _int(event.get("at_ms"), 0, total_ms)
        if at is None or at >= total_ms:
            continue
        kind = event["kind"]
        end = _int(event.get("end_ms"), at, 10 ** 9)
        if kind == "hook":
            cues.append(Cue(at, "swipe", "hook", PRIORITY["hook"]))
        elif kind == "broll":
            cues.append(Cue(at, "whoosh", "broll", PRIORITY["broll"], window=(at, end or at + 1500)))
        elif kind == "punch":
            cues.append(Cue(at, "swipe", "punch", PRIORITY["punch"]))
        elif kind == "scene":
            cues.append(Cue(at, "whoosh", "scene", PRIORITY["scene"], window=(at, end or at)))
            if end is not None and end < total_ms - 300:
                cues.append(Cue(end, "whoosh", "scene_out", PRIORITY["scene_out"]))
        elif kind == "extra":
            action = AI_SOUND_ACTION.get(event.get("sound"))
            if action:
                cues.append(Cue(at, action, "extra", PRIORITY["extra"]))
        else:
            template = event.get("template") if isinstance(event.get("template"), str) else ""
            size = event.get("size") if event.get("size") in ("compact", "card", "stage") else "card"
            action = TEMPLATE_SOUND.get(template)
            land = at
            wants_riser = event.get("sound") == "riser"
            if template == "fx" and isinstance(event.get("effect"), str) and event["effect"] in hints:
                hint, sync = hints[event["effect"]]
                wants_riser = wants_riser or hint == "riser"
                action = None if hint == "none" else ("pop" if hint == "riser" else hint)
                if sync is not None and end is not None and at + sync * 1000 < end:
                    land = at + int(sync * 1000)
            if event.get("sound") == "none":
                action = None
            elif event.get("sound") in ACTIONS and event["sound"] != "riser":
                action = event["sound"]
            elif wants_riser and action is None:
                action = "pop"
            if action is None:
                continue
            if action == "whoosh" and size == "compact":
                # A small card doesn't move a lot of air.
                action = "swipe"
            cta = template in CTA_TEMPLATES
            big = template in BIG_TEMPLATES or size == "stage"
            kind_ = "cta" if cta else "big" if big else "graphic"
            cues.append(Cue(land, action, "graphic", PRIORITY[kind_], payoff=cta or wants_riser, big=big or cta,
                            window=(at, end or at + 1500)))
            if size == "stage" and end is not None and end < total_ms - 300:
                # A big card leaving the stage moves air too.
                cues.append(Cue(end, "whoosh", "graphic_out", PRIORITY["graphic_out"]))
    return cues


# ---------------------------------------------------------------------------
# The plan
# ---------------------------------------------------------------------------

@dataclass
class Placement:
    sound: Sound
    action: str
    kind: str
    # Where the sound's peak lands, where the file starts playing and how much of its start is skipped (ms).
    peak_at_ms: int
    start_ms: int
    trim_ms: int
    gain_db: float = 0.0

    def as_dict(self) -> dict:
        return {"action": self.action, "kind": self.kind, "peak_ms": self.peak_at_ms, "start_ms": self.start_ms,
                "file": os.path.basename(self.sound.path), "own": self.sound.own, "gain_db": round(self.gain_db, 1)}


# Each hit's level against the others: the big hits a little louder, typing well down.
ACTION_TRIM = {"impact": 1.0, "whoosh": 0.0, "riser": 0.0, "pop": -1.0, "swipe": -2.0, "paper": -2.0, "click": -3.0, "tick": -5.0}
KIND_TRIM = {"punch": -3.0, "graphic_out": -3.0, "scene_out": -2.0, "extra": -2.0, "broll": -1.0}
# The voice's loudest 100 ms sit about this far over its integrated loudness.
VOICE_PEAK_OVER_LUFS = 3.0


def hit_level_db(action: str, kind: str, register: str, music_db: Optional[float], voice_lufs: float = TARGET_LUFS) -> float:
    """Where a hit's loudest 100 ms sits (RMS dBFS). With music: about 4.5 dB over the bed where it is loudest (in a
    pause), but never closer than 3 dB under the voice; with none, 6 dB under the voice. Then each action's own trim,
    and the register's."""
    voice = voice_lufs + VOICE_PEAK_OVER_LUFS
    if music_db is None:
        base = voice - 6.0
    else:
        bed = voice + float(music_db) + 12.0
        base = max(voice - 9.0, min(voice - 3.0, bed + 4.5))
    return base + ACTION_TRIM.get(action, 0.0) + KIND_TRIM.get(kind, 0.0) + REGISTER[register].trim_db


def _far_enough(peak: int, taken: list[tuple[int, int]], gap: int) -> bool:
    return all(peak < a - gap or peak > b + gap for a, b in taken)


def plan_sounds(cues: list[Cue], total_ms: int, register: str = DEFAULT_REGISTER, music_db: Optional[float] = None,
                palette: Optional[dict] = None, sounds: Optional[dict] = None) -> list[Placement]:
    """Which cues sound, with which take, where and how loud (sorted by time).

    The register keeps only its kinds of cue, then cues are taken in priority order (ties: earlier first) while they
    are at least its gap apart and under its count (one per `per_seconds` on average). An extra (the AI's pick) needs a
    graphic, a scene or b-roll on screen around it. Teaching gets one riser into the payoff (the call to action, or an
    effect that asks for one): it ends on the payoff's peak, which becomes an impact, and nothing else plays during it.
    """
    if register not in REGISTER:
        register = DEFAULT_REGISTER
    rule = REGISTER[register]
    sounds = sounds or library()
    palette = palette or {}
    windows = [c.window for c in cues if c.window and c.kind != "extra"]
    eligible: list[Cue] = []
    for cue in cues:
        group = "cta" if cue.payoff and cue.kind == "graphic" else "big" if cue.big and cue.kind == "graphic" else cue.kind
        if cue.kind not in rule.kinds and group not in rule.kinds:
            continue
        if cue.action in rule.skip_actions:
            continue
        if cue.kind == "extra" and not any(a - 300 <= cue.at_ms <= b for a, b in windows):
            continue
        if not 0 <= cue.at_ms < total_ms - 150:
            continue
        eligible.append(cue)
    limit = max(1, math.ceil(total_ms / 1000 / rule.per_seconds))
    taken: list[tuple[int, int]] = []
    chosen: list[tuple[Cue, str, Optional[Sound]]] = []
    choose = lambda action: (palette.get(action) or sounds.get(action) or ())  # noqa: E731
    # The riser first: the payoff is the one moment worth building to.
    if rule.riser:
        payoff = next((c for c in sorted(eligible, key=lambda c: (-c.priority, c.at_ms)) if c.payoff), None)
        risers = choose("riser")
        if payoff is not None and risers:
            riser = risers[0]
            peak = payoff.at_ms + FRAME_MS
            if peak - riser.peak_ms >= 0:
                taken.append((peak - riser.peak_ms, peak))
                chosen.append((Cue(payoff.at_ms, "riser", payoff.kind, payoff.priority), "riser", riser))
                chosen.append((payoff, "impact", None))
                eligible.remove(payoff)
    for cue in sorted(eligible, key=lambda c: (-c.priority, c.at_ms)):
        if len(chosen) - sum(1 for c in chosen if c[1] == "riser") >= limit:
            break
        peak = cue.at_ms + FRAME_MS
        if not _far_enough(peak, taken, rule.min_gap_ms):
            continue
        taken.append((peak, peak))
        chosen.append((cue, cue.action, None))
    # Takes rotate per action through time, so neighbors never repeat (the member's own come first when they have any).
    used: dict[str, int] = {}
    out: list[Placement] = []
    for cue, action, fixed in sorted(chosen, key=lambda item: (item[0].at_ms, item[1] != "riser")):
        takes = choose(action)
        if not takes:
            continue
        sound = fixed or takes[used.get(action, 0) % len(takes)]
        if fixed is None:
            used[action] = used.get(action, 0) + 1
        peak = cue.at_ms + FRAME_MS
        start = peak - sound.peak_ms
        trim = max(0, -start)
        if trim > sound.duration_ms * 0.6 or start >= total_ms - 100:
            continue
        out.append(Placement(sound, action, cue.kind, peak, max(0, start), trim,
                             hit_level_db(action, cue.kind, register, music_db) - sound.level_db))
    return out[:MAX_PLACEMENTS]


# ---------------------------------------------------------------------------
# The mix
# ---------------------------------------------------------------------------

def mix_graph(placements: list[Placement], first_input: int = 1, voice: str = "[0:a]") -> str:
    """[voice] + one input per placement (in order, from `first_input`) -> [mix]: each sound trimmed, set to its gain
    and delayed to its place, summed under the voice (no normalizing: the levels are already set)."""
    graph = f"{voice}aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[voice]"
    labels = ["[voice]"]
    for k, p in enumerate(placements):
        delay = int(p.start_ms)
        gain = max(-40.0, min(12.0, p.gain_db))
        trim = f"atrim=start={p.trim_ms / 1000:.3f},asetpts=PTS-STARTPTS," if p.trim_ms else ""
        graph += (f";[{first_input + k}:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,"
                  f"{trim}volume={gain:.2f}dB,adelay={delay}|{delay}[s{k}]")
        labels.append(f"[s{k}]")
    if len(labels) > 1:
        graph += f";{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=first:dropout_transition=0[mix]"
    else:
        graph += ";[voice]anull[mix]"
    return graph


def sound_inputs(placements: list[Placement]) -> list[str]:
    return [arg for p in placements for arg in (*SOUND_INPUT_OPTIONS, "-i", p.sound.path)]


def measure_loudness(inputs: list[str], graph: str) -> dict:
    """Pass one of loudnorm on [mix]: integrated, true peak, range, threshold and offset ({} for silence)."""
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-nostats", "-y", *inputs, "-filter_complex",
                        graph + f";[mix]loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json[out]",
                        "-map", "[out]", "-f", "null", "-"], timeout=1800)
    text = (result.stderr or b"").decode("utf-8", "replace")
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", text)
    if result.returncode != 0 or not match:
        raise SoundDesignError("The sound could not be measured for loudness")
    data = json.loads(match.group(0))
    try:
        parsed = {key: float(data.get(key)) for key in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")}
    except (TypeError, ValueError):
        raise SoundDesignError("The sound could not be measured for loudness") from None
    return parsed if all(math.isfinite(v) for v in parsed.values()) else {}


# The AAC encode can overshoot between samples: a limiter at 4x the rate (close to true peak) keeps them under -1 dBTP.
TRUE_PEAK_GUARD = "aresample=192000,alimiter=limit=0.75:attack=1:release=50:level=0:latency=1,aresample=48000"


def loudnorm_filter(measured: dict) -> str:
    """Pass two: one exact gain to the target (loudnorm's own second pass turns dynamic on short or peaky clips and
    misses it), then the true-peak guard for the few peaks the gain pushes up."""
    if not measured:
        return TRUE_PEAK_GUARD
    gain = max(-24.0, min(24.0, TARGET_LUFS - measured["input_i"]))
    return f"volume={gain:.2f}dB,{TRUE_PEAK_GUARD}"


def mix_into(video: str, placements: list[Placement], out: str) -> dict:
    """`out`: `video`'s picture as is, its sound with the placements mixed under it, then set to -14 LUFS (two passes).
    Returns the first pass's measurements."""
    inputs = [*MEDIA_INPUT_OPTIONS, "-i", video, *sound_inputs(placements)]
    graph = mix_graph(placements)
    measured = measure_loudness(inputs, graph)
    extension = os.path.splitext(out)[1].lower()
    container = ["-movflags", "+faststart"] if extension in (".mp4", ".mov", ".m4v") else []
    result = run_media(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex",
                        graph + f";[mix]{loudnorm_filter(measured)}[a]", "-map", "0:v?", "-map", "[a]", "-c:v", "copy",
                        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-map_metadata", "0", *container, out], timeout=3600)
    if result.returncode != 0:
        logger.warning(f"Sound effects mix failed: {(result.stderr or b'')[-400:]!r}")
        raise SoundDesignError("The sound effects could not be mixed")
    return measured


@dataclass
class SoundRequest:
    """A bake's sound design (main's `sound` request field, on the finished clip's clock)."""
    register: str = DEFAULT_REGISTER
    music_db: Optional[float] = None
    events: list = field(default_factory=list)
    palette: list = field(default_factory=list)


def parse_request(raw: Any) -> Optional[SoundRequest]:
    """The `sound` field of an editor bake: None when absent (no sound effects); raises ValueError when malformed."""
    if raw is None:
        return None
    if not isinstance(raw, dict) or set(raw) - {"register", "music_db", "events", "palette"}:
        raise ValueError("Invalid sound")
    register = raw.get("register", DEFAULT_REGISTER)
    if register not in REGISTERS:
        raise ValueError("Invalid sound register")
    music = raw.get("music_db")
    if music is not None and (type(music) not in (int, float) or not -40 <= music <= 0):
        raise ValueError("Invalid music level")
    events, palette = raw.get("events", []), raw.get("palette", [])
    if not isinstance(events, list) or len(events) > 400 or not isinstance(palette, list) or len(palette) > 200:
        raise ValueError("Invalid sound")
    for item in palette:
        if not isinstance(item, dict) or set(item) != {"path", "action"} or item["action"] not in ACTIONS \
                or not isinstance(item["path"], str) or not os.path.isabs(item["path"]):
            raise ValueError("Invalid sound palette")
    return SoundRequest(register, float(music) if music is not None else None, events, palette)


CUE_KINDS = ("punch", "broll", "extra")


def validate_candidate_sound(raw: Any, duration_ms: float) -> None:
    """A clip editor candidate's `sound` (clip-editor.ts CandidateSound); raises ValueError when malformed."""
    if not isinstance(raw, dict) or set(raw) - {"on", "register", "music_db", "cues"} or not isinstance(raw.get("on"), bool) \
            or raw.get("register") not in REGISTERS:
        raise ValueError("Invalid sound")
    music = raw.get("music_db")
    if music is not None and (type(music) not in (int, float) or not -40 <= music <= 0):
        raise ValueError("Invalid sound")
    cues = raw.get("cues", [])
    if not isinstance(cues, list) or len(cues) > 200:
        raise ValueError("Invalid sound")
    for cue in cues:
        if not isinstance(cue, dict) or set(cue) - {"at_ms", "end_ms", "kind", "sound"} or cue.get("kind") not in CUE_KINDS \
                or type(cue.get("at_ms")) not in (int, float) or not 0 <= cue["at_ms"] <= duration_ms \
                or ("end_ms" in cue and (type(cue["end_ms"]) not in (int, float) or not cue["at_ms"] <= cue["end_ms"] <= duration_ms)) \
                or ("sound" in cue and cue["sound"] not in AI_SOUND_ACTION):
            raise ValueError("Invalid sound")


def design_in_place(video: str, request: SoundRequest, total_ms: int, work: str, warnings: Optional[list] = None) -> list[dict]:
    """The sound effects planned from `request` mixed into `video` itself. Returns what went in. On a failure the video
    keeps its sound (with a warning)."""
    try:
        placements = plan_sounds(cues_from_events(request.events, total_ms), total_ms, request.register, request.music_db,
                                 palette_of(request.palette, warnings))
        if not placements:
            return []
        os.makedirs(work, exist_ok=True)
        out = os.path.join(work, "with-sounds" + (os.path.splitext(video)[1] or ".mp4"))
        mix_into(video, placements, out)
        os.replace(out, video)
        return [p.as_dict() for p in placements]
    except Exception as error:  # noqa: BLE001 - the clip is still good without them
        logger.warning(f"Sound effects skipped: {type(error).__name__}: {error}")
        if warnings is not None:
            warnings.append("The sound effects couldn't be added this time, so the video keeps its own sound.")
        return []
