/* packages/server/core/rust/src/server.rs */

use std::collections::HashMap;
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;

use axum::extract::{MatchedPath, Path, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use futures_core::Stream;
use tokio::net::TcpListener;
use tokio::task::JoinSet;
use tokio_stream::StreamExt;

use crate::errors::SeamError;
use crate::manifest::build_manifest;
use crate::page::PageDef;
use crate::procedure::{ProcedureDef, SubscriptionDef};

struct AppState {
  manifest_json: serde_json::Value,
  handlers: HashMap<String, Arc<ProcedureDef>>,
  subscriptions: HashMap<String, Arc<SubscriptionDef>>,
  pages: HashMap<String, Arc<PageDef>>,
}

pub struct SeamServer {
  procedures: Vec<ProcedureDef>,
  subscriptions: Vec<SubscriptionDef>,
  pages: Vec<PageDef>,
}

impl SeamServer {
  pub fn new() -> Self {
    Self { procedures: Vec::new(), subscriptions: Vec::new(), pages: Vec::new() }
  }

  pub fn procedure(mut self, proc: ProcedureDef) -> Self {
    self.procedures.push(proc);
    self
  }

  pub fn subscription(mut self, sub: SubscriptionDef) -> Self {
    self.subscriptions.push(sub);
    self
  }

  pub fn page(mut self, page: PageDef) -> Self {
    self.pages.push(page);
    self
  }

  pub fn into_router(self) -> Router {
    let manifest = build_manifest(&self.procedures, &self.subscriptions);
    let manifest_json = serde_json::to_value(&manifest).expect("manifest serialization");

    let handlers: HashMap<String, Arc<ProcedureDef>> =
      self.procedures.into_iter().map(|p| (p.name.clone(), Arc::new(p))).collect();

    let subscriptions: HashMap<String, Arc<SubscriptionDef>> =
      self.subscriptions.into_iter().map(|s| (s.name.clone(), Arc::new(s))).collect();

    let mut pages = HashMap::new();
    let mut router = Router::new()
      .route("/_seam/manifest.json", get(handle_manifest))
      .route("/_seam/rpc/{name}", post(handle_rpc))
      .route("/_seam/subscribe/{name}", get(handle_subscribe));

    for page in self.pages {
      let full_route = format!("/_seam/page{}", page.route);
      pages.insert(full_route.clone(), Arc::new(page));
      router = router.route(&full_route, get(handle_page));
    }

    let state = Arc::new(AppState { manifest_json, handlers, subscriptions, pages });

    router.with_state(state)
  }

  pub async fn serve(self, addr: &str) -> Result<(), Box<dyn std::error::Error>> {
    let router = self.into_router();
    let listener = TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr()?;
    println!("Seam Rust backend running on http://localhost:{}", local_addr.port());
    axum::serve(listener, router).await?;
    Ok(())
  }
}

impl Default for SeamServer {
  fn default() -> Self {
    Self::new()
  }
}

impl IntoResponse for SeamError {
  fn into_response(self) -> Response {
    let status = StatusCode::from_u16(self.status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let body = serde_json::json!({
      "error": {
        "code": self.code(),
        "message": self.message(),
      }
    });
    (status, axum::Json(body)).into_response()
  }
}

async fn handle_manifest(State(state): State<Arc<AppState>>) -> impl IntoResponse {
  axum::Json(state.manifest_json.clone())
}

async fn handle_rpc(
  State(state): State<Arc<AppState>>,
  Path(name): Path<String>,
  body: axum::body::Bytes,
) -> Result<impl IntoResponse, SeamError> {
  let proc = state
    .handlers
    .get(&name)
    .ok_or_else(|| SeamError::not_found(format!("Procedure '{name}' not found")))?;

  let input: serde_json::Value =
    serde_json::from_slice(&body).map_err(|e| SeamError::validation(e.to_string()))?;

  let result = (proc.handler)(input).await?;
  Ok(axum::Json(result))
}

#[derive(serde::Deserialize)]
struct SubscribeQuery {
  input: Option<String>,
}

async fn handle_subscribe(
  State(state): State<Arc<AppState>>,
  Path(name): Path<String>,
  Query(query): Query<SubscribeQuery>,
) -> Sse<Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>> {
  let setup = async {
    let sub = state
      .subscriptions
      .get(&name)
      .ok_or_else(|| SeamError::not_found(format!("Subscription '{name}' not found")))?;

    let raw_input = match &query.input {
      Some(s) => serde_json::from_str(s).map_err(|e| SeamError::validation(e.to_string()))?,
      None => serde_json::Value::Object(serde_json::Map::new()),
    };

    let data_stream = (sub.handler)(raw_input).await?;
    Ok::<_, SeamError>(data_stream)
  };

  match setup.await {
    Ok(data_stream) => {
      let event_stream = data_stream
        .map(|item| match item {
          Ok(value) => {
            let data = serde_json::to_string(&value).unwrap_or_default();
            Ok(Event::default().event("data").data(data))
          }
          Err(e) => {
            let payload = serde_json::json!({ "code": e.code(), "message": e.message() });
            Ok(Event::default().event("error").data(payload.to_string()))
          }
        })
        .chain(tokio_stream::once(Ok(Event::default().event("complete").data("{}"))));
      Sse::new(Box::pin(event_stream))
    }
    Err(err) => {
      let payload = serde_json::json!({ "code": err.code(), "message": err.message() });
      let error_event = Event::default().event("error").data(payload.to_string());
      Sse::new(Box::pin(tokio_stream::once(Ok(error_event))))
    }
  }
}

async fn handle_page(
  State(state): State<Arc<AppState>>,
  matched: MatchedPath,
  Path(params): Path<HashMap<String, String>>,
) -> Result<Html<String>, SeamError> {
  let route_pattern = matched.as_str().to_string();
  let page =
    state.pages.get(&route_pattern).ok_or_else(|| SeamError::not_found("Page not found"))?;

  let mut join_set = JoinSet::new();

  let handlers = state.handlers.clone();
  for loader in &page.loaders {
    let input = (loader.input_fn)(&params);
    let proc_name = loader.procedure.clone();
    let data_key = loader.data_key.clone();
    let handlers = handlers.clone();

    join_set.spawn(async move {
      let proc = handlers
        .get(&proc_name)
        .ok_or_else(|| SeamError::internal(format!("Procedure '{proc_name}' not found")))?;
      let result = (proc.handler)(input).await?;
      Ok::<(String, serde_json::Value), SeamError>((data_key, result))
    });
  }

  let mut data = serde_json::Map::new();
  while let Some(result) = join_set.join_next().await {
    let (key, value) = result
      .map_err(|e| SeamError::internal(e.to_string()))? // JoinError -> Internal (task panic)
      ?; // SeamError propagates unchanged
    data.insert(key, value);
  }

  let html = seam_injector::inject(&page.template, &serde_json::Value::Object(data));
  Ok(Html(html))
}
