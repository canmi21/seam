# @canmi/seam-server

Framework-agnostic server core: defines procedures, subscriptions, pages, and the HTTP protocol layer that adapters consume.

See root CLAUDE.md for general project rules.

## Architecture

```
src/
  index.ts          -- Public API barrel (all exports go through here)
  http.ts           -- createHttpHandler, SSE helpers, serialize, toWebResponse
  proxy.ts          -- createDevProxy (forward to Vite), createStaticHandler
  procedure.ts      -- Internal types: InternalProcedure, InternalSubscription, HandleResult
  subscription.ts   -- fromCallback: bridge callback event sources to AsyncGenerator
  errors.ts         -- SeamError class with open error codes + status, DEFAULT_STATUS map
  mime.ts            -- MIME_TYPES lookup table
  types/
    schema.ts       -- SchemaNode<T> wrapper around JTD Schema (phantom type)
    primitives.ts   -- t.string(), t.int32(), t.float64(), etc.
    composites.ts   -- t.object(), t.array(), t.optional(), t.enum(), t.discriminator()
    index.ts        -- Assembles `t` namespace from primitives + composites
  router/
    index.ts        -- createRouter: wires procedures, subscriptions, pages together
    handler.ts      -- handleRequest (RPC), handleSubscription (SSE stream)
  page/
    index.ts        -- PageDef, LoaderFn, definePage()
    handler.ts      -- handlePageRequest: runs loaders, injects data into template
    route-matcher.ts -- RouteMatcher: pattern matching with `:param` segments
    build-loader.ts -- loadBuildOutput: reads route-manifest.json from build output
  manifest/
    index.ts        -- buildManifest: generates procedure manifest from definitions
  validation/
    index.ts        -- validateInput: JTD validation via `jtd` library
```

## Data Flow

- **RPC**: `POST /_seam/rpc/{name}` -> `createHttpHandler` -> `router.handle` -> `handleRequest` -> validate input -> call procedure handler -> JSON response
- **SSE**: `GET /_seam/subscribe/{name}?input=` -> `createHttpHandler` -> `router.handleSubscription` -> `handleSubscription` -> yield SSE events
- **Page**: `GET /_seam/page/{path}` -> `createHttpHandler` -> `router.handlePage` -> `RouteMatcher` -> `handlePageRequest` -> run loaders -> inject into template
- **Manifest**: `GET /_seam/manifest.json` -> `router.manifest()` -> `buildManifest`

## Key Patterns

- Type system uses phantom types: `SchemaNode<T>` carries JTD schema at runtime, TypeScript type `T` at compile time
- `createRouter` splits `DefinitionMap` into separate `procedureMap` and `subscriptionMap` based on presence of `type: "subscription"`
- `HttpResponse` is a union: `HttpBodyResponse | HttpStreamResponse` -- adapters check for `"stream" in result`
- `toWebResponse` converts `HttpResponse` to Web API `Response` (used by Hono/Bun adapters); Node adapter uses its own `sendResponse` instead
- `fromCallback` bridges callback-style event emitters to `AsyncGenerator` for subscription handlers

## Dependencies

| Dependency             | Purpose                                   |
| ---------------------- | ----------------------------------------- |
| `jtd`                  | JSON Type Definition validation           |
| `@canmi/seam-injector` | Template injection (used in page handler) |

## Commands

- Build: `bun run --filter '@canmi/seam-server' build`
- Test: `bun run --filter '@canmi/seam-server' test`

## Gotchas

- Page handler skips JTD validation on loader input (trusted server-side code)
- `serialize` handles both string passthrough and JSON.stringify -- used by adapters for body serialization
- Build tool is `tsdown`, not `tsc` -- single ESM entry point with .d.ts generation
