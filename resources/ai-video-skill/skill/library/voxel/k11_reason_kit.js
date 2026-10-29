// LIBRARY REFERENCE (k11_reason_kit.js): a real beat from the creator's coffee-shop marketing reel, de-branded. Reference code: it was
// written for that reel's plan (hard-coded fallback times, its own station, 'CUSTOMER'-era words), so adapt cues before reuse.
// In a project: copy to scenes/, point a beat at it, replace ctx.wordAt fallbacks with your words. See library/voxel/INDEX.md.
// k11_reason extra props: the REASON card (clock + door = TIME SAVED) and a lock-on reticle.
import * as THREE from 'three';
import * as L from '/engine/kits/base.js';
import * as KT from '/engine/kits/shopfront.js';

const C = L.C, K = KT.K;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const backOut = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
const pop = (k, s = 2.4) => (k <= 0 ? 0.001 : k >= 1 ? 1 : Math.max(0.001, backOut(k, s)));

function canvasTex(w, h) {
  const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { g: c.getContext('2d'), t, W: c.width, H: c.height };
}
function decal(w, h, draw, ppu = 260) {
  const T = canvasTex(w * ppu, h * ppu); draw(T.g, T.W, T.H); T.t.needsUpdate = true;
  const m = L.mat('#ffffff', { map: T.t, transparent: true, felt: 0, depthWrite: false });
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); p.renderOrder = 2; return p;
}

// big paper card. centre origin, faces +Z.
// set({ pop, parts: [clock, plus, door, eq, saved] each 0..1 })
export function makeReasonCard(ctx, { w = 3.4, h = 2.3, seed = 5 } = {}) {
  const group = new THREE.Group(), inner = new THREE.Group(); group.add(inner);
  const ppu = 300, T = canvasTex(w * ppu, h * ppu);
  {
    const g = T.g, W = T.W, H = T.H;
    L.paperFill(g, W, H, C.paper, seed, 0.8);
    g.fillStyle = K.green; g.fillRect(0, 0, W, H * 0.2);
    L.inkText(g, 'A CLEAR', W / 2, H * 0.105, { size: H * 0.15, color: K.cream, maxW: W * 0.8, seed, wear: 0.08 });
    L.inkText(g, 'REASON', W / 2, H * 0.43, { size: H * 0.3, color: C.ink, maxW: W * 0.88, seed: seed + 1, wear: 0.05 });
    g.strokeStyle = 'rgba(42,33,28,0.25)'; g.lineWidth = H * 0.008; g.setLineDash([H * 0.03, H * 0.02]);
    g.beginPath(); g.moveTo(W * 0.06, H * 0.6); g.lineTo(W * 0.94, H * 0.6); g.stroke(); g.setLineDash([]);
  }
  T.t.needsUpdate = true;
  const sm = L.mat(C.paper, { felt: 0.5 }), fm = L.mat('#ffffff', { map: T.t, felt: 0.35 }), bm = L.mat('#d9cdb4', { felt: 0.6 });
  const slab = new THREE.Mesh(L.rbox(w, h, 0.08, 0), [sm, sm, sm, sm, fm, bm]); slab.castShadow = true; slab.receiveShadow = true; inner.add(slab);
  // pin
  { const pm = L.mat(K.green, { rough: 0.4, felt: 0.2 }); const p = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), pm); p.position.set(0, h / 2 - 0.12, 0.12); inner.add(p); }
  // bottom row parts (y = row centre)
  const ry = -h * 0.28, z = 0.05;
  const mk = (o, x, y = ry) => { const g = new THREE.Group(); g.position.set(x, y, z); g.add(o); inner.add(g); return g; };
  const clock = mk(KT.makeIconSticker(ctx, 'clock', { size: 0.62, bg: C.blue, color: K.cream }), -1.25);
  const plus = mk(decal(0.32, 0.32, (g, W, H) => L.inkText(g, '+', W / 2, H / 2, { size: H * 0.95, color: C.ink, wear: 0 })), -0.83);
  const door = mk(KT.makeIconSticker(ctx, 'door', { size: 0.62, bg: K.green, color: K.cream }), -0.4);
  const eq = mk(decal(0.32, 0.32, (g, W, H) => L.inkText(g, '=', W / 2, H / 2, { size: H * 0.95, color: C.ink, wear: 0 })), 0.03);
  const saved = mk(decal(1.3, 0.62, (g, W, H) => {
    g.fillStyle = C.no; const r = H * 0.14; g.beginPath(); g.roundRect(W * 0.02, H * 0.04, W * 0.96, H * 0.92, r); g.fill();
    L.inkText(g, 'TIME', W / 2, H * 0.32, { size: H * 0.36, color: K.cream, maxW: W * 0.86, wear: 0.15 });
    L.inkText(g, 'SAVED', W / 2, H * 0.71, { size: H * 0.36, color: K.cream, maxW: W * 0.86, wear: 0.15, seed: 3 });
  }), 0.92);
  saved.rotation.z = 0.06;
  const parts = [clock, plus, door, eq, saved];
  const c = {
    group, inner, parts,
    set({ pop: p = 1, parts: ks = [1, 1, 1, 1, 1] } = {}) {
      const k = clamp(p); inner.visible = k > 0; inner.scale.setScalar(pop(k, 2.2));
      parts.forEach((g, i) => { const q = clamp(ks[i] ?? 1); g.visible = q > 0; g.scale.setScalar(i === 4 ? Math.max(0.001, 1.9 - 0.9 * (1 - Math.pow(1 - q, 3)) - 0.12 * Math.sin(Math.PI * clamp((q - 0.5) * 2))) : pop(q, 3)); });
      return c;
    },
  };
  return c.set();
}

// four L corners around a w x h box (centre origin, plane facing +Z). set({ k (0 = wide/hidden .. 1 = locked), lock 0..1 (white -> green) })
export function makeReticle(ctx, { w = 2.8, h = 3.0, arm = 0.6, th = 0.12 } = {}) {
  const group = new THREE.Group();
  const m = L.mat('#ffffff', { emissive: '#ffffff', ei: 0.35, felt: 0.2 });
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const g = new THREE.Group(); group.add(g);
    L.B(arm, th, th, m, { r: 0.03, x: -sx * (arm / 2 - th / 2), parent: g });
    L.B(th, arm, th, m, { r: 0.03, y: -sy * (arm / 2 - th / 2), parent: g });
    corners.push({ g, sx, sy });
  }
  const white = new THREE.Color('#ffffff'), green = new THREE.Color(K.green ?? C.yes), tmp = new THREE.Color();
  const c = {
    group,
    set({ k = 1, lock = 0 } = {}) {
      group.visible = k > 0.001;
      const s = 2.2 - 1.2 * backOut(clamp(k), 1.8);
      for (const q of corners) q.g.position.set(q.sx * w / 2 * s, q.sy * h / 2 * s, 0);
      tmp.copy(white).lerp(green, clamp(lock)); m.color.copy(tmp); m.emissive.copy(tmp);
      return c;
    },
  };
  return c.set();
}
