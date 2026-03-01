/* src/server/core/rust/src/lib.rs */

pub mod build_loader;
pub mod channel;
pub mod errors;
pub mod escape;
pub mod manifest;
pub mod page;
pub mod procedure;
pub mod resolve;
pub mod server;

// Re-exports for ergonomic use
pub use build_loader::{RpcHashMap, load_build_output, load_i18n_config, load_rpc_hash_map};
pub use channel::{ChannelDef, ChannelMeta, IncomingDef, IncomingMeta};
pub use errors::SeamError;
pub use escape::ascii_escape_json;
pub use page::I18nConfig;
pub use procedure::{BoxFuture, BoxStream, ProcedureDef, ProcedureType, SubscriptionDef};
pub use resolve::{
  ResolveData, ResolveStrategy, default_strategies, from_accept_language, from_cookie,
  from_url_prefix, from_url_query, resolve_chain,
};
pub use seam_macros::{SeamType, seam_command, seam_procedure, seam_subscription};
pub use server::{SeamParts, SeamServer};

/// Trait for types that can describe themselves as a JTD schema.
/// Derive with `#[derive(SeamType)]` or implement manually.
pub trait SeamType {
  fn jtd_schema() -> serde_json::Value;
}

// -- Primitive SeamType impls --

macro_rules! impl_seam_type_primitive {
  ($rust_ty:ty, $jtd:expr_2021) => {
    impl SeamType for $rust_ty {
      fn jtd_schema() -> serde_json::Value {
        serde_json::json!({ "type": $jtd })
      }
    }
  };
}

impl_seam_type_primitive!(String, "string");
impl_seam_type_primitive!(bool, "boolean");
impl_seam_type_primitive!(i8, "int8");
impl_seam_type_primitive!(i16, "int16");
impl_seam_type_primitive!(i32, "int32");
impl_seam_type_primitive!(u8, "uint8");
impl_seam_type_primitive!(u16, "uint16");
impl_seam_type_primitive!(u32, "uint32");
impl_seam_type_primitive!(f32, "float32");
impl_seam_type_primitive!(f64, "float64");

impl<T: SeamType> SeamType for Vec<T> {
  fn jtd_schema() -> serde_json::Value {
    serde_json::json!({ "elements": T::jtd_schema() })
  }
}

impl<T: SeamType> SeamType for Option<T> {
  fn jtd_schema() -> serde_json::Value {
    let mut schema = T::jtd_schema();
    if let Some(obj) = schema.as_object_mut() {
      obj.insert("nullable".to_string(), serde_json::Value::Bool(true));
    }
    schema
  }
}

impl<T: SeamType> SeamType for std::collections::HashMap<String, T> {
  fn jtd_schema() -> serde_json::Value {
    serde_json::json!({ "values": T::jtd_schema() })
  }
}

impl<T: SeamType> SeamType for std::collections::BTreeMap<String, T> {
  fn jtd_schema() -> serde_json::Value {
    serde_json::json!({ "values": T::jtd_schema() })
  }
}

#[cfg(test)]
extern crate self as seam_server;

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn primitive_schemas() {
    assert_eq!(String::jtd_schema(), serde_json::json!({"type": "string"}));
    assert_eq!(bool::jtd_schema(), serde_json::json!({"type": "boolean"}));
    assert_eq!(i32::jtd_schema(), serde_json::json!({"type": "int32"}));
    assert_eq!(u32::jtd_schema(), serde_json::json!({"type": "uint32"}));
    assert_eq!(f64::jtd_schema(), serde_json::json!({"type": "float64"}));
  }

  #[test]
  fn vec_schema() {
    assert_eq!(Vec::<String>::jtd_schema(), serde_json::json!({"elements": {"type": "string"}}),);
  }

  #[test]
  fn option_schema() {
    assert_eq!(
      Option::<String>::jtd_schema(),
      serde_json::json!({"type": "string", "nullable": true}),
    );
  }

  #[test]
  fn hashmap_schema() {
    assert_eq!(
      std::collections::HashMap::<String, f64>::jtd_schema(),
      serde_json::json!({"values": {"type": "float64"}}),
    );
  }

  #[derive(SeamType)]
  #[allow(dead_code)]
  enum Role {
    Admin,
    Member,
    Guest,
  }

  #[test]
  fn enum_schema() {
    assert_eq!(Role::jtd_schema(), serde_json::json!({"enum": ["admin", "member", "guest"]}),);
  }
}
