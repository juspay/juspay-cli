/**
 * Auth-layer constants. These are auth concerns (the OAuth issuer + the dashboard
 * MCP endpoint we call for `whoami`), so they live here rather than being pulled
 * across the layer boundary from products/checkout. The wrapper plan's hard
 * constraint (§2) is explicit that we must NOT pre-emptively extract or generalise
 * agent-setup's constants — so where the value overlaps with agent-setup's
 * servers.ts (the dashboard endpoint), we deliberately keep an independent copy
 * here instead of coupling shared/ to a product.
 *
 * The issuer + endpoint match the shipped flow in juspay-skills/claude-cli/src
 * (production on mcp.juspay.in since 2026-05-19). Discovery hangs off the issuer:
 * <issuer>/.well-known/oauth-authorization-server → authorize / token / register.
 */

import pkg from "../../../package.json" with { type: "json" }

export const JUSPAY_MCP_ISSUER = "https://mcp.juspay.in/dashboard"
export const JUSPAY_MCP_ENDPOINT = "https://mcp.juspay.in/dashboard/juspay-dashboard-stream"

export const CLI_VERSION = pkg.version
// User-Agent token (RFC 7231). The package is published unscoped as "juspay".
export const USER_AGENT = `${pkg.name}/${CLI_VERSION} (+https://juspay.in)`
