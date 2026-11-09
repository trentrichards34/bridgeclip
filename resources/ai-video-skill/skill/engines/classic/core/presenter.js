// ───────────────────────── the presenter: flat-vector 2D puppet (Canvas 2D paths) ─────────────────────────
// K layer: crisp flat fills in a limited palette (ink, paper, accent + the look's skin / top / hair colours), one shading plane per shape.
// T layer: a subtle offset halftone drop shadow of the whole silhouette.
// Rig:  root (x, y+bob, rot, s·sx, s·sy) → torso (lean, bodyTurn) → neck pivot → head (tilt, nod, turn = feature slide + squash)
//       arms: two-bone IK shoulder → elbow → wrist, one continuous bezier sleeve outline, rolled cuff, bare forearm, 6 hand poses
// Space: "bust space" at s = 1, origin = bottom-centre (flat crop line), y down (canvas), bust ≈ 830 px tall, ≈ 700 px wide.
// Look: st.look (or window.PRESENTER_LOOK, set from reel.json "presenter") → see LOOK_DEFAULT below and guides/styles/classic.md.
// Exposes window.PRESENTER = { draw(T, K, st), anchors(st), rig(st), look(o), DEFAULT } (window.GUY3D is an alias). Deterministic.
(() => {
  'use strict';
  const D2R = Math.PI / 180, TAU = Math.PI * 2, PI = Math.PI;
  const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const mx = (a, b, t) => a + (b - a) * t;
  const ss = t => { t = cl(t); return t * t * (3 - 2 * t); };
  const wrapPi = a => { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; };
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
  const len = a => Math.hypot(a[0], a[1]), nrm = a => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
  const perp = a => [-a[1], a[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1], vl = (a, b, t) => [mx(a[0], b[0], t), mx(a[1], b[1], t)];
  const dir = a => [Math.cos(a), Math.sin(a)], ang = a => Math.atan2(a[1], a[0]), cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const hex = c => { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const mix = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(mx(v, hex(b)[i], t)).toString(16).padStart(2, '0')).join('');
  const M0 = () => new DOMMatrix();

  // ── look: every appearance parameter (reel.json "presenter" overrides any of these) ──
  const SKINS = { porcelain: '#F4E1D2', fair: '#F1D9C4', light: '#EAD3BE', medium: '#DDB592', olive: '#C99B72', tan: '#B98259', brown: '#8E5B3C', deep: '#5F3B27' };
  const HAIRCOLS = { black: '#1C1A19', darkbrown: '#2E2723', brown: '#5A4030', chestnut: '#7A4A2A', auburn: '#8C3B22', red: '#B5532A', blonde: '#C9A266', platinum: '#DCD3C2', grey: '#8F8A84', white: '#E9E6E0' };
  const LOOK_DEFAULT = {
    skin: 'medium',            // preset name (porcelain fair light medium olive tan brown deep) or '#hex'
    hair: 'swept',             // short: swept crop fringe curtain messy wavy curly buzz bald · long: long wavylong longcurly · tied: ponytail bun
    hairColor: 'darkbrown',    // preset name (black darkbrown brown chestnut auburn red blonde platinum grey white) or '#hex'
    beard: 'none',             // none | stubble | full
    beardColor: null,          // null = hairColor
    beanie: false, beanieColor: '#111111', beanieTab: true,   // knit beanie; the tab uses the accent colour
    glasses: false, glassesStyle: 'round', glassesColor: '#111111',   // round | square
    glassesW: 7,               // frame stroke width in head px (4-5 = thin wire frames, 7 = default, 9-10 = chunky)
    lashes: false,             // three small lashes on each upper lid's outer corner
    top: 'tee',                // tee | overshirt (open shirt over a tee) | hoodie | collar (buttoned shirt)
    topColor: '#4A5260', innerColor: '#F6F5F1',               // innerColor = the tee under an overshirt
    accessories: [],           // any of: 'earrings', 'necklace', 'headphones', 'mic'
    face: 'adult',             // adult | young (slightly softer, smaller features)
    slim: false,               // narrower face
  };
  const pick = (v, table, d) => !v ? d : table[v] || (/^#[0-9a-f]{6}$/i.test(v) ? v : d);
  function normLook(o) {
    const L = Object.assign({}, LOOK_DEFAULT, o || {});
    L.skinHex = pick(L.skin, SKINS, SKINS.medium);
    L.hairHex = pick(L.hairColor, HAIRCOLS, HAIRCOLS.darkbrown);
    L.beardHex = pick(L.beardColor, HAIRCOLS, L.hairHex);
    L.topHex = pick(L.topColor, {}, '#4A5260'); L.innerHex = pick(L.innerColor, {}, '#F6F5F1');
    L.beanieHex = pick(L.beanieColor, {}, '#111111'); L.glassesHex = pick(L.glassesColor, {}, '#111111');
    L.young = L.face === 'young'; L.acc = new Set(L.accessories || []);
    if (L.beard === true) L.beard = 'full'; if (!L.beard) L.beard = 'none';
    return L;
  }
  // ── palette: ink, paper, accent + the look's skin / top / hair; shades are ink-mixed tints of those (set per draw by applyLook)
  const INK = '#111111', PAPER = '#F6F5F1';
  let RED = '#FF3B1F', SKIN, SHIRT, HAIR, C, LOOK, _lookKey = '';
  const CAST = 'rgba(17,17,17,0.2)';
  function applyLook(look) {
    const accent = window.ACCENT || '#FF3B1F';
    const key = JSON.stringify(look || null) + accent;
    if (key === _lookKey) return LOOK;
    _lookKey = key; RED = accent;
    LOOK = normLook(look);
    SKIN = LOOK.skinHex; SHIRT = LOOK.topHex; HAIR = LOOK.hairHex;
    const TOPD = mix(SHIRT, INK, 0.25), TOPL = mix(SHIRT, PAPER, 0.3);
    C = {
      skinSh: mix(SKIN, INK, 0.14), skinLine: mix(SKIN, INK, 0.42), lip: mix(mix(SKIN, RED, 0.2), INK, 0.12), lipSoft: mix(SKIN, RED, 0.16),
      shirtSh: TOPD, shirtLt: TOPL, hairSh: mix(LOOK.beardHex, INK, 0.5),
      tee: LOOK.innerHex, teeSh: mix(LOOK.innerHex, INK, 0.1), teeLine: mix(LOOK.innerHex, INK, 0.24),
      cuff: mix(LOOK.beanieHex, PAPER, 0.14), crownLt: mix(LOOK.beanieHex, PAPER, 0.07),
      tongue: mix(RED, INK, 0.22), fade: mix(LOOK.beardHex, SKIN, 0.62), stubble: mix(SKIN, LOOK.beardHex, 0.3),
    };
    return LOOK;
  }

  // ── proportions (bust space, s = 1)
  const NECK_Y = -360, HEAD_O = -215;         // head pivot (jaw/neck) and head origin (eye line) → head origin at y = -575
  const SH = [226, -264];                     // shoulder joint (screen-right arm frame; the left arm is mirrored)
  const L1 = 182, L2 = 168, HS = 1.24;        // upper arm, forearm, hand scale
  const RH = 170;                             // head radius used for the fake yaw (feature slide)

  // ── path helpers ─────────────────────────────────────────────────────────────
  // Catmull-Rom through points → cubic beziers. A third element truthy = sharp corner.
  function smooth(p, pts, closed = true, k = 1) {
    const n = pts.length, g = i => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      const k1 = p1[2] ? 0 : k / 6, k2 = p2[2] ? 0 : k / 6;
      p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * k1, p1[1] + (p2[1] - p0[1]) * k1, p2[0] - (p3[0] - p1[0]) * k2, p2[1] - (p3[1] - p1[1]) * k2, p2[0], p2[1]);
    }
    if (closed) p.closePath();
    return p;
  }
  const mirror = half => half.concat(half.slice().reverse().map(([x, y, c]) => [-x, y, c]));
  // tapered capsule a → b
  function capsule(p, a, b, ra, rb) {
    const u = nrm(sub(b, a)), n = perp(u), an = ang(u);
    p.moveTo(a[0] + n[0] * ra, a[1] + n[1] * ra);
    p.lineTo(b[0] + n[0] * rb, b[1] + n[1] * rb);
    p.arc(b[0], b[1], rb, an + PI / 2, an - PI / 2, true);
    p.lineTo(a[0] - n[0] * ra, a[1] - n[1] * ra);
    p.arc(a[0], a[1], ra, an - PI / 2, an - 1.5 * PI, true);
    p.closePath();
    return p;
  }
  // tapered stroke along a quadratic a →(c)→ b with round caps (brows)
  function taper(p, a, c, b, wa, wm, wb, n = 14) {
    const L = [], R = [], T = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], y = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1];
      const dx = 2 * u * (c[0] - a[0]) + 2 * t * (b[0] - c[0]), dy = 2 * u * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
      const l = Math.hypot(dx, dy) || 1, w = (t < 0.5 ? mx(wa, wm, t * 2) : mx(wm, wb, t * 2 - 1)) / 2;
      L.push([x - dy / l * w, y + dx / l * w]); R.push([x + dy / l * w, y - dx / l * w]); T.push(Math.atan2(dy, dx));
    }
    p.moveTo(L[0][0], L[0][1]);
    for (const q of L) p.lineTo(q[0], q[1]);
    p.arc(b[0], b[1], wb / 2, T[n] + PI / 2, T[n] - PI / 2, true);
    for (let i = n; i >= 0; i--) p.lineTo(R[i][0], R[i][1]);
    p.arc(a[0], a[1], wa / 2, T[0] - PI / 2, T[0] - 1.5 * PI, true);
    p.closePath();
    return p;
  }
  // flat fill + one shading plane: the part of the shape NOT covered by itself shifted toward the light (dx, dy)
  const BIG = (() => { const q = new Path2D(); q.rect(-9000, -9000, 18000, 18000); return q; })();
  function fillSh(ctx, path, base, shade, dx, dy) {
    ctx.fillStyle = base; ctx.fill(path);
    if (!shade) return;
    ctx.save(); ctx.clip(path);
    const q = new Path2D(BIG); q.addPath(path, new DOMMatrix([1, 0, 0, 1, dx, dy]));
    ctx.fillStyle = shade; ctx.fill(q, 'evenodd'); ctx.restore();
  }

  // ── continuous sleeve outline around shoulder A → elbow B → sleeve end C (round shoulder cap, round outer elbow, creased inner elbow)
  function bentTube(p, A, B, C, ra, rb, rc) {
    const u1 = nrm(sub(B, A)), u2 = nrm(sub(C, B)), n1 = perp(u1), n2 = perp(u2);
    const so = dot(n1, u2) >= 0 ? -1 : 1, si = -so;          // outer / inner side signs
    const P = (o, n, r, s) => [o[0] + n[0] * r * s, o[1] + n[1] * r * s];
    const oA = P(A, n1, ra, so), oB1 = P(B, n1, rb, so), oC = P(C, n2, rc, so);
    const iA = P(A, n1, ra, si), iB1 = P(B, n1, rb, si), iB2 = P(B, n2, rb, si), iC = P(C, n2, rc, si);
    // outer edge: slight muscle bulge, then an arc around the elbow
    const m1 = vl(oA, oB1, 0.5);
    p.moveTo(oA[0], oA[1]);
    p.quadraticCurveTo(m1[0] + n1[0] * so * 8, m1[1] + n1[1] * so * 8, oB1[0], oB1[1]);
    const a1 = Math.atan2(n1[1] * so, n1[0] * so), a2 = Math.atan2(n2[1] * so, n2[0] * so);
    p.arc(B[0], B[1], rb, a1, a2, wrapPi(a2 - a1) < 0);
    p.lineTo(oC[0], oC[1]); p.lineTo(iC[0], iC[1]);
    // inner edge: meet at the crease (intersection of the two inner edge lines) with a small fillet
    const cr = cross(u1, u2);
    if (Math.abs(cr) < 0.03) { p.lineTo(iB2[0], iB2[1]); p.lineTo(iB1[0], iB1[1]); }
    else {
      const t = cross(sub(iB2, iB1), u2) / cr, I = add(iB1, mul(u1, t));
      const d1 = dot(sub(I, iA), u1), d2 = dot(sub(iC, I), u2), k = 16;
      if (d1 > k + 4 && d2 > k + 4 && len(sub(I, B)) < rb * 2.2) {
        const P2 = add(I, mul(u2, k)), P1 = sub(I, mul(u1, k));
        p.lineTo(P2[0], P2[1]); p.quadraticCurveTo(I[0], I[1], P1[0], P1[1]);
      } else { p.lineTo(iB2[0], iB2[1]); p.lineTo(iB1[0], iB1[1]); }   // very sharp fold: cut through the joint (self-overlap still fills, nonzero)
    }
    const m2 = vl(iB1, iA, 0.5);
    p.lineTo(m2[0], m2[1]); p.lineTo(iA[0], iA[1]);
    const b1 = Math.atan2(n1[1] * si, n1[0] * si);
    p.arc(A[0], A[1], ra, b1, b1 + si * PI, si < 0);             // shoulder cap around the back of the joint
    p.closePath();
    return p;
  }

  // ── hands: local frame origin = wrist, +y = toward fingertips, +x = thumb side ──
  const HANDS = {   // ci: index curl, cm: other fingers curl, ta: thumb angle (deg from +y toward +x), te: thumb extension, sp: spread, tb: thumb base y
    rest: { ci: 0.35, cm: 0.45, ta: 18, te: 0.6, sp: 0.1, tb: 20, palm: 0 },
    point: { ci: 0, cm: 1, ta: -38, te: 0.5, sp: 0, tb: 24, palm: 0 },
    open: { ci: 0, cm: 0, ta: 58, te: 1, sp: 1, tb: 20, palm: 1 },
    flat: { ci: 0, cm: 0, ta: 20, te: 0.85, sp: 0.1, tb: 20, palm: 0 },
    fist: { ci: 1, cm: 1, ta: -58, te: 0.45, sp: 0, tb: 26, palm: 0 },
    thumb: { ci: 1, cm: 1, ta: 92, te: 1, sp: 0, tb: 38, palm: 0 },
  };
  const FINGERS = [[-23, 47, 9.5, -22], [-8, 59, 10.5, -8], [8, 63, 11, 2], [24, 57, 10.5, 11]];   // x, length, radius, spread (pinky → index)
  function palmPath() {
    const p = new Path2D();
    p.moveTo(-22, -6);
    p.bezierCurveTo(-30, 14, -37, 34, -35, 54);
    p.bezierCurveTo(-34, 66, -20, 70, 0, 70);
    p.bezierCurveTo(20, 70, 35, 66, 36, 52);
    p.bezierCurveTo(37, 36, 32, 14, 24, -6);
    p.closePath();
    return p;
  }
  const PALM = palmPath();
  function handGeo(H) {   // → { parts: [Path2D...] (draw order), folds, sil }
    const parts = [], folds = [];
    const curls = [H.cm, H.cm, H.cm, H.ci];
    FINGERS.forEach(([x, L, r, sd], i) => {
      const c = curls[i], a = sd * H.sp * D2R, base = [x * (1 + 0.12 * H.sp), 56];
      const Lv = L * (1 - 0.74 * c), tip = [base[0] + Math.sin(a) * Lv, base[1] + Math.cos(a) * Lv];
      parts.push(capsule(new Path2D(), base, tip, r, r * 0.9));
      if (c > 0.55) folds.push([tip[0] - r * 0.7, tip[1] - 2, tip[0] + r * 0.7, tip[1] - 2]);
    });
    parts.push(PALM);
    const ta = H.ta * D2R, tb = [27, H.tb], tl = 22 + H.te * 28;
    parts.push(capsule(new Path2D(), tb, [tb[0] + Math.sin(ta) * tl, tb[1] + Math.cos(ta) * tl], 13, 11));
    return { parts, folds };
  }
  function drawHand(ctx, H, sc) {
    const g = handGeo(H);
    ctx.lineJoin = 'round'; ctx.lineWidth = 2.6 / sc; ctx.strokeStyle = C.skinLine; ctx.fillStyle = SKIN;
    g.parts.forEach(p => { ctx.fill(p); ctx.stroke(p); });
    if (H.palm > 0.5) { ctx.beginPath(); ctx.moveTo(-22, 44); ctx.quadraticCurveTo(0, 52, 24, 30); ctx.stroke(); }
    ctx.beginPath(); for (const f of g.folds) { ctx.moveTo(f[0], f[1]); ctx.lineTo(f[2], f[3]); } ctx.stroke();
  }

  // ── IK ──
  function ik(S, W, pole) {
    const u = nrm(sub(W, S)); let d = len(sub(W, S));
    d = cl(d, Math.abs(L1 - L2) + 6, L1 + L2 - 1);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    let n = perp(u); if (dot(n, pole) < 0) n = mul(n, -1);
    return { E: [S[0] + u[0] * a + n[0] * h, S[1] + u[1] * a + n[1] * h], W: [S[0] + u[0] * d, S[1] + u[1] * d] };
  }
  // pose table in the screen-right arm frame (outward = +x, y down). W: wrist target, pole: elbow side, fa: finger direction (rad), th: desired thumb direction
  // side: 'L' | 'R' (pointAngL / pointAngR override pointAng per arm, for two-hand poses)
  function poseDef(name, st, hp, side) {
    const pa = (st['pointAng' + side] ?? st.pointAng ?? 0) * D2R;
    switch (name) {
      case 'point': {
        // steep (out-and-up) points bend the elbow OUT and pull the wrist in a little, so an up-point reads as a reach, not a stick
        const a = pa, d = dir(a), up = cl((-a / D2R - 62) / 26);
        return { W: add(SH, mul(d, L1 + L2 - 24 - 46 * up)), pole: vl([0.2, 1], [1, 0.25], up), hand: 'point', fa: a - up * 0.12, th: [d[1], -d[0]] };
      }
      case 'present': {   // open palm offered toward the target (arm reaching, fingers tilted up)
        // up aims (≤ -20°, i.e. almost always for the docked presenter): an open hand raised beside the head with the fingers up
        // reads as a salute / "hand to the ear" or a wave, so the wrist stays out to the side (≤ ~40° up) and the palm turns UP, fingers out toward the target side (an offering gesture)
        const up = cl((-pa / D2R - 20) / 25), aw = mx(pa, Math.max(pa, -40 * D2R), up), d = dir(aw);
        return { W: add(SH, mul(d, L1 + L2 - mx(70, 40, up))), pole: [0.5, 1], hand: 'open',
          fa: mx(pa - 28 * D2R, -16 * D2R, up), th: [d[1], -d[0]] };
      }
      case 'frame': {     // two-hand frame: both hands raised toward the target, fingers up, palms out
        // never next to the ears: steep aims keep the wrist out to the side (≤ ~58° up) and further from the shoulder
        const a = cl(pa, -150 * D2R, -15 * D2R), up = cl((-a / D2R - 50) / 30), aw = mx(a, Math.max(a, -58 * D2R), up), d = dir(aw);
        return { W: add(SH, mul(d, L1 + L2 - mx(150, 96, up))), pole: [1, 0.45], hand: 'open', fa: mx(aw, -PI / 2, mx(0.65, 0.4, up)), th: [-1, 0] };
      }
      case 'wave': { const w = Math.sin(st.wave || 0); return { W: [372 + w * 22, -548], pole: [1, 0.45], hand: 'open', fa: (-92 + w * 15) * D2R, th: [-1, 0] }; }
      case 'thumb': return { W: [196, -222], pole: [1, 0.6], hand: 'thumb', fa: PI, th: [0, -1] };
      case 'shrug': return { W: [396, -250], pole: [0.2, 1], hand: 'open', fa: -24 * D2R, th: [0, -1], raise: 26 };
      case 'facepalm': return { W: hp(98, 60), pole: [1, 0.7], hand: 'flat', fa: -116 * D2R, th: [-0.2, 1] };
      case 'cover': return { W: hp(132, 150), pole: [1, 0.8], hand: 'flat', fa: 190 * D2R, th: [0, -1] };
      case 'shh': return { W: hp(16, 224), pole: [1, 0.9], hand: 'point', fa: -90 * D2R, th: [-1, 0] };   // index finger up over the lips
      case 'hold': return { W: [150, -170], pole: [1, 0.6], hand: 'open', fa: 196 * D2R, th: [0, -1] };
      case 'fist': return { W: [334, -512], pole: [1, 0.3], hand: 'fist', fa: -90 * D2R, th: [-1, 0] };
      default: return { W: [286, 72], pole: [1, 0.12], hand: 'rest', fa: null, th: [-1, 0] };
    }
  }
  const thumbSide = (fa, th) => (Math.sin(fa) * th[0] - Math.cos(fa) * th[1]) >= 0 ? 1 : -1;
  function armRig(R, side, name, p, st) {
    // armLFrom / armRFrom + armLMix / armRMix: cross-fade from another pose (pose changes between phrases without dropping the arm)
    const from = st['arm' + side + 'From'], mixv = st['arm' + side + 'Mix'];
    const useFrom = from && from !== name && from !== 'down' && mixv != null && mixv < 1 && p >= 0.999;
    const e = useFrom ? ss(cl(mixv)) : ss(p), sgn = side === 'R' ? 1 : -1;
    const hp = (x, y) => { const q = R.headT.transformPoint(new DOMPoint(sgn * x, y)); return [sgn * q.x, q.y]; };
    const A = poseDef(useFrom ? from : 'down', st, hp, side), B = poseDef(name, st, hp, side);
    const raise = (B.raise || 0) * e, S = [SH[0], SH[1] - raise];
    const dA = sub(A.W, S), dB = sub(B.W, S);
    const a = ang(dA) + wrapPi(ang(dB) - ang(dA)) * e, d = mx(len(dA), len(dB), e);
    const pole = nrm(vl(A.pole, B.pole, e));
    const { E, W } = ik(S, add(S, mul(dir(a), d)), pole);
    const fore = ang(sub(W, E));
    const faA = A.fa ?? fore, faB = B.fa ?? fore, fa = faA + wrapPi(faB - faA) * e;
    let hsx = mx(thumbSide(faA, A.th), thumbSide(faB, B.th), e);
    if (Math.abs(hsx) < 0.3) hsx = hsx < 0 ? -0.3 : 0.3;
    const HA = HANDS[A.hand], HB = HANDS[B.hand], hand = {};
    for (const k in HA) hand[k] = mx(HA[k], HB[k], e);
    hand.palm = e > 0.5 ? HB.palm : HA.palm;
    return { side, sgn, name, p, e, S, E, W, Rl: vl(E, W, 0.4), fa, hsx, hand, raise };
  }
  function gestureDip(st, s) { const n = st['arm' + s]; return n === 'facepalm' || n === 'cover' ? cl(st['arm' + s + 'p'] ?? 1) : n === 'shh' ? 0.35 * cl(st['arm' + s + 'p'] ?? 1) : 0; }

  // ── rig: all transforms (bust space) ──
  function rig(st) {
    const R = { st };
    const s = st.s ?? 1;
    R.kid = false;
    R.look = applyLook(st.look || window.PRESENTER_LOOK || null);   // normalized appearance (see LOOK_DEFAULT)
    R.root = M0().translate(st.x ?? 540, (st.y ?? 1900) + (st.bob || 0)).rotate(st.rot || 0).scale(s * (st.sx ?? 1), s * (st.sy ?? 1));
    R.turn = cl(st.headTurn || 0, -1, 1);
    R.bt = cl((st.bodyTurn || 0) + R.turn * 0.18, -1, 1);
    R.torso = M0().rotate(st.lean || 0).scale(1 - 0.03 * Math.abs(R.bt), 1);
    const dR = gestureDip(st, 'R'), dL = gestureDip(st, 'L'), dip = Math.max(dR, dL);
    R.shock = cl(st.shock || 0);
    R.nod = cl((st.headNod || 0) + dip * 0.4, -1, 1);
    const tilt = (st.headTilt || 0) + (dR - dL) * 7;
    R.headT = M0().translate(R.turn * 5, NECK_Y + dip * 12 + R.nod * 5).rotate(tilt).translate(0, HEAD_O)
      .scale(1 - 0.04 * Math.abs(R.turn), 1 + R.shock * 0.025);
    R.head = R.torso.multiply(R.headT);
    R.armM = { R: R.torso, L: R.torso.scale(-1, 1) };
    R.arms = {};
    for (const side of ['L', 'R']) {
      const name = st['arm' + side] || 'down';
      let p = st['arm' + side + 'p']; if (p === undefined) p = name !== 'down' ? 1 : 0;
      R.arms[side] = armRig(R, side, name === 'down' ? 'down' : name, cl(p), st);
    }
    R.mouth = mouthParams(st, R.kid);
    return R;
  }

  // ── mouth: one morphing shape family (D ↔ wide slit ↔ O) driven by the viseme params ──
  function mouthParams(st, kid) {
    const jaw = cl(st.jaw ?? (st.mouth ?? 0) * 0.85, 0, 1.1);
    const lipW = cl(st.lipW ?? 0, -1, 1), press = cl(st.press ?? 0), teeth = cl(st.teeth ?? 0), tongue = cl(st.tongue ?? 0);
    const smile = cl(st.smile ?? 0.3, -1, 1);
    const open = jaw * (1 - press), round = cl(-lipW), wide = cl(lipW);
    const w = 92 * (1 + 0.2 * wide - 0.46 * round * (0.55 + 0.45 * cl(open * 2.5))) * (1 - 0.05 * press) + Math.max(0, smile) * 6;
    let h = 2.5 + open * 76;
    h = Math.max(h, teeth * 19 * (1 - press) * (1 - round * 0.6));
    const lift = smile * 9 - Math.max(0, open - 0.45) * 7;
    const cyL = -lift, cyR = -lift - Math.max(0, smile) * 4;           // dry smirk: the screen-right corner sits a touch higher
    const ct = mx(0.42, 1.0, round), cb = mx(0.52, 1.0, round);
    const Ut = h / 0.75;
    let U = Ut * mx(0.22, 0.44, round);
    const D = Ut - U;
    U -= Math.max(0, smile) * 5 * (1 - round) * cl(open * 3);
    return {
      w, h, U, D, ct, cb, cyL, cyR, open, round, press, tongue, teeth, smile,
      lipUp: 5 + round * 5, lipLo: (13 + round * 5) * (1 - press * 0.35) * (kid ? 0.7 : 1),
      tU: (open > 0.03 || teeth > 0.05) ? Math.min(h * 0.6, 5 + 10 * Math.max(teeth, cl(open * 1.4))) : 0,
      tL: teeth * (1 - cl(open * 2.4)) * 7, jd: open * 24,
    };
  }
  function mouthPath(m, ex = 0, up = 0, lo = 0) {
    const p = new Path2D(), hw = m.w / 2 + ex;
    p.moveTo(-hw, m.cyL);
    p.bezierCurveTo(-hw * m.ct, m.cyL - m.U - up / 0.75, hw * m.ct, m.cyR - m.U - up / 0.75, hw, m.cyR);
    p.bezierCurveTo(hw * m.cb, m.cyR + m.D + lo / 0.75, -hw * m.cb, m.cyL + m.D + lo / 0.75, -hw, m.cyL);
    p.closePath();
    return p;
  }
  // point on the top edge of the opening (t 0..1, left → right), raised by `up`
  function topEdge(m, t, up = 0) {
    const hw = m.w / 2, u = 1 - t, oy = -m.U - up / 0.75;
    const P0 = [-hw, m.cyL], P1 = [-hw * m.ct, m.cyL + oy], P2 = [hw * m.ct, m.cyR + oy], P3 = [hw, m.cyR];
    return [u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0], u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1]];
  }
  function drawMouth(ctx, m, kid) {
    const hw = m.w / 2;
    // lips (upper sliver + fuller lower lip)
    ctx.fillStyle = kid ? C.lipSoft : C.lip; ctx.fill(mouthPath(m, 5, m.lipUp, m.lipLo));
    // lower-lip highlight plane
    ctx.save(); ctx.clip(mouthPath(m, 5, m.lipUp, m.lipLo));
    ctx.fillStyle = 'rgba(246,245,241,0.22)';
    ctx.beginPath(); ctx.ellipse(-hw * 0.18, (m.cyL + m.cyR) / 2 + m.D * 0.75 + m.lipLo * 0.42, hw * 0.34, m.lipLo * 0.22, 0, 0, TAU); ctx.fill();
    ctx.restore();
    // opening
    const op = mouthPath(m);
    ctx.fillStyle = INK; ctx.fill(op);
    ctx.save(); ctx.clip(op);
    const cy = (m.cyL + m.cyR) / 2, top = cy - 0.75 * m.U, bot = cy + 0.75 * m.D;
    if (m.tL > 0.5) {   // lower teeth
      const q = new Path2D();
      q.moveTo(-hw - 4, m.cyL + 90); q.lineTo(hw + 4, m.cyR + 90); q.lineTo(hw + 4, m.cyR - m.tL);
      q.bezierCurveTo(hw * m.cb, m.cyR + m.D - m.tL, -hw * m.cb, m.cyL + m.D - m.tL, -hw - 4, m.cyL - m.tL); q.closePath();
      ctx.fillStyle = PAPER; ctx.fill(q);
    }
    if (m.h > 7) {      // tongue
      const ty = mx(bot - m.h * 0.06, top + m.h * 0.46, m.tongue), ry = Math.max(7, m.h * 0.34);
      ctx.fillStyle = C.tongue; ctx.beginPath(); ctx.ellipse(0, ty + ry * 0.55, m.w * (0.3 + 0.06 * m.tongue), ry, 0, 0, TAU); ctx.fill();
    }
    if (m.tU > 0.5) {   // upper teeth follow the upper lip line
      const q = new Path2D();
      q.moveTo(-hw - 4, m.cyL - 90); q.lineTo(hw + 4, m.cyR - 90); q.lineTo(hw + 4, m.cyR + m.tU);
      q.bezierCurveTo(hw * m.ct, m.cyR - m.U + m.tU, -hw * m.ct, m.cyL - m.U + m.tU, -hw - 4, m.cyL + m.tU); q.closePath();
      ctx.fillStyle = PAPER; ctx.fill(q);
    }
    ctx.restore();
    // closed-lip line (so a shut mouth always reads)
    const cw = cl(1 - (m.h - 3) / 10);
    if (cw > 0.02) {
      ctx.beginPath(); ctx.moveTo(-hw, m.cyL);
      ctx.bezierCurveTo(-hw * m.ct, m.cyL - m.U * 0.5, hw * m.ct, m.cyR - m.U * 0.5, hw, m.cyR);
      ctx.lineWidth = 4.6 * cw + 0.5; ctx.lineCap = 'round'; ctx.strokeStyle = INK; ctx.stroke();
    }
  }

  // ── head geometry (head space: origin = eye line centre, y down) ──
  const FWS = 0.88;                               // face-width scale for the slim look
  const HEAD_HALF = [[0, -214], [92, -203], [148, -158], [166, -84], [168, -4], [162, 66], [146, 124], [110, 176], [58, 207]];
  function headPath(R) {
    const m = R.mouth, t = R.turn;
    const yj = R.look && R.look.young;
    const half = HEAD_HALF.map(([x, y]) => R.kid && y > 40 ? [x * 0.95, y * 0.93] : yj && y > 40 ? [x * 0.97, y * 0.965] : [x, y]);
    let pts = half.concat([[0, R.kid ? 204 : yj ? 208 : 215]], half.slice(1).reverse().map(([x, y]) => [-x, y]));
    if (R.look && R.look.slim) pts = pts.map(([x, y]) => [x * FWS * (y > 30 ? 1 - 0.1 * cl((y - 30) / 170) : 1), y > 40 ? y * 1.05 : y]);
    return smooth(new Path2D(), pts.map(([x, y]) => {
      const k = cl((y - 60) / 160);
      return [x + t * 22 * k, y + m.jd * cl((y - 100) / 118)];
    }));
  }
  function beardPath(R, fy) {
    const m = R.mouth, t = R.turn;
    const outer = [[153, -132, 1], [167, -70], [169, 0], [164, 66], [150, 126], [114, 180], [62, 212], [0, 223]];
    const inner = [[151, -132, 1], [154, -40], [151, 34], [134, 84], [100, 108], [62, 102], [30, 95], [0, 97]];
    const W = ([x, y, c], face) => {
      const k = cl((y - 40) / 180), sh = face ? t * 30 * cl((y + 20) / 110) * (1 - Math.abs(x) / 190) : t * 22 * k;
      return [x + sh, y + m.jd * cl((y - 104) / 120) + (face ? fy * cl((y + 20) / 60) : 0), c];
    };
    const pts = [];
    for (const q of outer) pts.push(W(q, false));
    for (let i = outer.length - 2; i >= 0; i--) { const [x, y, c] = outer[i]; pts.push(W([-x, y, c], false)); }
    for (const q of inner) pts.push(W([-q[0], q[1], q[2]], true));
    for (let i = inner.length - 2; i >= 0; i--) pts.push(W(inner[i], true));
    return smooth(new Path2D(), pts);
  }


  // ── hairstyles (head space, y down). back = mass behind the head, front = top cap + fringe ──
  const HAIRSTYLES = {
    // blunt, textured fringe resting just above the brows; sides tuck over the ear tops
    fringe: { edge: [[140, -78], [112, -92, 1], [98, -80], [80, -96, 1], [60, -84], [38, -98, 1], [16, -86], [-8, -100, 1], [-30, -88], [-54, -100, 1], [-76, -86], [-100, -98, 1], [-122, -84], [-142, -76]], lock: 5, flow: 'down' },
    // middle part, curtains framing the forehead
    curtain: { edge: [[146, -58], [134, -96], [110, -128], [80, -156], [46, -180], [14, -202, 1], [0, -192, 1], [-14, -202, 1], [-46, -180], [-80, -156], [-110, -128], [-134, -96], [-146, -58]], lock: 8, flow: 'part', part: 0 },
    // deep side part, fringe swept across to the right brow
    swept: { edge: [[146, -70], [122, -84, 1], [104, -90], [78, -104, 1], [56, -112], [28, -128, 1], [4, -136], [-24, -152, 1], [-50, -162], [-80, -178, 1], [-104, -192], [-122, -178], [-140, -130], [-146, -72]], lock: 2, flow: 'sweep', part: -108 },
    // short textured crop: choppy fringe high on the forehead, tighter sides, ears free
    crop: { edge: [[150, -120], [120, -132], [80, -140], [50, -150, 1], [30, -138], [0, -146], [-30, -142], [-60, -150, 1], [-80, -138], [-120, -130], [-150, -118]], lock: -78, flow: 'up', tight: true },
    // messy textured: tousled volume on top, pointed clumps falling on the forehead, tapered sides
    messy: { edge: [[132, -88], [118, -120], [100, -96], [84, -132], [66, -100], [50, -138], [34, -84], [18, -70], [4, -112], [-12, -132], [-30, -96], [-44, -80], [-58, -118], [-76, -136], [-92, -104], [-110, -126], [-126, -96]], lock: -48, flow: 'messy', messy: true },
    // tousled, wavy medium hair with a stray lock
    wavy: { edge: [[146, -40], [134, -86], [112, -70], [96, -108], [70, -84], [52, -118], [30, -62, 1], [14, -104], [-10, -128], [-36, -92], [-58, -130], [-84, -96], [-108, -126], [-128, -84], [-146, -46]], lock: 22, flow: 'wave', wavy: true },
    // long hair: middle part, side locks framing the face down to the jaw, mass falling behind onto the shoulders
    long: { edge: [[146, -58], [134, -96], [110, -128], [80, -156], [46, -180], [14, -202, 1], [0, -192, 1], [-14, -202, 1], [-46, -180], [-80, -156], [-110, -128], [-134, -96], [-146, -58]], lock: 8, flow: 'part', part: 0, long: true },
    // pulled back into a ponytail (visible behind the screen-right side of the head), small hair tie in the accent colour
    ponytail: { edge: [[146, -96], [120, -150], [80, -176], [40, -192], [0, -198, 1], [-40, -192], [-80, -176], [-120, -150], [-146, -96]], lock: -60, flow: 'back', tight: true, tail: true },
    // pulled back into a top bun
    bun: { edge: [[146, -96], [120, -150], [80, -176], [40, -192], [0, -198, 1], [-40, -192], [-80, -176], [-120, -150], [-146, -96]], lock: -60, flow: 'back', tight: true, bun: true },
    // short curly / afro-textured: bumpy silhouette of curls all round the top
    curly: { edge: [[150, -96], [128, -126], [110, -104], [88, -136], [64, -110], [40, -140], [16, -114], [-8, -142], [-32, -112], [-56, -140], [-80, -108], [-104, -134], [-126, -104], [-150, -94]], lock: -30, flow: 'curly', curly: true },
    // long voluminous curls (long silhouette + curl bumps all round + spiral strands)
    longcurly: { edge: [[146, -58], [134, -96], [110, -128], [80, -156], [46, -180], [14, -202, 1], [0, -192, 1], [-14, -202, 1], [-46, -180], [-80, -156], [-110, -128], [-134, -96], [-146, -58]], lock: 8, flow: 'curlylong', long: true, curls: true },
    // long soft waves: middle part, wavy side locks and a wavy mass behind falling onto the shoulders
    wavylong: { edge: [[146, -58], [134, -96], [110, -128], [80, -156], [46, -180], [14, -202, 1], [0, -192, 1], [-14, -202, 1], [-46, -180], [-80, -156], [-110, -128], [-134, -96], [-146, -58]], lock: 8, flow: 'wavylong', part: 0, long: true, waves: true },
    // buzz cut: a close shadow following the skull
    buzz: { buzz: true, flow: 'none' },
  };
  function circles(p, list) { for (const [x, y, r] of list) { p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU); } return p; }
  function hairPaths(L) {
    if (!L.hair || L.hair === 'bald' || L.hair === 'none') return null;
    const H = HAIRSTYLES[L.hair] || HAIRSTYLES.crop, w = H.tight ? 180 : 188, lock = H.lock;
    if (H.buzz) {
      const front = smooth(new Path2D(), [[-166, -50, 1], [-172, -120], [-152, -176], [-96, -212], [0, -222], [96, -212], [152, -176], [172, -120], [166, -50, 1],
        [150, -56, 1], [150, -108], [112, -138], [56, -150], [0, -154], [-56, -150], [-112, -138], [-150, -108], [-150, -56, 1]]);
      return { H, front, back: null, extra: null };
    }
    if (H.long) {
      const front = H.waves
        ? smooth(new Path2D(), [[-200, 250, 1], [-222, 180], [-204, 110], [-222, 40], [-208, -30], [-198, -150], [-162, -232], [-92, -270], [0, -278], [92, -270], [162, -232], [198, -150], [208, -30], [222, 40], [204, 110], [222, 180], [200, 250, 1],
          [152, 250, 1], [140, 180], [158, 110], [146, 40], [156, -10], [152, -60]].concat(H.edge.slice(1, -1), [[-152, -60], [-156, -10], [-146, 40], [-158, 110], [-140, 180], [-152, 250, 1]]))
        : smooth(new Path2D(), [[-202, 236, 1], [-214, 110], [-208, -30], [-198, -150], [-162, -232], [-92, -270], [0, -278], [92, -270], [162, -232], [198, -150], [208, -30], [214, 110], [202, 236, 1],
        [154, 236, 1], [150, 110], [156, -10], [152, -60]].concat(H.edge.slice(1, -1), [[-152, -60], [-156, -10], [-150, 110], [-154, 236, 1]]));
      let back = smooth(new Path2D(), [[-212, 330, 1], [-232, 120], [-222, -110], [-176, -238], [-92, -284], [0, -292], [92, -284], [176, -238], [222, -110], [232, 120], [212, 330, 1]]);
      if (H.waves) back = smooth(new Path2D(), [[-214, 340, 1], [-246, 270], [-226, 190], [-252, 110], [-232, 30], [-246, -60], [-224, -130], [-176, -238], [-92, -284], [0, -292], [92, -284], [176, -238], [224, -130], [246, -60], [232, 30], [252, 110], [226, 190], [246, 270], [214, 340, 1]]);
      if (H.curls) {   // curly mass behind (bumpy outline on top and sides, open under the chin so the hoodie shows)
        const bc = [];
        const BP = [[-214, 300], [-238, 220], [-246, 130], [-240, 40], [-236, -50], [-226, -140], [-190, -222], [-130, -272], [-50, -296], [50, -296], [130, -272], [190, -222], [226, -140], [236, -50], [240, 40], [246, 130], [238, 220], [214, 300]];
        BP.forEach(([x, y], i) => bc.push([x, y, 34 + (i % 3) * 6]));
        back = circles(smooth(new Path2D(), [[-120, 340, 1], [-216, 340, 1], [-236, 120], [-226, -120], [-180, -248], [-92, -294], [0, -302], [92, -294], [180, -248], [226, -120], [236, 120], [216, 340, 1], [120, 340, 1], [96, 160, 1], [-96, 160, 1]]), bc);
      }
      return { H, front, back, extra: null };
    }
    let outer = H.messy
      ? [[-(w - 14), lock, 1], [-(w + 2), -96], [-(w + 12), -150], [-(w - 2), -196], [-(w + 10), -236], [-150, -268], [-118, -300], [-72, -296], [-42, -322], [6, -310], [46, -328], [90, -306], [132, -304], [w - 8, -268], [w + 14, -226], [w + 2, -186], [w + 10, -138], [w + 2, -96], [w - 14, lock, 1]]
      : H.wavy
      ? [[-186, lock + 18, 1], [-206, -20], [-196, -70], [-222, -130], [-200, -190], [-196, -236], [-140, -262], [-96, -292], [-40, -284], [10, -306], [64, -286], [118, -290], [164, -252], [204, -232], [212, -170], [226, -110], [204, -60], [210, -10], [186, lock + 18, 1]]
      : [[-(w - 12), lock, 1], [-(w - 4), -70], [-w, -146], [-(w - 30), -224], [-90, -262], [0, H.tight ? -262 : -270], [90, -262], [w - 30, -224], [w, -146], [w - 4, -70], [w - 12, lock, 1]];
    if (H.curly) outer = [[-182, lock, 1], [-196, -90], [-200, -170], [-160, -250], [-80, -292], [0, -300], [80, -292], [160, -250], [200, -170], [196, -90], [182, lock, 1]];
    const inner = H.messy
      ? [[152, lock - 4, 1], [160, -96], [144, -124]].concat(H.edge, [[-144, -122], [-160, -96], [-152, lock - 4, 1]])
      : [[150, lock - 4, 1], [158, Math.min(lock - 60, -70)]].concat(H.edge, [[-158, Math.min(lock - 60, -70)], [-150, lock - 4, 1]]);
    const front = smooth(new Path2D(), outer.concat(inner));
    if (H.curly) {   // ring of curls over the silhouette
      const cs = [];
      for (let i = 0; i <= 14; i++) { const a = PI * (1.02 + 0.96 * i / 14); cs.push([Math.cos(a) * 196, -128 + Math.sin(a) * 172, 34 + (i % 3) * 5]); }
      circles(front, cs);
    }
    let back = smooth(new Path2D(), H.tight || H.messy
      ? [[-178, -40, 1], [-194, -130], [-162, -236], [0, -288], [162, -236], [194, -130], [178, -40, 1]]
      : [[-176, 44, 1], [-192, -60], [-196, -150], [-160, -230], [-90, -268], [0, -276], [90, -268], [160, -230], [196, -150], [192, -60], [176, 44, 1]]);
    if (H.curly) back = circles(smooth(new Path2D(), [[-186, 10, 1], [-214, -110], [-180, -250], [0, -316], [180, -250], [214, -110], [186, 10, 1]]), [[-200, -40, 40], [200, -40, 40], [-206, 4, 34], [206, 4, 34]]);
    let extra = null;      // drawn behind the head with the back mass (tail / bun) + its tie
    if (H.tail) extra = { path: smooth(new Path2D(), [[120, -214, 1], [196, -196], [244, -120], [246, -10], [226, 96], [206, 150], [200, 60], [206, -50], [188, -140], [150, -178]]), tie: [196, -186, 18, 13, 0.5] };
    if (H.bun) extra = { path: circles(new Path2D(), [[0, -318, 74]]), tie: [0, -252, 50, 11, 0] };
    return { H, front, back, extra };
  }
  function paintHairStrands(K, H, col) {
    K.save(); K.strokeStyle = col; K.lineWidth = 5; K.lineCap = 'round';
    if (H.flow === 'none') { K.restore(); return; }
    if (H.flow === 'curly') {
      for (let i = 0; i < 22; i++) { const x = -150 + (i % 6) * 60 + (Math.floor(i / 6) % 2) * 30, y = -250 + Math.floor(i / 6) * 40; K.beginPath(); K.arc(x, y, 14, 0.4 + i, 3.6 + i); K.stroke(); }
      K.restore(); return;
    }
    if (H.flow === 'wavylong') {   // part lines on top + S-waves running down both side locks
      for (const [a, b, c, d, e, f] of [[0, -250, 70, -200, 120, -110], [0, -250, -70, -200, -120, -110], [20, -270, 110, -236, 160, -150], [-20, -270, -110, -236, -160, -150]]) { K.beginPath(); K.moveTo(a, b); K.quadraticCurveTo(c, d, e, f); K.stroke(); }
      for (const s of [-1, 1]) for (const dx of [0, 22]) {
        const x0 = s * (178 + dx * 0.4); K.beginPath(); K.moveTo(s * (168 + dx * 0.3), -170);
        K.bezierCurveTo(s * (204 + dx * 0.2), -110, s * (160 + dx), -60, x0, -10); K.bezierCurveTo(s * (200 + dx * 0.2), 40, s * (160 + dx), 90, x0, 140); K.bezierCurveTo(s * (196 + dx * 0.2), 180, s * (166 + dx), 210, x0, 240); K.stroke();
      }
      K.restore(); return;
    }
    if (H.flow === 'curlylong') {   // little spiral curls scattered over the hair (clipped to the hair shape)
      K.lineWidth = 4.5;
      for (let i = 0; i < 46; i++) { const x = -220 + (i % 9) * 55 + (Math.floor(i / 9) % 2) * 27, y = -270 + Math.floor(i / 9) * 104 + ((i * 37) % 23); if (Math.abs(x) < 140 && y > -150) continue; K.beginPath(); K.arc(x, y, 13, 0.6 + i * 1.7, 4.4 + i * 1.7); K.stroke(); }
      K.restore(); return;
    }
    if (H.flow === 'back') {
      for (const [a, b, c, d, e, f] of [[-120, -150, -110, -210, -60, -250], [-50, -186, -40, -236, 0, -262], [50, -186, 40, -236, 0, -262], [120, -150, 110, -210, 60, -250]]) { K.beginPath(); K.moveTo(a, b); K.quadraticCurveTo(c, d, e, f); K.stroke(); }
      K.restore(); return;
    }
    const lines = H.flow === 'part'
      ? [[0, -250, 70, -200, 120, -110], [0, -250, -70, -200, -120, -110], [20, -270, 110, -236, 160, -150], [-20, -270, -110, -236, -160, -150]]
      : H.flow === 'sweep'
        ? [[-100, -240, 0, -210, 90, -120], [-80, -270, 40, -250, 140, -150], [-130, -200, -40, -170, 30, -140], [-150, -150, -120, -120, -100, -110]]
        : H.flow === 'up'
          ? [[-100, -150, -110, -200, -90, -246], [-30, -160, -36, -214, -20, -256], [40, -160, 46, -214, 30, -256], [110, -150, 118, -200, 96, -244]]
          : H.flow === 'messy'
            ? [[-150, -236, -100, -200, -116, -130], [-80, -290, -40, -220, -56, -120], [0, -300, 30, -220, 6, -110], [70, -296, 110, -230, 84, -122], [140, -270, 170, -200, 132, -132], [-30, -250, -90, -230, -150, -200]]
          : H.flow === 'wave'
            ? [[-140, -230, -60, -250, -110, -140], [-40, -270, 40, -240, -20, -150], [60, -270, 140, -230, 80, -130], [150, -200, 200, -120, 150, -80]]
            : [[-110, -240, -118, -176, -104, -112], [-40, -258, -46, -186, -34, -120], [40, -258, 44, -186, 32, -118], [110, -240, 116, -176, 102, -110]];
    if (H.flow === 'messy') {
      for (const [x, y, r, a0, a1] of [[-120, -236, 26, 3.6, 5.9], [-58, -268, 24, 3.3, 5.6], [8, -262, 26, 3.8, 6.1], [74, -272, 24, 3.4, 5.8], [132, -232, 24, 3.7, 6.0], [-96, -176, 22, 0.3, 2.6], [-20, -186, 24, 0.5, 2.8], [58, -180, 22, 0.2, 2.5], [120, -160, 20, 0.4, 2.7], [-150, -150, 20, 0.6, 2.9]]) { K.beginPath(); K.arc(x, y, r, a0, a1); K.stroke(); }
    } else for (const [a, b, c, d, e, f] of lines) { K.beginPath(); K.moveTo(a, b); K.quadraticCurveTo(c, d, e, f); K.stroke(); }
    K.restore();
  }

  // ── painting ────────────────────────────────────────────────────────────────
  function paintTorso(K, R, M, sil) {
    const L = R.look, top = L.top, kid = top !== 'overshirt', bx = R.bt * 26, rl = R.arms.L.raise, rr = R.arms.R.raise;
    const TM = M.multiply(R.torso);
    K.setTransform(TM);
    const body = new Path2D();
    body.moveTo(-312, 60); body.lineTo(312, 60); body.lineTo(305, 0);
    body.bezierCurveTo(303, -80, 289, -158, 270, -210);
    body.bezierCurveTo(264, -258 - rr, 256, -300 - rr, 218, -314 - rr);
    body.bezierCurveTo(172, -328 - rr * 0.5, 112, -337, 72, -342);
    body.bezierCurveTo(52 + bx, -306, -52 + bx, -306, -72, -342);
    body.bezierCurveTo(-112, -337, -172, -328 - rl * 0.5, -218, -314 - rl);
    body.bezierCurveTo(-256, -300 - rl, -264, -258 - rl, -270, -210);
    body.bezierCurveTo(-289, -158, -303, -80, -305, 0);
    body.closePath();
    sil.push([body, R.torso]);
    // collar stand behind the neck
    const stand = new Path2D(); stand.moveTo(-86, -336); stand.bezierCurveTo(-88, -378, 88, -378, 86, -336); stand.closePath();
    if (top === 'hoodie') {   // hood bunched behind the neck
      const hood = new Path2D(); hood.moveTo(-150, -320); hood.bezierCurveTo(-170, -420, 170, -420, 150, -320); hood.closePath();
      fillSh(K, hood, C.shirtSh, mix(C.shirtSh, INK, 0.2), 0, 10);
    }
    K.fillStyle = C.shirtSh; K.fill(stand);
    // neck (in the head's shadow)
    const nw = L.slim ? 43 : 50;
    const neck = new Path2D(); neck.moveTo(-nw, -450); neck.lineTo(nw, -450); neck.lineTo(nw + 2, -300); neck.lineTo(-nw - 2, -300); neck.closePath();
    fillSh(K, neck, kid ? SKIN : C.skinSh, kid ? C.skinSh : mix(C.skinSh, INK, 0.08), -14, 0);
    // body
    fillSh(K, body, SHIRT, C.shirtSh, -30, -6);
    if (kid) {
      // crew-neck rib (tee / hoodie) or a buttoned collar
      K.beginPath(); K.moveTo(-72, -342); K.bezierCurveTo(-52 + bx, -306, 52 + bx, -306, 72, -342);
      K.lineWidth = 12; K.strokeStyle = C.shirtLt; K.lineCap = 'round'; K.stroke();
      if (top === 'hoodie') {   // drawstrings
        for (const s of [-1, 1]) { K.beginPath(); K.moveTo(s * 40 + bx, -318); K.quadraticCurveTo(s * 46 + bx, -250, s * 38 + bx, -190); K.lineWidth = 6; K.strokeStyle = C.shirtLt; K.stroke(); circle(K, s * 38 + bx, -186, 7, C.shirtLt); }
      }
      if (top === 'collar') {
        for (const s of [-1, 1]) {
          const w = new Path2D(), o = bx * 0.9;
          w.moveTo(s * 20 + o, -318); w.lineTo(s * 74 + o, -352); w.quadraticCurveTo(s * 120 + o, -344, s * 136 + o, -320); w.lineTo(s * 30 + o, -296); w.closePath();
          K.save(); K.translate(s * 3 + 2, 8); K.fillStyle = CAST; K.fill(w); K.restore();
          fillSh(K, w, SHIRT, C.shirtSh, -5, -5);
        }
        K.fillStyle = INK; for (const y of [-268, -190, -112]) { K.beginPath(); K.arc(bx * 0.9, y, 5, 0, TAU); K.fill(); }
      }
      paintNeckAcc(K, R, bx);
      return;
    }
    // tee in the open front (the left panel casts a thin shadow on it)
    const tee = new Path2D();
    tee.moveTo(-72 + bx * 0.2, -342); tee.bezierCurveTo(-52 + bx, -306, 52 + bx, -306, 72 + bx * 0.2, -342);
    tee.bezierCurveTo(80 + bx, -260, 94 + bx, -130, 106 + bx, 60); tee.lineTo(-106 + bx, 60);
    tee.bezierCurveTo(-94 + bx, -130, -80 + bx, -260, -72 + bx * 0.2, -342); tee.closePath();
    fillSh(K, tee, C.tee, C.teeSh, 12, 0);
    // crew-neck rib + a soft shadow under the beard
    K.save(); K.clip(tee);
    K.fillStyle = 'rgba(17,17,17,0.08)'; K.beginPath(); K.ellipse(bx * 0.6, -318, 70, 22, 0, 0, TAU); K.fill();
    K.restore();
    K.beginPath(); K.moveTo(-62 + bx * 0.2, -331); K.bezierCurveTo(-44 + bx, -292, 44 + bx, -292, 62 + bx * 0.2, -331);
    K.lineWidth = 3; K.strokeStyle = C.teeLine; K.lineCap = 'round'; K.stroke();
    // overshirt collar wings (with a cast shadow)
    for (const s of [-1, 1]) {
      const w = new Path2D(), o = bx * 0.9;
      w.moveTo(s * 58 + o, -352); w.quadraticCurveTo(s * 108 + o, -348, s * 154 + o * 0.5, -326);
      w.lineTo(s * 128 + o, -260); w.quadraticCurveTo(s * 100 + o, -282, s * 82 + o, -300);
      w.quadraticCurveTo(s * 66 + o, -322, s * 58 + o, -352); w.closePath();
      K.save(); K.translate(s * 3 + 2, 9); K.fillStyle = CAST; K.fill(w); K.restore();
      fillSh(K, w, SHIRT, C.shirtSh, -6, -5);
    }
    // chest pocket (screen-left) + buttons (screen-right placket)
    const px = -171 + bx * 0.9;
    const pk = new Path2D(); pk.roundRect(px - 43, -236, 86, 102, [4, 4, 10, 10]);
    fillSh(K, pk, SHIRT, C.shirtSh, -5, -5);
    const fl = new Path2D(); fl.moveTo(px - 46, -244); fl.lineTo(px + 46, -244); fl.lineTo(px + 46, -214); fl.lineTo(px, -198); fl.lineTo(px - 46, -214); fl.closePath();
    K.save(); K.translate(1, 6); K.fillStyle = CAST; K.fill(fl); K.restore();
    fillSh(K, fl, SHIRT, C.shirtSh, -4, -4);
    K.fillStyle = INK; K.beginPath(); K.arc(px, -207, 5, 0, TAU); K.fill();
    for (const [x, y] of [[100, -214], [108, -112]]) { K.beginPath(); K.arc(x + bx, y, 5.5, 0, TAU); K.fill(); }
    paintNeckAcc(K, R, bx);
  }
  // accessories that sit on the chest / neck (torso space)
  function paintNeckAcc(K, R, bx) {
    const A = R.look.acc;
    if (A.has('necklace')) {
      K.beginPath(); K.moveTo(-52 + bx * 0.3, -336); K.quadraticCurveTo(bx * 0.8, -250, 52 + bx * 0.3, -336);
      K.lineWidth = 3.5; K.strokeStyle = '#C9A24A'; K.lineCap = 'round'; K.stroke();
      circle(K, bx * 0.8, -290, 9, '#C9A24A', mix('#C9A24A', INK, 0.35), 2.5);
    }
    if (A.has('mic')) {   // lavalier clipped to the collar
      K.save(); K.translate(-96 + bx * 0.6, -282); K.rotate(-0.3);
      fillRR(K, -9, -20, 18, 40, 9, INK); fillRR(K, -12, 12, 24, 10, 3, '#3A3A3A'); K.restore();
      K.beginPath(); K.moveTo(-100 + bx * 0.6, -262); K.quadraticCurveTo(-130, -150, -120, 60); K.lineWidth = 3; K.strokeStyle = INK; K.stroke();
    }
    if (A.has('headphones')) {   // resting around the neck
      K.beginPath(); K.moveTo(-104, -318); K.bezierCurveTo(-110, -250, 110, -250, 104, -318); K.lineWidth = 14; K.strokeStyle = '#2A2A2C'; K.lineCap = 'round'; K.stroke();
      for (const s of [-1, 1]) { K.save(); K.translate(s * 104, -322); K.rotate(s * 0.35); fillRR(K, -30, -40, 60, 74, 26, '#1E1E20'); fillRR(K, -20, -30, 40, 54, 18, '#3A3A3D'); K.restore(); }
    }
  }
  function fillRR(K, x, y, w, h, r, col) { K.beginPath(); K.roundRect(x, y, w, h, r); K.fillStyle = col; K.fill(); }
  function circle(K, x, y, r, fill, stroke, lw) { K.beginPath(); K.arc(x, y, r, 0, TAU); if (fill) { K.fillStyle = fill; K.fill(); } if (stroke) { K.lineWidth = lw || 2; K.strokeStyle = stroke; K.stroke(); } }

  function paintHead(K, R, M, sil) {
    const st = R.st, kid = R.kid, m = R.mouth, t = R.turn, TH = t * 21 * D2R, shock = R.shock;
    const fy = R.nod * 11;
    const fx = (x, dep = 0) => { const r = RH + dep, ph = Math.asin(cl(x / r, -1, 1)); return r * Math.sin(ph + TH); };
    const ffs = (x, dep = 0) => { const r = RH + dep, ph = Math.asin(cl(x / r, -1, 1)); return Math.max(0.3, Math.cos(ph + TH) / Math.cos(ph)); };
    const L = R.look, FW = L.slim ? FWS : 1, BEANIE = !!L.beanie;
    const HCOL = L.hairHex, HSH = mix(HCOL, INK, 0.55), HLT = mix(HCOL, PAPER, 0.2);
    const HP = hairPaths(L), buzz = HP && HP.H.buzz;
    const showFront = HP && !BEANIE;                                   // under a beanie only the back mass / tail shows
    const HM = M.multiply(R.head);
    K.setTransform(HM);
    if (HP && (HP.back || HP.extra) && !(BEANIE && HP.H.bun)) {
      K.save(); K.translate(t * 9, R.nod * 4 - shock * 10); K.scale(FW, 1); K.fillStyle = HP.H.curls ? mix(HCOL, INK, 0.3) : HSH;
      if (HP.back && (!BEANIE || HP.H.long || HP.H.curly)) K.fill(HP.back);
      if (HP.extra) {
        fillSh(K, HP.extra.path, HCOL, HSH, -10, -8);
        const [x, y, rx, ry, rot] = HP.extra.tie; K.fillStyle = RED; K.beginPath(); K.ellipse(x, y, rx, ry, rot, 0, TAU); K.fill();
      }
      K.restore();
      if (HP.H.long && HP.back) sil.push([HP.back, R.head.translate(t * 9, R.nod * 4 - shock * 10).scale(FW, 1)]);
    }
    // ears (behind the head): the near ear opens up, the far one tucks behind
    for (const s of [-1, 1]) {
      const near = -s * t, ex = s * (167 * FW - 22 * Math.max(0, -near)), rx = 21 + 6 * Math.max(0, near) - 8 * Math.max(0, -near);
      const ep = new Path2D(); ep.ellipse(ex, 16 + fy * 0.5, rx, 36, 0, 0, TAU);
      K.fillStyle = SKIN; K.fill(ep);
      K.fillStyle = C.skinSh; K.beginPath(); K.ellipse(ex + s * 4, 18 + fy * 0.5, rx * 0.5, 22, 0, 0, TAU); K.fill();
      sil.push([ep, R.head]);
      if (L.acc.has('earrings') && near > -0.3) { K.lineWidth = 4; K.strokeStyle = '#C9A24A'; K.beginPath(); K.arc(ex + s * 4, 60 + fy * 0.5, 10, 0, TAU); K.stroke(); }
    }
    // head
    const hp = headPath(R);
    sil.push([hp, R.head]);
    fillSh(K, hp, SKIN, C.skinSh, -17 + t * 10, -6);
    K.save(); K.clip(hp);
    // band of shade under the beanie cuff / hair
    if (showFront && !buzz) { K.save(); K.translate(t * 9 + 4, R.nod * 4 - shock * 10 + 15); K.scale(FW, 1); K.fillStyle = C.skinSh; K.fill(HP.front); K.restore(); }
    else if (BEANIE) { K.fillStyle = C.skinSh; K.beginPath(); K.moveTo(-200, -300); K.lineTo(200, -300); K.lineTo(200, -114 + fy * 0.3); K.quadraticCurveTo(0, -100 + fy * 0.3, -200, -114 + fy * 0.3); K.closePath(); K.fill(); }
    if (kid) { K.fillStyle = 'rgba(255,59,31,0.2)'; for (const s of [-1, 1]) { K.beginPath(); K.ellipse(fx(s * 100, -10), 70 + fy, 30, 18, 0, 0, TAU); K.fill(); } }
    K.restore();
    // nose: side plane + base lobe in skin shade
    const nx = fx(0, 34), nf = ffs(0, 34);
    const nsc = kid ? 0.8 : L && L.young ? 0.88 : 1;
    K.save(); K.translate(nx, fy); K.scale(nf * nsc, nsc);
    const np = new Path2D();
    np.moveTo(3, -6); np.bezierCurveTo(12, 14, 23, 34, 23, 50); np.bezierCurveTo(23, 64, 11, 70, 0, 70);
    np.bezierCurveTo(-13, 70, -23, 64, -23, 56); np.bezierCurveTo(-23, 48, -16, 46, -9, 49);
    np.bezierCurveTo(-3, 52, 5, 49, 7, 42); np.bezierCurveTo(9, 28, 6, 10, 3, -6); np.closePath();
    K.fillStyle = C.skinSh; K.fill(np);
    K.restore();
    // beard (one mass incl. the mouth area; the mouth sits on top, the mustache is re-laid over the upper lip)
    const mX = fx(0, -6), mY = 118 + fy, msx = 1 - 0.14 * Math.abs(t);
    const beard = L.beard === 'full';
    if (L.beard === 'stubble') { K.save(); K.globalAlpha = 0.85; K.fillStyle = C.stubble; K.fill(beardPath(R, fy)); K.restore(); }
    if (beard) {
      const bp = beardPath(R, fy);
      sil.push([bp, R.head]);
      K.save(); K.translate(0, -9); K.fillStyle = C.fade; K.fill(bp); K.restore();
      fillSh(K, bp, L.beardHex, C.hairSh, -12 + t * 8, -10);
    }
    // mouth
    K.save(); K.translate(mX, mY); K.scale(msx, 1);
    drawMouth(K, m, !beard);
    K.restore();
    // mustache: top edge anchored to the face, bottom edge rides the upper lip
    if (beard) {
      const hw = m.w / 2, pts = [];
      const TT = (x, y) => [mX + x * msx, mY + y];
      pts.push([...TT(-hw - 13, m.cyL + 7), 1]);
      for (const [x, y] of [[-60, -18], [-32, -26], [0, -23], [32, -26], [60, -18]]) pts.push([mX + x * msx, mY + y]);
      pts.push([...TT(hw + 13, m.cyR + 7), 1]);
      for (let i = 8; i >= 0; i--) {
        const [x, y] = topEdge(m, i / 8, m.lipUp - 3.5);
        pts.push(TT(x, Math.max(y, -17 + Math.abs(x) * 0.1)));
      }
      const mp = smooth(new Path2D(), pts);
      fillSh(K, mp, L.beardHex, C.hairSh, -6, -6);
    }
    // eyes
    const eyeS = kid ? 1.14 : L && L.young ? 1.07 : 1;
    const br = cl(st.brow || 0, -1, 1) + shock * 0.9, tilt = cl(st.browTilt || 0), smile = cl(st.smile ?? 0.3, -1, 1);
    const blink = cl(st.blink || 0), wink = cl(st.wink || 0);
    const lx = cl(st.lookX || 0, -1, 1), ly = cl(st.lookY || 0, -1, 1);
    const eyes = [];
    for (const s of [-1, 1]) {
      const ex = fx(s * 77 * FW), fs = ffs(s * 77 * FW), ey = fy;
      eyes.push({ s, ex, ey, fs });
      const sc = eyeS * (1 + shock * 0.22);
      K.save(); K.translate(ex, ey); K.scale(fs * sc, sc);
      const w = 27, tH = FW < 1 ? 14 : 17, bH = FW < 1 ? 12 : 14;
      const scl = new Path2D(); scl.moveTo(-w, 0);
      scl.bezierCurveTo(-w * 0.55, -tH * 1.33, w * 0.55, -tH * 1.33, w, 0); scl.bezierCurveTo(w * 0.55, bH * 1.33, -w * 0.55, bH * 1.33, -w, 0); scl.closePath();
      K.fillStyle = PAPER; K.fill(scl);
      K.save(); K.clip(scl);
      const ir = 12.5 * (1 - shock * 0.22) * (kid ? 1.1 : 1), ix = lx * 11 / fs * 0.9 + t * 3, iy = ly * 6.5 + 1;
      K.fillStyle = INK; K.beginPath(); K.arc(ix, iy, ir, 0, TAU); K.fill();
      K.fillStyle = PAPER; K.beginPath(); K.arc(ix - 4.5, iy - 4.5, 3.4, 0, TAU); K.fill();
      // lids
      const wk = s > 0 ? wink : 0, b = Math.max(blink, wk);
      const upOpen = -11.5 - br * 4.5 - shock * 7 + tilt * 1.5 + Math.max(0, -br) * 3;
      const loOpen = 14 - Math.max(0, smile - 0.45) * 12;
      const winky = wk > blink;
      const upY = mx(upOpen, winky ? -6 : loOpen - 1, b), loY = mx(loOpen, winky ? -6 : loOpen, b);
      const lid = new Path2D(); lid.moveTo(-w - 6, 0); lid.bezierCurveTo(-w * 0.55, upY * 1.33, w * 0.55, upY * 1.33, w + 6, 0); lid.lineTo(w + 6, -40); lid.lineTo(-w - 6, -40); lid.closePath();
      const low = new Path2D(); low.moveTo(-w - 6, 0); low.bezierCurveTo(-w * 0.55, loY * 1.33, w * 0.55, loY * 1.33, w + 6, 0); low.lineTo(w + 6, 40); low.lineTo(-w - 6, 40); low.closePath();
      K.fillStyle = SKIN; K.fill(lid); K.fill(low);
      K.restore();
      // lash line along the upper lid
      K.beginPath(); K.moveTo(-w - 1, 0.5); K.bezierCurveTo(-w * 0.55, upY * 1.33, w * 0.55, upY * 1.33, w + 1, 0.5);
      K.lineWidth = 4.6; K.lineCap = 'round'; K.strokeStyle = INK; K.stroke();
      if (L.lashes && b < 0.6) { K.lineWidth = 3.6; for (const [u, l, a] of [[0.72, 11, -0.5], [0.88, 12, -0.1], [1.0, 10, 0.3]]) { const px = s * w * u, py = upY * 1.33 * (1 - u * u) * 0.75 + 0.5; K.beginPath(); K.moveTo(px, py); K.lineTo(px + s * Math.cos(a) * l, py - Math.sin(a + 0.9) * l); K.stroke(); } }
      K.restore();
    }
    // brows
    for (const s of [-1, 1]) {
      const inY = -74 - br * 13 - tilt * 16 + Math.max(0, -br) * 8, outY = -76 - br * 11 + tilt * 5 - Math.max(0, -br) * 2;
      const a = [fx(s * 36 * FW), inY + fy], c = [fx(s * 82 * FW), mx(inY, outY, 0.5) - 12 + tilt * 6 + fy], b = [fx(s * 118 * FW), outY + fy + (FW < 1 ? 3 : 0)];
      K.fillStyle = mix(HCOL, INK, HCOL === L.hairHex && /^(platinum|white|blonde|grey)$/.test(L.hairColor) ? 0.35 : 0);
      K.fill(taper(new Path2D(), a, c, b, 17, 16, 10));
    }
    // glasses (drawn after the hair when a hairstyle is on)
    const drawGlasses = () => {
      const sq = L.glassesStyle === 'square', GC = L.glassesHex;
      const lens = eyes.map(E => { const p = new Path2D(); if (sq) p.roundRect(E.ex - 54 * E.fs, E.ey - 38, 108 * E.fs, 80, 16); else p.ellipse(E.ex, E.ey + 3, 50 * E.fs, 50, 0, 0, TAU); return p; });
      lens.forEach((p, i) => {
        K.save(); K.clip(p);
        K.fillStyle = 'rgba(246,245,241,0.12)'; K.fill(p);
        const E = eyes[i];
        K.translate(E.ex - 22 * E.fs, E.ey - 19); K.rotate(-42 * D2R);
        K.fillStyle = 'rgba(246,245,241,0.55)'; K.fillRect(-70, -7, 140, 12); K.fillRect(-70, 11, 140, 4.5);
        K.restore();
      });
      const GW = +L.glassesW > 0 ? +L.glassesW : 7; K.lineWidth = GW; K.strokeStyle = GC; K.lineCap = 'round';
      lens.forEach(p => K.stroke(p));
      const [EL, ER] = eyes;
      K.beginPath(); K.moveTo(EL.ex + 48 * EL.fs, EL.ey - 10); K.quadraticCurveTo((EL.ex + ER.ex) / 2, EL.ey - 24, ER.ex - 48 * ER.fs, ER.ey - 10); K.stroke();
      K.lineWidth = GW * 0.85;
      for (const E of eyes) {
        const edge = E.ex + E.s * (sq ? 54 : 50) * E.fs, earX = E.s * (166 * FW - 22 * Math.max(0, E.s * t));
        if (E.s * (earX - edge) > 2) { K.beginPath(); K.moveTo(edge, E.ey - 6); K.lineTo(earX, E.ey - 2); K.stroke(); }
      }
    };
    // hair front, or a knit beanie with a folded, ribbed cuff and a small accent tab
    const hx = t * 9, hy = R.nod * 4 - shock * 16;
    K.save(); K.translate(hx, hy);
    if (showFront && buzz) {
      K.scale(FW, 1); K.fillStyle = mix(HCOL, SKIN, 0.42); K.fill(HP.front);
    } else if (showFront) {
      K.scale(FW, 1);
      fillSh(K, HP.front, HCOL, HSH, -12 + t * 8, -9);
      K.save(); K.clip(HP.front); paintHairStrands(K, HP.H, HLT); K.restore();
      if (HP.H.part !== undefined) { K.beginPath(); K.moveTo(HP.H.part, -206); K.quadraticCurveTo(HP.H.part * 0.9, -236, HP.H.part * 0.7, -252); K.lineWidth = 4; K.strokeStyle = HSH; K.stroke(); }
      sil.push([HP.front, R.head.translate(hx, hy).scale(FW, 1)]);
    } else if (BEANIE) {
      const crown = new Path2D();
      crown.moveTo(-171, -176); crown.bezierCurveTo(-180, -238, -118, -286, 0, -288); crown.bezierCurveTo(118, -286, 180, -238, 171, -176); crown.closePath();
      K.fillStyle = L.beanieHex; K.fill(crown);
      K.save(); K.clip(crown);
      K.fillStyle = C.crownLt; K.beginPath(); K.moveTo(-200, -300); K.lineTo(-40 + t * 30, -300); K.bezierCurveTo(-70 + t * 30, -250, -104 + t * 20, -210, -110 + t * 20, -170); K.lineTo(-200, -170); K.closePath(); K.fill();
      K.restore();
      const cuff = new Path2D();
      cuff.moveTo(-183, -188); cuff.quadraticCurveTo(-189, -154, -181, -126); cuff.quadraticCurveTo(0, -112, 181, -126);
      cuff.quadraticCurveTo(189, -154, 183, -188); cuff.quadraticCurveTo(0, -206, -183, -188); cuff.closePath();
      K.fillStyle = C.cuff; K.fill(cuff);
      K.save(); K.clip(cuff);
      K.strokeStyle = 'rgba(17,17,17,0.55)'; K.lineWidth = 3.2; K.beginPath();
      for (let x = -190; x <= 190; x += 12) { const xx = x + ((t * 40) % 12); K.moveTo(xx, -210); K.lineTo(xx, -100); }
      K.stroke();
      K.fillStyle = 'rgba(17,17,17,0.35)'; K.beginPath(); K.moveTo(-200, -130); K.quadraticCurveTo(0, -112, 200, -130); K.lineTo(200, -100); K.lineTo(-200, -100); K.fill();
      K.restore();
      K.beginPath(); K.moveTo(-181, -188); K.quadraticCurveTo(0, -206, 181, -188); K.lineWidth = 2.5; K.strokeStyle = 'rgba(246,245,241,0.14)'; K.stroke();
      const tx = fx(-104, 14) - hx, tf = ffs(-104, 14);
      if (L.beanieTab) {
        K.fillStyle = RED; K.beginPath(); K.roundRect(tx - 17 * tf, -174, 34 * tf, 21, 3); K.fill();
        K.fillStyle = 'rgba(246,245,241,0.7)'; K.fillRect(tx - 10 * tf, -165, 20 * tf, 2.5);
      }
      sil.push([crown, R.head.translate(hx, hy)], [cuff, R.head.translate(hx, hy)]);
    }
    K.restore();
    if (L.glasses) drawGlasses();
    // sweat
    const sw = cl(st.sweat || 0);
    if (sw > 0.05) {
      const tt = st.t || 0;
      [[-150, -92, 1], [156, -62, 0.8]].forEach(([x, y, k], i) => {
        const a = cl((sw - i * 0.3) / 0.5); if (a <= 0) return;
        const slide = ((tt * 0.6 + i * 0.37) % 1) * 18;
        K.save(); K.translate(fx(x, 8), y + fy + slide); K.scale(a * k, a * k);
        const d = new Path2D(); d.moveTo(0, -20); d.bezierCurveTo(7, -8, 13, 0, 13, 7); d.arc(0, 7, 13, 0, PI); d.bezierCurveTo(-13, 0, -7, -8, 0, -20); d.closePath();
        K.fillStyle = PAPER; K.fill(d); K.lineWidth = 3.4; K.strokeStyle = INK; K.stroke(d);
        K.fillStyle = C.teeSh; K.beginPath(); K.ellipse(4, 9, 4, 6, 0, 0, TAU); K.fill();
        K.restore();
      });
    }
  }

  function armPaths(A) {
    const u2 = nrm(sub(A.W, A.E));
    const sleeve = bentTube(new Path2D(), A.S, A.E, A.Rl, 54, 45, 42);
    const fore = capsule(new Path2D(), sub(A.Rl, mul(u2, 12)), A.W, 29, 24);
    const roll = new Path2D(), n = perp(u2), c = add(A.Rl, mul(u2, 1)), hw = 49, ht = 13;
    const q = (a, b) => add(c, add(mul(u2, a), mul(n, b)));
    const pts = [q(-ht, -hw), q(ht, -hw + 3), q(ht, hw - 3), q(-ht, hw)];
    smooth(roll, [pts[0], q(-ht - 2, 0), pts[3], q(0, hw + 2), pts[2], q(ht + 2, 0), pts[1], q(0, -hw - 2)], true, 0.9);
    return { sleeve, fore, roll };
  }
  function handMatrix(A) { return M0().translate(A.W[0], A.W[1]).rotate(A.fa / D2R - 90).scale(A.hsx * HS, HS); }

  function paintArm(K, R, M, A, bodyClip, sil) {
    const AM = M.multiply(R.armM[A.side]), g = armPaths(A), lx = A.sgn * -1;
    const HM = handMatrix(A);
    const handSil = new Path2D(); handSil.addPath(capsule(new Path2D(), [0, 20], [0, 96], 36, 26), HM);
    sil.push([g.sleeve, R.armM[A.side]], [g.fore, R.armM[A.side]], [handSil, R.armM[A.side]]);
    // cast shadow of the whole arm onto the body (screen-space offset), clipped to the body
    K.save();
    K.setTransform(M); K.clip(bodyClip);
    K.setTransform(M.translate(9, 12).multiply(R.armM[A.side]));
    K.fillStyle = 'rgba(17,17,17,0.16)'; K.fill(g.sleeve); K.fill(g.fore); K.fill(handSil);
    K.setTransform(AM); K.lineWidth = 7; K.strokeStyle = 'rgba(17,17,17,0.2)'; K.stroke(g.sleeve);
    K.restore();
    K.setTransform(AM);
    // bare forearm, rolled cuff, sleeve
    fillSh(K, g.sleeve, SHIRT, C.shirtSh, 12 * lx, -9);
    fillSh(K, g.fore, SKIN, C.skinSh, 8 * lx, -6);
    fillSh(K, g.roll, C.shirtLt, mix(C.shirtLt, INK, 0.2), 5 * lx, -6);
    // hand
    K.setTransform(AM.multiply(HM));
    drawHand(K, A.hand, HS);
    if (window.STA_DEBUG) { K.setTransform(AM); K.lineWidth = 2; K.strokeStyle = 'blue'; K.stroke(g.sleeve); K.strokeStyle = 'red'; K.stroke(g.fore); K.strokeStyle = 'lime'; K.stroke(g.roll);
      K.fillStyle = 'magenta'; for (const q of [A.S, A.E, A.W, A.Rl]) { K.beginPath(); K.arc(q[0], q[1], 5, 0, TAU); K.fill(); } }
  }

  function paint(K, R, M) {
    const sil = [];
    K.setTransform(M);
    K.beginPath(); K.rect(-4000, -6000, 8000, 6000); K.clip();          // the bust is cropped flat at the bottom
    paintTorso(K, R, M, sil);
    paintHead(K, R, M, sil);
    const bodyClip = new Path2D();
    for (const [p, m] of sil) bodyClip.addPath(p, m);
    // arms: the one reaching toward the face goes last
    const order = ['L', 'R'].sort((a, b) => (gestureDip(R.st, a) + R.arms[a].e * 0.01) - (gestureDip(R.st, b) + R.arms[b].e * 0.01));
    for (const s of order) paintArm(K, R, M, R.arms[s], bodyClip, sil);
    return sil;
  }
  function paintShadow(T, R, M, sil) {
    T.setTransform(M);
    T.beginPath(); T.rect(-4000, -6000, 8000, 6000); T.clip();
    const all = new Path2D();
    for (const [p, m] of sil) all.addPath(p, m);
    T.setTransform(M.translate(18, 12));
    T.fillStyle = 'rgba(0,0,0,0.26)'; T.fill(all);
  }

  function draw(T, K, st) {
    const R = rig(st);
    const bK = K.getTransform(), bT = T.getTransform();
    K.save(); const sil = paint(K, R, bK.multiply(R.root)); K.restore();
    T.save(); paintShadow(T, R, bT.multiply(R.root), sil); T.restore();
  }
  // anchors(state, t?): accepts the state your guy(t) returns (raw act()/mood() output) or an already normalised guyState(...).
  // A raw state is normalised here exactly like the engine does before drawing (breathing bob, idle head motion, lip sync),
  // so the points match the drawn presenter. t = state.t (act() sets it) or the second argument.
  function anchors(st, t) {
    if (st && !st._norm && typeof window.guyState === 'function') {
      const tt = t ?? st.t;
      if (tt == null) console.error('PRESENTER.anchors(state): pass the time, anchors(state, t), or a state from act() (which carries t)');
      else st = window.guyState(tt, Object.assign({ t: tt }, st));
    }
    const R = rig(st);
    const pt = (m, x, y) => { const q = R.root.multiply(m).transformPoint(new DOMPoint(x, y)); return { x: q.x, y: q.y }; };
    const hand = s => {
      const A = R.arms[s]; if (A.name === 'down' || A.p <= 0.02) return null;
      const c = add(A.W, mul(dir(A.fa), 62 * HS)); return pt(R.armM[s], c[0], c[1]);
    };
    return { head: pt(R.head, 0, -20), top: pt(R.head, 0, -290), mouth: pt(R.head, 0, 124), handL: hand('L'), handR: hand('R') };
  }
  const api = { ready: Promise.resolve(true), draw, anchors, rig, look: normLook, DEFAULT: LOOK_DEFAULT, SKINS, HAIRCOLS, HAIRSTYLES: Object.keys(HAIRSTYLES).concat(['bald']) };
  window.PRESENTER = api; window.GUY3D = api;
})();
