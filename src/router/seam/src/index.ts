/* src/router/seam/src/index.ts */

export type { RouteNode, SegmentKind, ValidationError } from './types.js'

export { findSpecialFile, parseSegment, segmentToUrlPart } from './conventions.js'

export { detectNamedExports } from './detect-exports.js'

export type { ScanOptions } from './scanner.js'
export { scanPages } from './scanner.js'

export { validateRouteTree } from './validator.js'

export type { GenerateOptions } from './generator.js'
export { generateRoutesFile } from './generator.js'

export type { WatcherOptions } from './watcher.js'
export { createWatcher } from './watcher.js'
