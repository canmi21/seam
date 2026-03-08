/* src/cli/pkg/scripts/build-frontend.mjs */

// Seam built-in frontend bundler powered by Vite.
// Usage: node|bun build-frontend.mjs <entry> <outdir>

import { build, mergeConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { seam } from '@canmi/seam-vite'

const [entry, outDir = '.seam/dist'] = process.argv.slice(2)
if (!entry) {
	console.error('usage: build-frontend.mjs <entry> <outdir>')
	process.exit(1)
}

// Set SEAM_ENTRY so seam() config plugin can inject it as rollupOptions.input
process.env.SEAM_ENTRY = entry
if (!process.env.SEAM_DIST_DIR) process.env.SEAM_DIST_DIR = outDir

// Load user config: prefer SEAM_CONFIG_PATH (direct import), fall back to SEAM_VITE_CONFIG (JSON)
let userConfig = {}
if (process.env.SEAM_CONFIG_PATH) {
	try {
		const mod = await import(process.env.SEAM_CONFIG_PATH)
		const raw = mod.default ?? mod
		userConfig = raw.vite ?? {}
	} catch {
		// config import failed — fall through to SEAM_VITE_CONFIG
	}
}
if (!Object.keys(userConfig).length && process.env.SEAM_VITE_CONFIG) {
	userConfig = JSON.parse(process.env.SEAM_VITE_CONFIG)
}

// Warn on protected fields that seam controls
const protectedPaths = ['build.outDir', 'build.manifest', 'build.rollupOptions.input']
for (const p of protectedPaths) {
	const keys = p.split('.')
	let obj = userConfig
	for (const k of keys) {
		if (obj && typeof obj === 'object' && k in obj) {
			obj = obj[k]
		} else {
			obj = undefined
			break
		}
	}
	if (obj !== undefined) {
		console.warn(`[seam] vite.${p} is controlled by seam and will be overridden`)
	}
}

// Extract user plugins before merging (plugins need array concat, not object merge)
const userPlugins = userConfig.plugins ?? []
const { plugins: _, build: __, ...userRest } = userConfig

const seamBase = {
	configFile: false,
	plugins: [react(), seam(), ...userPlugins],
	resolve: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'] },
}

await build(mergeConfig(seamBase, userRest))
