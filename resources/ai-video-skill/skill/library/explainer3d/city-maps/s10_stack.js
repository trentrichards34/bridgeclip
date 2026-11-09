/* ============================================================================================================
 * LIBRARY REFERENCE: explainer3d/city-maps/s10_stack.js - Blocks fly and stack + counter (51.0-56.35 s)
 * Look: city (golden-hour paper city, units m, one continuous camera)
 * Original spoken line: "Then it predicts the time for each piece of your trip, stacks them together, and that total becomes your arrival time."
 * Shows:
 *   The 8 route pieces light up as violet strips, rise out of the road as blocks (height = minutes, minutes printed
 *   on the face), fly in staggered bezier arcs and stack into a floating tower with springy landings; the tower
 *   flashes "23 min", resolves into "6:19 + 23 min = 6:42", and the 6:42 flies up into the ETA card which rolls its
 *   digits.
 * Techniques to steal:
 *   - staggered flights: per-item start = t0 + i*step, bezier arc with a high control point, ease in-out
 *   - squash-and-stretch in flight + landing spring; platform pulse on every landing
 *   - canvas-printed block faces (depth-biased to avoid z-fighting at distance)
 *   - hud.big equation then a number flying into hud.eta / hud.card with a digit roll (prev -> time, k)
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
// s10_stack (51.0-56.35)
// "Then it predicts the time for each piece of your trip, stacks them together,
//  and that total becomes your arrival time."
// The 8 route pieces light up as violet strips, rise out of the road as blocks (height ∝ minutes,
// minutes printed on the face) while the camera glides up the route, then fly in staggered arcs and
// stack into a floating tower over the city with springy landings. The tower flashes "23 min",
// resolves into "6:19 + 23 min = 6:42", and the 6:42 flies up into the ETA card, which rolls and pulses.

const B = [330, 110, -60];       // tower base (floating platform) in world space
const UNIT = 12;                 // metres per minute
const GAP = 3;                   // gap between stacked blocks
const FOOT = 86;                 // block footprint
const YAW_F = -Math.PI / 4 + 0.32;   // final yaw: printed face turned toward the camera

const T = {
  strips: 51.15,                 // route pieces light up ("Then")
  rise0: 51.55, riseStep: 0.15,  // blocks grow out of the road ("predicts the time for each piece")
  fly0: 53.12, flyStep: 0.1, flyDur: 0.68,   // "stacks" 53.17 → last lands ≈ 54.5
  total: 54.5,                   // "total"
  eq: 54.83,                     // "becomes"
  eq2: 55.2,                     // "= 6:42"
  fly642: [55.45, 55.85],        // "arrival" 55.51
  out: [56.3, 56.85],
};

import { splineCam } from './s10_stack_cam.js';

export default {
  init(ctx) {
    const { THREE, world, P, U } = ctx;
    const g = new THREE.Group(); g.visible = false; ctx.scene.add(g); this.g = g;
    const route = world.paths.route;
    this.segs = world.segments;

    // ---- violet strips on the route, one per piece (with small gaps) ----
    this.strips = this.segs.map((s, i) => {
      const pad = Math.min(6, (s.s1 - s.s0) * 0.08);
      const m = new THREE.Mesh(ctx.ribbonGeometry(route, s.s0 + pad, s.s1 - pad, 9, { dy: 0.4, step: 3 }), ctx.ribbonMaterial(P.forecast, { opacity: 0, glow: 0.4 }));
      m.renderOrder = 5; g.add(m); return m;
    });

    // ---- blocks ----
    const shape = new THREE.Shape();
    const hw = FOOT / 2, r = 9;
    shape.moveTo(-hw + r, -hw); shape.lineTo(hw - r, -hw); shape.quadraticCurveTo(hw, -hw, hw, -hw + r);
    shape.lineTo(hw, hw - r); shape.quadraticCurveTo(hw, hw, hw - r, hw); shape.lineTo(-hw + r, hw);
    shape.quadraticCurveTo(-hw, hw, -hw, hw - r); shape.lineTo(-hw, -hw + r); shape.quadraticCurveTo(-hw, -hw, -hw + r, -hw);
    const shades = [P.forecast, '#7b4ced', '#6a3fdc', '#9470f6'];
    let acc = 0;
    this.blocks = this.segs.map((s, i) => {
      const h = s.minutes * UNIT;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h - 3, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.5, bevelSegments: 2, curveSegments: 4 });
      geo.rotateX(-Math.PI / 2); geo.translate(0, 1.5, 0);     // base at y=0, top at y=h
      const mat = new THREE.MeshStandardMaterial({ color: shades[i % 4], roughness: 0.55, metalness: 0.0, emissive: new THREE.Color(P.forecastGlow), emissiveIntensity: 0, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
      const grp = new THREE.Group(); grp.add(mesh);
      // printed face (local +z) and top
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const fh = Math.min(h * 0.86, (FOOT - 8) / 2);
      // polishC: the bevel pushes the block's front to hw + 1.5, so a face at hw + 1.6 z-fought at tower distance
      // ("3 mi", half-eaten digits). Stand the face clear of the bevel and bias its depth toward the camera.
      const face = new THREE.Mesh(new THREE.PlaneGeometry(fh * 2, fh), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
      face.position.set(0, h / 2, hw + 3.2); face.renderOrder = 6;
      grp.add(face);
      g.add(grp);
      const road = route.at(s.mid);
      const tg = route.tangent(s.mid);
      const yaw0 = Math.atan2(tg.x, tg.z);
      const slotY = acc; acc += h + GAP;
      return { grp, mesh, mat, face, cv, tex, h, road, yaw0, slotY, drawn: false, i, min: s.minutes };
    });
    this.towerH = acc - GAP;

    // ---- floating platform under the tower ----
    const plat = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(FOOT * 0.95, FOOT * 0.95, 3, 64), new THREE.MeshStandardMaterial({ color: P.paper, roughness: 0.6 }));
    disc.position.y = -3; disc.castShadow = true; plat.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(FOOT * 1.05, 1.6, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(P.forecastGlow).multiplyScalar(2.2), transparent: true }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -1.5; plat.add(ring);
    const pulse = new THREE.Mesh(new THREE.TorusGeometry(FOOT * 1.05, 1.0, 6, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(P.forecastGlow).multiplyScalar(2), transparent: true, depthWrite: false }));
    pulse.rotation.x = Math.PI / 2; pulse.position.y = -1.5; plat.add(pulse);
    plat.position.set(...B); g.add(plat);
    // thin tether down to the road the tower "belongs" to
    const teth = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, B[1], 6), new THREE.MeshBasicMaterial({ color: P.forecast, transparent: true, opacity: 0.5 }));
    teth.position.set(B[0], B[1] / 2, B[2]); g.add(teth);
    this.plat = plat; this.ring = ring; this.pulse = pulse; this.disc = disc; this.teth = teth;
    this.top = new THREE.Vector3(B[0], B[1] + this.towerH, B[2]);
    this.mid = new THREE.Vector3(B[0] + FOOT * 0.5, B[1] + this.towerH * 0.5, B[2]);
    this.V = new THREE.Vector3();
    // polishC: dark pill behind the "6:19 + 23 min = 6:42" equation so it reads on the hazy city
    const pill = document.createElement('div');
    pill.style.cssText = 'position:absolute;left:0;top:0;width:760px;height:136px;border-radius:40px;opacity:0;' +
      'background:rgba(16,19,25,.86);box-shadow:0 18px 50px rgba(10,14,20,.28), inset 0 0 0 1.5px rgba(255,255,255,.07);' +
      'backdrop-filter:blur(6px);will-change:transform,opacity;';
    ctx.hud.layer.appendChild(pill); this.pill = pill;
  },

  drawFaces() {
    for (const b of this.blocks) {
      const c = b.cv.getContext('2d');
      c.clearRect(0, 0, 512, 256);
      c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      c.font = '800 210px Inter';
      const num = String(b.min);
      const wN = c.measureText(num).width;
      c.font = '700 92px Inter';
      const wU = c.measureText(' min').width;
      const x0 = 256 - (wN + wU) / 2;
      c.textAlign = 'left';
      c.shadowColor = 'rgba(20,12,60,.35)'; c.shadowBlur = 10; c.shadowOffsetY = 4;
      c.font = '800 210px Inter'; c.fillText(num, x0, 205);
      c.font = '700 92px Inter'; c.globalAlpha = 0.85; c.fillText(' min', x0 + wN, 205); c.globalAlpha = 1;
      b.tex.needsUpdate = true; b.drawn = true;
    }
  },

  update(ctx, t, spec) {
    const { U, P, hud } = ctx;
    const vis = t > 50.6 && t < T.out[1];
    this.g.visible = vis;
    if (this.pill && !vis) this.pill.style.opacity = 0;
    if (!vis) return;
    if (!this.blocks[0].drawn) this.drawFaces();
    const gOut = 1 - U.smoother(U.inv(T.out[0], T.out[1], t));
    const V = this.V;

    // strips: light up staggered, dim as their block leaves
    this.strips.forEach((m, i) => {
      const k = U.clamp((t - T.strips - i * 0.05) / 0.35);
      m.material.uniforms.to.value = U.easeOut(k);
      const lift = U.inv(T.fly0 + i * T.flyStep, T.fly0 + i * T.flyStep + 0.5, t);
      m.material.uniforms.opacity.value = (0.95 - 0.6 * lift) * gOut;
      m.visible = k > 0;
    });

    // blocks
    let landedCount = 0;
    for (const b of this.blocks) {
      const tr = T.rise0 + b.i * T.riseStep;
      const tf = T.fly0 + b.i * T.flyStep;
      const kr = U.clamp((t - tr) / 0.55);
      const grow = kr <= 0 ? 0 : U.spring(kr, 2.2, 6.5);
      const kf = U.clamp((t - tf) / T.flyDur);
      const dest = V.set(B[0], B[1] + b.slotY, B[2]);
      let x, y, z, yaw, sy = 1, sxz = 1;
      if (kf <= 0) {
        // rising out of the road with a little float
        x = b.road.x; z = b.road.z; y = b.road.y + 0.3 + Math.max(0, grow - 0.0) * 0 + U.easeOut(U.inv(tr + 0.3, tf, t)) * 10;
        yaw = b.yaw0; sy = Math.max(0.001, grow); sxz = 0.85 + 0.15 * Math.min(1, grow);
      } else {
        // arc to the tower slot: bezier with a high control point; ease in-out with a soft landing
        const e = kf < 1 ? U.easeInOut(kf) : 1;
        const p0x = b.road.x, p0y = b.road.y + 10.3, p0z = b.road.z;
        const cx = (p0x + dest.x) / 2, cz = (p0z + dest.z) / 2;
        const cy = Math.max(p0y, dest.y) + 140 + b.i * 8;
        const a = (1 - e) * (1 - e), bb = 2 * (1 - e) * e, c = e * e;
        x = a * p0x + bb * cx + c * dest.x;
        y = a * p0y + bb * cy + c * dest.y;
        z = a * p0z + bb * cz + c * dest.z;
        let dy = b.yaw0 - YAW_F; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        yaw = YAW_F + dy * (1 - U.smoother(U.clamp(kf * 1.15)));
        // in-flight stretch, landing squash spring
        sy = 1 + 0.08 * Math.sin(Math.PI * kf);
        const tl = t - (tf + T.flyDur);
        if (tl > 0) {
          landedCount++;
          const sq = 0.16 * Math.exp(-tl * 7) * Math.cos(tl * 17);
          sy = 1 - sq; sxz = 1 + sq * 0.5;
        }
      }
      b.grp.position.set(x, y, z);
      b.grp.rotation.set(0, yaw, 0);
      b.grp.scale.set(sxz, sy, sxz);
      b.grp.visible = grow > 0.002;
      // glow: brief flash at rise, landing, and the "total" sweep bottom→top
      const land = tf + T.flyDur;
      const fl = Math.exp(-Math.max(0, t - land) * 6) * (t > land ? 1 : 0) * 0.5;
      const sweepT = T.total + b.i * 0.045;
      const sw = t > sweepT ? Math.exp(-(t - sweepT) * 3.2) : 0;
      b.mat.emissiveIntensity = fl + sw * 0.45 + Math.exp(-Math.max(0, t - tr) * 5) * (t > tr ? 0.4 : 0);
      b.mat.opacity = gOut; b.face.material.opacity = gOut;
      b.mesh.castShadow = gOut > 0.5;
    }

    // platform: appears on "stacks", pulses on every landing + total
    const pk = U.clamp((t - (T.fly0 - 0.35)) / 0.5);
    const ps = Math.max(0.001, U.backOut(pk, 1.6));
    this.plat.scale.set(ps, ps, ps);
    this.plat.visible = pk > 0;
    this.disc.material.transparent = true; this.disc.material.opacity = gOut;
    this.ring.material.opacity = gOut;
    const tp = t - T.total;
    const pr = tp > 0 && tp < 1.1 ? tp / 1.1 : 0;
    this.pulse.scale.setScalar(1 + pr * 1.4);
    this.pulse.material.opacity = pr > 0 ? (1 - pr) * gOut : 0;
    const tk = U.clamp((t - (T.fly0 - 0.2)) / 0.5);
    this.teth.scale.y = Math.max(0.001, tk); this.teth.position.y = B[1] - (B[1] * tk) / 2;
    this.teth.material.opacity = 0.45 * gOut;

    // ---- HUD ----
    // per-piece minute tags only while they sit on the road would be clutter; the faces carry the numbers.
    const aTot = U.win(t, T.total, T.eq2 + 0.25, 0.2, 0.3);
    if (aTot > 0) hud.label('s10tot', this.mid, 'total · 23 min', { dx: 70, dy: -40, alpha: aTot, dark: true, color: P.forecastGlow });

    // equation: "6:19 + 23 min" then "= 6:42"; the 6:42 flies into the ETA card
    const EQY = 405;
    const aEq = U.win(t, T.eq, T.fly642[1] + 0.2, 0.25, 0.25);
    const kEq = U.clamp((t - T.eq) / 0.35);
    const aEqA = aEq * (1 - U.smoother(U.inv(T.fly642[0], T.fly642[0] + 0.3, t)) * 0.65);
    const kFl = U.smoother(U.inv(T.fly642[0], T.fly642[1], t));
    const pA = aEq * (1 - kFl);
    this.pill.style.opacity = pA;
    this.pill.style.transform = `translate(${540 - 380}px, ${EQY - 68 + (1 - U.easeOut(kEq)) * 24}px) scale(${0.92 + 0.08 * U.easeOut(kEq)}, ${0.92 + 0.08 * U.easeOut(kEq)})`;
    if (aEq > 0) hud.big('s10eqA', '6:19 + 23 min =', { x: 425, y: EQY + (1 - U.easeOut(kEq)) * 24, size: 58, color: '#ffffff', alpha: Math.min(aEqA, pA) });
    const k2 = U.clamp((t - T.eq2) / 0.4);
    const kF = U.smoother(U.inv(T.fly642[0], T.fly642[1], t));
    if (k2 > 0 && t < T.fly642[1] + 0.12) {
      const sx = 770, syy = EQY - 4, ex = 452, ey = 232;
      const x = U.lerp(sx, ex, kF), y = U.lerp(syy, ey, kF) - Math.sin(Math.PI * kF) * 50;
      const sc = U.lerp(U.backOut(k2, 2.2), 0.82, kF);
      hud.big('s10eqB', '6:42', { x, y, size: 88, color: P.forecastGlow, alpha: Math.min(1, k2 * 2) * (1 - U.inv(T.fly642[1] - 0.05, T.fly642[1] + 0.12, t)), scale: sc, shadow: '0 0 26px rgba(180,156,255,.55)' });
    }

    // ETA card: shows "leave 6:19" while the trip is being summed, then rolls to arrive 6:42 on impact
    if (t > 50.95) {
      const land = T.fly642[1];
      if (t < land) {
        const dip = U.clamp(Math.abs(t - 51.2) / 0.22);
        hud.eta({ time: '6:19', kicker: 'LEAVE', state: 'plan', sub: 'now', alpha: t < 51.2 ? dip : U.smooth(dip), scale: 0.96 });
      } else {
        const k = U.clamp((t - land) / 0.55);
        const pop = 1 + 0.12 * Math.exp(-(t - land) * 5) * Math.cos((t - land) * 14);
        hud.eta({ time: '6:42', prev: '6:19', k, kicker: 'ARRIVE', state: 'forecast', sub: '23 min', scale: 0.96 + 0.04 * U.clamp((t - land) / 0.3) + (pop - 1), flash: P.forecastGlow });
      }
    }
  },

  camera(ctx, t) {
    const { U } = ctx;
    const tc = U.clamp(t, 50.4, 56.9);
    const keys = this._keys || (this._keys = [
      [50.4, { pos: [-740, 560, 760], target: [-210, 0, 250], fov: 38 }],
      [51.4, { pos: [-700, 600, 720], target: [-150, 10, 190], fov: 38 }],
      [52.75, { pos: [-560, 860, 880], target: [170, 40, -20], fov: 36 }],
      [54.0, { pos: [-521, 635, 791], target: [330, 265, -60], fov: 35 }],
      [56.9, { pos: [-376, 611, 858], target: [335, 275, -60], fov: 34 }],
    ]);
    const p = splineCam(keys, tc, U);
    p.pos[1] += U.drift(t, 2) * 4;
    return p;
  },
};
