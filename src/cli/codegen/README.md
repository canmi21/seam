# seam-codegen

TypeScript codegen and manifest types for the SeamJS CLI. Generates typed `createSeamClient()` factories and procedure metadata from server manifests. Part of the [CLI toolchain](../../../docs/architecture/logic-layer.md#cli).

## Key Exports

| Export                     | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `Manifest`                 | Parsed server manifest with procedures + channels  |
| `ProcedureSchema`          | Single procedure definition (input/output/error)   |
| `ChannelSchema`            | WebSocket channel definition                       |
| `generate_typescript`      | Generate typed `createSeamClient()` factory source |
| `generate_typescript_meta` | Generate `meta.ts` with procedure metadata         |
| `RpcHashMap`               | Hash-based RPC endpoint lookup map                 |
| `generate_rpc_hash_map`    | Build collision-free hash map from procedure names |
| `generate_random_salt`     | Generate random salt for RPC hash computation      |

## Development

- Build: `cargo build -p seam-codegen`
- Test: `cargo test -p seam-codegen`

## Notes

- RPC hash map uses SHA256 with random salt to ensure collision-free endpoint routing
- Consumed by [seam-cli](../core/) during manifest processing and code generation
- See [CLAUDE.md](./CLAUDE.md) for internal architecture and sub-module details
