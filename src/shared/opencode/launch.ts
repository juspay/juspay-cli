/**
 * Launch OpenCode with a provisioned session (wrapper plan §5.3 / §9).
 *
 * Spawns an already-resolved opencode binary (the caller runs `ensureOpencode()`
 * first, so any install happens before the launch is announced) with
 * `stdio: "inherit"` so the user lands *inside* the OpenCode TUI. The provisioned
 * inline config + token are passed via the child `env` only:
 *   - OPENCODE_CONFIG_CONTENT — the full session config (highest precedence)
 *   - JUSPAY_TOKEN            — the bearer the config's {env:...} refs resolve to
 *
 * cwd is the user's current project so the agent operates on their repo. On exit
 * we propagate OpenCode's exit code; control returns cleanly to the shell with
 * nothing persisted to the user's own OpenCode config.
 */

import { spawn } from "node:child_process"
import path from "node:path"

import type { OpencodeInfo } from "./detect.js"
import type { Provisioned } from "./provision.js"

// Spawn an already-resolved opencode binary. Callers ensure it exists first (so
// any "Installing…" output happens before they announce the launch).
export function launchOpencode(info: OpencodeInfo, provisioned: Provisioned): Promise<never> {
  return run(info, provisioned)
}

function run(info: OpencodeInfo, provisioned: Provisioned): Promise<never> {
  return new Promise<never>(() => {
    // Ensure the binary's own dir is on PATH for the child — when opencode was
    // just auto-installed into ~/.opencode/bin, the user's shell rc hasn't been
    // reloaded yet, but opencode may still need to resolve itself.
    const binDir = path.dirname(info.bin)
    const PATH = [binDir, process.env.PATH].filter(Boolean).join(path.delimiter)

    const child = spawn(info.bin, [], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH,
        OPENCODE_CONFIG_CONTENT: provisioned.configContent,
        ...provisioned.env,
      },
    })
    child.on("error", (err) => {
      process.stderr.write(`Failed to launch OpenCode: ${err.message}\n`)
      process.exit(1)
    })
    child.on("exit", (code, signal) => {
      if (signal) {
        // Re-raise the signal so the parent's exit status reflects it.
        process.kill(process.pid, signal)
        return
      }
      process.exit(code ?? 0)
    })
  })
}
