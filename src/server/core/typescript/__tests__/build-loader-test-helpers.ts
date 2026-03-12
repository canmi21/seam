/* src/server/core/typescript/__tests__/build-loader-test-helpers.ts */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface BuildFixture {
	distDir: string
	cleanup: () => void
	restoreUserTemplate: () => void
}

export function createBaseBuildFixture(): BuildFixture {
	const distDir = mkdtempSync(join(tmpdir(), 'seam-build-test-'))
	mkdirSync(join(distDir, 'templates'))

	writeFileSync(
		join(distDir, 'templates/user-id.html'),
		'<!DOCTYPE html><html><body><!--seam:user.name--></body></html>',
	)

	writeFileSync(
		join(distDir, 'route-manifest.json'),
		JSON.stringify({
			routes: {
				'/user/:id': {
					template: 'templates/user-id.html',
					loaders: {
						user: {
							procedure: 'getUser',
							params: { id: { from: 'route', type: 'int' } },
						},
					},
				},
				'/about': {
					template: 'templates/user-id.html',
					loaders: {
						info: {
							procedure: 'getInfo',
							params: { slug: 'route' },
						},
					},
				},
			},
		}),
	)

	return {
		distDir,
		cleanup: () => rmSync(distDir, { recursive: true, force: true }),
		restoreUserTemplate: () => {
			writeFileSync(
				join(distDir, 'templates/user-id.html'),
				'<!DOCTYPE html><html><body><!--seam:user.name--></body></html>',
			)
		},
	}
}
