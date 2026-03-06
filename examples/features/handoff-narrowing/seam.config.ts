/* examples/features/handoff-narrowing/seam.config.ts */

import { defineConfig } from '@canmi/seam-cli/config'

export default defineConfig({
	project: { name: 'handoff-narrowing-demo' },
	backend: {
		lang: 'typescript',
		devCommand: 'bun --watch src/server/index.ts',
		port: 3459,
	},
	dev: { port: 3459 },
	frontend: { entry: 'src/client/main.tsx' },
	build: {
		backendBuildCommand: 'bun build src/server/index.ts --target=bun --outdir=.seam/output/server',
		routerFile: 'src/server/router.ts',
		pagesDir: 'src/pages',
		outDir: '.seam/output',
	},
})
