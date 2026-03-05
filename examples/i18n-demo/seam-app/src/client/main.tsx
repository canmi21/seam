/* examples/i18n-demo/seam-app/src/client/main.tsx */

import { seamHydrate } from '@canmi/seam-tanstack-router'
import { SeamI18nBridge } from '@canmi/seam-tanstack-router/i18n'
import routes from './routes.js'

const root = document.getElementById('__seam')
if (!root) throw new Error('Missing #__seam element')

seamHydrate({
	routes,
	root,
	i18nBridge: SeamI18nBridge,
	cleanLocaleQuery: true,
})
