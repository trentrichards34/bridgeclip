#!/usr/bin/env node
// Render the explainer3d kit showcase (every kit model, 8 shots) to <project>/stills/showcase_N.jpg + showcase_sheet.jpg.
//   node engines/explainer3d/tools/showcase.mjs <project> [shot numbers...] [--scale 0.5]
// Uses the shared server + headless browser from tools/. Respects the same one-render-at-a-time lock as reel.mjs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { launch } from '../../../tools/browser.mjs';
import { serve } from '../../../tools/serve.mjs';

const args = process.argv.slice(2);
const dir = path.resolve(args[0] || '.');
const si = args.indexOf('--scale'), scale = si >= 0 ? +args[si + 1] : 0.5;
let picks = args.slice(1).filter((a, i) => /^\d+$/.test(a) && !(si >= 0 && i + 1 === si + 1));
const LOCK = path.join(os.tmpdir(), 'ai-video-skill-render.lock');
for (;;) { try { fs.mkdirSync(LOCK); fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid)); break; } catch { await new Promise((r) => setTimeout(r, 2000)); } }
const release = () => { try { fs.rmSync(LOCK, { recursive: true, force: true }); } catch {} };
process.on('exit', release);
const { server, url } = await serve(dir, 'explainer3d');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: scale });
page.on('pageerror', (e) => console.warn('pageerror:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.warn('console:', m.text()); });
await page.goto(`${url}/showcase.html`, { timeout: 60000 });
await page.waitForFunction(() => window.READY !== undefined, null, { timeout: 30000 });
await page.evaluate(() => window.READY);
const names = await page.evaluate(() => window.EXPLAINER3D.names);
if (!picks.length) picks = names.map((_, i) => String(i));
const out = path.join(dir, 'stills'); fs.mkdirSync(out, { recursive: true });
const files = [];
for (const p of picks.map(Number)) {
  await page.evaluate((t) => window.renderAt(t), p + 0.5);
  const f = path.join(out, `showcase_${p}.jpg`);
  fs.writeFileSync(f, await page.screenshot({ type: 'jpeg', quality: 90 })); files.push(f);
  console.log(`${p}: ${names[p]}`);
}
await browser.close(); server.close();
const list = path.join(out, '.showcase.txt');
fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
const cols = Math.min(4, files.length), rows = Math.ceil(files.length / cols);
spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=360:640,tile=${cols}x${rows}:padding=6:color=white`, '-frames:v', '1', path.join(out, 'showcase_sheet.jpg')], { stdio: 'inherit' });
fs.rmSync(list);
console.log('sheet: stills/showcase_sheet.jpg');
release();
