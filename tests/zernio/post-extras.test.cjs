'use strict'
// Cover frames and YouTube captions: checks, frame extraction, subtitle
// discovery, the POST /v1/posts fields per platform, and the whole flow
// against the mock Zernio (uploads reused on a retry).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { createMockZernio } = require('./support/mock-zernio.cjs')
const { createPostingMock } = require('./support/mock-posts.cjs')
const { loadMain, tempDir, fakeElectron, ROOT } = require('./support/load-main.cjs')

const KEY = 'test-zernio-extras-key'
const FFMPEG = fs.existsSync(path.join(ROOT, 'engine-bin', 'ffmpeg')) ? path.join(ROOT, 'engine-bin', 'ffmpeg') : 'ffmpeg'
const SRT = '1\n00:00:00,000 --> 00:00:01,500\nWhy agents need tests\n\n2\n00:00:01,500 --> 00:00:03,000\nBecause they guess.\n'

const pure = loadMain(`
  export * as extras from './src/shared/zernio-extras'
  export * as payload from './src/main/zernio/posts-payload'
  export * as files from './src/main/zernio/post-extras'
`, { electron: {} })
const { extras, payload, files } = pure

function makeClip(file, { seconds = 4, width = 360, height = 640 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:d=${seconds}:r=15`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-shortest', '-c:v', 'mpeg4', '-q:v', '8', '-c:a', 'aac', '-movflags', '+faststart', file])
  return file
}

// ---- Which platforms take a cover ---------------------------------------------

test('cover support follows the Zernio API: TikTok and Instagram by time, Facebook, LinkedIn and regular YouTube by image', () => {
  assert.deepEqual(extras.coverSupport('tiktok', true), { supported: true, frameAs: 'timestamp', reason: null })
  assert.deepEqual(extras.coverSupport('instagram', true), { supported: true, frameAs: 'timestamp', reason: null })
  assert.equal(extras.coverSupport('facebook', true).frameAs, 'image')
  assert.equal(extras.coverSupport('linkedin', true).frameAs, 'image')
  assert.equal(extras.coverSupport('youtube', false).frameAs, 'image')
  assert.match(extras.coverSupport('youtube', true).reason, /Shorts/)
  assert.equal(extras.coverSupport('twitter', false).supported, false)
  assert.equal(extras.coverSupport('threads', false).supported, false)
  const split = extras.coverPlatforms(['tiktok', 'youtube', 'twitter', 'tiktok'], true)
  assert.deepEqual(split.supported, ['tiktok'])
  assert.deepEqual(split.unsupported.map((u) => u.platform), ['youtube', 'twitter'])
})

test('YouTube Shorts: vertical clips up to 3 minutes, and unknown clips are treated as Shorts', () => {
  assert.equal(extras.postsAsYouTubeShort({ durationMs: 60_000, width: 1080, height: 1920 }), true)
  assert.equal(extras.postsAsYouTubeShort({ durationMs: 181_000, width: 1080, height: 1920 }), false)
  assert.equal(extras.postsAsYouTubeShort({ durationMs: 60_000, width: 1920, height: 1080 }), false)
  assert.equal(extras.postsAsYouTubeShort({ durationMs: null, width: 1920, height: 1080 }), true)
})

test('cover frame times must be whole milliseconds inside the clip; suggested frames are the hook and the middle', () => {
  assert.equal(extras.coverFrameError(1000, 4000), null)
  assert.equal(extras.coverFrameError(4000, 4000), null)
  for (const bad of [-1, 4001, 1.5, NaN, '1000', null]) assert.ok(extras.coverFrameError(bad, 4000), String(bad))
  assert.deepEqual(extras.suggestedCoverFrames(30_000), [{ label: 'Hook', atMs: 1000 }, { label: 'Middle', atMs: 15_000 }])
  assert.deepEqual(extras.suggestedCoverFrames(2000), [{ label: 'Hook', atMs: 500 }, { label: 'Middle', atMs: 1000 }])
  assert.deepEqual(extras.suggestedCoverFrames(null), [{ label: 'Opening', atMs: 0 }])
})

test('cover images are recognized by their bytes', () => {
  assert.equal(extras.coverImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(extras.coverImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png')
  assert.equal(extras.coverImageType(Buffer.from('GIF89a')), null)
  assert.equal(extras.coverImageType(Buffer.from('<svg')), null)
})

// ---- Frame extraction -------------------------------------------------------------

test('frame extraction: seeks before the input, limits demuxers, never overwrites, and checks its inputs', () => {
  const args = files.coverFrameArgs('/lib/run/clip_00.mp4', 1250, '/tmp/x/cover.jpg')
  assert.deepEqual(args.slice(0, 5), ['-v', 'error', '-n', '-ss', '1.250'])
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'), 'input seek')
  assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'file,pipe,fd')
  assert.equal(args[args.indexOf('-frames:v') + 1], '1')
  assert.equal(args.at(-1), '/tmp/x/cover.jpg')
  assert.throws(() => files.coverFrameArgs('/lib/clip.mp4', -1, '/tmp/c.jpg'), /time/)
  assert.throws(() => files.coverFrameArgs('/lib/clip.mp4', 1.5, '/tmp/c.jpg'), /time/)
  assert.throws(() => files.coverFrameArgs('clip.mp4', 0, '/tmp/c.jpg'), /path/)
  assert.throws(() => files.coverFrameArgs('/lib/clip.mp4', 0, '/tmp/c.png'), /JPEG/)
})

test('frame extraction writes a full-size JPEG of the clip into a temp folder it removes', async () => {
  const { dir, cleanup } = tempDir()
  const previousPath = process.env.PATH
  process.env.PATH = `${previousPath}${path.delimiter}${path.join(ROOT, 'engine-bin')}`
  try {
    const clip = makeClip(path.join(dir, 'clip_00.mp4'))
    const { extractCoverFrame } = loadMain("export { extractCoverFrame } from './src/main/zernio/post-extras'", { electron: fakeElectron(dir).electron })
    const frame = await extractCoverFrame(clip, 1500)
    assert.equal(extras.coverImageType(frame.bytes), 'image/jpeg')
    // The JPEG keeps the clip's 360x640 size (SOF0 holds height then width).
    const sof = frame.bytes.findIndex((byte, i) => byte === 0xff && [0xc0, 0xc2].includes(frame.bytes[i + 1]))
    assert.equal(frame.bytes.readUInt16BE(sof + 5), 640)
    assert.equal(frame.bytes.readUInt16BE(sof + 7), 360)
    await frame.cleanup()
    await assert.rejects(extractCoverFrame(path.join(dir, 'missing.mp4'), 0), /Couldn’t take that frame/)
  } finally {
    process.env.PATH = previousPath
    cleanup()
  }
})

// ---- Subtitles ----------------------------------------------------------------------

test('subtitle discovery: the run’s captions_srt first, else clip_NN.srt beside the clip, only inside the run folder', async () => {
  const { dir, cleanup } = tempDir()
  try {
    const run = path.join(dir, 'run')
    fs.mkdirSync(path.join(run, 'subs'), { recursive: true })
    const clip = path.join(run, 'clip_01.mp4')
    fs.writeFileSync(clip, 'video')
    assert.equal(files.findClipSubtitles(clip), null)

    fs.writeFileSync(path.join(run, 'clip_01.srt'), SRT)
    assert.deepEqual(files.findClipSubtitles(clip), { path: path.join(run, 'clip_01.srt'), format: 'srt', language: null })

    const writeOutput = (clipFields, root = {}) => fs.writeFileSync(path.join(run, 'job_output.json'), JSON.stringify({ ...root, clips: [{ clip_index: 1, s3_url: `file://${clip}`, ...clipFields }] }))
    fs.writeFileSync(path.join(run, 'subs', 'one.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.500\nHello\n')
    writeOutput({ captions_srt: 'subs/one.vtt', captions_language: 'es' })
    assert.deepEqual(files.findClipSubtitles(clip), { path: path.join(run, 'subs', 'one.vtt'), format: 'vtt', language: 'es' })
    writeOutput({ captions_srt: path.join(run, 'subs', 'one.vtt') }, { caption_language: 'pt-BR' })
    assert.equal(files.findClipSubtitles(clip).language, 'pt-BR')

    // A recorded path outside the run folder, a symlink or another type falls back to the conventional file.
    fs.writeFileSync(path.join(dir, 'outside.srt'), SRT)
    writeOutput({ captions_srt: '../outside.srt' })
    assert.equal(files.findClipSubtitles(clip).path, path.join(run, 'clip_01.srt'))
    fs.symlinkSync(path.join(dir, 'outside.srt'), path.join(run, 'subs', 'link.srt'))
    writeOutput({ captions_srt: 'subs/link.srt', captions_language: 'english' })
    assert.deepEqual(files.findClipSubtitles(clip), { path: path.join(run, 'clip_01.srt'), format: 'srt', language: null })
    writeOutput({ captions_srt: 'clip_01.txt' })
    assert.equal(files.findClipSubtitles(clip).path, path.join(run, 'clip_01.srt'))
    // A symlinked subfolder pointing outside the run doesn't count either.
    fs.mkdirSync(path.join(dir, 'elsewhere'))
    fs.writeFileSync(path.join(dir, 'elsewhere', 'escape.srt'), SRT)
    fs.symlinkSync(path.join(dir, 'elsewhere'), path.join(run, 'linked'))
    writeOutput({ captions_srt: 'linked/escape.srt' })
    assert.equal(files.findClipSubtitles(clip).path, path.join(run, 'clip_01.srt'))

    assert.deepEqual(await files.describeClipSubtitles(clip), { found: true, fileName: 'clip_01.srt', language: null })
    // Captions as spoken: the language the run detected; a translation's language wins.
    writeOutput({ spoken_language: 'fr' })
    assert.equal(files.findClipSubtitles(clip).language, 'fr')
    writeOutput({ spoken_language: 'fr', caption_language: 'es' })
    assert.equal(files.findClipSubtitles(clip).language, 'es')
  } finally { cleanup() }
})

test('subtitle files are checked before upload: SRT cues, UTF-8, at most 1 MB', async () => {
  const { dir, cleanup } = tempDir()
  try {
    const file = path.join(dir, 'clip_00.srt')
    const read = (contents) => { fs.writeFileSync(file, contents); return files.readSubtitles({ path: file, format: 'srt', language: null }) }
    const ok = await read(`\uFEFF${SRT}`)
    assert.equal(ok.contentType, 'application/x-subrip')
    assert.equal(ok.fileName, 'clip_00.srt')
    await assert.rejects(read(''), /empty/)
    await assert.rejects(read('just some words\n'), /no SRT cues/)
    await assert.rejects(read(Buffer.from([0x31, 0x0a, 0xc3, 0x28])), /UTF-8/)
    await assert.rejects(read(`${SRT}${'x'.repeat(1024 * 1024)}`), /over 1 MB/)
    assert.match(extras.subtitleTextError('00:00.000 --> 00:01.000\nHi', 'vtt'), /WebVTT/)
    assert.equal(extras.subtitleTextError('WEBVTT\n\n00:00.000 --> 00:01.000\nHi', 'vtt'), null)
    assert.equal(extras.isSubtitleLanguage('en'), true)
    assert.equal(extras.isSubtitleLanguage('pt-BR'), true)
    for (const bad of ['EN', 'eng', 'en-us', 'en_US', '', null]) assert.equal(extras.isSubtitleLanguage(bad), false, String(bad))
  } finally { cleanup() }
})

// ---- Payload --------------------------------------------------------------------------

const A = (c) => c.repeat(24)
const TIKTOK = { privacyLevel: 'PUBLIC_TO_EVERYONE', allowComment: true, allowDuet: false, allowStitch: false }
const TIKTOK_OPTIONS = { accounts: { [A('t')]: TIKTOK }, disclose: false, yourBrand: false, brandedContent: false, madeWithAi: false, draft: false, consent: true }
function request(options, targets = ['tiktok', 'instagram', 'facebook', 'youtube', 'twitter']) {
  return payload.parsePostClipRequest({
    attemptId: 'attempt-0001-cover', clipPath: '/library/run/clip_01.mp4', clipTitle: 'Clip', durationMs: 4000, caption: 'Caption',
    targets: targets.map((platform) => ({ platform, accountId: A(platform[0]) })),
    timing: { mode: 'now' },
    options: { tiktok: TIKTOK_OPTIONS, youtube: { title: 'Clip', visibility: 'public', madeForKids: false }, facebook: { format: 'reel' }, ...options }
  })
}
const VIDEO = 'https://media.zernio.com/temp/clip.mp4'
const IMAGE = 'https://media.zernio.com/temp/cover.jpg'
const SUBS = 'https://media.zernio.com/temp/clip_01.srt'
const entry = (body, platform) => body.platforms.find((p) => p.platform === platform)

test('cover requests are checked: a frame time or a JPG/PNG path', () => {
  assert.deepEqual(request({ cover: { kind: 'frame', atMs: 1200 } }).options.cover, { kind: 'frame', atMs: 1200 })
  assert.deepEqual(request({ cover: { kind: 'image', path: '/pics/cover.PNG' } }).options.cover, { kind: 'image', path: '/pics/cover.PNG' })
  for (const cover of [{ kind: 'frame', atMs: -5 }, { kind: 'frame', atMs: 1.5 }, { kind: 'frame' }, { kind: 'image', path: '/pics/cover.gif' }, { kind: 'image', path: 'x\0.jpg' }, { kind: 'video' }, 'frame']) {
    assert.throws(() => request({ cover }), /Invalid post request/, JSON.stringify(cover))
  }
  assert.deepEqual(request({ youtube: { title: 'Clip', visibility: 'public', madeForKids: false, subtitles: { language: 'en' } } }).options.youtube.subtitles, { language: 'en' })
  assert.throws(() => request({ youtube: { title: 'Clip', visibility: 'public', madeForKids: false, subtitles: { language: 'English' } } }), /captions language/)
})

test('a picked frame goes to TikTok and Instagram as a time, and to Facebook as an image; YouTube Shorts and X keep their default', () => {
  const req = request({ cover: { kind: 'frame', atMs: 1200 } })
  const body = payload.buildCreatePostBody(req, {
    publicUrl: VIDEO,
    tiktokInteractions: { [A('t')]: { comment: true, duet: true, stitch: true } },
    cover: { platforms: ['tiktok', 'instagram', 'facebook'], atMs: 1200, imageUrl: IMAGE, fromImage: false }
  })
  assert.equal(entry(body, 'tiktok').platformSpecificData.tiktokSettings.videoCoverTimestampMs, 1200)
  assert.equal(entry(body, 'tiktok').platformSpecificData.tiktokSettings.videoCoverImageUrl, undefined)
  assert.equal(entry(body, 'instagram').platformSpecificData.thumbOffset, 1200)
  assert.deepEqual(body.mediaItems, [{ type: 'video', url: VIDEO, thumbnail: IMAGE }])
  // The Short gets the same video without the shared cover.
  assert.deepEqual(entry(body, 'youtube').customMedia, [{ type: 'video', url: VIDEO }])
  assert.equal(entry(body, 'twitter').customMedia, undefined)
  assert.equal(entry(body, 'twitter').platformSpecificData, undefined)
})

test('an uploaded image is the cover everywhere it can be; regular YouTube videos take it from the shared media', () => {
  const req = request({ cover: { kind: 'image', path: '/pics/cover.jpg' } }, ['tiktok', 'instagram', 'youtube', 'linkedin'])
  const body = payload.buildCreatePostBody(req, { publicUrl: VIDEO, cover: { platforms: ['tiktok', 'instagram', 'youtube', 'linkedin'], atMs: null, imageUrl: IMAGE, fromImage: true } })
  assert.equal(entry(body, 'tiktok').platformSpecificData.tiktokSettings.videoCoverImageUrl, IMAGE)
  assert.equal(entry(body, 'tiktok').platformSpecificData.tiktokSettings.videoCoverTimestampMs, undefined)
  assert.equal(entry(body, 'instagram').platformSpecificData.instagramThumbnail, IMAGE)
  assert.equal(entry(body, 'instagram').platformSpecificData.thumbOffset, undefined)
  assert.equal(body.mediaItems[0].thumbnail, IMAGE)
  assert.equal(entry(body, 'youtube').customMedia, undefined)
})

test('no cover: the body is unchanged', () => {
  const body = payload.buildCreatePostBody(request({}), { publicUrl: VIDEO })
  assert.deepEqual(body.mediaItems, [{ type: 'video', url: VIDEO }])
  assert.ok(body.platforms.every((p) => !p.customMedia))
  assert.deepEqual(entry(body, 'instagram').platformSpecificData, { shareToFeed: true })
})

test('YouTube captions ride only on the YouTube entry, so Facebook and X don’t get subtitles too', () => {
  const req = request({ youtube: { title: 'Clip', visibility: 'public', madeForKids: false, subtitles: { language: 'en' } } }, ['youtube', 'facebook', 'twitter'])
  const body = payload.buildCreatePostBody(req, { publicUrl: VIDEO, youtubeSubtitles: { url: SUBS, language: 'en' } })
  assert.deepEqual(entry(body, 'youtube').customMedia, [{ type: 'video', url: VIDEO, subtitles: [{ url: SUBS, language: 'en' }] }])
  assert.deepEqual(body.mediaItems, [{ type: 'video', url: VIDEO }])
  assert.equal(entry(body, 'facebook').customMedia, undefined)
  // With a regular-video cover too, YouTube's own entry carries both.
  const both = payload.buildCreatePostBody(req, { publicUrl: VIDEO, youtubeSubtitles: { url: SUBS, language: 'en' }, cover: { platforms: ['youtube', 'facebook'], atMs: 0, imageUrl: IMAGE, fromImage: false } })
  assert.deepEqual(entry(both, 'youtube').customMedia, [{ type: 'video', url: VIDEO, thumbnail: IMAGE, subtitles: [{ url: SUBS, language: 'en' }] }])
})

// ---- Against the mock -----------------------------------------------------------------

async function withPosting(fn) {
  const { dir, cleanup } = tempDir()
  const posting = createPostingMock()
  const mock = await createMockZernio({ apiKey: KEY, extraRoutes: posting.routes })
  const previousUrl = process.env.BRIDGECLIP_ZERNIO_API_URL
  const previousPath = process.env.PATH
  process.env.BRIDGECLIP_ZERNIO_API_URL = mock.apiUrl
  process.env.PATH = `${previousPath}${path.delimiter}${path.join(ROOT, 'engine-bin')}`
  try {
    const library = path.join(dir, 'library')
    const clipPath = makeClip(path.join(library, 'job-1', 'clip_01.mp4'))
    const { electron } = fakeElectron(dir)
    const main = loadMain(`
      export * as posts from './src/main/zernio/posts'
      export * as settings from './src/main/settings-store'
      export * as security from './src/main/security'
    `, { electron })
    main.settings.replaceApiKey('zernioApiKey', KEY)
    main.settings.savePublicSettings({ outputDirectory: library, pythonPath: 'python3' })
    const [profile] = mock.state.profiles
    const accounts = Object.fromEntries(['tiktok', 'instagram', 'youtube', 'facebook'].map((platform) => [platform, mock.addAccount(platform, profile._id, { username: platform })]))
    const publish = (overrides) => main.posts.publishClip({
      attemptId: 'attempt-cover-0001', clipPath, clipTitle: 'Why agents need tests', durationMs: 4000, caption: 'Why agents need tests',
      timing: { mode: 'schedule', scheduledFor: new Date(Date.now() + 3_600_000).toISOString(), timezone: 'America/New_York' },
      ...overrides
    }, () => {})
    await fn({ dir, posting, main, clipPath, accounts, publish })
  } finally {
    if (previousUrl === undefined) delete process.env.BRIDGECLIP_ZERNIO_API_URL
    else process.env.BRIDGECLIP_ZERNIO_API_URL = previousUrl
    process.env.PATH = previousPath
    await mock.close()
    cleanup()
  }
}

test('mock: a frame cover for TikTok and Instagram needs no image upload; Facebook gets the frame as an uploaded JPEG', () => withPosting(async ({ posting, accounts, publish }) => {
  const tiktok = { ...TIKTOK_OPTIONS, accounts: { [accounts.tiktok._id]: TIKTOK } }
  const first = await publish({
    targets: [{ platform: 'tiktok', accountId: accounts.tiktok._id }, { platform: 'instagram', accountId: accounts.instagram._id }],
    options: { tiktok, instagram: { shareToFeed: true }, cover: { kind: 'frame', atMs: 1500 } }
  })
  assert.equal(first.outcome, 'scheduled')
  assert.deepEqual(posting.state.uploads.map((u) => u.contentType), ['video/mp4'])
  const [create] = posting.state.creates
  assert.equal(entry(create.body, 'tiktok').platformSpecificData.tiktokSettings.videoCoverTimestampMs, 1500)
  assert.equal(entry(create.body, 'instagram').platformSpecificData.thumbOffset, 1500)

  await publish({
    attemptId: 'attempt-cover-0002', caption: 'Second caption',
    targets: [{ platform: 'facebook', accountId: accounts.facebook._id }, { platform: 'youtube', accountId: accounts.youtube._id }],
    options: { facebook: { format: 'reel' }, youtube: { title: 'Why agents need tests', visibility: 'public', madeForKids: false }, cover: { kind: 'frame', atMs: 1500 } }
  })
  const images = posting.state.uploads.filter((u) => u.contentType === 'image/jpeg')
  assert.equal(images.length, 1)
  const body = posting.state.creates.at(-1).body
  assert.match(body.mediaItems[0].thumbnail, /cover\.jpg$/)
  assert.deepEqual(entry(body, 'youtube').customMedia, [{ type: 'video', url: body.mediaItems[0].url }], 'the Short keeps its default cover')
}))

test('mock: an out-of-range frame is refused before anything is created', () => withPosting(async ({ posting, accounts, publish }) => {
  await assert.rejects(publish({
    targets: [{ platform: 'instagram', accountId: accounts.instagram._id }],
    options: { instagram: { shareToFeed: true }, cover: { kind: 'frame', atMs: 60_000 } }
  }), /cover frame inside the clip/)
  assert.equal(posting.state.creates.length, 0)
}))

test('mock: an image cover must be picked (authorized), a real JPG/PNG and at most 10 MB', () => withPosting(async ({ dir, posting, main, accounts, publish }) => {
  const targets = [{ platform: 'instagram', accountId: accounts.instagram._id }]
  const options = (p) => ({ instagram: { shareToFeed: true }, cover: { kind: 'image', path: p } })
  const png = path.join(dir, 'cover.png')
  fs.writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]))
  await assert.rejects(publish({ targets, options: options(png) }), /Choose the cover image again/, 'not picked in the dialog')
  const fake = path.join(dir, 'fake.jpg')
  fs.writeFileSync(fake, 'not really a jpeg')
  await assert.rejects(main.posts.coverImageForPosting(fake), /JPG or PNG/)
  await assert.rejects(main.posts.coverImageForPosting(path.join(dir, 'x.gif')), /JPG or PNG/)
  const big = path.join(dir, 'big.jpg')
  fs.writeFileSync(big, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10 * 1024 * 1024)]))
  await assert.rejects(main.posts.coverImageForPosting(big), /10 MB/)

  assert.deepEqual(await main.posts.coverImageForPosting(png), { path: fs.realpathSync(png), sizeBytes: 72 })
  const result = await publish({ targets, options: options(png) })
  assert.equal(result.outcome, 'scheduled')
  const image = posting.state.uploads.find((u) => u.contentType === 'image/png')
  assert.equal(image.sha256, crypto.createHash('sha256').update(fs.readFileSync(png)).digest('hex'))
  assert.match(entry(posting.state.creates[0].body, 'instagram').platformSpecificData.instagramThumbnail, /cover\.png$/)
}))

test('mock: YouTube captions upload the clip’s SRT and attach it; a retry reuses every upload and the same request', () => withPosting(async ({ posting, main, clipPath, accounts, publish }) => {
  assert.deepEqual(await main.posts.clipSubtitlesForPosting(clipPath), { found: false, fileName: null, language: null })
  const youtube = { title: 'Why agents need tests', visibility: 'public', madeForKids: false, subtitles: { language: 'en' } }
  const targets = [{ platform: 'youtube', accountId: accounts.youtube._id }, { platform: 'facebook', accountId: accounts.facebook._id }]
  const options = { youtube, facebook: { format: 'reel' }, cover: { kind: 'frame', atMs: 1000 } }
  await assert.rejects(publish({ targets, options }), /no subtitle file/)

  fs.writeFileSync(clipPath.replace(/\.mp4$/, '.srt'), SRT)
  assert.deepEqual(await main.posts.clipSubtitlesForPosting(clipPath), { found: true, fileName: 'clip_01.srt', language: null })
  const result = await publish({ targets, options })
  assert.equal(result.outcome, 'scheduled')
  const subtitleUpload = posting.state.uploads.find((u) => u.contentType === 'application/x-subrip')
  assert.equal(subtitleUpload.sha256, crypto.createHash('sha256').update(SRT).digest('hex'))
  const body = posting.state.creates[0].body
  const yt = entry(body, 'youtube').customMedia[0]
  assert.equal(yt.subtitles.length, 1)
  assert.equal(yt.subtitles[0].language, 'en')
  assert.match(yt.subtitles[0].url, /clip_01\.srt$/)
  assert.equal(body.mediaItems[0].subtitles, undefined, 'only YouTube gets captions')
  assert.equal(entry(body, 'facebook').customMedia, undefined)

  // The same attempt again (as after editing and trying again): no new uploads.
  const before = posting.state.uploads.length
  await publish({ targets, options, caption: 'Why agents need tests (again)' })
  assert.equal(posting.state.uploads.length, before, 'video, cover and subtitles were reused')
  const again = posting.state.creates.at(-1).body
  assert.equal(entry(again, 'youtube').customMedia[0].subtitles[0].url, yt.subtitles[0].url)
  assert.equal(again.mediaItems[0].thumbnail, body.mediaItems[0].thumbnail)
}))
