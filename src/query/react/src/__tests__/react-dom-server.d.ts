/* src/query/react/src/__tests__/react-dom-server.d.ts */

// react-dom 19 ships its own types but does not cover the /server subpath
declare module 'react-dom/server' {
	export function renderToString(element: React.ReactElement): string
}
