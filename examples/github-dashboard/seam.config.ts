/* examples/github-dashboard/seam.config.ts */

import { defineConfig } from '@canmi/seam'

export default defineConfig({
	frontend: { entry: 'frontend/src/client/main.tsx' },
	build: {
		routes: 'frontend/src/client/routes.ts',
		outDir: '.seam/output',
		obfuscate: true,
		hashLength: 16,
		typeHint: false,
	},
	i18n: { locales: ['en', 'zh'], default: 'en', messagesDir: 'frontend/locales' },
	dev: { port: 3000, vitePort: 5173 },
	workspace: { members: ['backends/ts-hono', 'backends/rust-axum', 'backends/go-gin'] },
})
