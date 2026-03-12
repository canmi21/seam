/* src/cli/core/src/dev/fullstack/mod.rs */

mod helpers;

#[cfg(test)]
mod tests;

use std::path::Path;
use std::time::Duration;

use anyhow::Result;
use tokio::signal;

use crate::config::SeamConfig;
use crate::ui::{RED, label};

use super::network::{find_available_port, find_available_port_excluding, preferred_vite_port};
use super::process::wait_any;
use super::ui::print_fullstack_banner;
use helpers::{
	DevEvent, configure_dev_build, ensure_initial_dev_build, handle_public_reload, handle_rebuild,
	merge_dev_events, resolve_spawn_options, setup_watched_dirs, setup_watcher,
	spawn_fullstack_children,
};

/// Workspace dev mode: resolve a single member, then run fullstack dev with merged config
pub async fn run_dev_workspace(
	root: &SeamConfig,
	base_dir: &Path,
	member_name: &str,
) -> Result<()> {
	let members = crate::workspace::resolve_members(root, base_dir, Some(member_name))?;
	let member = &members[0];
	run_dev_fullstack(&member.merged_config, base_dir).await
}

pub(super) async fn run_dev_fullstack(config: &SeamConfig, base_dir: &Path) -> Result<()> {
	let public_port = find_available_port(config.dev.port)?;
	let backend_port = find_available_port_excluding(config.backend.port, &[public_port])?;
	let vite_port = find_available_port_excluding(
		preferred_vite_port(config.dev.vite_port),
		&[public_port, backend_port],
	)?;
	let mut effective_config = config.clone();
	effective_config.dev.vite_port = Some(vite_port);

	let (build_config, out_dir) = configure_dev_build(&effective_config, base_dir)?;
	ensure_initial_dev_build(&effective_config, &build_config, base_dir, &out_dir)?;

	let server_dir = base_dir.join("src/server");
	let public_dir = base_dir.join("public");
	let public_dir = if public_dir.is_dir() { Some(public_dir) } else { None };
	let (mut _watcher, mut watcher_rx) = setup_watcher(server_dir, public_dir.clone())?;
	let watched_dirs =
		setup_watched_dirs(base_dir, &build_config, public_dir.as_deref(), &mut _watcher)?;
	let spawn_opts = resolve_spawn_options(
		&build_config,
		base_dir,
		&out_dir,
		public_dir.as_deref(),
		public_port,
		backend_port,
		vite_port,
	)?;
	print_fullstack_banner(&effective_config, public_port, &watched_dirs, Some(vite_port));
	let mut children = spawn_fullstack_children(&effective_config, base_dir, &spawn_opts).await?;
	let mut dev_server = std::pin::pin!(crate::dev_server::start_fullstack_dev_server(
		spawn_opts.public_port,
		spawn_opts.backend_port,
		spawn_opts.vite_port,
	));
	loop {
		tokio::select! {
			_ = signal::ctrl_c() => {
				println!();
				crate::ui::shutting_down();
				break;
			}
			result = wait_any(&mut children) => {
				let (label_name, status) = result;
				let color = super::process::label_color(label_name);
				crate::ui::process_exited(label_name, color, status);
				break;
			}
			result = &mut dev_server => {
				if let Err(err) = result {
					label(RED, "proxy", &format!("dev proxy error: {err}"));
				}
				break;
			}
			Some(initial_event) = watcher_rx.recv() => {
				tokio::time::sleep(Duration::from_millis(300)).await;
				let mut event = initial_event;
				while let Ok(next_event) = watcher_rx.try_recv() {
					event = merge_dev_events(event, next_event);
				}
				match event {
					DevEvent::Reload => handle_public_reload(&out_dir),
					DevEvent::Rebuild(mode) => {
						handle_rebuild(&effective_config, &build_config, base_dir, &out_dir, true, mode).await;
					}
				}
			}
		}
	}
	Ok(())
}
