/**
 * Setup flow: detect agents → user PICKS which → user PICKS scope (global or
 * this project) → for each picked agent write the Juspay MCP URL at that scope
 * and install its skill at that scope.
 *
 * We do NOT authenticate — each agent authenticates the dashboard server itself
 * (in-app, or guided by the installed skill). No OAuth/token on our side.
 *
 * Idempotent: `pending` (agents we show auth hints for) is only the freshly-added
 * ones, so re-running setup doesn't re-nag already-configured agents.
 */

import fs from "node:fs/promises"
import { cancel, isCancel, multiselect, select } from "@clack/prompts"

import { configFileFor, detectAgents, type AgentDef, type Scope } from "./agents.js"
import { writeMcp } from "./mcp-writer.js"
import { DASHBOARD_MCP_NAME } from "./servers.js"
import { addSkills } from "./skills-installer.js"
import { done, info, spin, step, warn } from "./ui.js"

export type SetupResult = {
  configured: AgentDef[]
  pending: AgentDef[]
  scope: Scope
}

export async function runSetup(): Promise<SetupResult> {
  const detected = await detectAgents()
  if (detected.length === 0) {
    warn("No supported AI agents detected on this machine.")
    info("Install one (claude, codex, gemini, opencode, copilot, cursor, windsurf) and re-run.")
    return { configured: [], pending: [], scope: "global" }
  }

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const selected = await pickAgents(detected, interactive)
  if (selected.length === 0) {
    cancel("No agents selected.")
    process.exit(0)
  }
  const scope = await pickScope(interactive)

  // Some agents only work at user scope (Copilot / VS Code don't pick up
  // project-level config) — force those to global regardless of the chosen scope.
  const scopeFor = (a: AgentDef): Scope => (a.globalOnly ? "global" : scope)

  // 1. MCP config (idempotent merge). Track freshly-added so re-runs don't re-nag.
  const configured: AgentDef[] = []
  const pending: AgentDef[] = []
  const s = spin(`Adding Juspay MCP to ${selected.length} agent(s)...`)
  for (const a of selected) {
    const sc = scopeFor(a)
    const already = await isConfigured(a, sc)
    try {
      await writeMcp(a, sc)
      configured.push(a)
      if (!already) pending.push(a)
    } catch (err) {
      info(`${a.label}: ${(err as Error).message}`)
    }
  }
  s.done(`Configured ${configured.map((a) => a.label).join(", ")}`)
  if (scope === "project") {
    const forced = configured.filter((a) => a.globalOnly)
    if (forced.length > 0) {
      info(`${forced.map((a) => a.label).join(", ")} only support global scope — configured globally.`)
    }
  }

  // 2. Skills — install per EFFECTIVE scope (global-only agents go to global).
  step("Installing skills...")
  try {
    for (const sc of ["project", "global"] as const) {
      const group = configured.filter((a) => scopeFor(a) === sc)
      if (group.length > 0) await addSkills(group, sc)
    }
    done("Skills installed")
  } catch (err) {
    warn(`Skills install failed: ${(err as Error).message}`)
  }

  return { configured, pending, scope }
}

async function isConfigured(agent: AgentDef, scope: Scope): Promise<boolean> {
  try {
    const raw = await fs.readFile(configFileFor(agent, scope), "utf8")
    return raw.includes(DASHBOARD_MCP_NAME)
  } catch {
    return false
  }
}

async function pickAgents(detected: AgentDef[], interactive: boolean): Promise<AgentDef[]> {
  if (!interactive) return detected // CI/headless: configure all detected
  const ids = await multiselect({
    message: "Which agents should get Juspay MCP + skills?",
    options: detected.map((a) => ({ value: a.id, label: a.label })),
    initialValues: [], // nothing pre-ticked — opt in
    required: true, // can't confirm an empty selection
  })
  if (isCancel(ids)) {
    cancel("Cancelled.")
    process.exit(0)
  }
  const set = new Set(ids as string[])
  return detected.filter((a) => set.has(a.id))
}

async function pickScope(interactive: boolean): Promise<Scope> {
  if (!interactive) return "global" // CI/headless default
  const scope = await select({
    message: "Install where?",
    options: [
      { value: "global", label: "Global", hint: "available in every project" },
      { value: "project", label: "This project", hint: "lives in this repo (committable)" },
    ],
    initialValue: "global",
  })
  if (isCancel(scope)) {
    cancel("Cancelled.")
    process.exit(0)
  }
  return scope as Scope
}
