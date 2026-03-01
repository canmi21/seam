/* examples/standalone/server-rust/src/procedures/list_users.rs */

use seam_server::{SeamError, SeamType, seam_procedure};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, SeamType)]
pub struct ListUsersInput {}

#[derive(Serialize, SeamType)]
pub struct UserSummary {
  pub id: u32,
  pub name: String,
}

#[seam_procedure(name = "listUsers")]
pub async fn list_users(_input: ListUsersInput) -> Result<Vec<UserSummary>, SeamError> {
  Ok(vec![
    UserSummary { id: 1, name: "Alice".to_string() },
    UserSummary { id: 2, name: "Bob".to_string() },
    UserSummary { id: 3, name: "Charlie".to_string() },
  ])
}
