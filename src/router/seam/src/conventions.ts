/* src/router/seam/src/conventions.ts */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SegmentKind } from './types.js'

const OPTIONAL_CATCH_ALL = /^\[\[\.\.\.(\w+)]]$/
const CATCH_ALL = /^\[\.\.\.(\w+)]$/
const OPTIONAL_PARAM = /^\[\[(\w+)]]$/
const PARAM = /^\[(\w+)]$/
const GROUP = /^\((\w[\w-]*)\)$/

export function parseSegment(dirName: string): SegmentKind {
	let m: RegExpMatchArray | null

	if ((m = dirName.match(OPTIONAL_CATCH_ALL))) {
		return { type: 'optional-catch-all', name: m[1] as string }
	}
	if ((m = dirName.match(CATCH_ALL))) {
		return { type: 'catch-all', name: m[1] as string }
	}
	if ((m = dirName.match(OPTIONAL_PARAM))) {
		return { type: 'optional-param', name: m[1] as string }
	}
	if ((m = dirName.match(PARAM))) {
		return { type: 'param', name: m[1] as string }
	}
	if ((m = dirName.match(GROUP))) {
		return { type: 'group', name: m[1] as string }
	}

	// Static — reject unbalanced brackets
	if (/[[\]]/.test(dirName)) {
		throw new Error(`Invalid segment "${dirName}": unbalanced brackets or unsupported pattern`)
	}
	if (/[()]/.test(dirName)) {
		throw new Error(`Invalid segment "${dirName}": unbalanced parentheses or unsupported pattern`)
	}

	return { type: 'static', value: dirName }
}

export function segmentToUrlPart(seg: SegmentKind): string {
	switch (seg.type) {
		case 'group':
			return ''
		case 'static':
			return seg.value === '' ? '' : `/${seg.value}`
		case 'param':
			return `/:${seg.name}`
		case 'optional-param':
			return `/:${seg.name}?`
		case 'catch-all':
			return `/*${seg.name}`
		case 'optional-catch-all':
			return `/*${seg.name}?`
	}
}

export function findSpecialFile(dir: string, stem: string, extensions: string[]): string | null {
	for (const ext of extensions) {
		const filePath = path.join(dir, `${stem}${ext}`)
		if (fs.existsSync(filePath)) {
			return filePath
		}
	}
	return null
}
