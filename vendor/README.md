# Vendored source

Code taken from another project and kept here as files, at one pinned version, as its authors
wrote it. The arrangement -- where a copy sits, how it is taken, that it is not edited and is
reached through one package, that lint and format leave it alone -- is the workspace's, in
[spec/vendor.md](../../../spec/vendor.md). Each entry carries its upstream's `LICENSE` and a
`VENDOR.md` saying which tag it is, what was taken, what checks run and how it is upgraded.

| entry | upstream | reached through |
| --- | --- | --- |
| [`kit/`](kit/VENDOR.md) | SvelteKit, `packages/kit` at `@sveltejs/kit@2.70.2` | `pkgs/routes`; see [spec/framework.md](../spec/framework.md) |
