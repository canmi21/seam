/* examples/github-dashboard/seam-app/seam.config.ts */

import { defineConfig } from '@canmi/seam'

export default defineConfig({
	project: { name: 'github-dashboard' },
	backend: { lang: 'typescript', devCommand: 'bun --watch src/server/index.ts', port: 3000 },
	frontend: { entry: 'src/client/main.tsx' },
	build: {
		backendBuildCommand: 'bun build src/server/index.ts --target=bun --outdir=.seam/output/server',
		routerFile: 'src/server/router.ts',
		routes: './src/client/routes.ts',
		outDir: '.seam/output',
		obfuscate: true,
		hashLength: 16,
		typeHint: false,
	},
	dev: { port: 3000, vitePort: 5173 },
})
