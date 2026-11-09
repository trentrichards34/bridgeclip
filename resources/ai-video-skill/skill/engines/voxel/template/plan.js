// plan.js: the beats of THIS reel. One beat = one scene at its own station; the engine whip-pans between them.
// Times come from build/words.json, so cue beats on WORDS (see engines/voxel/core/plan.js for every `at` form):
//   at: 'camera'                  first "camera" after the previous beat starts
//   at: { word: 'it', nth: 1 }    second "it" after the previous beat starts
//   at: { sentence: 2 }           first word of the 3rd sentence      at: { frac: 0.5 }  word nearest the middle
//   or: { ... }                   fallback when the cue is missing
// head: headline strip text ('TEXT', 'auto' = key words, 'cta' = COMMENT <KEYWORD>, null = none).
// scene: reuse another scene file for this beat (the scene keeps its state per beat in spec.state).
//
// This template plan works with ANY script: hook = first two sentences, two middle beats, CTA from "comment".
// For a real reel, write one beat per idea (2-4 s each), real headlines, and one scene file per beat.
export const BEATS = [
  { id: 's01_hook', at: 0, head: 'auto' },
  { id: 's02_points', scene: 's02_middle', at: { sentence: 2, or: { frac: 0.3 } }, head: 'auto' },
  { id: 's03_points', scene: 's02_middle', at: { sentence: 4, or: { frac: 0.6 } }, head: 'auto' },
  { id: 's04_cta', at: { word: 'comment', or: { sentence: -1 } }, head: 'cta' },
];

export const OPTIONS = { tail: 0.6, blend: 0.45, gap: 300 };
