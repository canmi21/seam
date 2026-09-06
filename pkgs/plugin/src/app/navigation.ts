/**
 * `$app/navigation` for the carried bundle. Nothing navigates while a derivation is evaluated, and
 * Kit's server module says the same by throwing; a derivation that calls one of these is reading a
 * browser that is not there.
 */
function browserOnly(name: string): () => never {
	return () => {
		throw new Error(`Cannot call ${name}(...) on the server`);
	};
}

export const afterNavigate = browserOnly('afterNavigate');
export const beforeNavigate = browserOnly('beforeNavigate');
export const disableScrollHandling = browserOnly('disableScrollHandling');
export const goto = browserOnly('goto');
export const invalidate = browserOnly('invalidate');
export const invalidateAll = browserOnly('invalidateAll');
export const refreshAll = browserOnly('refreshAll');
export const onNavigate = browserOnly('onNavigate');
export const preloadCode = browserOnly('preloadCode');
export const preloadData = browserOnly('preloadData');
export const pushState = browserOnly('pushState');
export const replaceState = browserOnly('replaceState');
