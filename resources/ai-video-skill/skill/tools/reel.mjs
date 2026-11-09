#!/usr/bin/env node
// reel: the one command Claude uses to make, preview and render reels.
//
//   node tools/reel.mjs new <dir> --style classic|explainer3d|voxel     scaffold a project from the style's template
//   node tools/reel.mjs stills <dir> 1.2 3.4 ... [--scale 0.5] [--only <sceneId>] [--out beat3] [--page kit_preview.html]   frames → <dir>/stills[/beat3]/ + sheet.jpg
//   node tools/reel.mjs video <dir> [--final] [--from s --to s] [--fps 30] [--blur 2]  low-res draft → build/draft.mp4; --final (1080p) → build/video.mp4
//   node tools/reel.mjs motion <dir>                                   is it as dynamic as the creator's reels? score + flat stretches
//   node tools/reel.mjs craft <dir>                                    enough ORIGINAL work (custom props per second), or stock pieces?
//   node tools/reel.mjs mix <dir>                                      voice + SFX (+ optional music) → <dir>/build/mix.wav
//   node tools/reel.mjs export <dir>                                   mix + video → <dir>/out/<name>.mp4 (Instagram-ready)
//   node tools/reel.mjs preview <dir>                                  serve the project, print a URL to watch it live
//
// Page contract (every engine's index.html follows it, see engines/CONTRACT.md):
//   window.READY      Promise, resolves when fonts/assets/scenes are loaded
//   window.DURATION   output length in seconds
//   window.renderAt(t) draws output time t (may return a Promise)
//   window.CAPTURE    'canvas' (default: <canvas id="c"> is the frame) or 'screenshot' (DOM overlays on top of WebGL)
//   window.SFX        optional [{t, name, gain}] sound cues → build/sfx.json for the mixer
//
// Only ONE render runs at a time on this machine (lock), so a laptop never melts.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { launch } from './browser.mjs';
import { serve, SKILL } from './serve.mjs';

const [cmd, dirArg, ...rest] = process.argv.slice(2);
const flag = (k, d) => { const i = rest.indexOf('--' + k); return i < 0 ? d : (rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : true); };
const has = k => rest.includes('--' + k);
const STYLES = fs.readdirSync(path.join(SKILL, 'engines')).filter(s => fs.existsSync(path.join(SKILL, 'engines', s, 'template')));

function die(msg) { console.error('reel: ' + msg); process.exit(1); }
function readJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function project(dir) {
  if (!dir) die('missing project folder');
  const p = path.resolve(dir), cfg = readJSON(path.join(p, 'reel.json'));
  if (!cfg) die(`${p} is not a reel project (no reel.json). Create one with: node tools/reel.mjs new ${dir} --style classic`);
  if (!STYLES.includes(cfg.style)) die(`unknown style "${cfg.style}" in reel.json (have: ${STYLES.join(', ')})`);
  return { dir: p, cfg, name: cfg.name || path.basename(p) };
}
function ff(args, opts = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: opts.input ? ['pipe', 'inherit', 'inherit'] : 'inherit', input: opts.input });
  if (r.status !== 0) die('ffmpeg failed: ' + args.join(' ').slice(0, 300));
}

// ── one render at a time ──
const LOCK = path.join(os.tmpdir(), 'ai-video-skill-render.lock');
async function withLock(fn) {
  let waited = 0;
  for (;;) {
    try { fs.mkdirSync(LOCK); fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid)); break; }
    catch {
      const pid = +readFileSafe(path.join(LOCK, 'pid'));
      if (pid && !alive(pid)) { fs.rmSync(LOCK, { recursive: true, force: true }); continue; }
      if (waited === 0) console.log('another render is running; waiting for it to finish...');
      await new Promise(r => setTimeout(r, 2000)); waited += 2;
    }
  }
  const release = () => { try { fs.rmSync(LOCK, { recursive: true, force: true }); } catch {} };
  process.on('exit', release); process.on('SIGINT', () => { release(); process.exit(130); }); process.on('SIGTERM', () => { release(); process.exit(143); });
  try { return await fn(); } finally { release(); }
}
function readFileSafe(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

// ── open the project page in headless Chromium ──
async function openPage(P, scale, query = '') {
  const { server, url } = await serve(P.dir, P.cfg.style);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const warnings = new Set();
  const isWarn = t => /^\s*(\[warn\]|warning:)/i.test(t);
  page.on('console', m => { if (m.type() !== 'error' || /404|Not Found/i.test(m.text())) return; if (isWarn(m.text())) warnings.add(m.text().split('\n')[0].slice(0, 240)); else errors.push(m.text()); });   // optional files may 404
  await page.goto(`${url}/${flag('page', 'index.html')}${query}`, { timeout: 60000 });
  try { await page.waitForFunction(() => window.READY !== undefined, null, { timeout: 30000 }); await page.evaluate(() => window.READY); }
  catch (e) { die('page never became READY.\n' + errors.slice(0, 8).join('\n') + '\n' + e.message); }
  const real = errors.filter(e => e && e.trim());
  if (real.length) { process.exitCode = 2; console.error(`\n⚠ ${real.length} error(s) while LOADING the page (a scene or kit file failed: everything it draws is missing). Fix first:\n  ` + real.slice(0, 8).join('\n  ')); }
  const meta = await page.evaluate(() => ({ dur: window.DURATION, capture: window.CAPTURE || 'canvas', sfx: window.SFX || null }));
  if (!(meta.dur > 0)) die('window.DURATION is not set by the page');
  if (meta.sfx) fs.writeFileSync(path.join(P.dir, 'build', 'sfx.json'), JSON.stringify(meta.sfx, null, 1));
  const frameErrors = new Map();                          // message → [times]: errors thrown while DRAWING frames (scenes catch them, so they'd be invisible)
  let cur = null, loaded = errors.length;
  page.on('pageerror', e => { if (cur !== null) note(e.message); });
  page.on('console', m => { if (cur !== null && m.type() === 'error' && !/404|Not Found/i.test(m.text()) && !isWarn(m.text())) note(m.text()); });
  const note = msg => { const k = msg.split('\n')[0].replace(/@\s*-?\d+(\.\d+)?/g, '').replace(/\bt=\s*-?\d+(\.\d+)?/g, '').slice(0, 220); if (!frameErrors.has(k)) frameErrors.set(k, []); frameErrors.get(k).push(cur); };
  const report = () => {
    if (warnings.size) console.warn(`\nwarnings (not errors, but worth a look):\n  ` + [...warnings].slice(0, 10).join('\n  '));
    const ef = path.join(P.dir, 'build', 'render_errors.txt');
    if (!frameErrors.size) { try { fs.rmSync(ef); } catch {} return; }   // clean run: no stale error list
    process.exitCode = 2;
    const lines = [...frameErrors].map(([m, ts]) => `  ${ts.length}x  t=${ts[0].toFixed(2)}${ts.length > 1 ? '..' + ts[ts.length - 1].toFixed(2) : ''}  ${m}`);
    fs.writeFileSync(path.join(P.dir, 'build', 'render_errors.txt'), lines.join('\n') + '\n');
    console.error(`\n⚠ ${frameErrors.size} kind(s) of error while drawing frames: those frames are INCOMPLETE. Fix before going on (also in build/render_errors.txt):\n` + lines.slice(0, 12).join('\n'));
  };
  const grab = async (t, q = 0.92) => {
    cur = t;
    await page.evaluate(async t => { await window.renderAt(t); }, t);
    if (meta.capture === 'screenshot') return page.screenshot({ type: 'jpeg', quality: Math.round(q * 100) });
    const b64 = await page.evaluate(q => (document.getElementById('c') || document.querySelector('canvas')).toDataURL('image/jpeg', q).split(',')[1], q);
    return Buffer.from(b64, 'base64');
  };
  return { page, grab, meta, errors, close: async () => { report(); await browser.close().catch(() => {}); server.close(); } };
}

// ── commands ──
async function cmdNew() {
  const style = flag('style', 'classic');
  if (!STYLES.includes(style)) die(`--style must be one of: ${STYLES.join(', ')}`);
  const dst = path.resolve(dirArg || die('usage: reel new <dir> --style <style>'));
  if (fs.existsSync(path.join(dst, 'reel.json'))) die(`${dst} already has a reel.json`);
  fs.cpSync(path.join(SKILL, 'engines', style, 'template'), dst, { recursive: true });
  for (const d of ['build', 'audio', 'stills', 'out', 'assets']) fs.mkdirSync(path.join(dst, d), { recursive: true });
  const cfg = readJSON(path.join(dst, 'reel.json'), {});
  Object.assign(cfg, { style, name: flag('name', path.basename(dst)) });
  const user = readJSON(path.join(os.homedir(), '.config', 'ai-video', 'config.json'), {});   // the buyer's saved defaults
  if (style === 'classic' && user.presenter !== undefined) cfg.presenter = user.presenter;
  if (user.theme && style === 'classic') cfg.theme = Object.assign({}, cfg.theme, user.theme);
  fs.writeFileSync(path.join(dst, 'reel.json'), JSON.stringify(cfg, null, 2));
  console.log(`new ${style} reel at ${dst}\nnext: write script.txt, then  python3 ${path.join(SKILL, 'tools', 'tts.py')} ${dst}`);
}

async function cmdStills() {
  const P = project(dirArg), scale = +flag('scale', 0.5);
  const times = rest.filter((x, i) => /^-?\d+(\.\d+)?$/.test(x) && !(i > 0 && rest[i - 1].startsWith('--'))).map(Number);   // numbers that aren't a flag's value
  if (!times.length) die('give times in seconds, e.g. reel stills <dir> 0.5 2 4.5');
  const only = flag('only'), out = path.join(P.dir, 'stills', typeof flag('out') === 'string' ? flag('out') : '');   // --out <name>: own folder (parallel builders don't clobber each other's sheets)
  fs.mkdirSync(out, { recursive: true });
  await withLock(async () => {
    const pg = await openPage(P, scale, only ? `?only=${only}` : '');
    const files = [];
    for (const t of times) {
      const f = path.join(out, `t${t.toFixed(2)}.jpg`);
      fs.writeFileSync(f, await pg.grab(t)); files.push(f);
    }
    await pg.close();
    console.log('stills:', files.map(f => path.relative(P.dir, f)).join(' '));
    if (has('sheet') || times.length > 1) {
      const cols = Math.min(4, files.length), rows = Math.ceil(files.length / cols), sheet = path.join(out, 'sheet.jpg');
      const list = path.join(out, '.sheet.txt');
      fs.writeFileSync(list, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      ff(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=360:640,tile=${cols}x${rows}:padding=6:color=white`, '-frames:v', '1', sheet]);
      fs.rmSync(list);
      console.log(`sheet: ${path.relative(P.dir, sheet)}   (open it and LOOK before rendering video)`);
    }
  });
}

async function cmdVideo() {
  const P = project(dirArg), final = has('final');
  const scale = +flag('scale', final ? 1 : 0.5), fps = +flag('fps', 30), blur = +flag('blur', 1);   // --blur 2 = motion blur (smoother pans, but can double text on camera kicks)
  const crf = final ? 16 : 22, preset = final ? 'medium' : 'veryfast';
  fs.mkdirSync(path.join(P.dir, 'build'), { recursive: true });
  const out = path.resolve(P.dir, flag('out', final ? 'build/video.mp4' : 'build/draft.mp4'));
  await withLock(async () => {
    const pg = await openPage(P, scale);
    const t0 = +flag('from', 0), t1 = Math.min(+flag('to', pg.meta.dur), pg.meta.dur);
    const n = Math.round((t1 - t0) * fps), w = Math.round(1080 * scale / 2) * 2, h = Math.round(1920 * scale / 2) * 2;
    const vf = (blur > 1 ? `tmix=frames=${blur},select='not(mod(n\\,${blur}))',setpts=N/(${fps}*TB),` : '') + `scale=${w}:${h}:flags=lanczos,format=yuv420p`;
    const enc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps * blur), '-i', '-',
      '-vf', vf, '-r', String(fps), '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const started = Date.now();
    for (let i = 0; i < n * blur; i++) {
      const buf = await pg.grab(t0 + i / (fps * blur), final ? 0.95 : 0.88);
      if (!enc.stdin.write(buf)) await new Promise(r => enc.stdin.once('drain', r));
      if (i % 30 === 0) process.stdout.write(`\r${Math.round(100 * i / (n * blur))}%  ${Math.round((Date.now() - started) / 1000)}s `);
    }
    enc.stdin.end(); await new Promise(r => enc.on('close', r)); await pg.close();
    console.log(`\nvideo: ${path.relative(P.dir, out)}  (${(t1 - t0).toFixed(2)} s, ${w}x${h}, ${fps} fps, ${Math.round((Date.now() - started) / 1000)} s)`);
  });
}

function cmdMotion() {
  const P = project(dirArg);
  const r = spawnSync('python3', [path.join(SKILL, 'tools', 'motion.py'), P.dir, ...rest], { stdio: 'inherit' });
  process.exitCode = r.status;
}

function cmdCraft() {
  const P = project(dirArg);
  const r = spawnSync('python3', [path.join(SKILL, 'tools', 'craft.py'), P.dir], { stdio: 'inherit' });
  process.exitCode = r.status;
}

function cmdMix() {
  const P = project(dirArg);
  const r = spawnSync('python3', [path.join(SKILL, 'tools', 'mix.py'), P.dir, ...rest], { stdio: 'inherit' });
  if (r.status !== 0) die('mix failed');
}

async function cmdExport() {
  const P = project(dirArg);
  const video = path.join(P.dir, fs.existsSync(path.join(P.dir, 'build/video.mp4')) ? 'build/video.mp4' : 'build/draft.mp4');
  if (!fs.existsSync(video)) die('no rendered video yet: run  reel video <dir> --final');
  if (!fs.existsSync(path.join(P.dir, 'build/mix.wav')) || has('remix')) cmdMix();
  fs.mkdirSync(path.join(P.dir, 'out'), { recursive: true });
  const out = path.join(P.dir, 'out', `${P.name}.mp4`);
  ff(['-i', video, '-i', path.join(P.dir, 'build/mix.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
    '-maxrate', '12M', '-bufsize', '24M', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-shortest', '-movflags', '+faststart', out]);
  console.log('export:', path.relative(process.cwd(), out));
}

async function cmdPreview() {
  const P = project(dirArg);
  const { url } = await serve(P.dir, P.cfg.style, +flag('port', 0));
  console.log(`preview: ${url}/index.html?play     single frame: ${url}/index.html?t=3.5     (Ctrl+C to stop)`);
}

const CMDS = { new: cmdNew, stills: cmdStills, video: cmdVideo, motion: cmdMotion, craft: cmdCraft, mix: cmdMix, export: cmdExport, preview: cmdPreview };
if (!CMDS[cmd]) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 19).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
await CMDS[cmd]();
