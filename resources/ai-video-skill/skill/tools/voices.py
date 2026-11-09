#!/usr/bin/env python3
"""Pick and save the voice your reels use (ElevenLabs).

  python3 tools/voices.py mine                         # voices already in your ElevenLabs account
  python3 tools/voices.py search "calm deep male narrator" [--lang en] [--gender male] [--age middle_aged]
                                                       # the public Voice Library (thousands of voices); prints preview links
  python3 tools/voices.py preview <voice_id> ["sample text"]   # speak a sample → ~/.config/ai-video/previews/<id>.mp3 (and plays it on Mac)
  python3 tools/voices.py add <public_owner_id> <voice_id> "<name>"   # add a Library voice to your account (needed before using it)
  python3 tools/voices.py use <voice_id> [--name "Joe"] [--speed 1.15] [--model eleven_v4] [--language en]
                                                       # save as the default voice for every reel (~/.config/ai-video/config.json)
  python3 tools/voices.py provider openai [--openai-voice ash]   # switch provider (elevenlabs | openai | file)
  python3 tools/voices.py show                         # current saved settings (never prints keys)
"""
import json, os, subprocess, sys, urllib.parse, urllib.request, urllib.error
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from tts import key, CFG_DIR

API = 'https://api.elevenlabs.io'

def get(path, params=None):
    url = API + path + ('?' + urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v}) if params else '')
    try: return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'xi-api-key': key('elevenlabs')}), timeout=60))
    except urllib.error.HTTPError as e: sys.exit(f'voices: HTTP {e.code}: {e.read().decode()[:300]}')

def post(path, body, raw=False):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers={'xi-api-key': key('elevenlabs'), 'Content-Type': 'application/json'})
    try:
        r = urllib.request.urlopen(req, timeout=120)
        return r.read() if raw else json.load(r)
    except urllib.error.HTTPError as e: sys.exit(f'voices: HTTP {e.code}: {e.read().decode()[:300]}')

def opt(k, d=None):
    return sys.argv[sys.argv.index('--' + k) + 1] if '--' + k in sys.argv else d

def cfg_load():
    f = CFG_DIR / 'config.json'
    return json.loads(f.read_text()) if f.exists() else {}

def cfg_save(c):
    CFG_DIR.mkdir(parents=True, exist_ok=True)
    (CFG_DIR / 'config.json').write_text(json.dumps(c, indent=2))

def main():
    a = sys.argv[1:]
    if not a: print(__doc__); return
    if a[0] == 'mine':
        for v in get('/v1/voices')['voices']:
            l = v.get('labels') or {}
            print(f"{v['voice_id']}  {v['name'][:28]:28s} {l.get('gender', ''):7s} {l.get('age', ''):12s} {l.get('accent', ''):12s} {v.get('category', '')}")
    elif a[0] == 'search':
        q = ' '.join(x for x in a[1:] if not x.startswith('--') and x not in {opt('lang'), opt('gender'), opt('age')})
        r = get('/v1/shared-voices', {'search': q, 'page_size': 12, 'language': opt('lang'), 'gender': opt('gender'), 'age': opt('age'), 'sort': 'trending'})
        for v in r.get('voices', []):
            print(f"{v['voice_id']}  owner {v['public_owner_id']}\n   {v['name']} · {v.get('gender', '')} · {v.get('age', '')} · {v.get('accent', '')} · {v.get('use_case', '')} · used {v.get('cloned_by_count', 0)}x\n   {(v.get('description') or '')[:140]}\n   preview: {v.get('preview_url', '')}")
        print('\nTo use one: voices.py add <owner> <voice_id> "<name>"  then  voices.py use <voice_id>')
    elif a[0] == 'preview':
        vid, text = a[1], (a[2] if len(a) > 2 and not a[2].startswith('--') else "Here's a quick sample of how your reels will sound with this voice.")
        audio = post(f'/v1/text-to-speech/{vid}?output_format=mp3_44100_128', {'text': text, 'model_id': opt('model', 'eleven_multilingual_v2')}, raw=True)
        d = CFG_DIR / 'previews'; d.mkdir(parents=True, exist_ok=True); f = d / f'{vid}.mp3'; f.write_bytes(audio)
        print('preview:', f)
        if sys.platform == 'darwin': subprocess.run(['afplay', str(f)])
    elif a[0] == 'add':
        r = post(f'/v1/voices/add/{a[1]}/{a[2]}', {'new_name': a[3] if len(a) > 3 else 'Reel voice'})
        print('added to your account:', r.get('voice_id', r))
    elif a[0] == 'use':
        c = cfg_load(); v = c.setdefault('voice', {})
        v.update({'provider': 'elevenlabs', 'voice_id': a[1]})
        for k, cast in [('name', str), ('speed', float), ('model', str), ('language', str)]:
            if opt(k) is not None: v[k] = cast(opt(k))
        cfg_save(c); print('saved default voice:', json.dumps(v))
    elif a[0] == 'provider':
        c = cfg_load(); v = c.setdefault('voice', {}); v['provider'] = a[1]
        if opt('openai-voice'): v['openai_voice'] = opt('openai-voice')
        cfg_save(c); print('provider:', a[1])
    elif a[0] == 'show':
        print(json.dumps(cfg_load(), indent=2) or '{}')
        for p in ['elevenlabs', 'openai']:
            ok = os.environ.get(p.upper() + '_API_KEY') or (CFG_DIR / f'{p}.key').exists() or (Path.home() / '.config' / p / 'key').exists()
            print(f'{p} key: {"found" if ok else "missing"}')
    else: print(__doc__)

if __name__ == '__main__': main()
