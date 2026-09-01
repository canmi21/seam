# Seam & SeamJS

Seam is being rebuilt. The protocol stays, the compiler in front of it does not.

The previous version lives whole on the
[`observation`](https://github.com/canmi21/seam/tree/observation) branch, including the Go and
TypeScript servers that no longer exist here.

It found page structure by rendering React against mock data and diffing the output, which is
where that branch gets its name. The new one reads the Svelte template AST and lowers it, so
structure is generated rather than guessed. The original design is written up in
[Rendering as a Protocol](https://canmi.net/architecture/compile-time-rendering), and where it
goes next in [Future of SeamJS](https://canmi.net/architecture/observation-to-lowering).

## License

MIT License © 2025 [Canmi](https://canmi.net)
