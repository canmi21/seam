/* src/client/react/__tests__/build-skeletons.test.ts */

/* eslint-disable max-lines-per-function */

import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { buildSentinelData } from '../src/sentinel.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const bunStoreDir = resolve(__dirname, '../../../../node_modules/.bun')

function resolveBunPackageEntry(packagePrefix: string, entryPath: string) {
	const packageDir = readdirSync(bunStoreDir).find((name) => name.startsWith(packagePrefix))
	if (!packageDir) throw new Error(`Could not find ${packagePrefix} in ${bunStoreDir}`)

	const resolved = join(bunStoreDir, packageDir, 'node_modules', entryPath)
	if (!existsSync(resolved)) throw new Error(`Could not find ${resolved}`)
	return resolved
}

describe('buildSentinelData', () => {
	it('converts flat object to sentinels', () => {
		const result = buildSentinelData({ name: 'Alice', age: 30 })
		expect(result).toEqual({
			name: '%%SEAM:name%%',
			age: '%%SEAM:age%%',
		})
	})

	it('converts nested object with dotted paths', () => {
		const result = buildSentinelData({
			user: { name: 'Alice', email: 'alice@example.com' },
		})
		expect(result).toEqual({
			user: {
				name: '%%SEAM:user.name%%',
				email: '%%SEAM:user.email%%',
			},
		})
	})

	it('treats arrays of primitives as leaf values', () => {
		const result = buildSentinelData({ tags: ['a', 'b'] })
		expect(result).toEqual({ tags: '%%SEAM:tags%%' })
	})

	it('produces 1-element sentinel array for arrays of objects', () => {
		const result = buildSentinelData({
			messages: [
				{ id: '1', text: 'hello' },
				{ id: '2', text: 'world' },
			],
		})
		expect(result).toEqual({
			messages: [{ id: '%%SEAM:messages.$.id%%', text: '%%SEAM:messages.$.text%%' }],
		})
	})

	it('treats empty arrays as leaf values', () => {
		const result = buildSentinelData({ items: [] })
		expect(result).toEqual({ items: '%%SEAM:items%%' })
	})

	it('treats arrays of nulls as leaf values', () => {
		const result = buildSentinelData({ items: [null, null] })
		expect(result).toEqual({ items: '%%SEAM:items%%' })
	})

	it('handles null values as leaves', () => {
		const result = buildSentinelData({ avatar: null })
		expect(result).toEqual({ avatar: '%%SEAM:avatar%%' })
	})

	it('handles deeply nested objects', () => {
		const result = buildSentinelData({
			a: { b: { c: 'deep' } },
		})
		expect(result).toEqual({
			a: { b: { c: '%%SEAM:a.b.c%%' } },
		})
	})

	it('handles empty object', () => {
		const result = buildSentinelData({})
		expect(result).toEqual({})
	})

	it('handles mixed nested and flat fields', () => {
		const result = buildSentinelData({
			id: 1,
			user: { name: 'Alice', avatar: 'url' },
			active: true,
		})
		expect(result).toEqual({
			id: '%%SEAM:id%%',
			user: {
				name: '%%SEAM:user.name%%',
				avatar: '%%SEAM:user.avatar%%',
			},
			active: '%%SEAM:active%%',
		})
	})

	it('appends :html suffix for paths in htmlPaths set', () => {
		const result = buildSentinelData({ title: 'text', body: '<p>html</p>' }, '', new Set(['body']))
		expect(result).toEqual({
			title: '%%SEAM:title%%',
			body: '%%SEAM:body:html%%',
		})
	})

	it('appends :html suffix for nested paths', () => {
		const result = buildSentinelData(
			{ post: { title: 'text', content: '<p>html</p>' } },
			'',
			new Set(['post.content']),
		)
		expect(result).toEqual({
			post: {
				title: '%%SEAM:post.title%%',
				content: '%%SEAM:post.content:html%%',
			},
		})
	})

	it('appends :html suffix for array element paths', () => {
		const result = buildSentinelData(
			{ items: [{ name: 'text', body: '<p>html</p>' }] },
			'',
			new Set(['items.$.body']),
		)
		expect(result).toEqual({
			items: [{ name: '%%SEAM:items.$.name%%', body: '%%SEAM:items.$.body:html%%' }],
		})
	})
})

describe('build-skeletons.mjs integration', () => {
	let tmpDir: string

	afterAll(() => {
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
	})

	it('renders a minimal component and produces valid JSON output', () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'seam-skeleton-int-'))

		// Minimal routes file that exports a route array
		const routesContent = `
import React from "react";
import { defineRoutes, useSeamData } from "@canmi/seam-react";

function Hello() {
  const { greeting } = useSeamData();
  return React.createElement("p", null, greeting);
}

export default defineRoutes([{
  path: "/",
  component: Hello,
  loaders: { greeting: { procedure: "getGreeting" } },
  mock: { greeting: "Hello World" },
}]);
`
		const routesFile = join(tmpDir, 'routes.tsx')
		writeFileSync(routesFile, routesContent)

		const scriptPath = resolve(__dirname, '../scripts/build-skeletons.mjs')
		const stdout = execFileSync('node', [scriptPath, routesFile], {
			cwd: tmpDir,
			encoding: 'utf-8',
			// node_modules resolution needs the monorepo root
			env: { ...process.env, NODE_PATH: resolve(__dirname, '../../..') },
		})

		const output = JSON.parse(stdout)
		expect(output.routes).toHaveLength(1)
		expect(output.routes[0].path).toBe('/')
		expect(output.routes[0].axes).toBeDefined()
		expect(output.routes[0].variants[0].html).toContain('%%SEAM:greeting%%')
		expect(output.routes[0].loaders).toEqual({ greeting: { procedure: 'getGreeting' } })
	})
})

describe('render guards', () => {
	const tmpDirs: string[] = []
	const scriptPath = resolve(__dirname, '../scripts/build-skeletons.mjs')
	const radixPortalPath = resolveBunPackageEntry(
		'@radix-ui+react-portal@',
		'@radix-ui/react-portal/dist/index.mjs',
	)
	const radixSlotPath = resolveBunPackageEntry(
		'@radix-ui+react-slot@',
		'@radix-ui/react-slot/dist/index.mjs',
	)

	afterAll(() => {
		for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
	})

	function runBuild(routesContent: string) {
		const dir = mkdtempSync(join(tmpdir(), 'seam-guard-'))
		tmpDirs.push(dir)
		const routesFile = join(dir, 'routes.tsx')
		writeFileSync(routesFile, routesContent)
		return spawnSync('node', [scriptPath, routesFile], {
			cwd: dir,
			encoding: 'utf-8',
			env: { ...process.env, NODE_PATH: resolve(__dirname, '../../..') },
		})
	}

	it('fails build on Suspense abort', () => {
		const result = runBuild(`
import React, { Suspense, use } from "react";
import { defineRoutes } from "@canmi/seam-react";

function Inner() {
  use(new Promise(() => {}));
  return React.createElement("div", null, "never");
}

function Page() {
  return React.createElement(
    Suspense,
    { fallback: React.createElement("div", null, "loading") },
    React.createElement(Inner),
  );
}

export default defineRoutes([{
  path: "/",
  component: Page,
  loaders: {},
  mock: {},
}]);
`)
		expect(result.status).toBe(1)
		expect(result.stderr).toContain('Suspense abort')
	})

	it('strips resource hints and emits warning', () => {
		const result = runBuild(`
import React from "react";
import { preload } from "react-dom";
import { defineRoutes, useSeamData } from "@canmi/seam-react";

function Page() {
  preload("/font.woff2", { as: "font" });
  const { title } = useSeamData();
  return React.createElement("h1", null, title);
}

export default defineRoutes([{
  path: "/",
  component: Page,
  loaders: { title: { procedure: "getTitle" } },
  mock: { title: "Hello" },
}]);
`)
		expect(result.status).toBe(0)
		const output = JSON.parse(result.stdout as string)
		expect(output.warnings.length).toBeGreaterThan(0)
		expect(output.warnings[0]).toContain('resource hint')
		for (const route of output.routes) {
			for (const v of route.variants) {
				expect(v.html).not.toMatch(/<link[^>]+rel="preload"/)
			}
		}
	})

	it('passes clean build for normal skeleton', () => {
		const result = runBuild(`
import React from "react";
import { defineRoutes, useSeamData } from "@canmi/seam-react";

function Page() {
  const { greeting } = useSeamData();
  return React.createElement("p", null, greeting);
}

export default defineRoutes([{
  path: "/",
  component: Page,
  loaders: { greeting: { procedure: "getGreeting" } },
  mock: { greeting: "Hello World" },
}]);
`)
		expect(result.status).toBe(0)
		const output = JSON.parse(result.stdout as string)
		expect(output.warnings).toEqual([])
		expect(output.routes[0].variants[0].html).toContain('%%SEAM:greeting%%')
	})

	it('returns undefined for browser globals and warns once per global', () => {
		const result = runBuild(`
import React from "react";
import { defineRoutes } from "@canmi/seam-react";

function Page() {
  const hasDocument = globalThis?.document ? "yes" : "no";
  const hasWindow = globalThis?.window ? "yes" : "no";
  const hasDocumentAgain = globalThis?.document ? "yes" : "no";
  return React.createElement(
    "div",
    null,
    React.createElement("p", null, "document:" + hasDocument),
    React.createElement("p", null, "window:" + hasWindow),
    React.createElement("p", null, "document-again:" + hasDocumentAgain),
  );
}

export default defineRoutes([{
  path: "/",
  component: Page,
  loaders: {},
  mock: {},
}]);
`)
		expect(result.status).toBe(0)
		const output = JSON.parse(result.stdout as string)
		expect(output.warnings).toHaveLength(2)
		expect(output.warnings[0]).toContain('Browser global "document"')
		expect(output.warnings[1]).toContain('Browser global "window"')
		expect(output.routes[0].variants[0].html).toContain('document:no')
		expect(output.routes[0].variants[0].html).toContain('window:no')
		expect(output.routes[0].variants[0].html).toContain('document-again:no')
	})

	it('builds a Radix portal-backed component and omits portal HTML during SSR', () => {
		const result = runBuild(`
import React from "react";
import { Portal } from ${JSON.stringify(radixPortalPath)};
import { defineRoutes } from "@canmi/seam-react";

function Page() {
  return React.createElement("div", null,
    React.createElement("button", null, "open-dialog"),
    React.createElement(Portal, null,
      React.createElement("div", null, "dialog-title"),
    )
  );
}

export default defineRoutes([{
  path: "/",
  component: Page,
  loaders: {},
  mock: {},
}]);
`)
		expect(result.status).toBe(0)
		const output = JSON.parse(result.stdout as string)
		const html = output.routes[0].variants[0].html
		expect(html).toContain('open-dialog')
		expect(html).not.toContain('dialog-title')
		expect(output.warnings).toEqual([])
	})

	it('builds a shadcn-style composition with hydration-only portal content', () => {
		const result = runBuild(`
import React from "react";
import { Portal } from ${JSON.stringify(radixPortalPath)};
import { Slot } from ${JSON.stringify(radixSlotPath)};
import { defineRoutes } from "@canmi/seam-react";

function Button({ asChild, children }) {
  const Comp = asChild ? Slot : "button";
  return React.createElement(Comp, { className: "btn" }, children);
}

function Card({ children }) {
  return React.createElement("section", { className: "card" }, children);
}

function DeferredOverlay({ mounted }) {
  return mounted
    ? React.createElement(Portal, null, React.createElement("div", null, "overlay-content"))
    : React.createElement("p", null, "deferred");
}

function Page() {
  return React.createElement("div", null,
    React.createElement(Card, null,
      React.createElement("h2", null, "display"),
      React.createElement(Button, null, "primary"),
    ),
    React.createElement(Button, null, "dialog-trigger"),
    React.createElement(Button, { asChild: true },
      React.createElement("a", { href: "/menu" }, "menu-trigger"),
    ),
    React.createElement(DeferredOverlay, { mounted: false }),
  );
}

export default defineRoutes([{
  path: "/",
  component: Page,
  loaders: {},
  mock: {},
}]);
`)
		expect(result.status).toBe(0)
		const output = JSON.parse(result.stdout as string)
		const html = output.routes[0].variants[0].html
		expect(html).toContain('display')
		expect(html).toContain('primary')
		expect(html).toContain('dialog-trigger')
		expect(html).toContain('menu-trigger')
		expect(html).toContain('deferred')
		expect(html).not.toContain('overlay-content')
	})
})
