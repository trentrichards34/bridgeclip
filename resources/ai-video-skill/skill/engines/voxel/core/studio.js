// studio.js: the voxel LOOK in one place. Renderer, warm studio lights, gradient backdrop and the post chain
// (depth of field -> bloom -> lens: chromatic aberration + vignette + warm tint -> output). Used by main.js and preview.js.
// Scenes never touch this directly: they set ctx.bg / ctx.exposure / ctx.bloomK / ctx.focus / ctx.dof per frame.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const W = 1080, H = 1920;
// LOOK tokens (change here = change every reel)
export const LOOK = {
  exposure: 1.0,
  env: 0.35,                                   // RoomEnvironment reflections
  hemi: ['#ffe7cf', '#3a2c44', 0.5],           // warm sky / plum ground
  key: ['#ffe2c0', 1.9, [14, 30, 22]],         // warm key, offset from the camera target (follows it)
  rim: ['#8fb2ff', 1.1, [-40, 20, -60]],       // cool rim from behind-left
  shadowBox: 22,
  dof: { aperture: 0.004, maxblur: 0.009 },    // shallow depth of field
  bloom: { strength: 0.35, radius: 0.6, threshold: 0.9 },
  lens: { ca: 0.006, vig: 0.32, tint: [1.03, 1.0, 0.96] },
  bg: { top: '#2a2350', mid: '#1f1a3a', bottom: '#120f22' },   // default backdrop (indoor night); scenes set ctx.bg
};

export function createStudio(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LOOK.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 2000);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = LOOK.env;
  const hemi = new THREE.HemisphereLight(...LOOK.hemi); scene.add(hemi);
  const key = new THREE.DirectionalLight(LOOK.key[0], LOOK.key[1]);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.05;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(LOOK.rim[0], LOOK.rim[1]); scene.add(rim, rim.target);

  // backdrop: a screen-space vertical gradient, repainted only when the colours change
  const bgCanvas = document.createElement('canvas'); bgCanvas.width = 4; bgCanvas.height = 512;
  const bgTex = new THREE.CanvasTexture(bgCanvas); bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;
  let bgKey = '';
  function paintBg({ top, mid, bottom }) {
    const k = top + mid + bottom; if (k === bgKey) return; bgKey = k;
    const c = bgCanvas.getContext('2d'), g = c.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, top); g.addColorStop(0.55, mid); g.addColorStop(1, bottom);
    c.fillStyle = g; c.fillRect(0, 0, 4, 512); bgTex.needsUpdate = true;
  }

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1); composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 10, aperture: LOOK.dof.aperture, maxblur: LOOK.dof.maxblur });
  composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), LOOK.bloom.strength, LOOK.bloom.radius, LOOK.bloom.threshold);
  composer.addPass(bloom);
  const lens = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, ca: { value: LOOK.lens.ca }, vig: { value: LOOK.lens.vig }, tint: { value: new THREE.Vector3(...LOOK.lens.tint) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float ca; uniform float vig; uniform vec3 tint; varying vec2 vUv;
      void main(){ vec2 d = vUv - 0.5; float r2 = dot(d * vec2(0.5625, 1.0), d * vec2(0.5625, 1.0)) * 4.0;
        vec2 off = d * ca * r2;
        vec4 c = texture2D(tDiffuse, vUv);
        c.r = texture2D(tDiffuse, vUv + off).r; c.b = texture2D(tDiffuse, vUv - off).b;
        c.rgb *= mix(1.0, 1.0 - vig, smoothstep(0.35, 1.25, r2));
        c.rgb *= tint;
        gl_FragColor = c; }`,
  });
  composer.addPass(lens);
  composer.addPass(new OutputPass());

  const V = (a) => (a.isVector3 ? a : new THREE.Vector3(a[0], a[1], a[2]));
  // camera pose {pos, target, fov, roll}; key light + shadow box follow the target
  function applyCamera(p, shakeOffset = null) {
    const pos = V(p.pos).clone(); if (shakeOffset) pos.add(shakeOffset);
    camera.position.copy(pos);
    camera.fov = p.fov ?? 32; camera.updateProjectionMatrix();
    camera.up.set(0, 1, 0); camera.lookAt(V(p.target));
    if (p.roll) camera.rotateZ(THREE.MathUtils.degToRad(p.roll));
    camera.updateMatrixWorld();
    const tgt = V(p.target);
    key.target.position.copy(tgt); key.position.copy(tgt).add(new THREE.Vector3(...LOOK.key[2]));
    rim.target.position.copy(tgt); rim.position.copy(tgt).add(new THREE.Vector3(...LOOK.rim[2]));
    const sc = key.shadow.camera, b = p.shadowBox ?? LOOK.shadowBox;
    sc.left = -b; sc.right = b; sc.top = b; sc.bottom = -b; sc.near = 1; sc.far = 100 + b; sc.updateProjectionMatrix();
  }
  // draw one frame. o: { bg, exposure, bloomK, focus (world point; default = camera target), dof (0 = off), target }
  function render(o = {}) {
    paintBg(o.bg || LOOK.bg);
    renderer.toneMappingExposure = o.exposure ?? LOOK.exposure;
    bloom.strength = o.bloomK ?? LOOK.bloom.strength;
    const dof = o.dof ?? 1;
    bokeh.enabled = dof > 0.01;
    if (bokeh.enabled) {
      bokeh.uniforms.focus.value = camera.position.distanceTo(V(o.focus ?? o.target ?? [0, 0, 0]));
      bokeh.uniforms.aperture.value = LOOK.dof.aperture * dof;
    }
    composer.render();
  }
  return { THREE, renderer, scene, camera, hemi, key, rim, bloom, bokeh, lens, composer, paintBg, applyCamera, render };
}

// static film grain on a canvas (overlay-blended by index.html)
export function paintGrain(canvas, rng) {
  const c = canvas.getContext('2d'), img = c.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < img.data.length; i += 4) { const v = (rng() * 255) | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  c.putImageData(img, 0, 0);
}

// fonts every page needs before the first frame
export async function loadFonts() {
  try {
    await Promise.all(['900 74px Nunito', '700 66px "Playfair Display"', '100px VT323', '800 40px Inter'].map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  } catch (e) { /* fall back to system fonts */ }
}
