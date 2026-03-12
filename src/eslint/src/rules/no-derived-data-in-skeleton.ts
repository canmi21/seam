/* src/eslint/src/rules/no-derived-data-in-skeleton.ts */

import type { Rule } from 'eslint'

const SKELETON_PATTERN = /-skeleton\.tsx$/

const ARITHMETIC_OPERATORS = new Set(['+', '-', '*', '/', '%', '**'])
const NUMERIC_COMPARISON_OPERATORS = new Set(['>', '>=', '<', '<='])
const ARRAY_DERIVATION_METHODS = new Set(['filter', 'sort', 'reduce', 'reduceRight', 'flatMap'])
const FORMAT_METHODS = new Set([
	'toLocaleString',
	'toFixed',
	'toPrecision',
	'toUpperCase',
	'toLowerCase',
	'trim',
	'replace',
	'padStart',
	'padEnd',
	'join',
])
const MAP_CALLBACK_METHODS = new Set(['map'])

type AstNode = {
	type: string
	[key: string]: unknown
}

function toAstNode(value: unknown): AstNode | null {
	if (!value || typeof value !== 'object') return null
	if (!('type' in value)) return null

	const candidate = value as { type?: unknown }
	if (typeof candidate.type !== 'string') return null

	return value as AstNode
}

function isScopeNode(node: unknown): boolean {
	const astNode = toAstNode(node)
	if (!astNode) return false

	return (
		astNode.type === 'Program' ||
		astNode.type === 'BlockStatement' ||
		astNode.type === 'ArrowFunctionExpression' ||
		astNode.type === 'FunctionDeclaration' ||
		astNode.type === 'FunctionExpression'
	)
}

function isFunctionNode(node: unknown): node is AstNode & { params: unknown[] } {
	const astNode = toAstNode(node)
	if (!astNode) return false

	return (
		astNode.type === 'ArrowFunctionExpression' ||
		astNode.type === 'FunctionDeclaration' ||
		astNode.type === 'FunctionExpression'
	)
}

function getIdentifierName(node: unknown): string | null {
	const astNode = toAstNode(node)
	return astNode?.type === 'Identifier' && typeof astNode.name === 'string' ? astNode.name : null
}

function getMemberPropertyName(node: unknown): string | null {
	return getIdentifierName(node)
}

function unwrapExpression(node: unknown): AstNode | null {
	const astNode = toAstNode(node)
	if (!astNode) return null

	if (astNode.type === 'ChainExpression') {
		return unwrapExpression(astNode.expression)
	}
	if (astNode.type === 'TSAsExpression' || astNode.type === 'TSTypeAssertion') {
		return unwrapExpression(astNode.expression)
	}

	return astNode
}

function isUseSeamDataCall(node: unknown): boolean {
	const astNode = unwrapExpression(node)
	if (!astNode || astNode.type !== 'CallExpression') return false

	return getIdentifierName(astNode.callee) === 'useSeamData'
}

function addPatternBindings(target: Set<string>, pattern: unknown): void {
	const astPattern = toAstNode(pattern)
	if (!astPattern) return

	switch (astPattern.type) {
		case 'Identifier':
			if (typeof astPattern.name === 'string') {
				target.add(astPattern.name)
			}
			return
		case 'ObjectPattern':
			for (const property of (astPattern.properties as unknown[]) ?? []) {
				const astProperty = toAstNode(property)
				if (!astProperty) continue

				if (astProperty.type === 'Property') {
					addPatternBindings(target, astProperty.value)
				} else if (astProperty.type === 'RestElement') {
					addPatternBindings(target, astProperty.argument)
				}
			}
			return
		case 'ArrayPattern':
			for (const element of Array.isArray(astPattern.elements) ? astPattern.elements : []) {
				if (element) addPatternBindings(target, element)
			}
			return
		case 'AssignmentPattern':
			addPatternBindings(target, astPattern.left)
			return
		case 'RestElement':
			addPatternBindings(target, astPattern.argument)
			return
	}
}

type ScopeAnalysis = {
	currentScope: (node: unknown) => object
	registerDeclared: (scopeNode: object, pattern: unknown) => void
	registerDerived: (scopeNode: object, pattern: unknown) => void
	isDerivedExpression: (node: unknown) => boolean
	maybeTrackMapCallbackParams: (node: unknown) => void
}

function createScopeAnalysis(context: Rule.RuleContext): ScopeAnalysis {
	const sourceCode = context.sourceCode
	const rootScope = sourceCode.ast
	const declaredByScope = new WeakMap<object, Set<string>>()
	const derivedByScope = new WeakMap<object, Set<string>>()

	function getScopeBindings(store: WeakMap<object, Set<string>>, scopeNode: object): Set<string> {
		const existing = store.get(scopeNode)
		if (existing) return existing

		const created = new Set<string>()
		store.set(scopeNode, created)
		return created
	}

	function currentScope(node: unknown): object {
		const ancestors = sourceCode.getAncestors(node as Rule.Node)
		for (let i = ancestors.length - 1; i >= 0; i--) {
			if (isScopeNode(ancestors[i])) return ancestors[i] as object
		}
		return rootScope
	}

	function scopeChain(node: unknown): object[] {
		const chain = sourceCode
			.getAncestors(node as Rule.Node)
			.filter((ancestor) => isScopeNode(ancestor)) as object[]
		if (chain.length === 0 || chain[0] !== rootScope) chain.unshift(rootScope)
		return chain
	}

	function registerDeclared(scopeNode: object, pattern: unknown): void {
		addPatternBindings(getScopeBindings(declaredByScope, scopeNode), pattern)
	}

	function registerDerived(scopeNode: object, pattern: unknown): void {
		addPatternBindings(getScopeBindings(derivedByScope, scopeNode), pattern)
	}

	function isDerivedName(name: string, node: unknown): boolean {
		const chain = scopeChain(node)
		for (let i = chain.length - 1; i >= 0; i--) {
			const scopeNode = chain[i]
			if (!scopeNode) continue

			const derived = derivedByScope.get(scopeNode)
			if (derived?.has(name)) return true

			const declared = declaredByScope.get(scopeNode)
			if (declared?.has(name)) return false
		}
		return false
	}

	function isDerivedExpression(node: unknown): boolean {
		const expr = unwrapExpression(node)
		if (!expr) return false

		if (expr.type === 'Identifier' && typeof expr.name === 'string') {
			return isDerivedName(expr.name, expr)
		}
		if (expr.type === 'MemberExpression') {
			return isDerivedExpression(expr.object)
		}

		return isUseSeamDataCall(expr)
	}

	function maybeTrackMapCallbackParams(node: unknown): void {
		const astNode = toAstNode(node)
		if (!astNode || astNode.type !== 'CallExpression') return

		const callee = unwrapExpression(astNode.callee)
		if (!callee || callee.type !== 'MemberExpression') return

		const method = getMemberPropertyName(callee.property)
		if (!method || !MAP_CALLBACK_METHODS.has(method) || !isDerivedExpression(callee.object)) {
			return
		}

		const callback = (astNode.arguments as unknown[])[0]
		if (!callback || !isFunctionNode(callback)) return

		for (const param of callback.params) {
			registerDeclared(callback, param)
			registerDerived(callback, param)
		}
	}

	return {
		currentScope,
		registerDeclared,
		registerDerived,
		isDerivedExpression,
		maybeTrackMapCallbackParams,
	}
}

function createBindingVisitors({
	currentScope,
	registerDeclared,
	registerDerived,
	isDerivedExpression,
}: ScopeAnalysis): Rule.RuleListener {
	return {
		FunctionDeclaration(node) {
			const parentScope = currentScope(node)
			if (node.id) {
				registerDeclared(parentScope, node.id)
			}
			for (const param of node.params) {
				registerDeclared(node, param)
			}
		},

		FunctionExpression(node) {
			if (node.id) {
				registerDeclared(node, node.id)
			}
			for (const param of node.params) {
				registerDeclared(node, param)
			}
		},

		ArrowFunctionExpression(node) {
			for (const param of node.params) {
				registerDeclared(node, param)
			}
		},

		VariableDeclarator(node) {
			const scopeNode = currentScope(node)
			registerDeclared(scopeNode, node.id)

			if (isUseSeamDataCall(node.init) || isDerivedExpression(node.init)) {
				registerDerived(scopeNode, node.id)
			}
		},
	}
}

function createComputationVisitors(
	context: Rule.RuleContext,
	{ isDerivedExpression, maybeTrackMapCallbackParams }: ScopeAnalysis,
): Rule.RuleListener {
	return {
		CallExpression(node) {
			maybeTrackMapCallbackParams(node)

			const callee = unwrapExpression(node.callee)
			if (!callee || callee.type !== 'MemberExpression' || !isDerivedExpression(callee.object)) {
				return
			}

			const method = getMemberPropertyName(callee.property)
			if (!method) return

			if (ARRAY_DERIVATION_METHODS.has(method)) {
				context.report({
					node,
					messageId: 'arrayDerivation',
					data: { method },
				})
			} else if (FORMAT_METHODS.has(method)) {
				context.report({
					node,
					messageId: 'formatMethod',
					data: { method },
				})
			}
		},

		BinaryExpression(node) {
			if (!isDerivedExpression(node.left) && !isDerivedExpression(node.right)) return

			if (ARITHMETIC_OPERATORS.has(node.operator)) {
				context.report({ node, messageId: 'arithmetic' })
			} else if (NUMERIC_COMPARISON_OPERATORS.has(node.operator)) {
				context.report({ node, messageId: 'numericComparison' })
			}
		},

		NewExpression(node) {
			if (
				node.callee.type === 'Identifier' &&
				node.callee.name === 'Date' &&
				node.arguments.length > 0 &&
				node.arguments.some((arg) => isDerivedExpression(arg))
			) {
				context.report({ node, messageId: 'dateConstruction' })
			}
		},
	}
}

function createRuleListeners(context: Rule.RuleContext): Rule.RuleListener {
	const analysis = createScopeAnalysis(context)
	return {
		...createBindingVisitors(analysis),
		...createComputationVisitors(context, analysis),
	}
}

const rule: Rule.RuleModule = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Disallow render-time derived computations from useSeamData() values in skeleton components',
		},
		schema: [],
		messages: {
			arithmetic:
				'Render-time arithmetic on useSeamData() values is not allowed in skeleton components.\n' +
				'  Fix: compute display-ready numbers in the loader/procedure and render the final field directly.',
			numericComparison:
				'Numeric comparisons on useSeamData() values are not allowed in skeleton components.\n' +
				'  Fix: compute the boolean flag in the loader/procedure and branch on that final field.',
			arrayDerivation:
				'{{method}}() on useSeamData() arrays is not allowed in skeleton components.\n' +
				'  Fix: derive the filtered/sorted/aggregated collection in the loader/procedure first.',
			formatMethod:
				'{{method}}() on useSeamData() values is not allowed in skeleton components.\n' +
				'  Fix: format the final display string in the loader/procedure and render it directly.',
			dateConstruction:
				'new Date(useSeamData value) is not allowed in skeleton components.\n' +
				'  Fix: return a display-ready date string from the loader/procedure.',
		},
	},
	create(context) {
		if (!SKELETON_PATTERN.test(context.filename)) return {}
		return createRuleListeners(context)
	},
}

export default rule
