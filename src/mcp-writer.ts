/**
 * Generic MCP config writer/remover, scope-aware. Driven by the agent registry —
 * one code path for every agent, JSON and TOML, global or project scope.
 *
 * We write two URL-only server entries (docs + dashboard) into the agent's config
 * for the chosen scope, preserving everything else. No token is written.
 *
 * Safety: if a config file exists but doesn't parse, we ABORT rather than
 * overwrite — these are real user files (e.g. ~/.claude.json) we must not clobber.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { parse as parseToml, stringify as stringifyToml } from "smol-toml"

import { configFileFor, type AgentDef, type Scope } from "./agents.js"
import {
  DASHBOARD_MCP_NAME,
  DOCS_MCP_ENDPOINT,
  DOCS_MCP_NAME,
  JUSPAY_MCP_ENDPOINT,
  OUR_MCP_NAMES,
} from "./servers.js"

// Write our two MCP servers into the agent's config for `scope`.
export async function writeMcp(agent: AgentDef, scope: Scope): Promise<void> {
  const file = configFileFor(agent, scope)
  const entries: Record<string, unknown> = {
    [DOCS_MCP_NAME]: agent.entry(DOCS_MCP_ENDPOINT),
    [DASHBOARD_MCP_NAME]: agent.entry(JUSPAY_MCP_ENDPOINT),
  }

  await fs.mkdir(path.dirname(file), { recursive: true })
  if (agent.format === "json") await mergeJson(file, agent.containerKey, entries)
  else await mergeToml(file, agent.containerKey, entries)
}

// Remove our two MCP servers from the agent's config at `scope`. Returns true if
// anything was removed.
export async function removeMcp(agent: AgentDef, scope: Scope): Promise<boolean> {
  const file = configFileFor(agent, scope)
  let raw: string
  try {
    raw = await fs.readFile(file, "utf8")
  } catch {
    return false
  }

  const config = (agent.format === "json" ? JSON.parse(raw) : parseToml(raw)) as Record<string, unknown>
  const container = config[agent.containerKey] as Record<string, unknown> | undefined
  if (!container) return false

  let changed = false
  for (const name of OUR_MCP_NAMES) {
    if (container[name]) {
      delete container[name]
      changed = true
    }
  }
  if (!changed) return false

  const out = agent.format === "json" ? JSON.stringify(config, null, 2) + "\n" : stringifyToml(config)
  await writeAtomic(file, out)
  return true
}

// Parsed check: is OUR dashboard MCP actually in the agent's config at this
// scope? Reads the real container key instead of grepping the raw file, so an
// unrelated occurrence of "juspay-mcp" (in a comment, in another value) does
// not false-positive. (Convention borrowed from microsoft/apm.)
export async function hasOurMcp(agent: AgentDef, scope: Scope): Promise<boolean> {
  const config = await readExisting(configFileFor(agent, scope), agent.format).catch(() => null)
  if (!config) return false
  const container = config[agent.containerKey] as Record<string, unknown> | undefined
  return Boolean(container && container[DASHBOARD_MCP_NAME])
}

// Read an existing config, or null if absent. Throws (refusing to overwrite) if
// the file exists but can't be parsed.
async function readExisting(file: string, format: AgentDef["format"]): Promise<Record<string, unknown> | null> {
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

async function mergeJson(file: string, containerKey: string, entries: Record<string, unknown>): Promise<void> {
  const config = (await readExisting(file, "json")) ?? {}
  const container =
    config[containerKey] && typeof config[containerKey] === "object"
      ? (config[containerKey] as Record<string, unknown>)
      : {}
  Object.assign(container, entries)
  config[containerKey] = container
  await writeAtomic(file, JSON.stringify(config, null, 2) + "\n")
}

async function mergeToml(file: string, containerKey: string, entries: Record<string, unknown>): Promise<void> {
  const config = (await readExisting(file, "toml")) ?? {}
  const container =
    config[containerKey] && typeof config[containerKey] === "object"
      ? (config[containerKey] as Record<string, unknown>)
      : {}
  Object.assign(container, entries)
  config[containerKey] = container
  await writeAtomic(file, stringifyToml(config))
}

// Atomic write: tempfile + rename, so a concurrent reader or a crash never
// sees a partial config. Mode 0o600 because agent configs (e.g. ~/.claude.json)
// can hold OAuth state and must not be world-readable. (Borrowed from
// microsoft/apm's adapter conventions.)
async function writeAtomic(file: string, contents: string): Promise<void> {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`
  await fs.writeFile(tmp, contents, { mode: 0o600 })
  await fs.rename(tmp, file)
}
