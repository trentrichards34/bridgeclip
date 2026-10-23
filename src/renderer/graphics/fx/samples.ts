/**
 * Stand-in pictures for the gallery's previews of the effects that show the member's own screenshots and photos
 * (fx-catalog.ts `picture(…, sample)`). Plain shapes only: no words, numbers, names or logos (the gallery never shows
 * made-up content), and never put in a clip.
 */
const svg = (w: number, h: number, body: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`
const bar = (x: number, y: number, w: number, h: number, fill: string, r = h / 2): string => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`

/** A web page: a top bar, a headline, a chart card and two side cards. */
const PAGE = svg(1280, 800, `<rect width="1280" height="800" fill="#F4F6FB"/>${bar(0, 0, 1280, 76, '#FFFFFF', 0)}${bar(40, 26, 120, 24, '#1E293B')}${bar(880, 28, 90, 20, '#CBD5E1')}${bar(990, 28, 90, 20, '#CBD5E1')}${bar(1100, 20, 140, 36, '#2F5BFF', 18)}
  ${bar(60, 130, 560, 44, '#0F172A', 12)}${bar(60, 192, 420, 22, '#94A3B8')}${bar(60, 228, 360, 22, '#94A3B8')}
  ${bar(60, 290, 740, 440, '#FFFFFF', 24)}${[0, 1, 2, 3, 4, 5].map((i) => bar(110 + i * 112, 660 - [120, 170, 150, 230, 260, 330][i], 70, [120, 170, 150, 230, 260, 330][i], i === 5 ? '#2F5BFF' : '#C7D2FE', 10)).join('')}
  ${bar(840, 290, 380, 210, '#FFFFFF', 24)}${bar(880, 330, 160, 22, '#CBD5E1')}${bar(880, 380, 240, 56, '#0F172A', 14)}${bar(840, 520, 380, 210, '#FFFFFF', 24)}${bar(880, 560, 200, 22, '#CBD5E1')}<circle cx="1030" cy="660" r="40" fill="none" stroke="#22C55E" stroke-width="16"/>`)

/** A phone app screen: a header, a big ring and list rows. */
const PHONE = svg(390, 844, `<rect width="390" height="844" fill="#0F172A"/>${bar(24, 70, 150, 22, '#E2E8F0')}<circle cx="340" cy="81" r="18" fill="#334155"/>
  <circle cx="195" cy="250" r="96" fill="none" stroke="#1E293B" stroke-width="26"/><path d="M195 154 A96 96 0 1 1 103 279" fill="none" stroke="#7C5CFF" stroke-width="26" stroke-linecap="round"/>${bar(150, 236, 90, 30, '#F8FAFC', 8)}
  ${[0, 1, 2, 3, 4].map((i) => `${bar(24, 400 + i * 84, 342, 68, '#1E293B', 18)}<circle cx="60" cy="${434 + i * 84}" r="16" fill="${i === 1 ? '#22C55E' : '#475569'}"/>${bar(90, 424 + i * 84, 150 - i * 12, 18, '#CBD5E1')}`).join('')}`)

/** A social post: a header, lines, a picture and its buttons. */
const POST = svg(1080, 900, `<rect width="1080" height="900" rx="40" fill="#FFFFFF"/><circle cx="110" cy="110" r="50" fill="#CBD5E1"/>${bar(184, 80, 260, 28, '#0F172A')}${bar(184, 122, 170, 22, '#94A3B8')}
  ${bar(60, 200, 900, 30, '#334155')}${bar(60, 250, 960, 30, '#334155')}${bar(60, 300, 620, 30, '#334155')}
  <rect x="60" y="370" width="960" height="400" rx="26" fill="#E0E7FF"/><circle cx="300" cy="520" r="70" fill="#FDE68A"/><path d="M60 770 L380 560 L560 700 L760 520 L1020 770 Z" fill="#A5B4FC"/>
  ${[0, 1, 2].map((i) => `<circle cx="${100 + i * 140}" cy="830" r="24" fill="${i === 0 ? '#F43F5E' : '#CBD5E1'}"/>`).join('')}`)

/** Before: a crowded grey page. After: the same, clean and in color. */
const BEFORE = svg(1000, 1000, `<rect width="1000" height="1000" fill="#D9DCE1"/>${Array.from({ length: 9 }, (_, i) => bar(40 + (i % 3) * 310, 60 + Math.floor(i / 3) * 310, 290, 290, '#C2C6CD', 6)).join('')}
  ${Array.from({ length: 18 }, (_, i) => bar(60 + (i % 3) * 310, 90 + Math.floor(i / 3) * 155, 200 - (i % 4) * 30, 18, '#9CA3AF', 4)).join('')}`)
const AFTER = svg(1000, 1000, `<rect width="1000" height="1000" fill="#F8FAFC"/>${bar(0, 0, 1000, 330, '#2F5BFF', 0)}${bar(80, 110, 520, 52, '#FFFFFF', 14)}${bar(80, 190, 360, 26, '#C7D2FE')}
  ${bar(80, 400, 380, 500, '#FFFFFF', 30)}${bar(540, 400, 380, 500, '#FFFFFF', 30)}<circle cx="270" cy="560" r="80" fill="#22C55E"/><circle cx="730" cy="560" r="80" fill="#F59E0B"/>
  ${bar(150, 700, 240, 26, '#334155')}${bar(610, 700, 240, 26, '#334155')}${bar(150, 750, 180, 20, '#94A3B8')}${bar(610, 750, 180, 20, '#94A3B8')}`)

/** A photo: hills under an evening sky. */
const PHOTO = svg(1200, 800, `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E3A8A"/><stop offset=".6" stop-color="#F97316"/><stop offset="1" stop-color="#FDE68A"/></linearGradient></defs>
  <rect width="1200" height="800" fill="url(#s)"/><circle cx="820" cy="470" r="110" fill="#FEF3C7"/><path d="M0 560 Q300 420 600 560 T1200 520 V800 H0 Z" fill="#7C2D12"/><path d="M0 660 Q400 560 800 660 T1200 640 V800 H0 Z" fill="#431407"/>`)

export const FX_SAMPLE_PICTURES: Record<string, string> = { page: PAGE, phone: PHONE, post: POST, before: BEFORE, after: AFTER, photo: PHOTO }
/** Where the gallery's sample mark sits on each stand-in (x, y, w, h). */
export const FX_SAMPLE_MARKS: Record<string, string> = { page: '0.06, 0.36, 0.58, 0.56', phone: '0.06, 0.55, 0.88, 0.09', post: '0.05, 0.21, 0.9, 0.13', photo: '0.58, 0.44, 0.22, 0.32' }
