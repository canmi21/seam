/**
 * The walk over one file's markup: one pass that plants a marker wherever a value goes and
 * follows a block into its branches, a tag into the child it names, and a render tag into its
 * snippet. See spec/pipeline.md.
 */
import { mentions } from 'ast';
import { carries } from './compose.ts';
import { isNode, refuse, span } from './node.ts';
import { OMITTED_IN_SSR } from './omitted.ts';
import { collectAwait, collectEach, collectIf } from './collect-blocks.ts';
import { collectElement, collectSlot } from './collect-elements.ts';
import { collectRender, collectSnippet, collectTag } from './collect-tags.ts';
import type { Stream } from './shape.ts';
import { boundary } from './boundary.ts';
import { contains, onlyChild, selfCall } from './components.ts';
import { INERT, REFUSED } from './selection.ts';
import { held } from './stamps.ts';
import { type Walk } from './walk-types.ts';
import { leaves, snippetNamed } from './written.ts';

/** What a case hands a child to be walked with: the same walk, or one over the other stream. */
export type Stepper = (child: unknown, into?: Stream) => void;

export function collect(node: unknown, walk: Walk): void {
	const { blocks, edits, expand, site, source, stream, within } = walk;
	if (!isNode(node)) return;
	const type = node['type'];
	if (typeof type !== 'string') {
		refuse('a markup node with no type reached the compiler, which cannot happen');
	}

	// Anything but the stream is the same walk, so what changes is spread over it. The lists are
	// shared by reference, which is what makes the numbering one sequence across the whole tree.
	const step = (child: unknown, into: Stream = stream): void => {
		collect(child, into === stream ? walk : { ...walk, stream: into });
	};

	if (INERT.has(type)) return;

	// A binding the server writes nothing for. It is not that the value is dropped: there is no
	// value, because every one of these is a measurement only a browser can take. So the walk steps
	// over it exactly as it steps over a transition. See `omitted.ts`, and spec/refusals.md.
	if (type === 'BindDirective' && OMITTED_IN_SSR.has(String(node['name']))) return;
	const why = REFUSED[type];
	if (why !== undefined) refuse(why);

	switch (type) {
		case 'Fragment': {
			// Which node the fragment holds alone, for the children of this fragment and no deeper.
			// Reset to true for them, so a block inside an element is standalone again. See
			// `onlyChild` and `Walk.standalone`.
			held(
				Array.isArray(node['nodes']) ? node['nodes'] : [],
				walk,
				walk.standalone ? onlyChild(node) : null,
			);
			return;
		}

		case 'Text':
			return;

		case 'SvelteFragment': {
			// A wrapper that writes nothing of its own: it exists to carry a `slot=` and its `let:`
			// directives, which the caller's grouping already read. Its children are the group.
			step(node['fragment']);
			return;
		}

		case 'SlotElement': {
			collectSlot(node, walk, step);
			return;
		}

		case 'SvelteSelf': {
			// A call of the fragment this component is: `SvelteSelf.js` is `build_inline_component`
			// with the component itself, and the walk entered the component as a fragment.
			if (site.fragment === undefined) {
				refuse(
					'`<svelte:self>` in a component the walk did not enter as one rendering itself, ' +
						'which cannot happen: the walk reads for it before entering',
				);
			}
			selfCall(node, walk, 'SeamSelf', site.fragment, undefined, undefined, true);
			return;
		}

		case 'SvelteHead': {
			// The other stream. Everything under it renders into the head rather than the body.
			// And written where the component runs: inside a body block, once per branch taken or
			// per item. Every if and each this sits inside has to stand in the head stream as well,
			// and is told so here, to read once its body is walked. A dynamic element is not one:
			// it decides nothing about what is inside it. See `mirrored()`.
			for (const [index] of within) {
				if (blocks[index]?.kind !== 'element') site.headed.add(index);
			}
			// A head block holding a title opens with a stand-in that says so, because which title
			// wins is decided per head block: `$.head` is hoisted ahead of its fragment, so the last
			// head block executed compares later under `set_title`, and inside one block the first
			// title executed is kept. The injector counts the blocks by this. See spec/ir.md.
			if (contains(node['fragment'], 'TitleElement')) {
				// Where the first child starts, with the whitespace before it taken out: Svelte trims
				// the whitespace that opens a fragment, and the stand-in must not turn it into a space
				// between two elements.
				const whole = span(node);
				const open = whole === null ? -1 : source.indexOf('>', whole[0]);
				if (open >= 0) {
					let first = open + 1;
					while (first < source.length && /\s/.test(source[first] ?? '')) first += 1;
					edits.push([open + 1, first, '<seam-title-open></seam-title-open>']);
				}
			}
			step(node['fragment'], 'head');
			return;
		}

		case 'ExpressionTag':
		case 'HtmlTag': {
			collectTag(node, type, walk);
			return;
		}

		case 'SvelteElement':
		case 'RegularElement':
		case 'Component':
		case 'SvelteComponent':
		case 'TitleElement': {
			collectElement(node, type, walk);
			return;
		}

		case 'Attribute': {
			const name = typeof node['name'] === 'string' ? node['name'] : '';
			// An event handler is never serialised, so it has no hole and no place in the output.
			if (name.startsWith('on') && name.length > 2) return;
			const value = node['value'];
			// A bare name, which is the attribute being present rather than valued.
			if (value === true) return;
			const parts = Array.isArray(value) ? value : [value];
			// Svelte puts `translate` through a replacement table on the way out -- `true` is written
			// `"yes"` and `false` `"no"` -- and it is the one entry. A literal is folded by Svelte in
			// the render; a value decided per request is a hole like any other, and the injector
			// carries the table under the name. See spec/ir.md.
			// `{n}` is sugar for `n={n}`, and the sugar only holds a bare name: put anything else
			// between those braces and Svelte's parser stops with `attribute_empty_shorthand`. This
			// pass puts a marker there, so a shorthand attribute made the compiler fail inside
			// Svelte, pointing at the author's own file and telling them something untrue about it.
			// Writing the name back out first is not a rewrite of the value -- the two forms render
			// the same bytes, measured -- and it leaves the marker somewhere the parser accepts.
			const at = span(node);
			if (at !== null && source[at[0]] === '{') edits.push([at[0], at[0], `${name}=`]);
			// Only where the expression is the whole of the value: text beside it makes the value a
			// template, which is never empty, and the shape below assumes one expression.
			const inClass = name === 'class' && walk.scoping === true;
			const classValue = inClass && parts.length === 1;
			for (const part of parts) collect(part, { ...walk, inClass, classValue });
			return;
		}

		case 'SnippetBlock': {
			collectSnippet(node, walk);
			return;
		}

		case 'RenderTag': {
			collectRender(node, walk);
			return;
		}

		case 'AwaitBlock': {
			collectAwait(node, walk, step);
			return;
		}

		case 'SvelteBoundary': {
			// Read out of `3-transform/server/visitors/SvelteBoundary.js`. Given a `pending` snippet a
			// synchronous render is pending by definition: `<!--[!-->`, that body, `<!--]-->`, one
			// shape. Given a `failed` one, whether the children throw and what `transformError` made
			// of it are the request's, and that is a block, in `boundary()`. Given neither, the
			// anchors are a pair the assembler copies as bytes. `pending={p}` and `failed={f}` were
			// written as the tag form first; see `boundaries()` in snippets.ts.
			const fragment = node['fragment'];
			const children =
				isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
			const pendingSnippet = children.find((child) => snippetNamed(child, 'pending'));
			// The failed snippet **stays** in the rendered source. `renderer.boundary` rethrows where
			// `props.failed` is missing, so taking it out is what let a throw the boundary exists to
			// catch escape the render -- measured, four of Svelte's samples reported the author's own
			// error message as a compile failure. It is declared with a parameter and never rendered
			// here, which the walk refuses about a body nobody writes; that refusal skips it by name
			// instead, since Svelte is the one that calls it.
			const failedSnippet = children.find((child) => snippetNamed(child, 'failed'));
			if (pendingSnippet !== undefined) {
				step(pendingSnippet['body']);
				return;
			}
			// A `failed` snippet makes a block: whether the children threw and what `transformError`
			// made of it are the request's. See `boundary()`.
			if (failedSnippet !== undefined) {
				boundary(
					node,
					children.filter((child) => child !== failedSnippet),
					failedSnippet,
					walk,
					fragment,
				);
				return;
			}
			// As a fragment, so a `{@const}` or `{const}` written straight inside the boundary binds
			// for the whole of it -- `clean_nodes` hoists them from the boundary's fragment as from
			// any other.
			held(children, walk, walk.standalone && isNode(fragment) ? onlyChild(fragment) : null);
			return;
		}

		case 'KeyBlock': {
			// The key is the client's: it says when to recreate the fragment, and the server's
			// transform never evaluates it. `KeyBlock.js` writes `<!---->`, the fragment, `<!---->`,
			// which is no block at all -- an empty comment is what the assembler steps over -- so the
			// body is walked as if the key were not there, because on the server it is not.
			step(node['fragment']);
			return;
		}

		case 'IfBlock': {
			collectIf(node, walk, step);
			return;
		}

		case 'EachBlock': {
			collectEach(node, walk, step);
			return;
		}

		// A spread on a component the walk could not enter. Its keys are the child's props, and
		// `build_inline_component` merges it with `$.spread_props` in source order, so what the
		// render needs is the object itself with the request's values standing in it.
		//
		// A marker is a string and spreading a string spreads its characters, so the object has to
		// be one whose leaves can each hold one. `leaves` is the same reading an attribute's object
		// value already gets. Where the object itself is what the request decides there is nothing
		// to put a marker inside, and that is refused by name rather than written wrong.
		case 'SpreadAttribute': {
			const whole = span(node);
			if (whole === null) return;
			const grown = expand(node['expression']);
			const varying = site.payload !== null && (carries(grown) || mentions(grown, walk.dynamic));
			const text = varying ? leaves(grown, walk) : grown;
			if (text === null) {
				refuse(
					`\`{...${grown.slice(0, 40)}}\` is a spread on a component the walk could not enter, ` +
						'over a value the request decides: its keys cannot be listed, so nothing can stand ' +
						'in the object while the bytes are written',
				);
			}
			edits.push([whole[0], whole[1], `{...${text}}`]);
			return;
		}

		default:
			refuse(
				`\`${source.slice(...(span(node) ?? [0, 0])).slice(0, 60)}\` is a ${type}, which the ` +
					'compiler has not been taught. Nothing is refused on principle, so this is a gap ' +
					'rather than a boundary',
			);
	}
}
