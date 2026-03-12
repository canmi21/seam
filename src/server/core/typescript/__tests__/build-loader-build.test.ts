/* src/server/core/typescript/__tests__/build-loader-build.test.ts */
/* oxlint-disable @typescript-eslint/no-non-null-assertion */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBuild, loadBuildDev, loadRpcHashMap } from '../src/page/build-loader.js'
import { createBaseBuildFixture } from './build-loader-test-helpers.js'

let fixture: ReturnType<typeof createBaseBuildFixture>
let distDir: string

beforeAll(() => {
	fixture = createBaseBuildFixture()
	distDir = fixture.distDir
})

afterAll(() => {
	fixture.cleanup()
})

describe('loadBuild publicDir', () => {
	it('loads production public-root when present', () => {
		const dir = mkdtempSync(join(tmpdir(), 'seam-public-root-'))
		mkdirSync(join(dir, 'templates'))
		mkdirSync(join(dir, 'public-root', 'images'), { recursive: true })
		writeFileSync(join(dir, 'templates/index.html'), '<p>body</p>')
		writeFileSync(join(dir, 'public-root', 'images/logo.png'), 'png')
		writeFileSync(
			join(dir, 'route-manifest.json'),
			JSON.stringify({
				routes: {
					'/': {
						template: 'templates/index.html',
						loaders: {},
					},
				},
			}),
		)
		try {
			const build = loadBuild(dir)
			expect(build.publicDir).toBe(join(dir, 'public-root'))
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it('loads source public dir in dev mode from env override', () => {
		const dir = mkdtempSync(join(tmpdir(), 'seam-dev-public-env-'))
		const publicDir = mkdtempSync(join(tmpdir(), 'seam-dev-public-src-'))
		mkdirSync(join(dir, 'templates'))
		mkdirSync(join(publicDir, 'images'), { recursive: true })
		writeFileSync(join(dir, 'templates/index.html'), '<p>body</p>')
		writeFileSync(join(publicDir, 'images/logo.png'), 'png')
		writeFileSync(
			join(dir, 'route-manifest.json'),
			JSON.stringify({
				routes: {
					'/': {
						template: 'templates/index.html',
						loaders: {},
					},
				},
			}),
		)

		const prev = process.env.SEAM_PUBLIC_DIR
		process.env.SEAM_PUBLIC_DIR = publicDir
		try {
			const build = loadBuildDev(dir)
			expect(build.publicDir).toBe(publicDir)
		} finally {
			if (prev === undefined) delete process.env.SEAM_PUBLIC_DIR
			else process.env.SEAM_PUBLIC_DIR = prev
			rmSync(dir, { recursive: true, force: true })
			rmSync(publicDir, { recursive: true, force: true })
		}
	})
})

describe('loadRpcHashMap', () => {
	it('returns hash map when file exists', () => {
		const hashDir = mkdtempSync(join(tmpdir(), 'seam-hashmap-'))
		writeFileSync(
			join(hashDir, 'rpc-hash-map.json'),
			JSON.stringify({
				salt: 'abcd1234abcd1234',
				batch: 'e5f6a7b8',
				procedures: { getUser: 'a1b2c3d4', getSession: 'c9d0e1f2' },
			}),
		)
		try {
			const map = loadRpcHashMap(hashDir)
			expect(map).toBeDefined()
			expect(map!.batch).toBe('e5f6a7b8')
			expect(map!.procedures.getUser).toBe('a1b2c3d4')
		} finally {
			rmSync(hashDir, { recursive: true, force: true })
		}
	})

	it('returns undefined when file does not exist', () => {
		const emptyDir = mkdtempSync(join(tmpdir(), 'seam-no-hashmap-'))
		try {
			const map = loadRpcHashMap(emptyDir)
			expect(map).toBeUndefined()
		} finally {
			rmSync(emptyDir, { recursive: true, force: true })
		}
	})
})

describe('loadBuild', () => {
	it('returns pages, rpcHashMap, and i18n from a single call', () => {
		const build = loadBuild(distDir)
		expect(Object.keys(build.pages)).toEqual(['/user/:id', '/about'])
		expect(build.rpcHashMap).toBeUndefined()
		expect(build.i18n).toBeNull()
	})

	it('includes rpcHashMap when rpc-hash-map.json exists', () => {
		const hashDir = mkdtempSync(join(tmpdir(), 'seam-loadbuild-hash-'))
		mkdirSync(join(hashDir, 'templates'))
		writeFileSync(join(hashDir, 'templates/index.html'), '<p>hi</p>')
		writeFileSync(
			join(hashDir, 'route-manifest.json'),
			JSON.stringify({ routes: { '/': { template: 'templates/index.html', loaders: {} } } }),
		)
		writeFileSync(
			join(hashDir, 'rpc-hash-map.json'),
			JSON.stringify({ salt: 'x', batch: 'b1', procedures: { foo: 'h1' } }),
		)
		try {
			const build = loadBuild(hashDir)
			expect(build.rpcHashMap).toBeDefined()
			expect(build.rpcHashMap!.procedures.foo).toBe('h1')
		} finally {
			rmSync(hashDir, { recursive: true, force: true })
		}
	})
})

describe('loadBuildDev', () => {
	it('returns lazy templates with same structure', () => {
		const build = loadBuildDev(distDir)
		expect(Object.keys(build.pages)).toEqual(['/user/:id', '/about'])
		expect(build.pages['/user/:id'].template).toContain('<!--seam:user.name-->')
		expect(build.rpcHashMap).toBeUndefined()
		expect(build.i18n).toBeNull()
	})
})
