/* src/server/core/rust-macros/tests/macro_tests.rs */

#[test]
fn macro_tests() {
	let t = trybuild::TestCases::new();
	t.pass("tests/pass/*.rs");
	t.compile_fail("tests/fail/*.rs");
}
