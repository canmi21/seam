/**
 * What a tag name decides about the bytes around it, which `<svelte:element>` needs at request
 * time and cannot know at compile time.
 *
 * Copied from `VOID_ELEMENT_NAMES`, `RAW_TEXT_ELEMENTS` and `REGEX_VALID_TAG_NAME` in Svelte's
 * `src/utils.js`, which `internal/server`'s `element()` reads for exactly these three questions:
 * whether the element writes children and a closing tag at all, whether Svelte puts an empty
 * comment before that closing tag, and whether the tag is one it will write.
 *
 * **They are copied, and a copy goes stale quietly**, so `tags.test.ts` renders every name here
 * against Svelte and fails if one of them stops behaving the way the list says. That is the same
 * arrangement as `omitted.ts`: borrow the answer, then hold it to what it does.
 *
 * They are written into the artifact rather than reproduced in a runtime. The compiler turns each
 * into an ordinary expression over the tag, so the lists travel in the derivation bundle both
 * backends already run and neither has a list of its own to keep in step.
 */
export const VOID_ELEMENTS: readonly string[] = [
	'area',
	'base',
	'br',
	'col',
	'command',
	'embed',
	'hr',
	'img',
	'input',
	'keygen',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
];

/** Svelte's `RAW_TEXT_ELEMENTS`. Their content is not markup, so no empty comment closes it. */
export const RAW_TEXT_ELEMENTS: readonly string[] = ['textarea', 'script', 'style', 'title'];

/** Svelte's `REGEX_VALID_TAG_NAME`, as source, because it is written into an expression. */
export const VALID_TAG_NAME = String.raw`/^[a-zA-Z][a-zA-Z0-9]*(-[a-zA-Z0-9.\-_\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}]*)?$/u`;
