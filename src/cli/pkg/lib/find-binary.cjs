/* src/cli/pkg/lib/find-binary.cjs */

const { existsSync } = require('fs')
const { join } = require('path')

const PLATFORM_PACKAGES = {
	'darwin-arm64': '@canmi/seam-cli-darwin-arm64',
	'darwin-x64': '@canmi/seam-cli-darwin-x64',
	'linux-x64': '@canmi/seam-cli-linux-x64',
	'linux-arm64': '@canmi/seam-cli-linux-arm64',
}

// Indirect reference so tests can replace existsSync
// (vitest cannot intercept CJS require('fs') for built-in modules)
const _deps = { existsSync }

function findBinary() {
	const pkg = PLATFORM_PACKAGES[`${process.platform}-${process.arch}`]
	if (!pkg) return null
	try {
		const pkgDir = join(require.resolve(`${pkg}/package.json`), '..')
		const bin = join(pkgDir, 'bin', 'seam')
		if (_deps.existsSync(bin)) return bin
	} catch {
		// Platform package not installed
	}
	return null
}

module.exports = { PLATFORM_PACKAGES, findBinary, _deps }
