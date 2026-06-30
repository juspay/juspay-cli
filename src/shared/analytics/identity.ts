/**
 * Juspay analytics identity (CLI side) — see brains/integration-analytics-design.md.
 *
 * The durable per-install id used to tag MCP traffic so the backend can stitch a
 * merchant's integration journey. Minted once on first use and persisted under the
 * same XDG config dir as auth; never regenerated.
 *
 * Shared on purpose: imported by agent-setup's MCP writer (the direct / plain-`claude`
 * path — Phase 1) and, later, by the OpenCode wrapper + `juspay <agent>` launchers
 * (the launcher path, which additionally fills the session id — Phase 2).
 */

import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { juspayConfigDir } from "../auth/paths.js"

// Headers carried on every MCP request (both the docs + dashboard servers).
export const INSTALL_ID_HEADER = "X-Juspay-Install-Id"
export const SESSION_ID_HEADER = "X-Juspay-Session-Id"

const installIdPath = path.join(juspayConfigDir, "install-id")

let cached: string | undefined

/**
 * This machine's durable install id, minting + persisting one on first call.
 * Best-effort and never throws: if the file can't be written we fall back to an
 * in-memory id for the run, because analytics must never break setup.
 */
export async function getInstallId(): Promise<string> {
  if (cached) return cached
  try {
    const existing = (await fs.readFile(installIdPath, "utf8")).trim()
    if (existing) return (cached = existing)
  } catch {
    // not created yet (or unreadable) — mint below
  }
  const id = crypto.randomUUID()
  try {
    await fs.mkdir(juspayConfigDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(installIdPath, id + "\n", { mode: 0o600 })
  } catch {
    // persist failed — use the in-memory id for this run
  }
  return (cached = id)
}

/**
 * Build the analytics headers for one MCP server entry. `sessionRef` is the literal
 * session value/placeholder for the flow (e.g. "{env:JUSPAY_SESSION_ID}" on the
 * OpenCode wrapper, "${JUSPAY_SESSION_ID:-}" in a written agent config) and is
 * omitted on the install-id-only direct path (Phase 1).
 */
export function mcpAnalyticsHeaders(installId: string, sessionRef?: string): Record<string, string> {
  const headers: Record<string, string> = { [INSTALL_ID_HEADER]: installId }
  if (sessionRef) headers[SESSION_ID_HEADER] = sessionRef
  return headers
}

/**
 * Consent seam: whether to emit analytics at all. Default on; `JUSPAY_ANALYTICS=0`
 * (or "off"/"false") opts out, which restores plain URL-only configs. The proper
 * install-time consent UX will set/read a persisted preference through this same
 * gate (design doc §13).
 */
export function analyticsEnabled(): boolean {
  const v = process.env.JUSPAY_ANALYTICS?.toLowerCase()
  return v !== "0" && v !== "off" && v !== "false"
}
