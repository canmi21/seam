#!/usr/bin/env bash
# Cross-compile seam-cli for all npm wrapper platforms from macOS.
# macOS targets: native Apple toolchain
# Linux targets: musl-cross static linking
# Usage: bash scripts/build-cli.sh [--debug] [--target <triple>]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WRAPPER="$ROOT/src/cli/wrapper"

# --- Flags ---
PROFILE="release"
CARGO_FLAGS="--release"
SINGLE_TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --debug) PROFILE="debug"; CARGO_FLAGS="" ;;
    --release) PROFILE="release"; CARGO_FLAGS="--release" ;;
    --target) shift; SINGLE_TARGET="$1" ;;
    --target=*) SINGLE_TARGET="${1#--target=}" ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
  shift
done

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
fail()  { echo -e "${RED}[fail]${NC}  $*"; }

# --- Target triple -> npm wrapper dir (bash 3 compatible) ---
wrapper_dir_for() {
  case "$1" in
    aarch64-apple-darwin)        echo "darwin-arm64" ;;
    x86_64-apple-darwin)         echo "darwin-x64" ;;
    aarch64-unknown-linux-musl)  echo "linux-arm64" ;;
    x86_64-unknown-linux-musl)   echo "linux-x64" ;;
    *) return 1 ;;
  esac
}

# --- Ensure Rust target is installed ---
ensure_target() {
  local triple="$1"
  if ! rustup target list --installed | grep -q "^${triple}$"; then
    info "Installing Rust target: $triple"
    rustup target add "$triple"
  fi
}

# --- Build one target ---
build_target() {
  local triple="$1"
  local wrapper_dir
  wrapper_dir=$(wrapper_dir_for "$triple") || {
    fail "Unknown target: $triple"
    return 1
  }

  ensure_target "$triple"
  info "Building seam-cli for $triple ($PROFILE)..."

  case "$triple" in
    x86_64-unknown-linux-musl)
      CC_x86_64_unknown_linux_musl=x86_64-linux-musl-gcc \
      AR_x86_64_unknown_linux_musl=x86_64-linux-musl-ar \
      CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=x86_64-linux-musl-gcc \
        cargo build -p seam-cli --target "$triple" $CARGO_FLAGS
      ;;
    aarch64-unknown-linux-musl)
      CC_aarch64_unknown_linux_musl=aarch64-linux-musl-gcc \
      AR_aarch64_unknown_linux_musl=aarch64-linux-musl-ar \
      CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=aarch64-linux-musl-gcc \
        cargo build -p seam-cli --target "$triple" $CARGO_FLAGS
      ;;
    *)
      cargo build -p seam-cli --target "$triple" $CARGO_FLAGS
      ;;
  esac

  local src="$ROOT/target/$triple/$PROFILE/seam"
  local dest="$WRAPPER/$wrapper_dir/bin/seam"

  mkdir -p "$WRAPPER/$wrapper_dir/bin"
  cp "$src" "$dest"
  chmod +x "$dest"

  # UPX compress Linux (musl) binaries
  case "$triple" in
    *-linux-musl)
      local before
      before=$(du -h "$dest" | cut -f1 | xargs)
      info "Compressing with UPX ($before)..."
      upx --best --lzma "$dest" >/dev/null 2>&1
      ;;
  esac

  local size
  size=$(du -h "$dest" | cut -f1 | xargs)
  ok "$triple -> $wrapper_dir/bin/seam ($size)"
}

# --- Main ---
info "Profile: $PROFILE"

if [ -n "$SINGLE_TARGET" ]; then
  build_target "$SINGLE_TARGET"
else
  TARGETS=(
    "aarch64-apple-darwin"
    "x86_64-apple-darwin"
    "aarch64-unknown-linux-musl"
    "x86_64-unknown-linux-musl"
  )
  FAILED=0
  for triple in "${TARGETS[@]}"; do
    if ! build_target "$triple"; then
      FAILED=$((FAILED + 1))
    fi
  done

  echo ""
  if [ "$FAILED" -gt 0 ]; then
    fail "$FAILED target(s) failed"
    exit 1
  fi
  ok "All 4 targets built"
fi
