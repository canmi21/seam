import { defineConfig } from 'vitest/config';

// Colocated with source, which is the workspace's rule. The corpus under `corpus/cases` is
// data these read rather than tests of its own, and `corpus/generate.ts` writes it: a
// generator that ran inside the thing it is checked by would prove nothing.
export default defineConfig({
	// Svelte's `.` export resolves to its server build under Node's conditions, so `hydrate` would
	// be the one that refuses to run. The hydration check needs the client half, and asking for it
	// by condition is how the package says to: `svelte/server` and `svelte/compiler` have no browser
	// variant, so nothing else moves.
	ssr: { resolve: { conditions: ['browser'] } },
	test: {
		include: ['pkgs/*/src/**/*.test.ts'],
	},
});
