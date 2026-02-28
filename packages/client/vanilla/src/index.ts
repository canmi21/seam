/* packages/client/vanilla/src/index.ts */

export { createClient } from "./client.js";
export { SeamClientError } from "./errors.js";
export { seamRpc, configureRpcMap } from "./rpc.js";
export { createChannelHandle } from "./channel-handle.js";

export type { ClientOptions, SeamClient, Unsubscribe } from "./client.js";
export type { ErrorCode } from "./errors.js";
export type { ChannelHandle } from "./channel-handle.js";

export type ProcedureKind = "query" | "command" | "subscription";
