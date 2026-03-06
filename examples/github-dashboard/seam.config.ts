/* examples/github-dashboard/seam.config.ts */

import { defineConfig } from '@canmi/seam-cli/config'

export default defineConfig({
	frontend: { entry: 'frontend/src/client/main.tsx' },
	build: {
		routes: 'frontend/src/client/routes.ts',
		bundlerCommand: 'cd frontend && bunx vite build',
		bundlerManifest: 'frontend/.seam/dist/.vite/manifest.json',
		outDir: '.seam/output',
		obfuscate: true,
		hashLength: 16,
		typeHint: false,
	},
	generate: { outDir: 'frontend/src/generated' },
	i18n: { locales: ['en', 'zh'], default: 'en', messagesDir: 'frontend/locales' },
	dev: { port: 3000, vitePort: 5173 },
	workspace: { members: ['backends/ts-hono', 'backends/rust-axum', 'backends/go-gin'] },
})
