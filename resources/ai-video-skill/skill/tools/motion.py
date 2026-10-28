#!/usr/bin/env python3
"""Motion check: is the reel as dynamic as the creator's reels? Scores a rendered video and lists the flat stretches.

  python3 tools/motion.py <project> [video.mp4]      (default: the newest of build/draft.mp4 and build/video.mp4)

Measures, at 10 fps on a small grayscale copy (the presenter corner is ignored):
  motion  = average picture change per 0.1 s          (how much is moving)
  big/s   = strong changes per second                  (cuts, slams, whips, big reveals)
  flat    = 1.5 s windows with little change            (where viewers scroll away)
Targets are ~80% of the creator's own reels in that style. Below target = add build-up, secondary motion, camera moves.
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np

TARGETS = {   # style: (motion, big per second)   creator's reels measured: classic 5.0-8.0 / 0.7-1.6; explainer3d 12.6-16.8 / 4.0-5.4; voxel 20.4 / 6.7
    'classic': (4.8, 0.65), 'explainer3d': (11.0, 3.5), 'voxel': (16.0, 5.0)}
FLAT = {      # style: (a 1.5 s window is "flat" below this level, max share of the reel allowed flat)   calibrated so the creator's reels pass
    'classic': (2.0, 0.27), 'explainer3d': (3.0, 0.08), 'voxel': (5.0, 0.05)}

def main():
    if len(sys.argv) < 2: print(__doc__); sys.exit(1)
    P = Path(sys.argv[1]).resolve()
    rj = json.loads((P / 'reel.json').read_text()) if (P / 'reel.json').exists() else {}
    style = rj.get('style', 'classic')
    cands = [f for f in [P / 'build' / 'video.mp4', P / 'build' / 'draft.mp4'] if f.exists()]
    vid = Path(sys.argv[2]) if len(sys.argv) > 2 else (max(cands, key=lambda f: f.stat().st_mtime) if cands else None)   # the NEWEST render
    if not vid or not vid.exists(): sys.exit('motion: render a draft first (reel video <project>)')
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(vid), '-vf', 'fps=10,scale=108:192,format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
    v = np.frombuffer(raw, np.uint8).reshape(-1, 192, 108).astype(np.float32)
    mask = np.ones((192, 108), bool)
    if style == 'classic' and rj.get('presenter', True) is not False: mask[130:, 70:] = False   # the presenter's own idle motion doesn't count
    d = np.abs(np.diff(v, axis=0))[:, mask].mean(axis=1)
    if len(d) < 15: sys.exit('motion: video too short')
    tm, tb = TARGETS.get(style, TARGETS['classic'])
    motion, big = float(d.mean()), float((d > 12).sum() / (len(d) / 10))
    ok = motion >= tm and big >= tb
    print(f'motion check ({style}, {vid.name}, {len(d) / 10:.1f} s)')
    print(f'  motion {motion:5.2f}   target ≥ {tm}   {"✓" if motion >= tm else "✗ too calm"}')
    print(f'  big/s  {big:5.2f}   target ≥ {tb}   {"✓" if big >= tb else "✗ too few big moments (cuts, slams, reveals, whips)"}')
    # flat windows: 1.5 s rolling mean below 40% of the motion target
    lvl, fmax = FLAT.get(style, FLAT['classic'])
    win = 15; roll = np.convolve(d, np.ones(win) / win, 'valid'); low = roll < lvl; flat = float(low.mean())
    words = json.loads((P / 'build' / 'words.json').read_text()) if (P / 'build' / 'words.json').exists() else []
    spans, i = [], 0
    while i < len(low):
        if low[i]:
            j = i
            while j < len(low) and low[j]: j += 1
            a, b = i / 10, (j + win) / 10
            if spans and a <= spans[-1][1]: spans[-1] = (spans[-1][0], b)   # merge overlapping windows
            else: spans.append((a, b))
            i = j
        else: i += 1
    print(f'  flat   {flat * 100:4.0f}%   target ≤ {fmax * 100:.0f}%  {"✓" if flat <= fmax else "✗ too many still stretches"}')
    if spans:
        print('  flat stretches (add a build-up event, secondary motion or a camera move here):')
        for a, b in spans[:12]:
            said = ' '.join(w['w'] for w in words if a <= w['s'] < b)
            print(f'    {a:5.1f}-{b:5.1f}s  "{said[:70]}"')
    else: print('  no flat stretches ✓')
    ok = ok and flat <= fmax
    print('PASS' if ok else 'BELOW THE BAR: see guides/styles/' + style + '.md → "Quality bar"')
    sys.exit(0 if ok else 3)

if __name__ == '__main__': main()
