// Design tokens for the 3D explainer. Two looks, one grammar: colour carries meaning.
//   P = STUDIO look (dark product-film studio, units cm). ctx.P in scenes.
//   C = CITY look (golden-hour paper city, units m).     ctx.C in scenes.
// Scenes take colours from here, never invent their own (a new token is fine if it has a meaning).

export const P = {
  bg: { top: '#0b0d12', mid: '#0f1219', bottom: '#06070a' },   // backdrop gradient (ctx.bg overrides per frame)
  ink: '#0e1117',
  white: '#ffffff',
  grey: '#6b6b6b',
  charge: '#2a7afc',      // THE accent: energy / data / "the thing that matters" (same blue as the caption key box)
  chargeHot: '#7fb4ff',   // glow highlight of the accent (blooms)
  body: '#ffb04a',        // second energy: warm amber (the human, heat, the input)
  bodyHot: '#ffd59a',
  dip: '#ff5a3c',         // loss / missing / dip
  no: '#ff3b4a',          // rejection, X marks
  ok: '#34d27b',          // success, "that works"
  wireRow: '#3b7cff',
  wireCol: '#9fc2ff',
  glass: '#c9dcff',
  phoneBody: '#1b1e24',
  phoneFrame: '#8a8f99',
  skin: '#e9b48f',
  skinShade: '#c98b66',
  glove: '#2b2f38',
  gloveKnit: '#3a3f4b',
  thread: '#d9dde6',
  water: '#7cc8ff',
  snow: '#eaf2ff',
  floor: '#0d1016',
};

export const C = {
  // world
  skyTop: '#b9cbe0',
  skyHorizon: '#f1e7d8',
  fog: '#ece4d6',
  ground: '#e6dfd2',
  block: '#efe9de',
  park: '#cfd8bf',
  water: '#b9cdd8',
  street: '#c3beb5',
  streetLine: '#e4e0d8',
  asphalt: '#40454d',
  asphaltLight: '#5a6068',
  lane: '#f4f1ea',
  curb: '#d8d0c2',
  pillar: '#d3ccbf',
  barrier: '#e9e3d8',
  buildings: ['#ece6db', '#ddd5c7', '#cfc8bb', '#d9d6d1', '#c5cacf', '#e4dccd', '#bfc6cc', '#d8cdbd'],
  towers: ['#bcc6d1', '#aab6c4', '#cdd3da', '#9eabbb', '#c2c6cd'],
  roofs: ['#c98468', '#b77462', '#8f9aa6', '#a98a72', '#9c7d6a'],
  houseWalls: ['#f3eee4', '#ebe3d3', '#e7e9e6', '#efe4d6'],
  trees: ['#9fb38b', '#8ea67d', '#adbd92', '#97ad86'],
  trunk: '#8a7563',
  cars: ['#f5f5f2', '#f5f5f2', '#e9e9e6', '#c9ccd0', '#9aa0a8', '#5c626b', '#3b4048', '#2c3036', '#d9d4c8', '#b8c4cf', '#c7b9a6'],
  // signal colours (meaning, not decoration)
  route: '#2f6bff',         // you / your thing / the route
  routeGlow: '#6b95ff',
  live: '#1fbf6a',          // live, fine, flowing
  slow: '#f5a524',          // warning, slowing
  jam: '#ec4a3c',           // bad, blocked
  forecast: '#8a5cf6',      // predicted, future, model
  forecastGlow: '#b49cff',
  history: '#8b98ab',       // past, historical
  phone: '#3b82f6',         // devices, pings, signals
  ink: '#141820',           // dark glass UI
  paper: '#fbf8f2',         // light UI
};

export const hex = (c) => parseInt(c.slice(1), 16);
