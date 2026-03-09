/* tests/e2e/playwright.config.ts */
import { defineConfig } from '@playwright/test'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const fixtureDir = path.resolve(__dirname, 'fixture/.seam/output')
const fullstackDir = path.resolve(
	__dirname,
	'../../examples/github-dashboard/seam-app/.seam/output',
)
const workspaceRoot = path.resolve(__dirname, '../..')
const workspaceExampleDir = path.resolve(workspaceRoot, 'examples/github-dashboard')
const i18nOutputDir = path.resolve(workspaceRoot, 'examples/i18n-demo/seam-app/.seam/output')
const featureStreamDir = path.resolve(workspaceRoot, 'examples/features/stream-upload/.seam/output')
const featureAuthDir = path.resolve(workspaceRoot, 'examples/features/context-auth/.seam/output')
const featureQueryDir = path.resolve(workspaceRoot, 'examples/features/query-mutation/.seam/output')
const featureHandoffDir = path.resolve(
	workspaceRoot,
	'examples/features/handoff-narrowing/.seam/output',
)
const featureChannelDir = path.resolve(
	workspaceRoot,
	'examples/features/channel-subscription/.seam/output',
)
const fsRouterDir = path.resolve(workspaceRoot, 'examples/fs-router-demo/.seam/output')

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

const ghToken = process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}

export default defineConfig({
	testDir: './specs',
	timeout: 30_000,
	retries: 0,
	reporter: 'list',

	use: {
		screenshot: 'only-on-failure',
	},

	projects: [
		{
			name: 'chromium',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3456' },
			testIgnore: /fullstack|vite-dev|workspace|nextjs|i18n|feature|fs-router/,
		},
		{
			name: 'fullstack',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3457' },
			testMatch: /fullstack/,
		},
		{
			name: 'vite-dev',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3000' },
			testMatch: /vite-dev/,
			dependencies: ['fullstack'],
			timeout: 60_000,
		},
		{
			name: 'workspace-ts-hono',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3460' },
			testMatch: /workspace/,
		},
		{
			name: 'workspace-rust-axum',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3461' },
			testMatch: /workspace/,
		},
		{
			name: 'workspace-go-gin',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3462' },
			testMatch: /workspace/,
		},
		{
			name: 'nextjs',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3463' },
			testMatch: /nextjs/,
			timeout: 60_000,
		},
		{
			name: 'i18n-prefix',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3470' },
			testMatch: /i18n-prefix/,
		},
		{
			name: 'i18n-hidden',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3471' },
			testMatch: /i18n-hidden/,
		},
		{
			name: 'feature-stream-upload',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3480' },
			testMatch: /feature-stream-upload/,
		},
		{
			name: 'feature-context-auth',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3481' },
			testMatch: /feature-context-auth/,
		},
		{
			name: 'feature-query-mutation',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3482' },
			testMatch: /feature-query-mutation/,
		},
		{
			name: 'feature-handoff-narrowing',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3483' },
			testMatch: /feature-handoff-narrowing/,
		},
		{
			name: 'feature-timeout-recovery',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3482' },
			testMatch: /feature-timeout-recovery/,
		},
		{
			name: 'feature-channel-subscription',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3484' },
			testMatch: /feature-channel-subscription/,
		},
		{
			name: 'feature-sse-reconnect',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3484' },
			testMatch: /feature-sse-reconnect/,
		},
		{
			name: 'fs-router',
			use: { browserName: 'chromium', baseURL: 'http://localhost:3485' },
			testMatch: /fs-router/,
		},
	],

	webServer: [
		{
			command: 'bun run server/index.js',
			cwd: fixtureDir,
			port: 3456,
			env: { PORT: '3456' },
			reuseExistingServer: !process.env.CI,
		},
		{
			command: 'bun run server/index.js',
			cwd: fullstackDir,
			port: 3457,
			env: { PORT: '3457', ...ghToken },
			reuseExistingServer: !process.env.CI,
		},
		{
			command: 'bun run backends/ts-hono/src/index.ts',
			cwd: workspaceExampleDir,
			port: 3460,
			env: { PORT: '3460', SEAM_OUTPUT_DIR: 'seam-app/.seam/output', ...ghToken },
			reuseExistingServer: !process.env.CI,
		},
		{
			command: path.join(workspaceRoot, 'target/release/github-dashboard-axum'),
			port: 3461,
			env: {
				PORT: '3461',
				SEAM_OUTPUT_DIR: path.join(workspaceExampleDir, 'seam-app/.seam/output'),
				...ghToken,
			},
			reuseExistingServer: !process.env.CI,
		},
		{
			command: path.join(workspaceExampleDir, 'backends/go-gin/server'),
			port: 3462,
			env: {
				PORT: '3462',
				SEAM_OUTPUT_DIR: path.join(workspaceExampleDir, 'seam-app/.seam/output'),
				...ghToken,
			},
			reuseExistingServer: !process.env.CI,
		},
		{
			command: 'bunx next dev --webpack --port 3463',
			cwd: path.join(workspaceExampleDir, 'next-app'),
			port: 3463,
			env: { ...ghToken },
			reuseExistingServer: !process.env.CI,
		},
		{
			command: path.join(workspaceRoot, 'target/release/i18n-demo-axum'),
			port: 3470,
			env: {
				PORT: '3470',
				I18N_MODE: 'prefix',
				SEAM_OUTPUT_DIR: i18nOutputDir,
			},
			reuseExistingServer: !process.env.CI,
		},
		{
			command: path.join(workspaceRoot, 'target/release/i18n-demo-axum'),
			port: 3471,
			env: {
				PORT: '3471',
				I18N_MODE: 'hidden',
				SEAM_OUTPUT_DIR: i18nOutputDir,
			},
			reuseExistingServer: !process.env.CI,
		},
		{
			command: 'bun run server/index.js',
			cwd: featureStreamDir,
			port: 3480,
			env: { PORT: '3480' },
			reuseExistingServer: !process.env.CI,
		},
		{
			command: 'bun run server/index.js',
			cwd: featureAuthDir,
			port: 3481,
			env: { PORT: '3481' },
			reuseExistingServer: !process.env.CI,
		},
		{
			command: 'bun run server/index.js',
			cwd: featureQueryDir,
			port: 3482,
			env: { PORT: '3482' },
			reuseExistingServer: !process.env.CI,
		},
		{
			command: 'bun run server/index.js',
			cwd: featureHandoffDir,
			port: 3483,
			env: { PORT: '3483' },
			reuseExistingServer: !process.env.CI,
		},
		{
			command: 'bun run server/index.js',
			cwd: featureChannelDir,
			port: 3484,
			env: { PORT: '3484' },
			reuseExistingServer: !process.env.CI,
		},
		{
			command: 'bun run server/index.js',
			cwd: fsRouterDir,
			port: 3485,
			env: { PORT: '3485' },
			reuseExistingServer: !process.env.CI,
		},
	],
})
