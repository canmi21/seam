/* examples/github-dashboard/backends/ts-hono/seam.config.ts */

import { defineConfig } from '@canmi/seam'

export default defineConfig({
	project: { name: 'ts-hono' },
	backend: { lang: 'typescript', devCommand: 'bun --watch src/index.ts', port: 3000 },
	build: {
		backendBuildCommand:
			'bun build src/index.ts --target=bun --outdir=../../.seam/output/ts-hono/server',
		routerFile: 'src/router.ts',
	},
})
