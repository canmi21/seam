const HEAD = '%seam.head%';
const BODY = '%seam.body%';

// A JSON payload inside a script element ends at the first `</script`, wherever it appears,
// including inside a string. Escaping `<` is what closes that hole; the result is still valid
// JSON, because < is how JSON spells it.
function embed(payload: unknown): string {
	const json = JSON.stringify(payload).replaceAll('<', '\\u003C');
	return `<script type="application/json" data-seam-payload>${json}</script>`;
}

export function wrap(shell: string, fragment: string, payload: unknown, head = ''): string {
	if (!shell.includes(BODY)) throw new Error(`app.html has no ${BODY}`);
	return shell.replace(HEAD, head).replace(BODY, fragment + embed(payload));
}
