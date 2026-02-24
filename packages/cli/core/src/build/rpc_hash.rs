/* packages/cli/core/src/build/rpc_hash.rs */

// RPC endpoint hash map: maps procedure names to short hex hashes for obfuscation.

use std::collections::BTreeMap;

use anyhow::{bail, Result};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcHashMap {
  pub salt: String,
  pub batch: String,
  pub procedures: BTreeMap<String, String>,
}

/// Generate 16 hex chars (8 random bytes) for use as a hash salt.
pub fn generate_random_salt() -> String {
  let mut rng = rand::thread_rng();
  let bytes: [u8; 8] = rng.gen();
  hex::encode(bytes)
}

/// Hash a name with a salt, returning `prefix` + first `byte_count` bytes as hex.
fn hash_name(name: &str, salt: &str, byte_count: usize, prefix: &str) -> String {
  let mut hasher = Sha256::new();
  hasher.update(name.as_bytes());
  hasher.update(salt.as_bytes());
  let result = hasher.finalize();
  format!("{}{}", prefix, hex::encode(&result[..byte_count]))
}

/// Build an RPC hash map from procedure names and a salt.
/// When `typehint` is true, hashes use `rpc-` prefix + 12 hex chars (6 bytes).
/// When false, hashes are bare 16 hex chars (8 bytes).
/// Detects collisions and retries with modified salt (up to 100 attempts).
pub fn generate_rpc_hash_map(names: &[&str], salt: &str, typehint: bool) -> Result<RpcHashMap> {
  let (byte_count, prefix) = if typehint { (6, "rpc-") } else { (8, "") };

  for attempt in 0..100u32 {
    let effective_salt = if attempt == 0 { salt.to_string() } else { format!("{salt}{attempt}") };

    let mut procedures = BTreeMap::new();
    let mut seen = BTreeMap::new();
    let mut collision = false;

    // Hash _batch first
    let batch_hash = hash_name("_batch", &effective_salt, byte_count, prefix);
    seen.insert(batch_hash.clone(), "_batch".to_string());

    for &name in names {
      let hash = hash_name(name, &effective_salt, byte_count, prefix);
      if let Some(existing) = seen.get(&hash) {
        if existing != name {
          collision = true;
          break;
        }
      }
      seen.insert(hash.clone(), name.to_string());
      procedures.insert(name.to_string(), hash);
    }

    if !collision {
      return Ok(RpcHashMap { salt: effective_salt, batch: batch_hash, procedures });
    }
  }

  bail!("failed to generate collision-free RPC hash map after 100 attempts")
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn deterministic_with_same_salt() {
    let map1 = generate_rpc_hash_map(&["getUser", "getSession"], "abcd1234abcd1234", true).unwrap();
    let map2 = generate_rpc_hash_map(&["getUser", "getSession"], "abcd1234abcd1234", true).unwrap();
    assert_eq!(map1.procedures, map2.procedures);
    assert_eq!(map1.batch, map2.batch);
  }

  #[test]
  fn different_salt_different_hashes() {
    let map1 = generate_rpc_hash_map(&["getUser"], "salt_a_1234567890", true).unwrap();
    let map2 = generate_rpc_hash_map(&["getUser"], "salt_b_1234567890", true).unwrap();
    assert_ne!(map1.procedures["getUser"], map2.procedures["getUser"]);
  }

  #[test]
  fn no_collision_on_typical_set() {
    let names: Vec<&str> = vec![
      "getUser",
      "getSession",
      "listPosts",
      "createPost",
      "updatePost",
      "deletePost",
      "getComments",
      "addComment",
    ];
    let map = generate_rpc_hash_map(&names, "test_salt_12345678", true).unwrap();
    assert_eq!(map.procedures.len(), names.len());
    // All hashes are unique
    let hashes: std::collections::HashSet<_> = map.procedures.values().collect();
    assert_eq!(hashes.len(), names.len());
  }

  #[test]
  fn hash_length_typehint_true() {
    let map = generate_rpc_hash_map(&["test"], "salt_for_testing_1", true).unwrap();
    let hash = &map.procedures["test"];
    // rpc- prefix (4) + 12 hex chars = 16 total
    assert_eq!(hash.len(), 16);
    assert!(hash.starts_with("rpc-"));
    assert!(hash[4..].chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(map.batch.len(), 16);
    assert!(map.batch.starts_with("rpc-"));
  }

  #[test]
  fn hash_length_typehint_false() {
    let map = generate_rpc_hash_map(&["test"], "salt_for_testing_1", false).unwrap();
    let hash = &map.procedures["test"];
    // bare 16 hex chars (8 bytes), no prefix
    assert_eq!(hash.len(), 16);
    assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    assert!(!hash.starts_with("rpc-"));
    assert_eq!(map.batch.len(), 16);
  }

  #[test]
  fn serialization_roundtrip() {
    let map = generate_rpc_hash_map(&["a", "b"], "roundtrip_salt_00", true).unwrap();
    let json = serde_json::to_string(&map).unwrap();
    let restored: RpcHashMap = serde_json::from_str(&json).unwrap();
    assert_eq!(map.salt, restored.salt);
    assert_eq!(map.batch, restored.batch);
    assert_eq!(map.procedures, restored.procedures);
  }

  #[test]
  fn random_salt_is_16_hex_chars() {
    let salt = generate_random_salt();
    assert_eq!(salt.len(), 16);
    assert!(salt.chars().all(|c| c.is_ascii_hexdigit()));
  }

  #[test]
  fn empty_procedures() {
    let map = generate_rpc_hash_map(&[], "empty_salt_123456", true).unwrap();
    assert!(map.procedures.is_empty());
    assert!(!map.batch.is_empty());
  }
}
