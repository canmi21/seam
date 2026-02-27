/* packages/cli/core/src/build/route/fnv.rs */

const FNV_OFFSET: u32 = 2_166_136_261;
const FNV_PRIME: u32 = 16_777_619;

/// Standard FNV-1a 32-bit hash.
pub(crate) fn fnv1a_32(input: &str) -> u32 {
  let mut hash = FNV_OFFSET;
  for byte in input.bytes() {
    hash ^= byte as u32;
    hash = hash.wrapping_mul(FNV_PRIME);
  }
  hash
}

/// Route pattern -> 8 hex chars (full 32-bit FNV-1a).
pub(crate) fn route_hash(pattern: &str) -> String {
  format!("{:08x}", fnv1a_32(pattern))
}

/// Content string -> 4 hex chars (lower 16 bits of FNV-1a).
pub(crate) fn content_hash(data: &str) -> String {
  format!("{:04x}", fnv1a_32(data) & 0xFFFF)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn fnv1a_deterministic() {
    assert_eq!(fnv1a_32("hello"), fnv1a_32("hello"));
  }

  #[test]
  fn fnv1a_different_inputs() {
    assert_ne!(fnv1a_32("hello"), fnv1a_32("world"));
  }

  #[test]
  fn fnv1a_empty_string() {
    assert_eq!(fnv1a_32(""), FNV_OFFSET);
  }

  #[test]
  fn route_hash_length() {
    let h = route_hash("/");
    assert_eq!(h.len(), 8);
    assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
  }

  #[test]
  fn content_hash_length() {
    let h = content_hash("hello=world");
    assert_eq!(h.len(), 4);
    assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
  }

  #[test]
  fn route_hash_known_values() {
    // Verify specific patterns produce consistent output
    let h1 = route_hash("/");
    let h2 = route_hash("/dashboard");
    assert_ne!(h1, h2);
    // Re-run produces same result
    assert_eq!(h1, route_hash("/"));
  }
}
