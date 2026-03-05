/* src/router/seam/__tests__/detect-exports.test.ts */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectNamedExports } from '../src/detect-exports.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seam-detect-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

describe('detectNamedExports', () => {
  it('detects export const loaders', () => {
    const f = writeFile('a.ts', 'export const loaders = { page: {} }')
    expect(detectNamedExports(f)).toContain('loaders')
  })

  it('detects export const mock', () => {
    const f = writeFile('b.ts', 'export const mock = {}')
    expect(detectNamedExports(f)).toContain('mock')
  })

  it('detects export function loaders', () => {
    const f = writeFile('c.ts', 'export function loaders() { return {} }')
    expect(detectNamedExports(f)).toContain('loaders')
  })

  it('detects export const staleTime', () => {
    const f = writeFile('d.ts', 'export const staleTime = 300_000')
    expect(detectNamedExports(f)).toContain('staleTime')
  })

  it('detects export const clientLoader', () => {
    const f = writeFile('e.ts', 'export const clientLoader = async () => {}')
    expect(detectNamedExports(f)).toContain('clientLoader')
  })

  it('ignores non-recognized exports', () => {
    const f = writeFile('f.ts', 'export const foo = 42\nexport const bar = 1')
    expect(detectNamedExports(f)).toEqual([])
  })

  it('returns empty array for empty file', () => {
    const f = writeFile('g.ts', '')
    expect(detectNamedExports(f)).toEqual([])
  })

  it('detects re-exports', () => {
    const f = writeFile('h.ts', "export { loaders, mock } from './data'")
    const result = detectNamedExports(f)
    expect(result).toContain('loaders')
    expect(result).toContain('mock')
  })
})
