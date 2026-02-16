# @canmi/seam-cli

npm distribution package for the `seam` CLI binary.

## Overview

This package wraps the Rust-compiled `seam-cli` binary for npm distribution. It resolves the correct platform-specific binary at install time.

## Supported Platforms

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`

## Usage

```bash
npx @canmi/seam-cli <command>
```

## Notes

- The actual CLI logic lives in `packages/cli/core` (Rust)
- This package only contains the binary resolver and platform binaries
