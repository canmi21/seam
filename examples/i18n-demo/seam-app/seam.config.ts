/* examples/i18n-demo/seam-app/seam.config.ts */

import { defineConfig } from '@canmi/seam'

export default defineConfig({
	project: { name: 'i18n-demo' },
	backend: { lang: 'typescript' },
	frontend: { entry: 'src/client/main.tsx' },
	build: {
		backendBuildCommand: 'true',
		routerFile: 'src/server/router.ts',
		routes: './src/client/routes.ts',
		outDir: '.seam/output',
	},
	i18n: { locales: ['en', 'zh'], default: 'en', cache: true },
})
