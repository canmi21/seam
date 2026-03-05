/* src/router/seam/src/watcher.ts */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { watch } from 'chokidar'
import { generateRoutesFile } from './generator.js'
import { scanPages } from './scanner.js'
import type { ValidationError } from './types.js'
import { validateRouteTree } from './validator.js'

export interface WatcherOptions {
  pagesDir: string
  extensions?: string[]
  outputPath: string
  onError?: (errors: ValidationError[]) => void
  onGenerate?: (content: string) => void
}

export function createWatcher(options: WatcherOptions): { close(): void } {
  const { pagesDir, extensions, outputPath, onError, onGenerate } = options

  let timer: ReturnType<typeof setTimeout> | null = null

  function regenerate(): void {
    try {
      const tree = scanPages({ pagesDir, extensions })
      const errors = validateRouteTree(tree)

      if (errors.length > 0) {
        onError?.(errors)
        return
      }

      const content = generateRoutesFile(tree, { outputPath })
      const dir = path.dirname(outputPath)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(outputPath, content, 'utf-8')
      onGenerate?.(content)
    } catch (err) {
      onError?.([
        {
          type: 'invalid-segment',
          message: err instanceof Error ? err.message : String(err),
          paths: [],
        },
      ])
    }
  }

  function debounced(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(regenerate, 300)
  }

  const watcher = watch(pagesDir, {
    ignoreInitial: true,
    ignored: /(^|[/\\])\.|node_modules/,
  })

  watcher.on('addDir', debounced)
  watcher.on('unlinkDir', debounced)
  watcher.on('add', debounced)
  watcher.on('unlink', debounced)

  return {
    close() {
      if (timer) clearTimeout(timer)
      void watcher.close()
    },
  }
}
