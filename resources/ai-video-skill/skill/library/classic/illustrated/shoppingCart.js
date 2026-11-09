// ── ILLUSTRATED EXAMPLE · SHOPPING TROLLEY that fills up (studied from a reel about a megastore's layout making you buy more;
// de-branded: a plain wire trolley with a red grip, generic home items)
// WHAT it shows: "your cart fills up": a real wire trolley, side view, items dropping in one by one and bouncing.
// TECHNIQUES inside (guides/illustration.md):
//   · see-through objects in layers: frame + lower tray → items INSIDE (clipped to the basket's trapezoid) → the front wire mesh
//     drawn OVER the items (13 slanted + 4 horizontal wires) → rim tubes. The mesh over the contents is what makes it a real basket
//   · metal = mid grey lines + a lighter tray; wheels = dark disc + light hub + one spoke so spin reads
//   · items are tiny real objects (pillow, plant, lamp, frame, candles, mug, rug, flat box), each 2-5 shapes with one highlight
//   · o.n is FRACTIONAL: item i falls while n - i ∈ (0, 0.5) (gravity curve), lands with a squash/bounce while ∈ (0.5, 1). Cue it
//     on words: n = springTo / a ramp between the item words
// API: shoppingCart(ctx, x, y, s, o) bottom-centre between the wheels · shoppingCartArt(ctx, o) · cartItem(ctx, kind, x, y, s) · CART_BOX
//      o: { t, n (items in, float, default all 8), spin (wheel angle rad), grip colour, noShadow }
// DON'T paste this as your reel's prop: draw THIS script's subject with the same method. Not loaded by the engine. Needs kits/illustrate.js.

var CART_BOX = [-126, -246, 146, 14];
function shoppingCart(ctx, x, y, s = 1, o = {}) { placeArt(ctx, CART_BOX, x, y, s, c => shoppingCartArt(c, o)); }

var CART_OUT = 'rgba(35,35,45,0.55)';
var CART_ITEMS = {                                                           // local bottom-centre at 0, 0
  pillow(K) { K.save(); rr(K, -30, -28, 60, 28, 11); K.clip(); K.fillStyle = '#4F7FA8'; K.fillRect(-30, -28, 60, 28); K.fillStyle = '#F2E3C2'; K.fillRect(-30, -18, 60, 7); K.fillStyle = 'rgba(255,255,255,0.25)'; K.fillRect(-30, -28, 60, 5); K.restore(); strokeRR(K, -30, -28, 60, 28, 11, '#2F5878', 1.6); },
  plant(K) {
    [[-30, -64, 0.5], [-8, -78, 0.15], [14, -72, -0.3], [-20, -50, 0.9], [22, -50, -0.8]].forEach(([lx, ly, a], i) => { K.save(); K.translate(lx * 0.6, -26 + (ly + 26) * 0.9); K.rotate(a); K.beginPath(); K.ellipse(0, 0, 7, 19, 0, 0, TAU); K.fillStyle = i % 2 ? '#3E8E3A' : '#5DB04E'; K.fill(); K.strokeStyle = '#2C6A2A'; K.lineWidth = 1.2; K.stroke(); K.restore(); });
    poly(K, [[-15, -28], [15, -28], [11, 0], [-11, 0]]); K.fillStyle = '#FFFFFF'; K.fill(); K.strokeStyle = CART_OUT; K.lineWidth = 1.4; K.stroke(); fillRR(K, -16, -30, 32, 5, 2, '#ECEAE4');
  },
  lamp(K) { fillRR(K, -12, -4, 24, 4, 2, '#55575E'); line(K, 0, -4, 0, -96, '#55575E', 3); poly(K, [[-22, -92], [22, -92], [14, -122], [-14, -122]]); K.fillStyle = '#FFF4D6'; K.fill(); K.strokeStyle = CART_OUT; K.lineWidth = 1.4; K.stroke(); K.fillStyle = 'rgba(255,200,80,0.35)'; K.beginPath(); K.ellipse(0, -90, 20, 4, 0, 0, TAU); K.fill(); },
  frame(K) { fillRR(K, -25, -64, 50, 64, 3, '#D8B47F'); strokeRR(K, -25, -64, 50, 64, 3, '#B08552', 1.6); fillRR(K, -19, -58, 38, 52, 1, '#FFFFFF'); fillRR(K, -14, -52, 28, 40, 0, vGrad(K, -52, -12, ['#8EC5EA', '#D8EEF8'])); circle(K, 5, -42, 5, '#F2C14E'); K.beginPath(); K.moveTo(-14, -12); K.quadraticCurveTo(-2, -30, 14, -16); K.lineTo(14, -12); K.closePath(); K.fillStyle = '#5DB04E'; K.fill(); },
  candles(K) { [[-14, 34], [0, 44], [14, 30]].forEach(([cx, hh]) => { fillRR(K, cx - 6, -hh, 12, hh, 2, '#FFFDF6'); strokeRR(K, cx - 6, -hh, 12, hh, 2, CART_OUT, 1.2); line(K, cx, -hh, cx, -hh - 4, '#333', 1.4); }); fillRR(K, -22, -16, 44, 12, 2, '#B8412F'); },
  mug(K) { K.save(); K.lineWidth = 4.5; K.strokeStyle = '#2F6B5A'; K.beginPath(); K.arc(15, -16, 8, -Math.PI / 2, Math.PI / 2); K.stroke(); K.restore(); fillRR(K, -15, -34, 30, 34, 5, '#3E8C74'); strokeRR(K, -15, -34, 30, 34, 5, '#24584A', 1.4); fillRR(K, -11, -30, 4, 24, 2, 'rgba(255,255,255,0.35)'); },
  rug(K) { K.save(); K.rotate(-62 * D2R); K.translate(0, -2); K.save(); rr(K, 0, -10, 120, 20, 10); K.clip(); for (let i = 0; i < 8; i++) { K.fillStyle = i % 2 ? '#E7D3A6' : '#B8412F'; K.fillRect(i * 15, -10, 15, 20); } K.restore(); strokeRR(K, 0, -10, 120, 20, 10, CART_OUT, 1.4); K.beginPath(); K.ellipse(120, 0, 5, 10, 0, 0, TAU); K.fillStyle = '#E8D9A8'; K.fill(); K.stroke(); K.restore(); },
  flatbox(K) { fillRR(K, -36, -24, 72, 24, 2, '#D3A86E'); strokeRR(K, -36, -24, 72, 24, 2, '#8E6A3A', 1.4); fillRR(K, -36, -14, 72, 4, 0, 'rgba(140,100,50,0.4)'); fillRR(K, 4, -21, 26, 14, 1.5, '#FFFFFF'); fillRR(K, 7, -18, 12, 5, 1, '#55575E'); },
};
function cartItem(ctx, kind, x, y, s = 1) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); (CART_ITEMS[kind] || CART_ITEMS.pillow)(ctx); ctx.restore(); }
var CART_LOAD = [['pillow', -48, -68, 0], ['plant', 34, -68, 0], ['lamp', -6, -68, -4], ['frame', 64, -70, 8], ['rug', -36, -76, 0], ['candles', -60, -96, -6], ['mug', 10, -70, 4], ['flatbox', 26, -100, -5]];

function shoppingCartArt(K, o = {}) {
  const n = o.n == null ? CART_LOAD.length : o.n, spin = o.spin || 0, MET = '#7D858E', MET2 = '#AEB5BC', grip = o.grip || '#D8402F';
  if (!o.noShadow) softShadow(K, 0, 3, 116, 11, 0.24);
  line(K, -80, -36, 82, -36, MET, 5); fillRR(K, -78, -48, 148, 8, 3, MET2); line(K, -72, -36, -72, -12, MET, 5); line(K, 74, -36, 74, -12, MET, 5); line(K, 82, -36, 98, -150, MET, 5);
  K.save(); poly(K, [[-104, -600], [100, -600], [100, -150], [83, -66], [-88, -66], [-104, -150]]); K.clip();       // items inside the basket
  fillPoly(K, [[-102, -150], [97, -150], [82, -66], [-87, -66]], 'rgba(160,170,180,0.18)');
  CART_LOAD.forEach(([kind, ix, iy, ir], i) => {
    const p = n - i; if (p <= 0) return;
    let yo = 0, sq = 0;
    if (p < 0.5) yo = -260 * (1 - (p / 0.5) ** 2); else if (p < 1) { const q = (p - 0.5) / 0.5; yo = -16 * Math.sin(q * Math.PI) * (1 - q); sq = Math.sin(q * Math.PI * 2) * 0.08 * (1 - q); }
    K.save(); K.translate(ix, iy + yo); K.rotate(ir * D2R + (p < 0.5 ? (1 - p / 0.5) * 0.6 * (i % 2 ? 1 : -1) : 0)); K.scale(1 + sq, 1 - sq); CART_ITEMS[kind](K); K.restore();
  });
  K.restore();
  K.save(); K.strokeStyle = MET; K.lineWidth = 2.2;                                                                  // the front mesh OVER the items
  for (let i = 0; i <= 12; i++) { const f = i / 12; K.beginPath(); K.moveTo(lerp(-102, 97, f), -150); K.lineTo(lerp(-87, 82, f), -66); K.stroke(); }
  for (let j = 1; j < 5; j++) { const f = j / 5, y = lerp(-150, -66, f); K.beginPath(); K.moveTo(lerp(-102, -87, f), y); K.lineTo(lerp(97, 82, f), y); K.stroke(); }
  K.restore();
  line(K, -104, -151, 99, -151, '#5F6770', 6); line(K, -88, -66, 83, -66, '#5F6770', 4.5);
  line(K, -100, -153, 95, -153, 'rgba(255,255,255,0.35)', 1.5);                                                      // rim highlight
  line(K, 97, -150, 124, -182, '#5F6770', 5);
  X([K], 126, -186, 1, -40, () => { fillRR(K, -16, -7, 32, 14, 7, grip); fillRR(K, -16, -7, 32, 5, 3, 'rgba(255,255,255,0.25)'); fillRR(K, -20, -7, 6, 14, 3, '#2B2F36'); fillRR(K, 14, -7, 6, 14, 3, '#2B2F36'); });
  for (const wx of [-72, 74]) X([K], wx, -11, 1, spin / D2R, () => { circle(K, 0, 0, 11, '#2B2F36'); circle(K, 0, 0, 4.5, '#C8CDD3'); line(K, -7, 0, 7, 0, '#6A7079', 2); });
}
