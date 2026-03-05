/* src/router/seam/src/detect-exports.ts */

import * as fs from 'node:fs'

const RECOGNIZED = new Set(['loaders', 'mock', 'nullable', 'staleTime', 'clientLoader'])

const NAMED_EXPORT = /export\s+(?:const|let|function|async\s+function)\s+(\w+)/g
const REEXPORT = /export\s*\{([^}]+)\}/g

export function detectNamedExports(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf-8')
  const found = new Set<string>()

  for (const m of source.matchAll(NAMED_EXPORT)) {
    if (RECOGNIZED.has(m[1] as string)) found.add(m[1] as string)
  }

  for (const m of source.matchAll(REEXPORT)) {
    for (const part of (m[1] as string).split(',')) {
      // handle `name as alias` — use original name
      const name = part.trim().split(/\s+/)[0] as string
      if (RECOGNIZED.has(name)) found.add(name)
    }
  }

  return [...found]
}
