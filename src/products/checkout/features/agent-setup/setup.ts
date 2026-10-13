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

import { cancel } from "@clack/prompts"

import {
  detectAgents,
  hasOurMcp,
  pickAgents,
  pickScope,
  type AgentDef,
  type Scope,
} from "../../../../shared/agents/index.js"
import { emitSetupStage, writeMcp } from "./mcp-writer.js"
import { addSkills } from "./skills-installer.js"
import { info, spin, step, warn } from "../../../../core/ui.js"

export type SetupResult = {
  configured: AgentDef[]
  pending: AgentDef[]
  scope: Scope
  // How many agents the user picked. Lets `main` distinguish "user picked 0"
  // (return 0) from "user picked N but every write failed" (return 2).
  attempted: number
  // True if we never attempted skill install OR attempted and succeeded.
  // False ONLY when an attempt failed — that's what flips the summary box.
  skillsInstalled: boolean
  skillsError?: string
}

export async function runSetup(): Promise<SetupResult> {
  const detected = await detectAgents()
  if (detected.length === 0) {
    warn("No supported AI agents detected on this machine.")
    info("Install one (claude, codex, gemini, opencode, copilot, cursor, windsurf) and re-run.")
    return { configured: [], pending: [], scope: "global", attempted: 0, skillsInstalled: true }
  }

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const selected = await pickAgents(detected, interactive, "Which agents should get Juspay MCP + skills?")
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
    const already = await hasOurMcp(a, sc)
    try {
      await writeMcp(a, sc)
      configured.push(a)
      if (!already) pending.push(a)
    } catch (err) {
      info(`${a.label}: ${(err as Error).message}`)
    }
  }
  s.done(`Configured ${configured.map((a) => a.label).join(", ")}`)
  // Best-effort funnel "setup" milestone per freshly-configured agent (never blocks
  // meaningfully — each call is timeout-bounded and swallows errors). Only the newly
  // added agents (`pending`), so re-running setup doesn't re-emit for existing ones.
  if (pending.length > 0) await Promise.allSettled(pending.map((a) => emitSetupStage(a)))
  if (scope === "project") {
    const forced = configured.filter((a) => a.globalOnly)
    if (forced.length > 0) {
      info(`${forced.map((a) => a.label).join(", ")} only support global scope — configured globally.`)
    }
  }

  // 2. Skills — install per EFFECTIVE scope (global-only agents go to global).
  // Track outcome on the result so the summary + exit code reflect reality
  // (previously a failure here was warned but the box still said "complete").
  let skillsInstalled = true // stays true if there's nothing to install
  let skillsError: string | undefined
  if (configured.length > 0) {
    step("Installing skills...")
    skillsInstalled = false // about to attempt — flip back to true on success
    try {
      for (const sc of ["project", "global"] as const) {
        const group = configured.filter((a) => scopeFor(a) === sc)
        if (group.length > 0) await addSkills(group, sc)
      }
      skillsInstalled = true
      // Per-skill ✓ ticks already convey success, so no redundant "Skills
      // installed" line. But surface the upstream security note exactly once
      // — these skills run with the agent's full permissions.
      warn("Review skills before use — they run with full agent permissions.")
    } catch (err) {
      skillsError = (err as Error).message
      warn(`Skills install failed: ${skillsError}`)
    }
  }

  return { configured, pending, scope, attempted: selected.length, skillsInstalled, skillsError }
}
