// CITY kit: the golden-hour "paper city" (units = m, 1 unit = 1 m, +Y up). API: guides/styles/explainer3d.md (Kit: city).
//   buildCity(ctx)  -> the one shared city (ctx.city), built once and centred on the world origin, plus ctx.traffic.
// Core calls buildCity automatically when any beat has look:'city'. Everything is seeded: same city every frame.
// of every render sees the same buildings in the same places.
//
// Layout (x = east, z = south, y = up; 1 unit ≈ 1 m):
//   suburb (home)     south-west  around (-430, 430)
//   elevated highway  runs SW → NE, y = 8, from (-900,180) to (540,-950)
//   downtown (dest)   north-east  around (560,-380); destination tower at (640,-335)
//   route  = driveway → suburb street z=410 → avenue x=-330 → arterial z=250 → on-ramp
//            → highway → main exit → downtown street z=-310 → destination
//   alt    = branches off the highway early (alt exit) → street z=-70 → avenue x=550 → z=-310
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { C as P } from '../core/palette.js';
import { rng, clamp, smooth } from '../core/util.js';

const UP = new THREE.Vector3(0, 1, 0);
const HWY_Y = 8;

// ---------- curves ----------

function cr(points, closed = false) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed, 'centripetal');
  c.arcLengthDivisions = 3000;
  return c;
}

// polyline with filleted corners, densely sampled → smooth curve that follows the polyline
function rounded(points, radius = 14, step = 3) {
  const P3 = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const out = [P3[0].clone()];
  for (let i = 1; i < P3.length - 1; i++) {
    const a = P3[i - 1], b = P3[i], c = P3[i + 1];
    const ab = b.clone().sub(a), bc = c.clone().sub(b);
    const r = Math.min(radius, ab.length() / 2.2, bc.length() / 2.2);
    const p1 = b.clone().sub(ab.clone().normalize().multiplyScalar(r));
    const p2 = b.clone().add(bc.clone().normalize().multiplyScalar(r));
    pushLine(out, p1, step);
    const q = new THREE.QuadraticBezierCurve3(p1, b, p2);
    for (let k = 1; k <= 10; k++) out.push(q.getPoint(k / 10));
  }
  pushLine(out, P3[P3.length - 1], step);
  return out;
}
function pushLine(out, to, step) {
  const from = out[out.length - 1];
  const n = Math.max(1, Math.ceil(from.distanceTo(to) / step));
  for (let k = 1; k <= n; k++) out.push(from.clone().lerp(to, k / n));
}

// a path object: curve + helpers in world units (s = metres along)
function makePath(name, curve) {
  const length = curve.getLength();
  const tmpT = new THREE.Vector3();
  return {
    name, curve, length,
    at(s) { return curve.getPointAt(clamp(s / length)); },
    tangent(s) { return curve.getTangentAt(clamp(s / length), tmpT).clone(); },
    // point offset to the right of travel direction by `off` metres, lifted by `dy`
    side(s, off = 0, dy = 0) {
      const p = this.at(s), tg = this.tangent(s);
      const right = new THREE.Vector3().crossVectors(tg, UP).normalize();
      return p.addScaledVector(right, off).add(new THREE.Vector3(0, dy, 0));
    },
    // nearest s to a world point (coarse + refine)
    nearest(pt) {
      const v = pt.isVector3 ? pt : new THREE.Vector3(...pt);
      let best = 0, bd = Infinity;
      const N = Math.ceil(length / 4);
      for (let i = 0; i <= N; i++) { const s = (i / N) * length; const d = curve.getPointAt(s / length).distanceToSquared(v); if (d < bd) { bd = d; best = s; } }
      for (let ds = -4; ds <= 4; ds += 0.25) { const s = clamp(best + ds, 0, length); const d = curve.getPointAt(s / length).distanceToSquared(v); if (d < bd) { bd = d; best = s; } }
      return best;
    },
  };
}

// ---------- ribbons (flat strips that follow a path) ----------
// uv.x runs 0→1 along the strip, uv.y 0→1 across. Shader materials can use uv.x for reveals.
export function ribbonGeometry(path, s0, s1, width, { off = 0, dy = 0.05, step = 2, profile = null } = {}) {
  const n = Math.max(2, Math.ceil(Math.abs(s1 - s0) / step));
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n, s = s0 + (s1 - s0) * k;
    const p = path.at(s), tg = path.tangent(s);
    const right = new THREE.Vector3().crossVectors(tg, UP).normalize();
    const w = profile ? profile(k) * width : width;
    const c = p.clone().addScaledVector(right, off).add(new THREE.Vector3(0, dy, 0));
    const L = c.clone().addScaledVector(right, -w / 2), R = c.clone().addScaledVector(right, w / 2);
    pos.push(L.x, L.y, L.z, R.x, R.y, R.z);
    uv.push(k, 0, k, 1);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A strip material with a reveal window along its length and soft edges.
//   uniforms: color, opacity, from (0..1), to (0..1), glow (adds emissive for bloom), dash (0 = solid)
export function ribbonMaterial(color, { opacity = 1, glow = 0, dash = 0, dashSpeed = 0, edge = 0.12, depthTest = true } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: {
      color: { value: new THREE.Color(color) },
      opacity: { value: opacity },
      from: { value: 0 }, to: { value: 1 },
      glow: { value: glow },
      dash: { value: dash }, dashPhase: { value: 0 }, dashSpeed: { value: dashSpeed },
      edge: { value: edge },
      len: { value: 100 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 color; uniform float opacity, from, to, glow, dash, dashPhase, edge, len;
      varying vec2 vUv;
      void main(){
        if (vUv.x < from || vUv.x > to) discard;
        float across = 1.0 - smoothstep(1.0 - edge, 1.0, abs(vUv.y * 2.0 - 1.0));
        float a = opacity * across;
        if (dash > 0.0) { float d = fract(vUv.x * len / dash - dashPhase); a *= step(0.45, d); }
        vec3 c = color * (1.0 + glow);
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
  });
}

// ---------- building blocks ----------

function boxGeo(w, h, d, y0 = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y0 + h / 2, 0); return g; }

function instanced(geo, mat, list, colorOf) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  list.forEach((b, i) => {
    e.set(0, b.ry || 0, 0); q.setFromEuler(e);
    M.compose(new THREE.Vector3(b.x, b.y || 0, b.z), q, new THREE.Vector3(b.sx, b.sy, b.sz));
    m.setMatrixAt(i, M);
    m.setColorAt(i, new THREE.Color(colorOf(b, i)));
  });
  m.count = list.length;
  m.castShadow = true; m.receiveShadow = true;
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  return m;
}

// faint floor lines + window bands for towers, in world space so instance scaling never stretches them
function floorLines(mat, strength = 0.06, floorH = 3.6) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz; vWNrm = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float side = 1.0 - abs(vWNrm.y);
        float f = fract(vWPos.y / ${floorH.toFixed(2)});
        float band = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.55, 0.62, f));
        diffuseColor.rgb *= 1.0 - side * ${strength.toFixed(3)} * (1.0 - band) - side * 0.02;
        diffuseColor.rgb *= mix(0.94, 1.0, smoothstep(0.0, 14.0, vWPos.y));`);
  };
  return mat;
}

// ---------- the world ----------

export function buildWorld(scene) {
  const R = rng(20261014);
  const world = { group: new THREE.Group(), paths: {}, roads: [], landmarks: {} };
  scene.add(world.group);
  const add = (o) => { world.group.add(o); return o; };

  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(P.skyTop) }, hor: { value: new THREE.Color(P.skyHorizon) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, hor; varying vec3 vP;
      void main(){ float h = normalize(vP).y; vec3 c = mix(hor, top, smoothstep(-0.02, 0.45, h)); gl_FragColor = vec4(c,1.0);
      #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -10;
  world.sky = add(sky);

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: P.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  world.ground = add(ground);

  // ----- paths -----
  const hwyPts = [[-1100, 190], [-900, 180], [-600, 170], [-350, 140], [-120, 80], [80, -10], [250, -130], [380, -280], [470, -460], [520, -700], [540, -950], [545, -1250]];
  const highway = makePath('highway', cr(hwyPts.map(([x, z]) => [x, HWY_Y, z])));

  const HL = 13;          // highway half width
  const laneOff = [2.8, 6.4, 10.0];

  // on-ramp: arterial z=250 at x=-170 rising onto highway right side
  const sMerge = highway.nearest([-30, HWY_Y, 40]);
  const mergeP = highway.side(sMerge, 8);
  const onRamp = makePath('onRamp', cr([[-170, 0.1, 250], [-140, 0.4, 222], [-112, 2.4, 176], [-88, 5.2, 128], [mergeP.x - 18, 7.6, mergeP.z + 22], [mergeP.x, HWY_Y, mergeP.z]].map((p) => p)));

  // main exit near (380,-280), ramp down east to downtown street z=-310
  const sExit = highway.nearest([360, HWY_Y, -255]);
  const exitP = highway.side(sExit, 8);
  const exitRamp = makePath('exitRamp', cr([[exitP.x, HWY_Y, exitP.z], [exitP.x + 22, 7.4, exitP.z - 14], [418, 5.4, -292], [452, 2.4, -307], [486, 0.1, -310], [500, 0.1, -310]]));

  // alt exit (earlier) near (150,-60) down to street z=-70
  const sAlt = highway.nearest([150, HWY_Y, -55]);
  const altP = highway.side(sAlt, 8);
  const altRamp = makePath('altRamp', cr([[altP.x, HWY_Y, altP.z], [altP.x + 24, 7.2, altP.z + 2], [altP.x + 52, 4.2, -62], [altP.x + 82, 1.0, -70], [altP.x + 104, 0.1, -70]]));

  // feeder on-ramp joining the highway upstream of the exit (the ripple spreads into it)
  const sFeed = highway.nearest([270, HWY_Y, -150]);
  const feedP = highway.side(sFeed, 8);
  const feeder = makePath('feeder', cr([[410, 0.1, 90], [410, 0.1, 10], [400, 0.5, -40], [380, 3.0, -90], [feedP.x + 26, 6.6, feedP.z + 18], [feedP.x, HWY_Y, feedP.z]]));
  // the street feeding that ramp
  const feederStreet = makePath('feederStreet', cr(rounded([[730, 0.1, 90], [410, 0.1, 90]]).map((v) => [v.x, v.y, v.z])));

  // ----- the route (one smooth path from driveway to destination) -----
  const home = new THREE.Vector3(-430, 0, 438);
  const dest = new THREE.Vector3(640, 0, -338);
  const groundA = rounded([[-430, 0.1, 424], [-430, 0.1, 410], [-330, 0.1, 410], [-330, 0.1, 250], [-170, 0.1, 250]], 12);
  const pts = [...groundA];
  // on-ramp
  for (let i = 1; i <= 60; i++) pts.push(onRamp.at((i / 60) * onRamp.length));
  // highway, middle-right lane, until the exit
  const hs0 = sMerge + 4, hs1 = sExit;
  for (let s = hs0; s <= hs1; s += 3) pts.push(highway.side(s, 8, 0));
  for (let i = 1; i <= 50; i++) pts.push(exitRamp.at((i / 50) * exitRamp.length));
  const groundB = rounded([[500, 0.1, -310], [612, 0.1, -310]], 12);
  pts.push(...groundB.slice(1));
  const route = makePath('route', cr(dedupe(pts).map((v) => [v.x, v.y, v.z])));

  // alt route: from the alt branch on the highway → ramp → z=-70 → x=550 → z=-310 → dest
  const altPts = [];
  for (let s = sAlt - 60; s <= sAlt; s += 3) altPts.push(highway.side(s, 8, 0));
  for (let i = 1; i <= 50; i++) altPts.push(altRamp.at((i / 50) * altRamp.length));
  altPts.push(...rounded([[altP.x + 104, 0.1, -70], [550, 0.1, -70], [550, 0.1, -310], [612, 0.1, -310]], 14).slice(1));
  const alt = makePath('alt', cr(dedupe(altPts).map((v) => [v.x, v.y, v.z])));

  Object.assign(world.paths, { highway, onRamp, exitRamp, altRamp, feeder, feederStreet, route, alt });
  world.landmarks = {
    home, dest,
    merge: highway.at(sMerge), exit: highway.at(sExit), altBranch: highway.at(sAlt), feederMerge: highway.at(sFeed),
    downtown: new THREE.Vector3(560, 0, -390),
  };
  world.s = {
    hwyMerge: sMerge, hwyExit: sExit, hwyAlt: sAlt, hwyFeed: sFeed,
    routeHwyStart: route.nearest(highway.side(hs0, 8)), routeExit: route.nearest(exitP), routeBranch: route.nearest(highway.side(sAlt, 8)),
    altBranch: alt.nearest(highway.side(sAlt, 8)),
  };
  world.HWY_Y = HWY_Y; world.HL = HL; world.laneOff = laneOff;

  // ----- road surfaces -----
  const asphalt = new THREE.MeshStandardMaterial({ color: P.asphalt, roughness: 0.92 });
  const asphaltL = new THREE.MeshStandardMaterial({ color: P.asphaltLight, roughness: 0.95 });
  const streetM = new THREE.MeshStandardMaterial({ color: P.street, roughness: 1 });
  const laneM = new THREE.MeshStandardMaterial({ color: P.lane, roughness: 0.8 });
  const barrierM = new THREE.MeshStandardMaterial({ color: P.barrier, roughness: 0.9, side: THREE.DoubleSide });
  const pillarM = new THREE.MeshStandardMaterial({ color: P.pillar, roughness: 0.95 });

  const roadMesh = (path, width, mat, opts = {}) => {
    const m = new THREE.Mesh(ribbonGeometry(path, opts.s0 ?? 0, opts.s1 ?? path.length, width, { dy: opts.dy ?? 0.06, off: opts.off ?? 0, step: 2 }), mat);
    m.receiveShadow = true; return add(m);
  };
  // elevated deck: top surface + slab underside + barriers + pillars
  const deck = (path, width, { s0 = 0, s1 = path.length, minY = 1.2 } = {}) => {
    roadMesh(path, width, asphalt, { s0, s1 });
    // slab: a box strip under the road, built as a thick ribbon
    const slab = new THREE.Mesh(extrudeStrip(path, s0, s1, width + 1.2, 1.4, -1.45, minY), new THREE.MeshStandardMaterial({ color: P.pillar, roughness: 1, side: THREE.DoubleSide }));
    slab.castShadow = true; slab.receiveShadow = true; add(slab);
    for (const sideSign of [-1, 1]) {
      const b = new THREE.Mesh(extrudeStrip(path, s0, s1, 0.5, 1.0, 0.0, minY, sideSign * (width / 2 + 0.1)), barrierM);
      b.castShadow = true; b.receiveShadow = true; add(b);
    }
    for (let s = s0 + 14; s < s1; s += 30) {
      const p = path.at(s); if (p.y < 3) continue;
      const pil = new THREE.Mesh(boxGeo(2.2, p.y - 1.4, Math.min(width * 0.55, 9)), pillarM);
      pil.position.set(p.x, 0, p.z);
      const tg = path.tangent(s); pil.rotation.y = Math.atan2(tg.x, tg.z);
      pil.castShadow = true; pil.receiveShadow = true; add(pil);
    }
  };
  deck(highway, HL * 2);
  // highway lane markings: solid edges + dashed lanes + median
  for (const sg of [-1, 1]) {
    roadMesh(highway, 0.35, laneM, { off: sg * (HL - 1.0), dy: 0.08 });
    for (const lo of [4.6, 8.2]) lanes(highway, sg * lo, laneM);
  }
  const med = new THREE.Mesh(extrudeStrip(highway, 0, highway.length, 0.7, 0.8, 0, 1.2, 0), barrierM); med.castShadow = true; add(med);

  for (const [p, w] of [[onRamp, 9], [exitRamp, 9], [altRamp, 9], [feeder, 9]]) {
    const yMid = p.at(p.length * 0.5).y;
    deck(p, w, {});
    if (yMid < 0) roadMesh(p, w, asphalt);
  }
  // ground roads on the route + alt, darker than the grid
  const routeGround = [
    [[-430, 424], [-430, 410]], [[-620, 410], [-250, 410]], [[-330, 410], [-330, 250]], [[-410, 250], [-170, 250]],
    [[480, -310], [700, -310]], [[200, -70], [700, -70]], [[550, -70], [550, -310]],
  ];
  for (const seg of routeGround) {
    const pth = makePath('g', cr(seg.map(([x, z]) => [x, 0.1, z])));
    roadMesh(pth, seg === routeGround[0] ? 5 : 13, asphaltL, { dy: 0.07 });
    lanes(pth, 0, laneM, 0.25, 4, 6);
  }
  roadMesh(feederStreet, 13, asphaltL, { dy: 0.07 });

  function lanes(path, off, mat, w = 0.3, dashL = 5, gapL = 9) {
    const geos = [];
    for (let s = 2; s < path.length - dashL; s += dashL + gapL) {
      geos.push(ribbonGeometry(path, s, s + dashL, w, { off, dy: 0.09, step: dashL }));
    }
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), mat); m.receiveShadow = true; add(m);
  }

  // ----- the street grid -----
  const GX0 = -330, GZ0 = 250, G = 80, SW = 11;
  const xMin = -810, xMax = 890, zMin = -870, zMax = 650;
  const xs = [], zs = [];
  for (let x = GX0 - G * 6; x <= xMax; x += G) if (x >= xMin) xs.push(x);
  for (let z = GZ0 - G * 14; z <= zMax; z += G) if (z >= zMin) zs.push(z);
  const streetGeos = [];
  for (const x of xs) { const g = new THREE.PlaneGeometry(SW, zMax - zMin); g.rotateX(-Math.PI / 2); g.translate(x, 0.03, (zMin + zMax) / 2); streetGeos.push(g); }
  for (const z of zs) { const g = new THREE.PlaneGeometry(xMax - xMin, SW); g.rotateX(-Math.PI / 2); g.translate((xMin + xMax) / 2, 0.035, z); streetGeos.push(g); }
  const streets = new THREE.Mesh(mergeGeometries(streetGeos), streetM); streets.receiveShadow = true; add(streets);

  // road sample points for keeping buildings off roads
  const roadSamples = [];
  const sample = (path, half, step = 5) => { for (let s = 0; s <= path.length; s += step) { const p = path.at(s); roadSamples.push([p.x, p.z, half]); } };
  sample(highway, HL + 7); sample(onRamp, 9); sample(exitRamp, 9); sample(altRamp, 9); sample(feeder, 9);
  const blocked = (x, z, r) => roadSamples.some(([sx, sz, h]) => (sx - x) ** 2 + (sz - z) ** 2 < (h + r) ** 2);

  // ----- blocks, buildings, trees -----
  const plates = [], houses = [], roofs = [], mids = [], towers = [], trees = [], parks = [], tops = [];
  const DT = world.landmarks.downtown;
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const x0 = xs[i] + SW / 2, x1 = xs[i + 1] - SW / 2, z0 = zs[j] + SW / 2, z1 = zs[j + 1] - SW / 2;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, bw = x1 - x0, bd = z1 - z0;
    const dDown = Math.hypot(cx - DT.x, cz - DT.z);
    const suburb = cx < -150 && cz > 170;
    const isPark = !suburb && R() < 0.07 && dDown > 160;
    plates.push({ x: cx, z: cz, sx: bw, sy: 0.25, sz: bd, park: isPark });
    if (isPark) { for (let k = 0; k < 14; k++) { const tx = x0 + 6 + R() * (bw - 12), tz = z0 + 6 + R() * (bd - 12); if (!blocked(tx, tz, 3)) trees.push(tree(tx, tz, R)); } continue; }
    if (suburb) {
      // 3 x 3 houses per block, front yards with trees
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        if (a === 1 && b === 1) continue;
        const hx = x0 + bw * (a + 0.5) / 3, hz = z0 + bd * (b + 0.5) / 3;
        if (blocked(hx, hz, 10)) continue;
        if (Math.hypot(hx - home.x, hz - home.z) < 14) continue;   // the hero home is placed by hand
        const w = 9 + R() * 3, d = 8 + R() * 3, h = 4.5 + R() * 2.2, ry = R() < 0.5 ? 0 : Math.PI / 2;
        houses.push({ x: hx, z: hz, sx: w, sy: h, sz: d, ry, c: P.houseWalls[(R() * 4) | 0] });
        roofs.push({ x: hx, y: h, z: hz, sx: w * 0.78, sy: 3 + R() * 1.4, sz: d * 0.78, ry: ry + Math.PI / 4, c: P.roofs[(R() * 5) | 0] });
        if (R() < 0.8) trees.push(tree(hx + (R() - 0.5) * 18, hz + (R() - 0.5) * 18, R, 0.8));
      }
      continue;
    }
    // city: split block into 2-4 lots
    const downtown = dDown < 300;
    const nx = downtown ? (R() < 0.5 ? 1 : 2) : 2, nz = downtown ? (R() < 0.5 ? 1 : 2) : (R() < 0.5 ? 2 : 3);
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const lw = bw / nx, ld = bd / nz;
      const lx = x0 + lw * (a + 0.5), lz = z0 + ld * (b + 0.5);
      const w = lw - 4 - R() * 6, d = ld - 4 - R() * 6;
      if (blocked(lx, lz, Math.max(w, d) / 2)) continue;
      if (Math.hypot(lx - dest.x, lz - dest.z) < 30) continue;    // destination tower placed by hand
      if (downtown) {
        const k = 1 - dDown / 300;
        const h = 28 + k * k * (120 + R() * 90) + R() * 25;
        towers.push({ x: lx, z: lz, sx: w, sy: h, sz: d, c: P.towers[(R() * 5) | 0] });
        if (R() < 0.6) tops.push({ x: lx + (R() - 0.5) * w * 0.4, y: h, z: lz + (R() - 0.5) * d * 0.4, sx: w * (0.25 + R() * 0.3), sy: 2 + R() * 5, sz: d * (0.25 + R() * 0.3), c: P.towers[(R() * 5) | 0] });
      } else {
        const h = 8 + Math.pow(R(), 2.2) * 42;
        mids.push({ x: lx, z: lz, sx: w, sy: h, sz: d, c: P.buildings[(R() * 8) | 0] });
        if (R() < 0.35) tops.push({ x: lx + (R() - 0.5) * w * 0.4, y: h, z: lz + (R() - 0.5) * d * 0.4, sx: 3 + R() * 4, sy: 1.5 + R() * 2, sz: 3 + R() * 4, c: P.buildings[(R() * 8) | 0] });
      }
    }
    // street trees on the block edges
    for (let k = 0; k < 4; k++) { const tx = R() < 0.5 ? x0 + 2 : x1 - 2, tz = z0 + R() * bd; if (!blocked(tx, tz, 3)) trees.push(tree(tx, tz, R, 0.7)); }
  }
  // the hero's home and the destination tower
  houses.push({ x: home.x, z: home.z, sx: 12, sy: 5.6, sz: 10, ry: 0, c: '#f6f1e7' });
  roofs.push({ x: home.x, y: 5.6, z: home.z, sx: 9.6, sy: 4, sz: 7.8, ry: Math.PI / 4, c: '#c98468' });
  towers.push({ x: dest.x, z: dest.z - 4, sx: 30, sy: 118, sz: 30, c: '#d9dee4', dest: true });

  const plateMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  add(instanced(boxGeo(1, 1, 1), plateMat, plates, (b) => (b.park ? P.park : P.block))).castShadow = false;
  const bMat = floorLines(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94 }), 0.05, 3.6);
  const tMat = floorLines(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0.05 }), 0.09, 4.0);
  world.buildings = add(instanced(boxGeo(1, 1, 1), bMat, mids, (b) => b.c));
  world.towers = add(instanced(boxGeo(1, 1, 1), tMat, towers, (b) => b.c));
  add(instanced(boxGeo(1, 1, 1), bMat, tops, (b) => b.c));
  add(instanced(boxGeo(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), houses, (b) => b.c));
  const roofGeo = new THREE.ConeGeometry(0.7071, 1, 4, 1); roofGeo.translate(0, 0.5, 0);
  add(instanced(roofGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), roofs, (b) => b.c));
  // trees: canopy + trunk
  const canopy = new THREE.IcosahedronGeometry(1, 0); canopy.translate(0, 0, 0);
  add(instanced(canopy, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true }), trees, (b) => b.c));
  add(instanced(boxGeo(1, 1, 1), new THREE.MeshStandardMaterial({ color: P.trunk, roughness: 1 }), trees.map((t) => ({ x: t.x, z: t.z, sx: 0.5, sy: t.y, sz: 0.5 })), () => P.trunk));
  world.lists = { towers, mids, houses, trees };

  // destination + home handy refs
  world.landmarks.destTop = new THREE.Vector3(dest.x, 118, dest.z - 4);
  world.landmarks.homeDoor = new THREE.Vector3(home.x, 0, home.z - 5);

  // ----- hero car -----
  world.hero = makeHero(world);
  add(world.hero.mesh);

  // ----- route segments ("pieces of road") with their predicted minutes -----
  const L = route.length;
  const cuts = [0, route.nearest([-330, 0.1, 405]), route.nearest([-330, 0.1, 255]), world.s.routeHwyStart,
    world.s.routeHwyStart + (world.s.routeExit - world.s.routeHwyStart) * 0.36,
    world.s.routeHwyStart + (world.s.routeExit - world.s.routeHwyStart) * 0.7,
    world.s.routeExit, route.nearest([500, 0.1, -310]), L];
  const mins = [2, 3, 3, 4, 3, 4, 2, 2];   // sums to 23 → leave 6:19, arrive 6:42
  world.segments = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    world.segments.push({ i, s0: cuts[i], s1: cuts[i + 1], mid: (cuts[i] + cuts[i + 1]) / 2, minutes: mins[i] });
  }
  return world;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.length || out[out.length - 1].distanceTo(p) > 1.2) out.push(p);
  return out;
}

function tree(x, z, R, scale = 1) {
  const s = (2.6 + R() * 2.2) * scale;
  return { x, z, y: s * 1.1, sx: s, sy: s * 1.15, sz: s, c: P.trees[(R() * 4) | 0], ry: R() * 6 };
}

// a thick strip (box-ish) along a path: used for deck slabs, barriers, medians
function extrudeStrip(path, s0, s1, width, height, yOff, minY = -Infinity, off = 0) {
  const n = Math.max(2, Math.ceil((s1 - s0) / 3));
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + (s1 - s0) * (i / n);
    const p = path.at(s), tg = path.tangent(s);
    const right = new THREE.Vector3().crossVectors(tg, UP).normalize();
    const c = p.clone().addScaledVector(right, off);
    const y0 = c.y + yOff, y1 = y0 + height;
    const L = c.clone().addScaledVector(right, -width / 2), Rr = c.clone().addScaledVector(right, width / 2);
    const vis = p.y > minY ? 1 : 0;
    const yy0 = vis ? y0 : -5, yy1 = vis ? y1 : -5;
    pos.push(L.x, yy0, L.z, Rr.x, yy0, Rr.z, Rr.x, yy1, Rr.z, L.x, yy1, L.z);
    if (i < n) {
      const a = i * 4, b = a + 4;
      // bottom, right, top, left faces
      idx.push(a, b, a + 1, a + 1, b, b + 1);
      idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
      idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
      idx.push(a + 3, b + 3, a, a, b + 3, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed(); ng.computeVertexNormals();
  return ng;
}

// ---------- hero car ----------
export function carGeometry() {
  const body = new THREE.BoxGeometry(4.4, 1.0, 1.9); body.translate(0, 0.75, 0);
  const cab = new THREE.BoxGeometry(2.3, 0.75, 1.7); cab.translate(-0.25, 1.62, 0);
  const g = mergeGeometries([body, cab]);
  g.rotateY(Math.PI / 2);   // car faces +z in local space
  return g;
}

function makeHero(world) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(carGeometry(), new THREE.MeshStandardMaterial({ color: P.route, roughness: 0.45, metalness: 0.1 }));
  body.scale.setScalar(1.08);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 2.2), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }));
  roof.position.set(0, 2.05, 0.25); g.add(roof);
  // soft halo disc under the car (scenes can fade it)
  const halo = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: P.route, transparent: true, opacity: 0.0, depthWrite: false }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.12; halo.scale.setScalar(6);
  g.add(halo);

  const route = world.paths.route, alt = world.paths.alt;
  const sBranch = world.s.routeBranch, sAltBranch = world.s.altBranch;
  // schedule (set with hero.schedule): parked until `go`, pulls out, cruises at `cruise` m/s, takes the alt route after `branch` s
  let T_GO = 0.9, T_BRANCH = Infinity, cruise = 18;
  const sAt = (t) => {
    if (t < T_GO) return 0;
    if (t < T_GO + 3.1) { const k = (t - T_GO) / 3.1; return 30 * k * k; }
    return 30 + (t - T_GO - 3.1) * cruise;
  };
  const hero = {
    mesh: g, body, halo,
    schedule({ go = 0.9, branch = Infinity, speed = 18 } = {}) { T_GO = go; T_BRANCH = branch; cruise = speed; return this; },
    // where the car is at time t ({pos, dir, onAlt, s})
    poseAt(t) {
      const s = sAt(t);
      if (t <= T_BRANCH || s <= sBranch) {
        return { pos: route.side(s, 0, 0.05), dir: route.tangent(s), onAlt: false, s };
      }
      const sa = Math.min(alt.length - 1, sAltBranch + (s - sBranch));
      return { pos: alt.side(sa, 0, 0.05), dir: alt.tangent(sa), onAlt: true, s: sa };
    },
    sAt,
    update(t) {
      const p = this.poseAt(t);
      g.position.copy(p.pos);
      g.rotation.set(0, Math.atan2(p.dir.x, p.dir.z), 0);
      // pitch on ramps
      g.rotation.x = 0;
      const pitch = Math.atan2(-p.dir.y, Math.hypot(p.dir.x, p.dir.z));
      g.rotateX(pitch);
    },
  };
  return hero;
}


// ---------- traffic: cars on every road, simulated once up front (pure function of t afterwards) ----------
export class Traffic {
  constructor(world, { duration = 72, fps = 30 } = {}) {
    this.world = world; this.duration = duration; this.fps = fps;
    this.zones = [];
    this.lanesDef = [];
    const W = world.paths, lo = world.laneOff;
    // highway: three lanes each way. dir +1 = along the path (towards downtown), -1 = against
    for (const o of lo) this.lanesDef.push({ path: W.highway, off: o, dir: 1, speed: 29, gap: 26 });
    for (const o of lo) this.lanesDef.push({ path: W.highway, off: -o, dir: -1, speed: 29, gap: 30 });
    this.lanesDef.push({ path: W.onRamp, off: 0, dir: 1, speed: 16, gap: 40, once: true });
    this.lanesDef.push({ path: W.exitRamp, off: 0, dir: 1, speed: 15, gap: 34, once: true });
    this.lanesDef.push({ path: W.feeder, off: 0, dir: 1, speed: 16, gap: 22, once: true });
    this.lanesDef.push({ path: W.feederStreet, off: 2.6, dir: -1, speed: 12, gap: 24 });
    this.lanesDef.push({ path: W.feederStreet, off: -2.6, dir: 1, speed: 12, gap: 30 });
    this.lanesDef.push({ path: W.altRamp, off: 0, dir: 1, speed: 15, gap: 60, once: true });
    this.lanesDef.push({ path: W.alt, off: 2.6, dir: 1, speed: 13, gap: 70, sFrom: W.alt.length * 0.35 });
    this.lanesDef.push({ path: W.alt, off: -2.6, dir: -1, speed: 13, gap: 60, sFrom: W.alt.length * 0.35 });
    this.lanesDef.push({ path: W.route, off: -2.6, dir: -1, speed: 11, gap: 70, sTo: world.s.routeHwyStart - 60 });
    this.lanesDef.push({ path: W.route, off: 2.6, dir: 1, speed: 11, gap: 90, sTo: world.s.routeHwyStart - 60, sFrom: 60 });
  }

  // slow zone on a path: cars between s0..s1 drive at `factor` of their speed during t0..t1
  // ramp = metres of soft edge, tIn/tOut = seconds to blend in/out
  addSlow({ path, s0, s1, t0 = 0, t1 = 999, factor = 0.25, ramp = 30, tIn = 2, tOut = 2, dir = 1 }) {
    this.zones.push({ path: typeof path === 'string' ? path : path.name, s0, s1, t0, t1, factor, ramp, tIn, tOut, dir });
  }

  factorAt(pathName, s, t, dir) {
    let f = 1;
    for (const z of this.zones) {
      if (z.path !== pathName || z.dir !== dir) continue;
      const tk = Math.min(clamp((t - z.t0) / z.tIn), clamp((z.t1 - t) / z.tOut));
      if (tk <= 0) continue;
      const sk = Math.min(clamp((s - (z.s0 - z.ramp)) / z.ramp), clamp(((z.s1 + z.ramp) - s) / z.ramp));
      if (sk <= 0) continue;
      const k = smooth(tk) * smooth(sk);
      f = Math.min(f, 1 - (1 - z.factor) * k);
    }
    return f;
  }

  precompute() {
    const R = rng(77);
    const cars = [];
    this.lanesDef.forEach((ln, li) => {
      const L = ln.path.length;
      const a = ln.sFrom ?? 0, b = ln.sTo ?? L;
      const span = b - a;
      const n = Math.max(1, Math.floor(span / ln.gap));
      for (let i = 0; i < n; i++) {
        const u = (i + 0.2 + R() * 0.6) / n;            // 0..1 along this lane's span, in travel order
        cars.push({ lane: li, ln, u0: u, v0: ln.speed * (0.9 + R() * 0.2), color: P.cars[(R() * P.cars.length) | 0] });
      }
    });
    this.cars = cars;
    const F = Math.ceil(this.duration * this.fps) + 2, N = cars.length;
    this.F = F; this.N = N;
    this.S = new Float32Array(F * N);       // distance travelled in "travel order" coordinates (0..span, wraps)
    // group by lane, sorted front to back
    const byLane = new Map();
    cars.forEach((c, i) => { c.idx = i; c.span = (c.ln.sTo ?? c.ln.path.length) - (c.ln.sFrom ?? 0); c.s = c.u0 * c.span; (byLane.get(c.lane) || byLane.set(c.lane, []).get(c.lane)).push(c); });
    for (const list of byLane.values()) list.sort((p, q) => q.s - p.s);
    const dt = 1 / this.fps;
    for (let f = 0; f < F; f++) {
      const t = f * dt;
      for (const list of byLane.values()) {
        for (let k = 0; k < list.length; k++) {
          const c = list[k];
          if (f > 0) {
            const ln = c.ln;
            const sPath = this.toPath(c, c.s);
            const fac = this.factorAt(ln.path.name, sPath, t, ln.dir);
            let ns = c.s + c.v0 * fac * dt;
            // keep a gap to the car ahead (ring order; the front car follows the last one wrapped)
            const lead = list[(k - 1 + list.length) % list.length];
            if (list.length > 1) {
              let ls = lead.s; if (k === 0) ls += c.span;
              ns = Math.min(ns, Math.max(c.s, ls - 7.5));
            }
            c.s = ns;
          }
          this.S[f * N + c.idx] = c.s;
        }
        // re-wrap front cars once they pass the end
        for (const c of list) if (c.s >= c.span && !c.ln.once) { /* wrapped in toPath via modulo */ }
      }
    }
    this.buildMesh();
  }

  // travel-order distance → path s (handles direction + wrap)
  toPath(c, s) {
    const a = c.ln.sFrom ?? 0;
    let u = ((s % c.span) + c.span) % c.span;
    return c.ln.dir > 0 ? a + u : a + c.span - u;
  }

  sOf(i, t) {
    const x = clamp(t * this.fps, 0, this.F - 1.001), f0 = Math.floor(x), k = x - f0;
    const a = this.S[f0 * this.N + i], b = this.S[(f0 + 1) * this.N + i];
    return a + (b - a) * k;
  }

  // world pose of car i at time t
  poseAt(i, t) {
    const c = this.cars[i];
    const s = this.toPath(c, this.sOf(i, t));
    const p = c.ln.path, tg = p.tangent(s);
    const right = new THREE.Vector3().crossVectors(tg, UP).normalize();
    const pos = p.at(s).addScaledVector(right, c.ln.off);
    const dir = c.ln.dir > 0 ? tg : tg.clone().negate();
    // on one-shot ramps, cars that ran off the end are hidden
    const hidden = c.ln.once && this.sOf(i, t) > c.span;
    return { pos, dir, s, path: p.name, lane: c.lane, hidden, speed: this.speedAt(i, t) };
  }

  // speed (units/s) of car i at t, from the precomputed track
  speedAt(i, t) {
    const a = this.sOf(i, Math.max(0, t - 0.2)), b = this.sOf(i, t + 0.2);
    return (b - a) / 0.4;
  }

  // indices of cars on a path between s0..s1 at time t (optional dir filter)
  carsOn(pathName, s0, s1, t, dir = 0) {
    const out = [];
    this.cars.forEach((c, i) => {
      if (c.ln.path.name !== pathName) return;
      if (dir && c.ln.dir !== dir) return;
      const s = this.toPath(c, this.sOf(i, t));
      if (s >= s0 && s <= s1) out.push(i);
    });
    return out;
  }

  buildMesh() {
    const geo = carGeometry();
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.08 });
    const m = new THREE.InstancedMesh(geo, mat, this.N);
    this.cars.forEach((c, i) => m.setColorAt(i, new THREE.Color(c.color)));
    m.castShadow = true; m.receiveShadow = true;
    m.instanceColor.needsUpdate = true;
    m.frustumCulled = false;
    this.mesh = m;
    this.world.group.add(m);
    this.hiddenSet = new Set();   // scenes may hide cars (e.g. to swap in a hero copy)
  }

  update(t) {
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.N; i++) {
      const p = this.poseAt(i, t);
      if (p.hidden || this.hiddenSet.has(i)) { M.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, M); continue; }
      e.set(Math.atan2(-p.dir.y, Math.hypot(p.dir.x, p.dir.z)), Math.atan2(p.dir.x, p.dir.z), 0, 'YXZ');
      q.setFromEuler(e);
      M.compose(p.pos, q, sc);
      this.mesh.setMatrixAt(i, M);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------- one shared city per page ----------
export function buildCity(ctx) {
  if (ctx.city) return ctx.city;
  const world = buildWorld(ctx.scene);
  world.group.visible = false;                 // core shows it on city-look frames
  world.hero.mesh.visible = false;             // scenes that want the hero car show it (and call hero.update(t)) every frame
  const traffic = new Traffic(world, { duration: (ctx.DURATION || 60) + 1, fps: ctx.FPS || 30 });
  ctx.city = world; ctx.traffic = traffic;
  return world;
}
