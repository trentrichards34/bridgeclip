// CITY EXAMPLE (city look, units = m). Not in the default plan: enable it in plan.js with look:'city'.
// Golden-hour paper city. A route line draws out of the driveway and races across the city with a glowing tip,
// the hero car pulls out, pulse rings mark the start, the top card rolls its value, a pill label pins the destination.
// The camera cranes from a low driveway shot up to a high oblique over the whole trip. All cues use spec.cue(word, frac).
import * as THREE from 'three';
import { pulseRings } from '/engine/kits/gadgets.js';

let S = null;

function cues(spec) {
  return { draw: spec.cue('route', 0.1), land: spec.cue('there', 0.8) };
}

export default {
  init(ctx, spec) {
    const { C } = ctx, city = ctx.city, route = city.paths.route;
    const mat = ctx.ribbonMaterial(C.route, { glow: 0.55 });
    const ribbon = new THREE.Mesh(ctx.ribbonGeometry(route, 0, route.length, 9, { dy: 0.45, step: 3 }), mat);
    ribbon.renderOrder = 5; ctx.scene.add(ribbon);
    const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(C.routeGlow).multiplyScalar(1.8), transparent: true, depthWrite: false, toneMapped: false });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 12), tipMat); ctx.scene.add(tip);
    const rings = pulseRings(ctx, { color: C.route, maxR: 10, count: 3, period: 1.6, fill: 0.12 }); ctx.scene.add(rings.group);
    S = { ribbon, mat, tip, rings };
    ctx.sfx(cues(spec).land, 'ding', 0.7);
  },

  update(ctx, t, spec) {
    const { U, C } = ctx, city = ctx.city, route = city.paths.route, { ribbon, mat, tip, rings } = S;
    const on = spec.on(t);
    ribbon.visible = on; rings.group.visible = on;
    if (!on) { rings.update(t, [0, -999, 0], 0); return; }
    const Q = cues(spec);
    const k = U.smooth(U.inv(Q.draw - 0.15, Q.land, t));
    mat.uniforms.to.value = k; mat.uniforms.opacity.value = 0.95;
    tip.visible = k > 0.03 && k < 0.999;
    tip.position.copy(route.at(k * route.length)).add(new THREE.Vector3(0, 1.5, 0));
    tip.scale.setScalar(1 + 0.25 * Math.sin(t * 9));
    rings.update(t, route.at(0).add(new THREE.Vector3(0, 0.3, 0)), U.win(t, spec.t0, Q.draw + 1.5, 0.3, 0.6));
    // the hero car: shown and posed every frame we want it (core hides it each frame)
    city.hero.schedule({ go: Q.draw, speed: 20 });
    city.hero.mesh.visible = true; city.hero.update(t);
    if (ctx.look !== 'city') return;                    // HUD only while the city is on screen (not during a whip into studio)
    // HUD: top card with a rolling value, a pill label on the destination
    const mins = Math.round(U.lerp(0, 23, k));
    ctx.hud.card({ kicker: 'ARRIVE', value: String(mins), unit: 'min', sub: 'live', state: 'live', alpha: U.inv(spec.t0, spec.t0 + 0.5, t) });
    const la = U.win(t, Q.land - 0.2, spec.t1 + 0.4, 0.3, 0.3);
    if (la > 0) ctx.hud.label('dest', city.landmarks.destTop, 'destination', { color: C.route, dx: -60, dy: -80, alpha: la });
  },

  camera(ctx, t, spec) {
    const U = ctx.U, city = ctx.city, Q = cues(spec), route = city.paths.route, car = route.at(0);
    const tc = U.clamp(t, spec.t0 - 0.6, spec.t1 + 0.6);
    // opening: low on the parked car; then the camera follows the route tip, rising as the line races across the city
    const k = U.smooth(U.inv(Q.draw - 0.15, Q.land, tc)), tp = route.at(k * route.length);
    const open = U.pose([car.x + 22, 9, car.z + 8], [car.x, 1.2, car.z - 2], 38);
    const follow = U.pose([tp.x + 30 + 180 * k, 40 + 640 * k, tp.z + 70 + 560 * k], [tp.x - 60 * k, 0, tp.z - 40 * k], 38 - 2 * k);
    const m = U.smoother(U.inv(spec.t0 + 0.2, Q.draw + 1.2, tc));
    const p = U.poseTrack([[0, open], [1, follow]], m);
    p.pos = [p.pos[0] + 2 * U.drift(tc, 2), p.pos[1], p.pos[2] + 2 * U.drift(tc, 3)];
    return p;
  },
};
