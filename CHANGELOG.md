# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Documented that agents must update `CHANGELOG.md` as part of the final commit for both long tasks and single-change commits.

## [0.5.38] - 2026-03-28

### Changed

- Tightened the browser API ESLint rule and added async generator coverage for it.

## [0.5.37] - 2026-03-28

### Added

- Added route-level `derive` definitions, derive graph validation, a QuickJS execution path, and `useDerive` support across codegen, hydration, and example apps.

### Fixed

- Isolated Vite dev caches by dependency fingerprint, reloaded Vite after fullstack rebuilds, and preserved derive data during hydration and SPA navigation.
- Tightened the Vite RPC transform and related ESLint edge-case handling.

### Changed

- Renamed `rollupOptions` to `rolldownOptions` for Vite 8 compatibility.
- Parallelized Go integration tests plus the lint, build, and Justfile pipelines, and refreshed workspace dependencies.

## [0.5.36] - 2026-03-13

### Added

- Added fullstack Vite proxying in `seam dev`, a hydrated boundary for React, and an ESLint rule that forbids derived Seam data inside skeletons.
- Expanded security coverage for path traversal, prototype pollution, URL safety, public assets, and route hashing.

### Fixed

- Kept table shells outside array loops and preserved nested array directives inside boolean branches during skeleton generation.
- Auto-mounted public assets across runtimes, preserved empty array mocks in skeleton samples, and excluded dynamically imported entries from layout templates.
- Hardened Vite development behavior by prebundling TanStack Router dependencies, improving dependency resolution, and preserving HMR websocket subprotocols.
- Failed builds on broken array templates and propagated `SEAM_PROFILE` correctly into Go integration tests.

### Changed

- Split supporting React and CLI helpers, refreshed dependencies, and optimized local CLI builds around the dev profile.

## [0.5.35] - 2026-03-12

### Fixed

- Aligned browser-side React traps with the SSR behavior used by the injector pipeline.

### Changed

- Expanded complex skeleton and injector regression coverage.

## [0.5.34] - 2026-03-11

### Fixed

- Preserved filesystem router layout path prefixes while keeping root layouts pathless.

## [0.5.33] - 2026-03-11

### Added

- Added CLI support for command working directories and URL generation.

### Fixed

- Preserved head metadata in dev SSR responses.
- Tightened SSE heartbeat and timeout defaults across backends.
- Hardened TypeScript helpers, URL handling, path handling, and projection logic in response to CodeQL findings.
- Resolved relative config paths from the configured command working directory.

## [0.5.32] - 2026-03-11

### Added

- Added app state injection to the TypeScript server core.

### Fixed

- Propagated layout head metadata into leaf CTR routes and preserved binary static responses.
- Tightened router state typing, yalc CLI wrapper publishing, localhost proxy bypassing, and E2E worker isolation.

### Changed

- Updated examples to use `publicDir`, centralized shell flows in the Justfile, and refreshed selected dependencies.

## [0.5.31] - 2026-03-10

### Added

- Added `error.tsx`, `loading.tsx`, and `not-found.tsx` conventions to the filesystem router.
- Added yalc integration for local package development and automatic yalc pushes after TypeScript builds.
- Added `public/` packaging and serving support across the TypeScript server, Go server, and embedded dev server.

### Fixed

- Copied all built assets instead of only manifest-listed files.
- Split leaf pages from layouts even when no sibling routes exist, validated route manifest freshness, and improved dev-time router hot reloads.

### Removed

- Removed a temporary Swift backend skeleton after validating that it was not ready to keep.

## [0.5.30] - 2026-03-10

### Added

- Added regression coverage for SSG prerendering and a dedicated markdown demo for HTML slot injection.
- Added integration coverage for markdown HTML slots, channel subscriptions, i18n hooks, locale switching, and Vite virtual/config/RPC plugins.

### Fixed

- Re-exported missing router context types and removed stale `cli/pkg` typecheck wiring.

### Changed

- Refreshed the README, roadmap, protocol specs, and package docs to reflect SSG, namespaces, head metadata, and event IDs.

### Removed

- Removed a dead ESM launcher and formally marked injector packages as deprecated.

## [0.5.29] - 2026-03-09

### Added

- Added the SSG configuration model, prerender pipeline, static asset packaging, server-side static serving, and SPA navigation for prerendered pages.

### Changed

- Renamed the built-in i18n query procedure from `__seam_i18n_query` to `seam.i18n.query`.

## [0.5.28] - 2026-03-09

### Added

- Migrated examples and the E2E fixture to structured head exports.
- Added parallel batch RPC execution for Go, typed subscription and stream handler parameters for Rust, incrementing SSE event IDs, and dot-path procedure namespaces.

### Changed

- Extracted shared bridge and i18n helpers to support the new head and namespace features.

## [0.5.27] - 2026-03-09

### Added

- Extracted `defineConfig` into a dedicated `@canmi/seam` package and added runtime validation for config objects.
- Added structured head metadata types, build support, server-side `headFn` handling, and client-side SPA head updates.
- Expanded runtime coverage for macros, the engine JS bridge, query-react, subscriptions, streams, uploads, and channel lifecycles.

### Fixed

- Preserved timing metadata in 500 responses from page requests.
- Validated locales consistently in `seam.i18n.query` across TypeScript, Go, and Rust.
- Stabilized SSE reconnect and channel-subscription tests and corrected a Go schema type mismatch.

### Changed

- Refreshed documentation and terminology for the extracted config package and new head system.

## [0.5.26] - 2026-03-09

### Fixed

- Resolved lingering lint warnings in subscription tests and the HTTP handler.

### Changed

- Extracted shared helpers to reduce function size and refreshed architecture and package documentation.

## [0.5.25] - 2026-03-09

### Added

- Added client-side reconnection with exponential backoff.
- Added full Vite config merging and a programmatic Vite dev server script for the built-in bundler.

### Changed

- Migrated examples to the built-in bundler.

### Removed

- Removed `BundlerMode::Custom` and the related deprecated config fields.

## [0.5.24] - 2026-03-09

### Added

- Added `suppress` and `cache` fields to Rust and Go manifests.
- Added SSE heartbeat and idle timeout handling across all backends, and aligned WebSocket heartbeat handling around ping/pong detection.

### Changed

- Refreshed documentation around the context function references.

## [0.5.23] - 2026-03-08

### Added

- Added stream and upload procedure kinds to the Go server.
- Added per-loader error boundaries for Rust and Go backends.
- Added cookie and query context extraction across the TypeScript, Rust, and Go backends.

### Changed

- Split large files across Rust, Go, and TypeScript while extracting router helper methods.

## [0.5.22] - 2026-03-08

### Added

- Added stream and upload procedure types to the Rust server core.
- Added stream and upload handlers to the Axum adapter.
- Added `seam_stream` and `seam_upload` proc macros.

### Changed

- Removed the remaining validation TODO placeholders and refreshed router initialization helpers and docs.

## [0.5.21] - 2026-03-08

### Added

- Added watcher awareness for full versus frontend-only rebuilds in development.
- Added typed procedure factory helpers, including router-bound factories and the `QueryDef` alias.
- Added `SeamQueryProvider` support in global layouts, per-loader error boundaries, and string shorthand loader parameter mapping.
- Added configurable input validation modes plus built-in JTD validators and structured validation details for Rust and Go handlers.

### Fixed

- Migrated demos to `loadBuild`, repaired missing `rpcHashMap` wiring, and made tests read manifests from build artifacts instead of HTTP endpoints.
- Removed the magic page unwrap, threaded `rawCtx` through loader resolution, and fixed shorthand loader mapping in Rust and Go.
- Restored the correct skeleton external list and added a `react-dom/server` type stub where needed.

### Changed

- Refreshed query integration, virtual module, build-loading, and validation documentation.

## [0.5.20] - 2026-03-08

### Added

- Added `loadBuild` and automatic `rpcHashMap` propagation through the router.
- Added `LoadBuild` and `Router.Build` support to the Go backend.

### Fixed

- Corrected plugin ordering inside the `seam()` composite plugin.

### Changed

- Unified the built-in bundler on top of Vite through the `seam()` composite plugin.

## [0.5.19] - 2026-03-07

### Fixed

- Emitted typed hook imports only when the corresponding project dependencies are present.
- Split typed hooks into a dedicated `hooks.ts` output and registered `virtual:seam/hooks` in both the built-in bundler and the Vite fallback path.

### Changed

- Migrated demos to the typed hooks generated from `virtual:seam/client`.

## [0.5.18] - 2026-03-07

### Added

- Added generic type parameters to query hooks and code-generated typed hook wrappers through instantiation expressions.

### Fixed

- Injected `__loaders` metadata correctly in the Axum page handler.

### Changed

- Simplified the query-mutation demo and made projection narrowing opt-in through an explicit `narrow` flag.

## [0.5.17] - 2026-03-07

### Added

- Added `__loaders` metadata to `__data`, automatic QueryClient hydration from loader data, and the `useSeamFetch` hook.

### Fixed

- Unwrapped SPA loader results so navigation data matches the first-load shape.

### Changed

- Migrated the E2E fixture to `seamHydrate()` and included `seam.config.ts` in editor-facing TypeScript config resolution.

## [0.5.16] - 2026-03-07

### Added

- Added `virtual:seam/meta` and zero-config `seamHydrate`.

### Fixed

- Updated generated DATA_ID imports to `.seam/generated/client.js`.
- Included dynamic import chunks in the build manifest.

## [0.5.15] - 2026-03-07

### Added

- Added fallback stubs for Seam virtual modules when the Vite plugin is unavailable.

### Changed

- Migrated the feature demos, filesystem router demo, GitHub Dashboard, and i18n demo to `createSeamApp()`.

### Removed

- Removed the virtual module proof-of-concept code.

## [0.5.14] - 2026-03-07

### Added

- Added automatic `project.name` resolution from `package.json`.
- Added the `seamVirtual()` Vite plugin and `createSeamApp()` with automatic virtual-module wiring.
- Added dual-output generated client artifacts with inlined `DATA_ID` metadata and type declarations.

## [0.5.13] - 2026-03-06

### Removed

- Removed stale `seam.toml` references from the test suite.

## [0.5.12] - 2026-03-06

### Changed

- Migrated standalone examples, demos, the GitHub Dashboard workspace, and the E2E fixture to `seam.config.ts` and the newer procedure `kind` field.
- Added batch RPC E2E coverage to lock in the new configuration path.

## [0.5.11] - 2026-03-06

### Added

- Added aligned, zero-padded step numbers to CLI output.
- Added a channel-subscription E2E fixture plus filesystem router E2E coverage.

### Changed

- Standardized locale JSON formatting and removed lingering lint suppressions while extending config loader coverage.

## [0.5.10] - 2026-03-06

### Added

- Added `@canmi/seam-query-react` and multiple focused feature demos for stream-upload, context auth, handoff narrowing, and query mutation.
- Added deterministic reload waiting through `nextReload()` and expanded Go integration coverage for the feature demos.
- Added `defineConfig`, `SeamConfig`, support for `seam.config.ts` and `seam.config.mjs`, and Vite config overrides for the built-in bundler.

### Fixed

- Aligned query types with breaking changes in `@tanstack/query-core` v5.90.
- Repaired CLI, publish, and test workflows around `knip`, `build-ts`, forced crate publishing, and injector package paths.
- Removed accidental `rpcHashMap` wiring mistakes from demo servers and restored the intended behavior in the query-mutation demo.

### Changed

- Made the Justfile the single source of truth for local and CI tasks.
- Switched the repository indentation style from spaces to tabs.
- Replaced `seam.toml`-specific wording in the CLI with generic config terminology and migrated demos to `seam.config.ts`.

## [0.5.9] - 2026-03-05

### Added

- Added schema narrowing for page loader projections.
- Added the runtime `seamProcedureConfig` constant to codegen output.
- Added the `@canmi/seam-query` package.

## [0.5.8] - 2026-03-05

### Added

- Added the context system to the Rust server core, the Axum adapter, and the Go server core.

### Fixed

- Applied follow-up lint fixes and committed the required Go engine WASM artifact.

## [0.5.7] - 2026-03-05

### Added

- Added cache hints, route-procedure code generation, and a prefetch SDK.

## [0.5.6] - 2026-03-05

### Added

- Added a procedure reference graph for single-pass extraction.
- Added the `suppress` field and unused query detection.

## [0.5.5] - 2026-03-04

### Added

- Added a transport declaration system with three-layer resolution.

### Changed

- Refreshed the manifest, subscription protocol, architecture notes, README, and package guidance for the transport model.

## [0.5.4] - 2026-03-04

### Added

- Added context field parsing to the manifest and TypeScript codegen.
- Added query parameter support in page loaders.
- Added `handoff: "client"` for one-time server-fetched loaders.

### Changed

- Extracted `handlePage` from `createRouter` to simplify the page-serving pipeline.

## [0.5.3] - 2026-03-04

### Added

- Added `invalidates` parsing and validation in the CLI manifest pipeline and codegen.
- Added the declarative context model to the server core.

## [0.5.2] - 2026-03-04

### Added

- Added `upload` support to `SeamClient`.
- Added declarative `invalidates` metadata to command procedures.

## [0.5.1] - 2026-03-04

### Added

- Added client-side stream support through `SeamClient.stream()` and the `useSeamStream` React hook.
- Added TypeScript server and CLI support for the `upload` procedure kind.

### Fixed

- Tightened `useSeamStream` type narrowing and cleaned up client-package lint issues.

### Changed

- Consolidated client procedure calls behind a shared `callProcedure` path and split supporting CLI, skeleton, server, and codegen helpers.

## [0.5.0] - 2026-03-04

### Added

- Added manifest v2 output and stream procedures with POST plus SSE transport.
- Added CLI parsing and code generation for the new stream kind.

### Fixed

- Updated codegen, server implementations, and tests to read manifest v2 while keeping backward compatibility for v1 consumers.

### Changed

- Renamed procedure definitions from `type` to `kind`.

## [0.4.18] - 2026-03-03

### Added

- Added compact rich-mode step summaries to the CLI.
- Added a filesystem router demo and a standalone Chi example.

### Fixed

- Fixed path grouping nodes, catch-all routes, and hydration behavior in the filesystem router.
- Tightened CI around `golangci-lint`, demo builds, and workspace linting.

### Changed

- Strengthened lint rules across Rust, TypeScript, and Go and split several oversized source files.

## [0.4.17] - 2026-03-02

### Added

- Added the `@canmi/seam-router` filesystem router and `pages_dir` config support.

### Fixed

- Resolved duplicate import names for grouped layouts and added integration coverage for the router.

## [0.4.16] - 2026-03-02

### Fixed

- Increased the SPA timeout for lazy-loaded workspace pages.
- Corrected multiple CLI spacing, indentation, warning, and relative-path display issues.
- Hardened the publish script against scoped package names and shell edge cases.

### Changed

- Reworked CLI progress rendering with dynamic step tracking, TTY-aware output modes, and a broader color palette.

## [0.4.15] - 2026-03-02

### Added

- Added the `@canmi/seam-vite` plugin.
- Added a CLI `--version` flag plus automatic local install behavior after builds.

### Fixed

- Repaired the Vite asset pipeline, TanStack Router lazy component type checks, npm publish version patching, and Go module WASM vendoring.

### Changed

- Unified CLI output around the shared UI design system and replaced the TypeScript build wrapper with a direct binary launcher.

## [0.4.14] - 2026-03-02

### Added

- Added per-page resource splitting for MPA-like initial loads.

## [0.4.13] - 2026-03-02

### Fixed

- Fixed CI type checking, engine type paths, dead code cleanup, and test coverage gaps.

## [0.4.12] - 2026-03-02

### Changed

- Split the CLI skeleton and codegen crates into separate packages and documented both crates.

### Fixed

- Patched skipped crate dependencies to registry versions before publishing.

## [0.4.11] - 2026-03-02

### Changed

- Split i18n support in the TanStack Router package into an optional sub-path export.

## [0.4.10] - 2026-03-02

### Added

- Added dependency-free `DATA_ID` metadata generation, CLI platform wrapper builds, Linux binary compression, and cross-compilation support.

### Fixed

- Updated the toolchain for TanStack Router, Vitest, and Next.js 16 compatibility.
- Repaired npm publishing so CLI wrapper packages and the main CLI package resolve workspace versions correctly.

### Changed

- Renamed `packages/` to `src/` and refreshed versioning, licensing, publishing, and repository structure around that layout.
- Migrated the Rust workspace to edition 2024 and expanded formatting to include `gofmt`.

## [0.4.9] - 2026-03-01

### Added

- Added a warning when `.seam/` is not ignored by Git during build and development.

### Changed

- Updated examples, tests, and docs for the new `data_id` default.

## [0.4.8] - 2026-03-01

### Added

- Added WebSocket transport for channels across all server adapters and the client SDK.
- Added transport hints in codegen for automatic WebSocket channel selection.

### Fixed

- Prevented unnecessary Vite full reloads during `seam dev` rebuilds and synced Go websocket dependencies.

### Changed

- Changed the default `data_id` to `__data` and added a configurable `data_id` parameter to `inject()`.
- Consolidated bundler output under `.seam/dist/`, split several large files, and refreshed protocol and architecture docs.

## [0.4.7] - 2026-02-28

### Added

- Added the Level 1 channel abstraction across all SDKs.
- Added `Router.Manifest()` support to the Go server core.

### Fixed

- Corrected channel event type references in codegen metadata.
- Standardized batch RPC responses under the `{ ok, data }` envelope for Rust and Go.
- Updated protocol URLs and tests across workspace, fullstack, E2E, and Go handler coverage.

## [0.4.6] - 2026-02-28

### Added

- Added query and command dispatch code generation, generated error types, and `SeamProcedureMeta`.
- Added a command example to the Bun demo.

### Fixed

- Handled dot-namespaced procedure names in TypeScript code generation.
- Updated integration coverage for the Level 0 protocol.

## [0.4.5] - 2026-02-28

### Added

- Added query versus command distinction and custom error schemas to the server cores.

## [0.4.4] - 2026-02-28

### Changed

- Aligned the manifest and wire protocol around the v1 specification.
- Refreshed core Rust dependencies used by the workspace.

## [0.4.3] - 2026-02-27

### Fixed

- Switched publishing to `bun publish` so `workspace:*` dependencies resolve correctly.

### Changed

- Restored Bun as the repository package manager after a short pnpm trial.
- Expanded i18n cache, scoping, and SPA regression coverage.

### Removed

- Removed deprecated injector packages from publish and version scripts.

## [0.4.2] - 2026-02-27

### Added

- Added cache-aware locale switching and SPA navigation to the i18n demo.

### Fixed

- Repaired CI setup for the i18n demo and workspace tests and updated a brittle Next.js heading assertion.

### Changed

- Reframed the README and supporting docs around the current rendering model and updated the React package to lazy-load `seam-i18n`.

## [0.4.1] - 2026-02-27

### Added

- Added client-side locale hashes, locale caching, `switchLocale`, and SPA-aware i18n navigation.
- Added a dedicated i18n demo with both prefix and hidden locale modes.

### Fixed

- Repaired the i18n demo build, locale-prefix base path handling, and `cleanLocaleQuery`.

### Changed

- Removed i18n from the GitHub Dashboard example to keep that example focused on its core flow.

## [0.4.0] - 2026-02-27

### Added

- Added the declarative locale resolve strategy chain and the new hashed i18n build and runtime pipeline.
- Added CLI support for fallback resolution, route hashing, and mode-based i18n output.

### Changed

- Replaced merge-and-filter i18n lookups with constant-time route-hash lookup on the server.

### Removed

- Removed `ProcedureCtx`, i18n version payloads, and fallback message payloads from the previous design.

## [0.3.7] - 2026-02-27

### Added

- Added configurable locale resolve strategies and client-side locale storage.

### Fixed

- Passed the request URI into Axum locale resolution and cleared remaining lint warnings in build and test files.

### Changed

- Replaced the monolithic locale resolver with a declarative strategy chain and removed the backward-compatibility wrappers around it.

## [0.3.6] - 2026-02-26

### Fixed

- Added the workspace integration suite to `test:integration`, built WASM before TypeScript in CI, and made the WASM build script portable across macOS and Linux.
- Switched workspace SPA tests from `networkidle` to `domcontentloaded` to reduce flakiness.

### Changed

- Renamed the generated WASM binaries to `injector.wasm` and `engine.wasm`.
- Extracted a shared WASM build script and moved Go page rendering onto `engine.RenderPage`.
- Added WASM building to the verification pipeline and removed dead injector dependencies.

## [0.3.5] - 2026-02-26

### Added

- Added the built-in `__seam_i18n_query` RPC for on-demand translation lookups.
- Added the `seam-engine` Rust crate plus WASM, JavaScript, and Go bridges for shared page assembly logic.

### Fixed

- Added the missing `@canmi/seam-i18n` dependency to `seam-react`.
- Corrected per-layout `_layouts` grouping in Rust and Go backends.

### Changed

- Migrated the TypeScript and Go backends onto the shared engine-based rendering path.

## [0.3.4] - 2026-02-26

### Added

- Added `i18n_keys` collection, version hashing, and per-page key filtering to the build pipeline.
- Added locale-aware `ProcedureCtx` support for procedure handlers.

### Changed

- Escaped non-ASCII characters in generated i18n JSON output without mutating source locale files.

## [0.3.3] - 2026-02-26

### Added

- Added runtime i18n support to the Rust and Go servers.

### Removed

- Removed the previous build-time i18n fallback path.

## [0.3.2] - 2026-02-26

### Added

- Added runtime i18n routing with locale-prefixed URLs.

### Fixed

- Preserved `_i18n` through router context hydration and restored the embedded fallback script path used by the router.

## [0.3.1] - 2026-02-25

### Added

- Added `GITHUB_TOKEN` support across all workspace backends and wired multi-backend build and test jobs into CI.

### Fixed

- Resolved verification pipeline failures and declared the missing `@canmi/seam-react` dependency in the shared package.

### Changed

- Split several large CLI, server, test, and Go files into smaller modules and refreshed the corresponding docs.

## [0.3.0] - 2026-02-25

### Added

- Added workspace-aware build orchestration across multiple backends.
- Added the `seam clean` command with configurable cleanup targets.
- Added full-stack page serving and RPC hash map support for the Rust and Go backends.
- Added workspace matrix parity tests and Next.js SSR coverage.

### Fixed

- Fixed workspace package resolution in linting and aligned nullable JTD semantics across TypeScript, Rust, and Go.
- Repaired i18n hydration, `data_id`, `_layouts`, and Go batch response handling in page-serving flows.

## [0.2.17] - 2026-02-25

### Fixed

- Resolved i18n manifest template loading in the TypeScript server build pipeline.

## [0.2.16] - 2026-02-25

### Added

- Split the Axum adapter out of the server package and added the i18n build pipeline around it.

## [0.2.15] - 2026-02-25

### Added

- Added configurable `data_id` support through `seam.toml`.

### Fixed

- Updated tests to read `data_id` from config instead of relying on a hardcoded value.

## [0.2.14] - 2026-02-25

### Added

- Added build-time extraction of page metadata into `<head>` and made `root_id` configurable.

### Fixed

- Updated E2E asset matching so both historical `type_hint` filename formats continue to pass.

## [0.2.13] - 2026-02-24

### Added

- Added `hash_length` configuration and moved RPC hash rewriting into a compile-time bundler transform.

### Fixed

- Included `_batch` requests in the bundler-side RPC hash transform.

### Changed

- Renamed `typehint` to `type_hint`.

## [0.2.12] - 2026-02-24

### Added

- Added RPC hash obfuscation and static asset name stripping for production output.
- Added longer production hash support for the obfuscation pipeline.

### Fixed

- Embedded the RPC hash map in generated HTML so browser-side obfuscation works without extra configuration.

## [0.2.11] - 2026-02-24

### Added

- Added build-time procedure reference validation with did-you-mean suggestions.
- Added schema-versus-component field mismatch detection through the mock-data proxy.

### Fixed

- Printed skeleton warnings during dev incremental rebuilds and included route paths in browser API error messages.

## [0.2.10] - 2026-02-24

### Added

- Added incremental skeleton caching with per-component esbuild hashing.

### Changed

- Removed temporary debug paths from the skeleton cache implementation.

## [0.2.9] - 2026-02-24

### Added

- Added production asset and cache-header coverage for the new pipeline.

### Fixed

- Stabilized Vite development E2E reads in CI by using `page.content()`.

### Changed

- Switched production builds from Rolldown to Vite.
- Preferred Bun for the skeleton renderer and invoked Vite directly for better build performance.

## [0.2.8] - 2026-02-24

### Added

- Added Vite dev server integration for CTR development with HMR support.

### Fixed

- Routed skeleton rebuilds through the Vite HMR channel and isolated dev build output under `.seam/dev-output/`.

## [0.2.7] - 2026-02-24

### Fixed

- Triggered reload callbacks correctly when the fallback directory watcher creates its first reload marker file.

### Changed

- Added E2E coverage for CTR rendering, SPA navigation, and hydration interactions.
- Documented the newer versioning rule that test-only changes do not require a version bump.

## [0.2.6] - 2026-02-24

### Added

- Added file watching with incremental rebuilds and browser live reload.

## [0.2.5] - 2026-02-24

### Added

- Added CTR development mode with an initial build step and lazy template loading.

## [0.2.4] - 2026-02-24

### Added

- Added per-route `staleTime` support.
- Added an RPC batching mechanism that coalesces calls at the microtask level.

## [0.2.3] - 2026-02-24

### Added

- Added a CTR render guard and a DOM-tree equivalence check to catch template corruption during builds.
- Added `@canmi/eslint-plugin-seam` and enabled its rules on skeleton files used by examples and tests.
- Added the GitHub Dashboard fullstack demo, performance overlay support, and build-time mock data generation from JTD schemas.
- Added output schema validation, warning paths for unsafe open-string style and class slots, and Suspense markers in skeleton templates.
- Added the TanStack Router adapter, SPA navigation helpers, nested layout routing, layout template separation, layout-level data fetching, and shared Rust injector WASM support.
- Added a framework-agnostic Go backend, detailed validation errors, extensible error codes, unified publish tooling, and raw HTML slot injection through `t.html()`.

### Fixed

- Trapped timer APIs in the skeleton sandbox to prevent hung builds and preserved user-authored stylesheets during resource-hint stripping.
- Repaired render-time injection, nullable loader schemas, `seamHydrate` hydration, layout route collisions, default layout chains, WASM output copying, and missing Node typing in several packages.
- Hardened CI and publishing around type resolution, crates.io polling, internal version updates, lockfile sync, and missing workspace dependencies.

### Changed

- Upgraded the CTR check from string comparison to DOM-tree diffing and split the verification pipeline into reusable CI scripts and GitHub Actions jobs.

### Removed

- Removed the deprecated `ProcedureMap` alias.

## [0.2.2] - 2026-02-18

### Added

- Upgraded the TypeScript test scaffold from byte-diff checks to DOM-tree diffing.

### Fixed

- Preserved array empty-state fallbacks in CTR template extraction.
- Corrected multi-attribute injection ordering so Rust output matches the TypeScript source order.

### Changed

- Expanded Rust injector regression coverage for hoisted metadata and edge-case extraction.

## [0.2.1] - 2026-02-18

### Added

- Added more CTR demo pages, a built-in Rolldown-based bundler, an embedded Axum dev server, and shared topological build and test scripts.
- Added Playwright hydration coverage, React 19 CTR coverage, and broader diagnostics for the CTR pipeline.
- Added style object serialization support in the CTR pipeline and a single verification script for the whole repository.

### Fixed

- Fixed recursive template extraction, hydration mismatches, nested tag splitting, and container duplication in CTR template generation.
- Switched skeleton comparison to DOM-tree diffing and fixed SSE error delivery, integration test ports, and linked-package type resolution.
- Added support for hyphenated HTML attributes, HTML boolean attributes, and empty JTD property schemas.

### Changed

- Prepared the workspace for crates.io publishing, introduced package-level `CLAUDE.md` and README files, and refreshed project-wide docs.

## [0.1.0] - 2026-02-15

### Added

- Introduced the Seam monorepo with TypeScript and Rust server cores, client SDKs, adapters for Bun, Node, Hono, and Axum, and an initial CLI with manifest pulling and TypeScript code generation.
- Added page endpoints, loaders, fullstack build support, static asset serving, `seam dev`, `seam build`, and `seam.toml`-driven project configuration.
- Added SSE subscriptions across TypeScript and Rust, a subscription client and React hook, shared HTTP handlers, and integration coverage across server implementations.
- Added the first fullstack examples, including React and Hono plus TanStack demos, Tailwind support, CTR demos, and hydrated SSR flows.
- Added AST-based TypeScript and Rust injectors with array, enum, `match`, `when`, and skeleton extraction support, plus browser data caching and React context integration.

### Fixed

- Fixed XSS exposure in page errors, hydration regressions, conditional rendering sentinels, array and conditional boundary parsing, SSE timeout behavior, and mutation cache invalidation in the early demos.

### Changed

- Reorganized the repository by architectural role, moved example layouts into standalone and fullstack groups, and renamed internal request paths from `/seam/` to `/_seam/`.
- Redesigned CLI output and rebuilt the fullstack production pipeline around the newer SSR-oriented architecture.
