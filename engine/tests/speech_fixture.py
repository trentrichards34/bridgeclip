"""Speech-like test audio, made from math: voiced syllables (a wobbling pitch through vowel formants), hissy
consonants, words and pauses, plus room echo and background noise. Good enough to measure noise reduction and
ducking without a real recording."""
from __future__ import annotations

import math
import subprocess
import wave

import numpy as np

RATE = 48000
VOWELS = [(730, 1090, 2440), (270, 2290, 3010), (300, 870, 2240), (530, 1840, 2480), (570, 840, 2410)]


def _formant_gain(freq: np.ndarray, formants: tuple[int, int, int]) -> np.ndarray:
    gain = np.zeros_like(freq)
    for f, level, width in zip(formants, (1.0, 0.6, 0.3), (90, 110, 160)):
        gain += level / (1 + ((freq - f) / width) ** 2)
    return gain


def syllable(rng: np.random.Generator, seconds: float, f0: float) -> np.ndarray:
    n = int(seconds * RATE)
    t = np.arange(n) / RATE
    pitch = f0 * (1 + 0.06 * np.sin(2 * math.pi * rng.uniform(2, 5) * t) - 0.08 * t / seconds)
    phase = 2 * math.pi * np.cumsum(pitch) / RATE
    formants = VOWELS[rng.integers(len(VOWELS))]
    out = np.zeros(n)
    for h in range(1, 40):
        if f0 * h > 5000:
            break
        out += _formant_gain(np.array([f0 * h]), formants)[0] / h ** 0.6 * np.sin(h * phase)
    env = np.sin(math.pi * np.clip(t / seconds, 0, 1)) ** 0.7
    return out * env


def fricative(rng: np.random.Generator, seconds: float) -> np.ndarray:
    n = int(seconds * RATE)
    noise = rng.standard_normal(n)
    spectrum = np.fft.rfft(noise)
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    spectrum *= ((freqs > 3800) & (freqs < 8500))
    out = np.fft.irfft(spectrum, n)
    return out / (np.max(np.abs(out)) + 1e-9) * np.sin(math.pi * np.linspace(0, 1, n)) * 0.35


def clean_speech(seconds: float = 12.0, seed: int = 1) -> tuple[np.ndarray, np.ndarray]:
    """(speech, active): mono speech-like audio at RATE and a per-sample mask of where someone is talking."""
    rng = np.random.default_rng(seed)
    n = int(seconds * RATE)
    out = np.zeros(n)
    active = np.zeros(n, bool)
    at = 0.4
    while at < seconds - 1.0:
        # A phrase of 3-7 words, then a pause.
        for _ in range(rng.integers(3, 8)):
            for _ in range(rng.integers(1, 4)):
                if rng.random() < 0.3:
                    piece = fricative(rng, rng.uniform(0.05, 0.11))
                else:
                    piece = syllable(rng, rng.uniform(0.12, 0.26), rng.uniform(110, 170))
                start = int(at * RATE)
                end = min(n, start + len(piece))
                out[start:end] += piece[:end - start]
                active[start:end] = True
                at += len(piece) / RATE
                if at > seconds - 1.0:
                    break
            at += rng.uniform(0.06, 0.14)
        at += rng.uniform(0.55, 0.95)
    return out / np.max(np.abs(out)) * 0.5, active


def room(speech: np.ndarray, rt60: float = 0.45, wet: float = 0.35, seed: int = 2) -> np.ndarray:
    rng = np.random.default_rng(seed)
    t = np.arange(int(rt60 * RATE)) / RATE
    ir = rng.standard_normal(len(t)) * np.exp(-6.9 * t / rt60)
    ir /= np.sqrt(np.sum(ir ** 2))
    tail = np.fft.irfft(np.fft.rfft(speech, len(speech) + len(ir)) * np.fft.rfft(ir, len(speech) + len(ir)))[:len(speech)]
    return speech + wet * tail


def background(n: int, level_db: float, seed: int = 3) -> np.ndarray:
    """Fan-like noise (pinkish, a bit of 60 Hz hum) at level_db RMS dBFS."""
    rng = np.random.default_rng(seed)
    spectrum = np.fft.rfft(rng.standard_normal(n))
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    spectrum /= np.sqrt(np.maximum(freqs, 50) / 50)
    noise = np.fft.irfft(spectrum, n)
    noise += 0.15 * np.sin(2 * math.pi * 60 * np.arange(n) / RATE) * np.std(noise)
    return noise / np.sqrt(np.mean(noise ** 2)) * 10 ** (level_db / 20)


def noisy_speech(seconds: float = 12.0, noise_db: float = -38.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(noisy, clean, active)."""
    clean, active = clean_speech(seconds)
    return room(clean) + background(len(clean), noise_db), clean, active


def write_wav(path: str, mono: np.ndarray) -> None:
    pcm = (np.clip(mono, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(pcm.tobytes())


def write_video(path: str, mono: np.ndarray, wav_path: str) -> None:
    """A small video (gray frames) with this sound, lossless (PCM in Matroska) so measurements are exact."""
    write_wav(wav_path, mono)
    seconds = len(mono) / RATE
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=gray:s=160x284:r=10:d={seconds:.3f}",
                    "-i", wav_path, "-map", "0:v", "-map", "1:a", "-c:v", "mpeg4", "-q:v", "8", "-c:a", "pcm_s16le",
                    "-shortest", path], check=True)


def read_audio(path: str, channels: int = 1) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-vn", "-ac", str(channels), "-ar", str(RATE), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    data = np.frombuffer(raw, np.float32)
    return data.reshape(-1, channels).T.copy() if channels > 1 else data.copy()


def frame_power(signal: np.ndarray, frame: int = RATE // 50) -> np.ndarray:
    usable = len(signal) // frame * frame
    return np.mean(signal[:usable].reshape(-1, frame) ** 2, axis=1)


def masks(active: np.ndarray, frame: int = RATE // 50, guard_s: float = 0.25) -> tuple[np.ndarray, np.ndarray]:
    """Per-frame (speech, pause) masks; pause frames are guard_s away from any speech (past the echo's loud part)."""
    usable = len(active) // frame * frame
    speaking = active[:usable].reshape(-1, frame).any(axis=1)
    guard = int(guard_s * RATE / frame)
    near = np.convolve(speaking.astype(float), np.ones(2 * guard + 1), mode="same") > 0
    return speaking, ~near
