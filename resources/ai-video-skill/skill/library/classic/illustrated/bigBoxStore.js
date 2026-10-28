// ── ILLUSTRATED EXAMPLE · BIG-BOX STORE on its lot (studied from a reel about a furniture megastore's one-way layout;
// de-branded: a generic "HOME STORE" warehouse store in green and cream, no real logo or colours)
// WHAT it shows: a huge windowless box that reads as "out-of-town megastore": scale comes from the tiny cars, flags and trees.
// TECHNIQUES inside (guides/illustration.md):
//   · scale cues: the building is 250 × 137 iso units but only 62 tall; 20 parked cars in two rows, a driving car, 3 trees, flags
//     the size of a car: small life next to a big simple volume is what makes it read as BIG
//   · face details with isoLeft / isoRight: vertical panel seams (very low-alpha white lines), a colour stripe under the roof line,
//     a big sign box with a drop shadow, a glass entrance with people inside under a canopy, loading docks with roller doors
//   · roof: skylight strips (isoQuad, light blue) + HVAC boxes; o.xray draws a dashed route ON the roof plane (isoTop): "what
//     happens inside" shown from outside
//   · parking lot = seeded rows (hash decides which bays are taken), a car driving the aisle on a loop (x = (t * speed) % length,
//     faded at both ends), pennant flags waving (a strip whose points follow sin(t - i))
//   · entrance animation: o.rise (building grows up), o.poleP (pylon), o.flagsP, o.carsP (cars slide into their bays, staggered)
// API: bigBoxStore(ctx, x, y, s, o) bottom-centre at (x, y) · bigBoxStoreArt(ctx, o) · BBS_BOX
//      o: { t, rise, poleP, flagsP, carsP 0..1, xray 0..1, name 'HOME STORE', col (box colour '#1F6F55'), noShadow }
// DON'T paste this as your reel's prop: draw THIS script's subject with the same method. Not loaded by the engine. Needs kits/illustrate.js.

var BBS_BOX = [-266, -212, 222, 176];
function bigBoxStore(ctx, x, y, s = 1, o = {}) { placeArt(ctx, BBS_BOX, x, y, s, c => bigBoxStoreArt(c, o)); }

var BBS_B = { x0: -125, x1: 125, y0: -75, y1: 62, h: 62 };
var BBS_ROOF = [[-112, -60], [104, -60], [104, -26], [-104, -26], [-104, 10], [104, 10], [104, 44], [-112, 44]];
function bbsBuilding(K, o) {
  const { x0, x1, y0, y1, h } = BBS_B, t = o.t || 0, col = o.col || '#1F6F55', cream = '#F3E6C4', name = o.name || 'HOME STORE';
  if (!o.noShadow) isoCastShadow(K, x0, y0, x1, y1, 50, 0.2, 0.7);
  isoBox(K, x0, y0, x1, y1, 0, h, { top: '#CDD2D0', left: col, right: shade(col, 0.74) });
  isoLeft(K, y1, () => {                                                  // the long front, local (x, -z)
    K.fillStyle = 'rgba(255,255,255,0.07)'; for (let xx = x0 + 17; xx < x1; xx += 17) K.fillRect(xx, -h, 1.2, h);   // panel seams
    K.fillStyle = shade(col, 0.5); K.fillRect(x0, -4, x1 - x0, 4);
    K.fillStyle = cream; K.fillRect(x0, -h + 3, x1 - x0, 4.5);
    K.fillStyle = vGrad(K, -27, 0, ['#E4F0F8', '#8FB6D4']); K.fillRect(-110, -27, 38, 27);                   // glass entrance
    K.fillStyle = 'rgba(255,236,170,0.6)'; K.fillRect(-110, -12, 38, 12);
    K.fillStyle = 'rgba(60,50,40,0.35)'; for (let i = 0; i < 5; i++) { K.beginPath(); K.arc(-104 + i * 7.5, -10, 1.8, 0, TAU); K.fill(); K.fillRect(-105.6 + i * 7.5, -8.5, 3.2, 8.5); }
    K.fillStyle = '#20303F'; for (let mx = -110; mx <= -72; mx += 9.5) K.fillRect(mx - 0.7, -27, 1.4, 27); K.fillRect(-110, -28, 38, 1.8);
    glassStreak(K, -110, -27, 38, 27, 0.25);
    K.fillStyle = shade(col, 0.45); K.fillRect(-50 + 2, -53 + 2, 122, 37);                                    // sign box + shadow
    K.fillStyle = cream; K.fillRect(-50, -53, 122, 37); K.strokeStyle = shade(cream, 0.7); K.lineWidth = 1.3; K.strokeRect(-50, -53, 122, 37);
    text(K, name, 11, -29.5, { font: ILL_SANS, weight: 800, size: 17, color: col, ls: 0.5 });
  });
  isoRight(K, x1, () => {                                                 // the dock side, local (-y, -z)
    K.fillStyle = 'rgba(255,255,255,0.05)'; for (let u = -y1 + 17; u < -y0; u += 17) K.fillRect(u, -h, 1.2, h);
    K.fillStyle = shade(col, 0.4); K.fillRect(-y1, -4, y1 - y0, 4);
    K.fillStyle = shade(cream, 0.85); K.fillRect(-y1, -h + 3, y1 - y0, 4.5);
    for (let i = 0; i < 3; i++) { const ux = -24 + i * 30; K.fillStyle = '#AEB6BF'; K.fillRect(ux, -23, 21, 23); K.fillStyle = 'rgba(0,0,0,0.2)'; for (let k = 1; k < 6; k++) K.fillRect(ux, -23 + k * 3.8, 21, 0.9); }
  });
  for (let i = 0; i < 4; i++) { const xx = -86 + i * 46; isoQuad(K, xx, -52, xx + 20, 34, h, 'rgba(150,195,228,0.85)'); }   // skylights
  const xr = clamp(o.xray || 0);
  if (xr > 0) isoTop(K, h + 0.5, () => {                                  // x-ray: the route inside, seen through the roof
    K.save(); K.globalAlpha *= xr; K.lineCap = 'round'; K.lineJoin = 'round';
    K.beginPath(); BBS_ROOF.forEach((p, i) => i ? K.lineTo(p[0], p[1]) : K.moveTo(p[0], p[1]));
    K.strokeStyle = 'rgba(255,59,31,0.25)'; K.lineWidth = 11; K.stroke();
    K.setLineDash([9, 7]); K.lineDashOffset = -t * 30; K.strokeStyle = C.red; K.lineWidth = 4.5; K.stroke();
    K.restore();
  });
  isoBox(K, 62, -62, 92, -40, h, h + 9, '#C3C7CC', { edge: 'rgba(0,0,0,0.15)', lw: 1 });
  isoBox(K, -104, -66, -82, -50, h, h + 7, '#C3C7CC', { edge: 'rgba(0,0,0,0.15)', lw: 1 });
  isoBox(K, -116, y1, -66, y1 + 13, 28, 32, cream);                       // canopy over the doors
}
// pylon: grey pole + a sign panel, base at screen (bx, by)
function bbsPylon(K, bx, by, hgt, p, o) {
  const col = o.col || '#1F6F55';
  poleSign(K, bx, by, hgt, { p, col, w: 78, h: 40, draw: (c, w, h) => {
    fillRR(c, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 4, '#F3E6C4');
    text(c, 'HOME', 0, h * 0.16, { font: ILL_SANS, weight: 800, size: h * 0.42, color: col, ls: 1 });
  } });
}
// a pennant flag on a pole, waving (screen-aligned), base at (bx, by); cols = [field, stripe]
function bbsFlag(K, bx, by, hgt, t, ph, p, cols) {
  if (p <= 0.02) return;
  const k = clamp(p, 0, 1.2), top = by - hgt * k;
  line(K, bx, by, bx, top, '#ECEAE4', 2.4, 'butt'); line(K, bx - 0.8, by, bx - 0.8, top, 'rgba(0,0,0,0.2)', 0.8, 'butt'); circle(K, bx, top - 1, 2.2, '#C9C5BC');
  const fw = 26 * clamp(k * 1.4, 0, 1), fh = 16, y0 = top + 2, N = 8;
  if (fw < 1) return;
  const dy = i => Math.sin(t * 6.5 - i * 0.8 + ph) * 2.2 * (i / N), xs = i => bx + 1 + i * fw / N;
  const band = (g0, g1, col) => { K.beginPath(); for (let i = 0; i <= N; i++) K.lineTo(xs(i), y0 + g0 * fh + dy(i)); for (let i = N; i >= 0; i--) K.lineTo(xs(i), y0 + g1 * fh + dy(i)); K.closePath(); K.fillStyle = col; K.fill(); };
  band(0, 1, cols[0]); band(0.4, 0.6, cols[1]);
}
var BBS_CARS = ['#E8E6E1', '#3F6FB5', '#2F2F34', '#C8A23A', '#B8412F', '#9AA3AD', '#F2F2F0', '#4D7A55'];
function bigBoxStoreArt(K, o = {}) {
  const t = o.t || 0, PX0 = -150, PX1 = 150, PY0 = -95, PY1 = 150, cp = o.carsP == null ? 1 : clamp(o.carsP), col = o.col || '#1F6F55';
  isoSlab(K, PX0, PY0, PX1, PY1, 10, { shadow: !o.noShadow });
  isoQuad(K, PX0 + 12, 74, PX1 - 8, PY1 - 8, 0, '#5D6067');                                     // parking
  isoQuad(K, 132, PY0 + 8, PX1 - 8, 74, 0, '#5D6067');                                           // service lane
  isoQuad(K, -128, 62, 128, 74, 0, '#D8D3C9');                                                   // sidewalk
  for (let i = 0; i < 5; i++) isoQuad(K, -108 + i * 8, 75, -104 + i * 8, 84, 0, 'rgba(255,255,255,0.85)');   // zebra
  for (let i = 0; i < 12; i++) { const xx = -96 + i * 22; isoPath(K, [[xx, 86], [xx, 106]], 0, 'rgba(255,255,255,0.8)', 1.4); isoPath(K, [[xx, 120], [xx, 140]], 0, 'rgba(255,255,255,0.8)', 1.4); }
  isoPath(K, [[-130, 113], [140, 113]], 0, 'rgba(255,255,255,0.55)', 1.2, { dash: [6, 6] });
  isoTree(K, -140, -86, 1, { t }); isoTree(K, -40, -88, 0.9, { t });
  const [pa, pb] = ISO(-138, -36, 0); bbsPylon(K, pa, pb, 112, o.poleP == null ? 1 : o.poleP, o);
  const r = o.rise == null ? 1 : o.rise;
  if (r > 0.01) { K.save(); K.scale(1, r); bbsBuilding(K, o); K.restore(); }
  const fp = o.flagsP == null ? 1 : o.flagsP, fc = [[col, '#F3E6C4'], ['#D8402F', '#FFFFFF'], ['#F3E6C4', col]];
  [[-146, 66], [-140, 74], [-134, 82]].forEach(([fx, fy], i) => { const [a, b] = ISO(fx, fy, 0); bbsFlag(K, a, b, 62, t, i * 1.3, fp - i * 0.12, fc[i]); });
  if (cp > 0) {
    K.save(); K.globalAlpha *= clamp(cp * 2.5);
    for (let i = 0; i < 11; i++) {
      const xx = -85 + i * 22, sl = (1 - E.outCubic(clamp(cp * 1.6 - i * 0.05))) * 30;
      if (hash(i * 3.3 + 1) < 0.62) isoCar(K, xx, 96 - sl, 'y', BBS_CARS[i % 8]);
      if (hash(i * 5.7 + 2) < 0.5) isoCar(K, xx, 130 + sl, 'y', BBS_CARS[(i + 3) % 8]);
    }
    const X0 = -125 + ((t * 52) % 260), fa = clamp(Math.min(X0 + 125, 135 - X0) / 25);
    K.save(); K.globalAlpha *= fa; isoCar(K, X0, 113, 'x', '#F2F2F0'); K.restore();
    const Y0 = 60 - ((t * 40 + 30) % 150); K.save(); K.globalAlpha *= clamp(Math.min(Y0 + 90, 60 - Y0) / 20); isoCar(K, 141, Y0, 'y', '#C8A23A'); K.restore();
    isoPerson(K, -100, 68, 0.55, { ph: t * 11, shirt: '#D8402F' }); isoPerson(K, -86, 70, 0.55, { ph: t * 11 + 2, shirt: '#4E7FBF', flip: true });
    K.restore();
  }
  isoTree(K, -142, 146, 0.95, { t }); isoTree(K, -20, 147, 0.85, { t }); isoTree(K, 100, 147, 0.9, { t });
}
