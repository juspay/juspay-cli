#!/usr/bin/env node
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import pc from "picocolors"

import { AGENTS, configFileFor, type AgentDef } from "./agents.js"
import { removeMcp } from "./mcp-writer.js"
import { DASHBOARD_MCP_NAME, PACKAGE_NAME } from "./servers.js"
import { runSetup, type SetupResult } from "./setup.js"
import { removeSkills } from "./skills-installer.js"
import { banner, done, info, summaryBox } from "./ui.js"

function showHelp(): void {
  banner()
  process.stdout.write(`  Usage: npx ${PACKAGE_NAME} [command]\n\n`)
  process.stdout.write(pc.dim("  Detects your AI agents, lets you pick which ones (and global or project),\n"))
  process.stdout.write(pc.dim("  then adds the Juspay MCP + skills. Each agent authenticates the MCP itself.\n\n"))
  process.stdout.write("  Commands:\n")
  process.stdout.write("    (no command)   Pick agents + scope, add the Juspay MCP + skills\n")
  process.stdout.write("    uninstall      Remove the Juspay MCP + skills (both scopes) and sign out\n")
  process.stdout.write("    list           Show which agents have the Juspay MCP, and at which scope\n")
  process.stdout.write("    help           Show this help\n\n")
}

// Print next steps: agents that still need a one-time manual auth (no CLI auth
// command, auth failed, or non-interactive). Already-authed / already-configured
// agents are not nagged.
function nextSteps(result: SetupResult): void {
  process.stdout.write("\n  " + pc.bold("Next steps") + "\n")
  if (result.pending.length > 0) {
    process.stdout.write("  " + pc.dim("Authenticate the Juspay MCP in these (one-time):") + "\n")
    for (const a of result.pending) {
      process.stdout.write("    " + pc.dim(`• ${a.label}: `) + a.authHint + "\n")
    }
  } else {
    process.stdout.write("  " + pc.dim("All set — your agents are configured.") + "\n")
  }
  process.stdout.write("\n  " + pc.dim("Remove everything: ") + pc.cyan(`npx ${PACKAGE_NAME} uninstall`) + "\n\n")
}

function printSetupSummary(result: SetupResult): void {
  const rows: { label: string; value: string }[] = [
    { label: "Agents", value: result.configured.map((a) => a.label).join(", ") },
    { label: "Scope", value: result.scope === "global" ? "Global (all projects)" : "This project" },
    { label: "MCPs", value: "docs-mcp-server, juspay-mcp" },
    { label: "Skills", value: "integrate" },
  ]
  summaryBox("Setup complete", rows)
  nextSteps(result)
}

async function runUninstall(): Promise<void> {
  const removedAgents: AgentDef[] = []
  for (const a of AGENTS) {
    let removedAny = false
    for (const scope of ["global", "project"] as const) {
      if (await removeMcp(a, scope).catch(() => false)) removedAny = true
    }
    if (removedAny) removedAgents.push(a)
  }
  if (removedAgents.length > 0) done(`Removed Juspay MCP from: ${removedAgents.map((a) => a.label).join(", ")}`)
  else info("• No Juspay MCP entries found")

  // Sign out of agents that cache OAuth creds (best-effort; clears their tokens).
  const loggedOut: string[] = []
  for (const a of removedAgents) {
    if (!a.logoutCmd) continue
    if (await runCmdQuiet(a.logoutCmd)) loggedOut.push(a.label)
  }
  if (loggedOut.length > 0) done(`Signed out of: ${loggedOut.join(", ")}`)

  if (await removeSkills()) done("Removed Juspay skills")
  else info("• Skills not auto-removed — remove the `integrate` skill from your agents if needed")

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

async function runList(): Promise<void> {
  const found: string[] = []
  for (const a of AGENTS) {
    const scopes: string[] = []
    for (const scope of ["global", "project"] as const) {
      try {
        const raw = await fs.readFile(configFileFor(a, scope), "utf8")
        if (raw.includes(DASHBOARD_MCP_NAME)) scopes.push(scope)
      } catch {
        // no config at this scope
      }
    }
    if (scopes.length > 0) found.push(`${a.label} (${scopes.join(", ")})`)
  }
  if (found.length === 0) {
    process.stdout.write("  " + pc.yellow("⚠ ") + `No agents configured. Run \`npx ${PACKAGE_NAME}\`.\n`)
    return
  }
  process.stdout.write("  " + pc.cyan("Juspay MCP is configured in:") + "\n")
  for (const label of found) process.stdout.write(`    • ${label}\n`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command === "help" || command === "--help" || command === "-h") {
    showHelp()
    return
  }

  banner()

  if (command === "uninstall") {
    await runUninstall()
    return
  }
  if (command === "list") {
    await runList()
    return
  }
  if (!command) {
    const result = await runSetup()
    if (result.configured.length > 0) printSetupSummary(result)
    return
  }

  throw new Error(`Unknown command '${command}'. Run \`npx ${PACKAGE_NAME} help\`.`)
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(pc.red("✗ ") + message + "\n")
  process.exit(1)
})
