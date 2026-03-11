/* examples/shadcn-ui-demo/seam.config.ts */

import { defineConfig } from '@canmi/seam'

export default defineConfig({
	project: { name: 'shadcn-ui-demo' },
	backend: { lang: 'typescript', devCommand: 'bun --watch src/server/index.ts' },
	frontend: { entry: 'src/client/main.tsx' },
	build: {
		backendBuildCommand: 'bun build src/server/index.ts --target=bun --outdir=.seam/output/server',
		routerFile: 'src/server/router.ts',
		routes: './src/client/routes.ts',
		outDir: '.seam/output',
	},
})
