const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildApp, launchApp } = require('../zernio/support/electron-app.cjs')

const iso = (date) => date.toISOString()
const now = new Date()
const thisMonth = (day) => new Date(now.getFullYear(), now.getMonth(), day, 12)
const lastMonth = (day) => new Date(now.getFullYear(), now.getMonth() - 1, day, 12)

test('Settings → Spending: totals, balance, monthly limit, the check before a paid run, and out-of-credits', { timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeclip-spending-e2e-'))
  const userData = path.join(root, 'user-data')
  // A ledger from earlier sessions (backfill already done).
  fs.mkdirSync(path.join(userData, 'spending'), { recursive: true })
  const ledger = [
    { at: iso(thisMonth(1)), kind: 'create', provider: 'openrouter', usd: 0.5, label: 'Create run', runId: '11111111-1111-4111-8111-111111111111' },
    { at: iso(thisMonth(2)), kind: 'remix', provider: 'openrouter', usd: 1.25, label: 'Remix videos', runId: 'remix-abc' },
    { at: iso(thisMonth(2)), kind: 'avatar', provider: 'openrouter', usd: 0.16, label: 'Avatar pictures', estimated: true },
    { at: iso(lastMonth(10)), kind: 'chat', provider: 'openrouter', usd: 0.04, label: 'Chat message' },
    { at: iso(lastMonth(11)), kind: 'avatar', provider: 'fal', usd: 2, label: 'Avatar recreate', estimated: true }
  ]
  fs.writeFileSync(path.join(userData, 'spending', 'ledger.jsonl'), ledger.map((entry) => JSON.stringify(entry)).join('\n') + '\n{broken line\n')
  fs.writeFileSync(path.join(userData, 'spending', 'state.json'), JSON.stringify({ backfilled: true }))

  const session = await launchApp({ appDir: buildApp(path.join(root, 'app')), userDataDir: userData })
  t.after(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }) })
  const { app, page } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  // The real ledger is read by the main process (the broken line is skipped).
  const real = await page.evaluate(() => window.bridgeclip.spending.overview())
  assert.equal(real.summary.thisMonthUsd, 1.91)
  assert.equal(real.summary.lastMonthUsd, 2.04)
  assert.equal(real.summary.count, 5)
  assert.equal(real.limitUsd, null)

  // Stand in for a member with an OpenRouter key, a balance and a limit.
  await app.evaluate(({ ipcMain }, real) => {
    globalThis.spendTest = { overview: { ...real, openrouterConfigured: true }, balanceCalls: [], limits: [], jobCalls: 0, allowed: [] }
    ipcMain.removeHandler('spend:overview')
    ipcMain.handle('spend:overview', () => globalThis.spendTest.overview)
    ipcMain.removeHandler('spend:balance')
    ipcMain.handle('spend:balance', (_event, force) => {
      globalThis.spendTest.balanceCalls.push(force)
      return { remainingUsd: force ? 2.5 : 3.21, accountRemainingUsd: force ? 2.5 : 3.21, keyRemainingUsd: null, checkedAt: new Date().toISOString(), note: null }
    })
    ipcMain.removeHandler('spend:setLimit')
    ipcMain.handle('spend:setLimit', (_event, value) => {
      globalThis.spendTest.limits.push(value)
      if (value === 'abc') throw new Error('Enter the monthly spending limit in dollars, like 25 or 12.50, or leave it empty for no limit.')
      globalThis.spendTest.overview = { ...globalThis.spendTest.overview, limitUsd: value ? Number(value) : null }
      return globalThis.spendTest.overview
    })
  }, real)
  await page.reload()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
  // The section list is hidden on narrow windows: scroll to the section itself.
  const section = page.locator('#settings-spending')
  await section.waitFor()
  await section.scrollIntoViewIfNeeded()

  const totals = page.getByRole('group', { name: 'Spending totals' })
  await totals.getByText('$1.91', { exact: true }).waitFor()
  await totals.getByText('$2.04', { exact: true }).waitFor()
  await totals.getByText('$3.95', { exact: true }).waitFor()
  await page.getByText('These are the app’s estimates from what each provider reported', { exact: false }).waitFor()

  const byKind = page.getByRole('region', { name: 'Spending by kind' })
  await byKind.getByRole('row', { name: /Avatar Studio \$0\.16 \$2\.16/ }).waitFor()
  await byKind.getByRole('row', { name: /Remix \$1\.25 \$1\.25/ }).waitFor()

  const recent = page.getByRole('region', { name: 'Recent spending' })
  await recent.getByText('Remix videos', { exact: true }).waitFor()
  assert.equal(await recent.getByRole('listitem').count(), 5)
  assert.equal(await recent.getByText('estimate', { exact: true }).count(), 2)

  const balance = page.getByRole('region', { name: 'OpenRouter balance' })
  await balance.getByText('$3.21', { exact: true }).waitFor()
  await balance.getByRole('button', { name: 'Refresh OpenRouter balance' }).click()
  await balance.getByText('$2.50', { exact: true }).waitFor()
  assert.deepEqual(await app.evaluate(() => globalThis.spendTest.balanceCalls), [false, true])

  // The limit: a bad value is explained, a good one shows how much is used and the notice at 80%.
  const limit = page.getByLabel('Monthly AI spending limit (USD)')
  await limit.fill('abc')
  await limit.press('Enter')
  await page.getByText('Enter the monthly spending limit in dollars', { exact: false }).first().waitFor()
  await limit.fill('2')
  await limit.press('Enter')
  await page.getByText('$1.91 of $2.00 used this month', { exact: false }).waitFor()
  await page.getByText('Close to your monthly AI spending limit', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Dismiss' }).first().click().catch(() => {})

  // The check before a paid run: a low balance offers "Start anyway", which sends the run again.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('job:start')
    ipcMain.handle('job:start', () => {
      globalThis.spendTest.jobCalls++
      if (globalThis.spendTest.jobCalls === 1) {
        throw new Error('SPEND_GATE ' + JSON.stringify({ reason: 'balance', provider: 'openrouter', canOverride: true, estimateUsd: null,
          message: 'Your OpenRouter balance is about $0.40, under $1.00. It may stop partway when the credit runs out. Add credits on OpenRouter first, or start anyway.' }))
      }
      return { error: 'started' }
    })
  })
  const started = page.evaluate(() => window.bridgeclip.job.start({}))
  const dialog = page.getByRole('alertdialog', { name: 'Your OpenRouter balance is low' })
  await dialog.getByText('about $0.40', { exact: false }).waitFor()
  await dialog.getByRole('button', { name: 'Start anyway' }).click()
  assert.deepEqual(await started, { error: 'started' })
  assert.equal(await app.evaluate(() => globalThis.spendTest.jobCalls), 2)

  // Over the monthly limit there is no "Start anyway"; declining gives a plain reason.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('remix:start')
    ipcMain.handle('remix:start', () => { throw new Error('SPEND_GATE ' + JSON.stringify({ reason: 'limit', provider: 'openrouter', canOverride: false, estimateUsd: 2, message: 'This would go over your monthly AI spending limit of $2.00.' })) })
  })
  const limitCall = page.evaluate(() => window.bridgeclip.remix.start({}).then(() => 'started', (error) => error.message))
  const limitDialog = page.getByRole('alertdialog', { name: 'Over your monthly AI spending limit' })
  await limitDialog.waitFor()
  assert.equal(await limitDialog.getByRole('button', { name: 'Start anyway' }).count(), 0)
  await limitDialog.getByRole('button', { name: 'Don’t start' }).click()
  assert.match(await limitCall, /Not started: this would go over your monthly AI spending limit/)

  // A provider says the credit ran out: the same message with a link to add credits.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('spend:outOfCredits', 'openrouter'))
  await page.getByText('OpenRouter is out of credits', { exact: true }).waitFor()
  await page.getByText('Your OpenRouter account is out of credits.', { exact: false }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Add credits' }).count() >= 1, true)

  assert.deepEqual(errors, [])
})
