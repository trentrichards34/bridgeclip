// ── ILLUSTRATED EXAMPLE · DOUBLE CHEESEBURGER (studied from a reel about a fast-food chain; de-branded, generic burger)
// WHAT it shows: food drawn like real life, 3/4 front view, at sticker size it still reads as "a burger" in half a second.
// TECHNIQUES inside (guides/illustration.md):
//   · real proportions: bun 238 wide, two thin patties, the stack ~2/3 as tall as wide; layers overhang the bun a little (cheese drips)
//   · every surface = gradient (light top → dark bottom) + an outline in a darker shade of ITS colour (never black) + a highlight:
//     bun dome = radialGradient with the light spot upper-left, a white gloss ellipse and a darker band where the dome meets the bun
//   · texture from seeded noise, never Math.random: grill specks on the patties (hash), lettuce ruffle (alternating quadratic
//     curves), sesame seeds placed on the dome curve with their own shadow + core, cheese as a hand-placed drip polygon
//   · build-up: o.build 0..1 drops the layers in one by one from above (stagger), each one squashes on landing; idle = a slow breath
//   · steam (illustrate.js `steam`) for "hot / fresh"
// API: burger(ctx, x, y, s, o) bottom-centre at (x, y) · burgerArt(ctx, o) natural coords · BURGER_BOX bounds for sticker()/placeArt()
//      o: { t, build 0..1 (default 1 = whole burger), noShadow, steam 0..1, patties 1|2 }
// As a die-cut sticker: sticker(K, BURGER_BOX, x, y, s, c => burgerArt(c, { noShadow: true }), { T, cache: 'burger' })
// DON'T paste this as your reel's prop: draw THIS script's subject with the same method. Not loaded by the engine.
// Loading (only the test/check projects do it): SCENE_FILES '/skill/library/classic/illustrated/burger.js'. Needs kits/illustrate.js.

var BURGER_BOX = [-128, -238, 128, 16];
function burger(ctx, x, y, s = 1, o = {}) { placeArt(ctx, BURGER_BOX, x, y, s, c => burgerArt(c, o)); }

function burgerArt(K, o = {}) {
  const t = o.t || 0, OUT = 'rgba(70,35,12,0.55)', two = o.patties !== 1;
  const layers = two
    ? [['bun0', 0], ['lettuce', -38], ['sauce', -44], ['patty', -80, -44], ['cheese', -82], ['patty', -114, -80], ['cheese', -116], ['sauce', -120], ['lettuce', -122], ['top', -126]]
    : [['bun0', 0], ['lettuce', -38], ['sauce', -44], ['patty', -80, -44], ['cheese', -82], ['lettuce', -86], ['top', -90]];
  const N = layers.length, b = o.build == null ? 1 : clamp(o.build);
  if (!o.noShadow) softShadow(K, 0, 3, 130, 14, 0.26 * clamp(b * 3));
  const breath = 1 + 0.012 * Math.sin(t * 2.4);
  K.save(); K.scale(1, breath);
  layers.forEach((L, i) => {
    const q = clamp(b * N - i); if (q <= 0) return;
    const fall = 1 - E.outCubic(clamp(q / 0.7)), sq = q >= 0.7 ? ring((q - 0.7) * 0.6, 4, 9) * 0.08 : 0;
    K.save(); K.translate(0, -fall * 220 + (L[1] || 0)); K.scale(1 + sq, 1 - sq); K.translate(0, -(L[1] || 0));
    K.globalAlpha *= clamp(q * 4);
    const [k, y, y2] = L;
    if (k === 'bun0') bgBottomBun(K, OUT);
    else if (k === 'lettuce') bgLettuce(K, y, i % 2 ? 120 : 118, i);
    else if (k === 'sauce') bgSauce(K, y, i);
    else if (k === 'patty') bgPatty(K, y, y2, i);
    else if (k === 'cheese') bgCheese(K, y, i);
    else if (k === 'top') bgTopBun(K, y, OUT);
    K.restore();
  });
  K.restore();
  if (o.steam) steam(K, -10, -205, t, { n: 3, h: 90, a: 0.5 * clamp(o.steam), col: '160,150,140', gap: 34, lw: 6 });
}
function bgBottomBun(K, OUT) {
  K.beginPath(); K.moveTo(-108, -37); K.lineTo(108, -37); K.bezierCurveTo(118, -36, 116, -6, 98, -1); K.quadraticCurveTo(0, 6, -98, -1); K.bezierCurveTo(-116, -6, -118, -36, -108, -37); K.closePath();
  K.fillStyle = vGrad(K, -38, 0, [[0, '#F1B468'], [0.6, '#D8913F'], [1, '#B26624']]); K.fill(); K.lineWidth = 2; K.strokeStyle = OUT; K.stroke();
  K.fillStyle = 'rgba(255,240,210,0.35)'; K.beginPath(); K.ellipse(-50, -24, 34, 5, -0.05, 0, TAU); K.fill();
}
function bgLettuce(K, y, hw, seed) {
  K.beginPath(); K.moveTo(-hw, y + 2);
  const n = 14; for (let i = 0; i <= n; i++) { const x = -hw + (2 * hw) * i / n, dy = (i % 2 ? 9 : -4) + (hash(i + seed * 10) - 0.5) * 4; K.quadraticCurveTo(x - hw / n, y + dy + 6, x, y + dy); }
  K.lineTo(hw - 6, y - 8); K.lineTo(-hw + 6, y - 8); K.closePath();
  K.fillStyle = vGrad(K, y - 8, y + 10, ['#B8E46A', '#7CC23F', '#4A9327']); K.fill(); K.lineWidth = 1.6; K.strokeStyle = 'rgba(40,90,20,0.7)'; K.stroke();
  K.save(); K.strokeStyle = 'rgba(230,255,190,0.6)'; K.lineWidth = 1.2; for (let i = 0; i < 7; i++) { const x = -hw + 20 + i * (2 * hw - 40) / 6; K.beginPath(); K.moveTo(x, y - 4); K.lineTo(x + 4, y + 4); K.stroke(); } K.restore();
}
function bgPatty(K, yT, yB, seed) {
  const hw = 115;
  K.beginPath(); K.moveTo(-hw + 10, yT);
  for (let i = 0; i <= 12; i++) K.lineTo(-hw + 10 + (2 * hw - 20) * i / 12, yT + (hash(i + seed * 20) - 0.5) * 3.4);
  K.quadraticCurveTo(hw + 3, yT, hw + 2, (yT + yB) / 2); K.quadraticCurveTo(hw + 2, yB, hw - 10, yB);
  for (let i = 12; i >= 0; i--) K.lineTo(-hw + 10 + (2 * hw - 20) * i / 12, yB + (hash(i * 3 + seed * 30) - 0.5) * 3.4);
  K.quadraticCurveTo(-hw - 2, yB, -hw - 2, (yT + yB) / 2); K.quadraticCurveTo(-hw - 3, yT, -hw + 10, yT); K.closePath();
  K.fillStyle = vGrad(K, yT, yB, [[0, '#7A4528'], [0.45, '#56301B'], [1, '#33190C']]); K.fill(); K.lineWidth = 1.8; K.strokeStyle = 'rgba(30,12,4,0.8)'; K.stroke();
  for (let i = 0; i < 34; i++) {                                           // grilled texture (seeded)
    const x = -hw + 8 + hash(i * 1.7 + seed * 5) * (2 * hw - 16), y = yT + 4 + hash(i * 2.9 + seed) * (yB - yT - 8);
    circle(K, x, y, 1 + hash(i) * 1.6, hash(i * 4.1) < 0.5 ? 'rgba(150,90,55,0.55)' : 'rgba(25,10,3,0.5)');
  }
  K.save(); K.globalAlpha *= 0.3; line(K, -hw + 14, yT + 4, hw - 14, yT + 4, '#C88A5E', 2); K.restore();
}
function bgCheese(K, yc, seed) {
  const pts = [[-112, yc], [-121, yc + 20], [-102, yc + 7], [-64, yc + 8], [-56, yc + 23], [-47, yc + 8], [20, yc + 8], [31, yc + 27], [42, yc + 8], [98, yc + 7], [119, yc + 22], [110, yc]];
  if (seed % 2) pts.forEach(p => { p[0] = -p[0]; });
  K.beginPath(); pts.forEach(([x, y], i) => i ? K.lineTo(x, y) : K.moveTo(x, y)); K.closePath();
  K.fillStyle = vGrad(K, yc, yc + 26, ['#FFD54A', '#F59C17']); K.fill(); K.lineWidth = 1.6; K.lineJoin = 'round'; K.strokeStyle = 'rgba(180,100,0,0.7)'; K.stroke();
  K.save(); K.globalAlpha *= 0.65; line(K, -90, yc + 2.5, 80, yc + 2.5, '#FFF0A0', 1.6); K.restore();
}
function bgSauce(K, y, seed) {
  K.save(); K.fillStyle = '#F4A35E';
  for (let i = 0; i < 5; i++) { const x = -90 + i * 44 + hash(i + seed * 7) * 16, d = 5 + hash(i * 3 + seed) * 8; K.beginPath(); K.moveTo(x - 6, y); K.lineTo(x + 6, y); K.quadraticCurveTo(x + 4, y + d, x, y + d + 2); K.quadraticCurveTo(x - 4, y + d, x - 6, y); K.fill(); }
  K.fillRect(-100, y - 2, 200, 3.5); K.restore();
}
function bgTopBun(K, yb, OUT) {
  K.beginPath(); K.moveTo(-119, yb); K.bezierCurveTo(-124, yb - 64, -72, yb - 96, 0, yb - 96); K.bezierCurveTo(72, yb - 96, 124, yb - 64, 119, yb); K.quadraticCurveTo(0, yb + 14, -119, yb); K.closePath();
  const g = K.createRadialGradient(-38, yb - 66, 6, -10, yb - 40, 150);
  g.addColorStop(0, '#FDDB9E'); g.addColorStop(0.3, '#F1AE5A'); g.addColorStop(0.72, '#CF8034'); g.addColorStop(1, '#A65B1E');
  K.fillStyle = g; K.fill(); K.lineWidth = 2.2; K.strokeStyle = OUT; K.stroke();
  K.save(); K.clip(); K.fillStyle = 'rgba(120,55,10,0.28)'; K.beginPath(); K.ellipse(0, yb + 6, 130, 16, 0, 0, TAU); K.fill(); K.restore();
  gloss(K, -44, yb - 70, 30, 10, -0.38, 0.38);
  for (let i = 0; i < 26; i++) {                                           // sesame seeds on the dome curve
    const fx = (hash(i * 3.17 + 1) * 2 - 1) * 0.88, hy = Math.pow(1 - fx * fx, 0.62) * 90;
    const px = fx * 112, py = yb - 10 - hash(i * 7.31 + 2) * (hy - 18), a = fx * 0.7 + (hash(i * 1.9) - 0.5) * 1.2;
    K.save(); K.translate(px, py); K.rotate(a);
    K.fillStyle = 'rgba(120,60,10,0.35)'; K.beginPath(); K.ellipse(0.8, 1.2, 5.6, 2.8, 0, 0, TAU); K.fill();
    K.fillStyle = '#FFF4D8'; K.beginPath(); K.ellipse(0, 0, 5.6, 2.8, 0, 0, TAU); K.fill();
    K.fillStyle = 'rgba(210,170,110,0.6)'; K.beginPath(); K.ellipse(1.2, 0.6, 3, 1.2, 0, 0, TAU); K.fill();
    K.restore();
  }
}
