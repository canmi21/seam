/* tests/e2e/playwright.config.ts */
import { defineConfig } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const workspaceRoot = path.resolve(__dirname, '../..')
const profile = process.env.SEAM_PROFILE || 'release'
const portStatePath = path.join(workspaceRoot, '.seam/tests-e2e-ports.json')
const paths = {
	fixtureDir: path.resolve(__dirname, 'fixture/.seam/output'),
	fullstackDir: path.resolve(__dirname, '../../examples/github-dashboard/seam-app/.seam/output'),
	workspaceExampleDir: path.resolve(workspaceRoot, 'examples/github-dashboard'),
	i18nOutputDir: path.resolve(workspaceRoot, 'examples/i18n-demo/seam-app/.seam/output'),
	featureStreamDir: path.resolve(workspaceRoot, 'examples/features/stream-upload/.seam/output'),
	featureAuthDir: path.resolve(workspaceRoot, 'examples/features/context-auth/.seam/output'),
	featureQueryDir: path.resolve(workspaceRoot, 'examples/features/query-mutation/.seam/output'),
	featureHandoffDir: path.resolve(
		workspaceRoot,
		'examples/features/handoff-narrowing/.seam/output',
	),
	featureChannelDir: path.resolve(
		workspaceRoot,
		'examples/features/channel-subscription/.seam/output',
	),
	fsRouterDir: path.resolve(workspaceRoot, 'examples/fs-router-demo/.seam/output'),
	shadcnUiDemoDir: path.resolve(workspaceRoot, 'examples/shadcn-ui-demo/.seam/output'),
	nextAppDir: path.resolve(workspaceRoot, 'examples/github-dashboard/next-app'),
	axumBin: path.join(workspaceRoot, `target/${profile}/github-dashboard-axum`),
	i18nAxumBin: path.join(workspaceRoot, `target/${profile}/i18n-demo-axum`),
	goGinBin: path.join(workspaceRoot, 'examples/github-dashboard/backends/go-gin/server'),
} as const

function findFreePort(): number {
	const output = execFileSync(
		process.execPath,
		[
			'-e',
			[
				"const { createServer } = require('node:net')",
				'const server = createServer()',
				"server.listen(0, '127.0.0.1', () => {",
				'\tconst address = server.address()',
				"\tif (!address || typeof address === 'string') process.exit(1)",
				'\tprocess.stdout.write(String(address.port))',
				'\tserver.close()',
				'})',
			].join('\n'),
		],
		{ encoding: 'utf8' },
	).trim()
	const port = Number(output)
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error(`failed to allocate free port: ${output}`)
	}
	return port
}

const portNames = [
	'fixture',
	'fullstack',
	'workspaceTsHono',
	'workspaceRustAxum',
	'workspaceGoGin',
	'nextjs',
	'i18nPrefix',
	'i18nHidden',
	'featureStreamUpload',
	'featureContextAuth',
	'featureQueryMutation',
	'featureTimeoutRecovery',
	'featureHandoffNarrowing',
	'featureChannelSubscription',
	'featureSseReconnect',
	'fsRouter',
	'shadcnUiDemo',
	'viteApp',
	'viteHmr',
] as const

type PortName = (typeof portNames)[number]

function allocatePorts(): Record<PortName, number> {
	const entries = portNames.map((name) => [name, findFreePort()] as const)
	return Object.fromEntries(entries) as Record<PortName, number>
}

function parsePorts(raw: string): Record<PortName, number> | null {
	try {
		const parsed = JSON.parse(raw) as { ports?: Partial<Record<PortName, unknown>> }
		const ports = parsed.ports
		if (!ports) return null
		for (const name of portNames) {
			if (!Number.isInteger(ports[name]) || Number(ports[name]) <= 0) {
				return null
			}
		}
		return ports as Record<PortName, number>
	} catch {
		return null
	}
}

function readSavedPorts(): Record<PortName, number> | null {
	try {
		return parsePorts(readFileSync(portStatePath, 'utf8'))
	} catch {
		return null
	}
}

function resolvePorts(): Record<PortName, number> {
	const saved = readSavedPorts()
	if (saved) return saved

	mkdirSync(path.dirname(portStatePath), { recursive: true })
	const next = {
		createdAt: new Date().toISOString(),
		ports: allocatePorts(),
	}
	const serialized = JSON.stringify(next, null, 2)

	try {
		writeFileSync(portStatePath, serialized, { flag: 'wx' })
		return next.ports
	} catch {
		const existing = readSavedPorts()
		if (existing) return existing
		writeFileSync(portStatePath, serialized)
		return next.ports
	}
}

function ensureNoProxy(name: 'NO_PROXY' | 'no_proxy') {
	const required = ['localhost', '127.0.0.1', '::1']
	const current =
		process.env[name]
			?.split(',')
			.map((value) => value.trim())
			.filter(Boolean) ?? []
	for (const host of required) {
		if (!current.includes(host)) current.push(host)
	}
	process.env[name] = current.join(',')
}

ensureNoProxy('NO_PROXY')
ensureNoProxy('no_proxy')

// Load .env from workspace root (GITHUB_TOKEN raises API rate limit from 60 to 5000/hour)
try {
	const envFile = readFileSync(path.join(workspaceRoot, '.env'), 'utf8')
	for (const line of envFile.split('\n')) {
		const match = line.match(/^([A-Z_]+)=(.+)$/)
		if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
	}
} catch {
	// .env is optional
}

const ghToken: Record<string, string> = process.env.GITHUB_TOKEN
	? { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
	: {}
const activeGroup = process.env.SEAM_E2E_GROUP
const ports = resolvePorts()

process.env.SEAM_E2E_VITE_APP_PORT = String(ports.viteApp)
process.env.SEAM_E2E_VITE_HMR_PORT = String(ports.viteHmr)

type ProjectSpec = {
	name: string
	port: PortName
	testMatch?: RegExp
	testIgnore?: RegExp
	timeout?: number
	dependencies?: string[]
	workers?: number | string
}

type ServerSpec = {
	command: string
	port: PortName
	cwd?: string
	env?: Record<string, string>
}

const projectSpecs: ProjectSpec[] = [
	{
		name: 'chromium',
		port: 'fixture',
		testIgnore: /fullstack|vite-dev|workspace|nextjs|i18n|feature|fs-router|shadcn-ui-demo/,
	},
	{ name: 'fullstack', port: 'fullstack', testMatch: /fullstack/ },
	{
		name: 'vite-dev',
		port: 'viteApp',
		testMatch: /vite-dev/,
		dependencies: ['fullstack'],
		timeout: 60_000,
		workers: 1,
	},
	{ name: 'workspace-ts-hono', port: 'workspaceTsHono', testMatch: /workspace/ },
	{ name: 'workspace-rust-axum', port: 'workspaceRustAxum', testMatch: /workspace/ },
	{ name: 'workspace-go-gin', port: 'workspaceGoGin', testMatch: /workspace/ },
	{ name: 'nextjs', port: 'nextjs', testMatch: /nextjs/, timeout: 60_000, workers: 1 },
	{ name: 'i18n-prefix', port: 'i18nPrefix', testMatch: /i18n-prefix/ },
	{ name: 'i18n-hidden', port: 'i18nHidden', testMatch: /i18n-hidden/ },
	{
		name: 'feature-stream-upload',
		port: 'featureStreamUpload',
		testMatch: /feature-stream-upload/,
	},
	{ name: 'feature-context-auth', port: 'featureContextAuth', testMatch: /feature-context-auth/ },
	{
		name: 'feature-query-mutation',
		port: 'featureQueryMutation',
		testMatch: /feature-query-mutation/,
		workers: 1,
	},
	{
		name: 'feature-handoff-narrowing',
		port: 'featureHandoffNarrowing',
		testMatch: /feature-handoff-narrowing/,
	},
	{
		name: 'feature-timeout-recovery',
		port: 'featureTimeoutRecovery',
		testMatch: /feature-timeout-recovery/,
		workers: 1,
	},
	{
		name: 'feature-channel-subscription',
		port: 'featureChannelSubscription',
		testMatch: /feature-channel-subscription/,
		workers: 1,
	},
	{
		name: 'feature-sse-reconnect',
		port: 'featureSseReconnect',
		testMatch: /feature-sse-reconnect/,
		workers: 1,
	},
	{ name: 'fs-router', port: 'fsRouter', testMatch: /fs-router/ },
	{ name: 'shadcn-ui-demo', port: 'shadcnUiDemo', testMatch: /shadcn-ui-demo/ },
]

const serverSpecs: ServerSpec[] = [
	{
		command: 'bun run server/index.js',
		cwd: paths.fixtureDir,
		port: 'fixture',
	},
	{
		command: 'bun run server/index.js',
		cwd: paths.fullstackDir,
		port: 'fullstack',
		env: ghToken,
	},
	{
		command: 'bun run backends/ts-hono/src/index.ts',
		cwd: paths.workspaceExampleDir,
		port: 'workspaceTsHono',
		env: {
			SEAM_OUTPUT_DIR: 'seam-app/.seam/output',
			...ghToken,
		},
	},
	{
		command: paths.axumBin,
		port: 'workspaceRustAxum',
		env: {
			SEAM_OUTPUT_DIR: path.join(paths.workspaceExampleDir, 'seam-app/.seam/output'),
			...ghToken,
		},
	},
	{
		command: paths.goGinBin,
		port: 'workspaceGoGin',
		env: {
			SEAM_OUTPUT_DIR: path.join(paths.workspaceExampleDir, 'seam-app/.seam/output'),
			...ghToken,
		},
	},
	{
		command: `bunx next dev --webpack --port ${ports.nextjs}`,
		cwd: paths.nextAppDir,
		port: 'nextjs',
		env: ghToken,
	},
	{
		command: paths.i18nAxumBin,
		port: 'i18nPrefix',
		env: {
			I18N_MODE: 'prefix',
			SEAM_OUTPUT_DIR: paths.i18nOutputDir,
		},
	},
	{
		command: paths.i18nAxumBin,
		port: 'i18nHidden',
		env: {
			I18N_MODE: 'hidden',
			SEAM_OUTPUT_DIR: paths.i18nOutputDir,
		},
	},
	{ command: 'bun run server/index.js', cwd: paths.featureStreamDir, port: 'featureStreamUpload' },
	{ command: 'bun run server/index.js', cwd: paths.featureAuthDir, port: 'featureContextAuth' },
	{ command: 'bun run server/index.js', cwd: paths.featureQueryDir, port: 'featureQueryMutation' },
	{
		command: 'bun run server/index.js',
		cwd: paths.featureQueryDir,
		port: 'featureTimeoutRecovery',
	},
	{
		command: 'bun run server/index.js',
		cwd: paths.featureHandoffDir,
		port: 'featureHandoffNarrowing',
	},
	{
		command: 'bun run server/index.js',
		cwd: paths.featureChannelDir,
		port: 'featureChannelSubscription',
	},
	{ command: 'bun run server/index.js', cwd: paths.featureChannelDir, port: 'featureSseReconnect' },
	{ command: 'bun run server/index.js', cwd: paths.fsRouterDir, port: 'fsRouter' },
	{ command: 'bun run server/index.js', cwd: paths.shadcnUiDemoDir, port: 'shadcnUiDemo' },
]

const e2eGroups: Record<string, string[]> = {
	core: ['chromium', 'fullstack', 'vite-dev'],
	workspace: ['workspace-ts-hono', 'workspace-rust-axum', 'workspace-go-gin'],
	feature: [
		'feature-stream-upload',
		'feature-context-auth',
		'feature-query-mutation',
		'feature-handoff-narrowing',
		'feature-timeout-recovery',
		'feature-channel-subscription',
		'feature-sse-reconnect',
	],
	misc: ['i18n-prefix', 'i18n-hidden', 'nextjs', 'fs-router', 'shadcn-ui-demo'],
}

function filterByGroup(group: string | undefined) {
	if (!group) return { projects: projectSpecs, servers: serverSpecs }
	const names = e2eGroups[group]
	if (!names) throw new Error(`Unknown SEAM_E2E_GROUP: ${group}`)
	const filtered = projectSpecs.filter((p) => names.includes(p.name))
	const neededPorts = new Set(filtered.map((p) => p.port))
	const filteredServers = serverSpecs.filter((s) => neededPorts.has(s.port))
	return { projects: filtered, servers: filteredServers }
}

const { projects: activeProjects, servers: activeServers } = filterByGroup(activeGroup)

const configuredWorkers = process.env.PW_WORKERS ?? (process.env.CI ? '50%' : undefined)

export default defineConfig({
	testDir: './specs',
	timeout: 30_000,
	retries: 0,
	reporter: 'list',
	fullyParallel: false,
	...(configuredWorkers ? { workers: configuredWorkers } : {}),

	use: {
		screenshot: 'only-on-failure',
	},

	projects: activeProjects.map((project) => ({
		name: project.name,
		use: { browserName: 'chromium', baseURL: `http://localhost:${ports[project.port]}` },
		...(project.testMatch ? { testMatch: project.testMatch } : {}),
		...(project.testIgnore ? { testIgnore: project.testIgnore } : {}),
		...(project.dependencies ? { dependencies: project.dependencies } : {}),
		...(project.timeout ? { timeout: project.timeout } : {}),
		...(project.workers ? { workers: project.workers } : {}),
	})),

	webServer: activeServers.map((server) => ({
		command: server.command,
		...(server.cwd ? { cwd: server.cwd } : {}),
		port: ports[server.port],
		env: { PORT: String(ports[server.port]), ...server.env },
		reuseExistingServer: !process.env.CI,
	})),
})
