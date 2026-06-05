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
import { OUR_SKILL_NAMES, SKILLS_PACKAGES } from "./servers.js"
import { spin } from "./ui.js"

// Re-export so callers (index.ts summary, etc.) can name the installed skills
// without reaching into servers.ts directly.
export { OUR_SKILL_NAMES } from "./servers.js"

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
  // Install each skill in turn under our own spinner — replaces the upstream
  // `skills` CLI's per-package ASCII banner + clack boxes (which used to print
  // ~30 lines × 3 skills). Atomic-fail: if any throws, the loop bubbles up
  // and setup.ts marks the wizard as partial. runSkills() captures the child's
  // output and dumps it only on failure, so debug detail is preserved.
  for (const pkg of SKILLS_PACKAGES) {
    const name = pkg.split("/").pop() ?? pkg
    const s = spin(`Installing ${name}...`)
    try {
      await runSkills(["add", pkg, ...scopeArgs, "-y", ...agentArgs])
      s.done(name)
    } catch (err) {
      s.fail(name)
      throw err
    }
  }
}

// Best-effort removal from BOTH scopes for every skill. `skills remove` takes
// the skill NAME, not the package path. Keep going past per-skill failures so
// uninstall cleans as much as it can. Returns true if anything was removed.
export async function removeSkills(): Promise<boolean> {
  let removedAny = false
  for (const skill of OUR_SKILL_NAMES) {
    const global = await runSkills(["remove", skill, "-g", "-y"]).then(() => true).catch(() => false)
    const project = await runSkills(["remove", skill, "-y"]).then(() => true).catch(() => false)
    if (global || project) removedAny = true
  }
  return removedAny
}

// When our CLI is itself launched via `npx`/`npm exec`, npm pre-populates the
// child env with `npm_*` vars + INIT_CWD describing the OUTER invocation. A
// nested `npx` then misreads them — `npm_config_prefix` leaks, `npm_command=exec`
// short-circuits, `npm_package_name=@juspay/cli` confuses package resolution.
// Strip them so the inner process sees a fresh-shell env.
function scrubbedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    if (k.startsWith("npm_")) delete env[k]
  }
  delete env.INIT_CWD
  return env
}

function runSkills(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // `npm exec --yes --package skills -- skills <args>` is the canonical,
    // unambiguous shape of `npx -y skills <args>`. Spelling out `--package`
    // and `--` keeps newer npm argv parsers happy and survives nesting under
    // an outer `npx`. Windows: npm is npm.cmd; spawn needs a shell for .cmd.
    //
    // stdio: stdin /dev/null (we pass -y, no prompts), stdout+stderr piped so
    // we can render our own concise progress upstream and only surface the
    // child's verbose output if something fails.
    const child = spawn(
      "npm",
      ["exec", "--yes", "--package", "skills", "--", "skills", ...args],
      { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", env: scrubbedEnv() },
    )
    const buf: Buffer[] = []
    child.stdout?.on("data", (d) => buf.push(d as Buffer))
    child.stderr?.on("data", (d) => buf.push(d as Buffer))
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) return resolve()
      // Failure path: dump the child's full output verbatim so the user
      // (and CI logs) still see exactly what the `skills` CLI would have said.
      const out = Buffer.concat(buf).toString("utf8")
      if (out) process.stderr.write(out.endsWith("\n") ? out : out + "\n")
      reject(new Error(`skills ${args[0]} exited ${code}`))
    })
  })
}
