/* packages/server/core/typescript/src/dev/reload-watcher.ts */

import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

export interface ReloadWatcher {
  close(): void;
}

export function watchReloadTrigger(distDir: string, onReload: () => void): ReloadWatcher {
  const triggerPath = join(distDir, ".reload-trigger");
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(triggerPath, () => onReload());
  } catch {
    // Trigger file may not exist yet; watch directory until it appears
    const dirWatcher = watch(distDir, (_event, filename) => {
      if (filename === ".reload-trigger") {
        dirWatcher.close();
        watcher = watch(triggerPath, () => onReload());
      }
    });
    return {
      close() {
        dirWatcher.close();
        watcher?.close();
      },
    };
  }
  return {
    close() {
      watcher?.close();
    },
  };
}
