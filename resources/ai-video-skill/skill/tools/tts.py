#!/usr/bin/env python3
"""Voiceover + word timings for a reel project.

  python3 tools/tts.py <project>                      # script.txt → audio/vo.mp3 + build/words.json (uses the saved voice)
  python3 tools/tts.py <project> --voice <voice_id>   # one-off voice
  python3 tools/tts.py <project> --provider openai    # OpenAI TTS (timings via Whisper)
  python3 tools/tts.py <project> --provider file --audio my_take.mp3   # your own recording (timings via Whisper)
  options: --speed 1.15 (playback speed after silence cuts) --gap 0.28 (pause kept where silences are cut) --no-cut

Outputs (every engine reads these):
  audio/vo.mp3          final voice (silences tightened, sped, loudness -14 LUFS)
  build/words.json      [{"w": "word", "s": start_s, "e": end_s}, ...] on the FINAL audio clock
  build/word_index.txt  "index  start  end  word" (handy for cueing scenes on words)
  vo_raw/               the untouched take + alignment (re-cut without paying again: add --reuse)

Keys: ELEVENLABS_API_KEY / OPENAI_API_KEY env vars, or one line in ~/.config/ai-video/elevenlabs.key / openai.key
Voice + defaults: ~/.config/ai-video/config.json (set with tools/voices.py use ...), overridable per project in reel.json "voice".
"""
import base64, json, os, re, shutil, subprocess, sys, urllib.error, urllib.request
from pathlib import Path

CFG_DIR = Path.home() / '.config' / 'ai-video'

def arg(name, default=None):
    if f'--{name}' in sys.argv:
        i = sys.argv.index(f'--{name}')
        return sys.argv[i + 1] if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith('--') else True
    return default

def die(msg): sys.exit('tts: ' + msg)

def key(provider):
    env = {'elevenlabs': 'ELEVENLABS_API_KEY', 'openai': 'OPENAI_API_KEY'}[provider]
    if os.environ.get(env): return os.environ[env].strip()
    for f in [CFG_DIR / f'{provider}.key', Path.home() / '.config' / provider / 'key']:
        if f.exists(): return f.read_text().strip()
    die(f'no {provider} API key. Put it in the {env} environment variable, or save it (one line) to {CFG_DIR / (provider + ".key")}. See SETUP.md.')

def load_cfg(proj):
    c = {'provider': 'elevenlabs', 'model': 'eleven_v4', 'speed': 1.15, 'gap': 0.28, 'stability': 0.45, 'similarity': 0.8, 'style': 0.2}
    for f in [CFG_DIR / 'config.json']:
        if f.exists(): c.update(json.loads(f.read_text()).get('voice', {}))
    rj = proj / 'reel.json'
    if rj.exists():
        r = json.loads(rj.read_text())
        c.update(r.get('voice', {}) or {})
        if r.get('language') and not (r.get('voice') or {}).get('language'): c['language'] = r['language']   # reel language → voice accent
    return c

def dur(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)], capture_output=True, text=True).stdout or 0)

CJK = re.compile(r'[぀-ヿ㐀-鿿가-힯]')

def words_from_chars(chars, starts, ends):
    """ElevenLabs character alignment → words. CJK has no spaces: every CJK character is its own 'word'."""
    words, cur, st, pe = [], '', None, None
    def flush():
        nonlocal cur
        if cur: words.append([cur, st, pe]); cur = ''
    for c, cs, ce in zip(chars, starts, ends):
        if c.isspace(): flush(); continue
        if CJK.match(c):
            flush(); words.append([c, cs, ce]); continue
        if not cur: st = cs
        cur += c; pe = ce
    flush()
    # attach stray punctuation to the previous word
    out = []
    for w in words:
        if out and re.fullmatch(r'[^\w]+', w[0]): out[-1][0] += w[0]; out[-1][2] = w[2]
        else: out.append(w)
    return out

def eleven(text, cfg, raw):
    vid = cfg.get('voice_id') or die('no voice chosen yet. Pick one first: python3 tools/voices.py search "calm male narrator"  then  voices.py use <voice_id>')
    body = {'text': text, 'model_id': cfg['model'], 'voice_settings': {'stability': cfg['stability'], 'similarity_boost': cfg['similarity'], 'style': cfg['style'], 'use_speaker_boost': True}}
    if cfg.get('language'): body['language_code'] = cfg['language']
    def call(model):
        body['model_id'] = model
        req = urllib.request.Request(f'https://api.elevenlabs.io/v1/text-to-speech/{vid}/with-timestamps?output_format=mp3_44100_192',
                                     data=json.dumps(body).encode(), headers={'xi-api-key': key('elevenlabs'), 'Content-Type': 'application/json'})
        return json.load(urllib.request.urlopen(req, timeout=300))
    try: r = call(cfg['model'])
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:400]
        if e.code in (400, 422) and 'model' in msg.lower() and cfg['model'] != 'eleven_multilingual_v2':
            print(f'model {cfg["model"]} not available on this account, using eleven_multilingual_v2'); r = call('eleven_multilingual_v2')
        elif e.code == 401: die('ElevenLabs rejected the key or is out of credits: ' + msg)
        else: die(f'ElevenLabs HTTP {e.code}: {msg}')
    raw.write_bytes(base64.b64decode(r['audio_base64']))
    a = r.get('normalized_alignment') or r['alignment']
    (raw.parent / 'align.json').write_text(json.dumps(a))
    return words_from_chars(a['characters'], a['character_start_times_seconds'], a['character_end_times_seconds'])

def openai_tts(text, cfg, raw):
    body = {'model': cfg.get('openai_model', 'gpt-4o-mini-tts'), 'voice': cfg.get('openai_voice', 'ash'), 'input': text, 'format': 'mp3'}
    if cfg.get('instructions'): body['instructions'] = cfg['instructions']
    req = urllib.request.Request('https://api.openai.com/v1/audio/speech', data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + key('openai'), 'Content-Type': 'application/json'})
    try: raw.write_bytes(urllib.request.urlopen(req, timeout=300).read())
    except urllib.error.HTTPError as e: die(f'OpenAI HTTP {e.code}: {e.read().decode()[:400]}')
    return whisper_words(raw, cfg)

def whisper_words(audio, cfg):
    """Word timings from any audio. whisper.cpp (whisper-cli) if installed, else faster-whisper (pip)."""
    wav = audio.parent / 'w16.wav'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(audio), '-ar', '16000', '-ac', '1', str(wav)], check=True)
    lang = cfg.get('language') or 'auto'
    cli = shutil.which('whisper-cli')
    model = next((p for p in [Path(cfg.get('whisper_model', '')), CFG_DIR / 'ggml-base.bin', Path.home() / '.cache/whisper-cpp/ggml-base.bin',
                              Path.home() / '.cache/whisper-cpp/ggml-base.en.bin'] if str(p) and p.is_file()), None)
    if cli and model:
        out = audio.parent / 'whisper'
        subprocess.run([cli, '-m', str(model), '-f', str(wav), '-ml', '1', '-sow', '-oj', '-l', lang, '-of', str(out)], capture_output=True, check=True)
        seg = json.loads(Path(str(out) + '.json').read_text())['transcription']
        return [[x['text'].strip(), x['offsets']['from'] / 1000, x['offsets']['to'] / 1000] for x in seg if x['text'].strip()]
    try: from faster_whisper import WhisperModel
    except ImportError: die('need word timings from Whisper: install it with  pip3 install faster-whisper  (or brew install whisper-cpp). See SETUP.md.')
    m = WhisperModel('base', device='cpu', compute_type='int8')
    segs, _ = m.transcribe(str(wav), word_timestamps=True, language=None if lang == 'auto' else lang)
    return [[w.word.strip(), w.start, w.end] for s in segs for w in s.words if w.word.strip()]

def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith('--'): print(__doc__); sys.exit(1)
    proj = Path(sys.argv[1]).resolve()
    cfg = load_cfg(proj)
    provider = arg('provider', cfg['provider'])
    if arg('voice'): cfg['voice_id'] = arg('voice')
    speed, gap = float(arg('speed', cfg['speed'])), float(arg('gap', cfg['gap']))
    for d in ['vo_raw', 'audio', 'build']: (proj / d).mkdir(exist_ok=True)
    raw = proj / 'vo_raw' / 'raw.mp3'
    if provider == 'file':
        src = Path(arg('audio') or die('--provider file needs --audio <your recording>'))
        shutil.copy(src, raw); words = whisper_words(raw, cfg)
    elif arg('reuse') and raw.exists() and (proj / 'vo_raw' / 'words_raw.json').exists():
        words = json.loads((proj / 'vo_raw' / 'words_raw.json').read_text())
    else:
        sf = Path(arg('script') or proj / 'script.txt')
        if not sf.exists(): die(f'no script at {sf}')
        text = re.sub(r'\s+', ' ', sf.read_text()).strip()
        words = eleven(text, cfg, raw) if provider == 'elevenlabs' else openai_tts(text, cfg, raw) if provider == 'openai' else die(f'unknown provider {provider}')
    (proj / 'vo_raw' / 'words_raw.json').write_text(json.dumps(words))
    D = dur(raw)
    # silence cuts: every pause longer than MIN shrinks to `gap`, then the whole take is sped up
    MIN = 0.45
    keep = [(max(0.0, words[0][1] - 0.06), None)]
    if not arg('no-cut'):
        log = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(raw), '-af', f'silencedetect=n=-35dB:d={MIN}', '-f', 'null', '-'], capture_output=True, text=True).stderr
        ss = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', log)]; se = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
        t = keep[0][0]; keep = []
        for s, e in zip(ss, se):
            if e <= t or s < t or e - s <= MIN: continue
            mid = (s + e) / 2; keep.append((t, mid - gap / 2)); t = mid + gap / 2
        keep.append((t, min(D, words[-1][2] + 0.3)))
    else: keep = [(keep[0][0], min(D, words[-1][2] + 0.3))]
    def remap(x):
        acc = 0.0
        for a0, a1 in keep:
            if x <= a1: return (acc + max(0.0, x - a0)) / speed
            acc += a1 - a0
        return acc / speed
    flt = ''.join(f'[0:a]atrim={a0:.4f}:{a1:.4f},asetpts=PTS-STARTPTS[s{i}];' for i, (a0, a1) in enumerate(keep))
    flt += ''.join(f'[s{i}]' for i in range(len(keep))) + f'concat=n={len(keep)}:v=0:a=1,atempo={speed},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[o]'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(raw), '-filter_complex', flt, '-map', '[o]', '-ac', '1', '-b:a', '192k', str(proj / 'audio' / 'vo.mp3')], check=True)
    clean = lambda w: w.replace('“', '').replace('”', '').replace('"', '').replace('’', "'")
    W = [{'w': clean(w), 's': round(remap(s), 3), 'e': round(remap(e), 3)} for w, s, e in words if clean(w)]
    (proj / 'build' / 'words.json').write_text(json.dumps(W, ensure_ascii=False, indent=0))
    (proj / 'build' / 'word_index.txt').write_text('\n'.join(f"{i:4d} {x['s']:7.2f} {x['e']:7.2f}  {x['w']}" for i, x in enumerate(W)))
    vd = dur(proj / 'audio' / 'vo.mp3')
    print(f'voice: audio/vo.mp3  {vd:.2f} s  (raw take {D:.2f} s, {len(keep) - 1} pauses tightened, x{speed})  words: {len(W)}  → build/words.json, build/word_index.txt')

if __name__ == '__main__': main()
