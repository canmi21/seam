# GitHub Dashboard

Same React UI rendered two ways: SeamJS CTR vs Next.js SSR. The CTR side runs on three interchangeable backends (TypeScript, Rust, Go) sharing one React frontend; the Next.js side uses conventional server components. Both fetch live data from the GitHub API.

|         | App                                                      | Backend     | Description                                     |
| ------- | -------------------------------------------------------- | ----------- | ----------------------------------------------- |
| **CTR** | [seam-app](seam-app/)                                    | Hono on Bun | Fullstack — frontend and server in one package  |
| **SSR** | [next-app](next-app/)                                    | Next.js     | Server-rendered comparison (same UI, no CTR)    |
| **CTR** | [frontend](frontend/) + [ts-hono](backends/ts-hono/)     | Hono on Bun | Workspace — shared frontend, TypeScript backend |
| **CTR** | [frontend](frontend/) + [rust-axum](backends/rust-axum/) | Axum        | Workspace — shared frontend, Rust backend       |
| **CTR** | [frontend](frontend/) + [go-gin](backends/go-gin/)       | Gin         | Workspace — shared frontend, Go backend         |

The three workspace backends serve identical CTR-rendered pages with the same RPC procedures — a cross-language parity test for the seam protocol.
