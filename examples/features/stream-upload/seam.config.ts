/* examples/features/stream-upload/seam.config.ts */

import { defineConfig } from '@canmi/seam-cli/config'

export default defineConfig({
	backend: {
		lang: 'typescript',
		devCommand: 'bun --watch src/server/index.ts',
		port: 3456,
	},
	dev: { port: 3456 },
	frontend: { entry: 'src/client/main.tsx' },
	build: {
		backendBuildCommand: 'bun build src/server/index.ts --target=bun --outdir=.seam/output/server',
		routerFile: 'src/server/router.ts',
		pagesDir: 'src/pages',
		outDir: '.seam/output',
	},
})
