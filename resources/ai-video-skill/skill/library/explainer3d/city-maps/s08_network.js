/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-maps/s08_network.js - The city as a graph (40.3-46.15 s)
 * Look: city (golden-hour paper city, units m, one continuous camera)
 * Original spoken line: "So the maps app treats the whole city as one connected network, and uses a model that lets every piece of road look at its neighbours."
 * Shows:
 *   Pull high above the city; a dark veil dims it; the roads re-draw as a glowing graph (nodes at crossings and ramp
 *   merges, edges along streets/highway/ramps); violet messages hop outward from seeds; one highway piece lights up
 *   and its neighbours pass pulses into it on "neighbours".
 * Techniques to steal:
 *   - message schedule = multi-source BFS in TIME, baked into per-edge vertex attributes; the shader only reads time
 *   - one merged edge mesh + InstancedMesh nodes/rings/pulse heads (thousands of elements, pure of t)
 *   - veil + graph redraw: turn a real place into an abstract diagram in place
 *   - splineCam (s10_stack_cam) crane straight up, drift, lean toward the focus
 *
 * NOTE - written against the ORIGINAL per-reel core of the city reel, not the packaged engine.
 * Mapping to the packaged engine:
 *   core/world.js + traffic.js -> '/engine/kits/city.js'. buildCity(ctx) returns the same world object, so read
 *                            ctx.city where this file reads ctx.world (e.g. `const { THREE, world, P, U } = ctx`
 *                            -> `const world = ctx.city`). ctx.traffic is unchanged. ctx.ribbonGeometry /
 *                            ctx.ribbonMaterial are exported from city.js and also on ctx.
 *   core/hud.js           -> ctx.hud: hud.eta(...) = alias of hud.card(...), hud.status(...) = alias of hud.chip(...),
 *                            hud.label(...), hud.big(...), hud.layer. Captions are automatic.
 *   palette               -> this file's P is the CITY palette = ctx.C in the packaged engine (route, live, slow, jam,
 *                            forecast, history, phone, ink, paper, ...). ctx.P there is the studio palette.
 *   core/util.js          -> ctx.U (same functions).
 *   TIMING: the seconds in the T / word tables below were locked to the original voiceover. Convert every one to a
 *   word cue (ctx.wordAt('word', spec.t0) or spec.cue('word', fallbackFraction)) when adapting.
 *   City scenes use absolute city coordinates (no spec.o station).
 * De-branded copy: product names, fonts and paths were replaced in strings/comments only; logic unchanged.
 ============================================================================================================ */
// s08_network (40.3-46.15)
// "So the maps app treats the whole city as one connected network, and uses a model that lets every
//  piece of road look at its neighbours."
// Pull high above the city. A dark veil dims the city; the roads re-draw as a glowing graph
// (nodes at grid crossings + ramp merges, edges along streets / highway / ramps). Violet messages
// hop outward from a few seeds, then one highway piece (just upstream of the exit) lights up blue
// and its neighbours pass pulses into it on "neighbours".
//
// Everything visual is a pure function of t: the message schedule is baked into vertex attributes
// (per-edge start/end times) in init, and the shader / per-frame code only reads `time`.

const T = {
  veilIn: [40.45, 41.45],    // dim the city ("whole city" 41.3)
  edges: [41.5, 42.55],      // edges draw out radially ("connected" 42.04)
  nodes: [42.3, 42.95],      // nodes pop ("network" 42.52)
  seeds: [43.3, 43.42, 43.55, 43.7], // "model" 43.31
  hopMax: 3,
  piece: 44.38,              // "piece"
  neigh: 45.42,              // "neighbours" 45.48
  out: [45.95, 46.75],       // fade out across the s09 blend
};
const SPEED = 260;           // message speed, m/s (80 m grid hop ≈ 0.31 s)

import { splineCam } from './s10_stack_cam.js';

export default {
  init(ctx) {
    const { THREE, world, P, U } = ctx;
    const g = new THREE.Group(); g.visible = false; ctx.scene.add(g);
    this.g = g;

    // ---------- veil: fullscreen quad, dims everything drawn before it ----------
    const veilMat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { color: { value: new THREE.Color(P.ink) }, opacity: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform vec3 color; uniform float opacity; varying vec2 vP;
        void main(){ float r = length(vP * vec2(0.75, 0.6)); float a = opacity * mix(0.9, 0.97, smoothstep(0.2, 1.0, r));
          gl_FragColor = vec4(color, a);
          #include <colorspace_fragment>
        }`,
    });
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), veilMat);
    veil.frustumCulled = false; veil.renderOrder = 900; g.add(veil);
    this.veil = veil;

    // ---------- graph ----------
    const nodes = [];            // {p: Vector3, kind: 0 grid | 1 highway, adj: [edgeIdx]}
    const edges = [];            // {a, b, pts: [Vector3], len, kind}
    const addNode = (p, kind = 0) => { nodes.push({ p: p.clone(), kind, adj: [] }); return nodes.length - 1; };
    const addEdge = (a, b, pts, kind = 0) => {
      let len = 0; for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
      edges.push({ a, b, pts, len, kind }); const id = edges.length - 1;
      nodes[a].adj.push(id); nodes[b].adj.push(id); return id;
    };

    // grid (same numbers as core/world.js street grid)
    const G = 80, xs = [], zs = [];
    for (let x = -810; x <= 890; x += G) xs.push(x);
    for (let z = -870; z <= 650; z += G) zs.push(z);
    const gid = (i, j) => i * zs.length + j;
    const Y0 = 0.6;
    for (let i = 0; i < xs.length; i++) for (let j = 0; j < zs.length; j++) addNode(new THREE.Vector3(xs[i], Y0, zs[j]), 0);
    const nearestGrid = (x, z) => gid(Math.round((x + 810) / G), Math.round((z + 870) / G));
    for (let i = 0; i < xs.length; i++) for (let j = 0; j < zs.length; j++) {
      if (i + 1 < xs.length) addEdge(gid(i, j), gid(i + 1, j), [nodes[gid(i, j)].p, nodes[gid(i + 1, j)].p], 0);
      if (j + 1 < zs.length) addEdge(gid(i, j), gid(i, j + 1), [nodes[gid(i, j)].p, nodes[gid(i, j + 1)].p], 0);
    }

    // highway: nodes at junctions + regular spacing, edges follow the curve
    const hw = world.paths.highway, S = world.s;
    const pathPts = (path, s0, s1, dy = 0.8) => {
      const n = Math.max(2, Math.ceil(Math.abs(s1 - s0) / 6)), out = [];
      for (let k = 0; k <= n; k++) { const p = path.at(s0 + (s1 - s0) * k / n); p.y += dy; out.push(p); }
      return out;
    };
    // clip to the grid extent
    let sA = 0, sB = hw.length;
    for (let s = 0; s < hw.length; s += 5) { const p = hw.at(s); if (p.x > -800 && p.z < 640) { sA = s; break; } }
    for (let s = hw.length; s > 0; s -= 5) { const p = hw.at(s); if (p.z > -860) { sB = s; break; } }
    const keyS = [S.hwyMerge, S.hwyAlt, S.hwyFeed, S.hwyExit];
    const hs = [sA];
    for (let s = sA + 150; s < sB - 60; s += 150) hs.push(s);
    hs.push(sB);
    for (const k of keyS) hs.push(k);
    hs.sort((a, b) => a - b);
    const hsF = hs.filter((s, i) => i === 0 || s - hs[i - 1] > 45 || keyS.includes(s));
    // drop regular nodes that sit too close to a key node
    const hsClean = hsF.filter((s) => keyS.includes(s) || keyS.every((k) => Math.abs(k - s) > 55));
    const hwNode = new Map();
    for (const s of hsClean) hwNode.set(s, addNode(hw.at(s).add(new THREE.Vector3(0, 0.8, 0)), 1));
    const hwEdge = [];
    for (let i = 0; i < hsClean.length - 1; i++) {
      const id = addEdge(hwNode.get(hsClean[i]), hwNode.get(hsClean[i + 1]), pathPts(hw, hsClean[i], hsClean[i + 1]), 1);
      hwEdge.push({ id, s0: hsClean[i], s1: hsClean[i + 1] });
    }
    // ramps
    const P_ = world.paths;
    const rampEdge = (path, nA, nB) => addEdge(nA, nB, pathPts(path, 0, path.length), 2);
    const eOn = rampEdge(P_.onRamp, nearestGrid(-170, 250), hwNode.get(S.hwyMerge));
    const eExit = rampEdge(P_.exitRamp, hwNode.get(S.hwyExit), nearestGrid(500, -310));
    const eAlt = rampEdge(P_.altRamp, hwNode.get(S.hwyAlt), nearestGrid(259, -70));
    const eFeed = rampEdge(P_.feeder, nearestGrid(410, 90), hwNode.get(S.hwyFeed));

    // the focus piece: highway edge from the feeder merge to the exit
    const focus = hwEdge.find((e) => e.s0 === S.hwyFeed && e.s1 === S.hwyExit) || hwEdge.find((e) => e.s1 === S.hwyExit);
    const fE = edges[focus.id];
    const neighbours = new Set([...nodes[fE.a].adj, ...nodes[fE.b].adj]); neighbours.delete(focus.id);
    this.focusId = focus.id; this.neighbours = [...neighbours];
    this.focusMid = fE.pts[Math.floor(fE.pts.length / 2)].clone();
    const ex = edges[eExit]; this.exitMid = ex.pts[Math.floor(ex.pts.length * 0.55)].clone();

    // ---------- message schedule: multi-source BFS in time ----------
    const center = new THREE.Vector3(60, 0, -40);
    const seedPts = [[-10, -70], [270, -150], [150, -390], [470, -230]];
    const seeds = seedPts.map(([x, z], k) => ({ n: nearestGrid(x, z), t: T.seeds[k] }));
    seeds[1].n = hwNode.get(S.hwyFeed);       // one seed on the highway so pulses run along it
    const arrive = new Float32Array(nodes.length).fill(Infinity);
    const hop = new Int32Array(nodes.length).fill(99);
    const travel = new Map();                 // edgeId → {from, t0, t1}
    const heap = seeds.map((s) => { arrive[s.n] = s.t; hop[s.n] = 0; return s.n; });
    while (heap.length) {
      heap.sort((a, b) => arrive[a] - arrive[b]);
      const u = heap.shift();
      if (hop[u] >= T.hopMax) continue;
      for (const eid of nodes[u].adj) {
        if (eid === focus.id) continue;        // keep the focus piece quiet for its own moment
        const e = edges[eid], v = e.a === u ? e.b : e.a;
        const dur = Math.max(0.22, e.len / SPEED);
        const ta = arrive[u] + dur;
        if (ta < arrive[v]) {
          arrive[v] = ta; hop[v] = hop[u] + 1; travel.set(eid, { from: u, t0: arrive[u], t1: ta });
          heap.push(v);
        }
      }
    }
    // focus moment: neighbours pass pulses INTO the focus piece
    const inbound = new Map();
    let k = 0;
    for (const eid of neighbours) {
      const e = edges[eid];
      const shared = (e.a === fE.a || e.a === fE.b) ? e.a : e.b;
      const far = shared === e.a ? e.b : e.a;
      const t0 = T.neigh - 0.15 + k * 0.05, t1 = t0 + Math.min(0.55, Math.max(0.35, e.len / 420));
      inbound.set(eid, { from: far, t0, t1 }); k++;
    }
    this.nodeArrive = arrive; this.hop = hop; this.nodes = nodes; this.edges = edges;
    this.travel = travel; this.inbound = inbound;
    this.seeds = seeds;
    this.edgeCount = edges.length;

    // ---------- edge geometry (one merged mesh, timing in attributes) ----------
    const pos = [], aAlong = [], aAcross = [], aLen = [], aRev = [], aMsg = [], aRole = [], idx = [];
    const UP = new THREE.Vector3(0, 1, 0);
    let vbase = 0;
    edges.forEach((e, eid) => {
      const role0 = eid === focus.id ? 1 : neighbours.has(eid) ? 2 : 0;
      const w = role0 === 1 ? 15 : role0 === 2 ? 8 : e.kind === 0 ? 3.2 : e.kind === 1 ? 6.0 : 4.6;
      const mid = e.pts[Math.floor(e.pts.length / 2)];
      const dC = Math.hypot(mid.x - center.x, mid.z - center.z);
      const rev = T.edges[0] + (T.edges[1] - T.edges[0]) * U.clamp(dC / 1100) + (e.kind ? -0.15 : 0);
      const tr = travel.get(eid) || inbound.get(eid);
      const forward = tr ? tr.from === e.a : true;
      const role = eid === focus.id ? 1 : neighbours.has(eid) ? 2 : 0;
      let acc = 0;
      for (let i = 0; i < e.pts.length; i++) {
        if (i > 0) acc += e.pts[i].distanceTo(e.pts[i - 1]);
        const p = e.pts[i];
        const tg = (i < e.pts.length - 1 ? e.pts[i + 1].clone().sub(p) : p.clone().sub(e.pts[i - 1])).normalize();
        const right = new THREE.Vector3().crossVectors(tg, UP).normalize();
        for (const sg of [-1, 1]) {
          const q = p.clone().addScaledVector(right, sg * w / 2);
          pos.push(q.x, q.y, q.z);
          const al = acc / e.len;
          aAlong.push(forward ? al : 1 - al); aAcross.push(sg); aLen.push(e.len);
          aRev.push(rev, e.kind);
          aMsg.push(tr ? tr.t0 : -1, tr ? tr.t1 : -1);
          aRole.push(role);
        }
        if (i < e.pts.length - 1) { const a = vbase + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      vbase += e.pts.length * 2;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(aAlong, 1));
    geo.setAttribute('aAcross', new THREE.Float32BufferAttribute(aAcross, 1));
    geo.setAttribute('aLen', new THREE.Float32BufferAttribute(aLen, 1));
    geo.setAttribute('aRev', new THREE.Float32BufferAttribute(aRev, 2));
    geo.setAttribute('aMsg', new THREE.Float32BufferAttribute(aMsg, 2));
    geo.setAttribute('aRole', new THREE.Float32BufferAttribute(aRole, 1));
    geo.setIndex(idx);
    const edgeMat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        time: { value: 0 }, fade: { value: 0 },
        cGrid: { value: new THREE.Color(P.history) }, cHwy: { value: new THREE.Color(P.paper) },
        cMsg: { value: new THREE.Color(P.forecastGlow) }, cFocus: { value: new THREE.Color(P.routeGlow) },
        tPiece: { value: T.piece }, tNeigh: { value: T.neigh },
      },
      vertexShader: `attribute float aAlong, aAcross, aLen, aRole; attribute vec2 aRev, aMsg;
        varying float vAlong, vAcross, vLen, vRole; varying vec2 vRev, vMsg;
        void main(){ vAlong=aAlong; vAcross=aAcross; vLen=aLen; vRole=aRole; vRev=aRev; vMsg=aMsg;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float time, fade, tPiece, tNeigh; uniform vec3 cGrid, cHwy, cMsg, cFocus;
        varying float vAlong, vAcross, vLen, vRole; varying vec2 vRev, vMsg;
        void main(){
          // draw-on: edge grows from both ends toward the middle... no: from the end nearer the centre
          float rk = clamp((time - vRev.x) / 0.45, 0.0, 1.0);
          rk = rk * rk * (3.0 - 2.0 * rk);
          float m = abs(vAlong - 0.5) * 2.0;           // 0 middle, 1 ends
          if (m > rk) discard;
          float across = 1.0 - smoothstep(0.35, 1.0, abs(vAcross));
          float kind = vRev.y;
          vec3 base = kind > 0.5 ? cHwy * 0.55 : cGrid * 0.42;
          vec3 col = base * rk;
          // message pulse
          if (vMsg.y > 0.0) {
            float hk = (time - vMsg.x) / (vMsg.y - vMsg.x);
            float d = (vAlong - hk) * vLen;
            float head = exp(-d * d / 160.0) * step(-0.2, hk) * step(hk, 1.25);
            float trail = (d < 0.0 && hk > 0.0) ? exp(d / 70.0) * clamp(1.0 - (time - vMsg.y) / 1.4, 0.0, 1.0) : 0.0;
            float lit = hk > 1.0 ? 0.35 * exp(-(time - vMsg.y) / 1.2) : 0.0;
            col += cMsg * (head * 3.2 + trail * 1.1 + lit);
          }
          // focus piece
          if (vRole > 0.5 && vRole < 1.5) {
            float fk = clamp((time - tPiece) / 0.35, 0.0, 1.0);
            float sweep = smoothstep(vAlong - 0.08, vAlong, fk * 1.1);
            col = mix(col, cFocus * (1.6 + 0.6 * exp(-(time - tPiece) * 3.0)), sweep);
            float nk = time - tNeigh - 0.35;
            col += cFocus * 1.4 * exp(-nk * nk * 18.0);
          }
          // neighbours: light up from their far end toward the focus piece on "neighbours"
          if (vRole > 1.5) {
            float nk = clamp((time - tNeigh + 0.15) / 0.45, 0.0, 1.0);
            float sw2 = smoothstep(vAlong - 0.1, vAlong, nk * 1.1);
            col = mix(col, cMsg * 1.5, sw2 * 0.85);
          }
          gl_FragColor = vec4(col * across * fade, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const edgeMesh = new THREE.Mesh(geo, edgeMat);
    edgeMesh.frustumCulled = false; edgeMesh.renderOrder = 910; g.add(edgeMesh);
    this.edgeMat = edgeMat;

    // ---------- nodes ----------
    const disc = new THREE.CircleGeometry(1, 24); disc.rotateX(-Math.PI / 2);
    const nodeMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthTest: false, depthWrite: false });
    const nodeMesh = new THREE.InstancedMesh(disc, nodeMat, nodes.length);
    nodeMesh.frustumCulled = false; nodeMesh.renderOrder = 920; g.add(nodeMesh);
    const ringGeo = new THREE.RingGeometry(0.78, 1, 40); ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, nodes.length);
    ringMesh.frustumCulled = false; ringMesh.renderOrder = 925; g.add(ringMesh);
    this.nodeMesh = nodeMesh; this.ringMesh = ringMesh; this.nodeMat = nodeMat; this.ringMat = ringMat;
    this.nodePop = nodes.map((n) => {
      const d = Math.hypot(n.p.x - center.x, n.p.z - center.z);
      return T.nodes[0] + (T.nodes[1] - T.nodes[0]) * U.clamp(d / 1000) + (n.kind ? -0.12 : 0);
    });
    // nodes touched by the focus moment flash too
    this.focusNodes = new Set([fE.a, fE.b]);
    this.inboundFar = new Map(); for (const [eid, tr] of inbound) this.inboundFar.set(tr.from, tr.t0);

    // ---------- pulse heads (bright dots riding the messages) ----------
    const all = [...travel.entries(), ...inbound.entries()].map(([eid, tr]) => ({ e: edges[eid], ...tr }));
    this.msgs = all;
    const dotMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const dots = new THREE.InstancedMesh(disc, dotMat, all.length);
    dots.frustumCulled = false; dots.renderOrder = 930; g.add(dots);
    this.dots = dots;
    const c0 = new THREE.Color(0, 0, 0);
    for (let i = 0; i < nodes.length; i++) { nodeMesh.setColorAt(i, c0); ringMesh.setColorAt(i, c0); }
    for (let i = 0; i < all.length; i++) dots.setColorAt(i, c0);

    this.M = new THREE.Matrix4(); this.Q = new THREE.Quaternion(); this.C = new THREE.Color(); this.C2 = new THREE.Color();
    this.cNode = new THREE.Color(P.paper); this.cHw = new THREE.Color(P.paper);
    this.cMsg = new THREE.Color(P.forecastGlow); this.cFocus = new THREE.Color(P.routeGlow);
    this.cGridNode = new THREE.Color(P.history);
  },

  update(ctx, t, spec) {
    const { U, THREE, P, hud } = ctx;
    const vis = t > 40.2 && t < T.out[1];
    this.g.visible = vis;
    if (!vis) return;
    const fade = U.smoother(U.inv(T.veilIn[0], T.veilIn[1], t)) * (1 - U.smoother(U.inv(T.out[0], T.out[1], t)));
    this.veil.material.uniforms.opacity.value = fade;
    const gfade = (1 - U.smoother(U.inv(T.out[0], T.out[1] - 0.15, t)));
    this.edgeMat.uniforms.time.value = t;
    this.edgeMat.uniforms.fade.value = gfade;

    const { M, Q, C } = this;
    const S3 = new THREE.Vector3(), V = new THREE.Vector3();
    // nodes
    const N = this.nodes.length;
    for (let i = 0; i < N; i++) {
      const n = this.nodes[i];
      const k = U.clamp((t - this.nodePop[i]) / 0.45);
      const sc = (n.kind ? 9 : 5.2) * U.backOut(k, 2.2) * gfade;
      const ta = this.nodeArrive[i];
      let flash = 0, ring = 0, rs = 1;
      if (isFinite(ta) && t > ta - 0.05) { const dt = t - ta; flash = Math.exp(-dt * 2.4); const seed = this.hop[i] === 0; const life = seed ? 1.1 : 0.6; ring = dt < life ? 1 - dt / life : 0; rs = 1 + (dt / life) * (seed ? 5 : 1.6); }
      const tf = this.inboundFar.get(i);
      if (tf !== undefined && t > tf) { const dt = t - tf; flash = Math.max(flash, Math.exp(-dt * 2)); }
      let isFocus = false;
      if (this.focusNodes.has(i) && t > T.piece) { isFocus = true; const dt = t - (T.neigh + 0.35); if (dt > 0 && dt < 0.9) { ring = 1 - dt / 0.9; rs = 1 + dt * 3; } }
      const base = n.kind ? this.cHw : this.cGridNode;
      C.copy(base).multiplyScalar(n.kind ? 0.95 : 0.75);
      if (isFocus) C.copy(this.cFocus).multiplyScalar(1.8);
      C.lerp(this.C2.copy(this.cMsg).multiplyScalar(2.0), flash);
      M.compose(n.p, Q, S3.set(sc * (1 + flash * 0.5), 1, sc * (1 + flash * 0.5)));
      this.nodeMesh.setMatrixAt(i, M); this.nodeMesh.setColorAt(i, C);
      const rsc = sc > 0.01 && ring > 0 ? (n.kind ? 9 : 5.2) * rs : 0;
      M.compose(n.p, Q, S3.set(rsc, 1, rsc));
      this.ringMesh.setMatrixAt(i, M);
      C.copy(isFocus ? this.cFocus : this.cMsg).multiplyScalar(ring * ring * 1.1 * gfade);
      this.ringMesh.setColorAt(i, C);
    }
    this.nodeMesh.instanceMatrix.needsUpdate = true; this.nodeMesh.instanceColor.needsUpdate = true;
    this.ringMesh.instanceMatrix.needsUpdate = true; this.ringMesh.instanceColor.needsUpdate = true;

    // pulse heads
    this.msgs.forEach((m, i) => {
      const k = (t - m.t0) / (m.t1 - m.t0);
      let sc = 0;
      if (k > 0 && k < 1.08) {
        const kk = U.clamp(k);
        const pts = m.e.pts, fwd = m.from === m.e.a;
        const f = (fwd ? kk : 1 - kk) * (pts.length - 1);
        const i0 = Math.min(pts.length - 2, Math.floor(f));
        V.copy(pts[i0]).lerp(pts[i0 + 1], f - i0);
        sc = 5.5 * Math.sin(Math.PI * U.clamp(k / 1.08)) ** 0.4 * gfade;
      }
      M.compose(V, Q, S3.set(sc, 1, sc));
      this.dots.setMatrixAt(i, M);
      this.dots.setColorAt(i, C.copy(this.cMsg).multiplyScalar(3.2));
    });
    this.dots.instanceMatrix.needsUpdate = true; if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;

    // HUD: few words, concrete
    const aNet = U.win(t, 42.5, 44.2, 0.3, 0.35) * gfade;
    if (aNet > 0) hud.label('s08net', this.nodes[this.seeds[0].n].p, 'junction = node', { dx: -60, dy: -120, alpha: aNet, dark: true, color: P.paper });
    const aPiece = U.win(t, T.piece, 46.2, 0.25, 0.4);
    if (aPiece > 0) hud.label('s08piece', this.focusMid, '1 piece of road', { dx: -80, dy: 120, alpha: aPiece, dark: true, color: P.routeGlow });
    const aN = U.win(t, T.neigh, 46.4, 0.25, 0.4);
    if (aN > 0) hud.label('s08nb', this.exitMid, 'its neighbours', { dx: 70, dy: -120, alpha: aN, dark: true, color: P.forecastGlow });
    const aS = U.win(t, 42.55, 46.1, 0.4, 0.4);
    if (aS > 0) hud.status({ label: `ROAD GRAPH · ${this.edgeCount.toLocaleString('en-US')} PIECES`, color: P.forecastGlow, alpha: aS });
  },

  camera(ctx, t) {
    const { U } = ctx;
    // crane straight up out of the ripple, slow drift / yaw while high, then lean toward the exit piece
    const tc = U.clamp(t, 40.0, 46.8);
    const keys = this._keys || (this._keys = [
      [40.0, { pos: [-40, 520, 360], target: [300, 0, -190], fov: 38 }],
      [42.0, { pos: [-480, 1500, 760], target: [120, 0, -110], fov: 36 }],
      [44.2, { pos: [-380, 1620, 690], target: [150, 0, -110], fov: 35 }],
      [46.8, { pos: [-130, 1080, 300], target: [280, 0, -180], fov: 35 }],
    ]);
    const p = splineCam(keys, tc, U);
    p.pos[0] += U.drift(t, 1) * 6; p.pos[2] += U.drift(t, 4) * 6;
    return p;
  },
};
