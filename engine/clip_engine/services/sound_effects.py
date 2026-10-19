"""Sound effects for "Edit my recording", made here from plain math (no recorded or third-party audio).

Each effect is synthesized with numpy the first time it is needed and cached as a small 48 kHz mono WAV.
They are short and quiet on purpose: they sit under the voice, never over it.
"""
from __future__ import annotations

import math
import os
import tempfile
import wave

import numpy as np

RATE = 48000
SOUNDS = ("whoosh", "pop", "click", "ding", "thud")
# How loud each one is mixed under the voice (a share of full scale, before the loudness pass).
MIX_LEVEL = {"whoosh": 0.30, "pop": 0.40, "click": 0.35, "ding": 0.25, "thud": 0.45}
# Bump this when a recipe changes, so cached files are made again.
VERSION = 1


def _seconds(duration: float) -> np.ndarray:
    return np.arange(int(RATE * duration)) / RATE


def _envelope(t: np.ndarray, attack: float, decay: float) -> np.ndarray:
    """A fast linear rise, then an exponential fall."""
    rise = np.clip(t / max(attack, 1e-4), 0.0, 1.0)
    return rise * np.exp(-np.maximum(t - attack, 0.0) / decay)


def _sweep(t: np.ndarray, start_hz: float, end_hz: float, tau: float) -> np.ndarray:
    """A sine whose pitch glides from start_hz toward end_hz (exponentially, time constant tau)."""
    freq = end_hz + (start_hz - end_hz) * np.exp(-t / tau)
    return np.sin(2 * math.pi * np.cumsum(freq) / RATE)


def _band(noise: np.ndarray, centers: np.ndarray, q: float = 1.4) -> np.ndarray:
    """Noise through a state-variable band-pass filter whose center moves (one value per sample)."""
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


def synthesize(name: str) -> np.ndarray:
    """The effect as float samples in [-1, 1] (mono, RATE Hz)."""
    rng = np.random.default_rng(7 + SOUNDS.index(name))
    if name == "whoosh":
        # Air rushing past: noise through a band that sweeps up then down, swelling and fading.
        t = _seconds(0.6)
        shape = np.sin(math.pi * np.clip(t / 0.6, 0, 1)) ** 2
        centers = 350 + 2600 * np.sin(math.pi * np.clip(t / 0.6, 0, 1) * 0.85) ** 1.5
        samples = _band(rng.standard_normal(len(t)), centers) * shape
    elif name == "pop":
        # A quick bubble: a sine that drops in pitch and dies away fast.
        t = _seconds(0.14)
        samples = _sweep(t, 1100, 320, 0.03) * _envelope(t, 0.002, 0.03)
    elif name == "click":
        # A tiny tick: a few milliseconds of bright noise and a short high tone.
        t = _seconds(0.04)
        burst = np.diff(rng.standard_normal(len(t) + 1)) * _envelope(t, 0.0005, 0.003)
        samples = burst * 0.6 + np.sin(2 * math.pi * 2400 * t) * _envelope(t, 0.0005, 0.006)
    elif name == "ding":
        # A small bell: a tone with two softer overtones, ringing out.
        t = _seconds(0.9)
        tone = (np.sin(2 * math.pi * 1318.5 * t) + 0.35 * np.sin(2 * math.pi * 2637 * t) * np.exp(-t / 0.15)
                + 0.12 * np.sin(2 * math.pi * 3955.5 * t) * np.exp(-t / 0.08))
        samples = tone * _envelope(t, 0.003, 0.32)
    elif name == "thud":
        # A soft low knock: a low sine falling in pitch, with a little noise at the start.
        t = _seconds(0.38)
        body = _sweep(t, 120, 45, 0.06) * _envelope(t, 0.003, 0.09)
        knock = np.convolve(rng.standard_normal(len(t)), np.ones(24) / 24, mode="same") * _envelope(t, 0.001, 0.012)
        samples = body + 0.5 * knock
    else:
        raise ValueError(f"Unknown sound: {name}")
    # A few milliseconds of fade at each end (no clicks), then a fixed peak level.
    edge = min(len(samples) // 4, int(RATE * 0.004))
    if edge:
        samples[:edge] *= np.linspace(0, 1, edge)
        samples[-edge:] *= np.linspace(1, 0, edge)
    peak = float(np.max(np.abs(samples))) or 1.0
    return (samples / peak * 0.9).astype(np.float32)


def write_wav(path: str, samples: np.ndarray) -> None:
    data = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(data)


def sound_path(name: str, cache_dir: str) -> str:
    """The effect's WAV in cache_dir, made on first use (written to a temp file, then moved in place)."""
    if name not in SOUNDS:
        raise ValueError(f"Unknown sound: {name}")
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"{name}-v{VERSION}.wav")
    if not os.path.isfile(path):
        handle, temp = tempfile.mkstemp(prefix=f".{name}-", suffix=".wav", dir=cache_dir)
        os.close(handle)
        try:
            write_wav(temp, synthesize(name))
            os.replace(temp, path)
        finally:
            if os.path.exists(temp):
                os.remove(temp)
    return path


def sound_seconds(name: str) -> float:
    return len(synthesize(name)) / RATE
