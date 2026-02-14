/* demo/backend/rust/src/procedures/get_user.rs */

use seam_server::{seam_procedure, SeamError, SeamType};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, SeamType)]
pub struct GetUserInput {
  pub id: u32,
}

#[derive(Serialize, SeamType)]
pub struct GetUserOutput {
  pub id: u32,
  pub name: String,
  pub email: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub avatar: Option<String>,
}

struct UserData {
  id: u32,
  name: &'static str,
  email: &'static str,
  avatar: Option<&'static str>,
}

const USERS: &[UserData] = &[
  UserData {
    id: 1,
    name: "Alice",
    email: "alice@example.com",
    avatar: Some("https://example.com/alice.png"),
  },
  UserData { id: 2, name: "Bob", email: "bob@example.com", avatar: None },
  UserData { id: 3, name: "Charlie", email: "charlie@example.com", avatar: None },
];

#[seam_procedure(name = "getUser")]
pub async fn get_user(input: GetUserInput) -> Result<GetUserOutput, SeamError> {
  let user = USERS
    .iter()
    .find(|u| u.id == input.id)
    .ok_or_else(|| SeamError::not_found(format!("User {} not found", input.id)))?;

  Ok(GetUserOutput {
    id: user.id,
    name: user.name.to_string(),
    email: user.email.to_string(),
    avatar: user.avatar.map(|s| s.to_string()),
  })
}
