// ───────────────────────── clean UI kit (reference style: white cards, thin rules, mono labels) ─────────────────────────
// All helpers draw in local coords; wrap them in X([T,K], x, y, s, rot, fn) to place/animate.
const pop = (dt, f = 2.6, z = 0.42) => dt <= 0 ? 0 : spring(dt, f, z);
function X(cs, x, y, s, r, fn) { for (const c of cs) { c.save(); c.translate(x, y); c.rotate(r * D2R); c.scale(s, s); } fn(); for (const c of cs) c.restore(); }
const HAIR = '#DDDAD2';           // hairline border color on K

// ── UI text: every word the kits/template draw on screen (comment sheet, DM, browser tab, template labels) ──
// Picked by reel.json "language" (ISO code, e.g. "ru"); any key can be overridden per reel with reel.json "ui": { key: "text" }.
// uiText(key) → string (falls back to English, then to the key itself). Add your own keys in "ui" and read them with uiText too.
const UI = {
  en: { comments: 'Comments', addComment: 'Add a comment…', post: 'Post', you: 'you', newMessage: 'new message', sentLink: 'sent you the link', newTab: 'New tab',
    workflow: 'your workflow', today: 'today', plan: 'the plan', done: 'Done.', doneCount: 'DONE', nope: 'NOPE', sceneProblem: 'the problem', sceneHow: 'how it works', sceneGet: 'get it' },
  ru: { comments: 'Комментарии', addComment: 'Добавьте комментарий…', post: 'Опубликовать', you: 'вы', newMessage: 'новое сообщение', sentLink: 'держи ссылку', newTab: 'Новая вкладка',
    workflow: 'ваши задачи', today: 'сегодня', plan: 'план', done: 'Готово.', doneCount: 'ГОТОВО', nope: 'НЕТ', sceneProblem: 'проблема', sceneHow: 'как это работает', sceneGet: 'забирай' },
  uk: { comments: 'Коментарі', addComment: 'Додайте коментар…', post: 'Опублікувати', you: 'ви', newMessage: 'нове повідомлення', sentLink: 'тримай посилання', newTab: 'Нова вкладка',
    workflow: 'ваші задачі', today: 'сьогодні', plan: 'план', done: 'Готово.', doneCount: 'ГОТОВО', nope: 'НІ', sceneProblem: 'проблема', sceneHow: 'як це працює', sceneGet: 'забирай' },
  es: { comments: 'Comentarios', addComment: 'Añade un comentario…', post: 'Publicar', you: 'tú', newMessage: 'nuevo mensaje', sentLink: 'te envié el enlace', newTab: 'Nueva pestaña',
    workflow: 'tu flujo de trabajo', today: 'hoy', plan: 'el plan', done: 'Listo.', doneCount: 'LISTO', nope: 'NO', sceneProblem: 'el problema', sceneHow: 'cómo funciona', sceneGet: 'consíguelo' },
  pt: { comments: 'Comentários', addComment: 'Adicione um comentário…', post: 'Publicar', you: 'você', newMessage: 'nova mensagem', sentLink: 'te mandei o link', newTab: 'Nova aba',
    workflow: 'seu fluxo de trabalho', today: 'hoje', plan: 'o plano', done: 'Pronto.', doneCount: 'PRONTO', nope: 'NÃO', sceneProblem: 'o problema', sceneHow: 'como funciona', sceneGet: 'pegue o seu' },
  de: { comments: 'Kommentare', addComment: 'Kommentar hinzufügen…', post: 'Posten', you: 'du', newMessage: 'neue Nachricht', sentLink: 'hier ist der Link', newTab: 'Neuer Tab',
    workflow: 'dein Workflow', today: 'heute', plan: 'der Plan', done: 'Fertig.', doneCount: 'FERTIG', nope: 'NEIN', sceneProblem: 'das Problem', sceneHow: 'so geht’s', sceneGet: 'hol es dir' },
  fr: { comments: 'Commentaires', addComment: 'Ajouter un commentaire…', post: 'Publier', you: 'vous', newMessage: 'nouveau message', sentLink: 'voici le lien', newTab: 'Nouvel onglet',
    workflow: 'ton flux de travail', today: 'aujourd’hui', plan: 'le plan', done: 'Terminé.', doneCount: 'FAIT', nope: 'NON', sceneProblem: 'le problème', sceneHow: 'comment ça marche', sceneGet: 'à toi' },
  it: { comments: 'Commenti', addComment: 'Aggiungi un commento…', post: 'Pubblica', you: 'tu', newMessage: 'nuovo messaggio', sentLink: 'ecco il link', newTab: 'Nuova scheda',
    workflow: 'il tuo flusso di lavoro', today: 'oggi', plan: 'il piano', done: 'Fatto.', doneCount: 'FATTO', nope: 'NO', sceneProblem: 'il problema', sceneHow: 'come funziona', sceneGet: 'prendilo' },
  tr: { comments: 'Yorumlar', addComment: 'Yorum ekle…', post: 'Paylaş', you: 'sen', newMessage: 'yeni mesaj', sentLink: 'linki gönderdim', newTab: 'Yeni sekme',
    workflow: 'iş akışın', today: 'bugün', plan: 'plan', done: 'Tamam.', doneCount: 'TAMAM', nope: 'HAYIR', sceneProblem: 'sorun', sceneHow: 'nasıl çalışır', sceneGet: 'hemen al' },
  ar: { comments: 'التعليقات', addComment: 'أضف تعليقًا…', post: 'نشر', you: 'أنت', newMessage: 'رسالة جديدة', sentLink: 'أرسلت لك الرابط', newTab: 'علامة تبويب جديدة',
    workflow: 'سير عملك', today: 'اليوم', plan: 'الخطة', done: 'تم.', doneCount: 'تم', nope: 'لا', sceneProblem: 'المشكلة', sceneHow: 'كيف يعمل', sceneGet: 'احصل عليه' },
  hi: { comments: 'कमेंट्स', addComment: 'कमेंट जोड़ें…', post: 'पोस्ट करें', you: 'आप', newMessage: 'नया मैसेज', sentLink: 'लिंक भेज दिया', newTab: 'नया टैब',
    workflow: 'आपका वर्कफ़्लो', today: 'आज', plan: 'प्लान', done: 'हो गया।', doneCount: 'हो गया', nope: 'नहीं', sceneProblem: 'समस्या', sceneHow: 'कैसे काम करता है', sceneGet: 'अभी पाएँ' },
};
function uiText(key) {
  const R = typeof REEL !== 'undefined' && REEL ? REEL : {}, lang = String(R.language || 'en').toLowerCase().split(/[-_]/)[0];
  if (R.ui && R.ui[key] != null) return String(R.ui[key]);
  return (UI[lang] && UI[lang][key]) ?? UI.en[key] ?? key;
}
// every UI string for the reel's language (the engine preloads Fallback glyphs for them)
const uiStrings = () => Object.keys(Object.assign({}, UI.en, (typeof REEL !== 'undefined' && REEL && REEL.ui) || {})).map(uiText);

// white card with a soft halftone drop shadow (shadow lives on T so it prints as a dot gradient)
function uiCard(T, K, x, y, w, h, o = {}) {
  const { r = 28, shadow = 1, fill = '#FFFFFF', border = HAIR, lw = 3 } = o;
  if (shadow) {
    T.save(); T.shadowColor = `rgba(0,0,0,${0.42 * shadow})`; T.shadowBlur = 46; T.shadowOffsetY = 26;
    fillRR(T, x, y, w, h, r, '#FFFFFF'); T.restore();
  }
  fillRR(T, x, y, w, h, r, '#FFFFFF');
  if (fill) fillRR(K, x, y, w, h, r, fill);
  if (lw) strokeRR(K, x, y, w, h, r, border, lw);
}
// "// label      01" header line used on reference cards
function uiLabel(K, str, x, y, o = {}) {
  text(K, '// ' + str, x, y, { font: F.mono, weight: 500, size: o.size || 24, color: o.color || '#8a8780', align: o.align || 'left' });
}
function uiPill(K, str, x, y, w, h, o = {}) {       // centred at x,y
  const { fill = C.ink, color = C.paper, size = 32, press = 0, weight = 700 } = o;
  K.save(); K.translate(x, y); K.scale(1 - press * 0.06, 1 - press * 0.06);
  fillRR(K, -w / 2, -h / 2, w, h, h / 2, fill);
  if (o.stroke) strokeRR(K, -w / 2, -h / 2, w, h, h / 2, o.stroke, 3);
  text(K, str, 0, size * 0.36, { font: F.grot, weight, size, color });
  K.restore();
}
function uiField(K, x, y, w, h, value, o = {}) {
  const { label = null, missing = false, t = 0 } = o;
  if (label) text(K, label, x, y - 14, { font: F.mono, weight: 500, size: 22, color: missing ? C.red : '#8a8780', align: 'left' });
  if (missing) { K.save(); K.setLineDash([12, 10]); strokeRR(K, x, y, w, h, 14, C.red, 3); K.restore(); return; }
  fillRR(K, x, y, w, h, 14, '#FFFFFF'); strokeRR(K, x, y, w, h, 14, o.focus ? C.ink : HAIR, 3);
  if (value) text(K, value, x + 22, y + h / 2 + 12, { font: F.grot, weight: 500, size: o.size || 32, color: C.ink, align: 'left' });
}
// big figure: slot-rolling number in Space Grotesk
function bigFigure(K, str, x, y, size, p, o = {}) {
  return slot(K, str, x, y, { font: F.grot, weight: 700, size, color: o.color || C.ink, align: o.align || 'center', ls: -size * 0.04 }, p);
}
// "Handled."-style seal: serif italic word inside a rotated double ring (use sparingly)
function seal(K, str, x, y, dt, o = {}) {
  if (dt < 0) return;
  const { size = 120, col = C.red, rot = -10 } = o;
  const s = dt < 0.12 ? lerp(1.9, 1, E.inQuart(dt / 0.12)) : 1 + ring(dt - 0.12, 5, 11) * 0.04;
  const f = { font: F.serif, italic: true, weight: 400, size };
  const tw = measure(K, str, f), w = tw + size * 0.7, h = size * 1.25;
  K.save(); K.translate(x, y); K.rotate(rot * D2R); K.scale(s, s); K.globalAlpha *= clamp(dt / 0.05);
  strokeRR(K, -w / 2, -h / 2, w, h, h / 2, col, 6);
  strokeRR(K, -w / 2 + 12, -h / 2 + 12, w - 24, h - 24, h / 2 - 12, col, 2.5);
  text(K, str, 0, size * 0.3, Object.assign({}, f, { color: col }));
  K.restore();
}
// small line icons -------------------------------------------------------------------------
function iconCheck(K, x, y, s, p, col = C.ink) { check(K, x, y, s, p, col, s * 0.16); }
function iconX(K, x, y, s, p, col = C.red) { cross(K, x, y, s, p, col, s * 0.16); }
