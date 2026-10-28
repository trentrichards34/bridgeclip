"""Make CreatorClips's built-in sound effects library (engine/assets/sfx), sorted by the action each sound goes with.

Only two kinds of sound go in, both free to ship in a paid app and to use in any video:
  * Recorded sounds from Kenney's packs (www.kenney.nl), which are public domain (CC0 1.0). The copies read here are
    the ones kept in kapishdima/soundcn (MIT repository; its assets/kenney_* folders hold Kenney's files unchanged).
    Its `wow` folder is NOT free (Blizzard's) and is never read.
  * Air sounds made here from shaped noise (whooshes and risers): no tones, no samples. Ours, under the engine's license.

Every file is trimmed of silence, peak-normalized to PEAK_DBFS, and encoded 48 kHz mono Ogg Opus. manifest.json lists
each one: its action and take, where its peak is (ms from the start: the mixer lines that up one frame after the
picture), its length, its level, where it came from and its license. Run it again only to change the library:

    engine/.venv/bin/python scripts/sfx/build_library.py <soundcn checkout>/assets engine/assets/sfx
"""
from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys

import numpy as np

RATE = 48000
PEAK_DBFS = -3.0
BITRATE = "64k"
KENNEY_CC0 = "CC0-1.0 (public domain dedication), Kenney (www.kenney.nl)"
OWN = "Made for CreatorClips from shaped noise (scripts/sfx/build_library.py); MIT, with the engine"

# action -> [(name, recipe)]. A recipe is ("kenney", pack, file[, layer pack, layer file, layer gain]) or ("noise", kind, seed).
LIBRARY: dict[str, list[tuple]] = {
    # A card or a scene moving fast: air going past.
    "whoosh": [("air-short", ("noise", "whoosh", 0.42, 11)), ("air-medium", ("noise", "whoosh", 0.58, 12)),
               ("air-long", ("noise", "whoosh", 0.74, 13)), ("air-quick", ("noise", "whoosh", 0.34, 14)),
               ("swoosh-5", ("kenney", "kenney_interface-sounds", "maximize_005.ogg")),
               ("air-soft", ("noise", "whoosh", 0.5, 15)),
               ("swoosh-1", ("kenney", "kenney_interface-sounds", "maximize_001.ogg")),
               ("air-wide", ("noise", "whoosh", 0.64, 16))],
    # A strip or a card sliding on and off: a quick paper swish.
    "swipe": [("card-shove-1", ("kenney", "kenney_casino-audio", "card-shove-1.ogg")),
              ("card-shove-3", ("kenney", "kenney_casino-audio", "card-shove-3.ogg")),
              ("card-shove-4", ("kenney", "kenney_casino-audio", "card-shove-4.ogg")),
              ("card-slide-3", ("kenney", "kenney_casino-audio", "card-slide-3.ogg")),
              ("card-slide-5", ("kenney", "kenney_casino-audio", "card-slide-5.ogg")),
              ("card-shove-2", ("kenney", "kenney_casino-audio", "card-shove-2.ogg")),
              ("card-slide-1", ("kenney", "kenney_casino-audio", "card-slide-1.ogg")),
              ("card-slide-6", ("kenney", "kenney_casino-audio", "card-slide-6.ogg"))],
    # A badge, a chip or a number landing: a short, bright pluck.
    "pop": [("pluck-1", ("kenney", "kenney_interface-sounds", "pluck_001.ogg")),
            ("pluck-2", ("kenney", "kenney_interface-sounds", "pluck_002.ogg")),
            ("select-4", ("kenney", "kenney_interface-sounds", "select_004.ogg")),
            ("chip-lay-3", ("kenney", "kenney_casino-audio", "chip-lay-3.ogg")),
            ("select-3", ("kenney", "kenney_interface-sounds", "select_003.ogg")),
            ("glass-5", ("kenney", "kenney_interface-sounds", "glass_005.ogg")),
            ("select-5", ("kenney", "kenney_interface-sounds", "select_005.ogg")),
            ("chip-lay-1", ("kenney", "kenney_casino-audio", "chip-lay-1.ogg"))],
    # Text arriving letter by letter or line by line: a soft key tick.
    "tick": [("tick-1", ("kenney", "kenney_interface-sounds", "tick_001.ogg")),
             ("tick-2", ("kenney", "kenney_interface-sounds", "tick_002.ogg")),
             ("tick-4", ("kenney", "kenney_interface-sounds", "tick_004.ogg")),
             ("chip-tap", ("kenney", "kenney_casino-audio", "chips-collide-3.ogg")),
             ("blip-7", ("kenney", "kenney_interface-sounds", "select_007.ogg")),
             ("tap-4", ("kenney", "kenney_interface-sounds", "click_004.ogg")),
             ("blip-8", ("kenney", "kenney_interface-sounds", "select_008.ogg")),
             ("chip-tap-1", ("kenney", "kenney_casino-audio", "chips-collide-1.ogg"))],
    # A pointer pressing a button on screen.
    "click": [("click-1", ("kenney", "kenney_interface-sounds", "click_001.ogg")),
              ("click-5", ("kenney", "kenney_interface-sounds", "click_005.ogg")),
              ("switch-2", ("kenney", "kenney_interface-sounds", "switch_002.ogg")),
              ("toggle-4", ("kenney", "kenney_interface-sounds", "toggle_004.ogg")),
              ("switch-5", ("kenney", "kenney_interface-sounds", "switch_005.ogg")),
              ("toggle-1", ("kenney", "kenney_interface-sounds", "toggle_001.ogg")),
              ("switch-6", ("kenney", "kenney_interface-sounds", "switch_006.ogg")),
              ("toggle-2", ("kenney", "kenney_interface-sounds", "toggle_002.ogg"))],
    # A big word slamming in: a punch with a soft low body under it (two Kenney sounds layered).
    "impact": [("punch-heavy-0", ("kenney", "kenney_impact-sounds", "impactPunch_heavy_000.ogg", "kenney_impact-sounds", "impactSoft_heavy_000.ogg", 0.6)),
               ("punch-heavy-2", ("kenney", "kenney_impact-sounds", "impactPunch_heavy_002.ogg", "kenney_impact-sounds", "impactSoft_heavy_002.ogg", 0.6)),
               ("punch-heavy-1", ("kenney", "kenney_impact-sounds", "impactPunch_heavy_001.ogg", "kenney_impact-sounds", "impactSoft_heavy_001.ogg", 0.6)),
               ("punch-heavy-4", ("kenney", "kenney_impact-sounds", "impactPunch_heavy_004.ogg", "kenney_impact-sounds", "impactSoft_heavy_004.ogg", 0.6)),
               ("punch-heavy-3", ("kenney", "kenney_impact-sounds", "impactPunch_heavy_003.ogg", "kenney_impact-sounds", "impactSoft_heavy_003.ogg", 0.6)),
               ("punch-medium-0", ("kenney", "kenney_impact-sounds", "impactPunch_medium_000.ogg", "kenney_impact-sounds", "impactSoft_medium_000.ogg", 0.7)),
               ("punch-medium-2", ("kenney", "kenney_impact-sounds", "impactPunch_medium_002.ogg", "kenney_impact-sounds", "impactSoft_medium_002.ogg", 0.7)),
               ("punch-medium-4", ("kenney", "kenney_impact-sounds", "impactPunch_medium_004.ogg", "kenney_impact-sounds", "impactSoft_medium_004.ogg", 0.7))],
    # Into the payoff, once: air that builds and stops on the moment.
    "riser": [("air-rise-short", ("noise", "riser", 1.3, 21)), ("air-rise-long", ("noise", "riser", 1.9, 22)),
              ("air-rise-mid", ("noise", "riser", 1.6, 23)), ("air-rise-swell", ("noise", "riser", 2.2, 24))],
    # A sticky note or a page landing.
    "paper": [("card-place-2", ("kenney", "kenney_casino-audio", "card-place-2.ogg")),
              ("card-place-3", ("kenney", "kenney_casino-audio", "card-place-3.ogg")),
              ("card-place-4", ("kenney", "kenney_casino-audio", "card-place-4.ogg")),
              ("book-flip-3", ("kenney", "kenney_rpg-audio", "bookFlip3.ogg")),
              ("book-place-1", ("kenney", "kenney_rpg-audio", "bookPlace1.ogg")),
              ("card-place-1", ("kenney", "kenney_casino-audio", "card-place-1.ogg")),
              ("book-place-2", ("kenney", "kenney_rpg-audio", "bookPlace2.ogg")),
              ("book-place-3", ("kenney", "kenney_rpg-audio", "bookPlace3.ogg"))],
}


def decode(path: str) -> np.ndarray:
    result = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
                            capture_output=True, check=True)
    return np.frombuffer(result.stdout, dtype=np.float32).astype(np.float64)


def band_noise(noise: np.ndarray, centers: np.ndarray, q: float = 1.2) -> np.ndarray:
    """Noise through a state-variable band-pass whose center moves (one value per sample)."""
    out = np.zeros_like(noise)
    low = band = 0.0
    damp = 1.0 / q
    for i, (x, fc) in enumerate(zip(noise, centers)):
        f = 2.0 * math.sin(math.pi * min(fc, RATE / 6) / RATE)
        high = x - low - damp * band
        band += f * high
        low += f * band
        out[i] = band
    return out


def noise_sound(kind: str, seconds: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(RATE * seconds)
    t = np.arange(n) / RATE
    x = t / seconds
    if kind == "whoosh":
        # Swells to its peak a little past the middle, falls away faster (an object passing); the band rises with it.
        peak = 0.58
        shape = np.where(x < peak, (x / peak) ** 2.2, np.exp(-((x - peak) / (1 - peak)) * 4.0))
        centers = 260 + 2400 * shape ** 1.3 + 300 * x
        layer = band_noise(rng.standard_normal(n), centers, 1.1) + 0.35 * band_noise(rng.standard_normal(n), centers * 2.2, 2.0)
        samples = layer * shape
    elif kind == "riser":
        # Builds the whole way (the band climbs from low air to a bright hiss) and stops dead on the last few ms.
        shape = x ** 2.4
        centers = 180 + 5200 * x ** 1.8
        samples = (band_noise(rng.standard_normal(n), centers, 1.6) + 0.5 * band_noise(rng.standard_normal(n), centers * 1.7, 3.0)) * shape
    else:
        raise ValueError(kind)
    return samples


def trim(samples: np.ndarray) -> np.ndarray:
    """Cut the silence at both ends (keeping 2 ms before the first sound) and fade the last 5 ms."""
    level = np.abs(samples)
    peak = float(level.max()) or 1.0
    loud = np.where(level > peak * 10 ** (-50 / 20))[0]
    quiet_end = np.where(level > peak * 10 ** (-60 / 20))[0]
    start = max(0, int(loud[0]) - int(0.002 * RATE))
    end = int(quiet_end[-1]) + 1
    out = samples[start:end].copy()
    fade = min(len(out) // 4, int(0.005 * RATE))
    if fade:
        out[-fade:] *= np.linspace(1, 0, fade)
    return out


def peak_ms(samples: np.ndarray) -> int:
    """Where the sound hits hardest: the loudest 5 ms (RMS), from the start."""
    window = int(0.005 * RATE)
    energy = np.convolve(samples ** 2, np.ones(window) / window, mode="same")
    return int(round(int(np.argmax(energy)) / RATE * 1000))


def level_db(samples: np.ndarray) -> float:
    """The loudest 100 ms (RMS, dBFS; a shorter sound counts as 100 ms with silence after it): what the mixer sets each
    sound's gain from (members' sounds are measured alike)."""
    window = int(0.1 * RATE)
    samples = np.pad(samples, (0, max(0, window - len(samples))))
    energy = np.convolve(samples ** 2, np.ones(window) / window, mode="valid")
    return round(10 * math.log10(max(float(energy.max()), 1e-12)), 2)


def encode(samples: np.ndarray, path: str) -> None:
    pcm = np.clip(samples, -1, 1).astype("<f4").tobytes()
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", "-",
                    "-c:a", "libopus", "-b:a", BITRATE, "-application", "audio", "-ar", str(RATE), "-ac", "1", path],
                    input=pcm, check=True)


def build(assets: str, out: str) -> dict:
    entries = []
    if os.path.isdir(out):
        for action in LIBRARY:
            shutil.rmtree(os.path.join(out, action), ignore_errors=True)
    for action, takes in LIBRARY.items():
        os.makedirs(os.path.join(out, action), exist_ok=True)
        for take, (name, recipe) in enumerate(takes):
            if recipe[0] == "kenney":
                pack, file = recipe[1], recipe[2]
                assert pack.startswith("kenney_"), pack
                samples = decode(os.path.join(assets, pack, file))
                source = f"Kenney, {pack[len('kenney_'):].replace('-', ' ').title()} ({pack}/{file})"
                if len(recipe) > 3:
                    layer = decode(os.path.join(assets, recipe[3], recipe[4])) * recipe[5]
                    length = max(len(samples), len(layer))
                    samples = np.pad(samples, (0, length - len(samples))) + np.pad(layer, (0, length - len(layer)))
                    source += f" layered with ({recipe[3]}/{recipe[4]})"
                license_ = KENNEY_CC0
            else:
                samples = noise_sound(recipe[1], recipe[2], recipe[3])
                source = f"CreatorClips shaped noise ({recipe[1]}, seed {recipe[3]})"
                license_ = OWN
            samples = trim(samples)
            samples = samples / (float(np.abs(samples).max()) or 1.0) * 10 ** (PEAK_DBFS / 20)
            rel = f"{action}/{name}.ogg"
            path = os.path.join(out, rel)
            encode(samples, path)
            # Measured again from the encoded file: what the engine will actually play.
            decoded = decode(path)
            entries.append({"file": rel, "action": action, "take": take, "peak_ms": peak_ms(decoded),
                            "duration_ms": int(round(len(decoded) / RATE * 1000)), "level_db": level_db(decoded),
                            "source": source, "license": license_})
            print(f"{rel:32} {entries[-1]['duration_ms']:5d} ms  peak {entries[-1]['peak_ms']:4d} ms  level {entries[-1]['level_db']:6.1f} dB")
    manifest = {"version": 1, "rate": RATE, "peak_dbfs": PEAK_DBFS,
                "actions": {action: len(takes) for action, takes in LIBRARY.items()}, "sounds": entries}
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
    return manifest


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: build_library.py <soundcn assets folder> <engine/assets/sfx>")
    build(sys.argv[1], sys.argv[2])
