# Seam & SeamJS

Seam is being rebuilt. The protocol stays, the compiler in front of it does not.

Compile-time rendering for Svelte: a component is rendered once, at build time, into an IR a
server fills per request, and the bytes are what SvelteKit's server render would have sent. The
framework around it is SvelteKit with that one step moved; Kit's source sits under `vendor/kit`
as it is written. The rules are in `spec/`, what is left in `spec/roadmap.md`.

The previous version lives whole on the
[`observation`](https://github.com/canmi21/seam/tree/observation) branch, including the Go and
TypeScript servers that no longer exist here.

It found page structure by rendering React against mock data and diffing the output, which is
where that branch gets its name. The new one reads the Svelte template AST and lowers it, so
structure is generated rather than guessed. The original design is written up in
[Rendering as a Protocol](https://canmi.net/architecture/compile-time-rendering), and where it
goes next in [Future of SeamJS](https://canmi.net/architecture/observation-to-lowering).

## License

The compiler reads [Svelte](https://svelte.dev)'s template AST and its server output, and the IR
and the walk over the AST were written against Svelte's own compiler, under the MIT License. The
framework layer is built on [SvelteKit](https://svelte.dev/docs/kit), whose source is kept under
`vendor/kit` as its authors wrote it, under the MIT License.

MIT License © 2025 [Canmi](https://canmi.net)
