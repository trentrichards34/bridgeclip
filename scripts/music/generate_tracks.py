"""Make CreatorClips's built-in background music: original loops synthesized from plain math.

No samples, recordings or third-party audio go in: every sound is a sine, a sum of sines or shaped noise from a
fixed random seed, so the tracks are CreatorClips's own work and members can use them in any video (see
engine/assets/music/LICENSE.txt). Run it again only to change a track:

    engine/.venv/bin/python scripts/music/generate_tracks.py engine/assets/music

Each track is rendered onto a buffer longer than the loop and folded back onto the loop's length (whatever rings
past the end is added to the start), so it repeats with no seam; its reverb is a circular convolution for the same
reason. Tracks are normalized to -18 LUFS (measured with FFmpeg's loudnorm) with peaks under -1.5 dBFS, and
encoded as Ogg Opus with a little of the loop's own end before it and start after it (the codec's edges fall there).
tracks.json records where the loop starts and its exact length in samples: the engine keeps just that before looping.
"""
from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
import tempfile
import wave

import numpy as np

RATE = 48000
TARGET_LUFS = -18.0
PEAK_DBFS = -1.5
TAIL_SECONDS = 20.0
# The file holds the loop with this much of its own end before it and of its start after it, so the codec's edges
# fall outside the loop; the engine keeps samples [EDGE, EDGE + samples).
EDGE = 4800


def midi(note: str) -> float:
    """'A4' -> 440.0 Hz (sharps only)."""
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    match = re.fullmatch(r"([A-G]#?)(-?\d)", note)
    assert match, note
    number = names[match.group(1)] + 12 * (int(match.group(2)) + 1)
    return 440.0 * 2 ** ((number - 69) / 12)


class Track:
    """A stereo buffer of `seconds` (plus a tail that's folded back on)."""

    def __init__(self, seconds: float):
        self.length = int(round(seconds * RATE))
        self.buffer = np.zeros((2, self.length + int(TAIL_SECONDS * RATE)))

    def add(self, at: float, sound: np.ndarray, gain: float = 1.0, pan: float = 0.0) -> None:
        """Mix `sound` (mono or 2 x n) in at `at` seconds; pan -1 (left) .. 1 (right), equal power."""
        start = int(round(at * RATE)) % self.length
        if sound.ndim == 1:
            angle = (pan + 1) * math.pi / 4
            sound = np.vstack([sound * math.cos(angle), sound * math.sin(angle)]) * math.sqrt(2)
        end = start + sound.shape[1]
        assert end <= self.buffer.shape[1], "a sound rings past the tail: raise TAIL_SECONDS"
        self.buffer[:, start:end] += gain * sound

    def folded(self) -> np.ndarray:
        """The loop: everything past its end wraps around to the start."""
        loop = self.buffer[:, :self.length].copy()
        rest = self.buffer[:, self.length:]
        for offset in range(0, rest.shape[1], self.length):
            chunk = rest[:, offset:offset + self.length]
            loop[:, :chunk.shape[1]] += chunk
        return loop


def seconds(duration: float) -> np.ndarray:
    return np.arange(int(duration * RATE)) / RATE


def adsr(n: int, attack: float, release: float, sustain_until: float) -> np.ndarray:
    """Rise over `attack`, hold until `sustain_until`, fall over `release` (seconds; n samples in all)."""
    t = np.arange(n) / RATE
    rise = np.clip(t / max(attack, 1e-4), 0, 1)
    fall = np.clip(1 - (t - sustain_until) / max(release, 1e-4), 0, 1)
    shape = np.minimum(rise, fall)
    return shape * shape * (3 - 2 * shape)  # smoothstep: no corners


def lowpass(signal: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    """A smooth (Butterworth-shaped) low-pass, applied circularly in the frequency domain."""
    spectrum = np.fft.rfft(signal, axis=-1)
    freqs = np.fft.rfftfreq(signal.shape[-1], 1 / RATE)
    spectrum *= 1 / np.sqrt(1 + (freqs / cutoff) ** (2 * order))
    return np.fft.irfft(spectrum, n=signal.shape[-1], axis=-1)


def highpass(signal: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    spectrum = np.fft.rfft(signal, axis=-1)
    freqs = np.fft.rfftfreq(signal.shape[-1], 1 / RATE)
    with np.errstate(divide="ignore"):
        spectrum *= 1 / np.sqrt(1 + (cutoff / np.maximum(freqs, 1e-6)) ** (2 * order))
    return np.fft.irfft(spectrum, n=signal.shape[-1], axis=-1)


def reverb(loop: np.ndarray, seconds_: float, wet: float, seed: int) -> np.ndarray:
    """A plate-like tail: decaying, darkening noise per channel, convolved circularly (so the loop stays seamless)."""
    rng = np.random.default_rng(seed)
    n = loop.shape[1]
    t = seconds(seconds_)
    out = loop.copy()
    for ch in range(2):
        ir = rng.standard_normal(len(t)) * np.exp(-6.9 * t / seconds_)
        ir = lowpass(ir, 5000)
        ir /= np.sqrt(np.sum(ir ** 2))
        padded = np.zeros(n)
        padded[:min(n, len(ir))] = ir[:n]
        out[ch] += wet * np.fft.irfft(np.fft.rfft(loop[ch]) * np.fft.rfft(padded), n=n)
    return out


# ---------------------------------------------------------------------------
# Instruments
# ---------------------------------------------------------------------------

def saw_voice(freq: float, n: int, brightness: float, phase: float = 0.0) -> np.ndarray:
    """A band-limited, softened sawtooth: harmonics 1/k, rolled off above `brightness` Hz."""
    t = np.arange(n) / RATE
    out = np.zeros(n)
    k = 1
    while freq * k < min(brightness * 3, RATE / 2 - 1000):
        weight = (1 / k) / math.sqrt(1 + (freq * k / brightness) ** 4)
        out += weight * np.sin(2 * math.pi * freq * k * t + phase * k)
        k += 1
    return out


def pad(freq: float, duration: float, *, attack: float = 1.6, release: float = 2.8, brightness: float = 1400,
        voices: int = 4, detune_cents: float = 7.0, seed: int = 0) -> np.ndarray:
    """A warm, slowly breathing pad: detuned saw voices spread left and right."""
    rng = np.random.default_rng(seed)
    n = int((duration + release) * RATE)
    env = adsr(n, attack, release, duration)
    out = np.zeros((2, n))
    for v in range(voices):
        cents = detune_cents * (v / max(1, voices - 1) * 2 - 1)
        voice = saw_voice(freq * 2 ** (cents / 1200), n, brightness, rng.uniform(0, 2 * math.pi))
        side = v / max(1, voices - 1)
        out[0] += voice * math.cos(side * math.pi / 2)
        out[1] += voice * math.sin(side * math.pi / 2)
    return out * env / voices


def pluck(freq: float, *, decay: float = 0.35, brightness: float = 3500) -> np.ndarray:
    """A soft plucked string: higher harmonics die away faster."""
    t = seconds(decay * 4)
    out = np.zeros(len(t))
    for k in range(1, 12):
        if freq * k > RATE / 2 - 1000:
            break
        out += (1 / k) / math.sqrt(1 + (freq * k / brightness) ** 2) * np.sin(2 * math.pi * freq * k * t) * np.exp(-t * (1 / decay) * (1 + 0.35 * k))
    return out * np.clip(t / 0.003, 0, 1)


def epiano(freq: float, duration: float) -> np.ndarray:
    """An electric-piano-like tone: a round fundamental, a little second harmonic and a short bell-like tine."""
    t = seconds(duration + 1.2)
    body = np.sin(2 * math.pi * freq * t) + 0.25 * np.sin(2 * math.pi * 2 * freq * t) + 0.06 * np.sin(2 * math.pi * 3 * freq * t)
    tine = 0.12 * np.sin(2 * math.pi * 7.02 * freq * t) * np.exp(-t * 14)
    env = np.exp(-t * 1.1) * adsr(len(t), 0.004, 1.0, duration)
    return (body + tine) * env


def bass(freq: float, duration: float) -> np.ndarray:
    t = seconds(duration + 0.12)
    tone = np.sin(2 * math.pi * freq * t) + 0.22 * np.sin(2 * math.pi * 2 * freq * t) + 0.08 * np.sin(2 * math.pi * 3 * freq * t)
    return tone * adsr(len(t), 0.006, 0.1, duration) * np.exp(-t * 0.8)


def kick(punch: float = 1.0) -> np.ndarray:
    t = seconds(0.45)
    freq = 46 + 110 * np.exp(-t / 0.035)
    body = np.sin(2 * math.pi * np.cumsum(freq) / RATE) * np.exp(-t / 0.16)
    click = np.exp(-t / 0.002) * 0.3 * punch
    return (body + click) * np.clip(t / 0.001, 0, 1)


def snare(seed: int, soft: bool = False) -> np.ndarray:
    rng = np.random.default_rng(seed)
    t = seconds(0.35)
    noise = highpass(lowpass(rng.standard_normal(len(t)), 7000 if not soft else 4500), 900)
    noise /= np.max(np.abs(noise)) + 1e-9
    tone = np.sin(2 * math.pi * 185 * t) * np.exp(-t / 0.05)
    return (0.75 * noise * np.exp(-t / (0.11 if not soft else 0.08)) + 0.45 * tone) * np.clip(t / 0.001, 0, 1)


def hat(seed: int, open_: bool = False) -> np.ndarray:
    rng = np.random.default_rng(seed)
    t = seconds(0.3 if open_ else 0.08)
    noise = highpass(rng.standard_normal(len(t)), 7000, order=3)
    noise /= np.max(np.abs(noise)) + 1e-9
    return noise * np.exp(-t / (0.09 if open_ else 0.018))


def bell(freq: float) -> np.ndarray:
    t = seconds(3.0)
    return (np.sin(2 * math.pi * freq * t) + 0.3 * np.sin(2 * math.pi * 2.76 * freq * t) * np.exp(-t * 3)) * np.exp(-t * 1.4) * np.clip(t / 0.01, 0, 1)


def riser(duration: float, seed: int) -> np.ndarray:
    """Noise that swells and brightens into the next chord (a soft "whoosh up")."""
    rng = np.random.default_rng(seed)
    t = seconds(duration)
    noise = rng.standard_normal((2, len(t)))
    out = np.zeros_like(noise)
    # Brighten in four steps (each a filtered copy, crossfaded), smooth enough at this level.
    steps = 6
    for s in range(steps):
        band = highpass(lowpass(noise, 600 * 2 ** s), 200)
        lo, hi = s / steps, (s + 1) / steps
        weight = np.clip(1 - np.abs((t / duration) - (lo + hi) / 2) * steps, 0, 1)
        out += band * weight
    return out * (t / duration) ** 2.2


def boom() -> np.ndarray:
    t = seconds(3.0)
    freq = 38 + 30 * np.exp(-t / 0.08)
    return np.sin(2 * math.pi * np.cumsum(freq) / RATE) * np.exp(-t / 0.9) * np.clip(t / 0.004, 0, 1)


def chord(names: str) -> list[float]:
    return [midi(n) for n in names.split()]


# ---------------------------------------------------------------------------
# The tracks
# ---------------------------------------------------------------------------

def calm_pad() -> np.ndarray:
    """Calm pad: slow, warm chords with a soft low end and a few far-off bell notes. 4 chords x 8 s."""
    chords = ["C3 G3 B3 E4 D5", "A2 E3 G3 C4 B4", "F2 C3 E3 A3 G4", "G2 D3 F#3 A3 E4"]
    roots = ["C2", "A1", "F1", "G1"]
    track = Track(32.0)
    for i, (names, root) in enumerate(zip(chords, roots)):
        at = i * 8.0
        for j, freq in enumerate(chord(names)):
            track.add(at - 0.6, pad(freq, 8.0, attack=2.2, release=3.0, brightness=1200 + 150 * j, seed=i * 10 + j), gain=0.16)
        t = seconds(10.0)
        sub = np.sin(2 * math.pi * midi(root) * t) * adsr(len(t), 1.5, 2.0, 8.0)
        track.add(at - 0.3, sub, gain=0.18)
    rng = np.random.default_rng(3)
    scale = ["E5", "G5", "A5", "C6", "D6", "E6"]
    for k in range(10):
        track.add(rng.uniform(0, 32), bell(midi(scale[rng.integers(len(scale))])), gain=0.035, pan=rng.uniform(-0.7, 0.7))
    loop = track.folded()
    # A slow swell, two breaths per loop.
    t = np.arange(loop.shape[1]) / RATE
    loop *= 0.9 + 0.1 * np.sin(2 * math.pi * t / 16.0)
    return reverb(loop, 3.5, 0.35, seed=11)


def upbeat_pulse() -> np.ndarray:
    """Upbeat pulse: 120 BPM, four-on-the-floor, offbeat hats, a plucked 16th-note arpeggio. 16 bars."""
    bpm, bars = 120, 16
    beat = 60 / bpm
    track = Track(bars * 4 * beat)
    progression = [("G2", "G3 B3 D4 G4"), ("D2", "D3 F#3 A3 D4"), ("E2", "E3 G3 B3 E4"), ("C2", "C3 E3 G3 C4")]
    rng = np.random.default_rng(5)
    for bar in range(bars):
        root, notes = progression[(bar // 2) % 4]
        arp = chord(notes)
        bar_at = bar * 4 * beat
        for b in range(4):
            at = bar_at + b * beat
            track.add(at, kick(), gain=0.55)
            track.add(at + beat / 2, hat(100 + bar * 4 + b), gain=0.12, pan=0.25)
            if b in (1, 3):
                track.add(at, snare(200 + bar * 4 + b, soft=True), gain=0.22, pan=-0.05)
            for e in range(2):
                track.add(at + e * beat / 2, bass(midi(root), beat / 2 * 0.8), gain=0.2)
        pattern = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 3, 1, 2]
        for s, idx in enumerate(pattern):
            freq = arp[idx] * (2 if s % 8 >= 4 else 1)
            track.add(bar_at + s * beat / 4, pluck(freq, decay=0.22), gain=0.09 * (1.0 if s % 4 == 0 else 0.75),
                      pan=0.45 * math.sin(s * 0.8))
    # A light pad under it all.
    for bar in range(0, bars, 2):
        _, notes = progression[(bar // 2) % 4]
        for j, freq in enumerate(chord(notes)[:3]):
            track.add(bar * 4 * beat, pad(freq * 2, 8 * beat, attack=0.4, release=0.8, brightness=2200, seed=bar * 7 + j), gain=0.05)
    loop = track.folded()
    return reverb(loop, 1.6, 0.18, seed=13)


def lofi_beat() -> np.ndarray:
    """Lo-fi beat: a lazy, swung boom-bap at 84 BPM with mellow electric-piano chords and soft vinyl crackle. 12 bars."""
    bpm, bars = 84, 12
    beat = 60 / bpm
    swing = beat / 2 * 0.16
    track = Track(bars * 4 * beat)
    progression = [("D2", "D3 F3 A3 C4 E4"), ("G1", "F3 A3 B3 E4"), ("C2", "E3 G3 B3 D4"), ("A1", "G3 C4 E4")]
    for bar in range(bars):
        root, notes = progression[bar % 4]
        at = bar * 4 * beat
        for j, freq in enumerate(chord(notes)):
            # A slight strum.
            track.add(at + 0.012 * j, epiano(freq, 4 * beat * 0.92), gain=0.075, pan=-0.3 + 0.15 * j)
        track.add(at, bass(midi(root), 1.6 * beat), gain=0.28)
        track.add(at + 2.5 * beat, bass(midi(root) * (1.5 if bar % 2 else 1), beat), gain=0.22)
        track.add(at, kick(punch=0.5), gain=0.5)
        track.add(at + 2.5 * beat, kick(punch=0.5), gain=0.38)
        if bar % 2:
            track.add(at + 3.75 * beat, kick(punch=0.3), gain=0.25)
        for b in (1, 3):
            track.add(at + b * beat + 0.012, snare(300 + bar * 2 + b, soft=True), gain=0.3, pan=0.05)
        for e in range(8):
            off = swing if e % 2 else 0.0
            track.add(at + e * beat / 2 + off, hat(400 + bar * 8 + e), gain=0.07 if e % 2 else 0.1, pan=0.3)
    loop = track.folded()
    # Vinyl: sparse soft clicks and a faint hiss, made over the loop itself (so they repeat seamlessly).
    rng = np.random.default_rng(17)
    n = loop.shape[1]
    crackle = np.zeros(n)
    for at in rng.integers(0, n, size=int(n / RATE * 9)):
        crackle[at] = rng.uniform(-1, 1)
    crackle = highpass(lowpass(crackle, 6000), 800) * 0.25
    hiss = highpass(lowpass(rng.standard_normal(n), 9000), 2000) * 0.004
    loop += np.vstack([crackle + hiss, np.roll(crackle, 37) + hiss])
    # Warmth: roll off the top, a touch of tape-like wobble in level.
    loop = lowpass(loop, 5200)
    return reverb(loop, 1.2, 0.15, seed=19)


def cinematic_swell() -> np.ndarray:
    """Cinematic swell: low strings in long chords, a deep hit and a rising swell into each change. 4 chords x 10 s."""
    chords = ["D2 A2 D3 F3 A3", "A#1 F2 A#2 D3 F3", "F2 C3 F3 A3 C4", "C2 G2 C3 E3 G3"]
    highs = ["D5 F5 A5", "D5 F5 A#5", "C5 F5 A5", "C5 E5 G5"]
    track = Track(40.0)
    for i, (names, high) in enumerate(zip(chords, highs)):
        at = i * 10.0
        for j, freq in enumerate(chord(names)):
            track.add(at, pad(freq, 10.0, attack=2.8, release=2.6, brightness=900 + 120 * j, voices=5, detune_cents=10, seed=i * 20 + j), gain=0.2)
        for j, freq in enumerate(chord(high)):
            track.add(at + 2.0, pad(freq, 7.0, attack=3.5, release=2.5, brightness=2400, voices=3, detune_cents=6, seed=i * 20 + 10 + j), gain=0.045)
        track.add(at, boom(), gain=0.5)
        track.add(at + 10.0 - 3.0, riser(3.0, seed=40 + i), gain=0.05)
        for p in range(10):
            track.add(at + p * 1.0, kick(punch=0.0) * 0.6, gain=0.12 if p else 0.0)
    loop = track.folded()
    return reverb(loop, 4.5, 0.4, seed=23)


TRACKS = [
    {"id": "calm-pad", "name": "Calm pad", "mood": "Warm, slow chords. No beat.", "make": calm_pad},
    {"id": "upbeat-pulse", "name": "Upbeat pulse", "mood": "Bright and energetic, 120 BPM.", "make": upbeat_pulse},
    {"id": "lofi-beat", "name": "Lo-fi beat", "mood": "Mellow, laid-back groove.", "make": lofi_beat},
    {"id": "cinematic-swell", "name": "Cinematic swell", "mood": "Big, slow build. Dramatic.", "make": cinematic_swell},
]


# ---------------------------------------------------------------------------
# Loudness and files
# ---------------------------------------------------------------------------

def write_wav(path: str, loop: np.ndarray) -> None:
    pcm = np.clip(loop.T, -1, 1)
    with wave.open(path, "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes((pcm * 32767).astype("<i2").tobytes())


def integrated_lufs(loop: np.ndarray) -> float:
    """FFmpeg's EBU R128 integrated loudness of the loop, played twice (so the gate sees it settle)."""
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "measure.wav")
        scale = max(1.0, float(np.max(np.abs(loop))) * 1.0001)
        write_wav(path, np.hstack([loop, loop]) / scale)
        result = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", path, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
                                capture_output=True, text=True, check=True)
    data = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", result.stderr).group(0))
    return float(data["input_i"]) + 20 * math.log10(scale)


def master(loop: np.ndarray) -> np.ndarray:
    """Gain to TARGET_LUFS, with a gentle soft clip so peaks stay under PEAK_DBFS."""
    loop = loop - loop.mean(axis=1, keepdims=True)
    for _ in range(4):
        loop = loop * 10 ** ((TARGET_LUFS - integrated_lufs(loop)) / 20)
        ceiling = 10 ** (PEAK_DBFS / 20)
        peak = np.max(np.abs(loop))
        if peak > ceiling:
            # Soft knee above 70% of the ceiling: transparent on these sparse peaks.
            knee = 0.7 * ceiling
            over = np.abs(loop) > knee
            loop = np.where(over, np.sign(loop) * (knee + (ceiling - knee) * np.tanh((np.abs(loop) - knee) / (ceiling - knee))), loop)
        if abs(integrated_lufs(loop) - TARGET_LUFS) < 0.2:
            break
    return loop


def main(out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    listing = []
    for spec in TRACKS:
        loop = master(spec["make"]())
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, "loop.wav")
            write_wav(wav, np.hstack([loop[:, -EDGE:], loop, loop[:, :EDGE]]))
            out = os.path.join(out_dir, f"{spec['id']}.ogg")
            subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", "libopus", "-b:a", "112k",
                            "-vbr", "on", "-application", "audio", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", out], check=True)
        listing.append({"id": spec["id"], "name": spec["name"], "mood": spec["mood"], "file": f"{spec['id']}.ogg",
                        "offset": EDGE, "samples": int(loop.shape[1]), "rate": RATE, "seconds": round(loop.shape[1] / RATE, 3),
                        "lufs": round(integrated_lufs(loop), 1)})
        print(f"{spec['id']}: {loop.shape[1] / RATE:.2f} s, {listing[-1]['lufs']} LUFS, peak {20 * math.log10(np.max(np.abs(loop))):.1f} dBFS")
    with open(os.path.join(out_dir, "tracks.json"), "w", encoding="utf-8") as handle:
        json.dump({"version": 1, "tracks": listing}, handle, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "engine", "assets", "music"))
