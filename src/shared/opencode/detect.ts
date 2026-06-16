/**
 * Find — and if necessary install — the `opencode` binary (wrapper plan §9.1).
 *
 * Install strategy: OpenCode's OFFICIAL installer (https://opencode.ai/install),
 * which downloads the prebuilt stable binary directly into ~/.opencode/bin. We
 * deliberately do NOT go through `npm install -g opencode-ai`:
 *   - opencode-ai's packument is large + snapshot-tag-heavy; a fresh registry
 *     fetch occasionally returns an empty 200, surfacing as a bogus ETARGET on a
 *     version that genuinely exists (observed in the field).
 *   - npm's per-machine allow-scripts policy blocks opencode's postinstall.
 * The official installer sidesteps both: a single signed binary download, the
 * path OpenCode itself recommends and tests.
 *
 * Detection checks the user's PATH first (respects any pre-existing install,
 * including newer versions — we never downgrade), then the installer's own
 * ~/.opencode/bin so a just-installed binary is found within the same process,
 * before any shell-rc PATH change has taken effect.
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

  if (process.platform === "win32") {
    // The official installer is a bash script; on Windows defer to a manual install.
    throw new Error(manualHint("auto-install isn't supported on Windows"))
  }

  const s = spin(`Installing OpenCode (${PINNED_OPENCODE_VERSION})...`)
  try {
    await runOfficialInstaller(PINNED_OPENCODE_VERSION)
    s.done(`OpenCode installed (${PINNED_OPENCODE_VERSION})`)
  } catch (err) {
    s.fail("OpenCode install failed")
    throw new Error(manualHint((err as Error).message))
  }

  const info = await detectOpencode()
  if (!info) {
    throw new Error(
      `OpenCode was installed to ${OPENCODE_HOME_BIN} but couldn't be located. ` +
        "Open a new shell (so PATH picks it up) and re-run `juspay checkout agent`.",
    )
  }
  // The installer adds ~/.opencode/bin to PATH via the shell rc, which only
  // applies to NEW shells. We launch fine (we resolve the binary directly), but
  // bare `opencode` won't work in THIS shell until it's reloaded — flag that so
  // users don't think the install failed.
  const rc = process.env.SHELL?.includes("zsh") ? "~/.zshrc" : "~/.bashrc"
  step(`To run \`opencode\` directly: open a new terminal (or \`source ${rc}\`).`)
  return info
}

// Remove the OpenCode install WE created (~/.opencode, from the official
// installer). A brew/npm opencode lives elsewhere and is intentionally left
// alone. Returns true if anything was removed. (The shell-rc PATH line the
// installer added is left as a harmless stale entry — we don't edit user rc.)
export async function removeOpencode(): Promise<boolean> {
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
    const child = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"] })
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
