// Juspay MCP resource endpoints. Both are remote streamable-HTTP MCP servers.
// The dashboard server requires auth, but the AGENT performs its own OAuth
// (MCP authorization spec: DCR + PKCE) the first time it's used — we never
// store or inject a token. The docs server is unauthenticated.
export const JUSPAY_MCP_ENDPOINT = "https://mcp.juspay.in/dashboard/juspay-dashboard-stream"
export const DOCS_MCP_ENDPOINT = "https://mcp.juspay.in/dashboard/juspay-docs-stream"

// The two MCP server names we manage. Used by the writer + remover so we only
// touch our own entries and leave the merchant's other servers alone.
export const DOCS_MCP_NAME = "docs-mcp-server"
export const DASHBOARD_MCP_NAME = "juspay-mcp"
export const OUR_MCP_NAMES = [DOCS_MCP_NAME, DASHBOARD_MCP_NAME] as const

// Skill package for the `skills` npm CLI: <owner>/<repo>/<path-to-skill>.
// `npx skills add` deploys it. Update when skills move to a Juspay-owned repo.
export const SKILLS_PACKAGE = "sahyll/juspay-skills/skills/integrate"

// npm package name (user-facing hints). Becomes "@juspay/ai" once published
// under the Juspay org.
export const PACKAGE_NAME = "@sahyll/ai-2"

// Single source of truth for the CLI version + user-agent. Update on every release.
export const CLI_VERSION = "0.7.0"
export const USER_AGENT = `juspay-ai-cli/${CLI_VERSION} (+https://juspay.in)`
