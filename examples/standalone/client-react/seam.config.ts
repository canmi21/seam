/* examples/standalone/client-react/seam.config.ts */

import { defineConfig } from '@canmi/seam'

export default defineConfig({
	project: { name: 'client-react-example' },
	frontend: { entry: 'src/main.tsx' },
	build: {
		routes: './src/routes.ts',
		outDir: '.seam/output',
		renderer: 'react',
	},
})
