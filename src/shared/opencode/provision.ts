/**
 * Build the inline OpenCode config for a provisioned Juspay session (wrapper plan
 * §7). This is a pure builder: it emits the JSON that goes into
 * OPENCODE_CONFIG_CONTENT plus the env the launcher must set, and touches nothing
 * on disk — the user's own ~/.config/opencode is never modified, and no token is
 * ever persisted (it's referenced as {env:JUSPAY_TOKEN} and passed via the child
 * env only — never argv, never a file).
 *
 * Model: we default to a fully-qualified model id supplied by the caller (today,
 * OpenCode Zen's free model — no API key, no custom provider block, no Juspay LLM
 * gateway dependency). If/when the gateway lands, the caller can pass a different
 * model + a provider block without changing this builder's shape.
 *
 * Agents: the caller passes one or more named agents (e.g. an edit-capable
 * "integrate" agent and a read-only "explain" agent), each with its own prompt
 * and OpenCode `permission` map (edit/bash + MCP wildcards like
 * "juspay-mcp_*": "deny"). This layer stays product-agnostic — which agents,
 * which prompts, which MCP servers are all passed in by the command (plan §4).
 *
 * MCP flow differs from agent-setup: where an MCP server is marked `authenticated`
 * we inject `Authorization: Bearer {env:JUSPAY_TOKEN}` so the dashboard MCP is
 * pre-authenticated for this session (agent-setup, by contrast, writes URL-only
 * and lets each agent self-auth). The token refreshes naturally on relaunch.
 *
 * OPENCODE_CONFIG_CONTENT sits above the user's global + project config in
 * OpenCode's precedence, so our agent/mcp keys win on conflict while the user's
 * own plugins/providers still merge in beneath ours.
 */

// The env var the MCP auth header reads the token from. Passed to the child via
// `env` (never argv) so it can't leak through `ps`.
export const TOKEN_ENV_VAR = "JUSPAY_TOKEN"

const TOKEN_REF = `{env:${TOKEN_ENV_VAR}}`

export type McpServer = {
  url: string
  // When true, inject `Authorization: Bearer {env:JUSPAY_TOKEN}` (dashboard MCP).
  // When false/omitted, the server is sent URL-only (docs MCP is unauthenticated).
  authenticated?: boolean
}

export type AgentPermission = "allow" | "ask" | "deny"

export type AgentSpec = {
  name: string
  description: string
  prompt: string
  mode?: "primary" | "subagent" | "all"
  // Fine-grained per-agent access — maps straight onto OpenCode's `permission`.
  // Keys: "edit", "bash", "webfetch", or an MCP wildcard like "juspay-mcp_*".
  // Values: "allow" | "ask" | "deny".
  permission?: Record<string, AgentPermission>
}

export type ProvisionInput = {
  // The OAuth bearer from shared/auth — injected into MCP headers via the env var
  // (not embedded in the config text). Omitted when the user skips sign-in; then
  // no MCP server should be marked `authenticated` and OpenCode self-auths instead.
  token?: string
  // Fully-qualified model id, e.g. "opencode/big-pickle".
  model: string
  agents: AgentSpec[]
  // Which agent loads first (must match one of `agents[].name`).
  defaultAgent: string
  // Remote MCP servers by name → { url, authenticated? }.
  mcp: Record<string, McpServer>
}

export type Provisioned = {
  configContent: string
  env: Record<string, string>
}

export function provision(input: ProvisionInput): Provisioned {
  const mcp: Record<string, unknown> = {}
  for (const [name, server] of Object.entries(input.mcp)) {
    const entry: Record<string, unknown> = { type: "remote", url: server.url, enabled: true }
    if (server.authenticated) {
      entry.headers = { Authorization: `Bearer ${TOKEN_REF}` }
    }
    mcp[name] = entry
  }

  const agent: Record<string, unknown> = {}
  for (const a of input.agents) {
    const entry: Record<string, unknown> = {
      description: a.description,
      prompt: a.prompt,
      mode: a.mode ?? "primary",
    }
    if (a.permission) entry.permission = a.permission
    agent[a.name] = entry
  }

  const config = {
    $schema: "https://opencode.ai/config.json",
    model: input.model,
    agent,
    default_agent: input.defaultAgent,
    mcp,
  }

  return {
    configContent: JSON.stringify(config),
    // Only export the token when we have one (sign-in path). In skip mode there's
    // no token and no authenticated MCP header to resolve it.
    env: input.token ? { [TOKEN_ENV_VAR]: input.token } : {},
  }
}
