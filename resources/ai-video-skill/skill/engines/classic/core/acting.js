// ───────────────────────── acting: choreography helpers for the presenter ─────────────────────────
// A scene's guy(t) returns a presenter STATE: { x, y, s, armL, armR, armLp, armRp, pointAng, brow, smile, ... } (see the guide).
// act(t, {...}) builds a fully acted state in one call: points at the current hero, changes gesture + expression every phrase,
// jabs on emphasised words, eyes + head follow the target. Hand-written arms()/expr() lists still work for special beats.
let PRESENTER_DOCK = { x: 842, y: 1990, s: 0.8 };     // the home position (bottom-right bust): every scene starts and ends here

// smooth on/off window: 0 before t0, eases to 1 over rin, back to 0 after t1 over rout
const win = (t, t0, t1, rin = 0.22, rout = 0.25) => Math.min(E.inOutCubic(clamp((t - t0) / rin)), 1 - E.inOutCubic(clamp((t - t1) / rout)));
// arm beats: [[t0, t1, 'L'|'R'|'LR', pose, {extra state}]] → { armL, armR, armLp, armRp, ...extra }. Later entries win.
// poses: point (aim with pointAng, deg: 0 = out sideways, -90 = straight up, 90 = down) · wave (open palm up, st.wave = swing phase)
//        thumb · shrug · facepalm · cover (hand over mouth) · hold (palm up, presenting) · fist (raised) · down (rest)
function arms(t, list) {
  const o = { armL: 'down', armR: 'down', armLp: 0, armRp: 0 };
  for (const [t0, t1, side, name, extra] of list) {
    const p = win(t, t0, t1);
    if (p <= 0) continue;
    for (const s of side) { o['arm' + s] = name; o['arm' + s + 'p'] = p; }
    if (extra) Object.assign(o, extra);
  }
  return o;
}
// expression beats: [[t0, t1, {numeric props}]] blended in/out and summed (brow, smile, browTilt, lookX, lookY, headTilt, shock, sweat, wink…)
function expr(t, list) {
  const o = {};
  for (const [t0, t1, props] of list) {
    const p = win(t, t0, t1, 0.1, 0.3);
    if (p <= 0) continue;
    for (const k in props) o[k] = (o[k] || 0) + props[k] * p;
  }
  return o;
}
const enterY = (t, t0, dist = 900) => (1 - pop(t - t0, 2.0, 0.55)) * dist;          // springs up from below (add to y)
const exitY = (t, t0, d = 0.4, dist = 1600) => -E.inBack(clamp((t - t0) / d)) * dist; // flies up and out
const inAt = (t, t0, f = 2.6, z = 0.5) => pop(t - t0, f, z);                          // spring 0→1 from t0
// pulse 0→1→0 around each time in ts (for jabs, nods, bumps)
const pulses = (t, ts, dur = 0.32) => ts.reduce((a, x) => Math.max(a, t >= x ? Math.sin(Math.PI * clamp((t - x) / dur)) : 0), 0);

// presenter geometry (scene space): shoulder of arm side 'L'|'R' for a presenter at {x, y, s}, and the pointAng that aims it at (tx, ty)
const shoulderAt = (g, side) => [g.x + (side === 'L' ? -226 : 226) * g.s, g.y - 264 * g.s];
function aimAt(g, side, tx, ty) {
  const [sx, sy] = shoulderAt(g, side), dx = tx - sx, dy = ty - sy;
  return Math.atan2(dy, side === 'L' ? -dx : dx) / D2R;
}
const headAt = g => [g.x, g.y - 575 * g.s];

// per-phrase acting variety (deterministic): expression presets + free-arm gestures
const FACES = [
  { brow: 0.45, smile: 0.55 }, { browTilt: 0.5, smile: 0.35 }, { brow: 0.75, smile: 0.8 }, { brow: 0.15, smile: 0.25, headNod: 0.2 },
  { brow: 0.6, smile: 0.65 }, { brow: -0.25, smile: 0.1 }, { brow: 0.35, smile: 0.9 }, { browTilt: 0.35, smile: 0.5 },
];
const GESTURES = [null, 'hold', null, 'fist', null, null, 'hold', null];
// per-phrase pointing pose (deterministic): mostly a point, sometimes an open-palm present or a two-hand frame (long phrases only).
// The arm cross-fades between poses at phrase changes (armXFrom / armXMix), so the hand never drops.
const POINT_POSES = ['point', 'point', 'present', 'point', 'frame', 'point', 'present', 'point'];
// `frameOk` false (the free hand would have to reach across / over the head to the target, e.g. the docked presenter aiming up-left)
// turns 'frame' into 'present': two hands raised beside the head read as a salute or "hands up", not as framing.
const _poseOf = (p, frameOk = true) => { if (!p) return 'point'; const n = POINT_POSES[(p.n * 3 + 1) % POINT_POSES.length]; return n === 'frame' && (p.end - p.s < 0.9 || !frameOk) ? 'present' : n; };

/* act(t, o) → presenter state.
   o.at      {x,y,s} or t => {x,y,s}           where the bust stands (default PRESENTER_DOCK)
   o.focus   t => [x, y] | null                 the hero the presenter points at (scene space). The default acting: ALWAYS point.
             or [[t0, t1, x, y], ...]            pointing segments (eased in/out), x/y may be functions of t
   o.side    'L' | 'R' | 'auto'                 pointing arm (auto: the arm on the target's side; L = screen-left arm)
   o.beats   [[t0, t1, side, pose, extra]]      extra arm beats (override the auto pointing / gestures while active)
   o.faces   [[t0, t1, {brow, smile, ...}]]     extra expression beats (added on top)
   o.gestures false                              no automatic free-arm gestures
   o.poses   false                               always the plain point (no automatic present / two-hand frame variety)
   o.pose    'point' | 'present' | 'frame'       force one pointing pose for the whole call (instead of the per-phrase cycle)
   o.lean    false                               no automatic body lean / step / turn toward the target
   o.jab     true                                finger jabs + brow pops on emphasised caption words
   o.extra   {...}                               merged last (e.g. { shock: 0.4 })                                          */
function act(t, o = {}) {
  const g = typeof o.at === 'function' ? o.at(t) : (o.at || PRESENTER_DOCK);
  const st = { x: g.x, y: g.y, s: g.s };
  const ph = phraseAt(t), pi = ph ? ph.n : 0;
  // current target
  let target = null, tw = 0;
  if (typeof o.focus === 'function') { const f = o.focus(t); if (f) { target = f; tw = 1; } }
  else if (Array.isArray(o.focus)) for (const [t0, t1, x, y] of o.focus) {
    const w = win(t, t0, t1, 0.24, 0.24); if (w <= 0) continue;
    target = [typeof x === 'function' ? x(t) : x, typeof y === 'function' ? y(t) : y]; tw = w;
  }
  const list = [];
  let side = 'L', pose = 'point', prevPose = 'point', steep = 0;
  const free = s => s === 'L' ? 'R' : 'L';
  if (target) {
    side = o.side && o.side !== 'auto' ? o.side : (target[0] > g.x + 150 * g.s ? 'R' : 'L');
    const fA = aimAt(g, free(side), target[0], target[1]), frameOk = fA > -70 && fA < 60;   // the free hand can frame it without crossing over the head
    if (o.pose && tw >= 1) pose = prevPose = (o.pose === 'frame' && !frameOk ? 'present' : o.pose);
    else if (o.poses !== false && tw >= 1) { pose = _poseOf(ph, frameOk); prevPose = _poseOf(ph && PHRASE_LIST.find(p => p.n === ph.n - 1), frameOk); }
    const jab = o.jab === false || pose !== 'point' ? 0 : pulses(t, EMPH_TIMES, 0.3);
    let ang = aimAt(g, side, target[0], target[1]) - 7 * jab;
    // target (nearly) right above the bust: reach OUT and up beside the head (never fold the arm over it); the body lean below
    // tips the whole arm toward the target, so it still reads as aimed
    if (ang < -78 && ang > -200) { steep = clamp((-78 - ang) / 30); ang = -78 + (ang + 78) * 0.12; }
    const ex = { pointAng: ang, ['pointAng' + side]: ang };
    if (pose === 'frame') {                                           // the other hand frames the target too
      const fs = free(side); let a2 = aimAt(g, fs, target[0], target[1]);
      if (a2 < -78 && a2 > -200) a2 = -78 + (a2 + 78) * 0.12;
      ex['pointAng' + fs] = a2;
    }
    list.push([-1e9, 1e9, side, pose, ex]);
    if (pose === 'frame' && (ph || o.pose)) list.push(o.pose ? [-1e9, 1e9, free(side), 'frame'] : [ph.s + 0.02, ph.end - 0.08, free(side), 'frame']);
    if (tw < 1) { list[0][4][`arm${side}p`] = tw; }
  }
  // free-arm gesture for this phrase (not while both hands frame the target)
  if (o.gestures !== false && ph && pose !== 'frame') {
    const gname = GESTURES[(pi * 5 + 3) % GESTURES.length];
    if (gname && ph.end - ph.s > 0.7) list.push([ph.s + 0.05, ph.end - 0.12, free(side), gname]);
  }
  if (o.beats) list.push(...o.beats);
  const a = arms(t, list);
  if (target && tw < 1 && a['arm' + side] === 'point') a['arm' + side + 'p'] = Math.min(a['arm' + side + 'p'], tw);
  // pose change at a phrase boundary: cross-fade from the previous phrase's pose (the arm stays up)
  if (target && ph && prevPose !== pose && a['arm' + side] === pose && a['arm' + side + 'p'] >= 0.999) {
    a['arm' + side + 'From'] = prevPose; a['arm' + side + 'Mix'] = E.inOutCubic(clamp((t - ph.s + 0.06) / 0.3));
  }
  Object.assign(st, a);
  // expression: preset per phrase (blended across phrase changes) + brow pop on emphasised words
  const faces = [];
  for (const p of PHRASE_LIST) if (t > p.s - 0.4 && t < p.end + 0.5) faces.push([p.s - 0.08, p.end, FACES[(p.n * 3 + 1) % FACES.length]]);
  if (o.jab !== false) for (const et of EMPH_TIMES) if (Math.abs(t - et) < 0.6) faces.push([et - 0.04, et + 0.18, { brow: 0.3 }]);
  if (o.faces) faces.push(...o.faces);
  Object.assign(st, expr(t, faces));
  // eyes + head follow the target, small per-phrase head tilt
  const [hx, hy] = headAt(g);
  const lx = target ? clamp((target[0] - hx) / 520, -1, 1) * 0.75 * tw : 0, ly = target ? clamp((target[1] - hy) / 520, -1, 1) * 0.7 * tw : 0;
  st.lookX = (st.lookX || 0) + lx; st.lookY = (st.lookY || 0) + ly;
  st.headTurn = (st.headTurn || 0) + lx * 0.3;
  // the body follows the point: lean + turn toward the target, a small step toward it; a target above the head tips the head back
  if (target && o.lean !== false) {
    const k = clamp((target[0] - g.x) / 480, -1, 1) * tw, up = clamp((hy - target[1]) / 700) * tw;
    st.lean = (st.lean || 0) + k * (4 + 4 * steep);
    st.bodyTurn = (st.bodyTurn || 0) + k * 0.28;
    st.x += k * 26 * g.s; st.y -= up * 14 * g.s;
    st.headNod = (st.headNod || 0) - up * 0.3;
  }
  const tilts = [3, -2.5, 4, -3.5, 1.5, -1];
  st.headTilt = (st.headTilt || 0) + PHRASE_LIST.reduce((acc, p) => acc + tilts[p.n % tilts.length] * win(t, p.s - 0.05, p.end, 0.25, 0.3), 0);
  if (o.extra) Object.assign(st, o.extra);
  st.t = t;   // so PRESENTER.anchors(st) can normalise this raw state itself
  return st;
}
