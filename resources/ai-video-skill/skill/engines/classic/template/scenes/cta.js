// ═════════════ 03 · CTA  [CUT_CTA → end] · classic ═════════════
// "Comment KEYWORD and I'll send you the link." The keyword comes from reel.json cta.keyword (KEYWORD in timeline.js).
// Beats: the dot wipe clears → a Comments sheet springs up under the captions, the presenter points at its empty composer · the
//   spoken keyword: KEYWORD types into an outlined accent chip (one letter per beat) · Post presses (the one kick): the keyword SLAMS
//   in big as an accent pill, KEYWORD notifications push in on the sheet's empty right side every ~0.35 s, KEYWORD replies roll in
//   under the posted comment, the
//   presenter CELEBRATES (both fists, confetti) · "send"/"link": a DM bubble springs out of the presenter ("sent you the link" + check)
//   · last beat: thumbs-up + wink, held to the end while the counter and the notifications keep coming.
// On-screen words come from uiText() (reel.json "language" / "ui"); the DM line is uiText('sentLink').
// Comment COUNTER: off by default (no invented engagement numbers). Turn it on with a real number you can stand behind:
//   reel.json "cta": { "keyword": "REEL", "counter": 1480 } → a red odometer badge on the sheet rolls up to it after Post.
// Sound: only the beats that matter (typing, Post click + pop, DM ding, the final shimmer); the toasts and replies stay silent.
(() => {
  const S0 = CUT_CTA, S1 = DUR_END();
  const kwI = wordIndex(KEYWORD, S0 - 0.2);
  const T_TYPE = kwI >= 0 ? WORDS[kwI].s - 0.05 : S0 + 0.45;
  const T_SEND = Math.max(T_TYPE + KEYWORD.length / 16 + 0.1, kwI >= 0 ? WORDS[kwI].e + 0.06 : T_TYPE + 0.6);
  const T_DM = Math.max(T_SEND + 0.45, cueAny(['send', 'link', 'dm', 'message'], T_SEND, T_SEND + 0.6));
  const T_THUMB = Math.max(T_DM + 0.5, VO_END - 0.45);
  const CTA_SHEET = { x: 90, y: 540, w: 900 };
  const CTA_DM = { x: 110, y: 1250, w: 620 };
  const CTA_BIG = { x: 540, y: 1050 };   // the keyword, BIG and clear (the CTA's hero)
  // KEYWORD replies under the posted comment + KEYWORD notifications (one every ~0.35 s from Post to the end)
  const REPLIES = [...Array(Math.max(2, Math.min(8, Math.floor((S1 - T_SEND) / 0.3))))].map((_, k) => T_SEND + 0.3 + k * 0.22 + (k > 1 ? (k - 1) * 0.08 : 0));
  const TOASTS = [...Array(Math.max(2, Math.min(9, Math.floor((S1 - T_SEND - 0.1) / 0.35))))].map((_, k) => ({ t: T_SEND + 0.14 + k * 0.35, title: KEYWORD, glyph: k % 2 ? 'mail' : 'bell', time: `${k + 1}s` }));
  // the comment counter (only with reel.json cta.counter): ticks slowly before Post, rolls fast after it, keeps climbing to the end
  const COUNT = Math.max(0, Math.round(+((REEL.cta && REEL.cta.counter) || 0))) || 0;
  const CNT = [[S0, 0.02], [T_SEND, 0.026], [T_SEND + 0.6, 0.28], [T_DM + 0.4, 0.65], [S1 + 0.5, 1]].map(([t, f]) => [t, Math.round(f * COUNT)]);
  const cnt = t => { let k = 0; while (k + 1 < CNT.length && t > CNT[k + 1][0]) k++; if (k + 1 >= CNT.length) return CNT[k][1]; const [a, va] = CNT[k], [b, vb] = CNT[k + 1]; return t <= a ? va : lerp(va, vb, (k === 1 ? E.outCubic : E.lin)(clamp((t - a) / (b - a)))); };

  cue(T_SEND, 'click', 0); cue(T_SEND + 0.05, 'pop', -2); kick(T_SEND + 0.04, 0.6, 0.45);
  cue(T_TYPE, 'type', -8); if (KEYWORD.length > 3) cue(T_TYPE + KEYWORD.length / 32, 'type', -9);   // two keystrokes, not one per letter
  cue(T_DM, 'ding', -4); cue(T_THUMB, 'shimmer', -6);

  const sheetY = t => CTA_SHEET.y + (1 - clamp(pop(t - S0 - 0.08, 2.0, 0.64), 0, 1.2)) * 1300;
  const MOODS = [['celebrate', T_SEND + 0.02, T_DM - 0.06]];

  SC.cta = {
    label: '// 03 — ' + uiText('sceneGet'),
    readout: t => COUNT ? { k: uiText('comments'), v: Math.floor(cnt(t)).toLocaleString('en-US'), hot: t >= T_SEND } : { k: uiText('comments'), v: KEYWORD, hot: t >= T_SEND },
    cam: t => ({ z: 1 + 0.03 * win(t, T_TYPE - 0.2, T_SEND + 0.3, 0.4, 0.5) + 0.006 * Math.max(0, t - T_SEND), y: -12 * win(t, T_SEND, S1 + 1, 0.4, 0.1) }),   // lean in on the composer, then a slow push
    draw(T, K, t) {
      moodFx(T, K, t, MOODS);
      const sy = sheetY(t);
      commentSheet(T, K, CTA_SHEET.x, sy, { t, w: CTA_SHEET.w, keyword: KEYWORD, tType: T_TYPE, tSend: T_SEND, replies: REPLIES });
      // KEYWORD notifications pushing in on the sheet's empty right half (newest on top, older slide down and fade)
      const tx = CTA_SHEET.x + CTA_SHEET.w - 400;
      for (const c of [T, K]) { c.save(); c.beginPath(); c.rect(tx - 20, sy + 92, 420, 238); c.clip(); }
      toastStack(T, K, tx, sy + 108, 370, t, TOASTS, { max: 2, h: 84 });
      for (const c of [T, K]) c.restore();
      // the counter badge on the sheet's top-right corner (odometer, accent once posted): only with a real cta.counter
      if (COUNT) {
      const v = cnt(t), vel = (cnt(t + 0.02) - cnt(t - 0.02)) / 0.04, bump = 1 + 0.12 * ring(t - T_SEND - 0.02, 3, 7) * (t > T_SEND ? 1 : 0);
      X([T, K], CTA_SHEET.x + CTA_SHEET.w - 120, sy + 6, clamp(pop(t - S0 - 0.3, 3, 0.5), 0, 1.2) * bump, -4, () => {
        const f = { font: F.grot, weight: 700, size: 46 }, w = Math.max(180, measure(K, Math.floor(v).toLocaleString('en-US'), f) + 110);
        fillRR(T, -w / 2 + 8, -34, w, 76, 38, C.k45);
        fillRR(K, -w / 2, -38, w, 76, 38, t >= T_SEND ? C.red : C.ink);
        odometer(K, v, 20, 17, { size: 46, color: '#FFFFFF', align: 'center', vel });
        K.save(); K.translate(-w / 2 + 36, -2); fillRR(K, -14, -12, 28, 22, 7, '#FFFFFF'); K.beginPath(); K.moveTo(-6, 9); K.lineTo(-10, 17); K.lineTo(2, 9); K.closePath(); K.fillStyle = '#FFFFFF'; K.fill(); K.restore();
      });
      }
      if (t >= T_SEND) {   // posted → the keyword slams in big (accent pill, ~130 px type)
        const s = clamp(pop(t - T_SEND - 0.02, 2.6, 0.5), 0, 1.25), f = { font: F.grot, weight: 700, size: 132, ls: -2 };
        impact(T, K, CTA_BIG.x, CTA_BIG.y, t - T_SEND - 0.06, 1.1, 6);
        X([T, K], CTA_BIG.x, CTA_BIG.y + Math.sin(t * 2.2) * 5 * clamp(t - T_SEND - 0.5), lerp(0.35, 1, s), lerp(-9, -3, clamp(s)) + Math.sin(t * 1.7) * 0.8, () => {
          const w = measure(K, KEYWORD, f) + 130;
          fillRR(T, -w / 2 + 18, -80, w, 196, 98, C.k60);   // halftone drop shadow
          fillRR(K, -w / 2, -98, w, 196, 98, C.red);
          text(K, KEYWORD, 0, 48, Object.assign({}, f, { color: '#FFFFFF' }));
        });
      }
      if (t >= T_DM) {   // DM bubble springs out of the presenter
        const a = pop(t - T_DM, 2.2, 0.58), q = clamp(a);
        X([T, K], lerp(PRESENTER_DOCK.x - 100, CTA_DM.x + CTA_DM.w / 2, a), lerp(1500, CTA_DM.y + 70, a), lerp(0.15, 1, a), lerp(10, 0, q), () => {
          const h = dmBubble(T, K, -CTA_DM.w / 2, -70, [{ txt: uiText('sentLink'), t0: T_DM + 0.12 }], { t, w: CTA_DM.w, title: uiText('newMessage') });
          const cp = pop(t - T_DM - 0.5, 3, 0.45);
          if (cp > 0) X([K], CTA_DM.w / 2 - 50, -70 + h / 2 + 10, cp, 0, () => { circle(K, 0, 0, 26, C.red); check(K, 1, 1, 30, clamp((t - T_DM - 0.52) / 0.2), '#FFFFFF', 7); });
        });
      }
    },
    guy: t => act(t, mood(t, MOODS, {
      focus: [[S0 + 0.2, T_SEND + 0.1, CTA_SHEET.x + 300, t => sheetY(t) + 380], [T_SEND + 0.1, T_DM - 0.05, CTA_BIG.x - 120, CTA_BIG.y - 40]],
      beats: [[T_DM, T_THUMB - 0.1, 'R', 'hold'], [T_THUMB, S1 + 1, 'R', 'thumb']],
      faces: [[T_DM, T_THUMB, { smile: 0.9, brow: 0.5 }], [T_THUMB, S1 + 1, { smile: 0.95 }], [T_THUMB + 0.14, S1 + 1, { wink: 1 }]],
      gestures: false,
    })),
  };
})();
