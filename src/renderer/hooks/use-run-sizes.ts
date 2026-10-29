import { useEffect, useState } from 'react'
import { getApi } from '../lib/ipc'

/**
 * Size on disk of each run folder, by path. Main measures them a few at a
 * time and caches each until its folder changes, so this stays cheap to call
 * whenever the list or `revision` changes. Missing entries are still loading;
 * null means the folder could not be read.
 */
export function useRunSizes(paths: string[], revision = 0): Record<string, number | null> {
  const [sizes, setSizes] = useState<Record<string, number | null>>({})
  const key = JSON.stringify([...paths].sort())
  useEffect(() => {
    const list = JSON.parse(key) as string[]
    if (!list.length || typeof getApi().storage?.runSizes !== 'function') return
    let active = true
    getApi().storage.runSizes(list).then((results) => {
      if (active) setSizes(Object.fromEntries(results.map((result) => [result.outputDir, result.bytes])))
    }).catch(() => {
      if (active) setSizes(Object.fromEntries(list.map((path) => [path, null])))
    })
    return () => { active = false }
  }, [key, revision])
  return sizes
}
