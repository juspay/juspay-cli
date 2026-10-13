/**
 * HDFC SmartGateway setup flow: detect agents → user PICKS which → user PICKS
 * scope → install the hdfc-sg-integration skill for those agents at that scope.
 *
 * Skills only — no MCP config, no auth, no telemetry. The skill reads the
 * SmartGateway integration kit itself. Re-running is safe: `skills add` overwrites.
 */

import { cancel } from "@clack/prompts"

import { detectAgents, pickAgents, pickScope, type AgentDef, type Scope } from "../../../../shared/agents/index.js"
import { addSkills } from "../../../../shared/skills/index.js"
import { info, step, warn } from "../../../../core/ui.js"
import { HDFC_SG_SKILL_PACKAGES } from "../../skills.js"

export type SetupResult = {
  configured: AgentDef[]
  scope: Scope
  // False ONLY when an install was attempted and failed — flips the summary box.
  skillsInstalled: boolean
  skillsError?: string
}

export async function runSetup(): Promise<SetupResult> {
  // Every agent we can target needs a `skills` CLI slug.
  const detected = (await detectAgents()).filter((a) => a.skillsSlug)
  if (detected.length === 0) {
    warn("No supported AI agents detected on this machine.")
    info("Install one (claude, codex, gemini, opencode, copilot, cursor, windsurf) and re-run.")
    return { configured: [], scope: "global", skillsInstalled: true }
  }

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const selected = await pickAgents(detected, interactive, "Which agents should get the HDFC SmartGateway skill?")
  if (selected.length === 0) {
    cancel("No agents selected.")
    process.exit(0)
  }
  const scope = await pickScope(interactive)

  // Some agents only work at user scope (Copilot / VS Code don't pick up
  // project-level config) — install those globally regardless of the chosen scope.
  const scopeFor = (a: AgentDef): Scope => (a.globalOnly ? "global" : scope)

  step("Installing skill...")
  try {
    for (const sc of ["project", "global"] as const) {
      const group = selected.filter((a) => scopeFor(a) === sc)
      if (group.length > 0) await addSkills(HDFC_SG_SKILL_PACKAGES, group, sc)
    }
  } catch (err) {
    const skillsError = (err as Error).message
    warn(`Skill install failed: ${skillsError}`)
    return { configured: selected, scope, skillsInstalled: false, skillsError }
  }
  if (scope === "project") {
    const forced = selected.filter((a) => a.globalOnly)
    if (forced.length > 0) {
      info(`${forced.map((a) => a.label).join(", ")} only support global scope — installed globally.`)
    }
  }
  // These skills run with the agent's full permissions — say so once.
  warn("Review skills before use — they run with full agent permissions.")
  return { configured: selected, scope, skillsInstalled: true }
}
