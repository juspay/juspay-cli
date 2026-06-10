/**
 * `juspay checkout agent-setup` — and its `uninstall` / `list` sub-commands.
 *
 * This is the original setup flow (formerly the default `npx @juspay/cli`),
 * unchanged in behavior: detect AI
 * agents → pick which + scope → write the Juspay MCP URLs → install the jp-* skills.
 * The flow logic lives in features/agent-setup/*; this module is the command-tree
 * wiring + the human-facing summary/next-steps output.
 */

import { spawn } from "node:child_process"

import type { Command } from "commander"
import pc from "picocolors"

import type { CliContext } from "../../../cli/types.js"
import { EXIT_PARTIAL } from "../../../core/errors.js"
import { AGENTS, type AgentDef } from "../features/agent-setup/agents.js"
import { hasOurMcp, removeMcp } from "../features/agent-setup/mcp-writer.js"
import { runSetup, type SetupResult } from "../features/agent-setup/setup.js"
import { OUR_SKILL_NAMES, removeSkills } from "../features/agent-setup/skills-installer.js"

// The full command path, used in next-step hints so the printed commands match
// what the user actually types.
const CMD_PATH = "juspay checkout agent-setup"

export function registerAgentSetup(parent: Command, ctx: CliContext): void {
  const cmd = parent
    .command("agent-setup")
    .description("Add the Juspay MCP servers + integration skills to your AI coding agents")
    .action(() => runSetupCommand(ctx))

  cmd
    .command("uninstall")
    .description("Remove the Juspay MCP + skills (both scopes) and sign out")
    .action(() => runUninstall(ctx))

  cmd
    .command("list")
    .description("Show which agents have the Juspay MCP, and at which scope")
    .action(() => runList(ctx))
}

async function runSetupCommand(ctx: CliContext): Promise<void> {
  ctx.ui.banner()
  const result = await runSetup()
  if (result.configured.length > 0) {
    printSetupSummary(ctx, result)
  } else if (result.attempted > 0) {
    // User picked agents but every MCP write failed — make sure the failure is
    // loud (per-agent errors were info()-level above, easy to miss).
    ctx.ui.warn("No agents were configured — every write failed. See errors above.")
  }
  const partial = (result.attempted > 0 && result.configured.length === 0) || !result.skillsInstalled
  if (partial) process.exit(EXIT_PARTIAL)
}

// Print next steps: agents that still need a one-time manual auth. Already-authed
// / already-configured agents are not nagged.
function nextSteps(ctx: CliContext, result: SetupResult): void {
  process.stdout.write("\n  " + pc.bold("Next steps") + "\n")
  if (result.pending.length > 0) {
    process.stdout.write("  " + pc.dim("Authenticate the Juspay MCP in these (one-time):") + "\n")
    for (const a of result.pending) {
      process.stdout.write("    " + pc.dim(`• ${a.label}: `) + a.authHint + "\n")
    }
  } else {
    process.stdout.write("  " + pc.dim("All set — your agents are configured.") + "\n")
  }
  process.stdout.write("\n  " + pc.dim("Remove everything: ") + pc.cyan(`${CMD_PATH} uninstall`) + "\n\n")
}

function printSetupSummary(ctx: CliContext, result: SetupResult): void {
  // Skills row mirrors the actual install state, so the box title and any
  // mid-output warning never contradict each other.
  const skillsValue = result.skillsInstalled
    ? OUR_SKILL_NAMES.join(", ")
    : pc.red(`failed — ${result.skillsError ?? "see errors above"}`)
  const rows: { label: string; value: string }[] = [
    { label: "Agents", value: result.configured.map((a) => a.label).join(", ") },
    { label: "Scope", value: result.scope === "global" ? "Global (all projects)" : "This project" },
    { label: "MCPs", value: "docs-mcp-server, juspay-mcp" },
    { label: "Skills", value: skillsValue },
  ]
  const title = result.skillsInstalled ? "Setup complete" : "Setup partial — skills not installed"
  ctx.ui.summaryBox(title, rows)
  nextSteps(ctx, result)
}

async function runUninstall(ctx: CliContext): Promise<void> {
  ctx.ui.banner()
  const removedAgents: AgentDef[] = []
  for (const a of AGENTS) {
    let removedAny = false
    for (const scope of ["global", "project"] as const) {
      if (await removeMcp(a, scope).catch(() => false)) removedAny = true
    }
    if (removedAny) removedAgents.push(a)
  }
  if (removedAgents.length > 0) {
    ctx.ui.done(`Removed Juspay MCP from: ${removedAgents.map((a) => a.label).join(", ")}`)
  } else {
    ctx.ui.info("• No Juspay MCP entries found")
  }

  // Sign out of agents that cache OAuth creds (best-effort; clears their tokens).
  const loggedOut: string[] = []
  for (const a of removedAgents) {
    if (!a.logoutCmd) continue
    if (await runCmdQuiet(a.logoutCmd)) loggedOut.push(a.label)
  }
  if (loggedOut.length > 0) ctx.ui.done(`Signed out of: ${loggedOut.join(", ")}`)

  if (await removeSkills()) ctx.ui.done("Removed Juspay skills")
  else ctx.ui.info(`• Skills not auto-removed — remove ${OUR_SKILL_NAMES.join(", ")} from your agents if needed`)

  process.stdout.write("\n  " + pc.cyan("Juspay removed.") + "\n\n")
}

// Run a command silently, best-effort. Resolves true on exit 0, false otherwise.
function runCmdQuiet(cmd: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd
    // Windows: agent CLIs are .cmd shims; spawn needs a shell to launch them.
    const child = spawn(bin, args, { stdio: "ignore", shell: process.platform === "win32" })
    child.on("error", () => resolve(false))
    child.on("exit", (code) => resolve(code === 0))
  })
}

async function runList(ctx: CliContext): Promise<void> {
  ctx.ui.banner()
  const found: string[] = []
  for (const a of AGENTS) {
    const scopes: string[] = []
    for (const scope of ["global", "project"] as const) {
      if (await hasOurMcp(a, scope)) scopes.push(scope)
    }
    if (scopes.length > 0) found.push(`${a.label} (${scopes.join(", ")})`)
  }
  if (found.length === 0) {
    process.stdout.write("  " + pc.yellow("⚠ ") + `No agents configured. Run \`${CMD_PATH}\`.\n`)
    return
  }
  process.stdout.write("  " + pc.cyan("Juspay MCP is configured in:") + "\n")
  for (const label of found) process.stdout.write(`    • ${label}\n`)
}
