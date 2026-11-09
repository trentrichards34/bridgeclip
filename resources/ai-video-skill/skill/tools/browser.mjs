// Shared headless browser for every engine. Uses Playwright's own Chromium (installed by `npm run browser`),
// or CHROME_PATH if set. GPU flags per platform so three.js scenes render with WebGL everywhere.
import os from 'node:os';

export function chromeArgs() {
  const p = os.platform();
  const a = ['--allow-file-access-from-files', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
  if (p === 'darwin') a.push('--use-angle=metal');
  else if (p === 'win32') a.push('--use-angle=d3d11');
  else a.push('--use-angle=swiftshader');      // Linux / no GPU: software GL (slower, still correct)
  return a;
}

export async function launch() {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { throw new Error('Playwright is not installed. Run `npm install` inside the skill folder (see SETUP.md).'); }
  const opts = { args: chromeArgs() };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  try { return await chromium.launch(opts); }
  catch (e) {
    if (/Executable doesn't exist|browserType.launch/.test(e.message))
      throw new Error('Headless Chromium is missing. Run `npm run browser` inside the skill folder (one-time, ~100 MB).\n' + e.message.split('\n')[0]);
    throw e;
  }
}
