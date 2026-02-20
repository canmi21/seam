# tests/fullstack

Go integration tests for the GitHub Dashboard demo (`examples/github-dashboard/seam-app`), verifying page rendering, RPC, and static assets after `seam build`.

See root CLAUDE.md for general project rules.

## Prerequisites

Build output must exist before running:

```sh
cd examples/github-dashboard/seam-app && seam build
```

The test checks for `.seam/output/route-manifest.json` and exits immediately if missing.

## Running

```sh
cd tests/fullstack && go test -v -count=1
```

- Starts the built server on a dynamically allocated free port
- Tests: manifest, RPC (getUser with octocat), page rendering (home, dashboard/octocat), static asset caching

## Procedures

- `getHomeData` — returns static tagline
- `getUser` — calls GitHub API for user profile
- `getUserRepos` — calls GitHub API for top repositories

## Gotchas

- Server runs from `.seam/output/` directory, not the source directory
- Tests verify `Cache-Control: immutable` on static assets and absence of unresolved `<!--seam:` markers in rendered HTML
- `TestRPCQuery` calls GitHub API (requires network access); uses `octocat` which is a stable public user
