// ── ILLUSTRATED EXAMPLE · FAST-FOOD RESTAURANT on its pad (studied from a reel about a fast-food chain's real-estate model;
// de-branded: generic "BURGERS" restaurant, no real logo, no real trade dress)
// WHAT it shows: a real building, isometric, that a viewer recognises as "a drive-thru burger place" before reading anything.
// TECHNIQUES inside (guides/illustration.md):
//   · construction: one ground pad (isoSlab: soil sides + grass) → paving (isoQuad) → markings (isoPath) → the building as a few
//     isoBoxes (main hall, entrance tower, canopy, rooftop units) → details drawn ON the faces with isoLeft / isoRight → life on top
//   · 3 tones per surface (isoBox auto tones from one base colour) + an edge line on the hero volume (the entrance tower)
//   · SIGNATURE DETAILS that say "fast food": dark fascia band with the name, lit windows with diners (litWindow), the drive-thru
//     window + coloured canopy on the side, a lane with an arrow, a car waiting at the window (brake lights pulse), a pole sign
//     towering over the roof, rooftop HVAC boxes, a bench-width sidewalk, parking stripes, one tree
//   · the building casts a shadow on its own pad (isoCastShadow, K rgba: it falls on K surfaces)
//   · entrance animation: o.rise grows the building up from the ground (scaleY), o.poleP shoots the sign up and pops its panel
// API: fastFoodRestaurant(ctx, x, y, s, o) bottom-centre at (x, y) · fastFoodRestaurantArt(ctx, o) · FFR_BOX
//      o: { t, rise 0..1, poleP 0..1.2, pole: true, name 'BURGERS', col (brand-free accent, default red '#D8402F'), noShadow }
// Editorial reels ABOUT a real chain may, in the buyer's own project, swap in that chain's real look; shipped files stay generic.
// DON'T paste this as your reel's prop: draw THIS script's subject with the same method. Not loaded by the engine. Needs kits/illustrate.js.

var FFR_BOX = [-178, -158, 182, 126];
function fastFoodRestaurant(ctx, x, y, s = 1, o = {}) { placeArt(ctx, FFR_BOX, x, y, s, c => fastFoodRestaurantArt(c, o)); }

// a tiny burger emblem (bun / patty / lettuce / bun), centred, width w: the generic "this sells burgers" mark
function ffrEmblem(K, cx, cy, w) {
  const h = w * 0.78;
  K.save(); K.translate(cx, cy);
  K.beginPath(); K.moveTo(-w / 2, -h * 0.08); K.bezierCurveTo(-w / 2, -h * 0.62, w / 2, -h * 0.62, w / 2, -h * 0.08); K.closePath(); K.fillStyle = '#F2B25E'; K.fill();
  circle(K, -w * 0.18, -h * 0.3, w * 0.035, '#FFF4D8'); circle(K, w * 0.05, -h * 0.38, w * 0.035, '#FFF4D8'); circle(K, w * 0.22, -h * 0.25, w * 0.035, '#FFF4D8');
  fillRR(K, -w * 0.52, -h * 0.04, w * 1.04, h * 0.1, h * 0.05, '#6DBB3A');
  fillRR(K, -w * 0.5, h * 0.06, w, h * 0.17, h * 0.08, '#5A3220');
  fillRR(K, -w * 0.47, h * 0.25, w * 0.94, h * 0.17, h * 0.08, '#E39A48');
  K.restore();
}

function ffrBuilding(K, o) {
  const t = o.t || 0, col = o.col || '#D8402F', W2 = 75, D2 = 48, HM = 50, TW = [47, 20, 79, 52], TH = 88, name = o.name || 'BURGERS';
  if (!o.noShadow) isoCastShadow(K, -W2, -D2, TW[2], D2, 46, 0.2, 0.7);
  isoBox(K, -W2, -D2, W2, D2, 0, HM, { top: '#B9B2A7', left: '#EAE4D9', right: '#C7BFB2' });                 // main hall: cream render
  isoLeft(K, D2, () => {                                                    // long front face, local (x, -z)
    K.fillStyle = '#57504A'; K.fillRect(-W2, -5, 2 * W2, 5);              // plinth
    K.fillStyle = hGrad(K, -W2, -W2 + 26, ['#9C6436', '#B57A46']); K.fillRect(-W2, -34, 26, 29);          // timber cladding
    K.fillStyle = 'rgba(70,35,10,0.45)'; for (let i = 1; i < 6; i++) K.fillRect(-W2 + i * 4.4, -34, 1.1, 29);
    litWindow(K, -W2 + 30, -33, 88, 26, { seed: 3, mull: 14.6 });
    K.fillStyle = '#35302D'; K.fillRect(-W2, -HM, 2 * W2, 16); K.fillStyle = '#4A4440'; K.fillRect(-W2, -HM, 2 * W2, 2);   // fascia
    K.fillStyle = col; K.fillRect(-W2, -34.8, 2 * W2 - 28, 1.6);
    text(K, name, -14, -37.6, { font: ILL_SANS, weight: 800, size: 11, color: '#FFFFFF', ls: 1 });
  });
  isoRight(K, W2, () => {                                                   // drive-thru side, local (-y, -z)
    K.fillStyle = '#4C4640'; K.fillRect(-D2, -5, 2 * D2, 5);
    litWindow(K, 0, -30, 18, 18, { seed: 9, people: false }); K.strokeStyle = '#3A3430'; K.lineWidth = 1.6; K.strokeRect(0, -30, 18, 18);
    litWindow(K, 25, -32, 18, 24, { seed: 5, mull: 9 });
    K.fillStyle = '#28231F'; K.fillRect(-D2, -HM, 2 * D2, 16); K.fillStyle = '#3E3934'; K.fillRect(-D2, -HM, 2 * D2, 2);
    ffrEmblem(K, 34, -42, 13);
  });
  isoTop(K, HM, () => { K.fillStyle = '#A39C91'; K.fillRect(-W2 + 4, -D2 + 4, 2 * W2 - 8, 2 * D2 - 8); });   // roof deck inside the parapet
  isoBox(K, -52, -32, -30, -14, HM, HM + 8, '#C9C5BD', { edge: 'rgba(0,0,0,0.18)', lw: 1 });                // rooftop units
  isoBox(K, -18, -38, -2, -24, HM, HM + 6, '#C9C5BD', { edge: 'rgba(0,0,0,0.18)', lw: 1 });
  isoBox(K, W2, -21, W2 + 11, 3, 30, 35, { top: shade(col, 1.25), left: col, right: shade(col, 0.75) });    // drive-thru canopy
  isoBox(K, TW[0], TW[1], TW[2], TW[3], 0, TH, shade(col, 0.95), { edge: withAlpha(shade(col, 0.3), 0.6), lw: 1.4 });   // entrance tower
  isoLeft(K, TW[3], () => {
    litWindow(K, TW[0] + 6, -31, 20, 31, { seed: 11, mull: 10 }); K.strokeStyle = '#2A2522'; K.lineWidth = 1.8; K.strokeRect(TW[0] + 6, -31, 20, 31);
    K.fillStyle = 'rgba(255,255,255,0.14)'; K.fillRect(TW[0], -TH, 32, 3);
    circle(K, TW[0] + 16, -62, 13, '#FFF6E6', withAlpha(shade(col, 0.4), 0.6), 1.2); ffrEmblem(K, TW[0] + 16, -61, 17);
  });
  isoRight(K, TW[2], () => { K.fillStyle = 'rgba(0,0,0,0.12)'; K.fillRect(-TW[3], -TH, 32, 3); circle(K, -TW[3] + 16, -62, 11, shade('#FFF6E6', 0.85)); ffrEmblem(K, -TW[3] + 16, -61, 14); });
}

function fastFoodRestaurantArt(K, o = {}) {
  const t = o.t || 0, col = o.col || '#D8402F', PX = [-102, -70, 130, 94];
  isoSlab(K, PX[0], PX[1], PX[2], PX[3], 8, { shadow: !o.noShadow, specks: true });
  isoQuad(K, PX[0] + 8, 58, PX[2] - 6, PX[3] - 6, 0, '#5D6067');                               // front parking apron
  isoQuad(K, 88, PX[1] + 6, PX[2] - 6, 58, 0, '#5D6067');                                         // drive-thru lane
  isoQuad(K, -94, 48, 88, 58, 0, '#D8D3C9');                                                      // sidewalk
  isoPath(K, [[108, PX[1] + 10], [108, 52]], 0, 'rgba(255,255,255,0.75)', 1.4, { dash: [5, 5] });
  for (let i = 0; i < 6; i++) isoPath(K, [[-90 + i * 30, 62], [-90 + i * 30, 86]], 0, 'rgba(255,255,255,0.8)', 1.6);   // parking stripes
  isoPath(K, [[118, 30], [118, -10]], 0, '#FFFFFF', 2.2); isoPath(K, [[113, -2], [118, -10], [123, -2]], 0, '#FFFFFF', 2.2);   // lane arrow
  isoTree(K, -92, 30, 1, { t });
  const r = o.rise == null ? 1 : o.rise;
  if (r > 0.01) { K.save(); K.scale(1, r); ffrBuilding(K, o); K.restore(); }
  isoCar(K, 98, -24, 'y', '#F2F2F0', { brake: 0.6 + 0.4 * Math.sin(t * 3) });
  isoCar(K, -60, 74, 'y', '#3F6FB5'); isoCar(K, 0, 74, 'y', '#2F2F34');
  if (o.pole !== false) {
    const [a, b] = ISO(122, -42, 0);
    poleSign(K, a, b, 128, { p: o.poleP == null ? 1 : o.poleP, col, w: 62, h: 56, draw: (c, w, h) => {
      circle(c, 0, -h * 0.12, h * 0.3, '#FFF6E6'); ffrEmblem(c, 0, -h * 0.1, w * 0.42);
      text(c, o.name || 'BURGERS', 0, h * 0.36, { font: ILL_SANS, weight: 800, size: h * 0.17, color: '#FFFFFF', ls: 0.5 });
    } });
  }
}
