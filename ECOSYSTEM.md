# Ecosystem

SeamJS is an extremely open and broad ecosystem because it is decoupled across three dimensions. You can pick any piece you need and build your own feature, framework, or application on top of it.

If you have built something with SeamJS, submit a PR to add it here.

## UI Frameworks

Frameworks and libraries that implement CTR skeleton extraction for their component model.

| Project                              | Framework                  | Description                        |
| ------------------------------------ | -------------------------- | ---------------------------------- |
| [seam-react](packages/client/react/) | React                      | Official React bindings (built-in) |
| _Your project here_                  | Vue / Svelte / Solid / ... | Submit a PR                        |

## Backend Implementations

Languages and runtimes that implement the [seam protocol](docs/logic-layer.md#the-seam-protocol).

| Project                                                | Language                 | Description                           |
| ------------------------------------------------------ | ------------------------ | ------------------------------------- |
| [seam-server](packages/server/core/rust/)              | Rust                     | Official Rust server (built-in)       |
| [@canmi/seam-server](packages/server/core/typescript/) | TypeScript               | Official TypeScript server (built-in) |
| [seam-go](packages/server/core/go/)                    | Go                       | Official Go server (built-in)         |
| _Your project here_                                    | Python / C# / Java / ... | Submit a PR                           |

## Transport Adapters

Custom transport channels beyond HTTP — IPC, WebSocket, message queues, or anything else.

| Project             | Transport                   | Description |
| ------------------- | --------------------------- | ----------- |
| _Your project here_ | Tauri IPC / WebSocket / ... | Submit a PR |
