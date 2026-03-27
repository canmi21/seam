/* examples/github-dashboard/next-app/next.config.ts */

import { resolve } from 'node:path'
import type { NextConfig } from 'next'

const config: NextConfig = {
	outputFileTracingRoot: resolve(process.cwd(), '../../..'),
	transpilePackages: ['@github-dashboard/shared'],
	webpack: (webpackConfig) => {
		// Allow .js imports to resolve .tsx/.ts files (ESM convention used by shared package)
		webpackConfig.resolve.extensionAlias = {
			'.js': ['.ts', '.tsx', '.js'],
		}
		return webpackConfig
	},
}

export default config
