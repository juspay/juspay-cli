/**
 * Find — and if necessary install — the `opencode` binary (wrapper plan §9.1).
 *
 * Install strategy is per-platform:
 *   - macOS / Linux: OpenCode's OFFICIAL installer (https://opencode.ai/install),
 *     which downloads the prebuilt stable binary into ~/.opencode/bin. We avoid
 *     `npm install -g opencode-ai` here because its large, snapshot-tag-heavy
 *     packument can return an empty 200 (a bogus ETARGET on a version that really
 *     exists, seen in the field) and some npm allow-scripts policies block its
 *     postinstall.
 *   - Windows: that installer is a bash script with no cmd/PowerShell equivalent,
 *     so we use npm — the opencode-ai package ships the Windows binary and drops a
 *     PATH shim (no ~/.opencode dir is created). The npm caveats above are a
 *     macOS/registry quirk, not a Windows one.
 *
 * Detection checks PATH first (respects a pre-existing/newer install — we never
 * downgrade), then the official installer's ~/.opencode/bin so a just-installed
 * unix binary resolves within the same process, before any shell-rc PATH change.
 */

import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import which from "which"

import { spin, step } from "../../core/ui.js"

// Pinned stable OpenCode — the version we validate the provisioning path against
// (plan §12). The official installer fetches exactly this build. Bump
// deliberately after re-validating against a newer release.
export const PINNED_OPENCODE_VERSION = "1.17.4"

// Where the official installer places things: ~/.opencode (home) → bin/opencode.
const OPENCODE_HOME = path.join(os.homedir(), ".opencode")
const OPENCODE_HOME_BIN = path.join(OPENCODE_HOME, "bin")
const OPENCODE_BINARY = path.join(OPENCODE_HOME_BIN, "opencode")

export type OpencodeInfo = {
  bin: string
  version: string | null
}

// Cross-platform command for spawning the opencode binary. On Windows the install
// is an npm `.cmd` shim that Node won't spawn without a shell; quote the path (it
// may contain spaces) and run under a shell. Elsewhere it's a real binary spawned
// directly. Used by the version probe here and by the launcher.
export function binCommand(bin: string): { command: string; shell: boolean } {
  return process.platform === "win32"
    ? { command: `"${bin}"`, shell: true }
    : { command: bin, shell: false }
}

// Locate opencode: PATH first, then the installer's home-bin. null if neither.
export async function detectOpencode(): Promise<OpencodeInfo | null> {
  try {
    const bin = await which("opencode")
    return { bin, version: await readVersion(bin) }
  } catch {
    // not on PATH — fall through
  }
  if (await isExecutable(OPENCODE_BINARY)) {
    return { bin: OPENCODE_BINARY, version: await readVersion(OPENCODE_BINARY) }
  }
  return null
}

// Locate opencode, installing the pinned stable release if it's missing.
export async function ensureOpencode(): Promise<OpencodeInfo> {
  const existing = await detectOpencode()
  if (existing) return existing

  const s = spin(`Installing OpenCode (${PINNED_OPENCODE_VERSION})...`)
  try {
    // macOS/Linux: OpenCode's official installer (prebuilt binary, no npm).
    // Windows: that installer is a bash script with no cmd/PowerShell equivalent,
    // so use npm — the opencode-ai package ships the Windows binary and npm puts
    // it on PATH.
    if (process.platform === "win32") {
      await installViaNpm(PINNED_OPENCODE_VERSION)
    } else {
      await runOfficialInstaller(PINNED_OPENCODE_VERSION)
    }
    s.done(`OpenCode installed (${PINNED_OPENCODE_VERSION})`)
  } catch (err) {
    s.fail("OpenCode install failed")
    throw new Error(manualHint((err as Error).message))
  }

  const info = await detectOpencode()
  if (!info) {
    throw new Error(
      "OpenCode was installed but couldn't be located on PATH. " +
        "Open a new terminal and re-run `juspay checkout agent`.",
    )
  }
  // The unix official installer adds ~/.opencode/bin to PATH via the shell rc,
  // which only applies to NEW shells (we launch fine — we resolve the binary
  // directly). On Windows npm already puts opencode on PATH, so no hint is needed.
  if (process.platform !== "win32") {
    const rc = process.env.SHELL?.includes("zsh") ? "~/.zshrc" : "~/.bashrc"
    step(`To run \`opencode\` directly: open a new terminal (or \`source ${rc}\`).`)
  }
  return info
}

// Remove the OpenCode install we created, mirroring how we installed it:
//   - Windows: `npm uninstall -g opencode-ai` (only if opencode is present — npm
//     uninstall of a missing package is a silent no-op that would misreport).
//   - macOS/Linux: remove the official installer's ~/.opencode dir.
// Returns true if anything was removed. (On unix, a brew/npm opencode lives
// elsewhere and is left alone; the installer's shell-rc PATH line is a harmless
// stale entry we don't edit.)
export async function removeOpencode(): Promise<boolean> {
  if (process.platform === "win32") {
    if (!(await detectOpencode())) return false
    await runNpm(["uninstall", "-g", "opencode-ai"]).catch(() => {})
    return true
  }
  try {
    await fs.access(OPENCODE_HOME)
  } catch {
    return false
  }
  await fs.rm(OPENCODE_HOME, { recursive: true, force: true })
  return true
}

// Run OpenCode's official installer with the version pinned via its VERSION env.
// stdout/stderr are captured and only dumped on failure (same convention as
// agent-setup/skills-installer's runSkills()).
function runOfficialInstaller(version: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // `curl -fsSL … | bash`: curl fails loudly on HTTP errors (-f) and the script
    // runs under `set -euo pipefail`, so any download/extract problem is a non-zero
    // exit we can surface. `set -o pipefail` here makes a curl failure fail the pipe.
    const child = spawn(
      "bash",
      ["-c", "set -o pipefail; curl -fsSL https://opencode.ai/install | bash"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, VERSION: version },
      },
    )
    const buf: Buffer[] = []
    child.stdout?.on("data", (d) => buf.push(d as Buffer))
    child.stderr?.on("data", (d) => buf.push(d as Buffer))
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) return resolve()
      const out = Buffer.concat(buf).toString("utf8")
      if (out) process.stderr.write(out.endsWith("\n") ? out : out + "\n")
      reject(new Error(`installer exited ${code}`))
    })
  })
}

// Windows install path: `npm install -g opencode-ai@<pinned>` (npm ships the
// Windows binary + a PATH shim).
function installViaNpm(version: string): Promise<void> {
  return runNpm(["install", "-g", "--no-fund", "--no-audit", `opencode-ai@${version}`])
}

// Spawn npm with output captured (dumped only on failure). shell:true because npm
// is `npm.cmd` on Windows; scrubbedEnv strips inherited npm_* vars so a nested npm
// (e.g. when we're launched under `npx juspay`) isn't confused.
function runNpm(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], shell: true, env: scrubbedEnv() })
    const buf: Buffer[] = []
    child.stdout?.on("data", (d) => buf.push(d as Buffer))
    child.stderr?.on("data", (d) => buf.push(d as Buffer))
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) return resolve()
      const out = Buffer.concat(buf).toString("utf8")
      if (out) process.stderr.write(out.endsWith("\n") ? out : out + "\n")
      reject(new Error(`npm ${args[0]} exited ${code}`))
    })
  })
}

// Strip the npm_* / INIT_CWD vars npm injects into child envs, so a nested npm
// isn't confused when we're launched under `npx`. (Mirrors the same helper in
// agent-setup/skills-installer.ts.)
function scrubbedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.startsWith("npm_")) delete env[k]
  delete env.INIT_CWD
  return env
}

function manualHint(reason: string): string {
  return (
    `Could not auto-install OpenCode: ${reason}\n` +
    "  Install it manually, then re-run `juspay checkout agent`:\n\n" +
    "    curl -fsSL https://opencode.ai/install | bash\n" +
    "    brew install sst/tap/opencode\n" +
    `    npm install -g opencode-ai@${PINNED_OPENCODE_VERSION}`
  )
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await fs.access(p, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function readVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const { command, shell } = binCommand(bin)
    const child = spawn(command, ["--version"], { stdio: ["ignore", "pipe", "ignore"], shell })
    const buf: Buffer[] = []
    child.stdout?.on("data", (d) => buf.push(d as Buffer))
    child.on("error", () => resolve(null))
    child.on("exit", () => {
      const out = Buffer.concat(buf).toString("utf8").trim()
      // `opencode --version` prints just the semver (e.g. "1.17.4"); take the
      // first token defensively in case a banner is ever prepended.
      resolve(out ? (out.split(/\s+/)[0] ?? out) : null)
    })
  })
}
