'use strict'
// Shared by the short-clip Remix e2e tests: the app with the real engine behind a Python wrapper whose paid OpenRouter
// calls (transcription, writing, the b-roll plan) are stood in for (tests/main/fake-ai), a fake OpenRouter key, and the
// file dialog answering from a queue.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')
const { linkEngine } = require('./editor-e2e-tools.cjs')

/** With BRIDGECLIP_E2E_SHOTS set, a picture of the window (taken in main: the hidden window may not paint for Playwright). */
async function shot(app, name) {
  const dir = process.env.BRIDGECLIP_E2E_SHOTS
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  // (Let the window paint what the test just did.)
  await new Promise((resolve) => setTimeout(resolve, 800))
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')).catch(() => null)
  if (png) fs.writeFileSync(path.join(dir, name), Buffer.from(png, 'base64'))
}

async function launchRemix(t, tools, name, env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bridgeclip-${name}-e2e-`))
  const userDataDir = path.join(root, 'user-data'), library = path.join(userDataDir, 'CreatorClips')
  fs.mkdirSync(library, { recursive: true })
  const python = path.join(root, 'python-fake-ai')
  fs.writeFileSync(python, `#!/bin/sh\nPYTHONPATH="${path.join(__dirname, 'fake-ai')}\${PYTHONPATH:+:$PYTHONPATH}" CREATORCLIPS_FAKE_AI=1 exec "${tools.python}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({ version: 6, outputDirectory: library, pythonPath: python, openrouterApiKey: '', zernioApiKey: '' }))
  const appDir = buildApp(path.join(root, 'app'))
  linkEngine(appDir)
  const session = await launchApp({ appDir, userDataDir, env: { ...tools.appEnv, ...env } })
  t.after(async () => {
    const stop = setTimeout(() => session.app.process().kill('SIGTERM'), 5000)
    try { await session.close() } finally { clearTimeout(stop); fs.rmSync(root, { recursive: true, force: true }) }
  })
  const { app, page } = session
  page.setDefaultTimeout(20000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 1000))
  // A fake OpenRouter key so Remix starts (Linux without a keyring only offers plain-text storage: let this fake key through).
  await app.evaluate(({ safeStorage }) => {
    if (process.platform !== 'linux' || (safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text')) return
    const prefix = 'test:'
    Object.assign(safeStorage, {
      isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'mock_for_tests',
      encryptString: (text) => Buffer.from(prefix + text), decryptString: (bytes) => Buffer.from(bytes).toString().slice(prefix.length)
    })
  })
  await page.evaluate(() => window.bridgeclip.settings.replaceApiKey('openrouterApiKey', 'sk-or-test'))
  await page.reload()
  /** The next file dialogs answer with these (a list for a multi-select dialog). */
  const dialogs = (answers) => app.evaluate(({ dialog }, files) => {
    const queue = [...files]
    dialog.showOpenDialog = async () => { const next = queue.shift(); return { canceled: !next, filePaths: next ? [].concat(next) : [] } }
  }, answers)
  return { root, library, app, page, errors, dialogs }
}

module.exports = { shot, launchRemix }
