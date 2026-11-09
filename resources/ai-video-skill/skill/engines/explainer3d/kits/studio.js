// STUDIO kit (dark product-film studio, units = cm, +Y up). API: guides/styles/explainer3d.md (Kit: studio).
// Builders only CREATE objects (call them in init, add `.group` to ctx.scene). Everything they return keeps state
// (charges, poses, screen look...), so a scene must set every parameter it uses EVERY frame (pure function of t).
// No Math.random / Date anywhere: deterministic rng only.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { P } from '../core/palette.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => k * k * (3 - 2 * k);
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const toV3 = (a) => (a && a.isVector3 ? a.clone() : Array.isArray(a) ? V(a[0], a[1], a[2]) : V());
export function mixHex(a, b, k) { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), clamp(k)).getHexString(); }
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function bezier(a, c, b, k) { a = toV3(a); c = toV3(c); b = toV3(b); const u = 1 - k; return a.multiplyScalar(u * u).add(c.multiplyScalar(2 * u * k)).add(b.multiplyScalar(k * k)); }
const rgba = (hex, a) => { const c = new THREE.Color(hex); return `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${a})`; };
const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

// ---------- caches / small helpers ----------
const GEO = new Map();
const geo = (key, make) => { let g = GEO.get(key); if (!g) { g = make(); GEO.set(key, g); } return g; };
function M(g, m, { cast = false, recv = true } = {}) { const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = recv; return o; }
function canvasTex(w, h, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return { c, g: c.getContext('2d'), t };
}
function rrShape(w, h, r) {
  const s = new THREE.Shape(); const x = w / 2, y = h / 2; r = Math.min(r, x, y);
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
function rrHole(w, h, r) { const s = rrShape(w, h, r); const p = new THREE.Path(); p.setFromPoints(s.getPoints(16)); return p; }
// flat rounded rect lying in XZ (facing +Y), uv 0..1, canvas top = -Z
function rrPlaneXZ(w, h, r, seg = 12) {
  const g = new THREE.ShapeGeometry(rrShape(w, h, r), seg);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  g.rotateX(-Math.PI / 2); return g;
}
// rounded slab lying flat: plan w x d (X,Z), thickness th along Y, from y=0 to y=th
function slabXZ(w, d, r, th, bev = 0.02, curve = 14) {
  const b = Math.min(bev, th / 2 - 1e-3);
  const e = new THREE.ExtrudeGeometry(rrShape(w - 2 * b, d - 2 * b, Math.max(0.01, r - b)), { depth: Math.max(0.001, th - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: curve });
  e.rotateX(-Math.PI / 2); e.translate(0, b, 0); return e;
}

// ---------- studio reflection env (lib materials only; scene.environment untouched) ----------
let ENV = null;
export function libEnv(ctx) {
  if (ENV) return ENV;
  if (!ctx || !ctx.renderer) return null;
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(0.03,0.035,0.045), vec3(0.20,0.22,0.27), smoothstep(-0.3, 0.9, h)); gl_FragColor = vec4(c, 1.0); }' })));
  const panel = (w, h, pos, k, col = '#ffffff') => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(9, 5, [0, 15, 3], 4.0);                   // big top softbox
  panel(2.2, 12, [-13, 4, 6], 6.5);               // key strip, left front
  panel(1.4, 12, [12, 5, -7], 5.5, '#cfe0ff');    // cool rim strip, right back
  panel(16, 1.4, [0, 2, 15], 2.0, '#fff1de');     // warm low strip, front
  panel(1.0, 8, [8, 9, 10], 3.0);                 // small kicker
  const pm = new THREE.PMREMGenerator(ctx.renderer);
  ENV = pm.fromScene(s, 0.02).texture; pm.dispose();
  return ENV;
}

// Glass that keeps its reflections when transparent: alpha is raised by the reflected light, so a nearly clear
// pane still shows bright, crisp highlights (cheap stand-in for transmission).
export function glassify(mat, boost = 1, maxOut = 1.6) {
  mat.transparent = true; mat.depthWrite = false;
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      `outgoingLight = min(outgoingLight, vec3(${maxOut.toFixed(3)}));
       float lum_ = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b) * ${boost.toFixed(3)};
       float a_ = clamp(diffuseColor.a + lum_, 0.0, 1.0);
       gl_FragColor = vec4(outgoingLight / max(a_, 1e-3), a_);`);
  };
  mat.customProgramCacheKey = () => 'glassify' + boost + '|' + maxOut;
  return mat;
}
// cap a lit material's output (sun glints on mirror-smooth surfaces would otherwise bloom into a giant blob)
export function capGlare(mat, maxOut = 2.0) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => { prev && prev.call(mat, sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `outgoingLight = min(outgoingLight, vec3(${maxOut.toFixed(2)}));\n#include <opaque_fragment>`); };
  const k = mat.customProgramCacheKey.bind(mat); mat.customProgramCacheKey = () => k() + '|cap' + maxOut;
  return mat;
}
// lit material whose instance colour also glows (instanced bars)
function glowStd(o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.1, ...o });
  m.userData.emis = { value: 1.0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uEmis = m.userData.emis;
    sh.fragmentShader = 'uniform float uEmis;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance += vColor.rgb * uEmis;\n#endif');
  };
  m.customProgramCacheKey = () => 'glowStd';
  return m;
}
const addMat = (color, o = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, ...o });

let RADIAL = null;
function radialTex() {
  if (RADIAL) return RADIAL;
  const { g, t } = canvasTex(128, 128, false);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); RADIAL = t; return t;
}

let BLOB = null;
function blobTex() {
  if (BLOB) return BLOB;
  const { g, t } = canvasTex(128, 128, false);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, '#9a9a9a'); gr.addColorStop(0.75, '#2a2a2a'); gr.addColorStop(1, '#000000');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); BLOB = t; return t;
}

// fade(obj, a): multiplies every material's opacity under obj (originals cached on first call); hides at 0.
export function fade(obj, a) {
  obj.visible = a > 0.001;
  obj.traverse((o) => {
    if (!o.material || o.userData.noFade) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.userData.op0 === undefined) { m.userData.op0 = m.opacity; m.userData.tr0 = m.transparent; }
      m.opacity = m.userData.op0 * a;
      m.transparent = m.userData.tr0 || a < 0.999;
      if (m.uniforms && m.uniforms.uAlpha && m.userData.ua0 === undefined) m.userData.ua0 = m.uniforms.uAlpha.value;
      if (m.uniforms && m.uniforms.uAlpha) m.uniforms.uAlpha.value = m.userData.ua0 * a;
    }
  });
}

// =====================================================================================================
// 2. sensor grid
// =====================================================================================================
const WIRE_GEO_X = () => geo('wireX', () => { const c = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true); c.rotateZ(Math.PI / 2); return c; });
export function makeGrid(ctx, { cols = 9, rows = 18, w = 6.4, h = 13.9, wire = 0.028, gap = 0.07, orb = 0.085, barH = 2.4, sheet = true, dipTint = true, tag = 'grid' } = {}) {
  const group = new THREE.Group(); group.name = tag;
  const env = libEnv(ctx);
  const xs = Array.from({ length: cols }, (_, j) => (cols === 1 ? 0 : (j / (cols - 1) - 0.5) * w));
  const zs = Array.from({ length: rows }, (_, i) => (rows === 1 ? 0 : (i / (rows - 1) - 0.5) * h));
  const ext = 0.35;                                  // wires run a little past the last crossing
  const rowY = gap / 2, colY = -gap / 2;
  const wireMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true });
  const rowsM = new THREE.InstancedMesh(WIRE_GEO_X(), wireMat, rows); rowsM.frustumCulled = false;
  const colsM = new THREE.InstancedMesh(WIRE_GEO_X(), wireMat.clone(), cols); colsM.frustumCulled = false;
  group.add(rowsM, colsM);
  // dielectric sheet between rows and columns
  let sheetM = null;
  if (sheet) {
    const sm = glassify(new THREE.MeshPhysicalMaterial({ color: '#5d86d8', roughness: 0.25, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2, envMap: env, envMapIntensity: 0.6, opacity: 0.07 }), 0.6, 0.6);
    sheetM = M(slabXZ(w + 2 * ext + 0.3, h + 2 * ext + 0.3, 0.7, 0.02, 0.008), sm); sheetM.position.y = -0.01; sheetM.renderOrder = 1; group.add(sheetM);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo('gridEdge' + w + h, () => rrPlaneXZ(w + 2 * ext + 0.3, h + 2 * ext + 0.3, 0.7, 8)), 30),
      new THREE.LineBasicMaterial({ color: hdr(P.wireCol, 0.5), transparent: true, opacity: 0.6, toneMapped: false }));
    edge.position.y = 0.012; sheetM.add(edge);
  }
  // crossings: orb + soft glow disc (instanced)
  const N = rows * cols;
  const orbM = new THREE.InstancedMesh(geo('orb', () => new THREE.SphereGeometry(1, 14, 10)), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true }), N);
  const glowM = new THREE.InstancedMesh(geo('glowDisc', () => { const p = new THREE.PlaneGeometry(1, 1); p.rotateX(-Math.PI / 2); return p; }),
    addMat('#ffffff', { map: radialTex() }), N);
  const barM = new THREE.InstancedMesh(geo('bar', () => { const b = new RoundedBoxGeometry(1, 1, 1, 2, 0.12); b.translate(0, 0.5, 0); return b; }), glowStd({ envMap: env, envMapIntensity: 0.7 }), N);
  for (const m of [orbM, glowM, barM]) m.frustumCulled = false;
  glowM.renderOrder = 2;
  group.add(barM, orbM, glowM);
  const charge = new Float32Array(N).fill(1);
  const st = { reveal: 1, scan: -1, scanAxis: 'row', scanW: 1.2, bars: 0, alpha: 1, orbs: 1, wires: 1, pulse: null };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qCol = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 2), s3 = V(), p3 = V(), c = new THREE.Color();
  const cCharge = new THREE.Color(P.charge), cHot = new THREE.Color(P.chargeHot), cDip = new THREE.Color(P.dip), cRow = new THREE.Color(P.wireRow), cCol = new THREE.Color(P.wireCol);
  const idx = (i, j) => i * cols + j;
  function scanHi(i, j) {
    if (st.scan < 0) return 0;
    const n = st.scanAxis === 'row' ? rows : cols, pos = st.scan * (n - 1 + 2 * st.scanW) - st.scanW, me = st.scanAxis === 'row' ? i : j;
    return Math.exp(-Math.pow((me - pos) / (st.scanW * 0.6), 2));
  }
  function refresh() {
    const A = st.alpha;
    group.visible = A > 0.001;
    if (!group.visible) return;
    // wires: rows draw on first (0..0.55 of reveal), then columns (0.45..1)
    for (let i = 0; i < rows; i++) {
      const d = clamp((st.reveal - (i / rows) * 0.25) / 0.3), len = (w + 2 * ext) * easeOut(d);
      const hi = st.scanAxis === 'row' ? scanHi(i, 0) : 0;
      s3.set(Math.max(1e-4, len), wire * (1 + hi * 0.8), wire * (1 + hi * 0.8)); p3.set(-w / 2 - ext + len / 2, rowY, zs[i]);
      rowsM.setMatrixAt(i, m4.compose(p3, q.identity(), d > 0 ? s3 : s3.set(1e-4, 1e-4, 1e-4)));
      rowsM.setColorAt(i, c.copy(cRow).multiplyScalar((0.55 + 1.6 * hi + 0.5 * (1 - d) * d * 4) * st.wires));
    }
    for (let j = 0; j < cols; j++) {
      const d = clamp((st.reveal - 0.5 - (j / cols) * 0.2) / 0.3), len = (h + 2 * ext) * easeOut(d);
      const hi = st.scanAxis === 'col' ? scanHi(0, j) : 0;
      s3.set(Math.max(1e-4, len), wire * (1 + hi * 0.8), wire * (1 + hi * 0.8)); p3.set(xs[j], colY, -h / 2 - ext + len / 2);
      colsM.setMatrixAt(j, m4.compose(p3, qCol, d > 0 ? s3 : s3.set(1e-4, 1e-4, 1e-4)));
      colsM.setColorAt(j, c.copy(cCol).multiplyScalar((0.4 + 1.4 * hi + 0.5 * (1 - d) * d * 4) * st.wires));
    }
    wireMat.opacity = A; colsM.material.opacity = A;
    rowsM.instanceMatrix.needsUpdate = colsM.instanceMatrix.needsUpdate = true;
    rowsM.instanceColor.needsUpdate = colsM.instanceColor.needsUpdate = true;
    // crossings appear once both of their wires have drawn past them
    const orbOn = st.orbs * clamp((st.reveal - 0.85) / 0.15);
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const k = idx(i, j), v = charge[k], hi = scanHi(i, j);
      const pu = st.pulse ? st.pulse(i, j, xs[j], zs[i]) || 0 : 0;
      const tint = dipTint ? clamp((0.9 - v) / 0.55) * 0.9 : 0;
      c.copy(cCharge).lerp(cHot, clamp(hi * 0.8 + pu * 0.6)).lerp(cDip, tint);
      const bh = Math.max(0.02, st.bars * barH * Math.max(0, v));
      const r = orb * (0.25 + 0.75 * clamp(v, 0, 1.3)) * (1 + 0.5 * hi + 0.4 * pu) * orbOn;
      p3.set(xs[j], st.bars > 0.001 ? bh + r * 0.6 : 0, zs[i]);
      orbM.setMatrixAt(k, m4.compose(p3, q.identity(), s3.setScalar(Math.max(1e-4, r))));
      orbM.setColorAt(k, c.clone().multiplyScalar((0.6 + 1.8 * clamp(v, 0, 1.3) + 1.5 * hi + pu) * A));
      const gr = Math.max(1e-4, r * 7 * (1 - 0.5 * st.bars));
      glowM.setMatrixAt(k, m4.compose(p3.setY(p3.y - r * 0.2), q, s3.set(gr, 1, gr)));
      glowM.setColorAt(k, c.clone().multiplyScalar(0.55 * clamp(v, 0, 1.3) * (1 + hi + pu) * A * orbOn));
      const bw = Math.min(w / Math.max(1, cols - 1), h / Math.max(1, rows - 1)) * 0.62;
      barM.setMatrixAt(k, m4.compose(p3.set(xs[j], 0, zs[i]), q, st.bars > 0.001 ? s3.set(bw, bh, bw) : s3.setScalar(1e-4)));
      barM.setColorAt(k, c.copy(cCharge).lerp(cHot, 0.15 + 0.4 * hi).lerp(cDip, tint).multiplyScalar(0.55 + 0.25 * clamp(v)));
    }
    for (const m of [orbM, glowM, barM]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    orbM.material.opacity = A; barM.material.opacity = A; barM.material.transparent = A < 0.999;
    barM.visible = st.bars > 0.001; barM.material.userData.emis.value = 0.55;
    if (sheetM) { sheetM.material.opacity = 0.07 * A; sheetM.visible = A > 0.01; sheetM.children[0].material.opacity = 0.6 * A * clamp(st.reveal * 3); }
  }
  const api = {
    group, rows, cols, w, h, xs, zs, parts: { rows: rowsM, cols: colsM, orbs: orbM, glows: glowM, bars: barM, sheet: sheetM },
    local: (i, j) => V(xs[j], 0, zs[i]),
    pos(i, j, out = V()) { group.updateWorldMatrix(true, false); const bh = st.bars > 0.001 ? Math.max(0.02, st.bars * barH * charge[idx(i, j)]) : 0; return out.set(xs[j], bh, zs[i]).applyMatrix4(group.matrixWorld); },
    toLocal(world) { group.updateWorldMatrix(true, false); return group.worldToLocal(toV3(world)); },
    nearest(x, z) { const j = Math.round(clamp((x / w + 0.5) * (cols - 1), 0, cols - 1)); const i = Math.round(clamp((z / h + 0.5) * (rows - 1), 0, rows - 1)); return [i, j]; },
    charge: (i, j) => charge[idx(i, j)],
    setCharge(i, j, v) { if (i >= 0 && i < rows && j >= 0 && j < cols) charge[idx(i, j)] = v; refresh(); return api; },
    setChargeFn(fn) { for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) charge[idx(i, j)] = fn(i, j, xs[j], zs[i]); refresh(); return api; },
    // dips: [{x, z, r = 1.1, depth = 0.7}] in grid-local cm (use grid.toLocal(fingerTipWorld)); base = full charge
    setDips(list, base = 1) {
      return api.setChargeFn((i, j, x, z) => { let v = base; for (const d of list) { const r = d.r ?? 1.1, dd = (d.depth ?? 0.7); v -= dd * Math.exp(-((x - d.x) ** 2 + (z - d.z) ** 2) / (r * r)); } return Math.max(0, v); });
    },
    reset() { charge.fill(1); Object.assign(st, { reveal: 1, scan: -1, bars: 0, alpha: 1, orbs: 1, wires: 1, pulse: null }); refresh(); return api; },
    reveal(k) { st.reveal = k; refresh(); return api; },
    scan(k, { axis = 'row', width = 1.2 } = {}) { st.scan = k; st.scanAxis = axis; st.scanW = width; refresh(); return api; },
    bars(k) { st.bars = k; refresh(); return api; },
    alpha(a) { st.alpha = a; refresh(); return api; },
    orbs(k) { st.orbs = k; refresh(); return api; },
    wires(k) { st.wires = k; refresh(); return api; },
    pulse(fn) { st.pulse = fn; refresh(); return api; },   // fn(i,j,x,z) -> 0..1 extra flash per crossing (null = off)
    set(o = {}) { Object.assign(st, o); if (o.charges) api.setChargeFn(o.charges); else refresh(); return api; },
    refresh,
  };
  refresh();
  return api;
}

// =====================================================================================================
// 1. phone
// =====================================================================================================
const PH = { w: 7.2, l: 15, t: 0.8, r: 1.05 };
const SCR = { w: 6.62, h: 14.36, r: 0.86 };
let BOARD = null;
function boardTex() {
  if (BOARD) return BOARD;
  const { g, t } = canvasTex(512, 1024); const R = rng(42);
  g.fillStyle = '#121418'; g.fillRect(0, 0, 512, 1024);
  g.fillStyle = '#1d2026'; g.beginPath(); g.roundRect(70, 330, 372, 620, 26); g.fill();            // battery
  g.strokeStyle = '#2a2e36'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#16191e'; g.beginPath(); g.roundRect(40, 40, 432, 260, 18); g.fill();               // logic board
  for (let n = 0; n < 26; n++) { const x = 60 + R() * 380, y = 60 + R() * 220, w = 14 + R() * 60, h = 10 + R() * 44; g.fillStyle = ['#23272e', '#2c3038', '#1a1d22', '#3a3326'][n % 4]; g.fillRect(x, y, Math.min(w, 470 - x), Math.min(h, 290 - y)); }
  g.strokeStyle = 'rgba(160,130,80,0.25)'; g.lineWidth = 1.2;
  for (let n = 0; n < 40; n++) { g.beginPath(); const y = 60 + R() * 220; g.moveTo(50, y); g.lineTo(460, y + (R() - 0.5) * 30); g.stroke(); }
  BOARD = t; return t;
}

export function makePhone(ctx, { look = 'off', grid: gridOpts = {}, shadow = true } = {}) {
  const env = libEnv(ctx);
  const group = new THREE.Group(); group.name = 'phone';
  const body = new THREE.Group(), display = new THREE.Group(), sensor = new THREE.Group(), glass = new THREE.Group();
  group.add(body, display, sensor, glass);
  // --- body: brushed metal frame band, frosted back glass, camera bump, interior tray, buttons
  const metal = capGlare(new THREE.MeshPhysicalMaterial({ color: P.phoneFrame, metalness: 1, roughness: 0.27, envMap: env, envMapIntensity: 1.25, clearcoat: 0.4, clearcoatRoughness: 0.2 }), 2.2);
  const frameShape = rrShape(PH.w - 0.08, PH.l - 0.08, PH.r - 0.04); frameShape.holes.push(rrHole(PH.w - 0.5, PH.l - 0.5, PH.r - 0.25));
  const frameG = geo('ph-frame', () => { const e = new THREE.ExtrudeGeometry(frameShape, { depth: PH.t - 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 4, curveSegments: 18 }); e.rotateX(-Math.PI / 2); e.translate(0, -PH.t / 2 + 0.04, 0); return e; });
  body.add(M(frameG, metal, { cast: shadow }));
  const back = new THREE.MeshPhysicalMaterial({ color: '#2a2e36', roughness: 0.42, metalness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.35, envMap: env, envMapIntensity: 0.8 });
  const backM = M(geo('ph-back', () => slabXZ(PH.w - 0.2, PH.l - 0.2, PH.r - 0.1, 0.1, 0.03)), back, { cast: shadow }); backM.position.y = -PH.t / 2 + 0.005; body.add(backM);
  const tray = M(geo('ph-tray', () => rrPlaneXZ(PH.w - 0.44, PH.l - 0.44, PH.r - 0.22)), new THREE.MeshStandardMaterial({ map: boardTex(), roughness: 0.6, metalness: 0.3, envMap: env, envMapIntensity: 0.4 }));
  tray.position.y = 0.17; body.add(tray);
  // camera bump (back, top-left when looking at the screen)
  const bump = new THREE.Group(); bump.position.set(-PH.w / 2 + 2.0, -PH.t / 2 - 0.005, -PH.l / 2 + 2.0); body.add(bump);
  const bumpG = geo('ph-bump', () => { const g = slabXZ(3.0, 3.0, 0.75, 0.16, 0.05); g.rotateX(Math.PI); return g; });
  bump.add(M(bumpG, back.clone(), { cast: shadow }));
  const lensM = new THREE.MeshPhysicalMaterial({ color: '#06080b', roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMap: env, envMapIntensity: 1.4 });
  const ringG = geo('ph-lensring', () => { const c = new THREE.CylinderGeometry(0.58, 0.6, 0.22, 32); c.translate(0, -0.11, 0); return c; });
  const glassG = geo('ph-lensglass', () => new THREE.SphereGeometry(0.45, 32, 12, 0, Math.PI * 2, Math.PI * 0.74, Math.PI * 0.26));
  for (const [dx, dz] of [[-0.68, -0.68], [-0.68, 0.68], [0.68, 0]]) {
    const r = M(ringG, metal, { cast: shadow }); r.position.set(dx, -0.12, dz); bump.add(r);
    const l = M(glassG, lensM); l.position.set(dx, -0.07, dz); l.scale.set(1, 0.6, 1); bump.add(l);
  }
  const flash = M(geo('ph-flash', () => new THREE.CylinderGeometry(0.17, 0.17, 0.06, 20)), new THREE.MeshStandardMaterial({ color: '#d9cfae', roughness: 0.3, emissive: '#3a3420' })); flash.position.set(0.68, -0.2, -0.85); bump.add(flash);
  // side buttons
  const btnG = (len) => geo('ph-btn' + len, () => new RoundedBoxGeometry(0.16, 0.3, len, 2, 0.07));
  for (const [x, z, len] of [[-PH.w / 2 - 0.02, -3.6, 1.2], [-PH.w / 2 - 0.02, -1.9, 1.2], [-PH.w / 2 - 0.02, -5.2, 0.6], [PH.w / 2 + 0.02, -2.8, 2.0]]) {
    const b = M(btnG(len), metal); b.position.set(x, 0, z); body.add(b);
  }
  // --- display panel: black slab + live canvas screen
  const slabM = new THREE.MeshPhysicalMaterial({ color: '#040506', roughness: 0.3, metalness: 0.2, envMap: env, envMapIntensity: 0.4 });
  const dSlab = M(geo('ph-dslab', () => slabXZ(PH.w - 0.3, PH.l - 0.3, PH.r - 0.15, 0.09, 0.02)), slabM); dSlab.position.y = 0.21; display.add(dSlab);
  const SW = 600, SHh = Math.round(600 * SCR.h / SCR.w);
  const { c: scv, g: sg, t: stex } = canvasTex(SW, SHh);
  // the screen floats 0.012 cm above the slab top (0.21 + 0.09) and is pulled toward the camera in depth (polygonOffset), so it never
  // z-fights with the slab when the phone is scaled up or seen from far away (depth precision drops with distance)
  const scrMat = new THREE.MeshBasicMaterial({ map: stex, color: new THREE.Color(0.86, 0.86, 0.86), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const scrMesh = M(geo('ph-screen', () => rrPlaneXZ(SCR.w, SCR.h, SCR.r, 16)), scrMat); scrMesh.position.y = 0.312; scrMesh.renderOrder = 1; display.add(scrMesh);
  const screen = {
    canvas: scv, g: sg, tex: stex, W: SW, H: SHh, mesh: scrMesh, mat: scrMat, key: '', ui: {},
    draw(fn) { fn(sg, SW, SHh); stex.needsUpdate = true; screen.key = ''; },
    // built-in looks; redraws only when (look, params) change
    look(name, p = {}) {
      const key = name + JSON.stringify(p); if (key === screen.key) return screen; screen.key = key;
      (LOOKS[name] || LOOKS.off)(sg, SW, SHh, p, screen.ui);
      if (p.ghosts || p.glitch) drawGhosts(sg, SW, SHh, p);
      stex.needsUpdate = true; return screen;
    },
    brightness(k) { scrMat.color.setScalar(0.86 * k); return screen; },
  };
  screen.look(look);
  // --- sensor layer (the capacitive grid, normally invisible under the glass)
  const grid = makeGrid(ctx, { w: 6.3, h: 13.8, ...gridOpts }); grid.group.position.y = 0.335; sensor.add(grid.group); grid.alpha(0);
  // --- cover glass: black-tinted, clear-coated, reflections survive transparency
  const glassMat = glassify(new THREE.MeshPhysicalMaterial({ color: '#0b0f16', roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, envMap: env, envMapIntensity: 1.0, opacity: 0.12, ior: 1.5, specularIntensity: 1 }), 1, 0.78);
  const glassMesh = M(geo('ph-glass', () => slabXZ(PH.w - 0.16, PH.l - 0.16, PH.r - 0.08, 0.07, 0.03, 20)), glassMat); glassMesh.position.y = 0.345; glassMesh.renderOrder = 3; glass.add(glassMesh);
  const GLASS_TOP = 0.415;
  // contact shadow on the glass (finger proximity cue) + touch rings
  const cs = M(geo('ph-cs', () => { const p = new THREE.PlaneGeometry(1, 1); p.rotateX(-Math.PI / 2); return p; }), new THREE.MeshBasicMaterial({ map: radialTex(), color: '#000000', transparent: true, depthWrite: false, opacity: 0 }));
  cs.position.y = GLASS_TOP + 0.004; cs.renderOrder = 4; glass.add(cs); cs.material.blending = THREE.NormalBlending;
  // shadow texture is white-on-transparent; draw as black by multiplying via alphaMap
  cs.material.alphaMap = blobTex(); cs.material.map = null;
  const rings = [0, 1, 2, 3].map(() => { const r = makeRing(ctx, { color: P.chargeHot }); r.mesh.position.y = GLASS_TOP + 0.01; glass.add(r.mesh); return r; });

  const local = (u, v, y = GLASS_TOP) => V((u - 0.5) * SCR.w, y, (v - 0.5) * SCR.h);
  const api = {
    group, body, display, sensor, glass, layers: { glass, sensor, display, body }, grid, screen, mats: { metal, back, glass: glassMat, screen: scrMat },
    size: { ...PH, screenW: SCR.w, screenH: SCR.h, glassTop: GLASS_TOP }, ui: screen.ui,
    look: (name, p) => screen.look(name, p),
    // screen point (u right, v down from the top/camera end) -> phone-local / world position on the glass surface
    local,
    screenPoint(u, v, out = V(), lift = 0) { group.updateWorldMatrix(true, true); return out.copy(local(u, v, GLASS_TOP + lift)).applyMatrix4(glass.matrixWorld); },
    uvOf(world) { group.updateWorldMatrix(true, true); const p = glass.worldToLocal(toV3(world)); return [p.x / SCR.w + 0.5, p.z / SCR.h + 0.5]; },
    // glowing touch ring at a screen point; k 0..1 progress (<=0 or >=1 hides); slot 0..3 for several at once
    touchAt(u, v, k, slot = 0, { color, size = 1 } = {}) {
      const r = rings[slot]; if (!r) return api;
      const p = local(u, v); r.mesh.position.x = p.x; r.mesh.position.z = p.z; r.set(k, { color, size }); return api;
    },
    clearTouches() { rings.forEach((r) => r.set(0)); return api; },
    contactShadow(u, v, r = 1.2, a = 0) { const p = local(u, v); cs.position.x = p.x; cs.position.z = p.z; cs.scale.set(r * 2.4, 1, r * 2.4); cs.material.opacity = a; cs.visible = a > 0.001; return api; },
    // exploded view: layers lift apart (glass highest). opts.grid (default true) fades the sensor grid in with k
    explode(k, { gap = 1, grid: showGrid = true } = {}) {
      const e = Math.max(0, k) * gap;
      glass.position.y = 5.6 * e; sensor.position.y = 3.6 * e; display.position.y = 1.8 * e;
      if (showGrid) grid.alpha(clamp(k * 1.5));
      return api;
    },
  };
  api.contactShadow(0.5, 0.5, 1, 0);
  return api;
}

// glowing touch ring (flat, in XZ): k 0..1 = expand + fade
function makeRing(ctx, { color = P.chargeHot, rmax = 1.6 } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0 }, uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uK, uAlpha; uniform vec3 uColor; varying vec2 vUv;
      void main(){ float r = length(vUv - 0.5) * 2.0; float k = uK; float e = 1.0 - pow(1.0 - k, 3.0);
        float R1 = mix(0.12, 0.95, e), R2 = mix(0.05, 0.62, clamp((k - 0.12) / 0.88, 0.0, 1.0));
        float ring = exp(-pow((r - R1) / (0.035 + 0.03 * e), 2.0)) * (1.0 - k);
        float ring2 = exp(-pow((r - R2) / 0.03, 2.0)) * (1.0 - k) * 0.6 * step(0.12, k);
        float core = exp(-pow(r / 0.16, 2.0)) * pow(1.0 - k, 2.0) * 1.4;
        float fill = smoothstep(R1, 0.0, r) * 0.18 * (1.0 - k);
        float a = (ring * 1.6 + ring2 + core + fill) * uAlpha;
        gl_FragColor = vec4(uColor * a * 1.8, 1.0); }`,
  });
  const mesh = new THREE.Mesh(geo('ringPlane', () => { const p = new THREE.PlaneGeometry(2, 2); p.rotateX(-Math.PI / 2); return p; }), mat);
  mesh.renderOrder = 5; mesh.visible = false; mesh.frustumCulled = false;
  return {
    mesh, mat,
    set(k, { color, size = 1, alpha = 1 } = {}) {
      mesh.visible = k > 0 && k < 1; mat.uniforms.uK.value = clamp(k); mat.uniforms.uAlpha.value = alpha;
      if (color) mat.uniforms.uColor.value.set(color); mesh.scale.setScalar(rmax * size);
    },
  };
}
// standalone touch ring anywhere (flat on a surface): ring = makeTouchRing(ctx); ring.mesh.position...; ring.set(k)
export function makeTouchRing(ctx, opts) { const r = makeRing(ctx, opts); return { group: r.mesh, mesh: r.mesh, set: r.set }; }

// ---------- screen looks (canvas) ----------
function statusBar(g, W, col = 'rgba(255,255,255,0.92)') {
  g.fillStyle = col; g.font = '600 30px Figtree, Inter, sans-serif, Fallback'; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText('9:41', 62, 52);
  g.fillRect(W - 118, 44, 40, 18); g.fillRect(W - 76, 49, 4, 8);           // battery
  for (let i = 0; i < 4; i++) g.fillRect(W - 186 + i * 11, 60 - 6 - i * 4, 7, 6 + i * 4);   // bars
  g.fillStyle = '#000'; g.beginPath(); g.roundRect(W / 2 - 92, 26, 184, 52, 26); g.fill();  // camera island
}
function glyph(g, kind, x, y, s) {
  g.save(); g.translate(x, y); g.fillStyle = 'rgba(255,255,255,0.95)'; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = s * 0.09; g.lineCap = 'round';
  const k = kind % 8;
  if (k === 0) { g.beginPath(); g.arc(0, 0, s * 0.26, 0, Math.PI * 2); g.stroke(); }
  else if (k === 1) { g.beginPath(); g.moveTo(-s * 0.25, s * 0.2); g.lineTo(0, -s * 0.25); g.lineTo(s * 0.25, s * 0.2); g.closePath(); g.fill(); }
  else if (k === 2) { for (let i = 0; i < 3; i++) g.fillRect(-s * 0.26 + i * s * 0.19, s * 0.22 - (i + 1) * s * 0.13, s * 0.12, (i + 1) * s * 0.13); }
  else if (k === 3) { g.beginPath(); g.roundRect(-s * 0.24, -s * 0.18, s * 0.48, s * 0.36, s * 0.07); g.stroke(); g.beginPath(); g.arc(0, 0, s * 0.08, 0, 7); g.fill(); }
  else if (k === 4) { for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { g.beginPath(); g.arc((a - 1) * s * 0.17, (b - 1) * s * 0.17, s * 0.05, 0, 7); g.fill(); } }
  else if (k === 5) { g.beginPath(); g.arc(0, 0, s * 0.25, Math.PI * 0.15, Math.PI * 1.85); g.stroke(); g.beginPath(); g.arc(s * 0.12, -s * 0.05, s * 0.05, 0, 7); g.fill(); }
  else if (k === 6) { g.beginPath(); g.moveTo(-s * 0.24, 0); g.lineTo(-s * 0.06, s * 0.17); g.lineTo(s * 0.25, -s * 0.18); g.stroke(); }
  else { g.beginPath(); g.moveTo(0, -s * 0.26); for (let i = 1; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * 0.11 : s * 0.26; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); }
  g.restore();
}
const ICON_COLS = [['#3f8cff', '#1b4fd8'], ['#ff8a4c', '#e5452f'], ['#3fd48a', '#17985a'], ['#b46cff', '#6b35d8'], ['#ffd25a', '#f09a1b'], ['#5ad7ff', '#1f8fd4'], ['#ff6aa8', '#d42c6c'], ['#9aa3b5', '#59606f']];
function handset(g, x, y, s, rot = 0) {
  g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(-s * 0.42, -s * 0.1); g.quadraticCurveTo(0, -s * 0.34, s * 0.42, -s * 0.1); g.lineTo(s * 0.4, s * 0.1); g.lineTo(s * 0.18, s * 0.06); g.lineTo(s * 0.16, -s * 0.05);
  g.quadraticCurveTo(0, -s * 0.12, -s * 0.16, -s * 0.05); g.lineTo(-s * 0.18, s * 0.06); g.lineTo(-s * 0.4, s * 0.1); g.closePath(); g.fill(); g.restore();
}
const LOOKS = {
  off(g, W, H, p) {
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#07090c'); gr.addColorStop(0.5, '#030405'); gr.addColorStop(1, '#060709');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  },
  home(g, W, H, p) {
    const bg = g.createLinearGradient(0, 0, W * 0.4, H); bg.addColorStop(0, '#1a2c74'); bg.addColorStop(0.45, '#3a2470'); bg.addColorStop(1, '#0b0f22');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const b1 = g.createRadialGradient(W * 0.8, H * 0.25, 0, W * 0.8, H * 0.25, W * 0.9); b1.addColorStop(0, 'rgba(90,160,255,0.55)'); b1.addColorStop(1, 'rgba(90,160,255,0)'); g.fillStyle = b1; g.fillRect(0, 0, W, H);
    const b2 = g.createRadialGradient(W * 0.1, H * 0.75, 0, W * 0.1, H * 0.75, W); b2.addColorStop(0, 'rgba(255,120,170,0.35)'); b2.addColorStop(1, 'rgba(255,120,170,0)'); g.fillStyle = b2; g.fillRect(0, 0, W, H);
    statusBar(g, W);
    const s = W * 0.17, gx = W * 0.075, cols = 4, step = (W - 2 * gx - s) / (cols - 1);
    let n = 0;
    for (let r = 0; r < 6; r++) for (let c = 0; c < cols; c++, n++) {
      const x = gx + c * step, y = 150 + r * (s + 74);
      if (p.hide && p.hide.includes(n)) continue;
      const [a, b] = ICON_COLS[(n * 5 + r) % ICON_COLS.length];
      const gr = g.createLinearGradient(x, y, x, y + s); gr.addColorStop(0, a); gr.addColorStop(1, b);
      const pop = p.open === n ? 1.12 : 1;
      g.save(); g.translate(x + s / 2, y + s / 2); g.scale(pop, pop); g.fillStyle = gr; g.beginPath(); g.roundRect(-s / 2, -s / 2, s, s, s * 0.24); g.fill(); g.restore();
      glyph(g, n * 3 + r, x + s / 2, y + s / 2, s);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.roundRect(x + s * 0.2, y + s + 16, s * 0.6, 9, 4.5); g.fill();
    }
    // dock
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.roundRect(W * 0.04, H - 230, W * 0.92, 180, 62); g.fill();
    for (let c = 0; c < 4; c++) { const x = gx + c * step, y = H - 230 + 90 - s / 2, [a, b] = ICON_COLS[(c * 3 + 1) % 8]; const gr = g.createLinearGradient(x, y, x, y + s); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.beginPath(); g.roundRect(x, y, s, s, s * 0.24); g.fill(); glyph(g, c * 2 + 5, x + s / 2, y + s / 2, s); }
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.roundRect(W / 2 - 80, H - 26, 160, 9, 4.5); g.fill();
  },
  // incoming call. p: {name='Mom', sub='mobile', answer=0 (press glow on Answer 0..1), decline=0, answered=0 (0..1 crossfade to the in-call view), ring=0..1 phase, time='0:01'}
  call(g, W, H, p, ui) {
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#24324a'); bg.addColorStop(0.5, '#141b29'); bg.addColorStop(1, '#090c12');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const halo = g.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, W * 0.8); halo.addColorStop(0, 'rgba(110,150,230,0.35)'); halo.addColorStop(1, 'rgba(110,150,230,0)'); g.fillStyle = halo; g.fillRect(0, 0, W, H);
    statusBar(g, W);
    const A = clamp(p.answered || 0), ring = p.ring ?? 0;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '500 30px Figtree, Inter, sans-serif, Fallback'; g.fillText(A > 0.5 ? (p.time || '0:01') : 'incoming call', W / 2, H * 0.17);
    // avatar with ringing pulses
    const ax = W / 2, ay = H * 0.3, ar = W * 0.16;
    if (A < 0.5) for (let i = 0; i < 2; i++) { const k = (ring + i * 0.5) % 1; g.strokeStyle = `rgba(150,190,255,${0.5 * (1 - k)})`; g.lineWidth = 4; g.beginPath(); g.arc(ax, ay, ar * (1 + k * 0.6), 0, 7); g.stroke(); }
    const av = g.createLinearGradient(ax, ay - ar, ax, ay + ar); av.addColorStop(0, '#8fa0bd'); av.addColorStop(1, '#5a6987');
    g.fillStyle = av; g.beginPath(); g.arc(ax, ay, ar, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.font = `600 ${ar * 0.95}px Figtree, Inter, sans-serif, Fallback`; g.fillText((p.name || 'Mom')[0].toUpperCase(), ax, ay + ar * 0.05);
    g.font = '600 64px Figtree, Inter, sans-serif, Fallback'; g.fillStyle = '#fff'; g.fillText(p.name || 'Mom', W / 2, H * 0.47);
    g.font = '500 30px Figtree, Inter, sans-serif, Fallback'; g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillText(p.sub || 'mobile', W / 2, H * 0.51);
    // buttons
    const by = 0.82, br = W * 0.105;
    ui.decline = [0.25, by]; ui.answer = [0.75, by]; ui.end = [0.5, by]; ui.buttonR = br / W;
    const btn = (u, col, glow, rot, label) => {
      const x = u * W, y = by * H;
      if (glow > 0) { const gg = g.createRadialGradient(x, y, br * 0.8, x, y, br * 2); gg.addColorStop(0, rgba(col, 0.6 * glow)); gg.addColorStop(1, rgba(col, 0)); g.fillStyle = gg; g.beginPath(); g.arc(x, y, br * 2, 0, 7); g.fill(); }
      const s = 1 - 0.08 * glow;
      g.fillStyle = col; g.beginPath(); g.arc(x, y, br * s, 0, 7); g.fill();
      handset(g, x, y, br * 1.0 * s, rot);
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = '500 28px Figtree, Inter, sans-serif, Fallback'; g.fillText(label, x, y + br + 40);
    };
    if (A < 0.5) { btn(0.25, P.no, p.decline || 0, Math.PI * 0.75, 'Decline'); btn(0.75, P.ok, p.answer || 0, 0, 'Answer'); }
    else {
      g.globalAlpha = clamp((A - 0.5) * 2);
      const keys = ['mute', 'keypad', 'speaker', 'add', 'video', 'contacts'];
      keys.forEach((k, i) => { const x = W * (0.22 + (i % 3) * 0.28), y = H * (0.6 + Math.floor(i / 3) * 0.1); g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.arc(x, y, W * 0.085, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = '500 22px Figtree, Inter, sans-serif, Fallback'; g.fillText(k, x, y + W * 0.085 + 26); });
      btn(0.5, P.no, 0, Math.PI * 0.75, 'End'); g.globalAlpha = 1;
      g.fillStyle = P.ok; g.font = '600 34px Figtree, Inter, sans-serif, Fallback'; g.fillText(p.time || '0:01', W / 2, H * 0.555);
    }
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.roundRect(W / 2 - 80, H - 26, 160, 9, 4.5); g.fill();
  },
  // stylised dark map. p: {zoom=1 (1..4), cx=0.5, cy=0.5 zoom centre, pin=true}
  map(g, W, H, p) {
    const z = p.zoom ?? 1, cx = (p.cx ?? 0.5) * W, cy = (p.cy ?? 0.5) * H;
    g.fillStyle = '#1b2029'; g.fillRect(0, 0, W, H);
    g.save(); g.translate(cx, cy); g.scale(z, z); g.translate(-cx, -cy);
    const R = rng(7);
    // water + park
    g.fillStyle = '#163452'; g.beginPath(); g.moveTo(-W, H * 0.62); g.bezierCurveTo(W * 0.3, H * 0.55, W * 0.6, H * 0.8, W * 2, H * 0.7); g.lineTo(W * 2, H * 0.9); g.bezierCurveTo(W * 0.6, H * 1.0, W * 0.2, H * 0.72, -W, H * 0.8); g.fill();
    g.fillStyle = '#1e3a2b'; g.beginPath(); g.roundRect(W * 0.08, H * 0.18, W * 0.3, H * 0.16, 30); g.fill();
    // blocks
    for (let n = 0; n < 140; n++) { const x = (R() * 1.6 - 0.3) * W, y = (R() * 1.4 - 0.2) * H, w = 30 + R() * 80, h = 30 + R() * 80; if (y > H * 0.58 && y < H * 0.88) continue; g.fillStyle = R() < 0.5 ? '#232a35' : '#262e3a'; g.fillRect(x, y, w, h); }
    // roads
    g.strokeStyle = '#353e4d'; g.lineCap = 'round';
    for (let n = 0; n < 16; n++) { g.lineWidth = 6 + R() * 6; g.beginPath(); const y = (R() * 1.4 - 0.2) * H; g.moveTo(-W, y); g.lineTo(2 * W, y + (R() - 0.5) * 200); g.stroke(); }
    for (let n = 0; n < 9; n++) { g.lineWidth = 6 + R() * 6; g.beginPath(); const x = (R() * 1.4 - 0.2) * W; g.moveTo(x, -H); g.lineTo(x + (R() - 0.5) * 200, 2 * H); g.stroke(); }
    g.strokeStyle = '#59647a'; g.lineWidth = 16; g.beginPath(); g.moveTo(-W, H * 0.42); g.bezierCurveTo(W * 0.3, H * 0.36, W * 0.7, H * 0.5, 2 * W, H * 0.44); g.stroke();
    // route + pin
    g.strokeStyle = P.charge; g.lineWidth = 12; g.beginPath(); g.moveTo(W * 0.2, H * 0.78); g.lineTo(W * 0.3, H * 0.52); g.lineTo(W * 0.55, H * 0.46); g.lineTo(W * 0.62, H * 0.38); g.stroke();
    if (p.pin !== false) {
      const x = W * 0.62, y = H * 0.38;
      g.fillStyle = 'rgba(42,122,252,0.25)'; g.beginPath(); g.arc(x, y, 46, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 20, 0, 7); g.fill(); g.fillStyle = P.charge; g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill();
    }
    g.restore();
    statusBar(g, W);
    g.fillStyle = 'rgba(20,24,32,0.92)'; g.beginPath(); g.roundRect(W * 0.05, H - 200, W * 0.9, 150, 40); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = '600 34px Figtree, Inter, sans-serif, Fallback'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('Coffee', W * 0.11, H - 150);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '500 26px Figtree, Inter, sans-serif, Fallback'; g.fillText('4 min walk', W * 0.11, H - 104);
  },
  // a plain solid / gradient screen: p {color, color2}
  solid(g, W, H, p) { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, p.color || '#1b2c6e'); gr.addColorStop(1, p.color2 || p.color || '#0b0f22'); g.fillStyle = gr; g.fillRect(0, 0, W, H); },
};
// ghost / phantom touches + glitch bands over any look: p.ghosts = [[u,v,a], ...], p.glitch = 0..1, p.seed
function drawGhosts(g, W, H, p) {
  if (p.glitch > 0) {
    const R = rng(p.seed || 3), img = g.getImageData(0, 0, W, H), out = g.createImageData(W, H), n = Math.round(4 + 14 * p.glitch);
    out.data.set(img.data);
    for (let b = 0; b < n; b++) {
      const y0 = (R() * H) | 0, hh = (8 + R() * 70 * p.glitch) | 0, dx = ((R() - 0.5) * 120 * p.glitch) | 0;
      for (let y = y0; y < Math.min(H, y0 + hh); y++) for (let x = 0; x < W; x++) {
        const sx = Math.min(W - 1, Math.max(0, x - dx)), o = (y * W + x) * 4, si = (y * W + sx) * 4;
        out.data[o] = img.data[si + 4 < img.data.length ? si + 4 : si]; out.data[o + 1] = img.data[si + 1]; out.data[o + 2] = img.data[Math.max(0, si - 4) + 2];
      }
    }
    g.putImageData(out, 0, 0);
  }
  for (const [u, v, a = 1] of p.ghosts || []) {
    const x = u * W, y = v * H, r = W * 0.07;
    const gr = g.createRadialGradient(x, y, 0, x, y, r * 1.8); gr.addColorStop(0, `rgba(160,200,255,${0.55 * a})`); gr.addColorStop(0.5, `rgba(90,150,255,${0.25 * a})`); gr.addColorStop(1, 'rgba(90,150,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 1.8, 0, 7); g.fill();
    g.strokeStyle = `rgba(200,225,255,${0.85 * a})`; g.lineWidth = 4; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
  }
}

// =====================================================================================================
// 3. hand / finger
// =====================================================================================================
let KNIT = null;
function knitTex(kind = 'wool') {
  KNIT = KNIT || {};
  if (KNIT[kind]) return KNIT[kind];
  const S = 256, col = canvasTex(S, S), hgt = canvasTex(S, S, false), emi = canvasTex(S, S);
  const thread = kind === 'thread';
  const base = thread ? '#8d94a0' : '#3a3f4a', hi = thread ? '#eef1f6' : '#6b7280';
  col.g.fillStyle = base; col.g.fillRect(0, 0, S, S); hgt.g.fillStyle = '#202020'; hgt.g.fillRect(0, 0, S, S); emi.g.fillStyle = '#000'; emi.g.fillRect(0, 0, S, S);
  const cols = 6, rows = 8, cw = S / cols, rh = S / rows, R = rng(thread ? 9 : 4);
  // stockinette: columns of V stitches, each V = two thick slanted loops; height map blurred for soft bump
  hgt.g.filter = 'blur(2px)';
  for (let r = -1; r <= rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * cw + cw / 2, y = r * rh + rh / 2, j = (R() - 0.5) * 0.12;
    for (const side of [-1, 1]) {
      const x0 = x + side * cw * 0.36, y0 = y - rh * 0.62, x1 = x + side * cw * 0.04, y1 = y + rh * 0.55;
      const sh = mixHex(base, hi, 0.35 + 0.35 * R() + j);
      col.g.lineCap = 'round';
      col.g.strokeStyle = mixHex(base, '#000000', 0.35); col.g.lineWidth = cw * 0.46; col.g.beginPath(); col.g.moveTo(x0, y0); col.g.lineTo(x1, y1); col.g.stroke();
      col.g.strokeStyle = sh; col.g.lineWidth = cw * 0.34; col.g.beginPath(); col.g.moveTo(x0, y0); col.g.lineTo(x1, y1); col.g.stroke();
      col.g.strokeStyle = rgba(hi, 0.35); col.g.lineWidth = cw * 0.1; col.g.beginPath(); col.g.moveTo(x0 - side * cw * 0.03, y0 + rh * 0.1); col.g.lineTo(x1 - side * cw * 0.03, y1 - rh * 0.1); col.g.stroke();
      hgt.g.lineCap = 'round'; hgt.g.strokeStyle = '#d8d8d8'; hgt.g.lineWidth = cw * 0.36; hgt.g.beginPath(); hgt.g.moveTo(x0, y0); hgt.g.lineTo(x1, y1); hgt.g.stroke();
    }
  }
  hgt.g.filter = 'none';
  // fibre fuzz
  for (let n = 0; n < 1400; n++) { const x = R() * S, y = R() * S, a = R() * Math.PI; col.g.strokeStyle = rgba(hi, 0.18 + 0.2 * R()); col.g.lineWidth = 0.7; col.g.beginPath(); col.g.moveTo(x, y); col.g.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5); col.g.stroke(); }
  if (thread) {   // embroidered conductive stitches (also the emissive mask)
    for (const g of [col.g, emi.g]) {
      g.strokeStyle = g === emi.g ? '#ffffff' : '#f4f6fa'; g.lineWidth = 3;
      for (let k = -S; k < 2 * S; k += 22) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + S * 0.6, S); g.stroke(); g.beginPath(); g.moveTo(k + S * 0.6, 0); g.lineTo(k, S); g.stroke(); }
    }
  }
  for (const t of [col.t, hgt.t, emi.t]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; }
  KNIT[kind] = { map: col.t, bump: hgt.t, emi: emi.t };
  return KNIT[kind];
}
function knitMat(ctx, kind, rep) {
  const tx = knitTex(kind), env = libEnv(ctx);
  const cl = (t) => { const c = t.clone(); c.repeat.set(rep[0], rep[1]); c.needsUpdate = true; return c; };
  const thread = kind === 'thread';
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff', map: cl(tx.map), bumpMap: cl(tx.bump), bumpScale: thread ? 2 : 4, roughness: thread ? 0.42 : 0.92, metalness: thread ? 0.75 : 0,
    sheen: thread ? 0.2 : 1, sheenColor: new THREE.Color(thread ? '#ffffff' : '#9aa2b8'), sheenRoughness: 0.7, envMap: env, envMapIntensity: thread ? 1.3 : 0.5,
    emissive: new THREE.Color(P.body), emissiveMap: thread ? cl(tx.emi) : null, emissiveIntensity: 0,
  });
}
const XRAY_VS = 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }';
const XRAY_FS = 'uniform vec3 uColor; uniform float uK; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vV)))), 2.4); gl_FragColor = vec4(uColor * (0.025 + 1.1 * f) * uK, 1.0); }';

// joint chain helpers. Hand frame: fingers point -Y from the knuckles, palm faces +Z, back of hand -Z, thumb on -X.
function aimBasis(obj, dir, dorsal) {   // local -Y -> dir, local -Z -> dorsal (orthogonalised)
  const y = toV3(dir).normalize().negate(), zt = toV3(dorsal).normalize().negate();
  const z = zt.sub(y.clone().multiplyScalar(zt.dot(y))).normalize(), x = V().crossVectors(y, z);
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
const FINGERS = {   // x, z of knuckle, segment lengths, radii
  index: { x: -2.85, z: 0, L: [4.1, 2.45, 2.05], R: [0.9, 0.84, 0.8] },
  middle: { x: -0.95, z: 0.05, L: [4.5, 2.8, 2.15], R: [0.92, 0.86, 0.81] },
  ring: { x: 0.95, z: 0.05, L: [4.2, 2.6, 2.05], R: [0.86, 0.8, 0.76] },
  pinky: { x: 2.75, z: 0, L: [3.4, 2.0, 1.85], R: [0.76, 0.71, 0.68] },
  thumb: { L: [3.0, 2.7, 2.25], R: [1.05, 0.98, 0.9] },
};
export const HAND_POSES = {   // joint flex in degrees (negative = toward the palm); thumb: aim dir + dorsal hint (hand frame) + 2 bends
  point: { index: [8, -6, -6], middle: [-96, -106, -60], ring: [-98, -106, -60], pinky: [-98, -104, -58], thumb: { dir: [-0.1, -1, 0.02], dorsal: [-1, 0.14, -0.37], bend: [-45, -36] } },
  pinchClosed: { index: [-63, -49, -12], middle: [-81, -95, -50], ring: [-86, -95, -55], pinky: [-85, -98, -55], thumb: { dir: [-0.075, -1, 1.31], dorsal: [-1, -0.37, -0.29], bend: [-18.4, -17.4] } },
  pinchOpen: { index: [-5.7, -51.4, -19], middle: [-70.8, -101.6, -50], ring: [-84.9, -95, -55], pinky: [-85, -98, -55], thumb: { dir: [-0.133, -1, 1.385], dorsal: [-1, 0.07, -0.06], bend: [-27.1, -12.3] } },
  flat: { index: [0, -4, -3], middle: [0, -4, -3], ring: [0, -4, -3], pinky: [0, -4, -3], thumb: { dir: [-0.5, -1, 0.3], dorsal: [-0.8, 0, -0.5], bend: [-5, -5] } },
};
const D2R = Math.PI / 180;

export function makeHand(ctx, opts = {}) {
  const { glove = null, fingerOnly = false, side = 'right', shadow = true, skin = P.skin } = opts;
  const env = libEnv(ctx);
  const root = new THREE.Group(); root.name = 'hand';
  const tiltG = new THREE.Group(), offG = new THREE.Group(), handG = new THREE.Group();
  root.add(tiltG); tiltG.add(offG); offG.add(handG);
  if (side === 'left') handG.scale.x = -1;
  const gl = !!glove, gs = gl ? 1.14 : 1;   // gloves are a little chunkier
  const skinMat = new THREE.MeshPhysicalMaterial({ color: skin, roughness: 0.5, metalness: 0, sheen: 0.7, sheenColor: new THREE.Color('#ffc9a8'), sheenRoughness: 0.45,
    clearcoat: 0.12, clearcoatRoughness: 0.55, envMap: env, envMapIntensity: 0.55, emissive: new THREE.Color('#5a1c08'), emissiveIntensity: 0.22 });
  capGlare(skinMat, 0.9);
  const nailMat = new THREE.MeshPhysicalMaterial({ color: '#f3c8b6', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMap: env, envMapIntensity: 0.9, sheen: 0.3, sheenColor: new THREE.Color('#ffffff') });
  const mats = gl ? { finger: knitMat(ctx, 'wool', [2.4, 1.6]), palm: knitMat(ctx, 'wool', [7, 3.5]), wrist: knitMat(ctx, 'wool', [6, 6]), cuff: knitMat(ctx, 'wool', [10, 1.2]) } : { finger: skinMat, palm: skinMat, wrist: skinMat };
  const threadMat = glove === 'touch' ? knitMat(ctx, 'thread', [2.4, 1.2]) : null;
  const xrShell = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(P.body) }, uK: { value: 0 } }, vertexShader: XRAY_VS, fragmentShader: XRAY_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const xrCore = addMat(hdr(P.body, 1.3), { opacity: 0 });
  const skinMeshes = [], xrMeshes = [];
  const capsule = (r, len) => geo(`cap${r.toFixed(3)}|${len.toFixed(3)}`, () => new THREE.CapsuleGeometry(r, len, 10, 20, 1));
  function seg(parent, len, r, mat, { nail = false, xray = true } = {}) {
    const j = new THREE.Group(); parent.add(j);
    const m = M(capsule(r * gs, len), mat, { cast: shadow }); m.position.y = -len / 2; m.scale.set(1, 1, 0.9); j.add(m); skinMeshes.push(m);
    if (nail && !gl) { const n = M(geo('nail' + r, () => new THREE.SphereGeometry(1, 20, 12)), nailMat, { cast: false }); n.scale.set(r * 0.68, len * 0.36, r * 0.3); n.position.set(0, -len * 0.62, -r * 0.84); n.rotation.x = -0.12; j.add(n); skinMeshes.push(n); }
    if (xray) {
      const s = M(capsule(r * gs * 1.01, len), xrShell); s.position.y = -len / 2; s.scale.set(1, 1, 0.9); s.renderOrder = 6; j.add(s); xrMeshes.push(s);
      const c = M(capsule(r * 0.3, len * 0.8), xrCore); c.position.y = -len / 2; c.renderOrder = 6; j.add(c); xrMeshes.push(c);
    }
    const end = new THREE.Object3D(); end.position.y = -len; j.add(end);
    return { j, end, mesh: m };
  }
  // fingers
  const chains = {};
  const fingerNames = fingerOnly ? ['index'] : ['index', 'middle', 'ring', 'pinky'];
  for (const name of fingerNames) {
    const F = FINGERS[name], base = new THREE.Group(); base.position.set(F.x, 0.35, F.z); handG.add(base);
    const L0 = fingerOnly ? 9 : F.L[0];
    const a = seg(base, L0, F.R[0], mats.finger), b = seg(a.end, F.L[1], F.R[1], mats.finger), c = seg(b.end, F.L[2], F.R[2], threadMat || mats.finger, { nail: true });
    const tip = new THREE.Object3D(); c.end.add(tip);
    const nailDir = new THREE.Object3D(); nailDir.position.set(0, 0, -1); c.j.add(nailDir);
    if (fingerOnly) base.position.y = L0 - 4.1;
    chains[name] = { base, segs: [a, b, c], tip, nailDir };
  }
  let palm = null;
  if (!fingerOnly) {
    // palm: rounded block, tapered toward the wrist, back slightly domed
    const pg = geo('palm' + gs, () => {
      // superellipsoid block: soft but full corners, tapered to the wrist, back of the hand domed
      const g = new THREE.SphereGeometry(1, 64, 40); const p = g.attributes.position;
      const se = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
      for (let i = 0; i < p.count; i++) {
        let x = se(p.getX(i), 0.55), y = se(p.getY(i), 0.6), z = se(p.getZ(i), 0.85);
        const yy = y * 0.5 + 0.5;                                // 0 knuckles .. 1 wrist
        x *= 4.15 * gs * lerp(1.0, 0.8, yy); y *= 4.6; z *= 1.4 * gs * lerp(1.0, 0.9, yy);
        if (z < 0) z -= 0.35 * (1 - (x / 4.2) ** 2);              // dorsal dome
        p.setXYZ(i, x, y, z);
      }
      g.translate(0, 4.3, 0); g.computeVertexNormals(); return g;
    });
    palm = M(pg, mats.palm, { cast: shadow }); handG.add(palm); skinMeshes.push(palm);
    const ps = M(pg, xrShell); ps.renderOrder = 6; ps.scale.setScalar(1.01); handG.add(ps); xrMeshes.push(ps);
    // wrist + forearm
    const wg = geo('wrist' + gs, () => { const g = new THREE.CapsuleGeometry(2.6 * gs, 18, 10, 24, 1); g.scale(1.2, 1, 0.78); g.translate(0, 8.4 + 9.6, 0); return g; });
    const wrist = M(wg, mats.wrist, { cast: shadow }); handG.add(wrist); skinMeshes.push(wrist);
    const ws = M(wg, xrShell); ws.renderOrder = 6; ws.scale.setScalar(1.01); handG.add(ws); xrMeshes.push(ws);
    const wc = M(geo('wristcore', () => { const g = new THREE.CapsuleGeometry(1.0, 22, 6, 12, 1); g.translate(0, 13, 0); return g; }), xrCore); wc.renderOrder = 6; handG.add(wc); xrMeshes.push(wc);
    if (gl) { const cuff = M(geo('cuff', () => { const g = new THREE.CylinderGeometry(3.25, 3.35, 4.5, 40, 1, true); g.scale(1.2, 1, 0.82); g.translate(0, 12.5, 0); return g; }), mats.cuff, { cast: shadow }); cuff.material.side = THREE.DoubleSide; handG.add(cuff); skinMeshes.push(cuff); }
    // thumb
    const tb = new THREE.Group(); tb.position.set(-3.55, 5.8, 0.75); handG.add(tb);
    const T = FINGERS.thumb;
    const a = seg(tb, T.L[0], T.R[0], mats.finger), b = seg(a.end, T.L[1], T.R[1], mats.finger), c = seg(b.end, T.L[2], T.R[2], threadMat || mats.finger, { nail: true });
    const tip = new THREE.Object3D(); c.end.add(tip);
    chains.thumb = { base: tb, segs: [a, b, c], tip };
  }
  for (const m of xrMeshes) m.visible = false;

  const st = { pose: 'point', spread: 1, tilt: 45, lean: 30, yaw: 0, curl: 0 };
  const mI = new THREE.Matrix4();
  const relPos = (obj) => { handG.updateWorldMatrix(true, true); mI.copy(handG.matrixWorld).invert(); return obj.getWorldPosition(V()).applyMatrix4(mI); };
  function applyPose(p) {
    for (const name of fingerNames) {
      const ang = p[name] || [0, 0, 0], ch = chains[name];
      ch.base.rotation.set(0, 0, 0); ch.segs[0].j.rotation.x = ang[0] * D2R; ch.segs[1].j.rotation.x = ang[1] * D2R; ch.segs[2].j.rotation.x = ang[2] * D2R;
      if (fingerOnly) { ch.segs[0].j.rotation.x = 0; }
    }
    if (chains.thumb) { const th = p.thumb; aimBasis(chains.thumb.base, th.dir, th.dorsal); chains.thumb.segs[0].j.rotation.x = 0; chains.thumb.segs[1].j.rotation.x = th.bend[0] * D2R; chains.thumb.segs[2].j.rotation.x = th.bend[1] * D2R; }
  }
  const lerpPose = (a, b, k) => {
    const o = {};
    for (const n of ['index', 'middle', 'ring', 'pinky']) o[n] = a[n].map((v, i) => lerp(v, b[n][i], k));
    o.thumb = { dir: a.thumb.dir.map((v, i) => lerp(v, b.thumb.dir[i], k)), dorsal: a.thumb.dorsal.map((v, i) => lerp(v, b.thumb.dorsal[i], k)), bend: a.thumb.bend.map((v, i) => lerp(v, b.thumb.bend[i], k)) };
    return o;
  };
  const basis = (a, b) => { const x = toV3(a).normalize(); const y = toV3(b).sub(x.clone().multiplyScalar(toV3(b).dot(x))).normalize(); return new THREE.Matrix4().makeBasis(x, y, V().crossVectors(x, y)); };
  function solve() {
    tiltG.quaternion.identity(); offG.position.set(0, 0, 0);
    let p = st.pose === 'pinch' ? lerpPose(HAND_POSES.pinchClosed, HAND_POSES.pinchOpen, clamp(st.spread)) : HAND_POSES[st.pose] || HAND_POSES.point;
    if (st.curl && st.pose === 'point') p = lerpPose(p, HAND_POSES.pinchClosed, st.curl);
    applyPose(p);
    let anchor, S, Tm;
    if (st.pose === 'pinch' && chains.thumb) {
      const a = relPos(chains.index.tip), b = relPos(chains.thumb.tip);
      anchor = a.clone().add(b).multiplyScalar(0.5);
      const d = b.clone().sub(a).multiply(handG.scale), dorsal = V(0, 0, -1).multiply(handG.scale);
      S = basis(d, dorsal);
      const L = st.lean * D2R; Tm = basis(V(0, 0, 1), V(0, Math.cos(L), -Math.sin(L)));
    } else {
      const tip = relPos(chains.index.tip), dip = relPos(chains.index.segs[2].j);
      anchor = tip;
      const f = tip.clone().sub(dip).multiply(handG.scale), n = relPos(chains.index.nailDir).sub(dip).multiply(handG.scale);
      S = basis(f, n);
      const a = st.tilt * D2R; Tm = basis(V(0, -Math.cos(a), -Math.sin(a)), V(0, Math.sin(a), -Math.cos(a)));
    }
    const R = Tm.multiply(S.transpose());
    tiltG.quaternion.setFromRotationMatrix(R);
    tiltG.position.set(0, FINGERS.index.R[2] * gs * 0.97, 0);   // tip pad (not the bone end) touches y = 0
    offG.position.copy(anchor).negate().multiply(handG.scale);
    root.rotation.y = st.yaw * D2R;
  }
  const api = {
    group: root, chains, palm, mats: { skin: skinMat, nail: nailMat, ...mats, thread: threadMat }, glove,
    // pose params: {pos:[x,y,z] (anchor = index fingertip pad, or the midpoint of the two tips when pinching), yaw (deg about +Y;
    //   0 = hand comes from +Z and points toward -Z), tilt (point: finger angle from vertical, deg), lean (pinch: deg), spread, curl}
    set(o = {}) { if (o.pos) root.position.copy(toV3(o.pos)); Object.assign(st, o); delete st.pos; solve(); return api; },
    point(o = {}) { return api.set({ ...o, pose: 'point' }); },
    pinch(spread = 1, o = {}) { return api.set({ ...o, pose: 'pinch', spread }); },
    flat(o = {}) { return api.set({ ...o, pose: 'flat' }); },
    // world contact points (lowest point of the finger pad)
    tip: (out = V()) => { chains.index.tip.getWorldPosition(out); out.y -= FINGERS.index.R[2] * gs * 0.97; return out; },
    thumbTip: (out = V()) => { if (!chains.thumb) return out.set(0, 0, 0); chains.thumb.tip.getWorldPosition(out); out.y -= FINGERS.thumb.R[2] * gs * 0.97; return out; },
    // world point along the index finger centre line: s=0 deep in the forearm/palm, 1 = fingertip (for body-electricity particles)
    fingerPoint(s, out = V()) {
      root.updateWorldMatrix(true, true);
      const pts = [];
      if (!fingerOnly) pts.push(V(-1.6, 24, 0.2).applyMatrix4(handG.matrixWorld), V(-2.6, 6.5, 0.1).applyMatrix4(handG.matrixWorld));
      const ch = chains.index; pts.push(ch.segs[0].j.getWorldPosition(V()), ch.segs[1].j.getWorldPosition(V()), ch.segs[2].j.getWorldPosition(V()), ch.segs[2].end.getWorldPosition(V()));
      const lens = []; let tot = 0; for (let i = 1; i < pts.length; i++) { const l = pts[i].distanceTo(pts[i - 1]); lens.push(l); tot += l; }
      let d = clamp(s) * tot; for (let i = 0; i < lens.length; i++) { if (d <= lens[i] || i === lens.length - 1) return out.copy(pts[i]).lerp(pts[i + 1], clamp(d / lens[i])); d -= lens[i]; }
      return out.copy(pts[pts.length - 1]);
    },
    threadGlow(k, color = P.body) { if (threadMat) { threadMat.emissive.set(color); threadMat.emissiveIntensity = 1.1 * k; } return api; },
    // xray: skin turns to glass, amber body electricity glows inside (k 0..1)
    xray(k, color = P.body) {
      const on = k > 0.001;
      for (const m of xrMeshes) m.visible = on;
      xrShell.uniforms.uK.value = k; xrShell.uniforms.uColor.value.set(color);
      xrCore.color.copy(hdr(color, 1.2)); xrCore.opacity = 0.35 * k;
      for (const m of new Set([skinMat, nailMat, ...Object.values(mats)])) { m.transparent = on; m.opacity = 1 - 0.7 * k; m.depthWrite = !on; }
      return api;
    },
  };
  api.set({});
  return api;
}
export function makeFinger(ctx, opts = {}) { return makeHand(ctx, { ...opts, fingerOnly: true }); }

// =====================================================================================================
// 4. pen
// =====================================================================================================
export function makePen(ctx, { kind = 'ballpoint', color = '#e8ebf0', len = 14 } = {}) {
  const env = libEnv(ctx);
  const group = new THREE.Group(); group.name = 'pen';
  const flex = { value: 0 }, LEN = { value: len };
  const bendable = (m) => { m.onBeforeCompile = (sh) => { sh.uniforms.uFlex = flex; sh.uniforms.uLen = LEN; sh.vertexShader = 'uniform float uFlex; uniform float uLen;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float fy_ = clamp(transformed.y / uLen, 0.0, 1.0); transformed.x += uFlex * uLen * fy_ * fy_ * 0.5;'); }; m.customProgramCacheKey = () => 'penflex'; return m; };
  const lathe = (pts, mat, seg = 40) => { const m = M(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), bendable(mat), { cast: true }); group.add(m); return m; };
  const plastic = new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.15, envMap: env, envMapIntensity: 0.9 });
  const metal = new THREE.MeshPhysicalMaterial({ color: '#c9ced6', metalness: 1, roughness: 0.22, envMap: env, envMapIntensity: 1.3 });
  const grip = new THREE.MeshPhysicalMaterial({ color: '#23272e', roughness: 0.75, sheen: 0.4, sheenColor: new THREE.Color('#556070'), envMap: env, envMapIntensity: 0.4 });
  const R = 0.46;
  if (kind === 'stylus') {
    lathe([[0, 0], [0.12, 0.02], [0.2, 0.15], [0.26, 0.6], [0.32, 1.6]], new THREE.MeshPhysicalMaterial({ color: '#2a2e35', roughness: 0.6, envMap: env, envMapIntensity: 0.5 }));
    lathe([[0.32, 1.6], [R, 2.6], [R, len - 0.5], [R * 0.8, len - 0.1], [0, len]], plastic);
  } else {
    lathe([[0, 0], [0.05, 0.01], [0.07, 0.08], [0.1, 0.25], [0.2, 0.75], [0.26, 0.95]], metal);
    lathe([[0.26, 0.95], [0.34, 1.2], [R * 0.95, 1.8], [R, 2.2], [R, 4.9], [R * 0.98, 5.0]], grip);
    lathe([[R * 0.98, 5.0], [R, 5.1], [R, len - 1.6], [R * 1.02, len - 1.5], [R * 1.02, len - 0.6], [R * 0.85, len - 0.15], [0.25, len], [0, len]], plastic);
    lathe([[0, 0.0], [0.13, 0.06], [0.13, 0.4], [0, 0.42]], metal, 16).position.y = len;   // click button
    const clip = M(geo('penclip' + len, () => { const g = new RoundedBoxGeometry(0.22, 4.2, 0.12, 2, 0.05); g.translate(0, len - 2.6, R + 0.12); return g; }), bendable(metal.clone()), { cast: true }); group.add(clip);
  }
  // pressure dimple on the glass under the tip (flat, darkish ring + tiny highlight)
  const api = {
    group, mats: { plastic, metal, grip }, length: len,
    // k 0..1 pressing hard: the barrel flexes a little; dir = flex direction (deg about Y)
    press(k) { flex.value = 0.06 * k; return api; },
    // tip at pos; tilt = deg from vertical; yaw = deg about Y (0: top leans toward +Z)
    set({ pos, tilt = 25, yaw = 0 } = {}) { if (pos) group.position.copy(toV3(pos)); group.rotation.set(0, 0, 0); group.rotateY(yaw * D2R); group.rotateX(tilt * D2R); group.rotateY(-Math.PI / 2); return api; },
  };
  api.set({});
  return api;
}

// =====================================================================================================
// 5. charge particles
// =====================================================================================================
export function makeCharges(ctx, n = 200, { color = P.charge, size = 0.09, glow = 2.4 } = {}) {
  const core = new THREE.InstancedMesh(geo('chg', () => new THREE.SphereGeometry(1, 10, 8)), new THREE.MeshBasicMaterial({ color: hdr(color, glow), toneMapped: false, transparent: true }), n);
  const halo = new THREE.InstancedMesh(geo('chgHalo', () => new THREE.PlaneGeometry(1, 1)), addMat(hdr(color, 0.9), { map: radialTex() }), n);
  core.frustumCulled = halo.frustumCulled = false;
  const group = new THREE.Group(); group.add(core, halo);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V(), s = V(), camQ = new THREE.Quaternion();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const data = new Float32Array(n * 4);
  const api = {
    group, count: n, core, halo,
    setP(i, x, y, z, sc = 1) {
      if (i < 0 || i >= n) return api;
      data.set([x, y, z, sc], i * 4);
      core.setMatrixAt(i, sc > 0 ? m4.compose(p.set(x, y, z), q, s.setScalar(size * sc)) : zero);
      core.instanceMatrix.needsUpdate = true; queue(); return api;
    },
    hide(i) { return api.setP(i, 0, 0, 0, 0); },
    hideAll() { for (let i = 0; i < n; i++) core.setMatrixAt(i, zero); data.fill(0); core.instanceMatrix.needsUpdate = true; queue(); return api; },
    setColor(c, k = glow) { core.material.color.copy(hdr(c, k)); halo.material.color.copy(hdr(c, 0.9)); return api; },
    alpha(a) { core.material.opacity = a; halo.material.opacity = a; group.visible = a > 0.001; return api; },
  };
  // halos are camera-facing quads: oriented after the camera is placed (ctx.after)
  const orient = () => {
    camQ.copy(ctx.camera.quaternion);
    for (let i = 0; i < n; i++) { const sc = data[i * 4 + 3]; halo.setMatrixAt(i, sc > 0 ? m4.compose(p.set(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]), camQ, s.setScalar(size * sc * 7)) : zero); }
    halo.instanceMatrix.needsUpdate = true;
  };
  let queuedIn = null;
  function queue() { if (Array.isArray(ctx.after)) { if (queuedIn !== ctx.after) { queuedIn = ctx.after; ctx.after.push(orient); } } else orient(); }
  api.hideAll();
  return api;
}

// =====================================================================================================
// 6. field lines (instanced bezier tubes, built in the vertex shader)
// =====================================================================================================
export function makeFieldLines(ctx, { max = 48, color = P.chargeHot, radius = 0.035, seg = 48, radial = 6 } = {}) {
  const base = new THREE.BufferGeometry();
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) for (let r = 0; r < radial; r++) { const a = (r / radial) * Math.PI * 2; pos.push(i / seg, Math.cos(a), Math.sin(a)); }
  for (let i = 0; i < seg; i++) for (let r = 0; r < radial; r++) { const a = i * radial + r, b = i * radial + ((r + 1) % radial), c = a + radial, d = b + radial; idx.push(a, c, b, b, c, d); }
  const g = new THREE.InstancedBufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const aF = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3), aC = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3), aT = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3), aS = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  g.setAttribute('aFrom', aF); g.setAttribute('aCtrl', aC); g.setAttribute('aTo', aT); g.setAttribute('aSeed', aS); g.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 1 }, uPhase: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new THREE.Color(color) }, uRadius: { value: radius }, uDash: { value: 5 }, uFlow: { value: 1.2 }, uBase: { value: 0.5 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `attribute vec3 aFrom, aCtrl, aTo; attribute float aSeed; uniform float uRadius; varying float vT, vSeed; varying vec3 vN, vV;
      vec3 bz(float t){ float u = 1.0 - t; return u*u*aFrom + 2.0*u*t*aCtrl + t*t*aTo; }
      vec3 dbz(float t){ return 2.0*(1.0-t)*(aCtrl-aFrom) + 2.0*t*(aTo-aCtrl); }
      void main(){ float t = position.x; vT = t; vSeed = aSeed; vec3 p = bz(t); vec3 T = normalize(dbz(t) + vec3(1e-5));
        vec3 a = abs(T.y) < 0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0); vec3 N = normalize(cross(T, a)); vec3 B = cross(T, N);
        vec3 off = N * position.y + B * position.z; float r = uRadius * (0.55 + 0.45 * smoothstep(0.0, 0.25, t)) * (0.6 + 0.4 * smoothstep(1.0, 0.8, t));
        vec4 mv = modelViewMatrix * vec4(p + off * r, 1.0); vN = normalize(normalMatrix * off); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uK, uPhase, uAlpha, uDash, uFlow, uBase; uniform vec3 uColor; varying float vT, vSeed; varying vec3 vN, vV;
      void main(){ if (vT > uK) discard; float head = smoothstep(uK - 0.12, uK, vT) * (1.0 - step(0.999, uK));
        float d = fract(vT * uDash - uPhase + vSeed); float dash = smoothstep(0.0, 0.12, d) * smoothstep(0.55, 0.3, d);
        float f = 0.35 + 0.65 * pow(abs(dot(normalize(vN), normalize(vV))), 0.8);
        float ends = smoothstep(0.0, 0.06, vT);
        float b = (uBase + dash * uFlow + head * 2.0) * f * ends * uAlpha;
        gl_FragColor = vec4(uColor * b, 1.0); }`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 7;
  const api = {
    group: mesh, mesh, mat, max,
    // lines: [{from:[x,y,z]|V3, to, ctrl?, lift?}] world space. Default ctrl: rises from `from`, bulging outward by `lift`, then bends into `to`.
    set(lines) {
      const n = Math.min(max, lines.length);
      for (let i = 0; i < n; i++) {
        const L = lines[i], f = toV3(L.from), t = toV3(L.to);
        const lf = L.lift ?? 0.25, c = L.ctrl ? toV3(L.ctrl) : V(f.x + (f.x - t.x) * lf, lerp(f.y, t.y, 0.8), f.z + (f.z - t.z) * lf);
        aF.setXYZ(i, f.x, f.y, f.z); aC.setXYZ(i, c.x, c.y, c.z); aT.setXYZ(i, t.x, t.y, t.z); aS.setX(i, L.seed ?? (i * 0.618) % 1);
      }
      g.instanceCount = n; aF.needsUpdate = aC.needsUpdate = aT.needsUpdate = aS.needsUpdate = true; mesh.visible = n > 0;
      return api;
    },
    // k: draw-on 0..1, phase: flow dash offset (e.g. t * 1.5), alpha
    update({ k = 1, phase = 0, alpha = 1, color, dash, flow, base } = {}) {
      const u = mat.uniforms; u.uK.value = k; u.uPhase.value = phase; u.uAlpha.value = alpha; if (color) u.uColor.value.set(color);
      if (dash != null) u.uDash.value = dash; if (flow != null) u.uFlow.value = flow; if (base != null) u.uBase.value = base;
      mesh.visible = alpha > 0.001 && k > 0.001 && g.instanceCount > 0; return api;
    },
    // convenience: lines from grid crossings [[i,j],...] to a world point
    fromCrossings(grid, cells, to, lift = 0.25) { return api.set(cells.map(([i, j], n) => ({ from: grid.pos(i, j), to, lift, seed: (n * 0.37) % 1 }))); },
  };
  mesh.visible = false;
  return api;
}

// =====================================================================================================
// 7. water droplet + splash
// =====================================================================================================
export function makeDrop(ctx, { r = 0.55, color = P.water } = {}) {
  const env = libEnv(ctx);
  const group = new THREE.Group(); group.name = 'drop';
  const mat = glassify(new THREE.MeshPhysicalMaterial({ color: mixHex(color, '#0b1a2a', 0.55), roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMap: env, envMapIntensity: 2.4, opacity: 0.4, ior: 1.33, specularIntensity: 1, sheen: 0.6, sheenRoughness: 0.3, sheenColor: new THREE.Color(color) }), 1.0, 1.4);
  // sitting drop: a lathe dome with a soft contact angle
  const prof = []; for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI / 2; prof.push(new THREE.Vector2(Math.cos(a) * (1 + 0.06 * Math.sin(a * 2)), Math.sin(a) * 0.62)); }
  const dome = M(geo('dropDome', () => { const g = new THREE.LatheGeometry(prof, 40); return g; }), mat); dome.renderOrder = 8; group.add(dome);
  const ball = M(geo('dropBall', () => { const g = new THREE.SphereGeometry(1, 32, 20); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0) { p.setX(i, p.getX(i) * (1 - 0.35 * y * y)); p.setZ(i, p.getZ(i) * (1 - 0.35 * y * y)); p.setY(i, y * 1.35); } } g.computeVertexNormals(); return g; }), mat); ball.renderOrder = 8; group.add(ball); ball.visible = false;
  // caustic light under the drop + dark refraction edge
  const caust = M(geo('dropCaust', () => { const p = new THREE.PlaneGeometry(1, 1); p.rotateX(-Math.PI / 2); return p; }), addMat(hdr(color, 0.6), { map: radialTex(), opacity: 0.3 })); caust.position.y = 0.005; caust.renderOrder = 7; group.add(caust);
  const rim = new THREE.Mesh(geo('dropRim', () => { const g = new THREE.RingGeometry(0.9, 1.04, 48); g.rotateX(-Math.PI / 2); return g; }), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false })); rim.position.y = 0.004; group.add(rim);
  const splash = makeRing(ctx, { color: mixHex(color, '#ffffff', 0.3), rmax: 1 }); splash.mesh.position.y = 0.01; group.add(splash.mesh);
  const bits = []; const Rr = rng(11);
  for (let i = 0; i < 9; i++) { const b = M(geo('dropBit', () => new THREE.SphereGeometry(1, 12, 8)), mat); b.visible = false; b.renderOrder = 8; group.add(b); bits.push({ m: b, a: (i / 9) * Math.PI * 2 + Rr() * 0.4, v: 0.7 + Rr() * 0.6, s: 0.1 + Rr() * 0.12 }); }
  const api = {
    group, mat,
    // mode 'sit' (dome on the glass, squash 0..1 = flatter) or 'fall' (teardrop in the air). r = radius
    set({ pos, mode = 'sit', squash = 0, radius = r, alpha = 1 } = {}) {
      if (pos) group.position.copy(toV3(pos));
      dome.visible = mode === 'sit'; ball.visible = mode === 'fall';
      dome.scale.set(radius * (1 + 0.25 * squash), radius * (1 - 0.5 * squash), radius * (1 + 0.25 * squash));
      ball.scale.setScalar(radius * 0.8);
      caust.visible = rim.visible = mode === 'sit'; caust.scale.setScalar(radius * 1.3); rim.scale.setScalar(radius * (1 + 0.25 * squash));
      mat.opacity = 0.4 * alpha; caust.material.opacity = 0.3 * alpha; rim.material.opacity = 0.35 * alpha; group.visible = alpha > 0.001;
      return api;
    },
    // impact: k 0..1. ring expands to ~ringR, little droplets fly out in ballistic arcs
    splash(k, { ringR = 3, alpha = 1 } = {}) {
      splash.set(k, { size: ringR, alpha: 0.6 * alpha });
      for (const b of bits) {
        const on = k > 0.001 && k < 0.95; b.m.visible = on; if (!on) continue;
        const d = b.v * ringR * 0.7 * easeOut(k), y = Math.max(0, 4 * b.v * k * (1 - k) * 1.6);
        b.m.position.set(Math.cos(b.a) * d, y, Math.sin(b.a) * d); b.m.scale.setScalar(b.s * r * 2 * (1 - k * 0.7));
      }
      return api;
    },
  };
  api.set({}); api.splash(0);
  return api;
}

// =====================================================================================================
// 8. DOM label tracking a 3D point
// =====================================================================================================
export function makeLabel(ctx, text, { sub = '', dx = 70, dy = -90, size = 34, color = '#ffffff', subColor = '#9aa0aa', dot = true, align = 'left', line = true } = {}) {
  size = size || 34;
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;opacity:0;will-change:transform,opacity;';
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('width', '1080'); svg.setAttribute('height', '1920'); svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;';
  const ln = document.createElementNS(svgNS, 'line'); ln.setAttribute('stroke', 'rgba(255,255,255,0.75)'); ln.setAttribute('stroke-width', '2'); svg.appendChild(ln);
  const dt = document.createElementNS(svgNS, 'circle'); dt.setAttribute('r', '6'); dt.setAttribute('fill', '#ffffff'); svg.appendChild(dt);
  const ring = document.createElementNS(svgNS, 'circle'); ring.setAttribute('r', '13'); ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', 'rgba(255,255,255,0.45)'); ring.setAttribute('stroke-width', '2'); svg.appendChild(ring);
  if (!dot) { dt.style.display = 'none'; ring.style.display = 'none'; }
  if (!line) ln.style.display = 'none';
  const box = document.createElement('div');
  box.style.cssText = `position:absolute;white-space:nowrap;font-family:Figtree,Inter,sans-serif,Fallback;font-weight:600;font-size:${size}px;color:${color};letter-spacing:0.01em;text-shadow:0 2px 14px rgba(0,0,0,0.6),0 0 5px rgba(0,0,0,0.75);line-height:1.15;`;
  box.innerHTML = `<div class="t"></div><div class="s" style="font-weight:500;font-size:${Math.round(size * 0.72)}px;color:${subColor};margin-top:4px"></div>`;
  box.querySelector('.t').textContent = text; box.querySelector('.s').textContent = sub;
  el.appendChild(svg); el.appendChild(box); ctx.fx.appendChild(el);
  const v = V(); let world = null, A = 0, offs = { dx, dy };
  const place = () => {
    if (!world || A <= 0.001) { el.style.opacity = 0; return; }
    v.copy(world).project(ctx.camera);
    if (v.z > 1) { el.style.opacity = 0; return; }
    const x = (v.x + 1) / 2 * ctx.W, y = (1 - v.y) / 2 * ctx.H, tx = x + offs.dx, ty = y + offs.dy;
    ln.setAttribute('x1', x); ln.setAttribute('y1', y); ln.setAttribute('x2', tx); ln.setAttribute('y2', ty);
    dt.setAttribute('cx', x); dt.setAttribute('cy', y); ring.setAttribute('cx', x); ring.setAttribute('cy', y);
    const right = align === 'left' ? offs.dx >= 0 : align === 'right';
    box.style.left = (right ? tx + 10 : tx - 10) + 'px'; box.style.top = (ty - size * 0.6) + 'px';
    box.style.transform = right ? 'none' : 'translateX(-100%)'; box.style.textAlign = right ? 'left' : 'right';
    el.style.opacity = A;
  };
  const api = {
    el,
    // call EVERY frame while shown: world point (array or V3), alpha 0..1 (0 hides). Positioned after the camera moves.
    set(worldPos, alpha = 1, o = {}) {
      world = worldPos ? toV3(worldPos) : null; A = alpha; if (o.dx != null) offs.dx = o.dx; if (o.dy != null) offs.dy = o.dy;
      if (o.text != null) box.querySelector('.t').textContent = o.text; if (o.sub != null) box.querySelector('.s').textContent = o.sub;
      if (Array.isArray(ctx.after)) ctx.after.push(place); else place();
      if (alpha <= 0.001) el.style.opacity = 0;
      return api;
    },
    hide() { A = 0; el.style.opacity = 0; return api; },
  };
  return api;
}

// =====================================================================================================
// 9. icons (face +Z, ~4 units tall, origin at centre)
// =====================================================================================================
function bar2(a, b, th) {   // rounded thick segment from a to b in XY as a Shape
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), s = rrShape(L + th, th, th / 2);
  const ang = Math.atan2(dy, dx), c = Math.cos(ang), sn = Math.sin(ang), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const pts = s.getPoints(10).map((p) => new THREE.Vector2(mx + p.x * c - p.y * sn, my + p.x * sn + p.y * c));
  return new THREE.Shape(pts);
}
function extrudeShapes(shapes, depth = 0.6, bev = 0.12) {
  const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 12 });
  g.translate(0, 0, -depth / 2); return g;
}
export function makeIcon(ctx, kind = 'x', { size = 1 } = {}) {
  const env = libEnv(ctx);
  const group = new THREE.Group(); group.name = 'icon-' + kind;
  const inner = new THREE.Group(); group.add(inner); inner.scale.setScalar(size);
  const glowy = (col, ei = 0.55) => new THREE.MeshPhysicalMaterial({ color: col, emissive: new THREE.Color(col), emissiveIntensity: ei, roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMap: env, envMapIntensity: 1 });
  const mats = []; let setFn = () => {};
  const add = (g, m) => { const o = M(g, m, { cast: true }); inner.add(o); if (!mats.includes(m)) mats.push(m); return o; };
  if (kind === 'x') { const m = glowy(P.no); add(extrudeShapes([bar2([-1.5, -1.5], [1.5, 1.5], 0.95), bar2([-1.5, 1.5], [1.5, -1.5], 0.95)]), m); }
  else if (kind === 'check') { const m = glowy(P.ok); add(extrudeShapes([bar2([-1.75, 0.15], [-0.55, -1.15], 0.95), bar2([-0.55, -1.15], [1.85, 1.55], 0.95)]), m); }
  else if (kind === 'bolt') {
    const s = new THREE.Shape([[0.55, 2.2], [-1.35, -0.2], [-0.1, -0.2], [-0.6, -2.2], [1.4, 0.5], [0.15, 0.5], [0.55, 2.2]].map(([x, y]) => new THREE.Vector2(x, y)));
    add(extrudeShapes([s], 0.55, 0.1), glowy(P.body, 0.8));
  } else if (kind === 'snow') {
    const m = new THREE.MeshPhysicalMaterial({ color: P.snow, emissive: new THREE.Color('#9cc4ff'), emissiveIntensity: 0.35, roughness: 0.15, clearcoat: 1, envMap: env, envMapIntensity: 1.2, transmission: 0, sheen: 0.6, sheenColor: new THREE.Color('#bfe0ff') });
    const shapes = [];
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, c = Math.cos(a), s = Math.sin(a), rot = ([x, y]) => [x * c - y * s, x * s + y * c];
      shapes.push(bar2([0, 0], rot([2.1, 0]), 0.32));
      for (const d of [0.95, 1.5]) { const L = d === 0.95 ? 0.65 : 0.45; shapes.push(bar2(rot([d, 0]), rot([d + L * 0.7, L * 0.7]), 0.26), bar2(rot([d, 0]), rot([d + L * 0.7, -L * 0.7]), 0.26)); }
    }
    for (const sh of shapes) add(extrudeShapes([sh], 0.25, 0.07), m);
  } else if (kind === 'gauge') {
    const metal = new THREE.MeshPhysicalMaterial({ color: '#c3c8d0', metalness: 1, roughness: 0.25, envMap: env, envMapIntensity: 1.2 });
    const face = new THREE.MeshPhysicalMaterial({ color: '#10141b', roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.05, envMap: env, envMapIntensity: 0.8 });
    const disc = add(geo('gDisc', () => { const g = new THREE.CylinderGeometry(2.2, 2.2, 0.35, 64); g.rotateX(Math.PI / 2); return g; }), face);
    add(geo('gRim', () => new THREE.TorusGeometry(2.25, 0.16, 16, 64)), metal);
    const A0 = Math.PI * 1.25, SPAN = Math.PI * 1.5;
    const zone = (t0, t1, col) => { const m = M(new THREE.RingGeometry(1.55, 1.85, 48, 1, A0 - t1 * SPAN, (t1 - t0) * SPAN), new THREE.MeshBasicMaterial({ color: hdr(col, 1.1), toneMapped: false })); m.position.z = 0.19; inner.add(m); };
    zone(0, 0.55, P.ok); zone(0.55, 0.8, '#ffc53a'); zone(0.8, 1, P.no);
    for (let i = 0; i <= 10; i++) { const a = A0 - (i / 10) * SPAN, t = M(geo('gTick' + (i % 5 === 0), () => new THREE.BoxGeometry(i % 5 === 0 ? 0.36 : 0.22, 0.06, 0.04)), new THREE.MeshBasicMaterial({ color: '#c9cfd8' })); t.position.set(Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0.2); t.rotation.z = a; inner.add(t); }
    const needle = new THREE.Group(); needle.position.z = 0.26; inner.add(needle);
    const nm = glowy(P.no, 0.4); const nd = M(geo('gNeedle', () => { const s = new THREE.Shape([[-0.09, -0.3], [0.09, -0.3], [0.025, 1.65], [-0.025, 1.65]].map(([x, y]) => new THREE.Vector2(x, y))); return new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false }); }), nm); needle.add(nd);
    add(geo('gCap', () => { const g = new THREE.CylinderGeometry(0.24, 0.24, 0.2, 24); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.32); return g; }), metal);
    setFn = (v) => { needle.rotation.z = (A0 - Math.PI / 2) - clamp(v, 0, 1.08) * SPAN; };
    setFn(0); mats.push(nm);
  } else if (kind === 'water' || kind === 'na' || kind === 'cl' || kind === 'salt') {
    const atom = (r, col, ei = 0.12) => new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, envMap: env, envMapIntensity: 1, emissive: new THREE.Color(col), emissiveIntensity: ei });
    const sph = (r) => geo('atom' + r, () => new THREE.SphereGeometry(r, 32, 20));
    const sign = (parent, r, plus) => { const m = new THREE.MeshBasicMaterial({ color: '#ffffff' }); const h = M(geo('sgnH', () => new RoundedBoxGeometry(0.5, 0.13, 0.1, 2, 0.04)), m); h.position.z = r * 0.98; parent.add(h); if (plus) { const v = M(geo('sgnV', () => new RoundedBoxGeometry(0.13, 0.5, 0.1, 2, 0.04)), m); v.position.z = r * 0.98; parent.add(v); } };
    const water = (x, y, rot = 0) => {
      const g = new THREE.Group(); g.position.set(x, y, 0); g.rotation.z = rot; inner.add(g);
      const o = M(sph(1.0), atom(1, '#ff4b55'), { cast: true }); g.add(o);
      for (const s of [-1, 1]) { const a = (90 + s * 52.25) * D2R, h = M(sph(0.6), atom(0.6, '#f2f4f8', 0.05), { cast: true }); h.position.set(Math.cos(a) * 1.05, -Math.sin(a) * 1.05, 0.15); g.add(h); }
      return g;
    };
    const ion = (x, y, r, col, plus) => { const g = new THREE.Group(); g.position.set(x, y, 0); inner.add(g); g.add(M(sph(r), atom(r, col, 0.25), { cast: true })); sign(g, r, plus); return g; };
    if (kind === 'water') water(0, 0); else if (kind === 'na') ion(0, 0, 0.85, '#a57bff', true); else if (kind === 'cl') ion(0, 0, 1.15, '#3ad08f', false);
    else { water(-1.6, 1.0, 0.3); water(1.7, -1.3, -0.6); ion(1.4, 1.5, 0.75, '#a57bff', true); ion(-1.3, -1.6, 1.0, '#3ad08f', false); }
  } else if (kind === 'question') {
    const m = glowy(P.chargeHot, 0.7);
    const pts = []; for (let i = 0; i <= 14; i++) { const a = Math.PI * 1.05 - (i / 14) * Math.PI * 1.45; pts.push([Math.cos(a) * 1.2, 1.0 + Math.sin(a) * 1.0]); }
    pts.push([0, -0.45]);
    const sh = []; for (let i = 1; i < pts.length; i++) sh.push(bar2(pts[i - 1], pts[i], 0.7));
    for (const s of sh) add(extrudeShapes([s], 0.6, 0.1), m);
    const d = add(geo('qDot', () => new THREE.SphereGeometry(0.45, 24, 16)), m); d.position.set(0, -1.6, 0);
  }
  const api = {
    group, mats,
    set(v) { setFn(v); return api; },           // gauge needle 0..1
    glow(k) { for (const m of mats) if (m.emissive && m.userData.ei0 === undefined) m.userData.ei0 = m.emissiveIntensity; for (const m of mats) if (m.emissive) m.emissiveIntensity = m.userData.ei0 * k; return api; },
    // pop-in scale with overshoot: k 0..1
    pop(k) { const s = k <= 0 ? 0 : 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2); group.scale.setScalar(Math.max(1e-4, s)); group.visible = k > 0; return api; },
  };
  return api;
}

// =====================================================================================================
// 10. studio floor
// =====================================================================================================
export function studioFloor(ctx, { r = 70, y = 0, color = '#0d1016', shadow = 0.55 } = {}) {
  const env = libEnv(ctx);
  const group = new THREE.Group(); group.position.y = y;
  const { g, t } = canvasTex(256, 256, false);
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, '#fff'); gr.addColorStop(0.45, '#bbb'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const disc = M(geo('floor', () => { const c = new THREE.CircleGeometry(1, 96); c.rotateX(-Math.PI / 2); return c; }),
    capGlare(new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, metalness: 0, specularIntensity: 0.35, envMap: env, envMapIntensity: 0.25, transparent: true, alphaMap: t, depthWrite: false }), 0.3), { recv: true });
  disc.scale.setScalar(r); group.add(disc);
  const catcher = M(geo('floor', () => null), new THREE.ShadowMaterial({ opacity: shadow, transparent: true, depthWrite: false }), { recv: true });
  catcher.scale.setScalar(r * 0.6); catcher.position.y = 0.01; group.add(catcher);
  return { group, disc, catcher };
}
