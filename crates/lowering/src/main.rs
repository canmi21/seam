use std::io::Read as _;

use lowering::{lower, markup::Bundle};

fn main() -> std::process::ExitCode {
	let mut input = String::new();
	if let Err(error) = std::io::stdin().read_to_string(&mut input) {
		eprintln!("error: cannot read stdin: {error}");
		return std::process::ExitCode::FAILURE;
	}

	let bundle: Bundle = match serde_json::from_str(&input) {
		Ok(bundle) => bundle,
		Err(error) => {
			eprintln!("error: input is not a reduced bundle: {error}");
			return std::process::ExitCode::FAILURE;
		}
	};

	match lower(&bundle) {
		Ok(ir) => match serde_json::to_string_pretty(&ir) {
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
