//! `String(n)` for a double, which is not what Rust's own formatting produces.
//!
//! Both languages print the shortest decimal that round-trips, so they agree across the range
//! ordinary data lives in. They part company at the ends: JavaScript switches to exponent form at
//! `1e21` and below `1e-6`, and Rust never does. That is a difference in the bytes, and the bytes
//! are the whole contract, so it is written out rather than hoped about.

/// Formats a finite double the way `String(n)` would.
///
/// `NaN`, the infinities and negative zero never reach here: they are sentinels and are handled
/// before a number is ever printed.
pub(crate) fn format(n: f64) -> String {
	debug_assert!(n.is_finite());

	// Rust's shortest round-trip is the same one ECMA-262 specifies, so the digits agree. What
	// has to be decided here is only which notation they are printed in.
	if n == 0.0 {
		return "0".to_owned();
	}

	let magnitude = n.abs();
	if magnitude >= 1e21 {
		return exponent(n);
	}
	if magnitude < 1e-6 {
		return exponent(n);
	}

	let plain = format!("{n}");
	// Rust prints an integral double as `1`, and so does JavaScript. Where Rust reaches for
	// exponent form on its own it would already have been caught above, so what is left is
	// literal agreement.
	plain
}

/// The `1e+21` and `1.5e-7` forms, which JavaScript writes with an explicit sign on a positive
/// exponent and Rust writes without one.
fn exponent(n: f64) -> String {
	let formatted = format!("{n:e}");
	let (mantissa, exponent) = match formatted.split_once('e') {
		Some(parts) => parts,
		// `{:e}` always writes an exponent, so this cannot happen; falling back to the plain form
		// is still better than a panic in a serializer.
		None => return formatted,
	};
	if let Some(rest) = exponent.strip_prefix('-') {
		format!("{mantissa}e-{rest}")
	} else {
		format!("{mantissa}e+{exponent}")
	}
}
