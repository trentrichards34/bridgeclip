#!/usr/bin/env node
// Writes engine/clip_engine/data/fx_catalog.json from src/shared/fx-catalog.ts (the Effects catalog), so the Python
// planner reads the same effects, fields and guidance. tests/main/fx-effects.test.cjs fails when the two differ.
//   node scripts/export-fx-catalog.cjs          write it
//   node scripts/export-fx-catalog.cjs --check  exit 1 when it is out of date
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'engine/clip_engine/data/fx_catalog.json')

function catalogJson() {
  const source = fs.readFileSync(path.join(ROOT, 'src/shared/fx-catalog.ts'), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(js, { module, exports: module.exports })
  return `${JSON.stringify(module.exports.fxCatalogJson(), null, 2)}\n`
}

if (require.main === module) {
  const text = catalogJson()
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
    if (current !== text) { console.error('engine/clip_engine/data/fx_catalog.json is out of date: run node scripts/export-fx-catalog.cjs'); process.exit(1) }
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, text)
    console.log(`Wrote ${path.relative(ROOT, OUT)}`)
  }
}

module.exports = { catalogJson, OUT }
