/**
 * Agent registry — the single data table that drives MCP config writing, skills
 * targeting, detection, and auth. Adding a new agent is a new row here.
 *
 * Each agent has TWO config locations: a `globalPath` (user scope — every project)
 * and a `projectPath` (cwd-relative — this repo). The chosen scope decides which
 * we write, and whether `skills` installs globally or into the project.
 *
 * No token handling: we write the server URL only. Each agent authenticates the
 * dashboard server itself (in-app, or guided by the installed skill).
 */

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import which from "which"

import { DASHBOARD_MCP_NAME } from "./servers.js"

const HOME = os.homedir()

export type ConfigFormat = "json" | "toml"
export type Scope = "global" | "project"

export type AgentDef = {
  id: string
  label: string
  // --- MCP config targets ---
  globalPath: string // absolute (user scope)
  projectPath: string // cwd-relative (this project)
  globalOnly?: boolean // only works at user scope (e.g. Copilot, VS Code) — always global
  format: ConfigFormat
  containerKey: string // "mcpServers" | "mcp" | "servers" | "mcp_servers"
  entry: (url: string, headers?: Record<string, string>) => Record<string, unknown> // server entry (+ optional analytics headers)
  // --- skills + auth ---
  skillsSlug?: string
  logoutCmd?: string[] // CLI command to clear the agent's cached creds, if any
  authHint: string // human one-liner for how to authenticate
  // --- detection ---
  bin?: string
  homeMarkers?: string[]
  vscodeExt?: boolean
}

// VS Code's per-user data dir — where its mcp.json lives and where we write. Created
// the first time VS Code runs, on every OS (Windows uses %APPDATA%). This is our
// primary VS Code detection signal (see hasVscode): reliable even when Copilot Chat is
// built-in (no github.copilot* under ~/.vscode/extensions) and when `code` isn't yet on
// PATH right after a fresh install.
function vscodeUserDir(): string {
  if (process.platform === "darwin") {
    return path.join(HOME, "Library", "Application Support", "Code", "User")
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(HOME, "AppData", "Roaming"), "Code", "User")
  }
  return path.join(HOME, ".config", "Code", "User")
}

function vscodeUserMcp(): string {
  return path.join(vscodeUserDir(), "mcp.json")
}

// --- per-agent entry shapes ---
// Each builder takes the server URL + optional `headers` (analytics: the install id,
// plus a session ref on launcher flows). `headers` is the de-facto MCP-config field
// for HTTP/remote servers; clients that don't read it ignore it. Per-agent honoring
// is verified before we rely on it — see brains/integration-analytics-design.md §15.
const withHeaders = (h?: Record<string, string>) => (h ? { headers: h } : {})
const httpType = (url: string, h?: Record<string, string>) => ({ type: "http", url, ...withHeaders(h) }) // Claude, VS Code
// GitHub Copilot CLI requires `tools` on every HTTP server (type + url + tools are
// all required). Without it the server is written but stays "stopped" with no tools
// and no start control. "*" = expose all tools. CLI-only — Claude/VS Code reject it.
const copilotHttp = (url: string, h?: Record<string, string>) => ({ type: "http", url, tools: ["*"], ...withHeaders(h) })
const urlOnly = (url: string, h?: Record<string, string>) => ({ url, ...withHeaders(h) }) // Cursor
// Codex (TOML) uses `http_headers` (NOT `headers`) for custom HTTP MCP headers.
const codexEntry = (url: string, h?: Record<string, string>) => ({ url, enabled: true, ...(h ? { http_headers: h } : {}) })
const httpUrlField = (url: string, h?: Record<string, string>) => ({ httpUrl: url, ...withHeaders(h) }) // Gemini
const opencodeRemote = (url: string, h?: Record<string, string>) => ({ type: "remote", url, enabled: true, ...withHeaders(h) }) // OpenCode
const serverUrlEntry = (url: string, h?: Record<string, string>) => ({ serverUrl: url, ...withHeaders(h) }) // Windsurf, Antigravity

export const AGENTS: AgentDef[] = [
  {
    id: "claude",
    label: "Claude Code",
    globalPath: path.join(HOME, ".claude.json"),
    projectPath: ".mcp.json",
    format: "json",
    containerKey: "mcpServers",
    entry: httpType,
    skillsSlug: "claude-code",
    authHint: `/mcp → ${DASHBOARD_MCP_NAME} → Authenticate`,
    bin: "claude",
    homeMarkers: [".claude", ".claude.json"],
  },
  {
    id: "codex",
    label: "Codex CLI",
    globalPath: path.join(HOME, ".codex", "config.toml"),
    projectPath: path.join(".codex", "config.toml"),
    format: "toml",
    containerKey: "mcp_servers",
    entry: codexEntry,
    skillsSlug: "codex",
    logoutCmd: ["codex", "mcp", "logout", DASHBOARD_MCP_NAME],
    authHint: `codex mcp login ${DASHBOARD_MCP_NAME}`,
    bin: "codex",
    homeMarkers: [".codex"],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    globalPath: path.join(HOME, ".gemini", "settings.json"),
    projectPath: path.join(".gemini", "settings.json"),
    format: "json",
    containerKey: "mcpServers",
    entry: httpUrlField,
    skillsSlug: "gemini-cli",
    authHint: "it prompts to sign in on first use",
    bin: "gemini",
    // Antigravity ALSO lives under ~/.gemini (in antigravity/ and config/), so the
    // bare ~/.gemini dir would false-detect Gemini CLI on an Antigravity-only
    // machine. Gemini CLI owns the top-level settings.json; key off that instead.
    homeMarkers: [path.join(".gemini", "settings.json")],
  },
  {
    id: "opencode",
    label: "OpenCode CLI",
    globalPath: path.join(HOME, ".config", "opencode", "opencode.json"),
    projectPath: "opencode.json",
    format: "json",
    containerKey: "mcp",
    entry: opencodeRemote,
    skillsSlug: "opencode",
    logoutCmd: ["opencode", "mcp", "logout", DASHBOARD_MCP_NAME],
    authHint: `opencode mcp auth ${DASHBOARD_MCP_NAME}`,
    bin: "opencode",
    homeMarkers: [path.join(".config", "opencode")],
  },
  {
    id: "copilot",
    label: "GitHub Copilot CLI (terminal)",
    globalPath: path.join(HOME, ".copilot", "mcp-config.json"),
    projectPath: ".mcp.json",
    globalOnly: true, // Copilot doesn't read workspace (project) MCP config
    format: "json",
    containerKey: "mcpServers",
    entry: copilotHttp, // CLI needs `tools` on each server (see copilotHttp)
    skillsSlug: "github-copilot",
    authHint: "in-app (note: Copilot remote-MCP OAuth is currently limited)",
    // Detect ONLY via the binary. No homeMarkers: ~/.copilot is created by the CLI
    // itself (npm install), so a leftover dir with no `copilot` on PATH means an
    // uninstalled/unusable CLI — don't surface it. (VS Code Copilot Chat is the
    // `vscode` entry; it does NOT create ~/.copilot.)
    bin: "copilot",
  },
  {
    id: "cursor",
    label: "Cursor",
    globalPath: path.join(HOME, ".cursor", "mcp.json"),
    projectPath: path.join(".cursor", "mcp.json"),
    format: "json",
    containerKey: "mcpServers",
    entry: urlOnly,
    skillsSlug: "cursor",
    authHint: "Cursor prompts to authenticate in its MCP settings",
    homeMarkers: [".cursor"],
  },
  {
    id: "windsurf",
    label: "Windsurf",
    globalPath: path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
    projectPath: path.join(".windsurf", "mcp_config.json"),
    format: "json",
    containerKey: "mcpServers",
    entry: serverUrlEntry,
    skillsSlug: "windsurf",
    authHint: "Windsurf prompts to authenticate in its MCP panel",
    homeMarkers: [".codeium", ".windsurf"],
  },
  {
    id: "antigravity",
    label: "Antigravity",
    // Antigravity's MCP config is global only: ~/.gemini/config/mcp_config.json
    // (no per-project MCP file). It uses the `serverUrl` field and handles the
    // dashboard MCP's OAuth itself via DCR — so we write URL only, no token.
    globalPath: path.join(HOME, ".gemini", "config", "mcp_config.json"),
    projectPath: path.join(".gemini", "config", "mcp_config.json"), // unused (globalOnly)
    globalOnly: true,
    format: "json",
    containerKey: "mcpServers",
    entry: serverUrlEntry,
    // `skills` CLI supports Antigravity natively (--agent antigravity): project →
    // .agents/skills/ (read by Antigravity), global → ~/.gemini/antigravity/skills/.
    skillsSlug: "antigravity",
    authHint: "Antigravity authenticates the dashboard MCP in Settings → Customizations",
    bin: "antigravity",
    homeMarkers: [path.join(".gemini", "antigravity")],
  },
  {
    id: "vscode",
    label: "VS Code Copilot Chat",
    globalPath: vscodeUserMcp(),
    projectPath: path.join(".vscode", "mcp.json"),
    globalOnly: true, // configured at user scope, not per-project
    format: "json",
    containerKey: "servers",
    entry: httpType,
    skillsSlug: "github-copilot",
    authHint: "VS Code prompts to authenticate in the MCP view",
    vscodeExt: true,
  },
]

export function findAgent(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id)
}

// The config file for an agent at a given scope (project = relative to cwd).
export function configFileFor(agent: AgentDef, scope: Scope): string {
  return scope === "global" ? agent.globalPath : path.join(process.cwd(), agent.projectPath)
}

// Which agents to configure: any detected as installed/used on this machine.
export async function detectAgents(): Promise<AgentDef[]> {
  const out: AgentDef[] = []
  for (const a of AGENTS) {
    if (await isDetected(a)) out.push(a)
  }
  return out
}

async function isDetected(a: AgentDef): Promise<boolean> {
  if (a.bin && (await onPath(a.bin))) return true
  for (const m of a.homeMarkers ?? []) {
    if (await exists(path.join(HOME, m))) return true
  }
  if (a.vscodeExt && (await hasVscode())) return true
  return false
}

async function onPath(bin: string): Promise<boolean> {
  try {
    await which(bin)
    return true
  } catch {
    return false
  }
}

// VS Code is present iff its user-data dir exists (created on first run; the same dir we
// write mcp.json into) — reliable on every OS incl. Windows (%APPDATA%\Code\User), and
// independent of Copilot being built-in (no github.copilot* under ~/.vscode/extensions)
// or `code` being on PATH. The latter two are best-effort fallbacks for edge setups.
async function hasVscode(): Promise<boolean> {
  if (await exists(vscodeUserDir())) return true
  if (await onPath("code")) return true
  return hasVscodeCopilot()
}

async function hasVscodeCopilot(): Promise<boolean> {
  const roots = [path.join(HOME, ".vscode", "extensions"), path.join(HOME, ".vscode-insiders", "extensions")]
  for (const root of roots) {
    try {
      const entries = await fs.readdir(root)
      if (entries.some((e) => e.toLowerCase().startsWith("github.copilot"))) return true
    } catch {
      // dir not present
    }
  }
  return false
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
