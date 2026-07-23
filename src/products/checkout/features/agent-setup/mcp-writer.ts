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

import {
  configFileFor,
  DASHBOARD_MCP_NAME,
  DOCS_MCP_ENDPOINT,
  DOCS_MCP_NAME,
  JUSPAY_MCP_ENDPOINT,
  OUR_MCP_NAMES,
  readExisting,
  type AgentDef,
  type Scope,
} from "../../../../shared/agents/index.js"
import { analyticsEnabled, getInstallId, mcpAnalyticsHeaders } from "../../../../shared/analytics/index.js"

// Tag the MCP URL with the durable install id + which agent this config is for, in
// the query string — the durable carrier. Some agents don't forward custom headers
// at all (e.g. older Codex), and TLS-inspecting corporate proxies strip them; the URL
// query always reaches the MCP. `agent` lets the backend attribute a session to the
// client (claude / codex / cursor / …). The header is kept alongside as a secondary path.
function taggedUrl(url: string, installId?: string, agentId?: string): string {
  if (!installId) return url
  const params = new URLSearchParams({ install_id: installId })
  if (agentId) params.set("agent", agentId)
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}${params.toString()}`
}

// Write our two MCP servers into the agent's config for `scope`.
export async function writeMcp(agent: AgentDef, scope: Scope): Promise<void> {
  const file = configFileFor(agent, scope)
  // Tag both servers with the durable install id (+ agent slug) so the backend can
  // attribute MCP hits to this machine's journey and to the calling agent. Carried in
  // the URL query (primary) AND the header (secondary). Opt-out (analyticsEnabled=false)
  // writes plain URL-only entries as before.
  const installId = analyticsEnabled() ? await getInstallId() : undefined
  const headers = installId ? mcpAnalyticsHeaders(installId) : undefined
  // OAuth-native agents (VS Code, Antigravity) get canonical URLs — no query string —
  // since they cache their dashboard-MCP OAuth keyed by the server URL. install_id still
  // rides the header for them. All other agents carry install_id + agent in the query
  // (the proxy-resilient primary path).
  const tag = (url: string) => (agent.noUrlParams ? url : taggedUrl(url, installId, agent.id))
  const entries: Record<string, unknown> = {
    [DOCS_MCP_NAME]: agent.entry(tag(DOCS_MCP_ENDPOINT), headers),
    [DASHBOARD_MCP_NAME]: agent.entry(tag(JUSPAY_MCP_ENDPOINT), headers),
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
