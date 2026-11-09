// ── ILLUSTRATED EXAMPLE · FRIES IN A CARTON (studied from a reel about a fast-food chain; de-branded: plain striped carton, no logo)
// WHAT it shows: a packaged food item at sticker size: the carton shape alone says "fries".
// TECHNIQUES inside (guides/illustration.md):
//   · signature silhouette first: a carton that flares out at the top with a curved scooped front, 17 fries fanned out of it
//   · back-to-front order: carton inside wall (dark) → fries (sorted by a seeded order so they overlap naturally) → carton front
//   · each fry = a rounded rect with a horizontal cylinder gradient (light left → golden → darker right) + a darker cut end
//   · the carton front: a horizontal gradient that is dark at both edges and bright at ~45 % (it reads as a curved surface), one
//     white sheen band, a darker outline of its own colour, a printed cream stripe that follows the curve, salt specks on the fries
//   · life: o.t makes the fries settle with a tiny per-fry wobble after o.pour (0..1 = fries rising out of the carton), steam
// API: fries(ctx, x, y, s, o) bottom-centre at (x, y) · friesArt(ctx, o) · FRIES_BOX
//      o: { t, pour 0..1 (default 1), col (carton colour, default '#D8402F'), noShadow, steam 0..1 }
// DON'T paste this as your reel's prop: draw THIS script's subject with the same method. Not loaded by the engine. Needs kits/illustrate.js.

var FRIES_BOX = [-82, -212, 82, 12];
function fries(ctx, x, y, s = 1, o = {}) { placeArt(ctx, FRIES_BOX, x, y, s, c => friesArt(c, o)); }

function friesArt(K, o = {}) {
  const t = o.t || 0, col = o.col || '#D8402F', pour = o.pour == null ? 1 : clamp(o.pour);
  if (!o.noShadow) softShadow(K, 0, 3, 74, 10, 0.26);
  fillPoly(K, [[-71, -148], [71, -148], [52, 0], [-52, 0]], shade(col, 0.55));                    // inside back wall
  K.save(); K.beginPath(); K.rect(-150, -320, 300, 315); K.clip();                                // hides fries still below the rim while pouring
  const N = 17, order = [...Array(N).keys()].sort((a, b) => hash(a * 2.2) - hash(b * 2.2));
  for (const i of order) {
    const f = i / (N - 1), ang = lerp(-17, 17, f) + (hash(i * 1.3) - 0.5) * 7 + Math.sin(t * 2 + i) * 0.6, len = 128 + hash(i * 2.7) * 40, bx = lerp(-46, 46, f) + (hash(i * 5.1) - 0.5) * 8;
    const rise = (1 - E.outBack(clamp(pour * 1.6 - hash(i * 7.7) * 0.6))) * 120;
    K.save(); K.translate(bx, -40 + rise); K.rotate(ang * D2R);
    fillRR(K, -6.5, -len, 13, len, 3, hGrad(K, -6.5, 6.5, [[0, '#FFE9A0'], [0.4, '#FFD04A'], [1, '#E39A1C']])); strokeRR(K, -6.5, -len, 13, len, 3, 'rgba(170,100,10,0.6)', 1.2);
    fillRR(K, -6.5, -len, 13, 6, 3, 'rgba(190,110,20,0.55)');
    for (let k = 0; k < 3; k++) circle(K, -3 + hash(i * 3 + k) * 6, -len + 14 + hash(i * 5 + k) * 40, 1.1, 'rgba(255,255,255,0.85)');   // salt
    K.restore();
  }
  K.restore();
  // carton front: flared, scooped top edge
  const front = () => { K.beginPath(); K.moveTo(-51, 0); K.lineTo(51, 0); K.lineTo(74, -147); K.bezierCurveTo(56, -120, 30, -105, 0, -105); K.bezierCurveTo(-30, -105, -56, -120, -74, -147); K.closePath(); };
  front(); K.fillStyle = hGrad(K, -74, 74, [[0, shade(col, 0.72)], [0.32, col], [0.5, shade(col, 1.12)], [1, shade(col, 0.68)]]); K.fill();
  K.lineWidth = 2; K.lineJoin = 'round'; K.strokeStyle = shade(col, 0.45); K.stroke();
  K.save(); front(); K.clip();
  K.fillStyle = 'rgba(255,255,255,0.16)'; K.beginPath(); K.moveTo(-36, 0); K.lineTo(-24, 0); K.lineTo(-38, -140); K.lineTo(-50, -140); K.fill();   // sheen
  K.strokeStyle = '#FFF4E0'; K.lineWidth = 9; K.beginPath(); K.moveTo(-80, -62); K.bezierCurveTo(-30, -48, 30, -48, 80, -62); K.stroke();          // printed stripe
  K.strokeStyle = withAlpha(shade(col, 0.6), 0.6); K.lineWidth = 2; K.beginPath(); K.moveTo(-80, -50); K.bezierCurveTo(-30, -36, 30, -36, 80, -50); K.stroke();
  K.restore();
  if (o.steam) steam(K, 0, -200, t, { n: 2, h: 70, a: 0.45 * clamp(o.steam), col: '160,150,140', gap: 40 });
}
