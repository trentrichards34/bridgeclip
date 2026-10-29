const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { editorTools } = require('./editor-e2e-tools.cjs')
const { launchRemix, shot } = require('./remix-e2e-setup.cjs')
// Avatar Studio is switched off for members (src/shared/features.ts); this test covers it, so the e2e run turns it on.
process.env.BRIDGECLIP_E2E_AVATAR_STUDIO = '1'

// Remix's AI presenter with "Avatar on camera (HeyGen, Beta)": a Voiced take whose opening and closing lines are made on a
// stand-in HeyGen API (lip-synced to the app's voice), then finished by the real engine (captions, hook text, credit) and
// saved to the Library. Only the paid AI steps (transcription, the writing calls, the voice) are stood in for.

const KEY = 'hg-e2e-key-0123456789'
const AVATAR = 'b'.repeat(16)

/** HeyGen's v3 API, just what a lip-synced line calls: the voiceover upload, the video, its status and its file. */
async function fakeHeygen(ffmpeg, encoder, dir) {
  const requests = []
  const assets = new Map(), videos = new Map()
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const url = new URL(req.url, 'http://127.0.0.1')
      requests.push({ method: req.method, path: url.pathname, key: req.headers['x-api-key'] ?? null, body })
      const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
      const file = /^\/files\/(v_\d+)\.mp4$/.exec(url.pathname)
      if (file && videos.has(file[1])) { res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end(fs.readFileSync(videos.get(file[1]).path)); return }
      if (req.headers['x-api-key'] !== KEY) return send(401, { error: { code: 'unauthorized', message: 'Invalid API key' } })
      const route = `${req.method} ${url.pathname}`
      if (route === 'POST /v3/assets') {
        // The multipart upload's one file: the voiceover, kept to lip-sync to.
        const boundary = /boundary=(.+)$/.exec(req.headers['content-type'] ?? '')[1]
        const start = body.indexOf('\r\n\r\n') + 4
        const end = body.indexOf(Buffer.from(`\r\n--${boundary}`), start)
        const id = `ast_${assets.size + 1}`
        const audio = path.join(dir, `${id}.mp3`)
        fs.writeFileSync(audio, body.subarray(start, end))
        assets.set(id, audio)
        return send(200, { data: { asset_id: id, url: 'https://files.example/asset', mime_type: 'audio/mpeg', size_bytes: end - start } })
      }
      if (route === 'POST /v3/videos') {
        const request = JSON.parse(body.toString())
        const id = `v_${videos.size + 1}`
        const out = path.join(dir, `${id}.mp4`)
        // The avatar (green), saying exactly the uploaded voiceover.
        execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x22cc44:s=1080x1920:r=30', '-i', assets.get(request.audio_asset_id),
          '-shortest', ...encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', out])
        videos.set(id, { path: out, polls: 0, request })
        return send(200, { data: { video_id: id, status: 'waiting' } })
      }
      const poll = /^GET \/v3\/videos\/(v_\d+)$/.exec(route)
      if (poll && videos.has(poll[1])) {
        const video = videos.get(poll[1])
        if (++video.polls < 2) return send(200, { data: { id: poll[1], status: 'processing' } })
        return send(200, { data: { id: poll[1], status: 'completed', video_url: `http://127.0.0.1:${server.address().port}/files/${poll[1]}.mp4` } })
      }
      send(404, { error: { code: 'resource_not_found', message: route } })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, requests, videos, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('Remix: a Voiced take with my HeyGen avatar on camera, lip-synced on HeyGen, made and in the Library', { timeout: 480000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('The stand-in Python wrapper is a shell script'); return }
  const tools = editorTools(t, { python: true, captions: true })
  if (!tools) return
  const { ffmpeg } = tools
  const scratch = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bridgeclip-heygen-api-'))
  const heygen = await fakeHeygen(ffmpeg, tools.encoder, scratch)
  t.after(async () => { await heygen.close(); fs.rmSync(scratch, { recursive: true, force: true }) })
  const { root, library, app, page, errors, dialogs } = await launchRemix(t, tools, 'remix-heygen', { BRIDGECLIP_E2E_HEYGEN_URL: heygen.url })
  const userDataDir = path.join(root, 'user-data')

  // A HeyGen photo avatar that HeyGen has finished (made in Avatar Studio), and the member's HeyGen key.
  const avatarDir = path.join(userDataDir, 'avatars', AVATAR)
  fs.mkdirSync(avatarDir, { recursive: true })
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xcc8844:s=600x900', '-frames:v', '1', path.join(avatarDir, 'portrait.jpg')])
  fs.writeFileSync(path.join(avatarDir, 'avatar.json'), JSON.stringify({
    id: AVATAR, name: 'Me on HeyGen', kind: 'self', description: '', voice: { provider: 'elevenlabs', voice: 'Brian' }, clonedVoice: null,
    consentAt: '2026-10-19T00:00:00.000Z', createdAt: '2026-10-19T00:00:00.000Z',
    heygen: { provider: 'heygen', source: 'photo', lookId: 'look_e2e', groupId: 'ag_e2e', status: 'completed', consentStatus: null, consentUrl: null, consentUrlAt: null,
      voiceId: null, voice: 'app', engines: ['avatar_iv'], error: null, checkedAt: '2026-10-19T00:00:00.000Z' }
  }))
  await page.evaluate((key) => window.bridgeclip.settings.replaceApiKey('heygenApiKey', key), KEY)
  await page.reload()

  // Their long video (40 s, a tone), chosen as a file.
  const source = path.join(root, 'coach-podcast.mp4')
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=40', '-f', 'lavfi', '-i', 'sine=frequency=220:d=40',
    ...tools.encoder, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source])
  await dialogs([source])

  await page.getByRole('button', { name: 'Remix', exact: true }).first().click()
  await page.getByRole('radiogroup', { name: 'Who is in the video' }).getByRole('radio', { name: /^AI presenter/ }).click()
  await page.getByRole('radiogroup', { name: 'Remix format' }).getByRole('radio', { name: /^Voiced take/ }).click()
  await page.getByRole('button', { name: 'Or choose a file' }).click()
  await page.getByText('coach-podcast.mp4').waitFor()
  await page.getByPlaceholder('e.g. @theircreator').fill('Coach Example')
  const presenter = page.getByRole('radiogroup', { name: 'Presenter' })
  const onCamera = presenter.getByRole('radio', { name: /Avatar on camera \(HeyGen, Beta\)/ })
  assert.equal(await onCamera.isDisabled(), false, 'a ready HeyGen avatar and a key: available')
  await onCamera.click()
  await page.getByText('Your realistic avatar says the take, lip-synced').waitFor()
  await page.getByText(/HeyGen lip-syncs your avatar to the voice for the opening and closing lines\. HeyGen bills it on your HeyGen account/).waitFor()
  await page.getByRole('radiogroup', { name: 'Avatar' }).getByText('Me on HeyGen · HeyGen').waitFor()
  // Every price is an estimate, with the date each was checked (HeyGen's own, once it's used).
  assert.equal(await page.getByTestId('price-note').innerText(),
    'All prices here are estimates: OpenRouter prices checked October 2026, HeyGen’s $0.10 per second checked October 19, 2026. What your accounts bill is what counts.')
  await page.getByRole('checkbox', { name: "I'll turn on the AI-content label when I post" }).click()
  if (process.env.BRIDGECLIP_E2E_SHOTS) { await presenter.scrollIntoViewIfNeeded(); await shot(app, 'remix-heygen-presenter.png') }
  await page.getByRole('button', { name: 'Write the takes', exact: true }).click()

  // Review the one take, then make it: HeyGen makes the opening and closing lines while progress says what HeyGen is doing.
  await page.getByRole('heading', { name: /Review your takes/ }).waitFor({ timeout: 120000 })
  await page.getByRole('button', { name: /^Make 1 remix/ }).click()
  await page.getByText(/opening line: |closing line: /).first().waitFor({ timeout: 120000 })
  await page.getByText(/^1 remix ready/).waitFor({ timeout: 300000 })

  // What HeyGen was asked for: two 9:16 videos of the avatar, each lip-synced to an uploaded voiceover.
  const calls = heygen.requests.filter((item) => !item.path.startsWith('/files/'))
  assert.ok(calls.every((item) => item.key === KEY))
  const made = [...heygen.videos.values()].map((video) => video.request)
  assert.equal(made.length, 2)
  for (const request of made) assert.deepEqual([request.avatar_id, request.aspect_ratio, typeof request.audio_asset_id, request.script], ['look_e2e', '9:16', 'string', undefined])
  assert.equal(calls.filter((item) => item.path === '/v3/assets').length, 2)

  // In the Library, with the avatar's lines from HeyGen (green), credited and captioned.
  const run = fs.readdirSync(library).find((name) => name.startsWith('remix-'))
  const job = JSON.parse(fs.readFileSync(path.join(library, run, 'job_output.json'), 'utf8'))
  assert.equal(job.clips[0].headline, 'This coach says you must lose weight first')
  assert.equal(job.clips[0].ai_generated, true)
  const manifest = JSON.parse(fs.readFileSync(path.join(library, run, 'clip_00.source.json'), 'utf8'))
  assert.deepEqual([manifest.presenter.mode, manifest.presenter.provider, manifest.models.avatar], ['lipsync', 'heygen', 'heygen'])
  assert.ok(!manifest.warnings.some((warning) => /photo/.test(warning)), manifest.warnings)
  const file = path.join(library, run, 'clip_00.mp4')
  const host = manifest.timeline.find((part) => part.part === 'host')
  const at = (host.start_seconds + host.seconds / 2).toFixed(2)
  const pixel = execFileSync(ffmpeg, ['-v', 'error', '-ss', at, '-i', file, '-frames:v', '1', '-vf', 'crop=100:100:490:1300,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).subarray(0, 3)
  assert.ok(pixel[1] > 150 && pixel[0] < 100, `the avatar from HeyGen is on screen: ${[...pixel]}`)
  const frames = process.env.BRIDGECLIP_E2E_FRAMES
  if (frames) {
    fs.mkdirSync(frames, { recursive: true })
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', at, '-i', file, '-frames:v', '1', path.join(frames, 'remix-heygen-opening.png')])
  }

  // Spending: each HeyGen line at HeyGen's published price, as Remix, marked as estimates.
  const ledger = fs.readFileSync(path.join(userDataDir, 'spending', 'ledger.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  // Each video is recorded when HeyGen accepts it, then replaced by its final figure (the same ref): two videos, not four charges.
  const raw = ledger.filter((entry) => entry.provider === 'heygen')
  assert.equal(raw.length, 4)
  const lines = [...new Map(raw.map((entry) => [entry.ref, entry])).values()]
  assert.equal(lines.length, 2)
  assert.ok(lines.every((entry) => /^heygen:/.test(entry.ref)))
  assert.ok(lines.every((entry) => entry.kind === 'remix' && entry.label === 'HeyGen avatar video' && entry.estimated === true && entry.usd > 0))
  await page.getByText(/HeyGen made 2 avatar videos for these remixes: about \$\d+\.\d\d on your HeyGen account/).waitFor()
  if (process.env.BRIDGECLIP_E2E_SHOTS) await shot(app, 'remix-heygen-done.png')
  assert.deepEqual(errors, [])
})
