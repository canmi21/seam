# github-dashboard-seam-app

Fullstack single-package deployment of the [GitHub Dashboard](../README.md), combining server and client in one SeamJS app.

## Structure

- `src/server/` — Router, procedures, and server entry
- `src/client/` — App entry and route definitions
- `src/generated/` — Generated RPC client

## Development

- Dev: `seam dev`
- Build: `seam build`

## Notes

- Build output at `.seam/output/` is required by workspace backends and E2E tests
