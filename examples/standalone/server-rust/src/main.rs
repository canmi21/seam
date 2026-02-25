/* examples/standalone/server-rust/src/main.rs */

mod pages;
mod procedures;
mod subscriptions;

use std::env;

use seam_server::SeamServer;
use seam_server_axum::IntoAxumRouter;

use pages::user_page;
use procedures::get_user::get_user_procedure;
use procedures::greet::greet_procedure;
use procedures::list_users::list_users_procedure;
use subscriptions::on_count::on_count_subscription;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
  let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
  let addr = format!("0.0.0.0:{port}");

  SeamServer::new()
    .procedure(greet_procedure())
    .procedure(get_user_procedure())
    .procedure(list_users_procedure())
    .subscription(on_count_subscription())
    .page(user_page())
    .serve(&addr)
    .await
}
