// ───────────────────────── classic engine: boot, timeline, camera, presenter automation, chrome, frame ─────────────────────────
// Page contract (tools/reel.mjs): window.READY, window.DURATION, window.renderAt(t), window.CAPTURE = 'canvas', window.SFX.
// Boot order: reel.json → build/words.json (or fake timings from script.txt) → timeline.js → every file in SCENE_FILES →
//             TIMELINE() → phrases → lip sync → fonts + images → READY.
// Globals a project sets in timeline.js:  SCENE_FILES = [...]; TIMELINE = () => [[key, start], ...]; PHRASES = null | [...];
//                                         READOUT = t => ({ k, v, hot }) | null;  END_AT = seconds | null
let REEL = {}, SCENE_FILES = [], TIMELINE = null, READOUT = null, END_AT = null, SCENES = [], DUR = 0;
const SC = {}, KICKS = [], WIPES = [], SFX_CUES = [];
const QS = new URLSearchParams(location.search);
const ONLY = QS.get('only');

// ── cue registries (call these at scene-file load time, with word-based times) ──
const cue = (t, name, gain = 0) => { if (isFinite(t)) SFX_CUES.push({ t: +Math.max(0, t).toFixed(3), name, gain }); };   // gain dB vs the default SFX level (0 normal, -6 quieter)
const kick = (t, amp = 1, shake = 1, dur = 0.8) => { if (isFinite(t)) KICKS.push({ t, amp, shake, dur }); };            // camera punch: zoom bump + shake
// A kick never outlives its scene: it is shortened (and eased out) so the camera is back to identity on the cut's last frame.
const wipe = (t, mode = 0, col = '#111111') => { if (isFinite(t)) WIPES.push({ t, mode, col: Array.isArray(col) ? '#' + col.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('') : col }); };
// modes: 0 diagonal (top-left → bottom-right) · 1 radial from the centre · 2 bottom → top · 3 left → right. Covers 0.24 s before t, clears 0.3 s after.
// The cover phase eats the LAST ~0.24 s of the outgoing scene: nothing important may land there (finish its beats by t - 0.3).

const sceneAt = t => {
  if (ONLY && SC[ONLY]) return SCENES.find(s => s.key === ONLY) || Object.assign({ key: ONLY, start: 0 }, SC[ONLY]);
  let s = SCENES[0]; for (const x of SCENES) if (t >= x.start) s = x; return s;
};
const DUR_END = () => END_AT || (VO_END + (REEL.tail ?? 0.8));      // final duration (usable at scene load, before DUR is set)
const sceneStart = key => { const s = SCENES.find(x => x.key === key); return s ? s.start : 0; };
const sceneEnd = key => { const i = SCENES.findIndex(x => x.key === key); return i >= 0 && SCENES[i + 1] ? SCENES[i + 1].start : DUR; };

// ── layers ──
const out = document.getElementById('c');
const toneC = document.createElement('canvas'), inkC = document.createElement('canvas');
toneC.width = inkC.width = W; toneC.height = inkC.height = H;
const T = toneC.getContext('2d', { willReadFrequently: false }), K = inkC.getContext('2d');
const halftone = makeHalftone(out, toneC, inkC);
const SAFE_X = 130, SAFE_S = 0.88;   // caption/chrome inset · scene content scaled 0.88 around the bottom-centre (side safe zones)
// screen ↔ scene space (captions + chrome are screen space; scenes draw in scene space). cam: the camera to undo (default identity).
const screenToSceneY = (y, cam) => { const c = cam || { y: 0, z: 1 }; return (H - (H - y) / SAFE_S - H / 2 - (c.y || 0)) / (c.z || 1) + H / 2; };
const sceneToScreenY = (y, cam) => { const c = cam || { y: 0, z: 1 }; return H - (H - ((y - H / 2) * (c.z || 1) + H / 2 + (c.y || 0))) * SAFE_S; };
// the caption block's bottom in SCENE space at time t (keep scene content below it). withCam: also undo this frame's camera
// (true = exact for the current frame; false = the identity-camera value, stable while the camera kicks/leans).
function captionBottomScene(t, withCam = false) { const sc = sceneAt(t); return screenToSceneY(captionBottom(t), withCam && sc ? camera(t, sc) : null); }
const THEME = { paper: '#F6F5F1', accent: '#FF3B1F', ink2: '#D1FE17', ink: '#111111', grain: 0.018 };

// ── camera: sc.cam(t) → {x, y, z, r} + kicks ──
function camera(t, sc) {
  const c = Object.assign({ x: 0, y: 0, z: 1, r: 0 }, sc.cam ? sc.cam(t) : {});
  for (const k of KICKS) {
    const dt = t - k.t; if (dt < 0 || dt > k.dur) continue;
    const nx = SCENES.find(s => s.start > k.t + 1e-6), L = Math.min(k.dur, nx ? nx.start - k.t : 1e9);   // ends with its scene
    if (dt >= L) continue;
    const env = E.inOutCubic(clamp((L - dt) / Math.min(0.2, L)));   // eases to exactly 0 at L (the full decay when there is room)
    c.z *= 1 + k.amp * 0.05 * Math.exp(-dt * 9) * env;
    const sh = k.shake * 16 * Math.exp(-dt * 11) * env;
    c.x += noise1(dt * 38 + k.t * 13) * sh; c.y += noise1(dt * 38 + 50 + k.t * 7) * sh;
  }
  return c;
}

// ── presenter automation: blinks, breathing bob, head motion, lip sync (all additive to the scene's state) ──
function autoGuy(t) {
  let blink = 0;
  for (let k = Math.floor(t / 3.1) - 1; k <= Math.floor(t / 3.1) + 1; k++) {
    const bt = k * 3.1 + hash(k) * 1.6, d = Math.abs(t - bt);
    if (d < 0.08) blink = Math.max(blink, 1 - d / 0.08);
  }
  const e = envAt(t);
  return {
    blink, bob: Math.sin(t * 2.4) * 5 - e * 6,
    headTilt: Math.sin(t * 1.3) * 2.2 + noise1(t * 2.2) * 2.5 * e,
    lookX: noise1(t * 0.45 + 7) * 0.25, lookY: noise1(t * 0.4 + 3) * 0.15,
    ...visAt(t),
    brow: noise1(t * 1.7) * 0.25 * e,
    sy: 1 + Math.sin(t * 2.4) * 0.006,
  };
}
const ADDITIVE = ['bob', 'headTilt', 'lookX', 'lookY', 'brow'];
function guyState(t, base) {
  const a = autoGuy(t), st = Object.assign({}, a, base);
  for (const k of ADDITIVE) if (base[k] !== undefined) st[k] = base[k] + a[k] * (base.still ? 0 : 1);
  if (base.mouth !== undefined && base.talk) st.mouth = Math.max(base.mouth, a.mouth);
  else if (base.mouth !== undefined && base.jaw === undefined) { st.jaw = Math.min(1, base.mouth); st.lipW = -0.2; st.press = 0; st.teeth = 0.2; st.tongue = 0; }   // scripted mouth (shock 'O') overrides lip sync
  if (base.blink !== undefined) st.blink = Math.max(base.blink, a.blink);
  for (const k of ['shock', 'sweat', 'wink', 'blink', 'browTilt', 'armLp', 'armRp']) if (st[k] !== undefined) st[k] = clamp(st[k]);
  for (const k of ['brow', 'smile', 'lookX', 'lookY', 'headTurn']) if (st[k] !== undefined) st[k] = clamp(st[k], -1, 1);
  if (st.mouth !== undefined) st.mouth = clamp(st.mouth, 0, 1.2);
  Object.defineProperty(st, '_norm', { value: true });   // PRESENTER.anchors() knows this state needs no second pass
  return st;
}
// draw the presenter with state `base` (from act() / your own object). Respects reel.json "presenter": false.
function guy(T, K, t, base) {
  if (!base || base.hide || REEL.presenter === false) return;
  PRESENTER.draw(T, K, guyState(t, Object.assign({ t }, base)));
}

// ── chrome: "// 0N — label" top-left + readout top-right (JetBrains Mono 24, warm grey) ──
function chrome(ctx, t, sc) {
  if (sc.noChrome || REEL.chrome === false) return;
  const col = '#8a8780', y = 150;
  text(ctx, sc.label || '', SAFE_X, y, { font: F.mono, weight: 500, size: 24, color: col, align: 'left' });
  const r = sc.readout ? sc.readout(t) : null;          // { k: 'CLIPS', v: '12/40', hot: bool }
  if (r) {
    const vf = { font: F.mono, weight: 700, size: 26 }, vw = measure(ctx, r.v, vf);
    text(ctx, r.k, W - SAFE_X - vw - 14, y, { font: F.mono, weight: 500, size: 24, color: col, align: 'right', ls: 2 });
    text(ctx, r.v, W - SAFE_X, y, Object.assign({ color: r.hot ? (r.col || C.red) : col, align: 'right' }, vf));
  }
}

// ── one frame ──
function renderFrame(t) {
  const sc = sceneAt(t);
  T.setTransform(1, 0, 0, 1, 0, 0); K.setTransform(1, 0, 0, 1, 0, 0);
  K.clearRect(0, 0, W, H);
  T.fillStyle = '#FFFFFF'; T.fillRect(0, 0, W, H);              // white tone = bare paper (the shader prints the paper colour)
  if (sc.back) sc.back(T, K, t);                                 // optional full-frame background in screen space
  const cam = camera(t, sc);
  for (const ctx of [T, K]) {
    ctx.save();
    ctx.translate(W / 2, H); ctx.scale(SAFE_S, SAFE_S); ctx.translate(-W / 2, -H);
    ctx.translate(W / 2 + cam.x, H / 2 + cam.y); ctx.rotate(cam.r); ctx.scale(cam.z, cam.z); ctx.translate(-W / 2, -H / 2);
  }
  try {
    if (sc.draw) sc.draw(T, K, t);
    if (sc.guy) { const g = sc.guy(t); if (Array.isArray(g)) g.forEach(x => guy(T, K, t, x)); else guy(T, K, t, g); }
    if (sc.front) sc.front(T, K, t);
  } catch (e) { console.error('scene "' + sc.key + '" error @' + t.toFixed(2) + ': ' + e.message + '\n' + e.stack); }
  T.restore(); K.restore();
  try { headline(K, t, sc); chrome(K, t, sc); if (sc.top) sc.top(T, K, t); } catch (e) { console.error('caption/chrome error: ' + e.message); }
  let wp = null;
  for (const w of (sc.key === 'presenter' ? [] : WIPES)) {   // the presenter sheet's pages are not reel time: no wipes there
    // cover 0 → 0.85 in 0.24 s (≈ 99 % covered on the last frame before the cut), then the next scene already shows through the
    // dots: the reveal starts at 1.4. Measured at 30 fps: one frame with < 2 % visible, no stretch of black frames.
    if (t >= w.t - 0.24 && t < w.t) wp = { p: 0.85 * (t - (w.t - 0.24)) / 0.24, mode: w.mode, col: w.col };
    else if (t >= w.t && t < w.t + 0.3) wp = { p: 1.4 + 0.6 * (t - w.t) / 0.3, mode: w.mode, col: w.col };
  }
  halftone({ t, paper: THEME.paper, accent: THEME.accent, ink2: THEME.ink2, ink: THEME.ink, grain: THEME.grain, wipe: wp });
}

// ── built-in presenter sheet: reel stills <dir> 0 1 2 3 4 5 --only presenter (4 = act() aimed at up-left targets, 5 = moods + stamp) ──
SC.presenter = {
  label: '// presenter', noHeadline: () => true, readout: null,
  draw(T, K, t) {
    const page = Math.floor(t + 0.001), L = PRESENTER.look(window.PRESENTER_LOOK);
    const lbl = (s, x, y) => text(K, s, x, y, { font: F.mono, weight: 500, size: 26, color: '#8a8780' });
    const base = { blink: 0, bob: 0, headTilt: 0, lookX: 0, lookY: 0, jaw: 0, lipW: 0, press: 0.1, teeth: 0, tongue: 0, smile: 0.35, still: true, t };
    const at = (x, y, s, st) => PRESENTER.draw(T, K, Object.assign({}, base, { x, y, s }, st));
    text(K, `${L.hair} · ${L.skin} · ${L.top} · beard ${L.beard}${L.glasses ? ' · glasses' : ''}${L.beanie ? ' · beanie' : ''}`, W / 2, 230, { font: F.mono, weight: 500, size: 26, color: C.ink });
    if (page === 0) {            // portrait: front + three-quarter talking / pointing
      at(540, 1300, 1.0, {}); lbl('front', 540, 380);
      at(300, 2000, 0.55, { headTurn: -0.55, lookX: -0.5, headTilt: -4, jaw: 0.45, lipW: 0.4, teeth: 0.5, smile: 0.7 });
      at(800, 2000, 0.55, { headTurn: 0.4, lookX: -0.6, lookY: -0.5, headTilt: 3, armL: 'point', pointAng: -62 });
      lbl('3/4 talking', 300, 1420); lbl('pointing (default acting)', 760, 1420);
    } else if (page === 1) {     // poses
      const up = { lean: -7, bodyTurn: -0.28, headTurn: -0.3, headNod: -0.3, lookX: -0.5, lookY: -0.8 };
      const P = [['point', { armL: 'point', pointAng: -45, lean: -4, bodyTurn: -0.2, lookX: -0.6, lookY: -0.4 }], ['point up', Object.assign({ armL: 'point', pointAng: -80 }, up)],
        ['present', { armL: 'present', pointAng: -50, lean: -4, lookX: -0.5, lookY: -0.4, smile: 0.7 }], ['frame', Object.assign({ armL: 'frame', armR: 'frame', pointAngL: -70, pointAngR: -95, smile: 0.6 }, up, { lean: -3 })],
        ['hold', { armR: 'hold' }], ['thumb', { armR: 'thumb', smile: 0.9 }], ['shrug', { armL: 'shrug', armR: 'shrug', brow: 0.6 }], ['fist', { armR: 'fist', smile: 0.8 }],
        ['wave', { armR: 'wave', wave: 0.5 }], ['facepalm', { armR: 'facepalm', smile: -0.3 }], ['cover', { armR: 'cover', brow: 0.8 }], ['present up', Object.assign({ armL: 'present', pointAng: -82, smile: 0.7 }, up)],
        ['shh', { armR: 'shh', press: 1, brow: 0.4, smile: 0.2 }]];
      P.forEach(([n, st], i) => { const x = 150 + (i % 4) * 260, y = 700 + Math.floor(i / 4) * 390; at(x, y, 0.28, st); lbl(n, x, y + 34); });
    } else if (page === 2) {     // expressions (larger heads)
      const X3 = [['neutral', {}], ['smile', { smile: 1, brow: 0.4 }], ['skeptical', { browTilt: 0.7, smile: 0.2 }], ['shock', { shock: 1, mouth: 0.8 }],
        ['worried', { brow: -0.7, smile: -0.5, sweat: 1 }], ['wink', { wink: 1, smile: 0.9 }], ['talking', { jaw: 0.6, lipW: 0.3, teeth: 0.5 }], ['oo', { jaw: 0.4, lipW: -0.9 }], ['mm', { press: 1 }]];
      X3.forEach(([n, st], i) => { const x = 200 + (i % 3) * 340, y = 860 + Math.floor(i / 3) * 500; at(x, y, 0.5, st); lbl(n, x, y + 40); });
    } else if (page === 4) {     // act() aiming at up-left targets (the docked presenter's usual case): point / present / frame
      const OFF = [[-800, -1112, 'shallow'], [-542, -1290, 'typical'], [-177, -1362, 'steep']], s = 0.3;
      ['point', 'present', 'frame'].forEach((pose, r) => OFF.forEach(([dx, dy, nm], c) => {
        const g = { x: 250 + c * 360, y: 700 + r * 540, s }, tg = [g.x + dx * s, g.y + dy * s];
        circle(K, tg[0], tg[1], 16, C.red); circle(K, tg[0], tg[1], 30, null, C.red, 4);
        const st = act(t, { at: g, focus: () => tg, pose, jab: false, gestures: false });
        guy(T, K, t, st);
        const an = PRESENTER.anchors(st);                     // raw act() state in: the rings must sit on the drawn hand + mouth
        for (const p of [an.handL, an.handR, an.mouth]) if (p) circle(K, p.x, p.y, 9, null, C.ink, 3);
        lbl(pose + ' · ' + nm, g.x - 60, g.y + 36);
      }));
    } else if (page === 5) {     // mood() presets + moodFx (one per cell) and a stamp with a long sub line
      const M = [['panic'], ['shock'], ['thinking', { bubble: [0, -1] }], ['celebrate'], ['shh'], ['shrug']];
      M.forEach(([n, ex], i) => {
        const g = { x: 200 + (i % 3) * 340, y: 900 + Math.floor(i / 3) * 520, s: 0.4 };
        const e = ex && ex.bubble ? { bubble: [g.x + 190, g.y - 500] } : ex;   // thinking: custom bubble up-RIGHT of the head
        const L = [[n, t - 0.7, t + 2, e]];
        moodFx(T, K, t, L, { at: g });
        guy(T, K, t, act(t, mood(t, L, { at: g, focus: null, gestures: false })));
        lbl(n + (e && e.bubble ? ' (bubble: [x, y])' : ''), g.x, g.y + 36);
      });
      stamp(K, T, 'SHIPPED', 540, 1600, 1, { size: 104, rot: -6, sub: 'ON TIME · UNDER BUDGET · NO WEEKEND WORK' });
    } else {                     // hairstyle catalogue in the configured colours
      const hs = PRESENTER.HAIRSTYLES;
      const rowH = Math.min(520, 1220 / Math.max(1, Math.ceil(hs.length / 4) - 1));   // every style fits on the page
      hs.forEach((h, i) => { const x = 160 + (i % 4) * 255, y = 600 + Math.floor(i / 4) * rowH; PRESENTER.draw(T, K, Object.assign({}, base, { x, y, s: 0.3, look: Object.assign({}, window.PRESENTER_LOOK, { hair: h, beanie: false }) })); lbl(h, x, y + 36); });
    }
  },
};

// ── boot ──
const fetchJSON = (u, d) => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.json() : d).catch(() => d);
const fetchText = (u, d) => fetch(u, { cache: 'no-store' }).then(r => r.ok ? r.text() : d).catch(() => d);
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.body.appendChild(s); });

window.CAPTURE = 'canvas';
window.READY = (async () => {
  REEL = await fetchJSON('reel.json', {}) || {};
  const th = REEL.theme || {};
  Object.assign(THEME, { paper: th.paper || THEME.paper, accent: th.accent || THEME.accent, ink2: th.ink2 || THEME.ink2, grain: th.grain ?? THEME.grain });
  C.red = THEME.accent; window.ACCENT = THEME.accent;
  if (REEL.captions && typeof REEL.captions === 'object') for (const k of ['size', 'maxW', 'x', 'y', 'lead', 'maxWords', 'color', 'emphasis']) if (REEL.captions[k] !== undefined) CAP[k] = REEL.captions[k];
  if (REEL.presenter && typeof REEL.presenter === 'object') { window.PRESENTER_LOOK = REEL.presenter; if (REEL.presenter.dock) PRESENTER_DOCK = Object.assign({}, PRESENTER_DOCK, REEL.presenter.dock); }
  let words = await fetchJSON('build/words.json', null);
  if (!Array.isArray(words) || !words.length) {
    console.warn('build/words.json missing: using fake timings from script.txt (run tools/tts.py for the real voice clock)');
    words = fakeWords((await fetchText('script.txt', '')) || 'Write your script in script.txt.');
  }
  WORDS = words.filter(w => w && String(w.w).trim()).map(w => ({ w: String(w.w), s: +w.s, e: +w.e }));
  VO_END = WORDS.length ? WORDS[WORDS.length - 1].e : 3;
  buildSentences();
  await loadScript('timeline.js');
  for (const f of SCENE_FILES) await loadScript(f);
  const list = TIMELINE ? TIMELINE() : Object.keys(SC).filter(k => k !== 'presenter').map((k, i) => [k, i === 0 ? 0 : frac(i / Object.keys(SC).length)]);
  SCENES = list.map(([key, start], i) => Object.assign({ label: `// ${String(i + 1).padStart(2, '0')} — ${key}`, readout: READOUT },
    SC[key] || { draw: () => {}, guy: t => act(t) }, { key, start: i === 0 ? 0 : start }));
  SCENES.sort((a, b) => a.start - b.start);
  DUR = DUR_END();
  window.DURATION = DUR;
  // phrases
  const cuts = SCENES.slice(1).map(s => s.start);
  const P = PHRASES || autoPhrases(cuts);
  PHRASE_LIST = P.map(([i0, i1, em = [], o = {}], n) => ({ n, i0, i1, em, o, s: wi(i0), end: P[n + 1] ? wi(P[n + 1][0]) - 0.04 : DUR + 1 }));
  EMPH_TIMES = PHRASE_LIST.flatMap(p => p.em.map(i => wi(i)));
  buildLipSync(WORDS, DUR);
  const fonts = ['500 100px "Space Grotesk"', '700 100px "Space Grotesk"', 'italic 400 100px "Instrument Serif"', '400 100px "Instrument Serif"',
    '500 100px "JetBrains Mono"', '700 100px "JetBrains Mono"', '400 100px Anton', '500 100px Inter', '700 100px Inter', '800 100px Inter'];
  await Promise.all([...fonts.map(f => document.fonts.load(f).catch(() => {})), ...ASSETS.map(([k, src]) => loadImg(k, src))]);
  {   // any character outside Latin + Latin Extended (U+0000-024F): Cyrillic, Greek, Arabic, CJK... → load the matching Fallback faces before frames
    const txt = [(WORDS || []).map(w => w.w).join(' '), uiStrings().join(' '), (REEL.cta && REEL.cta.keyword) || ''].join(' ');
    if (/[^\u0000-\u024F]/.test(txt)) await Promise.all(['400 80px Fallback', '500 80px Fallback', '700 80px Fallback', 'italic 400 80px Fallback'].map(f => document.fonts.load(f, txt).catch(() => {})));
  }

  window.SFX = SFX_CUES.filter(c => c.t <= DUR).sort((a, b) => a.t - b.t);
  return true;
})();
window.READY.catch(e => console.error('boot failed: ' + e.message));
window.renderAt = t => renderFrame(Math.max(0, Math.min(t, DUR - 1e-3)));

// ?t=3.5 one frame · ?play real-time with the voice (click to start) · default frame 0
window.READY.then(() => {
  if (QS.has('play')) {
    document.body.classList.add('fit');
    const au = new Audio(QS.get('audio') || 'audio/vo.mp3');
    let t0 = null;
    renderFrame(+(QS.get('from') || 0));
    const start = () => {
      au.currentTime = +(QS.get('from') || 0); au.play().catch(() => {}); t0 = performance.now() - au.currentTime * 1000;
      const loop = () => { const t = au.paused && au.currentTime === 0 ? (performance.now() - t0) / 1000 : au.currentTime; renderFrame(Math.min(t, DUR - 0.001)); if (t < DUR) requestAnimationFrame(loop); };
      loop();
    };
    document.addEventListener('click', start, { once: true });
    console.log('click the page to play with audio');
  } else renderFrame(QS.has('t') ? parseFloat(QS.get('t')) : 0);
});
