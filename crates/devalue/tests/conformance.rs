//! Held against the JavaScript devalue rather than against a reading of it.
//!
//! `fixtures/wire.json` and `fixtures/uneval.json` record what the real package's `stringify` and
//! `uneval` write for each case, and the table below builds the same values here. The labels tie the two together: one present on a side and not
//! the other fails, so the tables cannot drift apart quietly.

use std::rc::Rc;

use devalue::{Value, stringify, uneval};

fn n(v: f64) -> Value {
	Value::Number(v)
}

fn s(v: &str) -> Value {
	Value::String(v.to_owned())
}

fn object(entries: &[(&str, Value)]) -> Value {
	Value::Object(entries.iter().map(|(key, value)| ((*key).to_owned(), value.clone())).collect())
}

fn cases() -> Vec<(&'static str, Value)> {
	vec![
		("null", Value::Null),
		("true", Value::Bool(true)),
		("false", Value::Bool(false)),
		("zero", n(0.0)),
		("integer", n(42.0)),
		("negative", n(-7.0)),
		("fraction", n(0.1)),
		("float sum", n(0.1 + 0.2)),
		("large integer", n(9_007_199_254_740_991.0)),
		("exponent up", n(1e21)),
		("exponent down", n(1e-7)),
		("string", s("hi")),
		("empty string", s("")),
		("undefined", Value::Undefined),
		("nan", n(f64::NAN)),
		("infinity", n(f64::INFINITY)),
		("negative infinity", n(f64::NEG_INFINITY)),
		("negative zero", n(-0.0)),
		("bigint", Value::BigInt("12345678901234567890".to_owned())),
		("empty array", Value::Array(vec![])),
		("empty object", Value::Object(vec![])),
		("flat object", object(&[("a", n(1.0)), ("b", s("two")), ("c", Value::Bool(true))])),
		(
			"nested array",
			Value::Array(vec![
				n(1.0),
				Value::Array(vec![n(2.0), n(3.0)]),
				Value::Null,
				Value::Bool(true),
			]),
		),
		("nested object", object(&[("a", object(&[("b", object(&[("c", n(1.0))]))]))])),
		("repeated string", object(&[("a", s("hello")), ("b", s("hello"))])),
		("repeated number", object(&[("a", n(42.0)), ("b", n(42.0))])),
		("repeated reference", {
			// One object under two keys. A tree has no identity of its own, so sharing is stated
			// rather than discovered, and the two fields land on one entry the way they do in
			// JavaScript.
			let shared = std::rc::Rc::new(object(&[("x", n(1.0))]));
			object(&[("a", Value::Shared(shared.clone())), ("b", Value::Shared(shared))])
		}),
		// Structurally equal but not shared, which devalue numbers separately. The pair of cases
		// is what pins the difference between identity and equality.
		(
			"distinct objects",
			object(&[("a", object(&[("x", n(1.0))])), ("b", object(&[("x", n(1.0))]))]),
		),
		(
			"sentinels in object",
			object(&[
				("z", n(-0.0)),
				("n", n(f64::NAN)),
				("i", n(f64::INFINITY)),
				("m", n(f64::NEG_INFINITY)),
				("u", Value::Undefined),
			]),
		),
		("date", Value::Date("1970-01-01T00:00:00.000Z".to_owned())),
		("date in object", object(&[("when", Value::Date("2026-09-02T12:34:56.789Z".to_owned()))])),
		("set", Value::Set(vec![s("a"), s("b")])),
		("empty set", Value::Set(vec![])),
		("map", Value::Map(vec![(s("k"), n(1.0))])),
		("map with object values", Value::Map(vec![(s("a"), object(&[("x", n(1.0))]))])),
		("regexp", Value::RegExp { source: "ab+c".to_owned(), flags: String::new() }),
		("regexp with flags", Value::RegExp { source: "ab+c".to_owned(), flags: "gi".to_owned() }),
		("url", Value::Url("https://a.b/c?d=1".to_owned())),
		("search params", Value::UrlSearchParams("a=1&b=2".to_owned())),
		("quote", object(&[("s", s("a\"b"))])),
		("backslash", object(&[("s", s("a\\b"))])),
		("angle bracket", object(&[("s", s("</script>"))])),
		("newline", object(&[("s", s("a\nb\r\tc"))])),
		("control character", object(&[("s", s("a\u{1}b"))])),
		("line separators", object(&[("s", s("a\u{2028}b\u{2029}c"))])),
		("non ascii", object(&[("s", s("中文 \u{1f600}"))])),
		("key needing escape", object(&[("a\"b<c", n(1.0))])),
		// What `uneval` writes differently from `stringify`, and the names it hands out.
		("fraction under one", n(0.5)),
		("negative fraction", object(&[("n", n(-0.25))])),
		("shared twice in array", {
			let twice = Rc::new(object(&[("y", n(2.0))]));
			Value::Array(vec![Value::Shared(twice.clone()), Value::Shared(twice)])
		}),
		("shared object with quoted keys", {
			let quoted = Rc::new(object(&[("a b", n(1.0)), ("c", Value::Array(vec![n(1.0), n(2.0)]))]));
			object(&[("a", Value::Shared(quoted.clone())), ("b", Value::Shared(quoted))])
		}),
		("shared set and map", {
			let set = Rc::new(Value::Set(vec![n(1.0)]));
			let map = Rc::new(Value::Map(vec![(s("k"), Value::Shared(set.clone()))]));
			object(&[
				("a", Value::Shared(map.clone())),
				("b", Value::Shared(map)),
				("c", Value::Shared(set)),
			])
		}),
		("shared date", {
			let when = Rc::new(Value::Date("2026-09-02T12:34:56.789Z".to_owned()));
			Value::Array(vec![Value::Shared(when.clone()), Value::Shared(when)])
		}),
		("date before the epoch", Value::Date("1960-01-01T00:00:00.000Z".to_owned())),
		("long string twice", {
			let long = "x".repeat(200);
			Value::Array(vec![s(&long), s(&long)])
		}),
		(
			"bigint twice",
			Value::Array(vec![Value::BigInt("10".to_owned()), Value::BigInt("10".to_owned())]),
		),
		("many shared", {
			// Enough to reach two-letter names and the first reserved one, `do`, which is name 230.
			let many: Vec<Rc<Value>> =
				(0..240).map(|i| Rc::new(object(&[("i", n(f64::from(i)))]))).collect();
			Value::Array(many.iter().chain(many.iter()).map(|one| Value::Shared(one.clone())).collect())
		}),
		(
			"keys needing quotes",
			object(&[("a-b", n(1.0)), ("<x>", n(2.0)), ("line\u{2028}", n(3.0)), ("$ok", n(4.0))]),
		),
	]
}

fn wire() -> std::collections::BTreeMap<String, String> {
	recorded("wire.json")
}

fn recorded(file: &str) -> std::collections::BTreeMap<String, String> {
	let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(file);
	let text = std::fs::read_to_string(&path)
		.unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
	serde_json::from_str(&text).unwrap_or_else(|e| panic!("{file} does not parse: {e}"))
}

#[test]
fn every_case_writes_what_javascript_writes() {
	let expected = wire();
	let mut checked = 0;
	for (label, value) in cases() {
		let want = expected
			.get(label)
			.unwrap_or_else(|| panic!("`{label}` is not in wire.json; regenerate the fixtures"));
		assert_eq!(&stringify(&value), want, "`{label}` disagrees with the JavaScript devalue");
		checked += 1;
	}
	assert_eq!(checked, expected.len(), "wire.json holds cases this table does not build");
}

#[test]
fn every_case_unevals_to_what_javascript_writes() {
	let expected = recorded("uneval.json");
	let mut checked = 0;
	for (label, value) in cases() {
		let want = expected
			.get(label)
			.unwrap_or_else(|| panic!("`{label}` is not in uneval.json; regenerate the fixtures"));
		assert_eq!(&uneval(&value), want, "`{label}` disagrees with the JavaScript devalue");
		checked += 1;
	}
	assert_eq!(checked, expected.len(), "uneval.json holds cases this table does not build");
}

/// The crate is the port of one devalue, and that is the one the fixtures were recorded with: the
/// version the workspace pins. A bump there without a port here fails here. See spec/payload.md.
/// The crate as published sits outside the workspace, where there is no pin to disagree with.
#[test]
fn version_is_the_one_the_fixtures_were_recorded_with() {
	let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../package.json");
	let Ok(text) = std::fs::read_to_string(&path) else { return };
	let manifest: serde_json::Value =
		serde_json::from_str(&text).expect("package.json does not parse");
	let pinned =
		manifest["devDependencies"]["devalue"].as_str().expect("package.json pins no devalue");
	assert_eq!(
		env!("CARGO_PKG_VERSION"),
		pinned,
		"devalue moved to {pinned}: port its diff, regenerate the fixtures and bump this crate"
	);
}
