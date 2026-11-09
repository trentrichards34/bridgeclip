// main.js: the voxel runtime. Loads words + reel.json + the project's plan.js, boots the studio, captions and every scene,
// then exposes the page contract (engines/CONTRACT.md): window.READY / DURATION / renderAt(t) / CAPTURE = 'screenshot' / SFX.
//   index.html?t=12.5     render one frame at t
//   index.html?play       real-time playback (click the page to start audio/vo.mp3 in sync)
//   index.html?only=<id>  only that beat's scene is loaded + updated (other beats are not imported: a placeholder orbit stands in,
//                         so their missing/broken files raise no errors; build/sfx.json is not rewritten)
//   index.html?only=kit   the kit preview sheet (project kit_preview.js), pages 1..N at t = 1..N
//   (captions: one style, the speech bubble)
//
// SCENE CONTRACT (project scenes/<id>.js, default export):
//   async init(ctx, spec)   build everything under ONE root group at spec.o (station origin); ctx.scene.add(root).
//                           Keep state in spec.state (a fresh {} per beat) so one scene file can serve several beats.
//                           Register sound cues here: ctx.sfx(time, 'boom' | 'pop' | ..., gainDb).
//   update(ctx, t, spec)    pose EVERYTHING from t (frames render out of order). Hide the root outside [t0 - 0.6, t1 + 0.6].
//                           While t is in [t0 - blend/2, t1 + blend/2] set ctx.focus / ctx.bg / ctx.dof / ctx.shake / ctx.flash ...
//   camera(ctx, t, spec)    -> { pos:[x,y,z], target:[x,y,z], fov, roll } in WORLD coords, valid for t in [t0 - 0.45, t1 + 0.45].
//
// WHIP TIMING: the whip-pan into beat n+1 lasts its `blend` (0.45 s). By default it is centred on the cut, so the camera starts
// spinning OUT of beat n at t1 - blend/2 (~0.22 s before t1) and everything on beat n's last word lands in the blur. Plan last-word
// events >= 0.25 s before t1 (ctx.whipOut(spec) = the time the whip-out starts), or set `whipLead` (seconds, 0..blend) on beat n
// in plan.js to start the whip later (whipLead: 0.08 = the camera holds until 0.08 s before the cut, then the spin finishes in beat n+1).
//
// TONE: a beat may set `tone: 'bright'` (or { exposure, bloomK }) in plan.js: the core applies it as the default ctx.exposure /
// ctx.bloomK for that beat (scenes can still override). 'bright' = exposure 0.9, bloom 0.2: cream paper / light props in interiors.
import * as THREE from 'three';
import { createStudio, paintGrain, loadFonts, LOOK, W, H } from './studio.js';
import { buildPlan, bare, keyWords as kwRange, sentences } from './plan.js';
import { Captions } from './captions.js';
import * as U from './util.js';

const FPS = 30;
const qs = new URLSearchParams(location.search);
const proj = (p) => new URL(p, location.href).href;

// the palette scenes may use for backdrops (ctx.bg presets)
export const P = {
  bg: LOOK.bg,
  sky: { top: '#8fb6e0', mid: '#bcd5ea', bottom: '#e8dcc4' },          // daytime street
  dusk: { top: '#3b3a78', mid: '#7a5a8a', bottom: '#e0a070' },
  night: { top: '#2a2350', mid: '#1f1a3a', bottom: '#120f22' },
  stage: { top: '#1a1630', mid: '#14112a', bottom: '#0c0a18' },
  warm: { top: '#f3d9b0', mid: '#e9c08e', bottom: '#c98f5a' },
  coral: '#e2704f', paper: '#f3ead8', ink: '#1d1a16', gold: '#e0b24a', yes: '#3fae5a', no: '#d8433a',
};
// exposure / bloom presets (plan.js `tone: 'bright'` per beat, or Object.assign(ctx, ctx.TONES.bright) inside a scene's window)
export const TONES = {
  normal: { exposure: 1.0, bloomK: 0.35 },
  bright: { exposure: 0.9, bloomK: 0.2 },     // bright interiors: cream paper, white boards, light walls bloom/haze at the default
  dim: { exposure: 1.1, bloomK: 0.4 },        // night / dark sets with bulbs and screens
};

export async function boot() {
  if (qs.get('only') === 'kit') {           // kit preview mode (same page, same contract)
    const { bootPreview } = await import('./preview.js');
    return bootPreview();
  }
  const canvas = document.getElementById('c');
  const S = createStudio(canvas);
  const { scene, camera } = S;

  const [words, reel, planMod] = await Promise.all([
    fetch(proj('build/words.json')).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch(proj('reel.json')).then((r) => r.json()).catch(() => ({})),
    import(proj('plan.js')),
  ]);
  if (!words.length) console.error('build/words.json is missing or empty: run tools/tts.py first (using a 6 s silent placeholder)');
  { const txt = (words || []).map(w => w.w).join(' '); if (/[^\u0000-\u024F\s\p{P}\p{N}]/u.test(txt)) await Promise.all(['400 80px Fallback', '700 80px Fallback', '900 80px Fallback', 'italic 400 80px Fallback'].map(f => document.fonts.load(f, txt).catch(() => {}))); }   // non-Latin script → load its Fallback face before frames

  const { specs: PLAN, DURATION } = buildPlan(words, planMod.BEATS, planMod.OPTIONS, reel);

  const capCfg = reel.captions ?? {};
  const caps = new Captions(document.getElementById('hud'), words, capCfg);
  const flash = document.getElementById('flash');
  paintGrain(document.getElementById('grain'), U.rng(5));

  // ---- word helpers for scenes ----
  function wordAt(w, from = 0, nth = 0) {           // start time of the nth occurrence of a word at/after `from`, or null
    const b = bare(w); let n = 0;
    for (const x of words) if (x.s >= from - 0.05 && bare(x.w) === b) { if (n === nth) return x.s; n++; }
    return null;
  }
  // cue(spec, word, frac = 0.5, nth = 0): time of `word` inside the beat, else spec.t0 + frac * beat length. ALWAYS returns a number.
  function cue(spec, w, frac = 0.5, nth = 0) {
    const t = w == null ? null : wordAt(w, spec.t0 - 0.1, nth);
    return t !== null && t < spec.t1 + 0.05 ? t : spec.t0 + frac * (spec.t1 - spec.t0);
  }
  // wi(spec, k): start time of the beat's k-th word (negative = from the end), clamped to the beat
  function wi(spec, k) { const ws = spec.words; if (!ws.length) return spec.t0; const w = ws[Math.max(0, Math.min(ws.length - 1, k < 0 ? ws.length + k : k))]; return w.s; }

  const SFX = [];
  // whip window into beat n (n >= 1): [start, end]. lead = how long before the cut the outgoing spin starts (beat n-1's whipLead).
  function whipWin(n) {
    const s = PLAN[n], b = s?.blend || 0; if (!s || n < 1 || b <= 0) return null;
    const lead = U.clamp(Number.isFinite(PLAN[n - 1].whipLead) ? PLAN[n - 1].whipLead : b / 2, 0, b);
    return [s.t0 - lead, s.t0 - lead + b, b];
  }
  const ctx = {
    THREE, U, P, W, H, FPS, PLAN, DURATION, words, reel, scene, camera, renderer: S.renderer,
    key: S.key, rim: S.rim, hemi: S.hemi, bloom: S.bloom, composer: S.composer, fx: document.getElementById('fx'),
    keyword: String(reel?.cta?.keyword ?? 'REEL').toUpperCase(),
    wordAt, cue, wi,
    keyWords: (spec, n = 3) => kwRange(words, spec.i0, spec.i1, n),         // the beat's most important words [{w, s, e, i}]
    sentences: (spec) => sentences(spec.words).map((s) => ({ ...s, t0: spec.words[s.i0].s, t1: spec.words[s.i1].e, text: spec.words.slice(s.i0, s.i1 + 1).map((w) => w.w).join(' ') })),
    sfx: (t, name, gain = -2) => { if (Number.isFinite(t)) SFX.push({ t: Math.max(0, +t.toFixed(3)), name, gain }); },
    whipOut: (spec) => { const w = whipWin(spec.n + 1); return w ? w[0] : spec.t1; },   // when the camera starts spinning out of this beat
    whipIn: (spec) => { const w = whipWin(spec.n); return w ? w[1] : spec.t0; },        // when the spin into this beat has settled
    TONES,
    // per-frame overrides (reset every frame):
    bg: null, exposure: null, bloomK: null, focus: null, dof: 1, capDy: 0, capHide: false, headHide: false, flash: 0, shake: 0, after: [], t: 0,
  };
  window.ctx = ctx;

  // ---- scenes ----
  const only = qs.get('only');
  if (only && !PLAN.some((s) => s.id === only)) console.error(`?only=${only} matches no beat id (beats: ${PLAN.map((s) => s.id).join(', ')})`);
  const scenes = [];
  for (const spec of PLAN) {
    spec.state = {};
    if (only && spec.id !== only) { scenes.push({ spec, mod: placeholder(spec), skipped: true }); continue; }   // --only: don't load the rest
    let mod = null;
    try { mod = (await import(proj(`scenes/${spec.scene}.js`))).default; }
    catch (e) { console.error(`scene scenes/${spec.scene}.js missing or broken, using a placeholder: ${e.message}`); mod = placeholder(spec); }
    scenes.push({ spec, mod });
  }
  for (const s of scenes) { if (s.skipped) continue; try { await s.mod.init?.(ctx, s.spec); } catch (e) { console.error('init failed', s.spec.id, e.stack || e); s.broken = true; } }
  // a soft whoosh peaks on every whip between stations
  for (let n = 1; n < PLAN.length; n++) { const w = whipWin(n); if (w) ctx.sfx(w[0] + w[2] / 2 - 0.2, 'whoosh', -6); }
  SFX.sort((a, b) => a.t - b.t);

  function placeholder(spec) {
    return { camera(ctx, t) { return U.orbit(spec.o, 40, (t - spec.t0) * 10, 20, 32); } };
  }

  // ---- camera ----
  function scenePose(i, t) {
    const s = scenes[i];
    try { return (s.mod.camera && !s.broken) ? s.mod.camera(ctx, t, s.spec) : placeholder(s.spec).camera(ctx, t); }
    catch (e) { console.error('camera failed', s.spec.id, e); return placeholder(s.spec).camera(ctx, t); }
  }
  function beatIndex(t) {
    const i = scenes.findIndex((s) => t >= s.spec.t0 && t < s.spec.t1);
    return i < 0 ? (t < 0 ? 0 : scenes.length - 1) : i;
  }
  // Transition = whip pan: the outgoing shot spins away (ease-in yaw + roll + horizontal motion blur), the incoming shot spins in
  // from the other side, so every frame shows a scene (never a flight through empty space).
  let whipBlur = 0;
  function whip(p, ang) {
    const pos = U.v3(p.pos), tg = U.v3(p.target), d = tg.clone().sub(pos);
    d.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(ang));
    return { ...p, target: U.arr(pos.clone().add(d)), roll: (p.roll ?? 0) + ang * 0.12 };
  }
  function blendPose(i, t, k) {
    const dir = i % 2 ? 1 : -1, A = 14;
    whipBlur = Math.sin(Math.PI * k) ** 2;
    if (k < 0.5) return whip(scenePose(i - 1, t), dir * A * U.easeIn(k * 2));
    return whip(scenePose(i, t), -dir * A * (1 - U.easeOut((k - 0.5) * 2)));
  }
  function poseAt(t) {
    const i = beatIndex(t);
    whipBlur = 0;
    for (const n of [i, i + 1]) {          // the whip into this beat (still spinning in) or into the next one (spinning out)
      const w = n < scenes.length ? whipWin(n) : null;
      if (w && t >= w[0] && t < w[1]) return blendPose(n, t, U.clamp((t - w[0]) / w[2]));
    }
    return scenePose(i, t);
  }

  const whipdev = document.getElementById('whipdev');
  window.renderAt = (tOut) => {
    const t = Math.min(Math.max(0, tOut), DURATION - 0.02);
    Object.assign(ctx, { t, tOut, bg: null, exposure: null, bloomK: null, focus: null, dof: 1, capDy: 0, capHide: false, headHide: false, flash: 0, shake: 0, after: [] });
    { const tone = scenes[beatIndex(t)].spec.tone, tn = typeof tone === 'string' ? TONES[tone] : tone;   // per-beat tone preset (default)
      if (tn) { ctx.exposure = tn.exposure ?? null; ctx.bloomK = tn.bloomK ?? null; } }
    for (const s of scenes) {
      if (s.broken || !s.mod.update) continue;
      if (only && s.spec.id !== only) continue;
      try { s.mod.update(ctx, t, s.spec); } catch (e) { console.error('update failed', s.spec.id, e.stack || e); s.broken = true; }
    }
    let p = poseAt(t);
    if (window.__cam) p = window.__cam;
    const sh = ctx.shake > 0 ? new THREE.Vector3(U.drift(t * 9, 1), U.drift(t * 9, 2), U.drift(t * 9, 3)).multiplyScalar(ctx.shake * 0.35) : null;
    S.applyCamera(p, sh);
    for (const f of ctx.after) { try { f(ctx); } catch (e) { console.error('after callback failed', e); } }
    S.render({ bg: ctx.bg, exposure: ctx.exposure, bloomK: ctx.bloomK, focus: ctx.focus, dof: ctx.dof, target: p.target });
    whipdev.setAttribute('stdDeviation', `${(whipBlur * 38).toFixed(1)} ${(whipBlur * 3).toFixed(1)}`);
    canvas.style.filter = whipBlur > 0.01 ? 'url(#whipblur)' : 'none';
    flash.style.opacity = U.clamp(ctx.flash);
    caps.update(t, { dy: ctx.capDy, hide: ctx.capHide });
    { let i = beatIndex(t); const s = scenes[i].spec; while (i > 0 && scenes[i - 1].spec.head === s.head) i--;
      caps.headline(ctx.headHide ? null : s.head, t, scenes[i].spec.t0); }
    return true;
  };
  window.DURATION = DURATION; window.FPS = FPS; window.CAPTURE = 'screenshot'; window.SFX = only ? null : SFX;   // --only: partial cues, don't overwrite build/sfx.json window.PLAN = PLAN;

  await loadFonts();
  window.renderAt(0.01);   // warm up: compile every shader once

  if (qs.has('t')) window.renderAt(parseFloat(qs.get('t')));
  else if (qs.has('play')) {
    const audio = new Audio(proj('audio/vo.mp3'));
    let t0 = performance.now(), started = false;
    addEventListener('click', () => { if (started) return; started = true; audio.currentTime = 0; audio.play().catch(() => {}); t0 = performance.now(); });
    const loop = () => {
      const t = started && !audio.paused ? audio.currentTime : ((performance.now() - t0) / 1000) % DURATION;
      window.renderAt(t); requestAnimationFrame(loop);
    };
    loop();
  } else window.renderAt(Math.min(2, DURATION / 2));
  return true;
}
