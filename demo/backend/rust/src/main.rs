mod procedures;

use seam_server::SeamServer;

use procedures::get_user::get_user_procedure;
use procedures::greet::greet_procedure;
use procedures::list_users::list_users_procedure;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
  SeamServer::new()
    .procedure(greet_procedure())
    .procedure(get_user_procedure())
    .procedure(list_users_procedure())
    .serve("0.0.0.0:3000")
    .await
}
