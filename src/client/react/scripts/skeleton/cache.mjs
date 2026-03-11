/* src/client/react/scripts/skeleton/cache.mjs */

import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Parse import statements to map local names to specifiers */
function parseComponentImports(source) {
	const map = new Map()
	for (const entry of scanImportEntries(source)) {
		if (entry.defaultName) map.set(entry.defaultName, entry.specifier)
		for (const part of entry.namedParts) {
			const asMatch = part.match(/^(\w+)\s+as\s+(\w+)$/)
			if (asMatch) {
				map.set(asMatch[2], entry.specifier)
				map.set(asMatch[1], entry.specifier)
			} else {
				map.set(part, entry.specifier)
			}
		}
	}
	return map
}

function scanImportEntries(source) {
	const entries = []
	let index = 0
	while (index < source.length) {
		const importPos = source.indexOf('import', index)
		if (importPos === -1) break
		index = importPos + 'import'.length
		if (!isImportTokenBoundary(source, importPos, index)) continue

		let cursor = skipWhitespace(source, index)
		const firstChar = source[cursor]
		if (!firstChar || firstChar === '(' || firstChar === '"' || firstChar === "'") continue

		const fromPos = findFromKeyword(source, cursor)
		if (fromPos === -1) continue

		const clause = source.slice(cursor, fromPos).trim()
		cursor = skipWhitespace(source, fromPos + 'from'.length)
		const quote = source[cursor]
		if (quote !== '"' && quote !== "'") continue
		const specifierEnd = source.indexOf(quote, cursor + 1)
		if (specifierEnd === -1) continue
		const specifier = source.slice(cursor + 1, specifierEnd)
		const entry = parseImportClause(clause, specifier)
		if (entry) entries.push(entry)
		index = specifierEnd + 1
	}
	return entries
}

function isImportTokenBoundary(source, start, end) {
	const before = start === 0 ? '' : source.charAt(start - 1)
	const after = end >= source.length ? '' : source.charAt(end)
	return !isIdentifierChar(before) && !isIdentifierChar(after)
}

function isIdentifierChar(char) {
	return char !== '' && /[A-Za-z0-9_$]/.test(char)
}

function skipWhitespace(source, index) {
	while (index < source.length && /\s/.test(source[index])) index++
	return index
}

function findFromKeyword(source, index) {
	let braceDepth = 0
	for (let i = index; i < source.length - 3; i++) {
		const char = source.charAt(i)
		if (char === '{') braceDepth++
		else if (char === '}') braceDepth = Math.max(0, braceDepth - 1)
		if (braceDepth !== 0) continue
		if (source.slice(i, i + 4) !== 'from') continue
		const before = i === 0 ? '' : source.charAt(i - 1)
		const after = i + 4 >= source.length ? '' : source.charAt(i + 4)
		if (!isIdentifierChar(before) && !isIdentifierChar(after)) return i
	}
	return -1
}

function parseImportClause(clause, specifier) {
	if (!clause || clause.startsWith('*')) return null

	const namedStart = clause.indexOf('{')
	const namedEnd = clause.lastIndexOf('}')
	let defaultName = null
	let namedParts = []

	if (namedStart !== -1 && namedEnd > namedStart) {
		const defaultPart = clause.slice(0, namedStart).replace(/,\s*$/, '').trim()
		if (defaultPart) defaultName = defaultPart
		namedParts = clause
			.slice(namedStart + 1, namedEnd)
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)
	} else {
		defaultName = clause.trim()
	}

	return { defaultName, namedParts, specifier }
}

/** Bundle each component via esbuild (write: false) and SHA-256 hash the output */
async function computeComponentHashes(names, importMap, routesDir) {
	const hashes = new Map()
	const seen = new Set()
	const tasks = []
	for (const name of names) {
		const specifier = importMap.get(name)
		if (!specifier || seen.has(specifier)) continue
		seen.add(specifier)
		tasks.push(
			build({
				stdin: { contents: `import '${specifier}'`, resolveDir: routesDir, loader: 'js' },
				bundle: true,
				write: false,
				format: 'esm',
				platform: 'node',
				treeShaking: false,
				external: ['react', 'react-dom', '@canmi/seam-react', '@canmi/seam-i18n'],
				logLevel: 'silent',
			})
				.then((result) => {
					const content = result.outputFiles[0]?.text || ''
					const hash = createHash('sha256').update(content).digest('hex')
					for (const [n, s] of importMap) {
						if (s === specifier) hashes.set(n, hash)
					}
				})
				.catch(() => {}),
		)
	}
	await Promise.all(tasks)
	return hashes
}

/**
 * Hash the build scripts themselves to invalidate cache when tooling changes.
 * @param {string[]} scriptFiles - absolute paths of script files to hash
 */
function computeScriptHash(scriptFiles) {
	const h = createHash('sha256')
	for (const f of scriptFiles) h.update(readFileSync(f, 'utf-8'))
	return h.digest('hex')
}

function pathToSlug(path) {
	const t = path
		.replace(/^\/|\/$/g, '')
		.replace(/\//g, '-')
		.replace(/:/g, '')
	return t || 'index'
}

function readCache(cacheDir, slug) {
	try {
		return JSON.parse(readFileSync(join(cacheDir, `${slug}.json`), 'utf-8'))
	} catch {
		return null
	}
}

function writeCache(cacheDir, slug, key, data) {
	writeFileSync(join(cacheDir, `${slug}.json`), JSON.stringify({ key, data }))
}

function computeCacheKey(componentHash, manifestContent, config, scriptHash, locale, messagesJson) {
	const h = createHash('sha256')
	h.update(componentHash)
	h.update(manifestContent)
	h.update(JSON.stringify(config))
	h.update(scriptHash)
	if (locale) h.update(locale)
	if (messagesJson) h.update(messagesJson)
	return h.digest('hex').slice(0, 16)
}

let _createI18n = null
async function buildI18nValue(locale, messages, defaultLocale) {
	if (!_createI18n) {
		const mod = await import('@canmi/seam-i18n')
		_createI18n = mod.createI18n
	}
	const localeMessages = messages?.[locale] || {}
	const fallback =
		defaultLocale && locale !== defaultLocale ? messages?.[defaultLocale] || {} : undefined
	const instance = _createI18n(locale, localeMessages, fallback)
	const usedKeys = new Set()
	const origT = instance.t
	return {
		locale: instance.locale,
		t(key, params) {
			usedKeys.add(key)
			return origT(key, params)
		},
		_usedKeys: usedKeys,
	}
}

export {
	parseComponentImports,
	computeComponentHashes,
	computeScriptHash,
	pathToSlug,
	readCache,
	writeCache,
	computeCacheKey,
	buildI18nValue,
}
