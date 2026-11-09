// preview.js: the KIT PREVIEW runtime. Renders a contact sheet of props / people so you can check a new prop before using it.
// Pages come from the project's kit_preview.js (default export = array of pages). Page N is drawn at t = N (1-based):
//   node tools/reel.mjs stills <project> 1 2 3 4 5 6 --only kit      -> stills/sheet.jpg
// A page: { name, bg: {top,mid,bottom} | css colour, cam: {pos, target, fov} (relative to the page origin),
//           async build(ctx, root) -> { pose?(ctx) } }   (build under `root`; pose() is called before every render)
import * as THREE from 'three';
import { createStudio, loadFonts, LOOK } from './studio.js';
import * as U from './util.js';

export async function bootPreview() {
  const canvas = document.getElementById('c');
  const S = createStudio(canvas);
  await loadFonts();
  const reel = await fetch(new URL('reel.json', location.href)).then((r) => r.json()).catch(() => ({}));
  const pages = (await import(new URL('kit_preview.js', location.href).href)).default;
  const ctx = { THREE, U, scene: S.scene, camera: S.camera, renderer: S.renderer, reel, keyword: String(reel?.cta?.keyword ?? 'REEL').toUpperCase(), sfx() {} };
  const built = [];
  for (let i = 0; i < pages.length; i++) {
    const root = new THREE.Group(); root.position.set((i + 1) * 300, 0, 0); S.scene.add(root);
    let api = {};
    try { api = (await pages[i].build(ctx, root)) || {}; } catch (e) { console.error('kit preview page failed:', pages[i].name, e.stack || e); }
    built.push({ page: pages[i], root, api });
  }
  const hud = document.getElementById('hud');
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'absolute', left: '40px', top: '40px', font: '900 44px Nunito, Fallback', color: '#fff', textShadow: '0 3px 8px rgba(0,0,0,.6)' });
  hud.appendChild(label);
  window.renderAt = (t) => {
    const n = Math.min(built.length, Math.max(1, Math.round(t))), cur = built[n - 1];
    built.forEach((b) => { b.root.visible = b === cur; });
    try { cur.api.pose?.(ctx); } catch (e) { console.error('pose failed', cur.page.name, e); }
    const o = cur.root.position, c = cur.page.cam ?? { pos: [0, 5, 18], target: [0, 3, 0], fov: 45 };
    const p = { pos: [c.pos[0] + o.x, c.pos[1], c.pos[2]], target: [c.target[0] + o.x, c.target[1], c.target[2]], fov: c.fov ?? 45, shadowBox: 26 };
    S.applyCamera(p);
    const bg = typeof cur.page.bg === 'string' ? { top: cur.page.bg, mid: cur.page.bg, bottom: cur.page.bg } : (cur.page.bg ?? LOOK.bg);
    S.render({ bg, dof: 0, target: p.target });
    label.textContent = `${n} · ${cur.page.name}`;
    return true;
  };
  window.DURATION = built.length + 0.5; window.CAPTURE = 'screenshot'; window.SFX = null;
  window.renderAt(1);
  return true;
}
