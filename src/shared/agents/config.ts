/**
 * Agent config READ-side — shared between agent-setup's writer (parsing before a
 * merge) and `juspay launch` (checking whether an agent is Juspay-configured). The
 * WRITE side (writeMcp / removeMcp) stays in agent-setup; this module is read-only.
 */

import fs from "node:fs/promises"

import { parse as parseToml } from "smol-toml"

import { configFileFor, type AgentDef, type Scope } from "./registry.js"
import { DASHBOARD_MCP_NAME } from "./servers.js"

// Read an existing config, or null if absent. Throws (refusing to let a caller
// overwrite) if the file exists but can't be parsed.
export async function readExisting(
  file: string,
  format: AgentDef["format"],
): Promise<Record<string, unknown> | null> {
  let raw: string
  try {
    raw = await fs.readFile(file, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
  if (raw.trim() === "") return null
  try {
    return (format === "json" ? JSON.parse(raw) : parseToml(raw)) as Record<string, unknown>
  } catch {
    throw new Error(`${file} isn't valid ${format.toUpperCase()}; refusing to overwrite it. Fix or remove it, then re-run.`)
  }
}

// Is OUR dashboard MCP actually in the agent's config at this scope? Reads the real
// container key instead of grepping the raw file, so an unrelated "juspay-mcp"
// mention (in a comment, in another value) doesn't false-positive.
export async function hasOurMcp(agent: AgentDef, scope: Scope): Promise<boolean> {
  const config = await readExisting(configFileFor(agent, scope), agent.format).catch(() => null)
  if (!config) return false
  const container = config[agent.containerKey] as Record<string, unknown> | undefined
  return Boolean(container && container[DASHBOARD_MCP_NAME])
}
