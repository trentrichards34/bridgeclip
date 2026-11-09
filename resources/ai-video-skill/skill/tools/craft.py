#!/usr/bin/env python3
"""Craft check: is there enough ORIGINAL work in this reel, or is it assembled from stock pieces?

  python3 tools/craft.py <project>

The creator's hand-made reels contain 52-111 lines of scene code and 3-7 custom drawing helpers per second of video,
with a metaphor invented for that script. Reels assembled from showcase props look the same as everyone else's.
Measures the project's own scene files (scenes/*.js, timeline.js, any kit_*.js / lib/*.js you wrote; prop-preview scenes named
scenes/preview*.js or scenes/props*.js are ignored, so don't put real reel code in files with those names):
  lines/s    non-empty, non-comment lines of scene code per second of video
  helpers/s  custom drawing functions you wrote (props, mechanisms, characters) per second
  stock      calls to the showcase props (gauge, clothesline, stackTower, powerStrip, ...): fine once if the script is
             literally about that, generic if they carry the reel
Motion primitives (springs, pendulums, buildStage, mood, typing, odometer...) and the illustrate.js drawing primitives (ISO, isoBox,
shade, dieCut, sticker, isoCar, tinyPerson, shotClock...) are NOT counted as stock: use them freely.
"""
import json, re, sys
from pathlib import Path

TARGET = {'classic': (40, 2.5), 'explainer3d': (35, 1.5), 'voxel': (35, 1.5)}       # (lines/s, helpers/s): ~60-70% of the creator's
STOCK = ['gauge', 'alarmClock', 'stackTower', 'clothesline', 'idBadge', 'powerStrip', 'leverSwitch', 'checklist', 'commentSheet',
         'makeShop', 'makeStreet', 'makeBigSign', 'makeCup', 'makeTracker', 'makeHandset', 'makeCharges', 'makeGrid', 'makeHand',
         # library/classic/illustrated (finished real-looking drawers: study them, draw THIS script's subject with kits/illustrate.js)
         'burger', 'burgerArt', 'fries', 'friesArt', 'fastFoodRestaurant', 'fastFoodRestaurantArt', 'bigBoxStore', 'bigBoxStoreArt',
         'cornerLot', 'cornerLotArt', 'floorPlan', 'floorPlanArt', 'shoppingCart', 'shoppingCartArt', 'playingMiniReel', 'miniReelPhone']

def main():
    if len(sys.argv) < 2: print(__doc__); sys.exit(1)
    P = Path(sys.argv[1]).resolve()
    rj = json.loads((P / 'reel.json').read_text()) if (P / 'reel.json').exists() else {}
    style = rj.get('style', 'classic')
    words = json.loads((P / 'build' / 'words.json').read_text()) if (P / 'build' / 'words.json').exists() else []
    dur = (words[-1]['e'] + 0.6) if words else None
    if not dur: sys.exit('craft: no build/words.json (voice the script first)')
    files = [f for pat in ['scenes/*.js', 'timeline.js', 'plan.js', 'kit_*.js', 'lib/*.js', 'scenes/**/*.js'] for f in P.glob(pat)]
    files = sorted(set(files))
    skill = Path(__file__).resolve().parent.parent
    tpl = skill / 'engines' / style / 'template'
    def stock_copy(f):       # untouched template files and copied engine files are not original work
        t = tpl / f.relative_to(P)
        if t.exists() and t.read_text(errors='ignore') == f.read_text(errors='ignore'): return True
        txt = f.read_text(errors='ignore')
        return any(e.read_text(errors='ignore')[:4000] == txt[:4000] for e in (skill / 'engines' / style).rglob(f.name) if e.is_file())
    def preview(f):          # preview pages and throwaway prop-preview scenes (scenes/preview_<prop>.js, scenes/props.js) aren't the reel
        return f.name.startswith('kit_preview') or f.name == 'showcase.js' or (f.parent.name == 'scenes' and f.name.startswith(('preview', 'props')))
    skipped = [f for f in files if stock_copy(f) or preview(f)]
    files = [f for f in files if f not in skipped]
    src = '\n'.join(f.read_text(errors='ignore') for f in files)
    code = [l for l in src.splitlines() if l.strip() and not l.strip().startswith(('//', '*', '/*'))]
    helpers = len(re.findall(r'\bfunction\s+[A-Za-z_]\w*\s*\(|\b(?:const|let)\s+[A-Za-z_]\w*\s*=\s*(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>', src))
    own = set(re.findall(r'\bfunction\s+([A-Za-z_]\w*)|\b(?:const|let)\s+([A-Za-z_]\w*)\s*=', src)); own = {a or b for a, b in own}
    stock = {s: len(re.findall(r'(?<![.\w])' + s + r'\s*\(', src)) for s in STOCK if s not in own}   # your own same-named function is original work
    stock = {k: v for k, v in stock.items() if v}
    tl, th = TARGET.get(style, TARGET['classic'])
    lps, hps = len(code) / dur, helpers / dur
    print(f'craft check ({style}, {dur:.1f} s, {len(files)} files of your own' + (f', {len(skipped)} template/engine copies or preview files ignored' if skipped else '') + ')')
    print(f'  lines/s    {lps:6.1f}   target ≥ {tl}    {"✓" if lps >= tl else "✗ too little original work: build custom props/mechanisms for THIS script"}')
    print(f'  helpers/s  {hps:6.2f}   target ≥ {th}   {"✓" if hps >= th else "✗ too few custom-drawn objects: invent the metaphor (guides/patterns.md)"}')
    SCENERY = {'makeShop', 'makeStreet', 'makeCup', 'commentSheet', 'makeHand', 'makeCharges', 'makeBigSign'}   # also the template CTA's hand/charges   # backdrops/sets: reusing them across beats is normal
    heavy = {k: v for k, v in stock.items() if v >= 2 and k not in SCENERY}
    if stock: print('  stock props used: ' + ', '.join(f'{k}×{v}' for k, v in stock.items()) + ('   ✗ reused more than once: generic' if heavy else '   (ok if the script is literally about them)'))
    else: print('  stock props used: none ✓')
    ok = lps >= tl and hps >= th and not heavy
    print('PASS' if ok else 'BELOW THE BAR: see guides/patterns.md (metaphor invention + effort budget)')
    sys.exit(0 if ok else 3)

if __name__ == '__main__': main()
