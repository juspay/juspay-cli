/**
 * `juspay hdfc-sg agent-setup` — and its `uninstall` / `list` sub-commands.
 *
 * Installs the HDFC SmartGateway integration skill into the user's own AI coding
 * agents. Skills only (no MCP). The flow lives in features/agent-setup/setup.ts;
 * this module is the command-tree wiring + the human-facing output.
 */

import type { Command } from "commander"
import pc from "picocolors"

import type { CliContext } from "../../../cli/types.js"
import { EXIT_PARTIAL } from "../../../core/errors.js"
import { removeSkills, skillsPresent } from "../../../shared/skills/index.js"
import { runSetup, type SetupResult } from "../features/agent-setup/setup.js"
import { HDFC_SG_SKILL_NAMES } from "../skills.js"

// The full command path, used in next-step hints so the printed commands match
// what the user actually types.
const CMD_PATH = "juspay hdfc-sg agent-setup"
const BANNER = "HDFC SmartGateway for AI agents"

export function registerAgentSetup(parent: Command, ctx: CliContext): void {
  const cmd = parent
    .command("agent-setup")
    .description("Add the HDFC SmartGateway integration skill to your AI coding agents")
    .action(() => runSetupCommand(ctx))

  cmd
    .command("uninstall")
    .description("Remove the HDFC SmartGateway skill (global + project)")
    .action(() => runUninstall(ctx))

  cmd
    .command("list")
    .description("Show where the HDFC SmartGateway skill is installed")
    .action(() => runList(ctx))
}

async function runSetupCommand(ctx: CliContext): Promise<void> {
  ctx.ui.banner(BANNER)
  const result = await runSetup()
  if (result.configured.length > 0) printSetupSummary(ctx, result)
  if (!result.skillsInstalled) process.exit(EXIT_PARTIAL)
}

function printSetupSummary(ctx: CliContext, result: SetupResult): void {
  const skillValue = result.skillsInstalled
    ? HDFC_SG_SKILL_NAMES.join(", ")
    : pc.red(`failed — ${result.skillsError ?? "see errors above"}`)
  ctx.ui.summaryBox(result.skillsInstalled ? "Setup complete" : "Setup failed — skill not installed", [
    { label: "Agents", value: result.configured.map((a) => a.label).join(", ") },
    { label: "Scope", value: result.scope === "global" ? "Global (all projects)" : "This project" },
    { label: "Skill", value: skillValue },
  ])
  if (!result.skillsInstalled) return
  process.stdout.write("\n  " + pc.bold("Next steps") + "\n")
  process.stdout.write(
    "  Open your project in your agent and ask it to " + pc.cyan("integrate HDFC SmartGateway payments") + ".\n",
  )
  process.stdout.write("\n  " + pc.dim("Remove: ") + pc.cyan(`${CMD_PATH} uninstall`) + "\n\n")
}

async function runUninstall(ctx: CliContext): Promise<void> {
  ctx.ui.banner(BANNER)
  if (await removeSkills(HDFC_SG_SKILL_NAMES)) ctx.ui.done(`Removed skill: ${HDFC_SG_SKILL_NAMES.join(", ")}`)
  else ctx.ui.info("• No HDFC SmartGateway skill found to remove")
  process.stdout.write("\n")
}

async function runList(ctx: CliContext): Promise<void> {
  ctx.ui.banner(BANNER)
  const scopes: string[] = []
  if (await skillsPresent(HDFC_SG_SKILL_NAMES, "global")) scopes.push("Global (all projects)")
  if (await skillsPresent(HDFC_SG_SKILL_NAMES, "project")) scopes.push("This project")
  if (scopes.length === 0) {
    process.stdout.write("  " + pc.yellow("⚠ ") + `HDFC SmartGateway skill not installed. Run \`${CMD_PATH}\`.\n`)
    return
  }
  process.stdout.write("  " + pc.cyan("HDFC SmartGateway skill is installed:") + "\n")
  for (const s of scopes) process.stdout.write(`    • ${s}\n`)
}
