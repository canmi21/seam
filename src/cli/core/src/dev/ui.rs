/* src/cli/core/src/dev/ui.rs */

use std::path::Path;

use anyhow::Result;

use crate::build::config::{BuildConfig, BundlerMode};
use crate::config::SeamConfig;
use crate::ui::{self, BOLD, CYAN, DIM, GREEN, MAGENTA, RESET, UNDERLINE, YELLOW, col};

pub(super) fn print_dev_banner(
	config: &SeamConfig,
	backend_cmd: Option<&str>,
	frontend_cmd: Option<&str>,
	use_embedded: bool,
) {
	ui::banner("dev", Some(config.project_name()));

	if let Some(cmd) = backend_cmd {
		let lang = &config.backend.lang;
		ui::label(
			CYAN,
			"backend",
			&format!("{}[{lang}]{} {}{cmd}{}", col(DIM), col(RESET), col(DIM), col(RESET)),
		);
	}

	if let Some(cmd) = frontend_cmd {
		let port_suffix = config
			.frontend
			.dev_port
			.map_or(String::new(), |p| format!(" {}:{p}{}", col(DIM), col(RESET)));
		ui::label(MAGENTA, "frontend", &format!("{}{cmd}{}{port_suffix}", col(DIM), col(RESET)));
	} else if use_embedded {
		let dev_port = config.frontend.dev_port.unwrap_or(5173);
		ui::label(
			MAGENTA,
			"frontend",
			&format!("{}embedded dev server :{dev_port}{}", col(DIM), col(RESET)),
		);
	}

	if backend_cmd.is_some() {
		let fp = config.frontend.dev_port.unwrap_or(5173);
		if frontend_cmd.is_some() || use_embedded {
			ui::label(
				YELLOW,
				"proxy",
				&format!("{}:{} \u{2192} :{fp}{}", col(DIM), config.backend.port, col(RESET)),
			);
		}
	}

	let primary_port =
		if use_embedded { config.frontend.dev_port.unwrap_or(5173) } else { config.backend.port };
	println!();
	println!(
		"  {}\u{2192}{} {}{}http://localhost:{primary_port}{}",
		col(GREEN),
		col(RESET),
		col(BOLD),
		col(UNDERLINE),
		col(RESET)
	);
	println!();
}

pub(super) fn build_frontend(config: &SeamConfig, base_dir: &Path) -> Result<()> {
	ui::step(1, 1, "Building frontend");
	let build_config = BuildConfig::from_seam_config(config)?;
	let dist_dir = build_config.dist_dir();
	match &build_config.bundler_mode {
		BundlerMode::BuiltIn { entry } => {
			crate::shell::run_builtin_bundler(base_dir, entry, dist_dir, &[])?;
		}
		BundlerMode::Custom { command } => {
			crate::shell::run_command(base_dir, command, "bundler", &[])?;
		}
	}
	ui::blank();
	Ok(())
}

pub(super) fn print_fullstack_banner(
	config: &SeamConfig,
	port: u16,
	watched_dirs: &[String],
	vite_port: Option<u16>,
) {
	let backend_cmd =
		config.backend.dev_command.as_deref().unwrap_or("bun --watch src/server/index.ts");
	let lang = &config.backend.lang;

	ui::banner("dev", Some(config.project_name()));
	if let Some(vp) = vite_port {
		ui::label(MAGENTA, "vite", &format!("{}http://localhost:{vp}{}", col(DIM), col(RESET)));
	}
	ui::label(
		CYAN,
		"backend",
		&format!("{}[{lang}]{} {}{backend_cmd}{}", col(DIM), col(RESET), col(DIM), col(RESET)),
	);
	ui::label(GREEN, "mode", "fullstack CTR");
	if !watched_dirs.is_empty() {
		ui::label(GREEN, "watching", &format!("{}{}{}", col(DIM), watched_dirs.join(", "), col(RESET)));
	}
	println!();
	if port == 80 {
		println!(
			"  {}\u{2192}{} {}{}http://localhost{}",
			col(GREEN),
			col(RESET),
			col(BOLD),
			col(UNDERLINE),
			col(RESET)
		);
	} else {
		println!(
			"  {}\u{2192}{} {}{}http://localhost:{port}{}",
			col(GREEN),
			col(RESET),
			col(BOLD),
			col(UNDERLINE),
			col(RESET)
		);
	}
	println!();
}
