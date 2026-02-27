# @canmi/eslint-plugin-seam

ESLint rules that enforce build-time safety constraints for SeamJS skeleton components (`*-skeleton.tsx`).

## Rules

| Rule                              | Description                                                            | Status |
| --------------------------------- | ---------------------------------------------------------------------- | ------ |
| `no-browser-apis-in-skeleton`     | Disallow browser-only APIs (window, document, localStorage, etc.)      | Stub   |
| `no-async-in-skeleton`            | Disallow async operations (async/await, Promises, fetch, setTimeout)   | Stub   |
| `no-nondeterministic-in-skeleton` | Disallow non-deterministic expressions (Date.now, Math.random, crypto) | Stub   |

## Usage

Add the recommended config to your ESLint flat config:

```js
import seamPlugin from "@canmi/eslint-plugin-seam";

export default [
  ...seamPlugin.configs.recommended,
  // your other configs...
];
```

The recommended config scopes all rules to `**/*-skeleton.tsx` files as `"error"`.

## Development

- Build: `pnpm --filter '@canmi/eslint-plugin-seam' build`
- Test: `pnpm --filter '@canmi/eslint-plugin-seam' test`
