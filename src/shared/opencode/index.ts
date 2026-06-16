/**
 * Public surface of the shared OpenCode wrapper. Products import from here: build
 * a session config with `provision()`, then hand it to `launchOpencode()`.
 */

export { detectOpencode, ensureOpencode, removeOpencode, PINNED_OPENCODE_VERSION, type OpencodeInfo } from "./detect.js"
export {
  provision,
  TOKEN_ENV_VAR,
  type AgentPermission,
  type AgentSpec,
  type McpServer,
  type Provisioned,
  type ProvisionInput,
} from "./provision.js"
export { launchOpencode } from "./launch.js"
