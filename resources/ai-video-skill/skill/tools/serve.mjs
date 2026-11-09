// Tiny static server for renders and live preview.
//   /engine/...  → <skill>/engines/<style>/   (the shared engine code)
//   /fonts/...   → <skill>/fonts/             (bundled + on-demand fonts)
//   /skill/...   → <skill>/                   (anything else in the skill, e.g. library assets)
//   everything else → the project folder (scenes, build/, audio/, assets/)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4' };

export function serve(projectDir, style, port = 0) {
  const roots = [['/engine/', path.join(SKILL, 'engines', style)], ['/fonts/', path.join(SKILL, 'fonts')], ['/skill/', SKILL], ['/', path.resolve(projectDir)]];
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    for (const [pre, dir] of roots) {
      if (!url.startsWith(pre)) continue;
      const f = path.join(dir, url.slice(pre.length) || 'index.html');
      if (!f.startsWith(dir)) break;                                   // no ../ escapes
      fs.readFile(f, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found: ' + url); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
