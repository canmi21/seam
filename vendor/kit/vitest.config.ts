// Upstream's own checks over the vendored source, run the way upstream runs them: the aliases
// point Kit's virtual modules at the mocks it ships for them, and only the Node half is kept --
// the client half needs a DOM and a Svelte plugin, and nothing here is consumed from the client
// yet. Named apart from the repository's config so `vitest run` at the root does not pick it up;
// see VENDOR.md and vitest.upstream.config.js.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const mock = (specifier: string): string =>
	fileURLToPath(new URL(`./test/mocks/${specifier}.js`, import.meta.url));

export default defineConfig({
	define: {
		__SVELTEKIT_SERVER_TRACING_ENABLED__: false,
	},
	test: {
		alias: {
			// Longer keys first: vite prefix-matches, so `$app/paths` would take `$app/paths/internal`.
			'$app/env/internal': mock('app-env-internal'),
			'$app/env': mock('app-env'),
			'$app/paths/internal/client': mock('app-paths-internal-client'),
			'$app/paths/internal/server': mock('app-paths-internal-server'),
			'$app/paths': mock('app-paths'),
			'__sveltekit/paths': mock('sveltekit-paths'),
		},
		environment: 'node',
		include: ['src/**/*.spec.js'],
		exclude: [
			'**/node_modules/**',
			'src/**/*.svelte.spec.js',
			// Reads a script upstream keeps beside the package, which is not taken.
			'src/version.spec.js',
			// Reads a built `.svelte-kit` upstream commits as a fixture; build output is not kept
			// here, and adapters are not taken. See VENDOR.md.
			'src/core/adapt/builder.spec.js',
			// The `$types` generator drives the TypeScript compiler API, and the one installed here
			// is a major ahead of the one upstream wrote against; it is not wired and not checked.
			'src/core/sync/write_types/index.spec.js',
		],
	},
});
