#!/usr/bin/env node
// Setup check. Prints ✓ / ✗ for everything the skill needs, with the exact fix. Never prints secrets.
//   node tools/doctor.mjs            (add --quick to skip the browser launch test)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = path.join(os.homedir(), '.config', 'ai-video');
const mac = os.platform() === 'darwin', win = os.platform() === 'win32';
const rows = []; let bad = 0;
// --set-plan <max|pro|api|team|codex|cursor|other>: remember the user's AI plan (decides how much parallel work the skill does)
const PLANS = ['max', 'pro', 'api', 'team', 'codex', 'cursor', 'other'];
const ip = process.argv.indexOf('--set-plan');
if (ip > -1) {
  const v = (process.argv[ip + 1] || '').toLowerCase();
  if (!PLANS.includes(v)) { console.error('--set-plan needs one of: ' + PLANS.join(', ')); process.exit(1); }
  fs.mkdirSync(CFG, { recursive: true });
  const f = path.join(CFG, 'config.json'); let c = {}; try { c = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  c.agent_plan = v; fs.writeFileSync(f, JSON.stringify(c, null, 2));
  console.log(`saved: AI plan = ${v} (effort mode: ${['max', 'api', 'team'].includes(v) ? 'full, parallel scene builders' : 'lean, one scene at a time'})`); process.exit(0);
}
const ok = (name, detail = '') => rows.push(`  ✓ ${name}${detail ? '  ' + detail : ''}`);
const no = (name, fix, optional = false) => { if (!optional) bad++; rows.push(`  ${optional ? '○' : '✗'} ${name}\n      fix: ${fix}`); };
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return r.status === 0 ? (r.stdout || r.stderr || '').trim() : null; };

// Node
const nv = +process.versions.node.split('.')[0];
nv >= 18 ? ok('Node.js', 'v' + process.versions.node) : no('Node.js 18+', 'install the LTS from https://nodejs.org (then reopen the terminal)');

// npm packages
const hasMod = m => fs.existsSync(path.join(SKILL, 'node_modules', m, 'package.json'));
hasMod('playwright') && hasMod('three') ? ok('npm packages', 'playwright, three') : no('npm packages', `cd "${SKILL}" && npm install`);

// ffmpeg
const ffv = run('ffmpeg', ['-version']);
ffv ? ok('ffmpeg', ffv.split('\n')[0].split(' ').slice(0, 3).join(' ')) :
  no('ffmpeg', mac ? 'brew install ffmpeg   (no Homebrew? see https://brew.sh)' : win ? 'winget install Gyan.FFmpeg   (then reopen the terminal)' : 'sudo apt install ffmpeg');
run('ffprobe', ['-version']) ? null : (ffv && no('ffprobe', 'comes with ffmpeg: reinstall ffmpeg'));

// Python + numpy
const py = win ? 'python' : 'python3';
const pyv = run(py, ['--version']);
if (!pyv) no('Python 3', mac ? 'brew install python' : win ? 'install from https://python.org (tick "Add to PATH")' : 'sudo apt install python3 python3-pip');
else {
  ok('Python', pyv.replace('Python ', 'v'));
  run(py, ['-c', 'import numpy']) !== null ? ok('numpy') : no('numpy (for the audio mix)', `${py} -m pip install numpy`);
}

// Browser
if (hasMod('playwright') && !process.argv.includes('--quick')) {
  try {
    const { launch } = await import('./browser.mjs');
    const b = await launch(); const p = await b.newPage();
    const gl = await p.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
    await b.close();
    gl ? ok('headless browser', 'Chromium with WebGL') : no('WebGL in the headless browser', '3D styles need WebGL. Update graphics drivers, or set CHROME_PATH to a Chrome install');
  } catch (e) { no('headless browser', `cd "${SKILL}" && npm run browser   (${e.message.split('\n')[0].slice(0, 120)})`); }
}

// ElevenLabs key (never printed) + credits
const keyFile = [path.join(CFG, 'elevenlabs.key'), path.join(os.homedir(), '.config', 'elevenlabs', 'key')].find(f => fs.existsSync(f));
const key = process.env.ELEVENLABS_API_KEY || (keyFile && fs.readFileSync(keyFile, 'utf8').trim());
const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(CFG, 'config.json'), 'utf8')); } catch { return {}; } })();
const provider = cfg.voice?.provider || 'elevenlabs';
if (provider === 'elevenlabs') {
  if (!key) no('ElevenLabs API key', `create a key at https://elevenlabs.io/app/settings/api-keys (free plan works), then save it as ONE line in the file:\n           ${path.join(CFG, 'elevenlabs.key')}\n           (or set the ELEVENLABS_API_KEY environment variable). Don't paste it into the chat.`);
  else {
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key } });
      const body = r.status === 401 ? await r.text() : '';
      if (r.status === 401 && /missing_permissions|user_read/.test(body)) ok('ElevenLabs key', 'saved (key has no "User: read" permission, so credits can\'t be shown; that\'s fine)');
      else if (r.status === 401) no('ElevenLabs API key', 'the saved key was rejected: create a new one and replace the file content');
      else if (r.ok) { const s = await r.json(); const left = (s.character_limit ?? 0) - (s.character_count ?? 0);
        ok('ElevenLabs key', `plan ${s.tier}, ~${left.toLocaleString()} characters left (a 45 s reel uses ~800)`);
        if (left < 900) no('ElevenLabs credits', 'not enough characters for one reel: top up or wait for the monthly reset', true); }
      else ok('ElevenLabs key', `saved (status check returned ${r.status})`);
    } catch { ok('ElevenLabs key', 'saved (offline: could not verify)'); }
  }
} else if (provider === 'openai') {
  (process.env.OPENAI_API_KEY || fs.existsSync(path.join(CFG, 'openai.key'))) ? ok('OpenAI API key') : no('OpenAI API key', `save it as one line in ${path.join(CFG, 'openai.key')}`);
}

// Voice chosen
cfg.voice?.voice_id || provider !== 'elevenlabs' ? ok('voice', cfg.voice?.name || cfg.voice?.voice_id || provider)
  : no('voice not chosen yet', 'ask Claude: "help me pick a voice" (python3 tools/voices.py search "...")');

// AI plan → effort mode (the AI can't read the subscription itself, so it asks once)
cfg.agent_plan ? ok('AI plan', `${cfg.agent_plan} → ${['max', 'api', 'team'].includes(cfg.agent_plan) ? 'full mode (parallel scene builders)' : 'lean mode (one scene at a time, fits usage limits)'}`)
  : no('AI plan not set', 'ask the user which plan they use (Claude Pro, Claude Max, API, Team, Codex, Cursor), then: node tools/doctor.mjs --set-plan <max|pro|api|team|codex|cursor|other>');

// Optional: Whisper (only for your own recordings / OpenAI voices)
const wcli = run('whisper-cli', ['--help']) !== null;
const fw = pyv && run(py, ['-c', 'import faster_whisper']) !== null;
const multiModel = [path.join(CFG, 'ggml-base.bin'), path.join(os.homedir(), '.cache/whisper-cpp/ggml-base.bin')].some(f => fs.existsSync(f));
wcli || fw ? ok('Whisper (optional)', wcli ? 'whisper.cpp' + (multiModel || fw ? '' : ' (English-only model: for other languages pip install faster-whisper)') : 'faster-whisper') :
  no('Whisper (optional: only for your own voice recordings or OpenAI voices)', `${py} -m pip install faster-whisper`, true);

// Presenter (classic style)
ok('presenter (classic style)', cfg.presenter === false ? 'off' : cfg.presenter ? 'your own look, saved' : 'default look (say "make my presenter from this photo" to get your own)');

console.log(`AI Video Skill setup check  (${SKILL})\n` + rows.join('\n'));
console.log(bad ? `\n${bad} thing(s) to fix. Fix them top to bottom, then run this again.` : '\nAll set. Ask for a reel!');
process.exit(bad ? 1 : 0);
