/* src/router/seam/src/scanner.ts */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { findSpecialFile, parseSegment } from './conventions.js'
import type { RouteNode, SegmentKind } from './types.js'

export interface ScanOptions {
  pagesDir: string
  extensions?: string[]
}

const DEFAULT_EXTENSIONS = ['.tsx', '.vue', '.svelte']

const IGNORED_DIRS = new Set(['node_modules'])

function scanDir(
  dirPath: string,
  segment: SegmentKind,
  componentExts: string[],
  dataExts: string[],
): RouteNode {
  const resolved = path.resolve(dirPath)

  const node: RouteNode = {
    dirPath: resolved,
    segment,
    pageFile: findSpecialFile(resolved, 'page', componentExts),
    dataFile: findSpecialFile(resolved, 'page', dataExts),
    layoutFile: findSpecialFile(resolved, 'layout', componentExts),
    layoutDataFile: findSpecialFile(resolved, 'layout', dataExts),
    errorFile: findSpecialFile(resolved, 'error', componentExts),
    loadingFile: findSpecialFile(resolved, 'loading', componentExts),
    notFoundFile: findSpecialFile(resolved, 'not-found', componentExts),
    children: [],
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true })
  } catch {
    return node
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue

    const childSegment = parseSegment(entry.name)
    const childPath = path.join(resolved, entry.name)
    node.children.push(scanDir(childPath, childSegment, componentExts, dataExts))
  }

  return node
}

export function scanPages(options: ScanOptions): RouteNode[] {
  const { pagesDir, extensions = DEFAULT_EXTENSIONS } = options
  const resolved = path.resolve(pagesDir)

  if (!fs.existsSync(resolved)) {
    throw new Error(`Pages directory does not exist: ${resolved}`)
  }

  // Data-only extensions: always .ts (page.ts for data)
  const dataExts = ['.ts']

  const rootSegment: SegmentKind = { type: 'static', value: '' }
  const root = scanDir(resolved, rootSegment, extensions, dataExts)
  return [root]
}
