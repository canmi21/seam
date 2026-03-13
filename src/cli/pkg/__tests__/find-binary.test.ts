/* src/cli/pkg/__tests__/find-binary.test.ts */

import { describe, it, expect, afterEach } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PLATFORM_PACKAGES, findBinary, _deps } = require('../lib/find-binary.cjs') as {
	PLATFORM_PACKAGES: Record<string, string>
	findBinary: () => string | null
	_deps: { existsSync: (p: string) => boolean }
}

const originalExistsSync = _deps.existsSync

afterEach(() => {
	_deps.existsSync = originalExistsSync
})

describe('PLATFORM_PACKAGES', () => {
	it('has 4 entries', () => {
		expect(Object.keys(PLATFORM_PACKAGES)).toHaveLength(4)
	})

	it('all package names follow @canmi/seam-cli-* pattern', () => {
		for (const pkg of Object.values(PLATFORM_PACKAGES)) {
			expect(pkg).toMatch(/^@canmi\/seam-cli-.+$/)
		}
	})

	it('covers expected platforms', () => {
		expect(PLATFORM_PACKAGES).toHaveProperty('darwin-arm64')
		expect(PLATFORM_PACKAGES).toHaveProperty('darwin-x64')
		expect(PLATFORM_PACKAGES).toHaveProperty('linux-x64')
		expect(PLATFORM_PACKAGES).toHaveProperty('linux-arm64')
	})
})

describe('findBinary', () => {
	it('returns null for unsupported platform (win32)', () => {
		const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
		if (!origPlatform) throw new Error('process.platform descriptor missing')
		Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
		try {
			expect(findBinary()).toBeNull()
		} finally {
			Object.defineProperty(process, 'platform', origPlatform)
		}
	})

	it('returns null when require.resolve throws', () => {
		_deps.existsSync = () => false
		const result = findBinary()
		expect(result).toBeNull()
	})

	it('returns binary path when package installed and binary exists', () => {
		const key = `${process.platform}-${process.arch}`
		if (!(key in PLATFORM_PACKAGES)) return // skip on unsupported test platform

		_deps.existsSync = () => true
		const result = findBinary()
		if (result !== null) {
			expect(result).toMatch(/bin\/seam$/)
		}
	})

	it('returns null when binary file not found', () => {
		_deps.existsSync = () => false
		expect(findBinary()).toBeNull()
	})
})
