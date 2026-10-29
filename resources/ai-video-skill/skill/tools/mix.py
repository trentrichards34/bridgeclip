#!/usr/bin/env python3
"""Final audio for a reel: voice + subtle synthesized sound design (+ optional music, ducked under the voice).

  python3 tools/mix.py <project> [--music path.mp3] [--sfx-gain -4] [--no-sfx]

Reads  audio/vo.mp3, build/sfx.json ([{t, name, gain}] written by the engine on every render), reel.json "music"
Writes build/mix.wav (48 kHz stereo, -14 LUFS). Every SFX is synthesized here, so there is nothing to license.
SFX names (anything else falls back by keyword): whoosh swoosh pop click tick ding thud impact boom shimmer riser type cash stamp
Taste rules baked in: SFX sit ~18 dB under the voice, same-kind hits closer than 0.12-0.25 s are dropped (no machine-gun clusters).
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np

SR = 48000
def opt(k, d=None): return sys.argv[sys.argv.index('--' + k) + 1] if '--' + k in sys.argv else d

def env(n, a=0.004, r=0.08):
    t = np.arange(n) / SR; return np.minimum(1, t / a) * np.exp(-t / r)

def synth(kind):
    n = int(SR * 0.9); t = np.arange(n) / SR; rng = np.random.default_rng(abs(hash(kind)) % 2**32)
    noise = rng.standard_normal(n)
    lp = lambda x, k: np.convolve(x, np.ones(k) / k, 'same')
    if kind in ('whoosh', 'swoosh'):
        w = 0.09 if kind == 'whoosh' else 0.06; c = 0.2 if kind == 'whoosh' else 0.12
        x = lp(noise, 30 if kind == 'whoosh' else 14) * np.exp(-((t - c) / w) ** 2); return x / (np.abs(x).max() + 1e-9) * 0.55
    if kind == 'pop':
        f = 900 * np.exp(-t * 18) + 300; return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.045) * 0.6
    if kind == 'click':
        return np.convolve(noise * env(n, 0.0005, 0.012), [1, -0.9], 'same') * 0.6
    if kind == 'tick':
        return np.sin(2 * np.pi * 2400 * t) * env(n, 0.0008, 0.018) * 0.35
    if kind == 'type':
        return np.convolve(noise * env(n, 0.0003, 0.006), [1, -0.95], 'same') * 0.4
    if kind == 'ding':
        return (np.sin(2 * np.pi * 1320 * t) + 0.5 * np.sin(2 * np.pi * 1980 * t)) * env(n, 0.002, 0.22) * 0.3
    if kind == 'cash':
        return (np.sin(2 * np.pi * 2093 * t) + np.sin(2 * np.pi * 2637 * t) * (t > 0.06)) * env(n, 0.002, 0.18) * 0.25
    if kind in ('thud', 'stamp'):
        f = 140 * np.exp(-t * 9) + 45; x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.12)
        if kind == 'stamp': x += lp(noise, 6) * env(n, 0.001, 0.03) * 0.5
        return x * 0.8
    if kind in ('impact', 'boom'):
        f = 90 * np.exp(-t * 4) + 32; x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.003, 0.35 if kind == 'boom' else 0.2)
        return (x + lp(noise, 40) * env(n, 0.001, 0.06) * 0.6) * 0.8
    if kind == 'shimmer':
        x = sum(np.sin(2 * np.pi * f * t + i) for i, f in enumerate([2637, 3136, 3951, 4699])) * env(n, 0.05, 0.3)
        return x * (0.5 + 0.5 * np.sin(2 * np.pi * 14 * t)) * 0.08
    if kind == 'riser':
        f = 300 + 1500 * (t / t[-1]) ** 2; x = lp(noise, 8) * (t / t[-1]) ** 2 * 0.3 + np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / t[-1]) ** 3 * 0.15
        return x
    return np.sin(2 * np.pi * 2000 * t) * env(n, 0.001, 0.02) * 0.3

KEYS = [('whoosh', ['whoosh', 'whip', 'wipe', 'dock', 'fly', 'cut']), ('swoosh', ['swoosh', 'swish', 'slide', 'fwip']),
        ('pop', ['pop', 'pill', 'land', 'plop', 'appear', 'bubble']), ('click', ['click', 'enter', 'press', 'tap', 'toggle', 'key']),
        ('type', ['type', 'typing']), ('ding', ['ding', 'chime', 'success', 'check', 'confirm', 'notif']), ('cash', ['cash', 'coin', 'money']),
        ('stamp', ['stamp', 'slam', 'gavel', 'slap']), ('thud', ['thud', 'drop', 'thump']), ('boom', ['boom', 'bass']), ('impact', ['impact', 'hit', 'shock']),
        ('shimmer', ['shimmer', 'sparkle', 'glow', 'magic']), ('riser', ['riser', 'rise', 'build'])]
def kind(name):
    s = name.lower()
    for k, keys in KEYS:
        if s == k or any(x in s for x in keys): return k
    return 'tick'

def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith('--'): print(__doc__); sys.exit(1)
    P = Path(sys.argv[1]).resolve()
    vo_f = P / 'audio' / 'vo.mp3'
    if not vo_f.exists(): sys.exit('mix: no audio/vo.mp3 (run tools/tts.py first)')
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(vo_f), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
    vo = np.frombuffer(raw, np.float32).astype(np.float64)
    rj = json.loads((P / 'reel.json').read_text()) if (P / 'reel.json').exists() else {}
    vid = P / 'build' / 'video.mp4'
    vlen = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(vid)], capture_output=True, text=True).stdout or 0) if vid.exists() else 0
    N = int(SR * max(len(vo) / SR + 0.6, vlen))
    bus = np.zeros(N)
    cues = json.loads((P / 'build' / 'sfx.json').read_text()) if (P / 'build' / 'sfx.json').exists() and '--no-sfx' not in sys.argv else []
    last, cache, used = {}, {}, 0
    gain0 = float(opt('sfx-gain', rj.get('sfx_gain', 0)))
    # taste: never a wall of SFX. Three tiers: TOP (transitions, slams) always play; MID needs 0.25 s of room after any cue;
    # LIGHT (pops, ticks, typing) needs 0.35 s of room and at most 1 per second. Same kind is never closer than 0.12-0.25 s.
    TOP = {'whoosh', 'stamp', 'impact', 'boom'}; MID = {'swoosh', 'thud', 'ding', 'cash', 'riser'}
    last_any, light = -9.0, []
    for c in sorted(cues, key=lambda c: c['t']):
        k = kind(c.get('name', c.get('n', 'tick'))); t = float(c['t'])
        if t < 0 or t - last.get(k, -9) < (0.12 if k in ('tick', 'click', 'type') else 0.25): continue
        if k in MID and t - last_any < 0.25: continue
        if k not in TOP and k not in MID:
            light = [w for w in light if t - w < 1.0]
            if t - last_any < 0.35 or light: continue
            light.append(t)
        last[k] = t; last_any = t
        x = cache.setdefault(k, synth(k)); i = int(t * SR); used += 1
        g = 10 ** ((min(float(c.get('gain', c.get('g', 0))), 0) + gain0 - 18) / 20)
        seg = x[:max(0, min(len(x), N - i))]; bus[i:i + len(seg)] += seg * g
    mix = np.zeros(N); mix[:len(vo)] += vo[:N]; mix += bus
    music = opt('music', rj.get('music'))
    if music:
        mf = (P / music) if not Path(music).is_absolute() else Path(music)
        mr = subprocess.run(['ffmpeg', '-v', 'error', '-stream_loop', '-1', '-i', str(mf), '-t', str(N / SR), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
        m = np.frombuffer(mr, np.float32).astype(np.float64)[:N]
        e = np.convolve(np.abs(np.pad(vo, (0, max(0, N - len(vo))))[:N]), np.ones(int(SR * 0.25)) / (SR * 0.25), 'same')
        duck = 1 - 0.7 * np.clip(e / (e.max() + 1e-9) * 4, 0, 1)
        mix[:len(m)] += m * 0.16 * duck[:len(m)]
    mix = mix / max(1.0, np.abs(mix).max() / 0.97)
    out = P / 'build' / 'mix.wav'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'f64le', '-ar', str(SR), '-ac', '1', '-i', '-', '-af', 'loudnorm=I=-14:TP=-1.2:LRA=11', '-ar', str(SR), '-ac', '2', str(out)],
                   input=mix.tobytes(), check=True)
    print(f'mix: build/mix.wav  {N / SR:.2f} s  voice + {used} sfx (of {len(cues)} cues; the rest were too close to others and dropped on purpose)' + (' + music' if music else ''))

if __name__ == '__main__': main()
