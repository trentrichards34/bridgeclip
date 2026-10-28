// ───────────────────────── mechanics kit: motion PRIMITIVES (how things move), not finished props ─────────────────────────
// Extracted and generalised from the creator's hand-made reels: springs, pendulums, gravity, integrated speed, idle life, the build-up
// stage + its camera, presenter acting (mood/moodFx, hero step-in, REC viewfinder), generic live UI (prompt composer, video scrubber,
// odometer / live stat, toast stack) and the palette flood.
// It deliberately ships NO finished metaphor props: every reel invents its own central metaphor and draws 2-5 custom props for its
// script (guides/patterns.md), using these primitives for HOW they move. Studied example props (gauge, alarm clock, tower, clothesline,
// power strip, lever) live in library/classic/props/: read them for the techniques, never paste them.
// Everything is a pure function of t (deterministic), cued on word times you pass in. Every component:
//   · has an ENTRANCE with overshoot + settle, an IDLE life (it keeps moving after it lands) and reacts physically to its cues,
//   · draws soft shadows/glows on T (halftone) and crisp ink on K,
//   · returns anchor points (scene space) you can hand to act({ focus }) so the presenter points at the newest thing.
// Only `function` and `var` at top level, so loading this file twice (index.html + SCENE_FILES) is harmless.
// Guide: guides/styles/classic.md → "Quality bar" and "12b. Mechanics kit".

// ═════════════ 1 · physics primitives ═════════════
// value that SPRINGS from key to key: keys [[t, v], ...] (sorted). Overshoots and settles at every key. f = frequency, z = damping.
function springTo(t, keys, f = 2.2, z = 0.42) {
  let v = keys[0][1];
  for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * spring(t - keys[i][0], f, z);
  return v;
}
// same for objects: keys [[t, {x, y, s, r}], ...] → {x, y, s, r} (missing props keep the previous key's value)
function springObj(t, keys, f = 2.2, z = 0.5) {
  const o = Object.assign({}, keys[0][1]), prev = Object.assign({}, keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i][1], sp = spring(t - keys[i][0], f, z);
    for (const p in k) { const a = prev[p] ?? k[p]; o[p] = (o[p] ?? a) + (k[p] - a) * sp; prev[p] = k[p]; }
  }
  return o;
}
// damped pendulum angle after a hit (deg): amp · e^(-k·dt) · cos(2π f dt); 0 before dt = 0
function pendulum(dt, amp = 14, f = 1.2, k = 2) { return dt < 0 ? 0 : amp * Math.exp(-k * dt) * Math.cos(TAU * f * dt); }
// ballistic fall from t0: {dx, dy, r (deg), on}. vx/vy px/s, spin deg/s, g px/s²
function gravityFall(t, t0, vx = 0, vy = -300, spin = 120, g = 5200) {
  const d = Math.max(0, t - t0);
  return { dx: vx * d, dy: vy * d + 0.5 * g * d * d, r: spin * d, on: t > t0 };
}
// integrated speed: keys [[t, speed], ...] (speed linear between keys, constant outside) → phase at t (e.g. clock revolutions)
function phaseAt(t, keys) {
  let ph = 0, pt = 0, ps = keys[0][1];
  for (const [kt, ks] of keys) {
    if (kt <= pt) { ps = ks; continue; }
    if (t <= kt) { const sNow = lerp(ps, ks, (t - pt) / (kt - pt)); return ph + (t - pt) * (ps + sNow) / 2; }
    ph += (kt - pt) * (ps + ks) / 2; pt = kt; ps = ks;
  }
  return ph + (t - pt) * ps;
}
function speedAt(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], inv(keys[i - 1][0], keys[i][0], t));
  return keys[keys.length - 1][1];
}
// idle life for anything that has landed: {dx, dy, r}; amp 1 = the creator's default float (±6 px, ±1.2°)
function idleSway(t, seed = 0, amp = 1) {
  return { dx: noise1(t * 0.7 + seed * 3.1) * 4 * amp, dy: Math.sin(t * 2.1 + seed * 1.7) * 6 * amp, r: Math.sin(t * 1.6 + seed * 2.3) * 1.2 * amp };
}
// rect morph a → b with an arc lift (carry-over transitions): a, b = {x, y, w, h}
function morphRect(a, b, p, lift = 60) {
  const q = clamp(p);
  return { x: lerp(a.x, b.x, q), y: lerp(a.y, b.y, q) - Math.sin(q * Math.PI) * lift, w: lerp(a.w, b.w, q), h: lerp(a.h, b.h, q) };
}
var _M_MEAS = null;
function _mctx() { return _M_MEAS || (_M_MEAS = document.createElement('canvas').getContext('2d')); }
function _mA(cs, a, fn) { if (a <= 0.002) return; for (const c of cs) { c.save(); c.globalAlpha *= clamp(a); } fn(); for (const c of cs) c.restore(); }
var _MG = '#8a8780';
function _mono(size, o = {}) { return Object.assign({ font: F.mono, weight: 500, size, color: _MG, align: 'left' }, o); }
// word wrap → array of lines (measured with the given font)
function wrapText(str, f, maxW) {
  const ctx = _mctx(), out = [];
  for (const para of String(str).split('\n')) {
    let cur = '';
    for (const w of para.split(' ')) { const tst = cur ? cur + ' ' + w : w; if (cur && measure(ctx, tst, f) > maxW) { out.push(cur); cur = w; } else cur = tst; }
    out.push(cur);
  }
  return out;
}
// small live bits (secondary motion)
function spinner(K, x, y, r, t, col = C.red, lw = 5) { K.save(); K.translate(x, y); K.rotate(t * 7); K.strokeStyle = col; K.lineWidth = lw; K.lineCap = 'round'; K.beginPath(); K.arc(0, 0, r, 0, 4.2); K.stroke(); K.restore(); }
function typingDots(K, x, y, t, col = _MG, r = 6) { for (let i = 0; i < 3; i++) { const k = 0.5 + 0.5 * Math.sin(t * 9 - i * 0.9); circle(K, x + i * r * 3, y - k * r * 0.8, r * (0.75 + 0.25 * k), col); } }
function liveDot(K, x, y, r, t, col = C.red) { const k = 0.5 + 0.5 * Math.sin(t * 8); circle(K, x, y, r * (1 + 0.9 * k), `rgba(255,59,31,${0.25 * (1 - k)})`); circle(K, x, y, r, col); }

// ═════════════ 2 · BUILD-UP STAGE ═════════════
/* The creator's core grammar: the stage BUILDS UP. Every stressed word adds or changes one element; earlier elements stay and keep living.
   const ST = buildStage([
     { id: 'thing', t: T_A, x: 330, y: 760, enter: 'drop',  draw: (T, K, t, e) => {...your own prop, local coords centred on 0,0...} },
     { id: 'part',  t: T_B, x: 830, y: 620, enter: 'pop',   idle: 1, focus: [0, -20] },
     { id: 'hit',   t: T_C, x: 800, y: 980, enter: 'slide', from: 1, moves: [[T_D, { x: 700, s: 0.8 }]], exit: T_E, exitMode: 'fall' },
   ], { sfx: true });
   draw: ST.draw(T, K, t)              guy: t => act(t, { focus: t => ST.focus(t) })        cam: t => stageCam(t, ST, { release: S1 - 0.3 })
   Element fields: id, t (enters ON its word), x, y, s = 1, r = 0, draw(T, K, t, e) (e = {age, p, newest, i, x, y, s}),
     enter 'pop' | 'drop' | 'slide' (from: -1 left / 1 right) | 'rise' | 'swing' | 'stamp' | 'none',
     idle (amp, default 1: floats after landing; 0 = still), nudge (default 1: jolts when a newer element lands),
     moves [[t, {x, y, s, r}]] springs to new spots (make room, shrink to the side), exit t + exitMode 'fall' | 'up' | 'shrink' | 'left' | 'right',
     focus [dx, dy] pointing offset, z draw order, sfx name (default by enter) / null, gain dB, kick amp (camera punch on landing),
     carry: true = CARRY-OVER from the previous scene: on stage from the first frame, no entrance / SFX, already idling, oldest for focus
       (t may be omitted). Elements WITHOUT carry are hidden until their entrance starts (only 'drop' shows ~0.2 s early, falling).
   FOCUS OVERRIDE (the presenter's point + the stage camera normally follow the NEWEST element):
     buildStage(els, { focus: [[t0, t1, target], ...] })  or  ST.focusOn(target, t0, t1 = forever)  (chainable)
     target = an element id ('part') · [x, y] scene point · t => [x, y] · null (nobody points). Glides in/out over 0.25 s; later wins.
     No invisible draw:null elements needed to move the focus.                                                                          */
function buildStage(els, o = {}) {
  const L = els.map((e, i) => Object.assign({ i, s: 1, r: 0, enter: 'pop', idle: 1, nudge: 1, exitMode: 'fall', z: i, focus: [0, 0] }, e,
    e.carry ? { enter: 'none', sfx: null, t: e.t ?? -1e9 } : {}));
  const FO = (o.focus || []).map(([t0, t1, target]) => ({ t0, t1, target }));
  const SFX = { pop: 'pop', drop: 'thud', slide: 'swoosh', rise: 'swoosh', swing: 'swoosh', stamp: 'stamp', none: null };
  if (o.sfx !== false && typeof cue === 'function') for (const e of L) {
    const n = e.sfx === undefined ? SFX[e.enter] : e.sfx;
    if (n && isFinite(e.t)) cue(e.t, n, e.gain ?? (n === 'stamp' || n === 'thud' ? -2 : -5));
    if (e.kick && typeof kick === 'function') kick(e.t + 0.02, e.kick, e.kick);
  }
  const base = (e, t) => e.moves ? springObj(t, [[-1e9, { x: e.x, y: e.y, s: e.s, r: e.r }], ...e.moves], 2.0, 0.55) : { x: e.x, y: e.y, s: e.s, r: e.r };
  function geom(e, t) {
    const g = base(e, t), dt = e.carry ? Math.max(t - e.t, 9) : t - e.t;
    let x = g.x, y = g.y, s = g.s, r = g.r, a = 1, p = 1;
    if (dt < -0.25 && e.enter !== 'none') return null;
    switch (e.enter) {
      case 'pop': p = pop(dt, 2.6, 0.45); s *= Math.max(0, p); a = clamp(dt / 0.06); r += (1 - clamp(p)) * -8; break;
      case 'drop': {
        const D = 0.2;
        if (dt < 0) { if (dt < -D) return null; y -= Math.pow(-dt / D, 2) * 700; p = 0; }
        else { const sq = ring(dt, 4, 10) * 0.1; e._sq = sq; p = 1; }
        break;
      }
      case 'slide': { const dir = e.from || 1; p = pop(dt, 2.2, 0.6); x += (1 - p) * 760 * dir; r += (1 - clamp(p)) * 10 * dir; a = clamp(dt / 0.05); break; }
      case 'rise': p = pop(dt, 2.0, 0.55); y += (1 - p) * 900; a = clamp(dt / 0.05); break;
      case 'swing': p = pop(dt, 2.4, 0.5); s *= clamp(p * 1.4, 0, 1); r += pendulum(dt, 26, 1.3, 3) * (dt >= 0 ? 1 : 0); a = clamp(dt / 0.05); break;
      case 'stamp': if (dt < 0) return null; s *= dt < 0.14 ? lerp(2.4, 1, E.inQuart(dt / 0.14)) : 1 + ring(dt - 0.14, 5, 12) * 0.05; a = clamp(dt / 0.06); p = clamp(dt / 0.14); break;
      default: break;
    }
    if (dt < 0 && e.enter !== 'drop') return null;
    // idle life once settled
    if (e.idle && dt > 0) { const w = clamp((dt - 0.25) / 0.5) * e.idle, id = idleSway(t, e.i * 1.37 + 0.5, w); x += id.dx; y += id.dy; r += id.r; }
    // nudged by every newer element that lands
    if (e.nudge) for (const n of L) {
      if (n === e || n.t <= e.t) continue;
      const d = t - n.t; if (d < 0 || d > 0.9) continue;
      const vx = g.x - n.x, vy = g.y - n.y, l = Math.hypot(vx, vy) || 1, k = 18 * e.nudge * Math.exp(-5.5 * d) * Math.sin(TAU * 2.1 * d);
      x += vx / l * k; y += vy / l * k; r += (vx > 0 ? 1 : -1) * k * 0.12;
    }
    // exit
    if (e.exit != null && t >= e.exit) {
      const d = t - e.exit;
      switch (e.exitMode) {
        case 'up': y += exitY(t, e.exit, 0.4, 1700); if (d > 0.42) return null; break;
        case 'shrink': s *= Math.max(0, 1 - E.inBack(clamp(d / 0.24))); if (d > 0.24) return null; break;
        case 'left': case 'right': { const dir = e.exitMode === 'left' ? -1 : 1; x += E.inCubic(clamp(d / 0.3)) * 1400 * dir; r += d * 40 * dir; if (d > 0.3) return null; break; }
        default: { const f = gravityFall(t, e.exit, (hash(e.i * 7 + 1) - 0.5) * 900, -380 - hash(e.i) * 200, (hash(e.i * 3) - 0.5) * 300, 5600); x += f.dx; y += f.dy; r += f.r; if (f.dy > 2200) return null; }
      }
    }
    return { x, y, s, r, a, p, dt };
  }
  const live = (e, t) => (e.carry || t >= e.t - 0.02) && (e.exit == null || t < e.exit);
  function newestAt(t) { let n = null; for (const e of L) if (live(e, t) && (!n || e.t >= n.t)) n = e; return n; }
  const fpt = (e, t) => { const g = geom(e, t) || base(e, t); return [g.x + e.focus[0] * (g.s || 1), g.y + e.focus[1] * (g.s || 1)]; };
  function resolveFocus(target, t) {
    if (target == null) return null;
    if (typeof target === 'function') return target(t);
    if (Array.isArray(target)) return target;
    const e = L.find(x => x.id === target); return e ? fpt(e, t) : null;
  }
  return {
    els: L,
    draw(T, K, t) {
      const nw = newestAt(t);
      for (const e of L.slice().sort((a, b) => a.z - b.z)) {
        const g = geom(e, t); if (!g || g.s <= 0.001) continue;
        const sq = e.enter === 'drop' && g.dt > 0 ? ring(g.dt, 4, 10) * 0.1 : 0;
        if (e.enter === 'drop' && g.dt >= 0 && g.dt < 0.55) { puff(T, g.x - 120 * g.s, g.y + 120 * g.s, g.dt, 0.7, -1); puff(T, g.x + 120 * g.s, g.y + 120 * g.s, g.dt, 0.7, 1); }
        _mA([T, K], g.a, () => {
          for (const c of [T, K]) { c.save(); c.translate(g.x, g.y); c.rotate(g.r * D2R); c.scale(g.s * (1 + sq), g.s * (1 - sq)); }
          if (e.draw) e.draw(T, K, t, { age: t - e.t, p: g.p, newest: e === nw, i: e.i, x: g.x, y: g.y, s: g.s, el: e });
          for (const c of [T, K]) c.restore();
        });
      }
    },
    // where the presenter should point: the newest live element (blends 0.25 s when the focus moves on, so the arm glides),
    // unless a focus override is active (focusOn / opts.focus)
    focus(t) {
      let f = null;
      const n = newestAt(t);
      if (n) {
        const prev = L.filter(e => e !== n && e.t < n.t && live(e, n.t - 0.01)).sort((a, b) => b.t - a.t)[0];
        const p = fpt(n, t), k = n.carry ? 1 : E.inOutCubic(clamp((t - n.t + 0.02) / 0.25));
        if (!prev || k >= 1) f = p; else { const q = fpt(prev, t); f = [lerp(q[0], p[0], k), lerp(q[1], p[1], k)]; }
      }
      for (const fo of FO.slice().sort((a, b) => a.t0 - b.t0)) {
        const w = E.inOutCubic(clamp((t - fo.t0) / 0.25)) * (1 - E.inOutCubic(clamp((t - fo.t1) / 0.25)));
        if (w <= 0) continue;
        const p = resolveFocus(fo.target, t);
        if (!p) { if (w > 0.5) f = null; continue; }
        f = f ? [lerp(f[0], p[0], w), lerp(f[1], p[1], w)] : p;
      }
      return f;
    },
    focusOn(target, t0, t1 = 1e9) { FO.push({ t0, t1, target }); return this; },
    overrides: FO,
    resolve: (target, t) => resolveFocus(target, t),
    newest: newestAt,
    at(id, t) { const e = L.find(x => x.id === id); return e ? geom(e, t) : null; },
  };
}
// pointing target that GLIDES from focus to focus: keys [[t, x, y], ...] (x / y may be functions of t) → [x, y] (null before the first key).
// guy: t => act(t, { focus: t => focusTrack(t, [[T_A, 300, 700], [T_B, 760, 640]]) })
function focusTrack(t, keys, glide = 0.25) {
  const v = (q, k) => typeof q[k] === 'function' ? q[k](t) : q[k];
  let i = -1; for (let k = 0; k < keys.length; k++) if (t >= keys[k][0] - 0.02) i = k;
  if (i < 0) return null;
  const p = [v(keys[i], 1), v(keys[i], 2)]; if (!i) return p;
  const u = E.inOutCubic(clamp((t - keys[i][0] + 0.02) / glide)), q = [v(keys[i - 1], 1), v(keys[i - 1], 2)];
  return [lerp(q[0], p[0], u), lerp(q[1], p[1], u)];
}
// camera that leans toward the newest element on every entrance (spring), with a slow push. Returns to identity from `release`.
// o: { k = 0.1 lean, z = 0.035 zoom-in, push = 0.006 slow push per second, release (back to identity from here, 0.3 s),
//      t0 = the scene's start (default: the start of the scene being drawn; the zoom eases in over 0.6 s and the push counts from t0) }
function stageCam(t, st, o = {}) {
  const { k = 0.1, z = 0.035, push = 0.006, release = 1e9 } = o;
  const t0 = o.t0 ?? (typeof sceneAt === 'function' && SCENES.length ? sceneAt(t).start : 0);
  const keys = [[-1e9, 0, 0]];
  for (const e of st.els) if (isFinite(e.t) && !e.carry) keys.push([e.t, (540 - e.x) * k, (900 - e.y) * k * 0.6]);
  for (const fo of st.overrides || []) {                                // focus overrides: lean to the target, then back to the newest
    const p = st.resolve(fo.target, fo.t0); if (p) keys.push([fo.t0, (540 - p[0]) * k, (900 - p[1]) * k * 0.6]);
    const n = fo.t1 < 1e8 && st.newest(fo.t1); if (n) keys.push([fo.t1, (540 - n.x) * k, (900 - n.y) * k * 0.6]);
  }
  keys.sort((a, b) => a[0] - b[0]);
  const rel = 1 - E.inOutCubic(clamp((t - release) / 0.3));
  const cx = springTo(t, keys.map(q => [q[0], q[1]]), 1.3, 0.6), cy = springTo(t, keys.map(q => [q[0], q[2]]), 1.3, 0.6);
  return { x: cx * rel, y: cy * rel, z: 1 + (z * clamp((t - t0) / 0.6) + push * Math.max(0, t - t0)) * rel };
}

// ═════════════ 3 · presenter as the hero ═════════════
// REC CAMERA FRAME: viewfinder brackets close in on a target (usually the presenter's face) with a spring, REC pill blinks with a
// running timer, an optional tag pill pops on its word, a red halftone "hot seat" glow sits behind the target, and an optional
// face-detect reticle hunts around. Draw it in the scene's `front` (over the presenter); the glow goes on T so it stays behind him.
// o: { t0, t1 (release: brackets fly open), cx, cy, hw = 340, hh = 440 (numbers or t => number), from = 1.8, tag, tagT, glow = 1, hunt: [t0, t1] }
function recFrame(T, K, t, o = {}) {
  const { t0 = 0, t1 = 1e9, from = 1.8, tag = null, tagT = null, glow: gl = 1, hunt = null, rec = 'REC' } = o;
  const F_ = v => typeof v === 'function' ? v(t) : v;
  const cx = F_(o.cx ?? 540), cy = F_(o.cy ?? 1300), hw0 = F_(o.hw ?? 340), hh0 = F_(o.hh ?? 440);
  if (t < t0 || t > t1 + 0.35) return;
  const a = pop(t - t0, 2.4, 0.55), out = E.inCubic(P(t, t1, 0.3)), k = lerp(from, 1, clamp(a, 0, 1.08)) + out * 0.6;
  const hw = hw0 * k, hh = hh0 * k, al = clamp((t - t0) / 0.08) * (1 - out);
  if (gl) glow(T, cx, cy + hh0 * 0.25, hw0 * 1.5, hh0 * 1.2, 0.55 * gl * al * clamp(a));
  _mA([K], al, () => {
    K.save(); K.strokeStyle = C.ink; K.lineWidth = 8; K.lineCap = 'round'; K.lineJoin = 'round';
    const Lb = Math.min(hw, hh) * 0.26, r0 = 30;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const px = cx + sx * hw, py = cy + sy * hh;
      K.beginPath(); K.moveTo(px, py - sy * Lb); K.lineTo(px, py - sy * r0); K.quadraticCurveTo(px, py, px - sx * r0, py); K.lineTo(px - sx * Lb, py); K.stroke();
    }
    K.restore();
    const rp = pop(t - t0 - 0.12, 3, 0.45);
    if (rp > 0) X([K], cx - hw + 110, cy - hh - 56, rp, 0, () => {
      fillRR(K, -110, -27, 220, 54, 27, C.ink);
      circle(K, -80, 0, 10, Math.floor(t * 3) % 2 === 0 ? C.red : '#5a2a22');
      const secs = Math.max(0, Math.floor((t - t0) * 1.6));
      text(K, `${rec} 00:${String(secs % 60).padStart(2, '0')}`, 90, 8, _mono(23, { weight: 700, color: C.paper, align: 'right' }));
    });
    if (tag) { const tp = pop(t - (tagT ?? t0 + 0.3), 3.2, 0.4); if (tp > 0) X([K], cx + hw - 130, cy - hh - 56, tp, 3, () => {
      const f = _mono(23, { weight: 700, color: C.red, align: 'center' }), tw = measure(K, tag, f) + 60;
      fillRR(K, -tw / 2, -27, tw, 54, 27, '#FFFFFF'); strokeRR(K, -tw / 2, -27, tw, 54, 27, C.red, 3);
      circle(K, -tw / 2 + 26, 0, 7, C.red); text(K, tag, 12, 8, f);
    }); }
    if (hunt) {
      const hp = win(t, hunt[0], hunt[1], 0.12, 0.15);
      if (hp > 0) {
        const jx = noise1(t * 3.1 + 4) * hw0 * 0.22, jy = noise1(t * 2.7 + 9) * hh0 * 0.12, sz = hw0 * 0.32 + noise1(t * 4 + 2) * 14, l = 26;
        K.save(); K.globalAlpha *= hp * (Math.floor(t * 8) % 5 === 0 ? 0.4 : 1); K.strokeStyle = C.red; K.lineWidth = 5; K.lineCap = 'round';
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { K.beginPath(); K.moveTo(cx + jx + sx * sz, cy + jy + sy * (sz - l)); K.lineTo(cx + jx + sx * sz, cy + jy + sy * sz); K.lineTo(cx + jx + sx * (sz - l), cy + jy + sy * sz); K.stroke(); }
        K.restore();
      }
    }
  });
}
// presenter position that steps into the HERO spot (centre, big) between t0 and t1, docked otherwise. Use as act({ at: t => heroAt(t, a, b) })
function heroAt(t, t0, t1, o = {}) {
  const { x = 540, y = 1990, s = 1.1, dur = 0.45 } = o, D = PRESENTER_DOCK;
  const m = E.inOutCubic(clamp((t - t0) / dur)) * (1 - E.inOutCubic(clamp((t - t1) / dur)));
  return { x: lerp(D.x, x, m), y: lerp(D.y, y, m), s: lerp(D.s, s, m) };
}
// the presenter's face box for a position g ({x, y, s}): use it to aim recFrame at him
function faceBox(g) { return { cx: g.x, cy: g.y - 560 * g.s, hw: 300 * g.s, hh: 380 * g.s }; }

// ═════════════ 4 · presenter acting presets ═════════════
/* mood(t, list, opts) → options for act(): list = [[name, t0, t1, {focusSide...}], ...]. Names:
     'panic'     hand over the mouth, sweat drop, worried brows, shrinks + shivers, looks away       (+ red glow behind him: moodFx)
     'shock'     both hands to the face, O mouth, brows up, jerks back                                  (+ ink burst lines around the head)
     'thinking'  hand to the chin, one brow up, looks up and away, head tilt                           (+ "…" thought bubble;
                 extra { bubble: [x, y] | t => [x, y] } puts the bubble's centre there (scene space), default up-left of the head)
     'shh'       index finger to the lips, lips pressed shut, brows up, small lean in (the mouth stays closed while it lasts)
     'celebrate' both fists up, big smile, bounces                                                     (+ confetti)
     'lean'      point-and-lean: steps toward the focus, bigger, eyebrows up (use on the key reveal)
     'shrug' 'facepalm' 'wave' 'thumbs' (thumb + wink) 'no' (head shake) 'nod'
     'hero'      steps to the centre, big (pair with recFrame)                                          t0/t1 = in/out
   guy: t => act(t, mood(t, MOODS, { focus: t => ST.focus(t) })),   draw/front: moodFx(T, K, t, MOODS, { focus... same opts })   */
function mood(t, list, opts = {}) {
  const o = Object.assign({}, opts), beats = (opts.beats || []).slice(), faces = (opts.faces || []).slice();
  const baseAt = opts.at;
  let dx = 0, dy = 0, ds = 1, hero = null;
  for (const [name, t0, t1, ex = {}] of list) {
    const w = win(t, t0, t1, 0.12, 0.25); if (w <= 0 && name !== 'hero') continue;
    switch (name) {
      case 'panic': beats.push([t0, t1, ex.side || 'R', 'cover']); faces.push([t0, t1, { browTilt: 1, brow: 0.35, smile: -0.55, sweat: 0.95, lookX: 0.45, headTilt: -7 }]); dy += 34 * w; dx += Math.sin(t * 44) * 4 * w; break;
      case 'shock': beats.push([t0, t1, 'LR', 'cover']); faces.push([t0, t1, { shock: 1, brow: 1, mouth: 0.8 }]); dy += -26 * pendulum(t - t0, 1, 2.2, 5) * w + 10 * w; ds *= 1 + 0.03 * w; break;
      case 'thinking': beats.push([t0, t1, ex.side || 'R', 'cover', { armRp: 0.8 }]); faces.push([t0, t1, { browTilt: 0.8, smile: 0.1, lookX: 0.4, lookY: -0.7, headTilt: 7 }]); break;
      case 'shh': beats.push([t0, t1, ex.side || 'R', 'shh']); faces.push([t0, t1, { press: 1, brow: 0.45, browTilt: 0.25, smile: 0.25, lookX: -0.15, headTilt: -3 }]); dy += -10 * w; ds *= 1 + 0.03 * w; break;
      case 'celebrate': beats.push([t0, t1, 'LR', 'fist']); faces.push([t0, t1, { smile: 1, brow: 0.75 }]); dy += -Math.abs(Math.sin((t - t0) * 9)) * 26 * w; break;
      case 'lean': { faces.push([t0, t1, { brow: 0.6, smile: 0.55, lean: -5 }]); dx += -70 * w; dy += -24 * w; ds *= 1 + 0.08 * w; break; }
      case 'shrug': beats.push([t0, t1, 'LR', 'shrug']); faces.push([t0, t1, { browTilt: 0.6, brow: 0.4, smile: -0.2, headTilt: 6 }]); break;
      case 'facepalm': beats.push([t0, t1, ex.side || 'R', 'facepalm']); faces.push([t0, t1, { smile: -0.45, brow: -0.3, headTilt: -6, sweat: 0.4 }]); break;
      case 'wave': beats.push([t0, t1, ex.side || 'R', 'wave', { wave: t * 9 }]); faces.push([t0, t1, { smile: 0.9, brow: 0.5 }]); break;
      case 'thumbs': beats.push([t0, t1, ex.side || 'R', 'thumb']); faces.push([t0, t1, { smile: 0.95, wink: 1 }]); break;
      case 'no': faces.push([t0, t1, { headTurn: 0.3 * Math.sin((t - t0) * 18), browTilt: 0.4, smile: -0.2 }]); break;
      case 'nod': faces.push([t0, t1, { headNod: 0.5 * Math.abs(Math.sin((t - t0) * 9)), smile: 0.4 }]); break;
      case 'hero': hero = [t0, t1, ex]; break;
    }
  }
  const at0 = hero ? heroAt(t, hero[0], hero[1], hero[2]) : (typeof baseAt === 'function' ? baseAt(t) : baseAt || PRESENTER_DOCK);
  o.at = { x: at0.x + dx, y: at0.y + dy, s: at0.s * ds };
  o.beats = beats; o.faces = faces;
  return o;
}
// the effects that go with the moods (call in draw or front; glows are on T so they sit behind the presenter)
function moodFx(T, K, t, list, opts = {}) {
  const g = mood(t, list, opts).at, [hx, hy] = [g.x, g.y - 575 * g.s];
  for (const [name, t0, t1, ex = {}] of list) {
    const w = win(t, t0, t1, 0.12, 0.25);
    if (name === 'panic' && w > 0) glow(T, g.x, g.y - 430 * g.s, 520 * g.s, 560 * g.s, 0.62 * w);
    if (name === 'shock') {
      const d = t - t0;
      burst(K, hx, hy - 40 * g.s, d, { n: 14, r0: 300 * g.s, r1: 470 * g.s, color: C.ink, lw: 9, dur: 0.42 });
      if (w > 0) glow(T, hx, hy, 420 * g.s, 420 * g.s, 0.35 * w, '0,0,0');
    }
    if (name === 'celebrate') { confetti(K, hx, hy - 260 * g.s, t - t0, { n: 30, spread: 640, seed: 9, dur: 1.2 }); if (w > 0) glow(T, hx, hy, 460 * g.s, 460 * g.s, 0.4 * w); }
    if (name === 'thinking' && w > 0) {
      const bo = ex.bubble ?? opts.bubble, bp = typeof bo === 'function' ? bo(t) : bo;   // optional bubble centre (scene space)
      const bx = bp ? bp[0] : hx - 330 * g.s, by = bp ? bp[1] : hy - 260 * g.s;
      // the two trail dots: default spots up-left of the head; with a custom bubble they step from the head toward it
      let d1 = [hx - 150 * g.s, hy - 200 * g.s], d2 = [hx - 210 * g.s, hy - 240 * g.s];
      if (bp) { const vx = bx - hx, vy = by - hy, l = Math.hypot(vx, vy) || 1, r0 = Math.min((200 + 150 * Math.max(0, -vy / l)) * g.s, l * 0.6), r1 = Math.max(r0 + 30 * g.s, l - 120 * g.s);
        d1 = [hx + vx / l * r0, hy + vy / l * r0]; d2 = [hx + vx / l * lerp(r0, r1, 0.55), hy + vy / l * lerp(r0, r1, 0.55)]; }
      _mA([T, K], w, () => {
        circle(K, d1[0], d1[1], 12 * g.s, '#FFFFFF', C.ink, 4); circle(K, d2[0], d2[1], 20 * g.s, '#FFFFFF', C.ink, 4);
        T.save(); T.shadowColor = 'rgba(0,0,0,0.3)'; T.shadowBlur = 20; T.shadowOffsetY = 12; fillRR(T, bx - 110 * g.s, by - 60 * g.s, 220 * g.s, 110 * g.s, 55 * g.s, '#FFFFFF'); T.restore();
        fillRR(K, bx - 110 * g.s, by - 60 * g.s, 220 * g.s, 110 * g.s, 55 * g.s, '#FFFFFF'); strokeRR(K, bx - 110 * g.s, by - 60 * g.s, 220 * g.s, 110 * g.s, 55 * g.s, C.ink, 4);
        typingDots(K, bx - 42 * g.s, by + 6 * g.s, t, C.ink, 12 * g.s);
      });
    }
  }
}

// ═════════════ 5 · live UI mocks ═════════════
// ── PROMPT BOX (chat composer): typed prompt with caret → send button turns accent → press + shock on tSend → the prompt rides up into
// a sent bubble, the field collapses to a reply bar, the answer streams with a pulsing dot.
// o: { title = 'Assistant', label = 'new chat', text, tType, cps = 38, tSend, reply, replyCps = 70, blur = 0 (px; unreadable prompt),
//      size = 34, placeholder = 'Message…' } (x, y = top-left) → { send: [x, y], field: {x, y, w, h} }
function promptBox(T, K, x, y, w, h, t, o = {}) {
  const { title = 'Assistant', label = 'new chat', text: str = '', tType = 0, cps = 38, tSend = null, reply = '', replyCps = 70, blur = 0, size = 34, placeholder = 'Message…' } = o;
  const PF = { font: F.grot, weight: 500, size };
  const sent = tSend != null ? E.inOutCubic(P(t, tSend + 0.05, 0.36)) : 0;
  const n = Math.max(0, Math.floor((t - tType) * cps)), lines = wrapText(str, PF, w - 120), total = str.length;
  uiCard(T, K, x, y, w, h, { r: 34 });
  text(K, title, x + 42, y + 64, { font: F.grot, weight: 700, size: 38, color: C.ink, align: 'left', ls: -1 });
  uiLabel(K, label, x + w - 42, y + 60, { align: 'right' });
  line(K, x, y + 100, x + w, y + 100, HAIR, 3, 'butt');
  const F0 = [x + 30, y + 126, w - 60, h - 156], F1 = [x + 30, y + h - 96, w - 60, 66];
  const fr = F0.map((v, i) => lerp(v, F1[i], sent));
  fillRR(K, fr[0], fr[1], fr[2], fr[3], 26, '#FFFFFF'); strokeRR(K, fr[0], fr[1], fr[2], fr[3], 26, n > 0 && sent < 0.5 ? C.ink : HAIR, 3);
  if (n === 0 && sent < 0.5) text(K, placeholder, fr[0] + 30, fr[1] + size + 26, Object.assign({}, PF, { color: '#b3b0a8', align: 'left' }));
  if (sent > 0.5) _mA([K], (sent - 0.5) * 2, () => text(K, 'Reply…', fr[0] + 30, fr[1] + 44, { font: F.grot, weight: 500, size: 26, color: '#b3b0a8', align: 'left' }));
  // send button
  const sbx = fr[0] + fr[2] - 50, sby = fr[1] + fr[3] - lerp(50, 33, sent), sr = lerp(30, 22, sent);
  const press = tSend != null ? win(t, tSend - 0.05, tSend + 0.05, 0.04, 0.12) : 0;
  X([K], sbx, sby, 1 - press * 0.22, 0, () => {
    circle(K, 0, 0, sr, n > 0 && sent < 0.5 ? C.red : '#D8D5CD');
    K.save(); K.strokeStyle = '#FFFFFF'; K.lineWidth = 5; K.lineCap = 'round'; K.lineJoin = 'round'; K.beginPath(); K.moveTo(0, sr * 0.42); K.lineTo(0, -sr * 0.42); K.moveTo(-sr * 0.36, -sr * 0.06); K.lineTo(0, -sr * 0.42); K.lineTo(sr * 0.36, -sr * 0.06); K.stroke(); K.restore();
  });
  if (tSend != null) { shock(K, sbx, sby, t - tSend, { r: 90, color: C.red, lw: 6, dur: 0.4 }); }
  // the prompt text (typed), riding into the sent bubble
  if (n > 0) {
    const bs = lerp(1, 0.72, sent), lead = size * 1.3;
    const bw = Math.min(w - 140, (lines.reduce((m, l) => Math.max(m, measure(K, l, PF)), 0) + 60) * 0.72), bh = lines.length * lead * 0.72 + 36;
    const bx = x + w - 40 - bw, by = y + 126;
    if (sent > 0) _mA([K], sent, () => fillRR(K, bx, by, bw, bh, 24, '#F2F0EA'));
    const ox = lerp(fr[0] + 30, bx + 22, sent), oy = lerp(F0[1] + size + 26, by + 18 + size * 0.72, sent);
    K.save(); rr(K, x + 10, y + 104, w - 20, h - 110, 26); K.clip(); K.translate(ox, oy); K.scale(bs, bs);
    if (blur) K.filter = `blur(${blur}px)`;
    let left = Math.min(n, total), cx = 0, cyy = 0;
    for (let i = 0; i < lines.length && left > 0; i++) { const s = lines[i].slice(0, left); left -= lines[i].length + 1; text(K, s, 0, i * lead, Object.assign({}, PF, { color: C.ink, align: 'left' })); cx = measure(K, s, PF); cyy = i * lead; }
    K.restore();
    if (sent < 0.05 && (n < total || Math.floor(t * 2.4) % 2 === 0)) fillRR(K, ox + cx + 4, oy + cyy - size * 0.82, 4, size * 1.02, 2, C.ink);
  }
  // the reply streams
  if (tSend != null && t > tSend + 0.34 && reply) {
    const r0 = tSend + 0.34, rn = Math.floor((t - r0) * replyCps), RF = { font: F.grot, weight: 500, size: 28 }, rl = wrapText(reply, RF, w - 100);
    const top = y + 126 + lines.length * size * 1.3 * 0.72 + 70;
    _mA([K], clamp((t - r0) / 0.15), () => { circle(K, x + 52, top - 8, 12, C.red); text(K, title, x + 74, top, { font: F.grot, weight: 700, size: 24, color: _MG, align: 'left' }); });
    let left = rn, ex = x + 42, ey = top + 46;
    for (let i = 0; i < rl.length && left > 0; i++) { const s = rl[i].slice(0, left); left -= rl[i].length + 1; text(K, s, x + 42, top + 46 + i * 40, Object.assign({}, RF, { color: C.ink, align: 'left' })); ex = x + 42 + measure(K, s, RF); ey = top + 46 + i * 40; }
    if (rn < reply.length) circle(K, ex + 16, ey - 9, 7 * (0.6 + 0.4 * Math.sin(t * 14)), C.red);
  }
  return { send: [sbx, sby], field: { x: fr[0], y: fr[1], w: fr[2], h: fr[3] } };
}

// ── VIDEO PLAYER with a live scrubber: the playhead moves in real time from t0, seeks [[t, toSec]] jump with an expo ease,
// markers [{ sec, label }] sit on the track (the playhead docks into them with a bump). content(K, x, y, w, h, sec) draws the frame.
// o: { t0 = 0, dur = 52, start = 0, seek = [], markers = [], content, title, paused: [[t0, t1]] } (x, y top-left) → { head: [x, y], sec }
function videoPlayer(T, K, x, y, w, h, t, o = {}) {
  const { t0 = 0, dur = 52, start = 0, seek = [], markers = [], content = null, title = null, paused = [] } = o;
  let sec = start + Math.max(0, t - t0);
  for (const [a, b] of paused) if (t > a) sec -= Math.min(t, b) - a;
  for (const [ts, to] of seek) if (t >= ts) { const before = sec - (t - ts), q = E.inOutExpo(clamp((t - ts) / 0.45)); sec = lerp(before + (t - ts), to + (t - ts), q); }
  sec = clamp(sec, 0, dur);
  const isPaused = paused.some(([a, b]) => t >= a && t < b);
  const barH = 92, vh = h - barH;
  uiCard(T, K, x, y, w, h, { r: 30 });
  K.save(); rr(K, x + 14, y + 14, w - 28, vh - 14, 20); K.clip();
  if (content) content(K, x + 14, y + 14, w - 28, vh - 14, sec);
  else {
    fillRR(K, x + 14, y + 14, w - 28, vh - 14, 20, '#15161A');
    const N = 24; for (let i = 0; i < N; i++) { const bh = (0.25 + 0.75 * Math.abs(noise1(sec * 3 + i * 0.7))) * (vh - 120) * 0.6; fillRR(K, x + 50 + i * (w - 100) / N, y + vh / 2 - bh / 2, (w - 100) / N - 8, bh, 4, i % 5 === 2 ? C.red : '#3A3C42'); }
  }
  if (title) text(K, title, x + 44, y + 64, { font: F.grot, weight: 700, size: 30, color: '#FFFFFF', align: 'left' });
  if (isPaused) { circle(K, x + w / 2, y + vh / 2, 60, 'rgba(255,255,255,0.9)'); K.beginPath(); K.moveTo(x + w / 2 - 16, y + vh / 2 - 26); K.lineTo(x + w / 2 - 16, y + vh / 2 + 26); K.lineTo(x + w / 2 + 28, y + vh / 2); K.closePath(); K.fillStyle = C.ink; K.fill(); }
  K.restore();
  // control bar
  const by = y + vh + barH / 2;
  if (isPaused) { K.beginPath(); K.moveTo(x + 42, by - 15); K.lineTo(x + 42, by + 15); K.lineTo(x + 68, by); K.closePath(); K.fillStyle = C.ink; K.fill(); }
  else { fillRR(K, x + 40, by - 15, 9, 30, 3, C.ink); fillRR(K, x + 56, by - 15, 9, 30, 3, C.ink); }
  const x0 = x + 100, x1 = x + w - 215, tw = x1 - x0, hp = sec / dur;
  line(K, x0, by, x1, by, '#E4E1D9', 10); line(K, x0, by, x0 + tw * hp, by, C.red, 10);
  for (const m of markers) {
    const mx = x0 + tw * m.sec / dur, arr = sec >= m.sec - 0.05, bump = arr ? 1 + ring(t - (m._t || 0), 3.5, 7) * 0 : 1;
    X([K], mx, by, arr ? 1.12 : 1, 0, () => { fillRR(K, -16, -16, 32, 32, 9, arr ? C.red : C.ink); });
    if (m.label) text(K, m.label, mx, by - 30, _mono(19, { weight: 700, color: arr ? C.red : C.ink, align: 'center' }));
  }
  circle(K, x0 + tw * hp, by, 17, '#FFFFFF', C.ink, 5);
  const ts = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  text(K, ts(sec) + ' / ' + ts(dur), x + w - 30, by + 9, _mono(23, { weight: 700, color: C.ink, align: 'right' }));
  return { head: [x0 + tw * hp, by], sec };
}

// ── ODOMETER number: every digit column rolls like a mechanical counter (carries roll the next column). v = current value (float).
// o: { size = 130, color, prefix = '', suffix = '', digits (fixed column count), sep = ',', align = 'left', weight = 700, vel (units/s → motion smear) } → width
function odometer(K, v, x, y, o = {}) {
  const { size = 130, color = C.ink, prefix = '', suffix = '', sep = ',', align = 'left', weight = 700 } = o;
  const f = { font: F.grot, weight, size, ls: 0 }, vv = Math.max(0, v);
  const nd = o.digits || Math.max(1, String(Math.floor(vv)).length);
  const dw = measure(_mctx(), '0', f) * 1.02, sw = measure(_mctx(), sep, f), pw = measure(_mctx(), prefix, f), suw = measure(_mctx(), suffix, f);
  const cols = []; for (let k = nd - 1; k >= 0; k--) { cols.push(k); if (k % 3 === 0 && k > 0 && sep) cols.push('sep' + k); }
  // hide leading zero columns (they roll in when needed)
  const posOf = k => { if (k === 0) return vv; const p = Math.pow(10, k), fl = Math.floor(vv / p); return fl + clamp(vv - fl * p - (p - 1), 0, 1); };
  const vis = k => clamp(posOf(k));
  let total = pw + suw; for (const c of cols) total += typeof c === 'number' ? dw * (c === 0 ? 1 : vis(c)) : sw * vis(+c.slice(3));
  let cx = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
  text(K, prefix, cx, y, Object.assign({ color, align: 'left' }, f)); cx += pw;
  const lh = size * 1.05;
  for (const c of cols) {
    if (typeof c !== 'number') { const a = vis(+c.slice(3)); if (a > 0.01) _mA([K], a, () => text(K, sep, cx, y, Object.assign({ color, align: 'left' }, f))); cx += sw * a; continue; }
    const a = c === 0 ? 1 : vis(c); if (a <= 0.01) continue;
    const pos = posOf(c), d = Math.floor(pos), fr = pos - d;
    K.save(); K.beginPath(); K.rect(cx - 4, y - size * 0.98, dw * a + 8, size * 1.2); K.clip();
    const rate = Math.abs(o.vel || 0) / Math.pow(10, c), smear = clamp((rate - 4) / 14);      // fast columns smear like a real counter
    const passes = smear > 0.05 ? [-0.22, 0, 0.22] : [0];
    for (const off of passes) _mA([K], a * (passes.length > 1 ? 0.45 : 1), () => {
      const yy = y + off * smear * lh;
      text(K, String(d % 10), cx + dw / 2, yy - fr * lh, Object.assign({ color, align: 'center' }, f));
      if (fr > 0.001) text(K, String((d + 1) % 10), cx + dw / 2, yy + (1 - fr) * lh, Object.assign({ color, align: 'center' }, f));
    });
    K.restore(); cx += dw * a;
  }
  text(K, suffix, cx, y, Object.assign({ color, align: 'left' }, f));
  return total;
}
// ── LIVE STAT CARD: label + LIVE pill (blinking), an odometer number that rolls between keys [[t, value]], a sparkline that keeps drawing
// (live jitter, newest point pulses), optional delta pill. o: { label, keys, prefix, suffix, size = 130, roll = 0.8, hot, delta, spark = true }
// (x, y top-left) → { num: [x, y] }
function liveStat(T, K, x, y, w, h, t, o = {}) {
  const { label = 'users', keys = [[0, 0]], prefix = '', suffix = '', size = 130, roll = 0.8, hot = null, delta = null, spark = true, live = true } = o;
  const val = tt => keys.reduce((a, k, i) => i ? a + (k[1] - keys[i - 1][1]) * E.outCubic(clamp((tt - k[0]) / roll)) : k[1], 0);
  const v = val(t), mx = Math.max(...keys.map(k => k[1]), 1);
  const isHot = typeof hot === 'function' ? hot(t) : hot ?? false;
  uiCard(T, K, x, y, w, h, { r: 28 });
  uiLabel(K, label, x + 32, y + 56);
  if (live) { fillRR(K, x + w - 132, y + 26, 104, 42, 21, '#FFFFFF'); strokeRR(K, x + w - 132, y + 26, 104, 42, 21, HAIR, 3); circle(K, x + w - 108, y + 47, 8, Math.floor(t * 2.4) % 2 ? C.red : '#F3B5AB'); text(K, 'LIVE', x + w - 44, y + 56, _mono(20, { weight: 700, color: C.ink, align: 'right' })); }
  const lastK = keys.filter(k => t >= k[0]).slice(-1)[0] || keys[0];
  const bump = 1 + ring(t - lastK[0] - roll * 0.6, 3.2, 7) * 0.08 * (t > lastK[0] + roll * 0.6 && lastK !== keys[0] ? 1 : 0);
  X([K], x + 32, y + 92 + size * 0.86, bump, 0, () => odometer(K, v, 0, 0, { size, prefix, suffix, digits: String(Math.floor(mx)).length, color: isHot ? C.red : C.ink, vel: (val(t + 0.02) - val(t - 0.02)) / 0.04 }));
  if (delta) { const dp = pop(t - delta[0], 3, 0.45); if (dp > 0) X([K], x + w - 90, y + 92 + size * 0.5, dp, -4, () => { const f = _mono(24, { weight: 700, color: '#FFFFFF', align: 'center' }), tw = measure(K, delta[1], f) + 30; fillRR(K, -tw / 2, -22, tw, 44, 22, C.red); text(K, delta[1], 0, 8, f); }); }
  if (spark) {
    const sx0 = x + 32, sx1 = x + w - 32, sy1 = y + h - 40, sy0 = y + 92 + size + 30, N = 40, span = 4;
    if (sy1 - sy0 > 30) {
      K.save(); K.setLineDash([4, 8]); line(K, sx0, sy0, sx1, sy0, '#E6E3DC', 2, 'butt'); K.restore(); line(K, sx0, sy1, sx1, sy1, HAIR, 2, 'butt');
      K.save(); K.beginPath();
      let lx = 0, ly = 0;
      for (let i = 0; i <= N; i++) { const tt = t - span + span * i / N, q = val(tt) / mx, jit = live ? noise1(tt * 2.3) * 0.06 + noise1(tt * 7) * 0.02 : 0; lx = lerp(sx0, sx1, i / N); ly = lerp(sy1 - 8, sy0, clamp(q * 0.85 + 0.07 + jit)); i ? K.lineTo(lx, ly) : K.moveTo(lx, ly); }
      K.strokeStyle = isHot ? C.red : C.ink; K.lineWidth = 5; K.lineJoin = 'round'; K.lineCap = 'round'; K.stroke(); K.restore();
      circle(K, lx, ly, 9, C.red); shock(K, lx, ly, (t % 1.1), { r: 40, color: C.red, lw: 4, dur: 0.7 });
    }
  }
  return { num: [x + 32 + 120, y + 92 + size * 0.5] };
}

// ── NOTIFICATION STACK: toasts push in from the side on their words, older ones slide down (spring), shrink and fade; the newest is accent.
// items [{ t, title, body, glyph: 'bell' | 'mail' | '!' | '✓', time = 'now' }]; o: { max = 4, h = 92, from = 1 (right) | -1 } (x, y = top-left of
// the newest slot) → { newest: [x, y] | null }
function toastStack(T, K, x, y, w, t, items, o = {}) {
  const { max = 4, h = 92, from = 1 } = o;
  const vis = items.filter(n => t >= n.t), nv = vis.length;
  vis.forEach((n, i) => {
    const k = nv - 1 - i; if (k > max) return;
    const a = pop(t - n.t, 2.8, 0.55);
    let slot = 0; for (let j = i + 1; j < nv; j++) slot += pop(t - vis[j].t, 2.4, 0.6);
    const yy = y + slot * (h + 12) * 0.86, s = 1 - slot * 0.045, fade = clamp(1 - (slot - (max - 1.2)) / 0.8);
    if (fade <= 0) return;
    _mA([T, K], fade * clamp(a * 3), () => X([T, K], x + w / 2 + (1 - clamp(a)) * 560 * from, yy + h / 2, s * lerp(0.9, 1, clamp(a)), (1 - clamp(a)) * 8 * from, () => {
      const x0 = -w / 2, y0 = -h / 2;
      uiCard(T, K, x0, y0, w, h, { r: 22, shadow: 0.75 });
      fillRR(K, x0 + 18, y0 + (h - 54) / 2, 54, 54, 14, k === 0 ? C.red : C.ink);
      const g = n.glyph || 'bell', gx = x0 + 45, gy = y0 + h / 2;
      if (g === 'bell') { K.save(); K.translate(gx, gy); K.rotate(k === 0 ? pendulum(t - n.t, 0.35, 3, 3) : 0); K.fillStyle = '#fff'; K.beginPath(); K.moveTo(-12, 8); K.quadraticCurveTo(-11, -13, 0, -13); K.quadraticCurveTo(11, -13, 12, 8); K.closePath(); K.fill(); circle(K, 0, 11, 4, '#fff'); K.restore(); }
      else if (g === 'mail') envelope(K, gx, gy, 30, 22, 3, '#FFFFFF', 'rgba(0,0,0,0)');
      else text(K, g, gx, gy + 11, { font: F.grot, weight: 700, size: 32, color: '#FFFFFF' });
      text(K, n.title || '', x0 + 88, y0 + h / 2 - 6, { font: F.grot, weight: 700, size: 26, color: C.ink, align: 'left' });
      text(K, n.time || 'now', x0 + w - 22, y0 + h / 2 - 6, _mono(19, { align: 'right' }));
      if (n.body) text(K, n.body, x0 + 88, y0 + h / 2 + 26, { font: F.grot, weight: 500, size: 23, color: '#55524C', align: 'left' });
    }));
  });
  return { newest: nv ? [x + w / 2, y + h / 2] : null };
}

// ═════════════ 6 · palette switch (a whole section in another colour) ═════════════
// Call in the scene's `back` (screen space): floods the frame with `col` from (x, y) on t0 (circle reveal), drains back at t1.
// Pair with `hl: t => ({ color: paletteOn(t, t0, t1) > 0.5 ? '#F6F5F1' : undefined })`. In a flooded section T (halftone) is hidden:
// draw shadows/glows on K (rgba) and use light ink for text.
function paletteOn(t, t0, t1 = 1e9) { return E.inOutCubic(clamp((t - t0) / 0.32)) * (1 - E.inOutCubic(clamp((t - t1) / 0.3))); }
function paletteFlood(T, K, t, t0, t1 = 1e9, o = {}) {
  const { col = '#15161A', x = 540, y = 1300 } = o, p = paletteOn(t, t0, t1);
  if (p <= 0) return;
  const r = Math.hypot(Math.max(x, W - x), Math.max(y, H - y)) * p;
  K.save(); K.beginPath(); K.arc(x, y, r, 0, TAU); K.fillStyle = col; K.fill(); K.restore();
}
