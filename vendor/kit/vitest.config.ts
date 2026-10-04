// Upstream's own checks over the vendored source, run the way upstream runs them: the aliases
// point Kit's virtual modules at the mocks it ships for them, and only the Node half is kept --
// the client half needs a DOM and a Svelte plugin, and nothing here is consumed from the client
// yet. Named apart from the repository's config so `vitest run` at the root does not pick it up;
// see VENDOR.md and vitest.upstream.config.js.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const mock = (specifier: string): string =>
	fileURLToPath(new URL(`./test/mocks/${specifier}.js`, import.meta.url));

// Upstream's custom matchers, `toThrowKitError` among them, registered in every spec as upstream's
// own config registers them.
const setupFiles = [fileURLToPath(new URL('./test/matchers.js', import.meta.url))];

export default defineConfig({
	define: {
		__SVELTEKIT_GLOBAL_NAME__: '"__sveltekit_test"',
		__SVELTEKIT_SERVER_TRACING_ENABLED__: false,
		__SVELTEKIT_APP_VERSION_POLL_INTERVAL__: 0,
		__SVELTEKIT_APP_VERSION_CHECKS_ENABLED__: false,
	},
	test: {
		alias: {
			// Longer keys first: vite prefix-matches, so `$app/paths` would take `$app/paths/internal`.
			'#app/paths': mock('app-paths'),
			'$app/env': mock('app-env'),
			'$app/paths/internal/client': mock('app-paths-internal-client'),
			'$app/paths/internal/server': mock('app-paths-internal-server'),
			'<sveltekit:generated>/server.js': mock('generated-server'),
		},
		environment: 'node',
		setupFiles,
		include: ['src/**/*.spec.js'],
		exclude: [
			'**/node_modules/**',
			'src/**/*.svelte.spec.js',
			// The client runtime's own specs, which upstream runs in its jsdom project alone.
			'src/runtime/client/**/*.spec.js',
			// Reads a script upstream keeps beside the package, which is not taken.
			'src/version.spec.js',
			// Reads a built `.svelte-kit` upstream commits as a fixture; build output is not kept
			// here, and adapters are not taken. See VENDOR.md.
			'src/core/adapt/builder.spec.js',
			// The `$types` generator and the tsconfig writer drive the TypeScript compiler API, and
			// the one installed here is a major ahead of the one upstream wrote against -- `ts.sys`
			// is not in it; neither is wired and neither is checked.
			'src/core/sync/write_types/index.spec.js',
			'src/core/sync/write_tsconfig/index.spec.js',
			// Reads `test/apps/basics`, one of upstream's test applications, which are not taken
			// here; they are stage two's, see spec/conformance.md.
			'src/core/sync/sync.spec.js',
		],
	},
});
