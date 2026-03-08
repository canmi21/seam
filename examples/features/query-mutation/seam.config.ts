/* examples/features/query-mutation/seam.config.ts */

import { defineConfig } from '@canmi/seam'

export default defineConfig({
	backend: {
		lang: 'typescript',
		devCommand: 'bun --watch src/server/index.ts',
		port: 3458,
	},
	dev: { port: 3458 },
	frontend: { entry: 'src/client/main.tsx' },
	build: {
		backendBuildCommand: 'bun build src/server/index.ts --target=bun --outdir=.seam/output/server',
		routerFile: 'src/server/router.ts',
		pagesDir: 'src/pages',
		outDir: '.seam/output',
	},
})
