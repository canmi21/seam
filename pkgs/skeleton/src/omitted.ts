/**
 * The bindings Svelte's server writes nothing for.
 *
 * Copied from `binding_properties` in Svelte's `phases/bindings.js`, which marks each one
 * `omit_in_ssr`. Every name here is a measurement the browser takes -- how wide the viewport is,
 * where the page is scrolled, how far a video has played, which element has focus -- and a server
 * has none of them, so the byte stream is the same with the binding and without it.
 *
 * **It is copied, and a copy goes stale quietly**, so `omitted.test.ts` renders every name here
 * against Svelte and fails if one of them starts writing something. That is the same arrangement
 * as everything else here that depends on Svelte's behaviour: borrow the answer, then hold it.
 *
 * The alternative was to plant a sentinel in each binding and read which ones came back, which
 * needs no list at all. It was turned down for a reason worth writing down: it would make an
 * unconsumed hole mean *the server omits this* rather than *content was lost*, and the invariant
 * that every hole is consumed exactly once is what has caught four defects in this compiler. A
 * list that can go stale is cheaper than an invariant that can no longer fail.
 */
export const OMITTED_IN_SSR: ReadonlySet<string> = new Set([
	// media
	'currentTime',
	'duration',
	'paused',
	'buffered',
	'seekable',
	'played',
	'volume',
	'muted',
	'playbackRate',
	'seeking',
	'ended',
	'readyState',
	'videoHeight',
	'videoWidth',
	// images
	'naturalWidth',
	'naturalHeight',
	// the document
	'activeElement',
	'fullscreenElement',
	'pointerLockElement',
	'visibilityState',
	// the viewport
	'innerWidth',
	'innerHeight',
	'outerWidth',
	'outerHeight',
	'scrollX',
	'scrollY',
	'online',
	'devicePixelRatio',
	// what an element measures to
	'clientWidth',
	'clientHeight',
	'offsetWidth',
	'offsetHeight',
	'contentRect',
	'contentBoxSize',
	'borderBoxSize',
	'devicePixelContentBoxSize',
	// the rest
	'focused',
	'indeterminate',
	'files',
	'this',
]);
