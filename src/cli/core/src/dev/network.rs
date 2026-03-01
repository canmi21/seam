/* src/cli/core/src/dev/network.rs */

use std::time::{Duration, Instant};

use anyhow::{bail, Result};

pub(super) fn find_available_port(preferred: u16) -> Result<u16> {
  if std::net::TcpListener::bind(("0.0.0.0", preferred)).is_ok() {
    return Ok(preferred);
  }
  for port in 3000..3100 {
    if port != preferred && std::net::TcpListener::bind(("0.0.0.0", port)).is_ok() {
      return Ok(port);
    }
  }
  bail!("no available port found in range 3000-3099");
}

/// Poll a TCP port until it accepts connections, or bail after timeout.
/// Tries both IPv6 (::1) and IPv4 (127.0.0.1) since Vite v7 binds IPv6-only on macOS.
pub(super) async fn wait_for_port(port: u16, timeout: Duration) -> Result<()> {
  let deadline = Instant::now() + timeout;
  loop {
    if tokio::net::TcpStream::connect(("::1", port)).await.is_ok()
      || tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok()
    {
      return Ok(());
    }
    if Instant::now() >= deadline {
      bail!("timed out waiting for port {port} to become ready");
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
  }
}
