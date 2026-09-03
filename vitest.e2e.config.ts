import { defineConfig } from 'vitest/config';

// A step of its own, not part of `verify`. It needs a browser on the machine, and it exists for
// the two claims a DOM implementation cannot settle rather than for coverage. See spec/build.md.
export default defineConfig({
	ssr: { resolve: { conditions: ['browser'] } },
	test: {
		include: ['pkgs/*/src/**/*.e2e.ts'],
		testTimeout: 60_000,
		hookTimeout: 180_000,
	},
});
