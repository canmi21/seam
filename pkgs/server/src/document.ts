import { stringify } from 'devalue';

const HEAD = '%head%';
const BODY = '%body%';

// devalue rather than JSON, because JSON turns a Date into a string, a Set into an empty object
// and an undefined into nothing at all, and the data crossing here is the author's. Its output is
// still JSON, so the element stays one the browser will not execute.
//
// It escapes `<` itself, which is what closes the hole where a payload holding `</script>` would
// end the element early. That was a hand-written line here until devalue took the job; its own
// goals list XSS mitigation and it covers more of the case than the line did.
function embed(data: unknown): string {
	return `<script type="application/json" data-payload>${stringify(data)}</script>`;
}

// `data` is what the load stage produced, and only that: the derived fields the injector needed
// are the compiler's own and stop at the server. See spec/payload.md.
//
// It goes before </body> rather than into %body%, because that placeholder is the hydration
// target and Svelte walks its children expecting only its own output. A script element sitting
// among them is one node too many.
export function wrap(shell: string, fragment: string, data: unknown, head = ''): string {
	if (!shell.includes(BODY)) throw new Error(`app.html has no ${BODY}`);
	return shell
		.replace(HEAD, head)
		.replace(BODY, fragment)
		.replace('</body>', `${embed(data)}</body>`);
}
