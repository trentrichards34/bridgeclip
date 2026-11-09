// Kit showcase: every kit model in 8 posed shots (shot N is drawn at t = N + 0.5). It is also a working example of
// nearly every kit call. Rendered by:  node engines/explainer3d/tools/showcase.mjs <project>   (writes stills/showcase_*.jpg + sheet)
// Open it live with: node tools/reel.mjs preview <project>  then  <url>/showcase.html?t=3.5
import * as THREE from 'three';
import * as K from '/engine/kits/studio.js';
import * as G from '/engine/kits/gadgets.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const shots = [];
// studio shot: build(ctx, root, o) returns { update(ctx, t), cam: [pos offset, target offset, fov] }
function studio(name, build) { shots.push({ name, look: 'studio', build }); }
function city(name, build) { shots.push({ name, look: 'city', build }); }

studio('exploded phone, grid dip, field lines, charge flow, labels', (ctx, root, o) => {
  const phone = K.makePhone(ctx, { look: 'home' }); phone.group.position.copy(o); root.add(phone.group);
  const hand = K.makeHand(ctx); root.add(hand.group);
  const lines = K.makeFieldLines(ctx); root.add(lines.group);
  const ch = K.makeCharges(ctx, 120); root.add(ch.group);
  const floor = K.studioFloor(ctx, { r: 60 }); floor.group.position.copy(o).add(V(0, -2.5, 0)); root.add(floor.group);
  return {
    cam: [V(17, 21, 29), V(0, 3.2, 0.5), 32],
    update(ctx) {
      phone.explode(1); phone.look('home');
      const u = 0.6, v = 0.4, p = phone.screenPoint(u, v);
      hand.point({ pos: p.clone().add(V(0, 0.15, 0)), tilt: 42, yaw: 125 });
      const tip = hand.tip(), lc = phone.grid.toLocal(tip);
      phone.grid.setDips([{ x: lc.x, z: lc.z, r: 1.2, depth: 0.8 }]);
      phone.touchAt(u, v, 0.35);
      const [ci, cj] = phone.grid.nearest(lc.x, lc.z), cells = [];
      for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 1; j <= cj + 1; j++) if (Math.hypot(phone.grid.xs[j] - lc.x, phone.grid.zs[i] - lc.z) < 1.9) cells.push([i, j]);
      const aim = tip.clone().add(V(0, 0.4, 0));
      lines.fromCrossings(phone.grid, cells, aim, 0.35).update({ k: 1, phase: 0.3 });
      ch.hideAll(); let n = 0;
      cells.forEach(([i, j], c) => { const a = phone.grid.pos(i, j); for (let q = 0; q < 6; q++) { const k = ((q / 6) + c * 0.13) % 1; const ctrl = V(a.x + (a.x - aim.x) * 0.35, a.y + (aim.y - a.y) * 0.8, a.z + (a.z - aim.z) * 0.35); const pp = K.bezier(a, ctrl, aim, k); ch.setP(n++, pp.x, pp.y, pp.z, 0.7 + 0.5 * Math.sin(k * 3.14)); } });
      ctx.hud.label('sc-grid', phone.grid.pos(17, 0), 'sensor grid', { sub: 'rows x columns', dx: -150, dy: 120 });
      ctx.hud.label('sc-glass', phone.screenPoint(0.1, 0.12), 'cover glass', { dx: -120, dy: -110 });
    },
  };
});

studio('knit glove on a call screen, X + snow icons', (ctx, root, o) => {
  const phone = K.makePhone(ctx, { look: 'call' }); phone.group.position.copy(o); root.add(phone.group);
  const hand = K.makeHand(ctx, { glove: 'knit' }); root.add(hand.group);
  const x = K.makeIcon(ctx, 'x'); root.add(x.group);
  const snow = K.makeIcon(ctx, 'snow'); root.add(snow.group);
  const floor = K.studioFloor(ctx); floor.group.position.copy(o).add(V(0, -0.57, 0)); root.add(floor.group);
  return {
    cam: [V(-11, 17, 26), V(0.6, 3.2, 2.0), 32],
    update(ctx) {
      phone.look('call', { name: 'Alex', ring: 0.35 });
      const [u, v] = phone.ui.answer; hand.point({ pos: phone.screenPoint(u, v), tilt: 40, yaw: 150 });
      x.pop(1); x.group.position.copy(o).add(V(-2.6, 7.5, -1)); x.group.scale.setScalar(0.75);
      snow.pop(1); snow.group.position.copy(o).add(V(3.2, 10.5, -4)); snow.group.scale.setScalar(0.6);
      ctx.after.push(() => { x.group.lookAt(ctx.camera.position); snow.group.lookAt(ctx.camera.position); });
    },
  };
});

studio('x-ray hand with amber body charge, gauge / salt / bolt icons', (ctx, root, o) => {
  const hand = K.makeHand(ctx); root.add(hand.group);
  const ch = K.makeCharges(ctx, 90, { color: ctx.P.body, size: 0.11 }); root.add(ch.group);
  const icons = ['salt', 'gauge', 'bolt'].map((k) => { const ic = K.makeIcon(ctx, k); root.add(ic.group); return ic; });
  const R = K.rng(3), jit = Array.from({ length: 90 }, () => [R() - 0.5, R() - 0.5, R() - 0.5, R()]);
  let tg = V();
  return {
    camFn: () => ({ pos: tg.clone().add(V(-8, 4, 40)).toArray(), target: tg.toArray(), fov: 36 }),
    update(ctx) {
      hand.point({ pos: o.clone().add(V(1, 2, 0)), tilt: 30, yaw: 70 }); hand.xray(1);
      tg = hand.fingerPoint(0.55);
      const [salt, gauge, bolt] = icons;
      for (const ic of icons) ic.pop(1);
      salt.group.position.copy(tg).add(V(-4.2, 8, 0)); salt.group.scale.setScalar(0.5);
      gauge.group.position.copy(tg).add(V(4, -8.5, 0)); gauge.group.scale.setScalar(0.6); gauge.set(0.93);
      bolt.group.position.copy(tg).add(V(4.5, 9.5, 0)); bolt.group.scale.setScalar(0.5);
      ch.hideAll();
      for (let i = 0; i < 90; i++) { const s = (i / 90 + jit[i][3] * 0.01) % 1, p = hand.fingerPoint(s), w = 1.6 * (1 - s * 0.7); ch.setP(i, p.x + jit[i][0] * w, p.y + jit[i][1] * w, p.z + jit[i][2] * w, 0.6 + 0.6 * jit[i][3]); }
      ctx.after.push(() => icons.forEach((ic) => ic.group.lookAt(ctx.camera.position)));
    },
  };
});

studio('bar field with a crater under a fingertip', (ctx, root, o) => {
  const grid = K.makeGrid(ctx, { cols: 13, rows: 13, w: 12, h: 12, orb: 0.11 }); grid.group.position.copy(o); root.add(grid.group);
  const finger = K.makeFinger(ctx); root.add(finger.group);
  const lines = K.makeFieldLines(ctx); root.add(lines.group);
  const floor = K.studioFloor(ctx); floor.group.position.copy(o).add(V(0, -0.1, 0)); root.add(floor.group);
  return {
    cam: [V(13, 13, 17), V(0, 1.2, 0), 36],
    update(ctx) {
      const c = V(1, 0, -0.5);
      grid.reset().set({ bars: 1, charges: (i, j, x, z) => 1 - 0.75 * Math.exp(-((x - c.x) ** 2 + (z - c.z) ** 2) / 2.6) });
      grid.scan(0.25);
      finger.point({ pos: o.clone().add(V(c.x, 3.6, c.z)), tilt: 35, yaw: 200 });
      const cells = []; for (let i = 4; i <= 8; i++) for (let j = 6; j <= 9; j++) if (Math.hypot(grid.xs[j] - c.x, grid.zs[i] - c.z) < 1.8) cells.push([i, j]);
      lines.fromCrossings(grid, cells, finger.tip().add(V(0, 0.3, 0)), 0.3).update({ k: 0.85, phase: 0.2 });
      ctx.hud.label('sc-dip', grid.pos(6, 7), 'the dip', { sub: 'charge missing here', dx: -170, dy: 150 });
    },
  };
});

studio('map screen + two-finger pinch, water drops, pen', (ctx, root, o) => {
  const phone = K.makePhone(ctx, { look: 'map' }); phone.group.position.copy(o); root.add(phone.group);
  const hand = K.makeHand(ctx); root.add(hand.group);
  const pen = K.makePen(ctx); root.add(pen.group);
  const drops = [0, 1, 2, 3].map(() => { const d = K.makeDrop(ctx); root.add(d.group); return d; });
  const floor = K.studioFloor(ctx); floor.group.position.copy(o).add(V(0, -0.57, 0)); root.add(floor.group);
  return {
    cam: [V(6, 33, 21), V(0, 0.5, 0.3), 36],
    update() {
      phone.look('map', { zoom: 1.6, ghosts: [[0.22, 0.2, 0.9]] });
      hand.pinch(0.7, { pos: phone.screenPoint(0.52, 0.45), yaw: 150, lean: 30 });
      const a = phone.uvOf(hand.tip()), b = phone.uvOf(hand.thumbTip());
      phone.touchAt(a[0], a[1], 0.25, 0); phone.touchAt(b[0], b[1], 0.25, 1);
      [[0.22, 0.2, 'sit', 0.5], [0.3, 0.82, 'sit', 0.4], [0.72, 0.18, 'fall', 0.5], [0.15, 0.55, 'sit', 0.35]]
        .forEach(([u, v, mode, r], i) => drops[i].set({ pos: phone.screenPoint(u, v, V(), mode === 'fall' ? 3.5 : 0), mode, radius: r }));
      pen.set({ pos: phone.screenPoint(0.8, 0.8, V(), 1.2), tilt: 30, yaw: -40 });
    },
  };
});

city('golden-hour city: route ribbon, traffic, top card, pill labels', (ctx) => {
  const c = ctx.city, route = c.paths.route;
  const rib = new THREE.Mesh(ctx.ribbonGeometry(route, 0, route.length, 12, { dy: 0.45, step: 3 }), ctx.ribbonMaterial(ctx.C.route, { glow: 0.55 }));
  rib.renderOrder = 5; ctx.scene.add(rib);
  const seg = c.segments[4];
  const jam = new THREE.Mesh(ctx.ribbonGeometry(route, seg.s0, seg.s1, 16, { dy: 0.6, step: 3 }), ctx.ribbonMaterial(ctx.C.jam, { glow: 0.4 }));
  jam.renderOrder = 6; ctx.scene.add(jam);
  const dt = c.landmarks.downtown;
  return {
    objs: [rib, jam],
    camFn: () => ({ pos: [dt.x - 250, 620, dt.z + 900], target: [dt.x - 420, 0, dt.z + 330], fov: 36 }),
    update(ctx) {
      c.hero.mesh.visible = true; c.hero.update(2);
      ctx.hud.card({ kicker: 'ARRIVE', value: '6:42', unit: 'PM', sub: '23 min', state: 'live' });
      ctx.hud.chip({ label: 'LIVE  58 MPH', color: ctx.C.live });
      ctx.hud.label('sc-jam', route.at(seg.mid), 'slowdown', { color: ctx.C.jam, small: '4 min', dx: 70, dy: -110 });
      ctx.hud.label('sc-dest', c.landmarks.destTop, 'destination', { color: ctx.C.route, dx: -60, dy: -80 });
    },
  };
});

city('gadgets on the street: walker with phone, suitcase + tracker, pulse rings, contact shadows', (ctx) => {
  G.initLib(ctx);
  const street = G.makeStreetProps(ctx); ctx.scene.add(street);
  const bag = G.makeSuitcase(ctx); street.userData.bagSlot.add(bag);
  const tag = G.makeTracker(ctx, { scale: 0.09 }); bag.userData.tagSlot.add(tag);
  const passer = G.makePerson(ctx, { seed: 11, phone: true, phoneIn: 'pocket' }); ctx.scene.add(passer);
  const ringsG = G.pulseRings(ctx, { maxR: 3.2, count: 3, period: 1.7 }); ctx.scene.add(ringsG.group);
  const ringsA = G.pulseRings(ctx, { maxR: 1.6, count: 3, period: 1.6, mode: 'billboard' }); ctx.scene.add(ringsA.group);
  const v = V();
  return {
    objs: [street, passer, ringsG.group, ringsA.group],
    camFn: () => ({ pos: [150.6, 1.6, 95.5], target: [157, 0.95, 105.5], fov: 38 }),
    update(ctx, t) {
      G.fade(bag.userData.shell, 0.35);
      G.walk(passer, t, { path: G.LOC.streetWalk, s0: 32.3, t0: 6.2, speed: 1.35 });
      street.userData.bagSlot.getWorldPosition(v); ringsG.update(t, v, 1);
      passer.userData.phone.getWorldPosition(v); ringsA.update(t, v, 0.9);
      ctx.hud.label('sc-bag', street.userData.bagSlot.getWorldPosition(V()).add(V(0, 0.7, 0)), 'tracker inside', { dx: 60, dy: -120 });
    },
  };
});

city('lineup room: cloud vault, sealed packet on an arc, handset map + arrow screens, tracker, people', (ctx) => {
  G.initLib(ctx);
  const st = G.LOC.stage, A = (x, y, z) => V(st.x + x, st.y + y, st.z + z);
  const room = G.makeEmptyRoom(ctx); ctx.scene.add(room);
  const cloud = G.makeCloud(ctx); cloud.position.copy(A(0, 4.4, -3.2)); cloud.scale.setScalar(0.3); ctx.scene.add(cloud);
  const walker = G.makePerson(ctx, { seed: 3, phone: true, phoneIn: 'hand' }); walker.position.copy(A(-1.7, 0, -0.6)); walker.rotation.y = 0.35; ctx.scene.add(walker);
  const bag = G.makeSuitcase(ctx); bag.position.copy(A(0.9, 0, -0.4)); bag.scale.setScalar(1.5); bag.rotation.y = -0.45; ctx.scene.add(bag);
  const tag = G.makeTracker(ctx, { scale: 0.8 }); tag.position.copy(A(0.4, 0.85, 2.3)); ctx.scene.add(tag);
  const mapPh = G.makeHandset(ctx, { w: 0.45 }); mapPh.position.copy(A(-1.25, 0.56, 2.0)); mapPh.rotation.set(-0.12, 0.28, 0); ctx.scene.add(mapPh);
  const arrowPh = G.makeHandset(ctx, { w: 0.45 }); arrowPh.position.copy(A(1.75, 0.56, 1.5)); arrowPh.rotation.set(-0.12, -0.32, 0); ctx.scene.add(arrowPh);
  const pk = G.makePacket(ctx); pk.scale.setScalar(0.22); ctx.scene.add(pk);
  const v = V(), v2 = V();
  return {
    objs: [room, cloud, walker, bag, tag, mapPh, arrowPh, pk],
    camFn: () => ({ pos: A(0.2, 3.4, 14.2).toArray(), target: A(0.1, 1.75, 0).toArray(), fov: 35 }),
    update(ctx, t) {
      walker.userData.gait(t * 0.95, 1);
      tag.rotation.set(0.42, 0.3 * Math.sin(t * 0.5), 0.12);
      G.drawMapScreen(mapPh.userData.screen, { t, label: 'Backpack', sub: 'seen 2 min ago', dist: '2.4 mi', pinXY: [0.56, 0.36], you: [0.32, 0.6] });
      G.drawArrowScreen(arrowPh.userData.screen, { t, angleDeg: -58, distance: '4 m', sub: 'to your left', label: 'Backpack' });
      walker.userData.phone.getWorldPosition(v); cloud.userData.inlet.getWorldPosition(v2);
      G.flyArc(pk, v, v2, 0.55, { lift: 1.2 });
    },
  };
});

export function showcase() {
  const scenes = {}, beats = [];
  shots.forEach((s, i) => {
    const id = 'shot' + i;
    beats.push({ id, t0: i, look: s.look, blend: 0, transition: 'cut' });
    let B = null, root = null;
    scenes[id] = {
      init(ctx, spec) {
        root = new THREE.Group(); ctx.scene.add(root);
        B = s.build(ctx, root, new THREE.Vector3(...spec.o));
      },
      update(ctx, t, spec) {
        const on = t >= spec.t0 && t < spec.t1;
        root.visible = on; (B.objs || []).forEach((o) => { o.visible = on; });
        if (on) B.update(ctx, t);
      },
      camera(ctx, t, spec) {
        if (B.camFn) return B.camFn();
        const o = new THREE.Vector3(...spec.o), d = Math.sin(t * 0.7) * 0.15;
        return { pos: o.clone().add(B.cam[0]).add(V(d, 0, 0)).toArray(), target: o.clone().add(B.cam[1]).toArray(), fov: B.cam[2] };
      },
    };
  });
  return { reel: { style: 'explainer3d', name: 'showcase', captions: { off: true } }, words: [], scenes, plan: () => ({ beats, duration: shots.length }), names: shots.map((s) => s.name) };
}
