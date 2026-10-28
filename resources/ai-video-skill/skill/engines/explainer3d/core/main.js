// explainer3d runtime. Boots three.js, the two looks (studio / city), captions, HUD and every scene in the plan,
// then implements the page contract (engines/CONTRACT.md): window.READY, DURATION, renderAt(t), CAPTURE, SFX.
//   index.html?t=3.5           draw one frame
//   index.html?play            real-time playback (click the page to start audio/vo.mp3 in sync)
//   index.html?only=<sceneId>  only that scene updates (others hidden); during its whip-in / whip-out the neighbour beat
//                              is drawn too, so transitions can be checked on their own
// The project folder supplies: reel.json, plan.js, scenes/<id>.js, build/words.json. Never edit core per reel.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { P, C } from './palette.js';
import * as U from './util.js';
import { Captions } from './captions.js';
import { HUD } from './hud.js';
import { loadPlan } from './plan.js';

const W = 1080, H = 1920, FPS = 30, GAP = 120;
const qs = new URLSearchParams(location.search);
const BASE = new URL('.', location.href);
window.CAPTURE = 'screenshot';

// per-look settings (a scene can still override exposure / bloom / bg / fog for its frames through ctx)
const LOOKS = {
  studio: { exposure: 1.0, bloom: [0.7, 0.55, 0.82], near: 0.05, far: 4000, fov: 32, hemi: ['#c9d6ea', '#1a1d24', 0.35], key: ['#fff4e8', 2.2], rim: 1.4, env: 0.55,
    grade: 'radial-gradient(120% 85% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.35) 100%)', grain: 0.05 },
  city: { exposure: 1.02, bloom: [0.55, 0.6, 0.9], near: 0.5, far: 9000, fov: 35, hemi: ['#dfe9f6', '#e2d3bd', 0.95], key: ['#ffeed6', 2.9], rim: 0, env: 0,
    grade: 'radial-gradient(120% 85% at 50% 45%, rgba(0,0,0,0) 55%, rgba(20,24,32,0.22) 100%)', grain: 0.055 },
};
const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();

function buildDom() {
  document.documentElement.style.cssText = 'margin:0;padding:0;background:#000;overflow:hidden';
  document.body.style.cssText = 'margin:0;padding:0;background:#000;overflow:hidden';
  const st = document.createElement('style');
  st.textContent = `#stage{position:relative;width:${W}px;height:${H}px;overflow:hidden}
#c{position:absolute;inset:0;width:${W}px;height:${H}px;display:block}
#fx,#hud{position:absolute;inset:0;pointer-events:none;font-family:Figtree,Inter,Fallback,sans-serif;overflow:hidden}
#capwash{position:absolute;left:0;right:0;top:0;height:640px;pointer-events:none}
#grade{position:absolute;inset:0;pointer-events:none}
#grain{position:absolute;inset:-50%;pointer-events:none;mix-blend-mode:overlay}
#flash{position:absolute;inset:0;pointer-events:none;background:#fff;opacity:0}`;
  document.head.appendChild(st);
  document.body.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute"><filter id="whipblur" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur id="whipdev" stdDeviation="0 0"/></filter></svg>
<div id="stage"><canvas id="c" width="${W}" height="${H}"></canvas><div id="fx"></div><div id="grade"></div><canvas id="grain" width="512" height="512"></canvas><div id="capwash"></div><div id="hud"></div><div id="flash"></div></div>`);
}

async function boot() {
  if (!document.getElementById('stage')) buildDom();
  const $ = (id) => document.getElementById(id);
  // window.EXPLAINER3D = { reel, words, plan, scenes: {id: module} } (set before loading main.js) replaces the project files:
  // the kit showcase uses it. Normal reels never set it.
  const OV = window.EXPLAINER3D || {};
  const reel = OV.reel ?? await fetch(new URL('reel.json', BASE)).then((r) => r.json()).catch(() => ({}));
  const words = OV.words ?? await fetch(new URL('build/words.json', BASE)).then((r) => r.json()).catch(() => { console.warn('no build/words.json yet: run tools/tts.py'); return []; });
  const { beats, duration, keys, T } = await loadPlan(words, reel, BASE, OV.plan);
  { const txt = (words || []).map(w => w.w).join(' '); if (/[^\u0000-\u024F\s\p{P}\p{N}]/u.test(txt)) await Promise.all(['400 80px Fallback', '700 80px Fallback', '900 80px Fallback', 'italic 400 80px Fallback'].map(f => document.fonts.load(f, txt).catch(() => {}))); }   // non-Latin script → load its Fallback face before frames

  const hasCity = beats.some((b) => b.look === 'city');
  const hasStudio = beats.some((b) => b.look !== 'city');
  const STUDIO_Z = hasCity ? 30000 : 0;   // studio stations sit far from the city (beyond the city camera's far plane)

  // ---------- renderer ----------
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.fog, 1e7, 2e7);
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.05, 4000);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const hemi = new THREE.HemisphereLight('#c9d6ea', '#1a1d24', 0.35); scene.add(hemi);
  const key = new THREE.DirectionalLight('#fff4e8', 2.2);
  key.castShadow = true; key.shadow.mapSize.set(hasCity ? 4096 : 2048, hasCity ? 4096 : 2048);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#7fb0ff', 1.4); scene.add(rim, rim.target);

  // studio backdrop: screen-space vertical gradient, repainted only when colours change
  const bgCanvas = document.createElement('canvas'); bgCanvas.width = 4; bgCanvas.height = 512;
  const bgTex = new THREE.CanvasTexture(bgCanvas); bgTex.colorSpace = THREE.SRGBColorSpace;
  let bgKey = '';
  const paintBg = (top, mid, bottom) => {
    const k = top + mid + bottom; if (k === bgKey) return; bgKey = k;
    const g = bgCanvas.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, 4, 512); bgTex.needsUpdate = true;
  };

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1); composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.7, 0.55, 0.82);
  composer.addPass(bloom); composer.addPass(new OutputPass());

  // grain (static, deterministic)
  { const g = $('grain'), c = g.getContext('2d'), R = U.rng(5), img = c.createImageData(512, 512);
    for (let i = 0; i < img.data.length; i += 4) { const v = (R() * 255) | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    c.putImageData(img, 0, 0); }

  const capCfg = reel.captions || {};
  const caps = new Captions($('hud'), words, { ...capCfg, keys: [...(capCfg.keys || []), ...keys] });
  const hud = new HUD($('hud'), $('fx'), camera);

  // ---------- context handed to every scene ----------
  const SFX = [];
  const ctx = {
    THREE, scene, camera, renderer, P, C, U, W, H, FPS, DURATION: duration, PLAN: beats, reel, words: T.words,
    wordAt: T.wordAt, find: T.find, wi: T.wi, sentences: T.sentences,
    key, sun: key, rim, hemi, bloom, fx: $('fx'), hud, get composer() { return composer; },
    sfx(t, name, gain = 1) { if (t != null && isFinite(t)) SFX.push({ t: +(+t).toFixed(3), name, gain }); },
    // a world-aligned Group for this beat (at the origin: kits work in WORLD coordinates). Put your hero at spec.o.
    station(spec) { const g = new THREE.Group(); g.name = spec.id; scene.add(g); return g; },
    // Point / spot light in "studio units" (init only). three.js uses physical inverse-square falloff that assumes METRES,
    // but studio scenes are in CENTIMETRES, so a raw PointLight needs intensities in the hundreds and blows out up close.
    // Here `intensity` 1 = as bright as a directional light of intensity 1 on a surface `range` cm from the light
    // (the studio key is 2.2). Light fades to 0 at 4 x range, so it never leaks onto other stations.
    // Returns the THREE light; `light.level(k)` scales it (use level(0) outside your beat instead of visible = false).
    light(type = 'point', { color = '#ffffff', intensity = 1, range = 20, pos = [0, 0, 0], target = null, angle = 30, penumbra = 0.5, shadow = false, parent = null } = {}) {
      const I = intensity * range * range;
      const L = type === 'spot' ? new THREE.SpotLight(color, I, range * 4, THREE.MathUtils.degToRad(angle), penumbra, 2) : new THREE.PointLight(color, I, range * 4, 2);
      L.position.set(...pos);
      const host = parent || scene; host.add(L);
      if (L.isSpotLight) { L.target.position.set(...(target || [pos[0], pos[1] - 1, pos[2]])); host.add(L.target); }
      if (shadow) { L.castShadow = true; L.shadow.mapSize.set(1024, 1024); L.shadow.camera.near = Math.max(0.05, range * 0.03); L.shadow.camera.far = range * 4; L.shadow.bias = -0.0005; L.shadow.normalBias = 0.02; }
      L.userData.base = I;
      L.level = (k = 1) => { L.intensity = I * Math.max(0, k); return L; };
      return L;
    },
    // per-frame overrides (reset every frame)
    bg: null, exposure: null, bloomK: null, fog: null, capDy: 0, capHide: false, flash: 0, shake: 0, after: [], look: 'studio', t: 0,
  };
  window.ctx = ctx;

  if (hasCity) {
    const city = await import('../kits/city.js');
    city.buildCity(ctx);
    Object.assign(ctx, { world: ctx.city, ribbonGeometry: city.ribbonGeometry, ribbonMaterial: city.ribbonMaterial, carGeometry: city.carGeometry });
  }

  // ---------- specs ----------
  let si = 0;
  const specs = beats.map((b, i) => {
    const spec = { ...b, o: b.look === 'city' ? [0, 0, 0] : [(si++) * GAP, 0, STUDIO_Z] };
    spec.dur = spec.t1 - spec.t0;
    spec.out = i < beats.length - 1 ? beats[i + 1].blend : 0;
    spec.transition = b.transition || (i > 0 && b.look === 'city' && beats[i - 1].look === 'city' ? 'swoop' : (b.blend > 0 ? 'whip' : 'cut'));
    spec.words = T.words.filter((w) => w.s >= spec.t0 - 0.02 && w.s < spec.t1 - 0.02);
    spec.line = spec.words.map((w) => w.w).join(' ');
    // cue('word' | 'a longer phrase' | wordIndexInBeat, frac, nth). A number = the n-th word of THIS beat (like spec.wt).
    spec.cue = (word, frac = 0.5, nth) => {
      if (typeof word === 'number') return spec.wt(word, frac);
      const parts = String(word).split(/\s+/).filter(Boolean);
      if (nth === undefined && parts.length === 1) {   // short repeated words ("it", "a", "to") are ambiguous: say so once
        const b = parts[0].toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''), seen = spec._cueWarned || (spec._cueWarned = new Set());
        const count = spec.words.filter((w) => w.b === b).length;
        if (b.length <= 2 && count > 1 && !seen.has(b)) { seen.add(b);
          console.error(`warning: spec.cue('${word}') in beat "${spec.id}" is ambiguous (said ${count} times in this beat; matches the FIRST). Use a longer phrase, spec.cue(wordIndex) or pass nth explicitly.`); }
      }
      const w = T.find(word, spec.t0 - 0.3, nth || 0);
      return w && w.s < spec.t1 + 0.3 ? w.s : spec.t0 + U.clamp(frac) * spec.dur;
    };
    spec.wt = (i, frac) => {
      const ws = spec.words; if (!ws.length) return spec.t0 + (frac ?? 0) * spec.dur;
      const k = i < 0 ? ws.length + i : i;
      if (k < 0 || k >= ws.length) return frac != null ? spec.t0 + frac * spec.dur : ws[Math.max(0, Math.min(ws.length - 1, k))].s;
      return ws[k].s;
    };
    spec.k = (t) => U.clamp((t - spec.t0) / spec.dur);
    spec.on = (t, pad = 0.05) => t >= spec.t0 - spec.blend / 2 - pad && t <= spec.t1 + spec.out / 2 + pad;
    return spec;
  });

  // ---------- scenes ----------
  const only = qs.get('only');
  const scenes = [];
  for (const spec of specs) {
    let mod = null;
    try { mod = OV.scenes?.[spec.id] ?? (await import(new URL(`scenes/${spec.id}.js`, BASE).href)).default; }
    catch (e) { console.error('scene missing or broken, using placeholder:', spec.id, e.message); mod = {}; }
    scenes.push({ spec, mod: mod || {} });
  }
  for (const s of scenes) { try { await s.mod.init?.(ctx, s.spec); } catch (e) { console.error('init failed', s.spec.id, e); s.broken = true; } }
  if (ctx.traffic) ctx.traffic.precompute();

  // transitions get an automatic whoosh (its peak lands on the cut)
  for (const s of specs) if (s.n > 0 && s.blend > 0 && s.transition !== 'cut') ctx.sfx(s.t0 - 0.2, s.transition === 'swoop' ? 'swoosh' : 'whoosh', s.transition === 'swoop' ? 0.6 : 0.8);
  SFX.sort((a, b) => a.t - b.t);
  window.SFX = SFX.filter((c) => c.t >= 0 && c.t < duration);

  // ---------- camera ----------
  function placeholderPose(spec, t) {
    if (spec.look === 'city' && ctx.city) { const d = ctx.city.landmarks.downtown; return U.orbit([d.x, d.y, d.z], 700, 30 + t * 4, 38, 35); }
    return U.orbit([spec.o[0], spec.o[1] + 2, spec.o[2]], 40, (t - spec.t0) * 10, 20, 32);
  }
  function scenePose(i, t) {
    const s = scenes[i];
    try { const p = (s.mod.camera && !s.broken) ? s.mod.camera(ctx, t, s.spec) : null; if (p) return p; }
    catch (e) { console.error('camera failed', s.spec.id, e); }
    return placeholderPose(s.spec, t);
  }
  // Whip settings of the transition INTO beat sp. Default: yaw 14 deg, direction alternates (odd beat n pans left, even pans right),
  // roll 0.12 deg per yaw deg, and in the studio the yaw shrinks with the shot's framing distance (macro shots at 5-10 cm would
  // otherwise leave the hero out of frame): yaw x clamp(dist / 30 cm, 0.3, 1). plan.js `whip` overrides it per beat:
  //   whip: 6                                    fixed 6 deg (no distance scaling), default direction; whip: 0 = blur only
  //   whip: { dir: 'left'|'right', yaw, roll, auto }   any subset; an explicit yaw turns auto scaling off unless auto: true
  const WHIP_REF = 30;
  function whipCfg(sp) {
    const w = sp.whip, c = { dir: sp.n % 2 ? 1 : -1, yaw: 14, roll: 0.12, auto: true };
    if (typeof w === 'number') { c.yaw = Math.abs(w); c.auto = false; }
    else if (w && typeof w === 'object') {
      if (w.dir != null) c.dir = w.dir === 'right' || w.dir === -1 ? -1 : 1;
      if (w.yaw != null) { c.yaw = Math.abs(+w.yaw || 0); c.auto = false; }
      if (w.roll != null) c.roll = +w.roll || 0;
      if (w.auto != null) c.auto = !!w.auto;
    }
    return c;
  }
  const whip = (p, ang, rollK = 0.12) => {
    const pos = U.v3(p.pos), tg = U.v3(p.target), d = tg.clone().sub(pos);
    d.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(ang));
    return { ...p, target: U.arr(pos.clone().add(d)), roll: (p.roll ?? 0) + ang * rollK };
  };
  const whipAmp = (c, p, look) => {   // yaw for this pose: scaled by framing distance in the studio (cm)
    if (!c.auto || look === 'city') return c.yaw;
    const d = U.v3(p.pos).distanceTo(U.v3(p.target));
    return c.yaw * U.clamp(d / WHIP_REF, 0.3, 1);
  };
  function swoopPose(a, b, k) {
    const pa = U.v3(a.pos), pb = U.v3(b.pos), ta = U.v3(a.target), tb = U.v3(b.target);
    const pos = pa.clone().lerp(pb, k), target = ta.clone().lerp(tb, k);
    pos.y += Math.sin(Math.PI * k) * Math.min(260, pa.distanceTo(pb) * 0.22);
    return { pos: U.arr(pos), target: U.arr(target), fov: U.lerp(a.fov ?? 35, b.fov ?? 35, k), roll: U.lerp(a.roll ?? 0, b.roll ?? 0, k), near: k < 0.5 ? a.near : b.near, far: k < 0.5 ? a.far : b.far };
  }
  // i = incoming beat, k = 0..1 through its blend
  function blendPose(i, t, k) {
    const sp = specs[i];
    if (sp.transition === 'swoop') {
      const kk = U.smoother(k);
      return { pose: swoopPose(scenePose(i - 1, t), scenePose(i, t), kk), look: t < sp.t0 ? specs[i - 1].look : sp.look, blur: 0 };
    }
    const c = whipCfg(sp), blur = Math.sin(Math.PI * k) ** 2;
    if (t < sp.t0) {   // the look switches exactly at t0
      const p = scenePose(i - 1, t), lk = specs[i - 1].look;
      return { pose: whip(p, c.dir * whipAmp(c, p, lk) * U.easeIn(Math.min(1, k * 2)), c.roll), look: lk, blur };
    }
    const p = scenePose(i, t);
    return { pose: whip(p, -c.dir * whipAmp(c, p, sp.look) * (1 - U.easeOut(Math.max(0, k - 0.5) * 2)), c.roll), look: sp.look, blur };
  }
  function beatIndex(t) {
    const i = specs.findIndex((s) => t >= s.t0 && t < s.t1);
    return i < 0 ? (t < 0 ? 0 : specs.length - 1) : i;
  }
  function poseAt(t) {
    const i = beatIndex(t), s = specs[i];
    if (i > 0 && s.blend > 0 && t < s.t0 + s.blend / 2) return blendPose(i, t, U.clamp((t - (s.t0 - s.blend / 2)) / s.blend));
    if (i < specs.length - 1) {
      const nb = specs[i + 1].blend;
      if (nb > 0 && t >= s.t1 - nb / 2) return blendPose(i + 1, t, U.clamp((t - (s.t1 - nb / 2)) / nb));
    }
    return { pose: scenePose(i, t), look: s.look, blur: 0 };
  }

  function lookAt(t) {   // which look this frame shows (switches at the middle of a transition)
    const i = beatIndex(t), s = specs[i];
    if (i > 0 && s.blend > 0 && t < s.t0) return specs[i - 1].look;
    return s.look;
  }

  function applyCamera(p, t, look) {
    const L = LOOKS[look];
    let pos = p.pos;
    if (ctx.shake > 0) {
      const sz = ctx.shake * (look === 'city' ? 1.2 : 0.35);
      pos = [pos[0] + U.drift(t * 9, 1) * sz, pos[1] + U.drift(t * 9, 2) * sz, pos[2] + U.drift(t * 9, 3) * sz];
    }
    camera.position.set(...pos);
    camera.fov = p.fov ?? L.fov; camera.near = p.near ?? L.near; camera.far = p.far ?? L.far;
    camera.updateProjectionMatrix();
    camera.up.set(0, 1, 0);
    camera.lookAt(...p.target);
    if (p.roll) camera.rotateZ(THREE.MathUtils.degToRad(p.roll));
    camera.updateMatrixWorld();
    const tgt = U.v3(p.target), d = camera.position.distanceTo(tgt);
    const sc = key.shadow.camera;
    if (look === 'city') {
      const ext = U.clamp(d * 0.95, 70, 1300);
      key.target.position.copy(tgt); key.position.copy(tgt).addScaledVector(SUN_DIR, 1600);
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 200; sc.far = 3600;
      key.shadow.bias = -0.0004; key.shadow.normalBias = 0.6;
      scene.fog.near = Math.max(200, d * 1.6); scene.fog.far = d * 6 + 1800; scene.fog.color.set(C.fog);
      if (ctx.fog) { if (ctx.fog.near != null) scene.fog.near = ctx.fog.near; if (ctx.fog.far != null) scene.fog.far = ctx.fog.far; if (ctx.fog.color) scene.fog.color.set(ctx.fog.color); }
    } else {
      key.target.position.copy(tgt); key.position.copy(tgt).add(new THREE.Vector3(30, 60, 50));
      sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 200;
      key.shadow.bias = -0.0005; key.shadow.normalBias = 0.05;
      scene.fog.near = ctx.fog?.near ?? 1e7; scene.fog.far = ctx.fog?.far ?? 2e7; if (ctx.fog?.color) scene.fog.color.set(ctx.fog.color);
    }
    sc.updateProjectionMatrix();
    rim.target.position.copy(tgt); rim.position.copy(tgt).add(new THREE.Vector3(-40, 20, -60));
  }

  function applyLook(look) {
    const L = LOOKS[look];
    hemi.color.set(L.hemi[0]); hemi.groundColor.set(L.hemi[1]); hemi.intensity = L.hemi[2];
    key.color.set(L.key[0]); key.intensity = L.key[1];
    rim.intensity = L.rim; rim.visible = L.rim > 0;
    scene.environmentIntensity = L.env;
    if (ctx.city) ctx.city.group.visible = look === 'city';
    scene.background = look === 'city' ? null : bgTex;
    $('grade').style.background = L.grade; $('grain').style.opacity = L.grain;
  }

  // ?only: park every other scene once (they hide themselves outside their window). The neighbour beats are drawn too while
  // a transition into / out of the chosen beat is on screen, so whips and swoops can be checked with --only.
  const onlyIdx = only ? scenes.findIndex((s) => s.spec.id === only) : -1;
  if (only && onlyIdx < 0) console.error(`?only=${only}: no beat with that id (beats: ${specs.map((s) => s.id).join(', ')})`);
  if (only) for (const s of scenes) if (s.spec.id !== only && s.mod.update && !s.broken) { try { s.mod.update(ctx, -1000, s.spec); } catch {} }
  // 1 = update normally, 0 = skip, -1 = park (neighbour outside the shared transition: hide whatever it showed last frame)
  function onlyMode(idx, t) {
    if (!only || idx === onlyIdx) return 1;
    if (onlyIdx < 0 || Math.abs(idx - onlyIdx) !== 1) return 0;
    const o = specs[onlyIdx], pad = 0.05;
    const inBlend = idx < onlyIdx ? (o.blend > 0 && t >= o.t0 - o.blend / 2 - pad && t <= o.t0 + o.blend / 2 + pad)
      : (o.out > 0 && t >= o.t1 - o.out / 2 - pad && t <= o.t1 + o.out / 2 + pad);
    return inBlend ? 1 : -1;
  }

  // ---------- the frame ----------
  const capStyle = capCfg.style || 'auto';
  window.renderAt = (tOut) => {
    const t = Math.min(Math.max(0, tOut), duration - 0.001);
    const look = lookAt(t);
    Object.assign(ctx, { t, tOut, look, bg: null, exposure: null, bloomK: null, fog: null, capDy: 0, capHide: false, flash: 0, shake: 0, after: [] });
    hud.begin(look);
    applyLook(look);                                      // before updates, so a scene may adjust lights / city visibility for its frames
    if (ctx.city) { ctx.city.hero.mesh.visible = false; if (look === 'city') ctx.traffic.update(t); }
    for (let idx = 0; idx < scenes.length; idx++) {
      const s = scenes[idx];
      if (s.broken || !s.mod.update) continue;
      const m = onlyMode(idx, t);
      if (m === 0) continue;
      if (m < 0) { try { s.mod.update(ctx, -1000, s.spec); } catch {} continue; }
      hud.t = t; hud.win = [s.spec.t0, s.spec.t1];
      try { s.mod.update(ctx, t, s.spec); } catch (e) { console.error('update failed', s.spec.id, e); }
      hud.win = null;
    }
    const pl = poseAt(t);
    let p = pl.pose;
    if (window.__cam) p = window.__cam;
    applyCamera(p, t, pl.look);
    for (const f of ctx.after) { try { f(ctx); } catch (e) { console.error('after callback failed', e); } }
    hud.end();
    const L = LOOKS[pl.look];
    const bg = ctx.bg || P.bg; paintBg(bg.top, bg.mid, bg.bottom);
    renderer.toneMappingExposure = ctx.exposure ?? L.exposure;
    bloom.strength = ctx.bloomK ?? L.bloom[0]; bloom.radius = L.bloom[1]; bloom.threshold = L.bloom[2];
    composer.render();
    $('whipdev').setAttribute('stdDeviation', `${(pl.blur * 38).toFixed(1)} ${(pl.blur * 3).toFixed(1)}`);
    canvas.style.filter = pl.blur > 0.01 ? 'url(#whipblur)' : 'none';
    $('flash').style.opacity = U.clamp(ctx.flash);
    const style = capStyle === 'auto' ? (pl.look === 'city' ? 'pill' : 'box') : capStyle;
    const theme = pl.look === 'city' ? 'light' : 'dark';
    caps.update(t, { style, theme, dy: ctx.capDy, hide: ctx.capHide || capCfg.off });
    const wash = $('capwash');
    wash.style.opacity = !ctx.capHide && style === 'box' ? 1 : 0;
    wash.style.background = theme === 'light'
      ? 'linear-gradient(180deg, rgba(246,241,232,.82) 0%, rgba(246,241,232,.55) 45%, rgba(246,241,232,0) 100%)'
      : 'linear-gradient(180deg, rgba(6,7,9,.72) 0%, rgba(6,7,9,.45) 45%, rgba(6,7,9,0) 100%)';
    return true;
  };
  window.DURATION = duration; window.FPS = FPS;

  for (const f of ['700 72px Figtree', '500 72px Figtree', '600 34px Figtree', '700 50px Inter', '800 70px Inter', '700 22px "JetBrains Mono"'])
    await document.fonts.load(f).catch(() => null);
  await document.fonts.ready;

  if (qs.has('t')) window.renderAt(parseFloat(qs.get('t')));
  else if (qs.has('play')) {
    const audio = new Audio(new URL('audio/vo.mp3', BASE).href);
    let t0 = performance.now(), playing = false;
    document.addEventListener('click', () => { audio.currentTime = 0; audio.play().catch(() => {}); t0 = performance.now(); playing = true; });
    const loop = () => { const tt = playing && !audio.paused ? audio.currentTime : (performance.now() - t0) / 1000; window.renderAt(tt % duration); requestAnimationFrame(loop); };
    loop();
  } else window.renderAt(Math.min(2, duration / 2));
  return true;
}

window.READY = boot().catch((e) => { console.error('explainer3d boot failed:', e); throw e; });
