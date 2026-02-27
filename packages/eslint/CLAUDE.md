# @canmi/eslint-plugin-seam

ESLint plugin enforcing build-time safety for skeleton components rendered via `renderToString`.

## Architecture

- Skeleton components (`*-skeleton.tsx`) run at build time through React `renderToString`
- No browser APIs, async operations, or non-deterministic logic allowed
- Each rule lives in `src/rules/` as a standalone `Rule.RuleModule`
- Plugin entry (`src/index.ts`) exports `rules` map and `configs.recommended`
- `configs.recommended` scopes all rules to `**/*-skeleton.tsx` via flat config `files` glob

## Key Files

| File                                           | Purpose                                          |
| ---------------------------------------------- | ------------------------------------------------ |
| `src/index.ts`                                 | Plugin entry: exports rules + recommended config |
| `src/rules/no-browser-apis-in-skeleton.ts`     | Bans window, document, localStorage, etc.        |
| `src/rules/no-async-in-skeleton.ts`            | Bans async/await, Promises, fetch, setTimeout    |
| `src/rules/no-nondeterministic-in-skeleton.ts` | Bans Date.now, Math.random, crypto               |

## Testing

```sh
pnpm --filter '@canmi/eslint-plugin-seam' test
```

- Tests in `__tests__/` use vitest + ESLint `RuleTester`
- Each test file mirrors a rule file: `no-browser-apis-in-skeleton.test.ts`, etc.
- `valid` cases: code that should NOT trigger the rule
- `invalid` cases: code that SHOULD produce errors (with expected `messageId`)

## Rule Development Workflow

1. Add AST visitors in the rule's `create()` method
2. Add `invalid` test cases with expected `errors: [{ messageId: "..." }]`
3. Run `pnpm --filter '@canmi/eslint-plugin-seam' test` to verify
4. Build with `pnpm --filter '@canmi/eslint-plugin-seam' build`

See root CLAUDE.md for project-wide conventions.
