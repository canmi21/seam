//! `devalue.uneval`, reproduced.
//!
//! The output is JavaScript that evaluates to the value: a literal where every value occurs once,
//! and a function that declares the shared ones first and returns the root where some occur more
//! than once. Svelte writes it into the script `hydratable` values reach the client through, which
//! is bytes a page is compared on, so it is reproduced for the same reason `stringify` is.
//!
//! The names a shared value is declared under are handed out in the order the walk first meets
//! each one a second time, and long strings and big integers that repeat are declared too where
//! that is shorter. Both orders are the output, so they are kept exactly.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use crate::escape::string;
use crate::number;
use crate::value::Value;

/// Strings this long or longer are counted, and declared once where they repeat.
const MIN_STRING_LENGTH: usize = 128;

/// Turns a value into the JavaScript that creates an equivalent one.
pub fn uneval(value: &Value) -> String {
	let mut walk = Walk::default();
	walk.walk(value);

	let mut names: HashMap<Identity, String> = HashMap::new();
	let mut at = 0;
	let mut next = || {
		let name = name(at);
		at += 1;
		name
	};
	for identity in &walk.repeated {
		names.insert(identity.clone(), next());
	}
	for (key, count) in &walk.counts {
		if *count < 2 {
			continue;
		}
		// A name is taken for every primitive that repeats, used or not, which moves the names
		// after it: devalue calls `next_name()` before deciding.
		let name = next();
		let length = js_length(&primitive(&key.value()));
		if length * count > length + (count + 1) * name.len() + 40 {
			names.insert(Identity::Primitive(key.clone()), name);
		}
	}

	let mut out = Out { names, seen: HashSet::new(), statements: Vec::new() };
	let root = out.stringify(value);
	if out.statements.is_empty() {
		return root;
	}
	format!("(function(){{{};return {root}}}())", out.statements.join(";"))
}

/// What a value is the same value as: a shared one by address, a counted primitive by value.
#[derive(Clone, PartialEq, Eq, Hash)]
enum Identity {
	Shared(*const Value),
	Primitive(Counted),
}

/// A primitive devalue counts: a long string or a big integer.
#[derive(Clone, PartialEq, Eq, Hash)]
enum Counted {
	String(String),
	BigInt(String),
}

impl Counted {
	fn value(&self) -> Value {
		match self {
			Self::String(v) => Value::String(v.clone()),
			Self::BigInt(v) => Value::BigInt(v.clone()),
		}
	}

	fn of(value: &Value) -> Option<Self> {
		match value {
			Value::String(v) if js_length(v) >= MIN_STRING_LENGTH => Some(Self::String(v.clone())),
			Value::BigInt(v) => Some(Self::BigInt(v.clone())),
			_ => None,
		}
	}
}

#[derive(Default)]
struct Walk {
	seen: HashSet<*const Value>,
	/// Shared values met a second time, in the order that happened.
	repeated: Vec<Identity>,
	/// Counted primitives, in the order each was first met, with how often.
	counts: Vec<(Counted, usize)>,
}

impl Walk {
	fn walk(&mut self, value: &Value) {
		match value {
			Value::Shared(inner) => {
				if inner.primitive() || matches!(**inner, Value::Undefined) {
					self.walk(inner);
					return;
				}
				let at = Rc::as_ptr(inner);
				if !self.seen.insert(at) {
					let identity = Identity::Shared(at);
					if !self.repeated.contains(&identity) {
						self.repeated.push(identity);
					}
					return;
				}
				self.walk(inner);
			}
			Value::Array(items) | Value::Set(items) => {
				for item in items {
					self.walk(item);
				}
			}
			Value::Map(entries) => {
				for (key, value) in entries {
					self.walk(key);
					self.walk(value);
				}
			}
			Value::Object(entries) => {
				for (_, value) in entries {
					self.walk(value);
				}
			}
			other => {
				if let Some(key) = Counted::of(other) {
					match self.counts.iter_mut().find(|(held, _)| *held == key) {
						Some((_, count)) => *count += 1,
						None => self.counts.push((key, 1)),
					}
				}
			}
		}
	}
}

struct Out {
	names: HashMap<Identity, String>,
	seen: HashSet<Identity>,
	statements: Vec<String>,
}

impl Out {
	fn stringify(&mut self, value: &Value) -> String {
		let identity = match value {
			Value::Shared(inner) if !inner.primitive() && !matches!(**inner, Value::Undefined) => {
				Some(Identity::Shared(Rc::as_ptr(inner)))
			}
			Value::Shared(inner) => return self.stringify(inner),
			other => Counted::of(other).map(Identity::Primitive),
		};
		let named = identity.as_ref().and_then(|one| self.names.get(one).cloned());
		let (Some(identity), Some(name)) = (identity, named) else {
			return match value {
				Value::Shared(inner) => self.literal(inner),
				other if other.primitive() || matches!(other, Value::Undefined) => primitive(other),
				other => self.literal(other),
			};
		};
		if self.seen.contains(&identity) {
			return name;
		}
		self.seen.insert(identity);
		let inner = match value {
			Value::Shared(inner) => &**inner,
			other => other,
		};
		match inner {
			Value::Object(entries) => {
				self.statements.push(format!("let {name}={{}}"));
				for (key, value) in entries {
					let written = self.stringify(value);
					self.statements.push(format!("{name}{}={written}", safe_prop(key)));
				}
			}
			Value::Array(items) => {
				// Dense, so never the sparse allocator: that is chosen only where the length
				// outruns twice the populated indices by 32.
				self.statements.push(format!("let {name}=Array({})", items.len()));
				for (at, item) in items.iter().enumerate() {
					let written = self.stringify(item);
					self.statements.push(format!("{name}[{at}]={written}"));
				}
			}
			Value::Set(items) => {
				let entries: Vec<String> = items.iter().map(|item| self.stringify(item)).collect();
				self.statements.push(collection(&name, "Set", &entries));
			}
			Value::Map(pairs) => {
				let entries: Vec<String> = pairs
					.iter()
					.map(|(key, value)| format!("[{},{}]", self.stringify(key), self.stringify(value)))
					.collect();
				self.statements.push(collection(&name, "Map", &entries));
			}
			other if other.primitive() => {
				self.statements.push(format!("let {name}={}", primitive(other)));
			}
			other => {
				let written = self.literal(other);
				self.statements.push(format!("let {name}={written}"));
			}
		}
		name
	}

	/// A value written out where it stands, which is `actually_stringify`.
	fn literal(&mut self, value: &Value) -> String {
		match value {
			Value::Date(iso) => format!("new Date({})", time(iso)),
			Value::RegExp { source, flags } if flags.is_empty() => {
				format!("new RegExp({})", string(source))
			}
			Value::RegExp { source, flags } => format!("new RegExp({},\"{flags}\")", string(source)),
			Value::Url(href) => format!("new URL({})", string(href)),
			Value::UrlSearchParams(query) => format!("new URLSearchParams({})", string(query)),
			Value::Array(items) => {
				let items: Vec<String> = items.iter().map(|item| self.stringify(item)).collect();
				format!("[{}]", items.join(","))
			}
			Value::Set(items) => {
				let items: Vec<String> = items.iter().map(|item| self.stringify(item)).collect();
				format!("new Set([{}])", items.join(","))
			}
			Value::Map(pairs) => {
				let entries: Vec<String> = pairs
					.iter()
					.map(|(key, value)| format!("[{},{}]", self.stringify(key), self.stringify(value)))
					.collect();
				format!("new Map([{}])", entries.join(","))
			}
			Value::Object(entries) => {
				let entries: Vec<String> = entries
					.iter()
					.map(|(key, value)| format!("{}:{}", safe_key(key), self.stringify(value)))
					.collect();
				format!("{{{}}}", entries.join(","))
			}
			Value::Shared(_) => self.stringify(value),
			other => primitive(other),
		}
	}
}

/// `let name=new Set([...])`, or `new Set` alone where it holds nothing.
fn collection(name: &str, kind: &str, entries: &[String]) -> String {
	if entries.is_empty() {
		format!("let {name}=new {kind}")
	} else {
		format!("let {name}=new {kind}([{}])", entries.join(","))
	}
}

/// `stringify_primitive`: a string quoted, `void 0`, `-0`, and a number with its leading zero off.
fn primitive(value: &Value) -> String {
	match value {
		Value::String(v) => string(v),
		Value::Undefined => "void 0".to_owned(),
		Value::Null => "null".to_owned(),
		Value::Bool(v) => v.to_string(),
		Value::BigInt(v) => format!("{v}n"),
		Value::Number(v) if *v == 0.0 && v.is_sign_negative() => "-0".to_owned(),
		Value::Number(v) if v.is_nan() => "NaN".to_owned(),
		Value::Number(v) if v.is_infinite() => {
			if *v > 0.0 {
				"Infinity".to_owned()
			} else {
				"-Infinity".to_owned()
			}
		}
		Value::Number(v) => {
			let written = number::format(*v);
			if let Some(rest) = written.strip_prefix("-0.") {
				format!("-.{rest}")
			} else if let Some(rest) = written.strip_prefix("0.") {
				format!(".{rest}")
			} else {
				written
			}
		}
		_ => String::new(),
	}
}

/// A key written as an object literal's: bare where it is an identifier, quoted where it is not.
fn safe_key(key: &str) -> String {
	if identifier(key) { key.to_owned() } else { unsafe_escaped(&json(key)) }
}

/// A key written as an assignment's target: `.key`, or `["key"]`.
fn safe_prop(key: &str) -> String {
	if identifier(key) { format!(".{key}") } else { format!("[{}]", unsafe_escaped(&json(key))) }
}

fn identifier(key: &str) -> bool {
	let mut chars = key.chars();
	match chars.next() {
		Some(c) if c == '_' || c == '$' || c.is_ascii_alphabetic() => {}
		_ => return false,
	}
	chars.all(|c| c == '_' || c == '$' || c.is_ascii_alphanumeric())
}

/// `JSON.stringify` of a string: the short escapes, `\u00xx` for the other controls, and nothing
/// else touched.
fn json(text: &str) -> String {
	let mut out = String::with_capacity(text.len() + 2);
	out.push('"');
	for c in text.chars() {
		match c {
			'"' => out.push_str("\\\""),
			'\\' => out.push_str("\\\\"),
			'\n' => out.push_str("\\n"),
			'\r' => out.push_str("\\r"),
			'\t' => out.push_str("\\t"),
			'\u{8}' => out.push_str("\\b"),
			'\u{c}' => out.push_str("\\f"),
			c if c < ' ' => out.push_str(&format!("\\u{:04x}", c as u32)),
			c => out.push(c),
		}
	}
	out.push('"');
	out
}

/// `escape_unsafe_chars`: what `JSON.stringify` leaves that a script element cannot hold.
fn unsafe_escaped(text: &str) -> String {
	let mut out = String::with_capacity(text.len());
	for c in text.chars() {
		match c {
			'<' => out.push_str("\\u003C"),
			'\u{2028}' => out.push_str("\\u2028"),
			'\u{2029}' => out.push_str("\\u2029"),
			c => out.push(c),
		}
	}
	out
}

/// The length JavaScript gives a string, in UTF-16 code units.
fn js_length(text: &str) -> usize {
	text.encode_utf16().count()
}

/// `get_name`: `a` to `$`, then two letters, skipping the reserved words by appending `0`.
fn name(index: usize) -> String {
	const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
	const RESERVED: &[&str] = &[
		"do",
		"if",
		"in",
		"for",
		"int",
		"let",
		"new",
		"try",
		"var",
		"byte",
		"case",
		"char",
		"else",
		"enum",
		"goto",
		"long",
		"this",
		"void",
		"with",
		"await",
		"break",
		"catch",
		"class",
		"const",
		"final",
		"float",
		"short",
		"super",
		"throw",
		"while",
		"yield",
		"delete",
		"double",
		"export",
		"import",
		"native",
		"return",
		"switch",
		"throws",
		"typeof",
		"boolean",
		"default",
		"extends",
		"finally",
		"package",
		"private",
		"abstract",
		"continue",
		"debugger",
		"function",
		"volatile",
		"interface",
		"protected",
		"transient",
		"implements",
		"instanceof",
		"synchronized",
	];
	let mut name = Vec::new();
	let mut at = index as i64;
	loop {
		name.insert(0, CHARS[(at % CHARS.len() as i64) as usize]);
		at = at / CHARS.len() as i64 - 1;
		if at < 0 {
			break;
		}
	}
	let name = String::from_utf8(name).unwrap_or_default();
	if RESERVED.contains(&name.as_str()) { format!("{name}0") } else { name }
}

/// `Date.prototype.getTime` of what `toISOString` wrote, without a calendar library.
///
/// `YYYY-MM-DDTHH:mm:ss.sssZ`, with the six-digit signed year the format takes outside 0..=9999.
/// Days from the civil date by Howard Hinnant's algorithm, which is exact over the whole range a
/// `Date` holds. Anything else is `NaN`, which is what `new Date(NaN)` holds.
fn time(iso: &str) -> String {
	parse(iso).map_or_else(|| "NaN".to_owned(), |ms| ms.to_string())
}

fn parse(iso: &str) -> Option<i64> {
	let (year, rest) = if let Some(rest) = iso.strip_prefix('+') {
		(rest.get(..6)?.parse::<i64>().ok()?, rest.get(6..)?)
	} else if let Some(rest) = iso.strip_prefix('-') {
		(-rest.get(..6)?.parse::<i64>().ok()?, rest.get(6..)?)
	} else {
		(iso.get(..4)?.parse::<i64>().ok()?, iso.get(4..)?)
	};
	let bytes = rest.as_bytes();
	if bytes.len() != 20 || &rest[0..1] != "-" || &rest[3..4] != "-" || &rest[6..7] != "T" {
		return None;
	}
	if &rest[9..10] != ":" || &rest[12..13] != ":" || &rest[15..16] != "." || &rest[19..20] != "Z" {
		return None;
	}
	let field = |from: usize, to: usize| rest.get(from..to)?.parse::<i64>().ok();
	let (month, day) = (field(1, 3)?, field(4, 6)?);
	let (hour, minute, second, milli) =
		(field(7, 9)?, field(10, 12)?, field(13, 15)?, field(16, 19)?);
	let shifted = if month <= 2 { year - 1 } else { year };
	let era = shifted.div_euclid(400);
	let of_era = shifted - era * 400;
	let of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
	let of_cycle = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
	let days = era * 146_097 + of_cycle - 719_468;
	Some(days * 86_400_000 + hour * 3_600_000 + minute * 60_000 + second * 1000 + milli)
}
