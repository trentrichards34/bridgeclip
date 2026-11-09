'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { loadMain } = require('../zernio/support/load-main.cjs')

const summary = loadMain("export * from './src/shared/library-summary'")
const plain = (value) => JSON.parse(JSON.stringify(value))

const runs = [
  { outputDir: '/lib/a', videoTitle: 'Editor run', date: '2026-10-02T00:00:00Z', status: 'completed', editorProject: true, madeWith: 'create' },
  { outputDir: '/lib/b', videoTitle: 'Plain run', date: '2026-10-01T00:00:00Z', status: 'completed' },
  { outputDir: '/lib/c', videoTitle: 'Broken run', date: '2026-09-30T00:00:00Z', status: 'incomplete' },
  { outputDir: '/lib/d', videoTitle: 'Unreadable', date: '2026-09-29T00:00:00Z', status: 'completed', editorProject: true }
]
const readers = {
  editor: async (dir) => {
    if (dir === '/lib/d') throw new Error('damaged')
    return { previewPath: '/lib/a/editor-preview.mp4', clips: [
      { title: 'Being refined', status: 'refining', durationMs: 31000, score: 0.84, startMs: 5000 },
      { title: 'Ready one', status: 'ready', durationMs: 22000, score: 0, startMs: 9000 },
      { title: 'Baked', status: 'baked', durationMs: 20000, score: 0.7, startMs: 1000 },
      { title: 'Set aside', status: 'discarded', durationMs: 20000, score: 0.7, startMs: 1000 }
    ] }
  },
  job: async (dir) => dir === '/lib/a'
    ? { clips: [{ clip_index: 3, summary: 'Baked', duration_ms: 20000, virality_score: 0.7, s3_url: 'file:///lib/a/clip_3.mp4' }] }
    : dir === '/lib/b' ? { clips: [
      { clip_index: 0, summary: '', duration_ms: 15000, virality_score: 0.91, s3_url: '/lib/b/clip_0.mp4' },
      { clip_index: 1, summary: 'Graded', duration_ms: Number.NaN, virality_score: 0, s3_url: '/lib/b/clip_1.mp4', framework: { score: 7.46 } }
    ] } : null
}

test('the Library summary counts clips by status from completed runs and lists one light row per clip', async () => {
  const result = plain(await summary.buildLibrarySummary(runs, readers))
  assert.deepEqual(result.counts, { refining: 1, ready: 1, exported: 3 })
  assert.equal(result.runs, 3)
  assert.equal(result.truncated, false)
  assert.deepEqual(result.clips.map((c) => [c.outputDir, c.status, c.index, c.title, c.score]), [
    ['/lib/a', 'refining', 0, 'Being refined', 8.4],
    ['/lib/a', 'ready', 1, 'Ready one', null],
    ['/lib/a', 'exported', 3, 'Baked', 7],
    ['/lib/b', 'exported', 0, 'Clip 1', 9.1],
    ['/lib/b', 'exported', 1, 'Graded', 7.5]
  ])
  assert.deepEqual(result.clips[0].media, { kind: 'preview', path: '/lib/a/editor-preview.mp4', ms: 5000 })
  assert.deepEqual(result.clips[2].media, { kind: 'clip', url: 'file:///lib/a/clip_3.mp4' })
  assert.equal(result.clips[4].durationMs, 0)
  assert.equal(result.clips[0].madeWith, 'create')
  assert.equal(result.clips[0].runTitle, 'Editor run')
})

test('the clip list is capped while the counts stay complete', async () => {
  const many = Array.from({ length: summary.MAX_SUMMARY_CLIPS + 5 }, (_, i) => ({ clip_index: i, summary: `C${i}`, duration_ms: 1000, virality_score: 0.5, s3_url: `/x/${i}.mp4` }))
  const result = await summary.buildLibrarySummary([{ outputDir: '/x', videoTitle: 'Big', date: '', status: 'completed' }], { job: async () => ({ clips: many }), editor: async () => null })
  assert.equal(result.counts.exported, summary.MAX_SUMMARY_CLIPS + 5)
  assert.equal(result.clips.length, summary.MAX_SUMMARY_CLIPS)
  assert.equal(result.truncated, true)
})
