/* examples/features/channel-subscription/seam.config.ts */

import { defineConfig } from '@canmi/seam-cli/config'

export default defineConfig({
	backend: {
		lang: 'typescript',
		devCommand: 'bun --watch src/server/index.ts',
		port: 3484,
	},
	dev: { port: 3484 },
	frontend: { entry: 'src/client/main.tsx' },
	build: {
		backendBuildCommand: 'bun build src/server/index.ts --target=bun --outdir=.seam/output/server',
		routerFile: 'src/server/router.ts',
		pagesDir: 'src/pages',
		outDir: '.seam/output',
	},
})
