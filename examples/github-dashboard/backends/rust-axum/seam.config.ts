/* examples/github-dashboard/backends/rust-axum/seam.config.ts */

import { defineConfig } from '@canmi/seam'

export default defineConfig({
	project: { name: 'rust-axum' },
	backend: { lang: 'rust', devCommand: 'cargo watch -x run', port: 3000 },
	build: {
		backendBuildCommand: 'cargo build --release',
		manifestCommand: 'cargo run --release -- --manifest',
	},
})
