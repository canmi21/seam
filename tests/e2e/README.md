# seam-e2e

Playwright end-to-end tests covering standalone fixtures, fullstack GitHub Dashboard, workspace backends, Next.js, and i18n demo.

## Structure

- `specs/` — Test spec files
- `fixture/` — Standalone test fixture (internal, has its own build output)
- `playwright.config.ts` — 9 project configurations across multiple output directories

## Test Targets

| Output directory                                  | Scope                                    |
| ------------------------------------------------- | ---------------------------------------- |
| `fixture/.seam/output`                            | Standalone fixture pages                 |
| `examples/github-dashboard/seam-app/.seam/output` | Fullstack dashboard + workspace backends |
| `examples/i18n-demo/seam-app/.seam/output`        | i18n prefix and hidden modes             |

## Development

- Run: `bun run test` (requires build output from targets above)
- UI mode: `bun run test:ui`

## Notes

- Requires `GITHUB_TOKEN` in root `.env` for API rate limit boost
- Build prerequisites: run `seam build` in each target app before testing
