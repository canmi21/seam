/* examples/standalone/server-node/seam.config.ts */

import { defineConfig } from '@canmi/seam'

export default defineConfig({
	project: { name: 'server-node-example' },
	backend: { lang: 'typescript', devCommand: 'node --watch-path=src src/index.ts', port: 3000 },
})
