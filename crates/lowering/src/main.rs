use std::io::Read as _;

use seam_lowering::{lower, markup::Markup};

fn main() -> std::process::ExitCode {
	let name = std::env::args().nth(1).unwrap_or_else(|| "Component".to_owned());

	let mut input = String::new();
	if let Err(error) = std::io::stdin().read_to_string(&mut input) {
		eprintln!("error: cannot read stdin: {error}");
		return std::process::ExitCode::FAILURE;
	}

	let markup: Markup = match serde_json::from_str(&input) {
		Ok(markup) => markup,
		Err(error) => {
			eprintln!("error: input is not reduced markup: {error}");
			return std::process::ExitCode::FAILURE;
		}
	};

	match lower(&name, &markup) {
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
