/* src/router/seam/src/generator.ts */

import * as path from 'node:path'
import { segmentToUrlPart } from './conventions.js'
import { detectNamedExports } from './detect-exports.js'
import type { RouteNode, SegmentKind } from './types.js'

export interface GenerateOptions {
	outputPath: string
}

interface ImportEntry {
	name: string
	source: string
	isDefault: boolean
}

interface DataImportEntry {
	exportName: string
	alias: string
	source: string
}

const SEGMENT_ORDER: Record<SegmentKind['type'], number> = {
	static: 0,
	group: 0,
	param: 1,
	'optional-param': 2,
	'catch-all': 3,
	'optional-catch-all': 4,
}

function sanitizePart(s: string): string {
	return s.replace(/[^a-zA-Z0-9]/g, '_')
}

/** Produce a unique identity fragment for each segment kind.
 *  Unlike URL parts, groups are preserved to prevent naming collisions. */
function segmentToIdentity(seg: SegmentKind): string {
	switch (seg.type) {
		case 'static':
			return seg.value
		case 'param':
			return `$${seg.name}`
		case 'optional-param':
			return `o$${seg.name}`
		case 'catch-all':
			return `$$${seg.name}`
		case 'optional-catch-all':
			return `o$$${seg.name}`
		case 'group':
			return `g_${seg.name}`
	}
}

function toImportName(prefix: string, identity: string): string {
	if (identity === '' || identity === '/') return `${prefix}_index`
	const parts = identity.split('/').filter(Boolean).map(sanitizePart)
	return `${prefix}_${parts.join('_')}`
}

function toPosixRelative(from: string, to: string): string {
	let rel = path.relative(from, to).replace(/\\/g, '/')
	if (!rel.startsWith('.')) rel = `./${rel}`
	return rel
}

/** URL path strips groups (for route `path:` field). */
function computeUrlPath(node: RouteNode, parentUrl: string): string {
	const part = segmentToUrlPart(node.segment)
	if (node.segment.type === 'group') return parentUrl
	const url = parentUrl + part
	return url || '/'
}

/** Identity path preserves groups (for unique import names). */
function computeIdentity(node: RouteNode, parentIdentity: string): string {
	const part = segmentToIdentity(node.segment)
	if (!part) return parentIdentity
	return parentIdentity ? `${parentIdentity}/${part}` : part
}

function collectImports(
	nodes: RouteNode[],
	parentUrl: string,
	parentIdentity: string,
	outputDir: string,
	componentImports: ImportEntry[],
	dataImports: DataImportEntry[],
): void {
	for (const node of nodes) {
		const url = computeUrlPath(node, parentUrl)
		const identity = computeIdentity(node, parentIdentity)

		if (node.pageFile) {
			componentImports.push({
				name: toImportName('Page', identity),
				source: toPosixRelative(outputDir, node.pageFile),
				isDefault: true,
			})
		}

		if (node.dataFile) {
			const exports = detectNamedExports(node.dataFile)
			const src = toPosixRelative(outputDir, node.dataFile)
			for (const exp of exports) {
				dataImports.push({
					exportName: exp,
					alias: `${toImportName('Page', identity)}_${exp}`,
					source: src,
				})
			}
		}

		if (node.layoutFile) {
			componentImports.push({
				name: toImportName('Layout', identity),
				source: toPosixRelative(outputDir, node.layoutFile),
				isDefault: true,
			})
		}

		if (node.layoutDataFile) {
			const exports = detectNamedExports(node.layoutDataFile)
			const src = toPosixRelative(outputDir, node.layoutDataFile)
			for (const exp of exports) {
				dataImports.push({
					exportName: exp,
					alias: `${toImportName('Layout', identity)}_${exp}`,
					source: src,
				})
			}
		}

		if (node.errorFile) {
			componentImports.push({
				name: toImportName('Error', identity),
				source: toPosixRelative(outputDir, node.errorFile),
				isDefault: true,
			})
		}
		if (node.loadingFile) {
			componentImports.push({
				name: toImportName('Loading', identity),
				source: toPosixRelative(outputDir, node.loadingFile),
				isDefault: true,
			})
		}
		if (node.notFoundFile) {
			componentImports.push({
				name: toImportName('NotFound', identity),
				source: toPosixRelative(outputDir, node.notFoundFile),
				isDefault: true,
			})
		}

		collectImports(node.children, url, identity, outputDir, componentImports, dataImports)
	}
}

function sortChildren(children: RouteNode[]): RouteNode[] {
	return [...children].sort((a, b) => SEGMENT_ORDER[a.segment.type] - SEGMENT_ORDER[b.segment.type])
}

function renderBoundaryFields(node: RouteNode, identity: string, indent: string): string[] {
	const fields: string[] = []
	if (node.errorFile) fields.push(`${indent}  errorComponent: ${toImportName('Error', identity)}`)
	if (node.loadingFile)
		fields.push(`${indent}  pendingComponent: ${toImportName('Loading', identity)}`)
	if (node.notFoundFile)
		fields.push(`${indent}  notFoundComponent: ${toImportName('NotFound', identity)}`)
	return fields
}

function renderRouteNode(
	node: RouteNode,
	parentUrl: string,
	parentIdentity: string,
	indent: string,
): string {
	const url = computeUrlPath(node, parentUrl)
	const identity = computeIdentity(node, parentIdentity)

	// Group with layout → layout wrapper at path "/"
	if (node.segment.type === 'group' && node.layoutFile) {
		const layoutName = toImportName('Layout', identity)
		const sorted = sortChildren(node.children)
		const childrenStr = sorted
			.map((c) => renderRouteNode(c, url, identity, indent + '  '))
			.filter(Boolean)
			.join(',\n')

		const fields: string[] = []
		fields.push(`${indent}  path: "/"`)
		fields.push(`${indent}  layout: ${layoutName}`)
		fields.push(`${indent}  _layoutId: "_layout_g_${node.segment.name}"`)
		fields.push(...renderBoundaryFields(node, identity, indent))

		if (node.layoutDataFile) {
			const exports = detectNamedExports(node.layoutDataFile)
			for (const exp of exports) {
				fields.push(`${indent}  ${exp}: ${toImportName('Layout', identity)}_${exp}`)
			}
		}

		if (childrenStr) {
			fields.push(`${indent}  children: [\n${childrenStr}\n${indent}  ]`)
		}

		return `${indent}{\n${fields.join(',\n')}\n${indent}}`
	}

	// Group without layout → merge children into parent
	if (node.segment.type === 'group' && !node.layoutFile) {
		const sorted = sortChildren(node.children)
		return sorted
			.map((c) => renderRouteNode(c, url, identity, indent))
			.filter(Boolean)
			.join(',\n')
	}

	// Non-group nodes
	const routePath = segmentToUrlPart(node.segment)
	const fields: string[] = []
	fields.push(`${indent}  path: "${routePath || '/'}"`)

	// When a node has page + layout + children, separate the page into a
	// child route so the skeleton system sees a clean layout boundary.
	const splitPage = !!node.pageFile && !!node.layoutFile && node.children.length > 0

	if (node.pageFile && !splitPage) {
		fields.push(`${indent}  component: ${toImportName('Page', identity)}`)
	}

	if (node.layoutFile) {
		fields.push(`${indent}  layout: ${toImportName('Layout', identity)}`)
	}

	if (node.dataFile && !splitPage) {
		const exports = detectNamedExports(node.dataFile)
		for (const exp of exports) {
			// SSG exports use their own names directly on the route def
			fields.push(`${indent}  ${exp}: ${toImportName('Page', identity)}_${exp}`)
		}
	}

	if (node.layoutDataFile) {
		const exports = detectNamedExports(node.layoutDataFile)
		for (const exp of exports) {
			fields.push(`${indent}  ${exp}: ${toImportName('Layout', identity)}_${exp}`)
		}
	}

	fields.push(...renderBoundaryFields(node, identity, indent))

	const sorted = sortChildren(node.children)
	const childrenStr = sorted
		.map((c) => renderRouteNode(c, url, identity, indent + '  '))
		.filter(Boolean)
		.join(',\n')

	if (splitPage) {
		// Emit separated page component as first child
		const ci = indent + '  '
		const pageFields: string[] = []
		pageFields.push(`${ci}  path: "/"`)
		pageFields.push(`${ci}  component: ${toImportName('Page', identity)}`)
		if (node.dataFile) {
			const exports = detectNamedExports(node.dataFile)
			for (const exp of exports) {
				pageFields.push(`${ci}  ${exp}: ${toImportName('Page', identity)}_${exp}`)
			}
		}
		const pageEntry = `${ci}{\n${pageFields.join(',\n')}\n${ci}}`
		const allChildren = childrenStr ? `${pageEntry},\n${childrenStr}` : pageEntry
		fields.push(`${indent}  children: [\n${allChildren}\n${indent}  ]`)
	} else if (childrenStr) {
		fields.push(`${indent}  children: [\n${childrenStr}\n${indent}  ]`)
	}

	// Skip nodes that have no page, no layout, and no children
	if (!node.pageFile && !node.layoutFile && !childrenStr) {
		return ''
	}

	return `${indent}{\n${fields.join(',\n')}\n${indent}}`
}

export function generateRoutesFile(tree: RouteNode[], options: GenerateOptions): string {
	const outputDir = path.dirname(path.resolve(options.outputPath))
	const componentImports: ImportEntry[] = []
	const dataImports: DataImportEntry[] = []

	collectImports(tree, '', '', outputDir, componentImports, dataImports)

	const lines: string[] = [
		'/* .seam/generated/routes.ts — auto-generated by @canmi/seam-router, do not edit */',
		'',
		// Currently targets TanStack Router only. To support other routers,
		// parameterize this import via seam.config.ts `router` field.
		'import { defineSeamRoutes } from "@canmi/seam-tanstack-router/routes"',
	]

	// Group data imports by source
	const dataBySource = new Map<string, DataImportEntry[]>()
	for (const d of dataImports) {
		const existing = dataBySource.get(d.source)
		if (existing) {
			existing.push(d)
		} else {
			dataBySource.set(d.source, [d])
		}
	}

	// Component imports
	for (const imp of componentImports) {
		lines.push(`import ${imp.name} from "${imp.source}"`)
	}

	// Data imports
	for (const [source, entries] of dataBySource) {
		const specifiers = entries.map((e) => `${e.exportName} as ${e.alias}`).join(', ')
		lines.push(`import { ${specifiers} } from "${source}"`)
	}

	lines.push('')

	const routeEntries = tree
		.map((node) => renderRouteNode(node, '', '', '  '))
		.filter(Boolean)
		.join(',\n')

	lines.push(`export default defineSeamRoutes([\n${routeEntries}\n])`)
	lines.push('')

	return lines.join('\n')
}
