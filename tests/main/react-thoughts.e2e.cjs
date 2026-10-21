const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { editorTools } = require('./editor-e2e-tools.cjs')
const { launchRemix, shot } = require('./remix-e2e-setup.cjs')

// A member makes "React, then my thoughts" from a product ad: a phone video of them watching it (the ad playing out loud,
// so it's lined up by sound), a phone video of their thoughts, and two of their own b-roll files. The real engine
// assembles it; only the paid AI steps (transcription, writing, the b-roll plan) are stood in for.

test('React, then my thoughts: both parts uploaded, your b-roll added, planned, changed, made and in the Library', { timeout: 600000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const { root, library, app, page, errors, dialogs } = await launchRemix(t, tools, 'react-thoughts')
  const make = (name, args) => { const file = path.join(root, name); execFileSync(ffmpeg, ['-v', 'error', '-y', ...args, file]); return file }
  // The ad: a moving pattern with a rhythmic "voice" (8 s).
  const ad = make('serum-ad.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=8', '-f', 'lavfi', '-i', "anoisesrc=c=pink:seed=3:a=0.35:r=48000,volume='0.3+0.7*abs(sin(PI*3*t))':eval=frame,atrim=duration=8",
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'])
  // Watching it on the phone: the ad heard out loud from 1.5 s in.
  const watching = make('me-watching.mp4', ['-f', 'lavfi', '-i', 'color=c=0x305070:s=360x640:r=30:d=11', '-i', ad,
    '-filter_complex', '[1:a]adelay=1500|1500,volume=0.6,apad=whole_dur=11[a];[0:v]drawbox=x=100:y=420:w=160:h=200:color=0xe0b090:t=fill[v]',
    '-map', '[v]', '-map', '[a]', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '11'])
  const thoughts = make('my-thoughts.mp4', ['-f', 'lavfi', '-i', 'color=c=0x406080:s=360x640:r=30:d=10', '-f', 'lavfi', '-i', 'sine=frequency=300:d=10',
    '-vf', 'drawbox=x=120:y=180:w=120:h=200:color=0xe0b090:t=fill', ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'])
  const car = make('red-car.mp4', ['-f', 'lavfi', '-i', 'color=c=0xd02020:s=640x360:r=30:d=1', ...tools.encoder, '-pix_fmt', 'yuv420p'])
  const cream = make('cream.png', ['-f', 'lavfi', '-i', 'color=c=0xe6c81e:s=400x300:d=1', '-frames:v', '1'])
  // A screen recording of the tool for part 2 (a voiceover over it), and a proof screenshot.
  const screen = make('tool-demo.mp4', ['-f', 'lavfi', '-i', 'color=c=0xf0f0f0:s=640x360:r=30:d=6', '-vf', 'drawbox=x=40:y=40:w=200:h=60:color=0x2050d0:t=fill', ...tools.encoder, '-pix_fmt', 'yuv420p'])
  const result = make('result.png', ['-f', 'lavfi', '-i', 'color=c=0x1ec8dc:s=900x500:d=1', '-frames:v', '1'])
  await dialogs([ad, watching, thoughts, [car, cream], screen, [result]])

  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByRole('radiogroup', { name: 'Who is in the video' }).getByRole('radio', { name: /^You on camera/ }).click()
  await page.getByRole('radio', { name: /^React, then my thoughts/ }).click()
  await page.getByRole('heading', { name: '2 · Their clip' }).waitFor()
  await page.getByText(/^Part 1: their clip plays in a big box/).waitFor()
  await page.getByRole('button', { name: 'Or choose a file' }).click()
  await page.getByText('serum-ad.mp4').waitFor()
  await page.getByPlaceholder('e.g. @theircreator').fill('@serumbrand')
  await page.getByRole('checkbox', { name: "I'm allowed to use this video" }).check()
  // Part 1 as a phone card: you fill the frame, their clip floats in the lower right, the hook text beside you.
  await page.getByRole('button', { name: /Look & call to action/ }).click()
  await page.getByRole('radiogroup', { name: 'While you react' }).getByRole('radio', { name: /^Phone card/ }).click()
  assert.equal(await page.getByRole('radiogroup', { name: 'Where the hook text goes' }).getByRole('radio', { name: 'Beside me' }).getAttribute('aria-checked'), 'true')
  if (process.env.BRIDGECLIP_E2E_SHOTS) { await page.getByRole('radiogroup', { name: 'Who is in the video' }).scrollIntoViewIfNeeded(); await shot(app, 'remix-top-react-thoughts.png') }
  await page.getByRole('button', { name: 'Continue to recording' }).click()

  const heading = page.getByRole('heading', { name: 'Your React, then my thoughts' })
  await heading.waitFor({ timeout: 90000 })
  const part1 = page.getByRole('region', { name: 'Part 1 · Watch & react' })
  const part2 = page.getByRole('region', { name: 'Part 2 · Your thoughts' })
  const broll = page.getByRole('region', { name: 'Your b-roll' })
  const makeButton = page.getByRole('button', { name: 'Make the video' })
  assert.equal(await makeButton.isDisabled(), true)
  await part1.getByRole('button', { name: 'Upload a phone video' }).click()
  await part1.getByText(/^Phone video uploaded/).waitFor({ timeout: 60000 })
  // Part 2 too: with both recorded, the hook text and caption are written straight away (no b-roll yet, so none is planned).
  await part2.getByRole('button', { name: 'Upload a phone video' }).click()
  const hook = page.getByLabel('Hook text, your video')
  await hook.waitFor({ timeout: 120000 })
  assert.equal(await hook.inputValue(), 'He says 15 billion scam ads run every day')
  await broll.getByText('No b-roll: you’re on screen the whole time.').waitFor()
  // The chat's chips fit this format (part 2 can't be trimmed here), and graphics name the part they go on.
  const chat = page.getByRole('region', { name: 'Chat' })
  await chat.getByRole('button', { name: 'Punchier hook' }).waitFor()
  assert.equal(await chat.getByRole('button', { name: 'Make my part shorter' }).count(), 0)
  await page.getByRole('region', { name: 'Graphics on your part' }).getByText(/Animated cards over “Part 2 · Your thoughts”/).waitFor()

  // Your b-roll: a clip and a picture (the dialog opens from the button, as it does for a drop); then planned over your words.
  await broll.getByRole('button', { name: 'Add clips or pictures' }).click()
  await broll.getByText('red-car.mp4').waitFor()
  await broll.getByText('cream.png').waitFor()
  await broll.getByRole('button', { name: 'Plan my b-roll again' }).click()
  const plan = broll.getByRole('list', { name: 'B-roll plan' })
  await plan.getByRole('listitem').nth(1).waitFor({ timeout: 90000 })
  assert.equal(await plan.getByRole('listitem').count(), 2)
  assert.match(await plan.getByRole('listitem').first().innerText(), /^2\.0s–3\.6s/)
  // Swap the second shot to the car clip, then remove the first: one shot left, the car at 4.8 s.
  await broll.getByLabel('Clip for the shot at 4.8s').selectOption({ label: 'red-car.mp4' })
  await page.waitForFunction(() => window.bridgeclip.remix.brollView().then((view) => view.plan?.[1]?.item === view.items[0].id))
  await broll.getByRole('button', { name: 'Remove the shot at 2.0s' }).click()
  await page.waitForFunction(() => window.bridgeclip.remix.brollView().then((view) => view.plan?.length === 1))
  // Stock footage needs a Pexels key: the review says so and links to it.
  await broll.getByRole('switch', { name: 'Fill gaps with stock footage' }).click()
  await broll.getByRole('button', { name: 'Add it in Settings → API keys' }).waitFor()
  await broll.getByRole('switch', { name: 'Fill gaps with stock footage' }).click()
  await broll.getByRole('button', { name: 'Add it in Settings → API keys' }).waitFor({ state: 'detached' })
  if (process.env.BRIDGECLIP_E2E_SHOTS) { await broll.scrollIntoViewIfNeeded(); await shot(app, 'react-thoughts-review.png') }

  // Part 2 as a voiceover over a screen recording, with a circle at 1 s; a proof screenshot labeled "Result".
  const part2Look = page.getByRole('region', { name: 'How part 2 looks' })
  await part2Look.getByRole('radio', { name: 'Voiceover over a screen recording' }).click()
  await part2Look.getByText('tool-demo.mp4').waitFor()
  await part2Look.getByText(/Only your voice is used|Your screen recording fills the screen/).first().waitFor()
  await page.evaluate(() => window.bridgeclip.remix.setLayout({ circles: [{ at: 1, x: 0.2, y: 0.2 }] }))
  const proofs = page.getByRole('region', { name: 'Proof screenshots' })
  await proofs.getByRole('button', { name: 'Add screenshots' }).click()
  await proofs.getByText('result.png').waitFor()
  await proofs.getByLabel('Label for result.png').selectOption('Result')
  await proofs.getByLabel('Time for result.png').fill('5')
  await proofs.getByLabel('Time for result.png').blur()
  await page.waitForFunction(() => window.bridgeclip.remix.layoutView().then((view) => view?.proofs[0]?.at === 5 && view.proofs[0].label === 'Result'))
  if (process.env.BRIDGECLIP_E2E_SHOTS) { await part2Look.scrollIntoViewIfNeeded(); await shot(app, 'react-thoughts-part2-look.png') }

  await hook.fill('This serum changed her skin in a week? Not mine')
  await makeButton.click()
  await page.getByText(/^1 remix ready/).waitFor({ timeout: 300000 })
  const run = fs.readdirSync(library).find((name) => name.startsWith('remix-'))
  const job = JSON.parse(fs.readFileSync(path.join(library, run, 'job_output.json'), 'utf8'))
  assert.equal(job.clips[0].headline, 'This serum changed her skin in a week? Not mine')
  assert.ok(job.clips[0].editable && job.clips[0].ai_generated === false && job.clips[0].description === 'Original: @serumbrand')
  const manifest = JSON.parse(fs.readFileSync(path.join(library, run, 'clip_00.source.json'), 'utf8'))
  assert.equal(manifest.format, 'react_thoughts')
  const info = manifest.presenter.react_thoughts
  assert.deepEqual(info.broll.map((shot) => [shot.source, shot.name, shot.seconds]), [['yours', 'red-car.mp4', 1.6]])
  assert.ok(Math.abs(info.clip_seconds - 8) < 0.1 && Math.abs(info.thoughts_seconds - 10) < 0.2, JSON.stringify(info))
  assert.deepEqual([info.part1, info.part2, info.circles, info.proofs.map((item) => item.label)], ['phone', 'screen', 1, ['Result']])
  // The run's copies of the b-roll are gone once it's made.
  assert.equal(fs.existsSync(path.join(library, run, '.broll')), false)
  const file = path.join(library, run, 'clip_00.mp4')
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString())
  assert.ok(Math.abs(seconds - 18) < 0.4, `their 8 s clip, then 10 s of thoughts (${seconds}s)`)
  if (process.env.BRIDGECLIP_E2E_SHOTS) {
    for (const at of [3, 8 + 1.5, 8 + 5.5]) execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', path.join(process.env.BRIDGECLIP_E2E_SHOTS, `react-thoughts-${at}s.png`)])
  }
  await page.getByRole('button', { name: /^Library/ }).first().click()
  await page.getByRole('button', { name: /^Open Remix · serum-ad/ }).first().click()
  await page.getByRole('button', { name: /^Actions for “This serum changed her skin/ }).first().click()
  await page.getByRole('menuitem', { name: 'Edit hook text & captions', exact: true }).waitFor()
  assert.deepEqual(errors, [])
})
