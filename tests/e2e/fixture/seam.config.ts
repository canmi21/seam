/* tests/e2e/fixture/seam.config.ts */

import { defineConfig } from '@canmi/seam-cli/config'

export default defineConfig({
	backend: { lang: 'typescript', devCommand: 'bun --watch src/server/index.ts', port: 3000 },
	frontend: { entry: 'src/client/main.tsx', dataId: '__e2e' },
	build: {
		backendBuildCommand: 'bun build src/server/index.ts --target=bun --outdir=.seam/output/server',
		routerFile: 'src/server/router.ts',
		routes: './src/client/routes.ts',
		outDir: '.seam/output',
	},
})
