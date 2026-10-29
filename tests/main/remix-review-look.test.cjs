// The look and skills a remix in review can still change: read from the run's request, changes checked.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')

const look = loadMain("export * from './src/shared/remix-review-look'")
const plain = (x) => JSON.parse(JSON.stringify(x))

test('the review look from a request, and checked changes', () => {
  assert.deepEqual(plain(look.reviewLookOf({ includeCaptions: true, captionPreset: 'pop', brandIdentityId: null, music: true, musicTrack: 'calm-pad', lookExtras: ['punch_zoom', 'nope'] })), {
    includeCaptions: true, captionPreset: 'pop', headlineLook: { look: 'white', color: '#FFFFFF', font: 'clean' }, lookExtras: ['punch_zoom'],
    music: true, musicTrack: 'calm-pad', voiceCleanup: false, brandIdentityId: null })
  assert.deepEqual(plain(look.parseRemixLookPatch({ includeCaptions: false, lookExtras: [] })), { includeCaptions: false, lookExtras: [] })
  assert.throws(() => look.parseRemixLookPatch(null), /look again/)
  assert.throws(() => look.parseRemixLookPatch({ brandIdentityId: 'x' }), /look again/)
  assert.throws(() => look.parseRemixLookPatch({ captionPreset: 'x' }), /caption style/)
  assert.throws(() => look.parseRemixLookPatch({ headlineLook: { look: 'x' } }), /hook text look/)
  assert.throws(() => look.parseRemixLookPatch({ music: 'yes' }), /music/)
})

test('sound after a change: music on with no track picks the first; off drops the track', () => {
  const on = look.audioAfter({}, { music: true })
  assert.equal(on.music, true)
  assert.equal(typeof on.musicTrack, 'string')
  assert.deepEqual(plain(look.audioAfter({ music: true, musicTrack: on.musicTrack }, { music: false, voiceCleanup: true })), { voiceCleanup: true })
  assert.throws(() => look.audioAfter({}, { music: true, musicTrack: '../x.mp3' }), /Choose the music/)
})
