#!/usr/bin/env python3
"""Fonts for any language, fetched only when needed (Google Noto, SIL Open Font License).

  python3 tools/fonts.py check <project>     # scan script.txt / words.json, fetch whatever the text needs
  python3 tools/fonts.py add arabic hebrew devanagari thai japanese korean chinese ...
  python3 tools/fonts.py list

Downloaded files go to <skill>/fonts/ and are registered in fonts/extra.css under the family "Fallback",
which every engine's font stacks include, so captions in that script just render. Latin, Cyrillic, Greek and Vietnamese are bundled.
"""
import json, re, sys, urllib.request
from pathlib import Path
FONTS = Path(__file__).resolve().parent.parent / 'fonts'
BASE = 'https://github.com/notofonts/notofonts.github.io/raw/main/fonts'
CJK = 'https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF'
SCRIPTS = {   # name: (unicode regex, [(url, file)])
    'arabic': (r'[؀-ۿݐ-ݿ]', [(f'{BASE}/NotoSansArabic/hinted/ttf/NotoSansArabic-Bold.ttf', 'NotoSansArabic-Bold.ttf')]),
    'hebrew': (r'[֐-׿]', [(f'{BASE}/NotoSansHebrew/hinted/ttf/NotoSansHebrew-Bold.ttf', 'NotoSansHebrew-Bold.ttf')]),
    'devanagari': (r'[ऀ-ॿ]', [(f'{BASE}/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Bold.ttf', 'NotoSansDevanagari-Bold.ttf')]),
    'bengali': (r'[ঀ-৿]', [(f'{BASE}/NotoSansBengali/hinted/ttf/NotoSansBengali-Bold.ttf', 'NotoSansBengali-Bold.ttf')]),
    'tamil': (r'[஀-௿]', [(f'{BASE}/NotoSansTamil/hinted/ttf/NotoSansTamil-Bold.ttf', 'NotoSansTamil-Bold.ttf')]),
    'thai': (r'[฀-๿]', [(f'{BASE}/NotoSansThai/hinted/ttf/NotoSansThai-Bold.ttf', 'NotoSansThai-Bold.ttf')]),
    'georgian': (r'[Ⴀ-ჿ]', [(f'{BASE}/NotoSansGeorgian/hinted/ttf/NotoSansGeorgian-Bold.ttf', 'NotoSansGeorgian-Bold.ttf')]),
    'armenian': (r'[԰-֏]', [(f'{BASE}/NotoSansArmenian/hinted/ttf/NotoSansArmenian-Bold.ttf', 'NotoSansArmenian-Bold.ttf')]),
    'japanese': (r'[぀-ヿ一-鿿]', [(f'{CJK}/Japanese/NotoSansCJKjp-Bold.otf', 'NotoSansCJKjp-Bold.otf')]),
    'korean': (r'[가-힯]', [(f'{CJK}/Korean/NotoSansCJKkr-Bold.otf', 'NotoSansCJKkr-Bold.otf')]),
    'chinese': (r'[一-鿿]', [(f'{CJK}/SimplifiedChinese/NotoSansCJKsc-Bold.otf', 'NotoSansCJKsc-Bold.otf')]),
}

def add(name):
    if name not in SCRIPTS: sys.exit(f'unknown script {name}; have: {", ".join(SCRIPTS)}')
    css = (FONTS / 'extra.css').read_text() if (FONTS / 'extra.css').exists() else ''
    for url, fn in SCRIPTS[name][1]:
        f = FONTS / fn
        if not f.exists():
            print(f'downloading {fn} ...'); f.write_bytes(urllib.request.urlopen(url, timeout=300).read())
        rule = f"@font-face {{ font-family: 'Fallback'; src: url('{fn}'); unicode-range: {urange(SCRIPTS[name][0])}; }}"
        if fn not in css: css += rule + '\n'
    (FONTS / 'extra.css').write_text(css); print(f'{name}: ready (family "Fallback")')

def urange(rx):
    """'[a-bc-d]' character class (real characters) → CSS unicode-range 'U+a-b, U+c-d'."""
    body, out, k = rx.strip('[]'), [], 0
    while k < len(body):
        if k + 2 < len(body) and body[k + 1] == '-':
            out.append(f'U+{ord(body[k]):04X}-{ord(body[k + 2]):04X}'); k += 3
        else:
            out.append(f'U+{ord(body[k]):04X}'); k += 1
    return ', '.join(out)

def main():
    a = sys.argv[1:]
    if not a or a[0] == 'list': print('scripts:', ', '.join(SCRIPTS)); return
    if a[0] == 'check':
        p = Path(a[1]); text = ''
        for f in [p / 'script.txt', p / 'build' / 'words.json']:
            if f.exists(): text += f.read_text()
        need = [n for n, (rx, _) in SCRIPTS.items() if re.search(rx, text)]
        if 'chinese' in need and 'japanese' in need: need.remove('chinese')   # the JP face covers kanji too
        for n in need: add(n)
        print('fonts ok' + (f' (+{", ".join(need)})' if need else ' (Latin, Cyrillic, Greek, Vietnamese: bundled)'))
    elif a[0] == 'add':
        for n in a[1:]: add(n)

if __name__ == '__main__': main()
