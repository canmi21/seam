# @canmi/seam-router

Filesystem router for SeamJS. Scans `src/pages/` with Next.js/SvelteKit naming conventions and generates TanStack Router route definitions.

## Structure

- `src/conventions.ts` — naming convention rules (`[param]`, `[[param]]`, `[...slug]`, `(group)`)
- `src/scanner.ts` — recursive `src/pages/` directory scanner
- `src/validator.ts` — duplicate paths, ambiguous dynamics, catch-all conflict detection
- `src/generator.ts` — route tree to TypeScript code generation
- `src/detect-exports.ts` — detect `loaders`/`mock` exports from page files
- `src/watcher.ts` — `createWatcher` for dev-mode file watching via chokidar
- `src/cli.ts` — `seam-router-generate` CLI entry point
- `src/types.ts` — shared type definitions

## Key Exports

| Export           | Purpose                                          |
| ---------------- | ------------------------------------------------ |
| `scanPages`      | Scan `src/pages/` and build a route tree         |
| `validateRoutes` | Check for duplicate/ambiguous/conflicting routes |
| `generateRoutes` | Emit TypeScript route definitions                |
| `createWatcher`  | Dev-mode file watcher for rebuild triggers       |

## CLI

```
seam-router-generate <pagesDir> <outputPath>
```

The Rust CLI shells out to this binary when `build.pages_dir` is set in `seam.toml`.

## Supported Conventions

| Pattern       | Example                | Meaning                          |
| ------------- | ---------------------- | -------------------------------- |
| `[param]`     | `[id]/page.tsx`        | Required dynamic segment         |
| `[[param]]`   | `[[id]]/page.tsx`      | Optional dynamic segment         |
| `[...slug]`   | `[...slug]/page.tsx`   | Catch-all (1+ segments)          |
| `[[...slug]]` | `[[...slug]]/page.tsx` | Optional catch-all (0+ segments) |
| `(group)`     | `(auth)/page.tsx`      | Route group (no URL segment)     |

## Development

- Build: `bun run --filter '@canmi/seam-router' build`
- Test: `bun run --filter '@canmi/seam-router' test`
