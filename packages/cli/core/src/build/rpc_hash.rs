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

/// Hash a name with a salt, returning the first 8 hex chars of SHA-256.
fn hash_name(name: &str, salt: &str) -> String {
  let mut hasher = Sha256::new();
  hasher.update(name.as_bytes());
  hasher.update(salt.as_bytes());
  let result = hasher.finalize();
  hex::encode(&result[..4]) // 4 bytes = 8 hex chars
}

/// Build an RPC hash map from procedure names and a salt.
/// Detects collisions and retries with modified salt (up to 100 attempts).
pub fn generate_rpc_hash_map(names: &[&str], salt: &str) -> Result<RpcHashMap> {
  for attempt in 0..100u32 {
    let effective_salt = if attempt == 0 { salt.to_string() } else { format!("{salt}{attempt}") };

    let mut procedures = BTreeMap::new();
    let mut seen = BTreeMap::new();
    let mut collision = false;

    // Hash _batch first
    let batch_hash = hash_name("_batch", &effective_salt);
    seen.insert(batch_hash.clone(), "_batch".to_string());

    for &name in names {
      let hash = hash_name(name, &effective_salt);
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
    let map1 = generate_rpc_hash_map(&["getUser", "getSession"], "abcd1234abcd1234").unwrap();
    let map2 = generate_rpc_hash_map(&["getUser", "getSession"], "abcd1234abcd1234").unwrap();
    assert_eq!(map1.procedures, map2.procedures);
    assert_eq!(map1.batch, map2.batch);
  }

  #[test]
  fn different_salt_different_hashes() {
    let map1 = generate_rpc_hash_map(&["getUser"], "salt_a_1234567890").unwrap();
    let map2 = generate_rpc_hash_map(&["getUser"], "salt_b_1234567890").unwrap();
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
    let map = generate_rpc_hash_map(&names, "test_salt_12345678").unwrap();
    assert_eq!(map.procedures.len(), names.len());
    // All hashes are unique
    let hashes: std::collections::HashSet<_> = map.procedures.values().collect();
    assert_eq!(hashes.len(), names.len());
  }

  #[test]
  fn hash_is_8_hex_chars() {
    let map = generate_rpc_hash_map(&["test"], "salt_for_testing_1").unwrap();
    let hash = &map.procedures["test"];
    assert_eq!(hash.len(), 8);
    assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(map.batch.len(), 8);
  }

  #[test]
  fn serialization_roundtrip() {
    let map = generate_rpc_hash_map(&["a", "b"], "roundtrip_salt_00").unwrap();
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
    let map = generate_rpc_hash_map(&[], "empty_salt_123456").unwrap();
    assert!(map.procedures.is_empty());
    assert!(!map.batch.is_empty());
  }
}
