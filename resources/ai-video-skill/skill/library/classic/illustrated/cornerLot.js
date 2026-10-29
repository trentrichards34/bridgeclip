// ── ILLUSTRATED EXAMPLE · CORNER LOT DIORAMA (studied from a reel about a fast-food chain owning the land under its restaurants)
// WHAT it shows: an aerial corner-lot tile: two streets with a crosswalk, sidewalks, a parcel with a red dashed PROPERTY LINE, either
// bare grass with a "LAND" yard sign or a building with parking + traffic. "Real estate" made physical.
// TECHNIQUES inside (guides/illustration.md):
//   · a diorama tile (isoSlab: soil sides with grass lip and pebbles) reads as "a piece of land" at any size
//   · ground first, in painter's order: grass → roads (isoQuad) → lane dashes (isoPath dash) → crosswalk bars → sidewalk with joint
//     lines → parcel (bare grass with mowing stripes, or asphalt with bays) → the building → cars → trees → front edge of the line
//   · the property line is split in two: the BACK edges are drawn before the building (they pass behind it), the FRONT edges after
//     everything (they pass in front): depth without a z-buffer. Marching dashes (lineDashOffset = -t * 22) + stakes that spring up
//   · traffic: cars on the two streets loop (x = (t * speed) % length), fading in/out at the tile edges; o.carsP slides the parked
//     cars into place
//   · the yard sign swings on its arm (pendulum after it pops), so even the "empty lot" beat is alive
// API: cornerLot(ctx, x, y, s, o) bottom-centre · cornerLotArt(ctx, o) · LOT_BOX
//      o: { t, empty (bare parcel), lines 0..1 (property line draws), sign 'LAND' | null, signP 0..1, signSwing deg, signScale,
//           building(ctx, t) (draw your own building at the parcel centre, iso coords; default a small generic shop), rise 0..1,
//           carsP 0..1, traffic (default true), noShadow }
// DON'T paste this as your reel's prop: draw THIS script's subject with the same method. Not loaded by the engine. Needs kits/illustrate.js.

var LOT_BOX = [-282, -172, 282, 182];
function cornerLot(ctx, x, y, s = 1, o = {}) { placeArt(ctx, LOT_BOX, x, y, s, c => cornerLotArt(c, o)); }

// default building: a small generic corner shop (flat roof + parapet, awning, lit windows, door)
function lotShop(K, t) {
  isoCastShadow(K, -40, -30, 40, 30, 40, 0.2, 0.7);
  isoBox(K, -40, -30, 40, 30, 0, 44, '#E9DCC6', { edge: 'rgba(80,60,40,0.4)', lw: 1.2 });
  isoLeft(K, 30, () => {
    K.fillStyle = '#7B4B35'; K.fillRect(-40, -44, 80, 7);
    litWindow(K, -34, -26, 40, 20, { seed: 4, mull: 10 });
    fillRR(K, 14, -27, 13, 27, 1, '#5A3A2A'); circle(K, 24, -13, 1.2, '#E8C060');
    awning(K, -36, -34, 46, 7, ['#D8402F', '#FFF6E6'], { n: 7 });
  });
  isoRight(K, 40, () => { litWindow(K, -18, -26, 24, 18, { seed: 8, people: false, mull: 12 }); K.fillStyle = '#6B4030'; K.fillRect(-30, -44, 60, 7); });
  isoBox(K, -24, -20, -6, -6, 44, 50, '#C9C5BD');
}
function cornerLotArt(K, o = {}) {
  const t = o.t || 0, cp = o.carsP == null ? 1 : clamp(o.carsP);
  const TX0 = -180, TX1 = 180, TY0 = -140, TY1 = 140, PX0 = -168, PX1 = 120, PY0 = -128, PY1 = 92, RX = 134, RY = 106;
  isoSlab(K, TX0, TY0, TX1, TY1, 16, { shadow: !o.noShadow });
  isoQuad(K, RX, TY0, TX1, TY1, 0, '#4A4D55'); isoQuad(K, TX0, RY, TX1, TY1, 0, '#4A4D55');           // two streets
  isoPath(K, [[157, TY0], [157, RY - 2]], 0, '#F4D35E', 2, { dash: [11, 9] }); isoPath(K, [[TX0, 123], [RX - 2, 123]], 0, '#F4D35E', 2, { dash: [11, 9] });
  for (let i = 0; i < 6; i++) { const yy = RY + 5 + i * 5.4; isoPath(K, [[RX - 24, yy], [RX - 8, yy]], 0, 'rgba(255,255,255,0.85)', 2.6, { cap: 'butt' }); }   // crosswalks
  for (let i = 0; i < 6; i++) { const xx = RX + 5 + i * 7; isoPath(K, [[xx, RY - 24], [xx, RY - 8]], 0, 'rgba(255,255,255,0.85)', 2.6, { cap: 'butt' }); }
  isoQuad(K, PX1, PY0, RX, RY, 0, '#D8D3C9'); isoQuad(K, PX0, PY1, PX1, RY, 0, '#D8D3C9');               // sidewalks
  for (let yy = PY0 + 20; yy < RY; yy += 20) isoPath(K, [[PX1, yy], [RX, yy]], 0, 'rgba(120,110,95,0.35)', 1);
  for (let xx = PX0 + 20; xx < PX1; xx += 20) isoPath(K, [[xx, PY1], [xx, RY]], 0, 'rgba(120,110,95,0.35)', 1);
  if (o.empty) {
    isoQuad(K, PX0, PY0, PX1, PY1, 0, '#93CD69');
    for (let i = 0; i < 10; i += 2) { const a = PX0 + (PX1 - PX0) * i / 10, b = PX0 + (PX1 - PX0) * (i + 1) / 10; isoQuad(K, a, PY0, b, PY1, 0, 'rgba(255,255,255,0.1)'); }   // mowing stripes
  } else {
    isoQuad(K, PX0 + 8, PY0 + 8, PX1 - 8, PY1 - 8, 0, '#5D6067');
    for (let i = 0; i < 8; i++) isoPath(K, [[-150 + i * 24, 50], [-150 + i * 24, 82]], 0, 'rgba(255,255,255,0.82)', 1.7);
    isoPath(K, [[72, -112], [72, 40]], 0, 'rgba(255,255,255,0.7)', 1.5, { dash: [7, 6] });
  }
  // property line, back half (passes behind the building)
  const lp = clamp(o.lines || 0), lc = o.lineCol || C.red;
  const dash = (pts, a) => { if (a <= 0) return; K.save(); K.globalAlpha *= a; isoPath(K, pts, 0, lc, 3, { dash: [9, 6], offset: -t * 22 }); K.restore(); };
  const stake = (x, y, a) => { if (a <= 0) return; const [sx, sy] = ISO(x, y, 0), h = 17 * E.outBack(clamp(a)); line(K, sx, sy, sx, sy - h, '#E9D6B0', 2.6, 'butt'); fillPoly(K, [[sx + 1, sy - h], [sx + 10, sy - h + 3.5], [sx + 1, sy - h + 7]], lc); };
  const a1 = clamp(lp * 2), a2 = clamp(lp * 2 - 1);
  dash([[PX0, PY1], [PX0, PY0], [PX1, PY0]], a1); stake(PX0, PY0, a1); stake(PX1, PY0, a1);
  if (!o.empty) {
    isoTree(K, -150, -110, 1, { t }); isoTree(K, 100, -116, 0.9, { t });
    const r = o.rise == null ? 1 : o.rise;
    if (r > 0.01) { K.save(); K.translate(...ISO(-45, -40, 0)); K.scale(1, r); (o.building || lotShop)(K, t); K.restore(); }
    if (cp > 0) {
      K.save(); K.globalAlpha *= clamp(cp * 3);
      isoCar(K, -126, 66, 'y', '#3F6FB5'); isoCar(K, -54, 66, 'y', '#E8E6E1'); isoCar(K, -6 + 40 * (1 - E.outCubic(cp)), 66, 'y', '#C8A23A');
      K.restore();
    }
    isoTree(K, -96, -118, 0.9, { t });
  } else isoTree(K, -156, 82, 1.05, { t });
  if (o.traffic !== false) {                                             // cars driving the two streets
    for (let k = 0; k < 2; k++) {
      const X0 = k ? 175 - ((t * 64 + 120) % 350) : -175 + ((t * 78) % 350), yy = k ? 115 : 131;
      K.save(); K.globalAlpha *= clamp(Math.min(X0 + 175, 175 - X0) / 30); isoCar(K, X0, yy, 'x', k ? '#3F6FB5' : '#E8E6E1'); K.restore();
    }
    const Y0 = 100 - ((t * 58 + 40) % 240);
    K.save(); K.globalAlpha *= clamp(Math.min(Y0 + 140, 100 - Y0) / 30); isoCar(K, 168, Y0, 'y', '#C8A23A'); K.restore();
  }
  dash([[PX1, PY0], [PX1, PY1], [PX0, PY1]], a2); stake(PX1, PY1, a2); stake(PX0, PY1, a2);        // front half, over everything
  if (o.sign) lotYardSign(K, o, t);
}
// the yard sign on the lot, swinging on its arm
function lotYardSign(K, o, t) {
  const p = o.signP == null ? 1 : clamp(o.signP, 0, 1.3); if (p <= 0) return;
  const [sx, sy] = o.empty ? ISO(-70, 90, 0) : ISO(-160, 84, 0), ss = o.signScale || 1, h = 62 * E.outBack(clamp(p));
  K.save(); K.translate(sx, sy); K.scale(ss, ss);
  softShadow(K, 8, 1, 13, 4, 0.3, '20,30,10');
  line(K, 0, 0, 0, -h, '#F4F1EA', 4.5, 'butt'); line(K, -1.5, 0, -1.5, -h, 'rgba(0,0,0,0.2)', 1.2, 'butt');
  line(K, 0, -h + 2, 54, -h + 2, '#F4F1EA', 4, 'butt');
  X([K], 30, -h + 4, clamp(p), (o.signSwing || 0) + 3 * Math.sin(t * 2.6), () => {
    line(K, -16, 0, -16, 7, '#2A2A2A', 1.4); line(K, 16, 0, 16, 7, '#2A2A2A', 1.4);
    fillRR(K, -31 + 2, 7 + 3, 62, 34, 4, 'rgba(0,0,0,0.25)'); fillRR(K, -31, 7, 62, 34, 4, o.signCol || C.red); strokeRR(K, -31, 7, 62, 34, 4, '#FFFFFF', 2);
    text(K, o.sign, 0, 34, { font: F.anton, weight: 400, size: 25, color: '#FFFFFF' });
  });
  K.restore();
}
