# Naming

## The project's name appears once

The workspace rule is to name a module for what it does rather than for who supplies it. This is
that rule turned on ourselves: **the product name is not a prefix, an id, a placeholder or an
attribute.** Code says what a thing objectively is, and a reader who has never heard of this
project can still tell what they are looking at.

| was | is | because |
| --- | --- | --- |
| `%seam.body%` | `%body%` | it is the body of the document |
| `<div id="seam">` | `<div id="app">` | it is where the application mounts |
| `data-seam-payload` | `data-payload` | it is the payload |
| `createSeamServer` | `createServer` | it is in a package called `server` |
| `seam-lowering` | `lowering` | it lowers |

The prefix carried no information in any of those. `%seam.body%` is not a different placeholder
from `%body%`; it is the same placeholder with a brand on it, and the brand is already implied by
the file it sits in.

**One place signs the work**: a version marker the client runtime puts on `window`. That is where
somebody debugging a page finds out what produced it, and one such place answers the question
that a hundred prefixes were only gesturing at.

## What this does not cover

Prose. The specification, commit messages and documentation name the project as often as they
need to, because there the name is the subject rather than a decoration.

Package and crate names are also outside it, in the sense that they are already neutral --
`injector`, `server`, `ast`, `derive`, `lowering` -- and a published name, if one is ever needed,
is a distribution question rather than a naming one.
