'use strict'
// The optional first comment: found in a Remix caption, validated, and sent
// only to platforms where Zernio supports platformSpecificData.firstComment.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('./support/load-main.cjs')

const { shared, payload } = loadMain(`
  export * as shared from './src/shared/zernio-posts'
  export * as payload from './src/main/zernio/posts-payload'
`, { electron: {} })
const { ctaLine } = loadMain("export { ctaLine } from './src/shared/remix'", { electron: {} })

const ID = (c) => c.repeat(24)
const request = (overrides = {}) => ({
  attemptId: 'attempt-1234-abcd', clipPath: '/library/run/clip.mp4', clipTitle: 'Clip', durationMs: 4000, caption: 'Caption',
  targets: [{ platform: 'instagram', accountId: ID('a') }, { platform: 'tiktok', accountId: ID('b') }, { platform: 'youtube', accountId: ID('c') }, { platform: 'twitter', accountId: ID('d') }],
  timing: { mode: 'now' },
  options: { youtube: { title: 'Clip', visibility: 'public', madeForKids: false }, tiktok: { accounts: {}, consent: true }, firstComment: '  Comment SALES and I’ll send you the checklist.  ' },
  ...overrides
})

test('the keyword line Remix writes is found in a caption', () => {
  const line = ctaLine('SALES', 'the pricing checklist')
  assert.equal(shared.keywordCtaLine(`Three ways to raise prices.\n\n${line}\n\nCredit: @someone`), line)
  assert.equal(shared.keywordCtaLine('Comment SALES and I’ll send you the checklist.'), 'Comment SALES and I’ll send you the checklist.', 'curly apostrophe too')
  assert.equal(shared.keywordCtaLine('Comment below and tell me what you think'), null, 'no keyword, no line')
  assert.equal(shared.keywordCtaLine('Just a caption'), null)
  assert.equal(shared.keywordCtaLine('Three ways.\n\nComment SALES.\n\nCredit: @someone'), 'Comment SALES.', 'no offer: the keyword line alone')
  assert.equal(shared.keywordCtaLine('Comment SALES. It helps the channel.'), null, 'only a line of its own')
})

test('the first comment goes only to platforms that support it', () => {
  const parsed = payload.parsePostClipRequest(request())
  assert.equal(parsed.options.firstComment, 'Comment SALES and I’ll send you the checklist.')
  const body = payload.buildCreatePostBody(parsed, { publicUrl: 'https://storage.example/clip.mp4' })
  const data = Object.fromEntries(body.platforms.map((target) => [target.platform, target.platformSpecificData?.firstComment]))
  assert.equal(data.instagram, 'Comment SALES and I’ll send you the checklist.')
  assert.equal(data.youtube, 'Comment SALES and I’ll send you the checklist.')
  assert.equal(data.tiktok, undefined, 'TikTok has no first-comment option')
  assert.equal(data.twitter, undefined, 'X has no first-comment option')
  assert.equal(body.firstComment, undefined, 'never at the root, where Zernio ignores it')

  const none = payload.parsePostClipRequest(request({ targets: [{ platform: 'tiktok', accountId: ID('b') }] }))
  assert.equal(none.options.firstComment, undefined, 'dropped when no selected platform supports it')
  assert.equal(payload.parsePostClipRequest(request({ options: { ...request().options, firstComment: '   ' } })).options.firstComment, undefined)
  assert.throws(() => payload.parsePostClipRequest(request({ options: { ...request().options, firstComment: 'x'.repeat(501) } })), /500 characters/)
  assert.throws(() => payload.parsePostClipRequest(request({ options: { ...request().options, firstComment: 42 } })), /first comment/)
  assert.deepEqual([...shared.FIRST_COMMENT_PLATFORMS].sort(), ['facebook', 'instagram', 'linkedin', 'threads', 'youtube'])
})
