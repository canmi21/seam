<!-- examples/shadcn-ui-demo/README.md -->

# shadcn/ui Demo

This example showcases `tailwindcss@4` and shadcn-style Radix wrappers on Seam CTR.

It is organized to make the SSR boundary visible:

- display primitives render fully in the skeleton HTML
- closed portal components render stable triggers during SSR
- default-open portal components still render only triggers during SSR and expand after hydration

Run:

```bash
bun install
cd examples/shadcn-ui-demo
bun run dev
```
