/* src/cli/vite/__tests__/plugins.test.ts */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { seamVirtual, seam } from '../src/index.js'
import type { Plugin } from 'vite'

let tmpDir: string | undefined

const ENV_KEYS = [
	'SEAM_DIST_DIR',
	'SEAM_OBFUSCATE',
	'SEAM_SOURCEMAP',
	'SEAM_ENTRY',
	'SEAM_TYPE_HINT',
	'SEAM_HASH_LENGTH',
	'SEAM_RPC_MAP_PATH',
	'SEAM_ROUTES_FILE',
	'SEAM_DEV_OUT_DIR',
]

const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
	for (const k of ENV_KEYS) {
		savedEnv[k] = process.env[k]
		delete process.env[k]
	}
})

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k]
		else process.env[k] = savedEnv[k]
	}
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true })
		tmpDir = undefined
	}
})

function createTmpDir(): string {
	tmpDir = mkdtempSync(join(tmpdir(), 'seam-vite-plugins-'))
	return tmpDir
}

type PluginWithConfig = Plugin & {
	config: (userConfig: Record<string, unknown>) => Record<string, unknown>
}

type PluginWithResolve = Plugin & {
	configResolved: (config: { root: string }) => void
	resolveId: (id: string) => string | undefined
}

describe('seamVirtual', () => {
	it('config hardens optimizeDeps for linked router and hydration entries', () => {
		const plugin = seamVirtual() as PluginWithConfig
		const result = plugin.config({}) as {
			optimizeDeps: { exclude: string[]; include: string[] }
		}
		expect(result.optimizeDeps.exclude).toEqual([
			'@canmi/seam-react',
			'@canmi/seam-tanstack-router',
			'@canmi/seam-client',
		])
		expect(result.optimizeDeps.include).toEqual(['@tanstack/react-router', 'react-dom/client'])
	})

	it('resolveId returns absolute path when file exists', () => {
		const dir = createTmpDir()
		const seamDir = join(dir, '.seam', 'generated')
		mkdirSync(seamDir, { recursive: true })
		writeFileSync(join(seamDir, 'client.ts'), 'export const x = 1')

		const plugin = seamVirtual() as PluginWithResolve
		plugin.configResolved({ root: dir })
		const result = plugin.resolveId('virtual:seam/client')
		expect(result).toBe(join(dir, '.seam/generated/client.ts'))
	})

	it('resolveId returns \\0-prefixed id when file missing', () => {
		const dir = createTmpDir()
		const plugin = seamVirtual() as PluginWithResolve
		plugin.configResolved({ root: dir })
		expect(plugin.resolveId('virtual:seam/client')).toBe('\0virtual:seam/client')
	})

	it('resolveId returns undefined for non-virtual', () => {
		const dir = createTmpDir()
		const plugin = seamVirtual() as PluginWithResolve
		plugin.configResolved({ root: dir })
		expect(plugin.resolveId('react')).toBeUndefined()
	})

	it('resolveId rejects path traversal attempts', () => {
		const dir = createTmpDir()
		const plugin = seamVirtual() as PluginWithResolve
		plugin.configResolved({ root: dir })
		// VIRTUAL_MODULES is a fixed allowlist; traversal IDs never match
		expect(plugin.resolveId('virtual:seam/../../../etc/passwd')).toBeUndefined()
		expect(plugin.resolveId('virtual:seam/client/../secret')).toBeUndefined()
	})

	it('load returns fallback for each virtual module', () => {
		const plugin = seamVirtual() as Plugin & { load: (id: string) => string | undefined }
		expect(plugin.load('\0virtual:seam/routes')).toBe('export default []')
		expect(plugin.load('\0virtual:seam/client')).toBe('export const DATA_ID = "__data"')
		expect(plugin.load('\0virtual:seam/meta')).toBe('export const DATA_ID = "__data"')
		expect(plugin.load('\0virtual:seam/hooks')).toBe('')
	})
})

describe('seamConfigPlugin (via seam())', () => {
	it('defaults outDir to .seam/dist', () => {
		const plugins = seam()
		const plugin = plugins.find((p) => p.name === 'seam-config') as PluginWithConfig
		const result = plugin.config({})
		expect((result.build as { outDir: string }).outDir).toBe('.seam/dist')
	})

	it('sets outDir from SEAM_DIST_DIR', () => {
		process.env.SEAM_DIST_DIR = 'custom/dist'
		const plugins = seam()
		const plugin = plugins.find((p) => p.name === 'seam-config') as PluginWithConfig
		const result = plugin.config({})
		expect((result.build as { outDir: string }).outDir).toBe('custom/dist')
	})

	it('enables sourcemap when SEAM_SOURCEMAP=1', () => {
		process.env.SEAM_SOURCEMAP = '1'
		const plugins = seam()
		const plugin = plugins.find((p) => p.name === 'seam-config') as PluginWithConfig
		const result = plugin.config({})
		expect((result.build as { sourcemap: boolean }).sourcemap).toBe(true)
	})

	it('obfuscation naming when SEAM_OBFUSCATE=1', () => {
		process.env.SEAM_OBFUSCATE = '1'
		const plugins = seam()
		const plugin = plugins.find((p) => p.name === 'seam-config') as PluginWithConfig
		const result = plugin.config({})
		const output = (result.build as { rolldownOptions: { output: { entryFileNames: string } } })
			.rolldownOptions.output
		expect(output.entryFileNames).toContain('hash')
	})
})

describe('seamRpcPlugin (via seam())', () => {
	it('noop when SEAM_RPC_MAP_PATH unset', () => {
		const plugins = seam()
		const rpcPlugin = plugins.find(
			(p) => p.name === 'seam-rpc-noop' || p.name === 'seam-rpc-transform',
		)
		expect(rpcPlugin?.name).toBe('seam-rpc-noop')
	})

	it('buildStart reads procedure map', () => {
		const dir = createTmpDir()
		const mapPath = join(dir, 'rpc-map.json')
		writeFileSync(mapPath, JSON.stringify({ procedures: { 'user.list': 'abc123' }, batch: '_b' }))
		process.env.SEAM_RPC_MAP_PATH = mapPath

		const plugins = seam()
		const rpcPlugin = plugins.find((p) => p.name === 'seam-rpc-transform') as Plugin & {
			buildStart: () => void
		}
		expect(rpcPlugin).toBeDefined()
		rpcPlugin.buildStart()
	})

	it('transform replaces procedure names', () => {
		const dir = createTmpDir()
		const mapPath = join(dir, 'rpc-map.json')
		writeFileSync(mapPath, JSON.stringify({ procedures: { 'user.list': 'abc123' }, batch: '_b' }))
		process.env.SEAM_RPC_MAP_PATH = mapPath

		const plugins = seam()
		const rpcPlugin = plugins.find((p) => p.name === 'seam-rpc-transform') as Plugin & {
			buildStart: () => void
			transform: (code: string, id: string) => { code: string } | undefined
		}
		rpcPlugin.buildStart()
		const result = rpcPlugin.transform('const p = "user.list"', '/src/app.ts')
		expect(result?.code).toContain('abc123')
		expect(result?.code).not.toContain('user.list')
	})

	it('transform skips node_modules', () => {
		const dir = createTmpDir()
		const mapPath = join(dir, 'rpc-map.json')
		writeFileSync(mapPath, JSON.stringify({ procedures: { 'user.list': 'abc123' }, batch: '_b' }))
		process.env.SEAM_RPC_MAP_PATH = mapPath

		const plugins = seam()
		const rpcPlugin = plugins.find((p) => p.name === 'seam-rpc-transform') as Plugin & {
			buildStart: () => void
			transform: (code: string, id: string) => { code: string } | undefined
		}
		rpcPlugin.buildStart()
		const result = rpcPlugin.transform('const p = "user.list"', 'node_modules/react/index.js')
		expect(result).toBeUndefined()
	})

	it('transform processes @canmi/seam-* in node_modules', () => {
		const dir = createTmpDir()
		const mapPath = join(dir, 'rpc-map.json')
		writeFileSync(mapPath, JSON.stringify({ procedures: { 'user.list': 'abc123' }, batch: '_b' }))
		process.env.SEAM_RPC_MAP_PATH = mapPath

		const plugins = seam()
		const rpcPlugin = plugins.find((p) => p.name === 'seam-rpc-transform') as Plugin & {
			buildStart: () => void
			transform: (code: string, id: string) => { code: string } | undefined
		}
		rpcPlugin.buildStart()
		const result = rpcPlugin.transform(
			'const p = "user.list"',
			'node_modules/@canmi/seam-client/dist/index.js',
		)
		expect(result?.code).toContain('abc123')
	})
})

describe('seam() composite', () => {
	it('returns 5 plugins', () => {
		expect(seam()).toHaveLength(5)
	})

	it('plugins have expected names', () => {
		const names = seam().map((p) => p.name)
		expect(names).toEqual([
			'seam-config',
			'seam-virtual',
			'seam-page-split',
			'seam-rpc-noop',
			'seam-reload',
		])
	})

	it('seamReloadPlugin has apply:"serve"', () => {
		const plugins = seam()
		const reloadPlugin = plugins.find((p) => p.name === 'seam-reload')
		expect(reloadPlugin?.apply).toBe('serve')
	})
})
