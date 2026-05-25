/**
 * Skills installation via the `skills` npm CLI (vercel-labs/skills).
 * Driven by OUR selection + scope: `skills add <pkg> [-g] -y -a <slug>` — global
 * (`-g`) or project (default), targeting exactly the agents the user picked. No
 * interactive picker (avoids missed agents + redraw glitches).
 */

import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { type AgentDef, type Scope } from "./agents.js"
import { SKILLS_PACKAGE } from "./servers.js"

// Skill directory name as deployed by `skills`.
export const OUR_SKILL = "integrate"

export async function addSkills(agents: AgentDef[], scope: Scope): Promise<void> {
  const slugs = [...new Set(agents.map((a) => a.skillsSlug).filter((s): s is string => Boolean(s)))]
  if (slugs.length === 0) return
  const base = scope === "global" ? os.homedir() : process.cwd()
  // The `skills` CLI only symlinks the skill into an agent's own dir if that dir
  // already exists — it will NOT create `.claude/` itself. So pre-create Claude's
  // skills dir; then the CLI wires it. (Codex etc. read the auto-created
  // `.agents/skills`, so they need no pre-creation.)
  if (agents.some((a) => a.id === "claude")) {
    await fs.mkdir(path.join(base, ".claude", "skills"), { recursive: true })
  }
  const scopeArgs = scope === "global" ? ["-g"] : []
  const agentArgs = slugs.flatMap((s) => ["-a", s])
  await runSkills(["add", SKILLS_PACKAGE, ...scopeArgs, "-y", ...agentArgs])
}

// Best-effort removal from BOTH scopes (uninstall). `skills remove` takes the
// skill NAME (integrate), not the package path. Returns true if either worked.
export async function removeSkills(): Promise<boolean> {
  const global = await runSkills(["remove", OUR_SKILL, "-g", "-y"]).then(() => true).catch(() => false)
  const project = await runSkills(["remove", OUR_SKILL, "-y"]).then(() => true).catch(() => false)
  return global || project
}

function runSkills(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["-y", "skills", ...args], { stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`skills ${args[0]} exited ${code}`))))
  })
}
