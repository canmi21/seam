/* src/server/core/typescript/src/dev/reload-watcher.ts */

import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

export interface ReloadWatcher {
  close(): void
  /** Resolves on the next reload event. Rejects if the watcher is already closed. */
  nextReload(): Promise<void>
}

export function watchReloadTrigger(distDir: string, onReload: () => void): ReloadWatcher {
  const triggerPath = join(distDir, '.reload-trigger')
  let watcher: FSWatcher | null = null
  let closed = false
  let pending: Array<{ resolve: () => void; reject: (e: Error) => void }> = []

  const notify = () => {
    onReload()
    const batch = pending
    pending = []
    for (const p of batch) p.resolve()
  }

  const nextReload = (): Promise<void> => {
    if (closed) return Promise.reject(new Error('watcher closed'))
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject })
    })
  }

  const closeAll = () => {
    closed = true
    const batch = pending
    pending = []
    const err = new Error('watcher closed')
    for (const p of batch) p.reject(err)
  }

  try {
    watcher = watch(triggerPath, () => notify())
  } catch {
    // Trigger file may not exist yet; watch directory until it appears
    const dirWatcher = watch(distDir, (_event, filename) => {
      if (filename === '.reload-trigger') {
        dirWatcher.close()
        watcher = watch(triggerPath, () => notify())
        // First creation IS the reload signal -- fire immediately
        notify()
      }
    })
    return {
      close() {
        dirWatcher.close()
        watcher?.close()
        closeAll()
      },
      nextReload,
    }
  }
  return {
    close() {
      watcher?.close()
      closeAll()
    },
    nextReload,
  }
}
