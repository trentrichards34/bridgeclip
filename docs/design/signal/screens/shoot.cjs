const { chromium } = require('/home/claude/bridgeclip/node_modules/playwright-core')
;(async () => {
  const b = await chromium.launch({ executablePath: require('fs').existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined })
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const V = process.env.S + '/vendor/node_modules/'
  await p.route('https://unpkg.com/**', (r) => { const u = r.request().url(); const f = u.includes('react-dom') ? V + 'react-dom/umd/react-dom.production.min.js' : u.includes('babel') ? V + '@babel/standalone/babel.min.js' : V + 'react/umd/react.production.min.js'; r.fulfill({ path: f, contentType: 'application/javascript' }) })
  await p.route('https://fonts.**', (r) => r.fulfill({ body: '', contentType: 'text/css' }))
  p.on('pageerror', e => console.log('ERR', e.message))
  await p.goto('file://' + process.env.S + '/design-signal/CreatorClips Signal.dc.html')
  await p.waitForTimeout(4000)
  await p.screenshot({ path: process.env.S + '/shots/00-create.png' })
  const names = ['Edit my recording','Remix','Avatar Studio','Library','Jobs','Chat','B-roll library','Brand look']
  let i = 1
  for (const n of names) {
    try { await p.getByText(n, { exact: true }).first().click({ timeout: 3000 }); await p.waitForTimeout(1200); await p.screenshot({ path: `${process.env.S}/shots/${String(i).padStart(2,'0')}-${n.replace(/\W+/g,'-').toLowerCase()}.png` }) } catch (e) { console.log('fail', n, e.message.split('\n')[0]) }
    i++
  }
  await b.close()
})()
