use std::io::Read as _;

use lowering::{assemble, assemble::Skeleton, lower, markup::Bundle};

fn main() -> std::process::ExitCode {
	let name = std::env::args().nth(1).unwrap_or_else(|| "component".to_owned());

	let mut input = String::new();
	if let Err(error) = std::io::stdin().read_to_string(&mut input) {
		eprintln!("error: cannot read stdin: {error}");
		return std::process::ExitCode::FAILURE;
	}

	// The shape says which pass to run. A render carries `html`; a reduced tree carries `entry`.
	// Both produce the same document, which is what the agreement test in tests/ is about.
	let compiled = if input.contains("\"html\"") {
		match serde_json::from_str::<Skeleton>(&input) {
			Ok(skeleton) => assemble(&name, &skeleton),
			Err(error) => {
				eprintln!("error: input is not a render: {error}");
				return std::process::ExitCode::FAILURE;
			}
		}
	} else {
		match serde_json::from_str::<Bundle>(&input) {
			Ok(bundle) => lower(&bundle),
			Err(error) => {
				eprintln!("error: input is not a reduced bundle: {error}");
				return std::process::ExitCode::FAILURE;
			}
		}
	};

	match compiled {
		Ok(compiled) => match serde_json::to_string_pretty(&compiled) {
			Ok(json) => {
				println!("{json}");
				std::process::ExitCode::SUCCESS
			}
			Err(error) => {
				eprintln!("error: {error}");
				std::process::ExitCode::FAILURE
			}
		},
		Err(message) => {
			eprintln!("error: {message}");
			std::process::ExitCode::FAILURE
		}
	}
}
