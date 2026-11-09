// The Triple Hook Playbook on Edit my recording / Combine clips' headline: the elements the spoken line and the
// headline stack (mirroring the engine's edit_frameworks patterns), quoted exactly; the plan's headline options; the
// beat sheet's first-beat label.
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')

const lib = loadMain(`export * from './src/shared/triple-hook'
  export { deriveBeats } from './src/shared/beat-sheet'
  export { parseEditPlan, initialDecisions } from './src/shared/edit-recording'`)
const plain = (x) => JSON.parse(JSON.stringify(x))

// The owner's real recording (Travis): its opening line and lines from later in it.
const OPENING = 'You do not have to be an influencer or have a huge audience in order to make a lot of money on the internet.'

test('elements: the same lines the engine tests use', () => {
  assert.deepEqual(plain(lib.detectHookElements(OPENING)), { qualifier: false, main_statement: true, twist: true, specific: false })
  assert.equal(lib.detectHookElements('Yesterday I spent $4,365 on ads promoting my product').specific, true)
  assert.equal(lib.detectHookElements('Turns out about three million people look for that every single week').specific, true)
  assert.equal(lib.detectHookElements('this is gonna be controversial because there’s only two ways to get eyeballs.').qualifier, true)
  assert.equal(lib.detectHookElements('I can’t stress this enough.').qualifier, true)
  assert.equal(lib.detectHookElements('all without going viral').twist, true)
  assert.deepEqual(plain(lib.detectHookElements('Here is my screen')), { qualifier: false, main_statement: false, twist: false, specific: false })
})

test('the opening: where each element is, and the first beat’s label', () => {
  const e = lib.openingElements(OPENING, 'We ended up generating $8,188')
  assert.equal(e.twist, 'said')
  assert.equal(e.main_statement, 'said')
  assert.equal(e.qualifier, null)
  assert.equal(e.specific, true)
  assert.equal(lib.tripleHookLabel(OPENING, 'You do not have to be an influencer'), 'Triple Hook: main statement + twist · no qualifier')
  assert.equal(lib.tripleHookLabel('Fifteen billion messages wait.', 'I can’t stress this enough'), 'Triple Hook: qualifier (headline) · no main statement or twist')
  assert.equal(lib.tripleHookLabel(OPENING, 'I can’t stress this enough: we ended up generating $8,188'), 'Triple Hook: qualifier (headline) + main statement + twist · all three')
  assert.equal(lib.tripleHookLabel('Here is my screen.', ''), 'Triple Hook: none of the three elements yet')
})

test('quotes: each element with its exact words, from the line said first, else the headline', () => {
  assert.equal(lib.elementQuote('Yesterday was October 20th, and I spent $4,365 on ads, a petrifying number.', 'main_statement'), 'and I spent $4,365 on ads,')
  assert.equal(lib.elementQuote(OPENING, 'twist'), OPENING)
  assert.equal(lib.elementQuote(OPENING, 'qualifier'), null)
  assert.deepEqual(plain(lib.openingQuotes(OPENING, 'I can’t stress this enough: we ended up generating $8,188')), [
    { role: 'qualifier', quote: "I can't stress this enough:", from: 'headline' },
    { role: 'main_statement', quote: OPENING, from: 'said' },
    { role: 'twist', quote: OPENING, from: 'said' }
  ])
})

const WORDS = 'You do not need ads. I can’t stress this enough. I sold 40 courses last week. Follow me for more.'.split(' ')
const plan = (options) => lib.parseEditPlan({
  words: WORDS.map((w, i) => [w, i * 300, i * 300 + 260, 0, null]),
  hooks: [{ id: 0, start: 0, end: 4, text: 'I sold 40 courses last week', why: '', repeated: 'You do not need ads', options },
    { id: 1, start: 10, end: 15, text: 'Forty courses', why: '' }], hook: 0,
  cta: { start: 16, end: 19 }, popups: [], sounds: [], planned: 'ai', notes: [], warnings: []
}, 1)

test('headline options from the engine are checked: at most three, plain text, known elements', () => {
  const p = plan([
    { text: 'I can’t stress this enough: I sold 40 courses last week', adds: ['qualifier', 'nonsense'] },
    { text: '<b>bold</b>', adds: [] }, { text: 'x'.repeat(120), adds: [] },
    { text: 'I can’t stress this enough: I sold 40 courses last week', adds: [] }
  ])
  assert.deepEqual(plain(p.hooks[0].options), [{ text: 'I can’t stress this enough: I sold 40 courses last week', adds: ['qualifier'] }])
  assert.equal(p.hooks[0].repeated, 'You do not need ads')
  assert.equal(p.hooks[1].options, undefined)
  assert.equal(plan('nope').hooks[0].options, undefined)
})

test('the beat sheet labels beat 1 with its Triple Hook role, live as the headline changes', () => {
  const p = plan([])
  const d = lib.initialDecisions(p)
  const [first, ...rest] = lib.deriveBeats(p, d)
  assert.equal(first.kind, 'hook')
  assert.equal(first.hookRole, 'Triple Hook: main statement (headline) + twist · no qualifier')
  assert.ok(rest.every((b) => b.hookRole === ''))
  const changed = lib.deriveBeats(p, { ...d, hookText: 'I can’t stress this enough: I sold 40 courses last week' })[0]
  assert.equal(changed.hookRole, 'Triple Hook: qualifier (headline) + main statement (headline) + twist · all three')
})
