const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { editorTools } = require('./editor-e2e-tools.cjs')
const { launchRemix, shot } = require('./remix-e2e-setup.cjs')

// A member makes "Their clip, then me" from a reel file and a phone video of their take. The real engine fetches the
// reel, makes and frames it; only the paid AI steps (transcription and the writing call) are stood in for.

test('Their clip, then me: You on camera, a short clip trimmed, an uploaded take, the hook text written, made and in the Library', { timeout: 480000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const { root, library, app, page, errors, dialogs } = await launchRemix(t, tools, 'clip-then-me')
  // Their reel (tall, 10 s, a tone) and the member's take (9 s, a different tone).
  const reel = path.join(root, 'skincare-reel.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30:d=10', '-f', 'lavfi', '-i', 'sine=frequency=1000:d=10',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', reel])
  const take = path.join(root, 'my-take.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x406080:s=360x640:r=30:d=9', '-f', 'lavfi', '-i', 'sine=frequency=300:d=9',
    '-vf', 'drawbox=x=120:y=180:w=120:h=200:color=0xe0b090:t=fill', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', take])
  await dialogs([reel, take])

  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  // Two big choices first; "You on camera" lists only the real-person templates.
  const who = page.getByRole('radiogroup', { name: 'Who is in the video' })
  await who.getByRole('radio', { name: /^You on camera/ }).click()
  const labels = await page.getByRole('radiogroup', { name: 'Remix format' }).getByRole('radio').allInnerTexts()
  assert.deepEqual(labels.map((text) => text.split('\n')[0]), ['Pause & react', 'Their clip, then me', 'React, then my thoughts', 'Moment + my take', 'Article or post',
    'Green screen over their video', 'Scripted take'])
  await page.getByRole('radio', { name: /^Their clip, then me/ }).click()
  await page.getByRole('heading', { name: '2 · Their clip' }).waitFor()
  if (process.env.BRIDGECLIP_E2E_SHOTS) { await who.scrollIntoViewIfNeeded(); await shot(app, 'remix-top-on-camera.png') }
  // The AI side: only the avatar and voice templates, marked Beta.
  await who.getByRole('radio', { name: /^AI presenter/ }).click()
  assert.deepEqual((await page.getByRole('radiogroup', { name: 'Remix format' }).getByRole('radio').allInnerTexts()).map((text) => text.split('\n')[0]), ['Voiced take', 'React to a clip'])
  if (process.env.BRIDGECLIP_E2E_SHOTS) await shot(app, 'remix-top-ai-presenter.png')
  // Back on camera, the last template picked there comes back.
  await who.getByRole('radio', { name: /^You on camera/ }).click()
  assert.equal(await page.getByRole('radio', { name: /^Their clip, then me/ }).getAttribute('aria-checked'), 'true')
  assert.equal(await page.getByRole('radiogroup', { name: 'Presenter' }).count(), 0)
  assert.equal(await page.getByRole('checkbox', { name: "I'll turn on the AI-content label when I post" }).count(), 0)
  assert.match(await page.getByTestId('look-summary').innerText(), /^As filmed · /)
  const next = page.getByRole('button', { name: 'Continue to recording' })
  assert.equal(await next.isDisabled(), true)
  await page.getByRole('button', { name: 'Or choose a file' }).click()
  await page.getByText('skincare-reel.mp4').waitFor()
  await page.getByPlaceholder('e.g. @theircreator').fill('@skincoach')
  await page.getByRole('checkbox', { name: "I'm allowed to use this video" }).check()
  await next.click()

  // Their clip is ready (no AI): choose the part (1 s to 7 s), then upload the take; the hook text is written straight away.
  await page.getByRole('heading', { name: 'Your clip, then you' }).waitFor({ timeout: 90000 })
  await page.getByLabel('Start of the part').waitFor()
  await page.evaluate(() => window.bridgeclip.remix.trim(0, 1000, 7000))
  await page.getByText(/^6\.0s of their video \(up to 3 minutes\)\./).waitFor()
  const make = page.getByRole('button', { name: 'Make the video' })
  assert.equal(await make.isDisabled(), true)
  await page.getByRole('button', { name: 'Upload a phone video' }).click()
  const hook = page.getByLabel('Hook text, your video')
  await hook.waitFor({ timeout: 120000 })
  assert.equal(await hook.inputValue(), 'He says 15 billion scam ads run every day')
  await page.getByText(/^You said: “Honestly that number scared me/).waitFor()
  if (process.env.BRIDGECLIP_E2E_SHOTS) { await page.getByRole('heading', { name: 'Your clip, then you' }).scrollIntoViewIfNeeded(); await shot(app, 'clip-then-me-review.png') }
  await hook.fill('This serum changed her skin in a week? Not mine')

  await make.click()
  await page.getByText(/^1 remix ready/).waitFor({ timeout: 300000 })
  const run = fs.readdirSync(library).find((name) => name.startsWith('remix-'))
  const job = JSON.parse(fs.readFileSync(path.join(library, run, 'job_output.json'), 'utf8'))
  assert.equal(job.clips[0].headline, 'This serum changed her skin in a week? Not mine')
  assert.ok(job.clips[0].editable && job.clips[0].ai_generated === false && job.clips[0].description === 'Original: @skincoach')
  assert.deepEqual(job.metrics.remix_kinds, ['camera'])
  const manifest = JSON.parse(fs.readFileSync(path.join(library, run, 'clip_00.source.json'), 'utf8'))
  assert.equal(manifest.format, 'clip_then_me')
  assert.deepEqual(manifest.source.trim, { start_seconds: 1, end_seconds: 7 })
  const file = path.join(library, run, 'clip_00.mp4')
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString())
  assert.ok(Math.abs(seconds - 15) < 0.4, `their 6 s clip, then the 9 s take (${seconds}s)`)
  if (process.env.BRIDGECLIP_E2E_SHOTS) {
    for (const at of [2, 6.5, 12]) execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', path.join(process.env.BRIDGECLIP_E2E_SHOTS, `clip-then-me-${at}s.png`)])
  }

  // In the Library: "Edit hook text & captions" is there.
  await page.getByRole('button', { name: /^Library/ }).first().click()
  await page.getByRole('button', { name: /^Open Remix · skincare-reel/ }).first().click()
  await page.getByRole('button', { name: /^Actions for “This serum changed her skin/ }).first().click()
  await page.getByRole('menuitem', { name: 'Edit hook text & captions', exact: true }).waitFor()
  assert.deepEqual(errors, [])
})
