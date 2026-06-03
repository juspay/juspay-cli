import pkg from "../package.json" with { type: "json" }

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

// Single source of truth: name + version come from package.json so a release
// bump only happens in one place. Bun inlines the JSON at build time; the TS
// `with { type: "json" }` attribute keeps tsc --noEmit happy under NodeNext.
export const PACKAGE_NAME = pkg.name
export const CLI_VERSION = pkg.version

// User-Agent tokens (RFC 7231) can't contain '/' or '@', so strip the npm scope
// before composing the UA. "@juspay/cli" → "cli/0.7.0 (+…)" would be ambiguous,
// so fall back to "juspay-cli" when the name is scoped.
const UA_NAME = pkg.name.startsWith("@") ? pkg.name.slice(1).replace("/", "-") : pkg.name
export const USER_AGENT = `${UA_NAME}/${CLI_VERSION} (+https://juspay.in)`
