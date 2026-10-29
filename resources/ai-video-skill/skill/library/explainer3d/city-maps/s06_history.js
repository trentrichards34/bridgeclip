/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-maps/s06_history.js - Chart panel in 3D over the road (25.95-32.25 s)
 * Look: city (golden-hour paper city, units m, one continuous camera)
 * Original spoken line: "So the app also looks at history. How this exact stretch of road usually behaves on a Tuesday at six p.m."
 * Shows:
 *   A floating data card rises over a highway stretch: dark canvas backdrop with mph gridlines, six past Tuesdays as
 *   stacked speed slabs with bright tube top edges, a time axis, light beams tying the card to the road, the usual
 *   curve drawing on, and an amber 6 p.m. slice cutting through every day; DOM date chips; edge vignette.
 * Techniques to steal:
 *   - a chart built from 3D primitives in a local frame (x = time, y = value, z = series) floating over the subject
 *   - slabs from ShapeGeometry + CatmullRomCurve3 TubeGeometry top edges; curve draw-on
 *   - light beams tying an infographic to the real place; highlighted slice + dip marker
 *   - camera pre-compensation for the core blend: imports the NEXT scene (s07_ripple) camera to steady the hand-off
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
// s06_history: "So the app also looks at history. How this exact stretch of road usually behaves on a Tuesday at six p.m."
// A floating data card rises over the same highway stretch as s05: a dark backdrop with mph gridlines, six past
// Tuesdays as stacked grey-blue speed slabs (12pm → 9pm left to right, height = mph) with crisp bright top edges,
// a clear time axis in front, light beams tying the card to the exact stretch of road below, the usual curve
// drawn on in paper-white, and the 6 p.m. amber slice cutting through every day: "usual tue 6pm · 31 mph".
// (polish pass B: replaces the earlier far-away translucent curtains.)
const STRETCH = { s0: 1268, s1: 1388 };

const T = {
  in: 25.95,
  so: 26.04,          // "So" → the card starts to open
  looks: 26.92,       // "looks" → the Tuesdays start rising
  history: 27.31,     // "history" → label
  stretch: 29.0,      // "stretch" → beams + road outline
  usually: 29.93,     // "usually" → the usual curve draws on
  tuesday: 31.16,     // "Tuesday" → date chips
  six: 31.82,         // "6 p.m." → the slice
  out: 32.75,         // all s06 objects gone
};

const HOURS = [12, 21];
const U6 = (18 - HOURS[0]) / (HOURS[1] - HOURS[0]);
const USUAL6 = 31;                           // the usual Tuesday 6 pm speed (the profiles are corrected to hit it)
const DATES = ['sep 1', 'sep 8', 'sep 15', 'sep 22', 'sep 29', 'oct 6'];
// chart, local frame: x = time along the road (12pm left → 9pm right), y = mph, z = towards the camera
const W = 80, HS = 1.0, LIFT = 30;           // chart width (m), metres per mph, base height above the deck
const ZL = [-13, -8.5, -4, 0.5, 5, 9.5];     // the six Tuesdays, back → front
const SLAB = 1.6;                            // slab thickness
const ZM = 13.5;                             // the usual curve (front)
const ZC = -17;                              // backdrop card
const CARD = { x0: -W / 2 - 15, x1: W / 2 + 12, y0: -24, y1: 82 };
const xOf = (u) => -W / 2 + W * u;
const X6 = xOf(U6);

let S = null;
import S07 from './s07_ripple.js';   // read-only: its camera, to steady the 6 p.m. beat through the s06→s07 blend

export default {
  init(ctx, spec) {
    const { THREE, world, P, U } = ctx;
    const hw = world.paths.highway;
    const R = U.rng(606);
    const g = new THREE.Group(); g.visible = false; ctx.scene.add(g);

    // ---- local frame over the stretch ----
    const sMid = (STRETCH.s0 + STRETCH.s1) / 2;
    const tg = hw.tangent(sMid).clone(); tg.y = 0; tg.normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const zz = new THREE.Vector3().crossVectors(tg, up).normalize();     // right of travel
    const C = hw.side(sMid, 2, 0); C.y = world.HWY_Y + LIFT;
    const chart = new THREE.Group();
    chart.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tg, up, zz));
    chart.position.copy(C); g.add(chart);
    chart.updateMatrixWorld(true);
    const M = chart.matrixWorld.clone();
    const L = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);

    // ---- speed profiles: free flow ~62, rush-hour dip around 6 pm; corrected so the mean at 6 pm is exactly 31 ----
    const N = 120;
    const profiles = DATES.map(() => {
      const c = U6 + (R() - 0.5) * 0.05, w = 0.07 + R() * 0.03, d = 21 + R() * 8, base = 60 + R() * 5;
      const ph = R() * 6;
      return Array.from({ length: N + 1 }, (_, i) => {
        const u = i / N;
        const dip = d * Math.exp(-((u - c) ** 2) / (2 * w * w));
        const shoulder = 5 * Math.exp(-((u - c) ** 2) / (2 * (w * 2.4) ** 2));
        return base - dip - shoulder + Math.sin(u * 9 + ph) * 0.8;
      });
    });
    const i6 = Math.round(U6 * N);
    const mean0 = profiles.reduce((a, p) => a + p[i6], 0) / profiles.length;
    const corr = USUAL6 - mean0;
    for (const p of profiles) for (let i = 0; i <= N; i++) p[i] += corr * Math.exp(-(((i / N) - U6) ** 2) / (2 * 0.085 * 0.085));
    const mean = profiles[0].map((_, i) => profiles.reduce((a, p) => a + p[i], 0) / profiles.length);
    const meanAt6 = mean[i6];

    // ---- backdrop card (dark), with mph gridlines + labels drawn into a canvas texture ----
    const cw = CARD.x1 - CARD.x0, chh = CARD.y1 - CARD.y0;
    const cardCv = document.createElement('canvas'); cardCv.width = 1024; cardCv.height = Math.round(1024 * chh / cw);
    const cardTex = new THREE.CanvasTexture(cardCv); cardTex.colorSpace = THREE.SRGBColorSpace; cardTex.anisotropy = 8;
    const cardMat = new THREE.MeshBasicMaterial({ map: cardTex, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
    const card = new THREE.Mesh(new THREE.PlaneGeometry(cw, chh), cardMat);
    card.position.set((CARD.x0 + CARD.x1) / 2, (CARD.y0 + CARD.y1) / 2, ZC); card.renderOrder = 2;
    const cardGrp = new THREE.Group(); cardGrp.add(card); chart.add(cardGrp);

    // ---- time axis at the front: bar + hour ticks + labels ----
    const axisMat = new THREE.MeshBasicMaterial({ color: P.paper, transparent: true, opacity: 0, fog: false, toneMapped: false, depthWrite: false });
    const axisGrp = new THREE.Group(); chart.add(axisGrp);
    const axisBar = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 0.55, 0.55), axisMat); axisBar.position.set(0, -0.6, ZM + 2.5); axisGrp.add(axisBar);
    const ticks = [];
    for (let h = 0; h <= 9; h++) {
      const big = h % 3 === 0;
      const tk = new THREE.Mesh(new THREE.BoxGeometry(0.42, big ? 3.2 : 1.8, 0.42), axisMat);
      tk.position.set(xOf(h / 9), -0.6 - (big ? 1.6 : 0.9), ZM + 2.5); axisGrp.add(tk); ticks.push(tk);
    }
    const axCv = document.createElement('canvas'); axCv.width = 2048; axCv.height = 200;
    const axTex = new THREE.CanvasTexture(axCv); axTex.colorSpace = THREE.SRGBColorSpace; axTex.anisotropy = 8;
    const axW = W + 24, axH = axW * 200 / 2048;
    const axMat = new THREE.MeshBasicMaterial({ map: axTex, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
    const axLab = new THREE.Mesh(new THREE.PlaneGeometry(axW, axH), axMat); axLab.position.set(0, -4 - axH / 2, ZM + 2.5); axLab.renderOrder = 60; axisGrp.add(axLab);
    axisGrp.children.forEach((m) => { if (m !== axLab) m.renderOrder = 59; });

    // ---- the six past Tuesdays: solid-ish slabs + crisp bright top edges ----
    const slabMat = (col, op) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { color: { value: col }, hlColor: { value: new THREE.Color(P.slow) }, opacity: { value: op }, hl: { value: 0 }, hlX: { value: X6 }, yMax: { value: 64 * HS } },
      vertexShader: 'varying vec3 vP; varying vec3 vN; void main(){ vP = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 color, hlColor; uniform float opacity, hl, hlX, yMax; varying vec3 vP; varying vec3 vN;
        void main(){
          float g = clamp(vP.y / yMax, 0.0, 1.0);
          vec3 c = color * mix(0.62, 1.0, g);
          float shade = vN.y > 0.5 ? 1.18 : (abs(vN.z) > 0.5 ? 1.0 : 0.82);
          c *= shade;
          float band = hl * (1.0 - smoothstep(1.4, 2.6, abs(vP.x - hlX)));
          c = mix(c, hlColor, band * 0.92);
          float a = opacity * mix(0.16, 0.9, pow(max(g, 0.0), 1.3));
          a = mix(a * (1.0 - 0.3 * hl), 0.95, band);
          gl_FragColor = vec4(c, a);
          #include <colorspace_fragment>
        }`,
    });
    const shapeOf = (prof) => {
      const sh = new THREE.Shape();
      sh.moveTo(xOf(0), 0);
      for (let i = 0; i <= N; i++) sh.lineTo(xOf(i / N), prof[i] * HS);
      sh.lineTo(xOf(1), 0); sh.closePath();
      return sh;
    };
    const topCurve = (prof, z) => new THREE.CatmullRomCurve3(prof.map((m, i) => new THREE.Vector3(xOf(i / N), m * HS, z)));
    const hist = new THREE.Color(P.history), paper = new THREE.Color(P.paper);
    const layers = profiles.map((prof, i) => {
      const grp = new THREE.Group(); chart.add(grp);
      const col = hist.clone().multiplyScalar(0.5 + i * 0.07);
      const sm = slabMat(col, 0.86);
      const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeOf(prof), { depth: SLAB, bevelEnabled: false, curveSegments: 1 }), sm);
      slab.position.z = ZL[i] - SLAB / 2; slab.renderOrder = 10 + i * 2;
      const em = new THREE.MeshBasicMaterial({ color: hist.clone().lerp(paper, 0.3 + i * 0.07), transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
      const edge = new THREE.Mesh(new THREE.TubeGeometry(topCurve(prof, ZL[i] + SLAB / 2), 200, 0.42, 6), em); edge.renderOrder = 11 + i * 2;
      grp.add(slab, edge);
      return { grp, sm, em };
    });

    // ---- the usual curve: bright paper-white line in front, drawn on ----
    const meanCurve = topCurve(mean, ZM);
    const meanTubeGeo = new THREE.TubeGeometry(meanCurve, 260, 0.85, 8);
    const meanMat = new THREE.MeshBasicMaterial({ color: hist.clone().lerp(paper, 0.85), transparent: true, opacity: 1, fog: false, toneMapped: false, depthWrite: false });
    const meanTube = new THREE.Mesh(meanTubeGeo, meanMat); meanTube.renderOrder = 40; chart.add(meanTube);
    const meanHead = new THREE.Mesh(new THREE.SphereGeometry(1.7, 20, 14), new THREE.MeshBasicMaterial({ color: P.paper, fog: false, toneMapped: false }));
    meanHead.renderOrder = 41; chart.add(meanHead);
    // soft drop-lines under the usual curve (a faint fill, so the line reads as an area)
    const meanFillMat = slabMat(hist.clone().lerp(paper, 0.4), 0.0);
    const meanFill = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(mean)), meanFillMat); meanFill.position.z = ZM; meanFill.renderOrder = 39; chart.add(meanFill);

    // ---- stretch on the road + light beams up to the card ----
    const bracketMat = ctx.ribbonMaterial(P.history, { opacity: 1, glow: 0.25, edge: 0.3 });
    [12.6, -12.6].forEach((off) => { const m = new THREE.Mesh(ctx.ribbonGeometry(hw, STRETCH.s0, STRETCH.s1, 1.3, { off, dy: 0.14, step: 2 }), bracketMat); g.add(m); });
    const tintMat = ctx.ribbonMaterial(P.history, { opacity: 0.3, glow: 0.0, edge: 0.05 });
    const tint = new THREE.Mesh(ctx.ribbonGeometry(hw, STRETCH.s0, STRETCH.s1, 24, { off: 0, dy: 0.11, step: 2 }), tintMat); g.add(tint);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { color: { value: new THREE.Color(P.history).lerp(paper, 0.3) }, opacity: { value: 0 } },
      vertexShader: 'attribute float a; varying float vA; void main(){ vA = a; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float opacity; varying float vA; void main(){ gl_FragColor = vec4(color, opacity * mix(0.55, 0.12, vA)); \n#include <colorspace_fragment>\n }',
    });
    const beams = [[STRETCH.s0, xOf(0)], [STRETCH.s1, xOf(1)]].map(([s, x]) => {
      const a1 = hw.side(s, -12.6, 0.2), a2 = hw.side(s, 12.6, 0.2);
      const b1 = L(x, -0.6, ZL[0] - 2), b2 = L(x, -0.6, ZM + 2.5);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([a1, a2, b1, b2].flatMap((v) => [v.x, v.y, v.z]), 3));
      geo.setAttribute('a', new THREE.Float32BufferAttribute([0, 0, 1, 1], 1));
      geo.setIndex([0, 1, 2, 1, 3, 2]);
      const m = new THREE.Mesh(geo, beamMat); m.renderOrder = 3; g.add(m); return m;
    });

    // ---- 6 pm slice: an amber blade through every day ----
    const sliceD = ZM + 3 - (ZC + 1), sliceH = 70 * HS;
    const sliceMat = new THREE.MeshBasicMaterial({ color: P.slow, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const sliceGrp = new THREE.Group(); sliceGrp.position.set(X6, 0, (ZM + 3 + ZC + 1) / 2); chart.add(sliceGrp);
    const slice = new THREE.Mesh(new THREE.PlaneGeometry(sliceD, sliceH), sliceMat);
    slice.rotation.y = Math.PI / 2; slice.position.y = sliceH / 2; slice.renderOrder = 50; sliceGrp.add(slice);
    const sliceEdgeMat = new THREE.MeshBasicMaterial({ color: P.slow, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
    const sliceFront = new THREE.Mesh(new THREE.BoxGeometry(0.6, sliceH, 0.6), sliceEdgeMat); sliceFront.position.set(0, sliceH / 2, sliceD / 2); sliceGrp.add(sliceFront);
    const sliceTop = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, sliceD), sliceEdgeMat); sliceTop.position.set(0, sliceH, 0); sliceGrp.add(sliceTop);
    sliceFront.renderOrder = sliceTop.renderOrder = 51;
    // the dip on the usual curve
    const dipL = new THREE.Vector3(X6, meanAt6 * HS, ZM);
    const dipP = dipL.clone().applyMatrix4(M);
    const dipDot = new THREE.Mesh(new THREE.SphereGeometry(2.3, 24, 16), new THREE.MeshBasicMaterial({ color: P.slow, fog: false, toneMapped: false }));
    dipDot.position.copy(dipL); dipDot.renderOrder = 55; chart.add(dipDot);
    const dipRingMat = new THREE.MeshBasicMaterial({ color: P.slow, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const dipRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), dipRingMat);
    dipRing.position.copy(dipL); dipRing.renderOrder = 54; chart.add(dipRing);

    // ---- Tuesday panel (DOM): the dates, and each one's 6 pm speed once "6 p.m." lands ----
    const at6 = profiles.map((p) => Math.round(p[i6]));
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:50%;top:318px;transform:translateX(-50%);opacity:0;padding:16px 26px 16px;border-radius:26px;background:rgba(16,19,25,.9);box-shadow:0 18px 50px rgba(10,14,20,.24), inset 0 0 0 1.5px rgba(255,255,255,.07);white-space:nowrap;`;
    el.innerHTML = `<div style="font:700 18px JetBrains Mono;letter-spacing:.16em;color:rgba(255,255,255,.55);margin-bottom:10px"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${P.history};margin-right:9px"></i>PAST TUESDAYS · THIS STRETCH</div><div data-row style="display:flex;gap:22px"></div>`;
    const row = el.querySelector('[data-row]');
    const chips = DATES.map((d, i) => {
      const c = document.createElement('div');
      c.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:4px;';
      c.innerHTML = `<div style="font:700 24px JetBrains Mono;color:#fff">${d}</div><div data-v style="font:700 21px JetBrains Mono;color:${P.slow};height:24px">${at6[i]} mph</div>`;
      row.appendChild(c); c._v = c.querySelector('[data-v]'); return c;
    });
    ctx.hud.layer.appendChild(el);
    // vignette: darkens the frame edges so the card owns the middle
    const vig = document.createElement('div');
    vig.style.cssText = 'position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse 75% 55% at 50% 47%, rgba(20,24,32,0) 55%, rgba(20,24,32,.42) 100%);';
    ctx.hud.layer.insertBefore(vig, ctx.hud.layer.firstChild);

    const drawTex = () => {
      const c = cardCv.getContext('2d'), w = cardCv.width, h = cardCv.height;
      const py = (y) => (CARD.y1 - y) / chh * h, px = (x) => (x - CARD.x0) / cw * w;
      c.clearRect(0, 0, w, h);
      c.fillStyle = 'rgba(20,24,32,0.93)';
      c.beginPath(); c.roundRect(4, 4, w - 8, h - 8, 44); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 3; c.stroke();
      c.font = '700 30px JetBrains Mono'; c.textBaseline = 'middle';
      for (const m of [20, 40, 60]) {
        c.strokeStyle = 'rgba(255,255,255,0.13)'; c.lineWidth = 2.5; c.setLineDash([10, 10]);
        c.beginPath(); c.moveTo(px(xOf(0)) - 6, py(m * HS)); c.lineTo(w - 40, py(m * HS)); c.stroke(); c.setLineDash([]);
        c.fillStyle = 'rgba(255,255,255,0.5)'; c.textAlign = 'right';
        c.fillText(String(m), px(xOf(0)) - 18, py(m * HS));
      }
      c.textAlign = 'left'; c.fillStyle = 'rgba(255,255,255,0.42)'; c.font = '700 26px JetBrains Mono';
      c.fillText('MPH', 44, py(72 * HS));
      cardTex.needsUpdate = true;
      const a = axCv.getContext('2d');
      a.clearRect(0, 0, axCv.width, axCv.height);
      a.textAlign = 'center'; a.textBaseline = 'top'; a.font = '700 96px JetBrains Mono';
      const ax = (x) => (x + axW / 2) / axW * axCv.width;
      [['12pm', 0], ['3pm', 3], ['6pm', 6], ['9pm', 9]].forEach(([s, hh]) => {
        a.fillStyle = hh === 6 ? P.slow : 'rgba(251,248,242,0.92)';
        a.fillText(s, ax(xOf(hh / 9)), 18);
      });
      axTex.needsUpdate = true;
    };

    S = { g, chart, L, cardGrp, cardMat, axisGrp, axisMat, axMat, ticks, layers, meanTubeGeo, meanTube, meanMat, meanHead, meanCurve, meanFillMat,
      bracketMat, tintMat, beamMat, sliceGrp, sliceMat, sliceEdgeMat, dipP, dipDot, dipRing, dipRingMat, el, chips, vig, meanAt6, drawTex, drawn: false };
  },

  update(ctx, t, spec) {
    const { U, P, hud } = ctx;
    const vis = t >= T.in - 0.45 && t <= T.out;
    S.g.visible = vis;
    if (!vis) { S.el.style.opacity = 0; S.vig.style.opacity = 0; return; }
    if (!S.drawn) { S.drawTex(); S.drawn = true; }
    const A = U.win(t, T.in - 0.45, T.out, 0.4, 0.5);
    const OUT = 1 - U.smoother(U.inv(T.out - 0.5, T.out, t));   // chart fade at the very end

    // road: the stretch outline draws in from s05's colours, beams on "stretch"
    const br = U.smoother(U.inv(T.in - 0.2, T.in + 0.6, t));
    S.bracketMat.uniforms.to.value = br; S.bracketMat.uniforms.opacity.value = A;
    S.tintMat.uniforms.to.value = br; S.tintMat.uniforms.opacity.value = 0.3 * A;
    const bk = U.smoother(U.inv(T.stretch - 0.1, T.stretch + 0.4, t));
    S.beamMat.uniforms.opacity.value = A * U.lerp(0.25, 0.75, bk) * U.smoother(U.inv(T.so, T.looks + 0.4, t));
    S.bracketMat.uniforms.glow.value = 0.25 + 0.6 * bk * (1 - U.smoother(U.inv(T.stretch + 0.5, T.stretch + 1.3, t)));

    // the card opens from its bottom edge on "So"
    const ck = U.spring(U.inv(T.so - 0.05, T.so + 0.8, t), 2.2, 5.5);
    S.cardGrp.scale.set(U.lerp(0.9, 1, U.clamp(ck)), Math.max(0.001, ck), 1);
    S.cardGrp.position.y = CARD.y0 * (1 - ck);
    S.cardMat.opacity = U.clamp(ck * 1.4) * OUT;
    const ak = U.smoother(U.inv(T.so + 0.25, T.so + 0.8, t));
    S.axisMat.opacity = ak * OUT; S.axMat.opacity = ak * OUT;
    S.ticks.forEach((tk, i) => { tk.scale.y = Math.max(0.01, U.backOut(U.inv(T.so + 0.3 + i * 0.04, T.so + 0.6 + i * 0.04, t), 2)); });

    // the Tuesdays rise, staggered back to front, on "looks"
    const hlK = U.smoother(U.inv(T.six - 0.1, T.six + 0.35, t));
    S.layers.forEach((Ly, i) => {
      const k = U.spring(U.inv(T.looks + i * 0.09, T.looks + 1.0 + i * 0.09, t), 2.6, 5.0);
      Ly.grp.scale.y = Math.max(0.001, k);
      Ly.grp.visible = k > 0.002;
      Ly.sm.uniforms.opacity.value = 0.86 * OUT * U.smoother(U.inv(T.looks + i * 0.09, T.looks + 0.3 + i * 0.09, t));
      Ly.sm.uniforms.hl.value = hlK;
      Ly.em.opacity = OUT * U.smoother(U.inv(T.looks + 0.1 + i * 0.09, T.looks + 0.5 + i * 0.09, t)) * (1 - 0.35 * hlK);
    });

    // the usual curve draws on on "usually"
    const mk = U.easeInOut(U.inv(T.usually - 0.05, T.usually + 0.9, t));
    S.meanTube.visible = mk > 0.001;
    S.meanTubeGeo.setDrawRange(0, Math.floor(S.meanTubeGeo.index.count * mk / 6) * 6);
    S.meanMat.opacity = OUT;
    const hp = S.meanCurve.getPointAt(U.clamp(mk));
    S.meanHead.position.copy(hp); S.meanHead.visible = mk > 0.001 && mk < 0.999;
    S.meanFillMat.uniforms.opacity.value = 0.14 * OUT * U.smoother(U.inv(T.usually + 0.6, T.usually + 1.2, t));
    S.meanFillMat.uniforms.hl.value = hlK;

    // 6 pm slice + dip (lands on "6 p.m.")
    const sk = U.spring(U.inv(T.six - 0.14, T.six + 0.5, t), 2.4, 5.5);
    S.sliceGrp.scale.set(1, Math.max(0.001, sk), 1);
    S.sliceMat.opacity = 0.3 * OUT * U.clamp(sk); S.sliceEdgeMat.opacity = OUT * U.clamp(sk);
    const dk = U.backOut(U.inv(T.six - 0.06, T.six + 0.24, t), 2.2);
    S.dipDot.scale.setScalar(Math.max(0.001, dk)); S.dipDot.visible = dk > 0.01;
    const rp = ((t - T.six) * 1.4) % 1;
    S.dipRing.scale.setScalar(2.5 + 8 * U.easeOut(rp)); S.dipRingMat.opacity = t > T.six ? OUT * 0.85 * (1 - rp) : 0;

    // labels (max 2 at once)
    const lab6 = A * U.smoother(U.inv(T.six - 0.06, T.six + 0.08, t)) * (1 - U.smoother(U.inv(32.14, 32.3, t)));
    if (lab6 > 0.01) hud.label('s06_dip', S.dipP, `usual tue 6pm · ${Math.round(S.meanAt6)} mph`, { color: P.slow, dotColor: P.slow, dark: true, dx: 50, dy: 150, alpha: lab6, size: 1.2 });
    const labU = A * U.smoother(U.inv(T.usually + 0.5, T.usually + 0.8, t)) * (1 - U.smoother(U.inv(T.tuesday - 0.2, T.tuesday + 0.1, t)));
    if (labU > 0.01) hud.label('s06_usual', S.L(xOf(0.1), 60 * HS, ZM), 'usual tuesday', { color: P.paper, dotColor: P.paper, dark: true, dx: 40, dy: -95, alpha: labU });
    const labH = A * U.smoother(U.inv(T.history - 0.05, T.history + 0.3, t)) * (1 - U.smoother(U.inv(T.usually + 0.2, T.usually + 0.5, t)));
    if (labH > 0.01) hud.label('s06_hist', S.L(xOf(0.12), 62 * HS, ZL[2]), 'past tuesdays', { color: P.history, dotColor: P.history, dark: true, dx: 40, dy: -95, alpha: labH });

    // Tuesday chips
    const cA = A * U.smoother(U.inv(T.tuesday - 0.2, T.tuesday, t)) * (1 - U.smoother(U.inv(32.05, 32.35, t)));
    S.el.style.opacity = cA;
    S.chips.forEach((c, i) => {
      const k = U.inv(T.tuesday - 0.15 + i * 0.05, T.tuesday + 0.35 + i * 0.05, t);
      c.style.opacity = U.smoother(k);
      c.style.transform = `translateY(${(1 - U.backOut(k, 1.6)) * 18}px)`;
      c._v.style.opacity = U.smoother(U.inv(T.six + 0.05 + i * 0.05, T.six + 0.35 + i * 0.05, t));
    });
    S.el.style.transform = `translateX(-50%) translateY(${(1 - U.easeOut(U.inv(T.tuesday - 0.25, T.tuesday + 0.2, t))) * -16}px)`;

    hud.eta({ time: '6:42', alpha: 1, state: 'live', sub: '23 min' });
    // push the city back: tighter haze + edge vignette while the chart is up
    const fk = U.smoother(U.inv(T.in - 0.3, T.looks, t)) * (1 - U.smoother(U.inv(T.out - 0.8, T.out, t)));
    S.vig.style.opacity = fk;
    if (fk > 0.001) ctx.fog = { near: U.lerp(500, 140, fk), far: U.lerp(2200, 760, fk) };
  },

  camera(ctx, t, spec) {
    const { U } = ctx;
    if (!S) return null;
    const tt = U.clamp(t, T.in - 0.5, T.out + 0.1);
    // local-frame keys (x = time axis, y up, z = towards the camera): crane down from above the stretch,
    // swing round towards the 9pm end, push in on the 6 pm slice.
    const K = [
      [T.in - 0.5, [-60, 200, 340], [0, 6, 0], 40],
      [T.looks, [-38, 118, 305], [0, 26, 0], 40],
      [T.stretch, [-16, 104, 292], [2, 21, 0], 40],
      [T.usually + 0.6, [22, 102, 276], [6, 28, 0], 40],
      [T.six - 0.15, [40, 96, 252], [10, 29, 0], 39],
      [T.out + 0.1, [48, 94, 240], [12, 29, 0], 38],
    ];
    const p = U.track(K.map(([kt, a, b, f]) => [kt, [...a, ...b, f]]), tt, (k) => U.lerp(k, U.smooth(k), 0.55));
    const pos = S.L(p[0], p[1], p[2]), tgt = S.L(p[3], p[4], p[5]);
    pos.y += U.drift(t, 4) * 0.7;
    let P0 = [pos.x, pos.y, pos.z], T0 = [tgt.x, tgt.y, tgt.z];
    // Core's s06→s07 blend is centred on 32.25, so it starts at 31.75, right on "6 p.m.". Pre-compensate so the
    // blended camera keeps the chart framed until ~32.0, then lets the swoop go by 32.55 (w: 1 → 0).
    const b0 = 32.25 - 0.5;
    const w = 1 - U.smoother(U.inv(31.98, 32.55, t));
    if (t > b0 && w > 0.001) {
      const k = U.smoother(U.clamp((t - b0) / 1.0));
      let N = null; try { N = S07.camera(ctx, t); } catch (e) { N = null; }
      if (N && k < 0.99) {
        const comp = (D, n) => D.map((d, j) => (d * (1 - k + k * w) - k * w * n[j]) / (1 - k));
        P0 = comp(P0, N.pos); T0 = comp(T0, N.target);
        const dist = Math.hypot(P0[0] - N.pos[0], P0[1] - N.pos[1], P0[2] - N.pos[2]);
        P0[1] -= 0.75 * w * Math.sin(Math.PI * k) * Math.min(260, dist * 0.22) / (1 - k);
      }
    }
    return { pos: P0, target: T0, fov: p[6], roll: 0 };
  },
};
