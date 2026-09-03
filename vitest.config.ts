import { defineConfig } from 'vitest/config';

// Colocated with source, which is the workspace's rule. The corpus under `conformance/cases` is
// data these read rather than tests of its own, and `conformance/generate.ts` writes it: a
// generator that ran inside the thing it is checked by would prove nothing.
export default defineConfig({
	test: {
		include: ['pkgs/*/src/**/*.test.ts'],
	},
});
