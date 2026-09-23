# Devalue

A Rust port of [devalue](https://github.com/sveltejs/devalue), byte for byte with the JavaScript
package of the same version.

`JSON.stringify` turns a `Date` into a string, a `Set` into `{}` and an `undefined` into nothing
at all. devalue carries them, and its output is still JSON, so serialized state can sit inside a
`<script type="application/json">` that the browser will not execute. Svelte and SvelteKit use it
to hand a page its data.

This exists so that a server which is not Node can do the same.

```rust
use devalue::{Value, stringify};

let value = Value::Object(vec![
	("when".to_owned(), Value::Date("1970-01-01T00:00:00.000Z".to_owned())),
	("tags".to_owned(), Value::Set(vec![Value::String("a".to_owned())])),
]);

assert_eq!(
	stringify(&value),
	r#"[{"when":1,"tags":2},["Date","1970-01-01T00:00:00.000Z"],["Set",3],"a"]"#
);
```

## What is here

`stringify`, `uneval`, and the values they accept.

`uneval` writes JavaScript that evaluates to the value, which is not how state should reach a page
of your own choosing. It is here because Svelte writes one: the script `hydratable` values reach
the client through is `uneval`'s, and a server reproducing Svelte's bytes has to write it too.

`parse` is not here, because it runs in the browser where the original already is. It is not
approximated.

Cycles cannot be built from the value type. Repeated references can, by stating them with
`Value::Shared`, since a Rust tree has no identity of its own to compare.

Not yet carried: `Temporal`, `ArrayBuffer` and the typed arrays, sparse arrays, boxed primitives,
objects with a null prototype, and custom reducers.

## How it is checked

Against the real package rather than against a reading of it. A generator records what the
JavaScript devalue writes for every case, this crate builds the same values, and the bytes are
compared. Two things had to be told rather than observed: primitives are deduplicated by value
while objects are deduplicated by identity, and JavaScript prints a number in exponent form at
`1e21` and below `1e-6` where Rust never does.

## Version

The version tracks the npm package it reproduces. `6.0.1` here agrees with `6.0.1` there, and
saying so is the only claim it can make, because devalue does not promise its format is stable
across versions.

## License

MIT License © 2026 [Canmi](https://canmi.net)
