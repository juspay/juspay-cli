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
  entry: (url: string) => Record<string, unknown> // one URL-only server entry
  // --- skills + auth ---
  skillsSlug?: string
  logoutCmd?: string[] // CLI command to clear the agent's cached creds, if any
  authHint: string // human one-liner for how to authenticate
  // --- detection ---
  bin?: string
  homeMarkers?: string[]
  vscodeExt?: boolean
}

function vscodeUserMcp(): string {
  if (process.platform === "darwin") {
    return path.join(HOME, "Library", "Application Support", "Code", "User", "mcp.json")
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(HOME, "AppData", "Roaming"), "Code", "User", "mcp.json")
  }
  return path.join(HOME, ".config", "Code", "User", "mcp.json")
}

// --- per-agent entry shapes (URL only; the agent self-authenticates) ---
const httpType = (url: string) => ({ type: "http", url }) // Claude, Copilot, VS Code
const urlOnly = (url: string) => ({ url }) // Cursor
const codexEntry = (url: string) => ({ url, enabled: true }) // Codex (TOML)
const httpUrlField = (url: string) => ({ httpUrl: url }) // Gemini
const opencodeRemote = (url: string) => ({ type: "remote", url, enabled: true }) // OpenCode
const windsurfUrl = (url: string) => ({ serverUrl: url }) // Windsurf

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
    homeMarkers: [".gemini"],
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
    label: "GitHub Copilot CLI",
    globalPath: path.join(HOME, ".copilot", "mcp-config.json"),
    projectPath: ".mcp.json",
    globalOnly: true, // Copilot doesn't read workspace (project) MCP config
    format: "json",
    containerKey: "mcpServers",
    entry: httpType,
    skillsSlug: "github-copilot",
    authHint: "in-app (note: Copilot remote-MCP OAuth is currently limited)",
    bin: "copilot",
    homeMarkers: [".copilot"],
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
    entry: windsurfUrl,
    skillsSlug: "windsurf",
    authHint: "Windsurf prompts to authenticate in its MCP panel",
    homeMarkers: [".codeium", ".windsurf"],
  },
  {
    id: "vscode",
    label: "VS Code / Copilot",
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
  if (a.vscodeExt && (await hasVscodeCopilot())) return true
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
