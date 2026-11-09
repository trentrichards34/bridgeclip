// Edit my recording's review: a pop-up that repeats a graphic's number or words within a few seconds is flagged.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')
const dup = loadMain("export * from './src/shared/edit-duplicates'")
const plain = (x) => JSON.parse(JSON.stringify(x))

test('the same number or the same words count as the same text; other text does not', () => {
  assert.equal(dup.sameExtraText('15 billion', ['15 billion', 'messages wait']), true)
  assert.equal(dup.sameExtraText('40%', ['40', 'of coaches']), true)
  assert.equal(dup.sameExtraText('$1,200', ['$1200/month']), true)
  assert.equal(dup.sameExtraText('billion', ['15 billion messages']), true)
  assert.equal(dup.sameExtraText('Pricing', ['Three steps', 'Write hooks\nFilm once']), false)
  assert.equal(dup.sameExtraText('12', ['120 clients']), false)
  assert.equal(dup.sameExtraText('so', ['so many']), false, 'very short words are not enough')
  assert.equal(dup.sameExtraText('', ['anything']), false)
})

test('a pop-up is flagged only when it plays within about 3 s of the graphic showing the same text', () => {
  const shown = [{ label: 'the stat counter graphic on “Fifteen”', texts: ['15 billion', 'messages wait'], start: 1, end: 4 }]
  assert.deepEqual(plain(dup.findDuplicateExtras([{ id: 0, text: ' 15 billion ', at: 1.4 }], shown)), [{ popup: 0, text: '15 billion', other: 'the stat counter graphic on “Fifteen”' }])
  assert.equal(dup.findDuplicateExtras([{ id: 0, text: '15 billion', at: 6.9 }], shown).length, 1, 'just after it ends')
  assert.equal(dup.findDuplicateExtras([{ id: 0, text: '15 billion', at: 7.5 }], shown).length, 0, 'well after it ends')
  assert.equal(dup.findDuplicateExtras([{ id: 1, text: 'clients', at: 2 }], shown).length, 0)
  assert.equal(dup.DUPLICATE_WINDOW_SECONDS, 3)
})
