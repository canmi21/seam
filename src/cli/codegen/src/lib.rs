/* src/cli/codegen/src/lib.rs */

mod typescript;

pub mod manifest;
pub mod rpc_hash;

pub use manifest::{ChannelSchema, IncomingSchema, Manifest, ProcedureSchema, ProcedureType};
pub use rpc_hash::{RpcHashMap, generate_random_salt, generate_rpc_hash_map};
pub use typescript::{generate_typescript, generate_typescript_meta};
