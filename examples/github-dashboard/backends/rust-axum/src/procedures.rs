/* examples/github-dashboard/backends/rust-axum/src/procedures.rs */

use serde::{Deserialize, Serialize};
use seam_server::{seam_procedure, SeamError, SeamType};

// -- getSession --

#[derive(Deserialize, SeamType)]
pub struct SessionInput {}

#[derive(Serialize, SeamType)]
pub struct SessionOutput {
  pub username: String,
  pub theme: String,
}

#[seam_procedure(name = "getSession")]
pub async fn get_session(_input: SessionInput) -> Result<SessionOutput, SeamError> {
  Ok(SessionOutput { username: "visitor".to_string(), theme: "light".to_string() })
}

// -- getHomeData --

#[derive(Deserialize, SeamType)]
pub struct HomeDataInput {}

#[derive(Serialize, SeamType)]
pub struct HomeDataOutput {
  pub tagline: String,
}

#[seam_procedure(name = "getHomeData")]
pub async fn get_home_data(_input: HomeDataInput) -> Result<HomeDataOutput, SeamError> {
  Ok(HomeDataOutput { tagline: "Compile-Time Rendering for React".to_string() })
}

// -- getUser --

#[derive(Deserialize, SeamType)]
pub struct GetUserInput {
  pub username: String,
}

#[derive(Serialize, SeamType)]
pub struct GetUserOutput {
  pub login: String,
  pub name: Option<String>,
  pub avatar_url: String,
  pub bio: Option<String>,
  pub location: Option<String>,
  pub public_repos: u32,
  pub followers: u32,
  pub following: u32,
}

#[seam_procedure(name = "getUser")]
pub async fn get_user(input: GetUserInput) -> Result<GetUserOutput, SeamError> {
  let url = format!("https://api.github.com/users/{}", input.username);
  let client = reqwest::Client::new();
  let resp = client
    .get(&url)
    .header("Accept", "application/vnd.github.v3+json")
    .header("User-Agent", "seam-github-dashboard")
    .send()
    .await
    .map_err(|e| SeamError::internal(format!("GitHub API error: {e}")))?;

  if !resp.status().is_success() {
    return Err(SeamError::not_found(format!("GitHub user '{}' not found", input.username)));
  }

  let data: serde_json::Value = resp
    .json()
    .await
    .map_err(|e| SeamError::internal(format!("failed to parse GitHub response: {e}")))?;

  Ok(GetUserOutput {
    login: data["login"].as_str().unwrap_or_default().to_string(),
    name: data["name"].as_str().map(String::from),
    avatar_url: data["avatar_url"].as_str().unwrap_or_default().to_string(),
    bio: data["bio"].as_str().map(String::from),
    location: data["location"].as_str().map(String::from),
    public_repos: data["public_repos"].as_u64().unwrap_or(0) as u32,
    followers: data["followers"].as_u64().unwrap_or(0) as u32,
    following: data["following"].as_u64().unwrap_or(0) as u32,
  })
}

// -- getUserRepos --

#[derive(Deserialize, SeamType)]
pub struct GetUserReposInput {
  pub username: String,
}

#[derive(Serialize, SeamType)]
pub struct RepoItem {
  pub id: u32,
  pub name: String,
  pub description: Option<String>,
  pub language: Option<String>,
  pub stargazers_count: u32,
  pub forks_count: u32,
  pub html_url: String,
}

#[seam_procedure(name = "getUserRepos")]
pub async fn get_user_repos(input: GetUserReposInput) -> Result<Vec<RepoItem>, SeamError> {
  let url = format!(
    "https://api.github.com/users/{}/repos?sort=stars&per_page=6",
    input.username
  );
  let client = reqwest::Client::new();
  let resp = client
    .get(&url)
    .header("Accept", "application/vnd.github.v3+json")
    .header("User-Agent", "seam-github-dashboard")
    .send()
    .await
    .map_err(|e| SeamError::internal(format!("GitHub API error: {e}")))?;

  if !resp.status().is_success() {
    return Err(SeamError::internal(format!("GitHub repos API returned {}", resp.status())));
  }

  let data: Vec<serde_json::Value> = resp
    .json()
    .await
    .map_err(|e| SeamError::internal(format!("failed to parse repos: {e}")))?;

  Ok(
    data
      .into_iter()
      .map(|r| RepoItem {
        id: r["id"].as_u64().unwrap_or(0) as u32,
        name: r["name"].as_str().unwrap_or_default().to_string(),
        description: r["description"].as_str().map(String::from),
        language: r["language"].as_str().map(String::from),
        stargazers_count: r["stargazers_count"].as_u64().unwrap_or(0) as u32,
        forks_count: r["forks_count"].as_u64().unwrap_or(0) as u32,
        html_url: r["html_url"].as_str().unwrap_or_default().to_string(),
      })
      .collect(),
  )
}
