/**
 * On-disk credential store under ~/.config/juspay/ — ports oauth-config.ts +
 * config.ts from juspay-skills/claude-cli/src into one module, with the
 * carry-over hardening the wrapper plan calls for (§6.2 / §13):
 *   - the directory is created 0700 (the original left it at the umask default),
 *   - files are written atomically (tmp + rename, as in agent-setup/mcp-writer.ts)
 *     at mode 0600,
 *   - on read we refuse to proceed if perms are unexpectedly world/group-readable
 *     rather than silently trusting an over-open token file.
 *
 * Two files, matching the shipped shapes:
 *   oauth.json   — the TokenSet (issuer, client creds, tokens, expiry, scope)
 *   config.json  — merchant metadata (merchant_id, client_id, environment)
 */

import fs from "node:fs/promises"
import path from "node:path"

import { juspayConfigDir, juspayConfigPath, juspayOauthPath } from "./paths.js"
import type { TokenSet } from "./oauth.js"

// The stored OAuth shape is exactly the TokenSet returned by the flow.
export type OAuthState = TokenSet

export type Environment = "sandbox" | "production"

export type Config = {
  merchant_id: string
  client_id: string
  environment: Environment
}

export async function readOAuth(): Promise<OAuthState | null> {
  const raw = await readSecure(juspayOauthPath)
  if (raw === null) return null
  const parsed = JSON.parse(raw) as unknown
  if (!isOAuthState(parsed)) {
    throw new Error(
      `Invalid OAuth state at ${juspayOauthPath}. Re-run \`juspay checkout auth login\` to recreate.`,
    )
  }
  return parsed
}

export async function writeOAuth(state: OAuthState): Promise<void> {
  await ensureDir()
  await writeAtomic(juspayOauthPath, JSON.stringify(state, null, 2) + "\n")
}

export async function readConfig(): Promise<Config | null> {
  const raw = await readSecure(juspayConfigPath)
  if (raw === null) return null
  const parsed = JSON.parse(raw) as unknown
  if (!isConfig(parsed)) {
    throw new Error(
      `Invalid config at ${juspayConfigPath}. Expected { merchant_id, client_id, environment }. ` +
        `Re-run \`juspay checkout auth login\` to recreate.`,
    )
  }
  return parsed
}

export async function writeConfig(config: Config): Promise<void> {
  await ensureDir()
  await writeAtomic(juspayConfigPath, JSON.stringify(config, null, 2) + "\n")
}

// Logout: remove the whole credential dir (both files). Best-effort — absent
// files are not an error.
export async function clearStore(): Promise<void> {
  await fs.rm(juspayConfigDir, { recursive: true, force: true })
}

// Create the config dir at 0700 (owner-only). mkdir's `mode` is masked by the
// umask, so chmod afterwards to guarantee the bits regardless of umask.
async function ensureDir(): Promise<void> {
  await fs.mkdir(juspayConfigDir, { recursive: true, mode: 0o700 })
  if (process.platform !== "win32") {
    await fs.chmod(juspayConfigDir, 0o700).catch(() => {})
  }
}

// Read a credential file, or null if absent. Refuses (throws) if the file's
// perms are broader than owner-only — we don't silently weaken (§13).
async function readSecure(file: string): Promise<string | null> {
  let stat: import("node:fs").Stats
  try {
    stat = await fs.stat(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error(
      `${file} is readable by group/others (mode ${(stat.mode & 0o777).toString(8)}). ` +
        `Fix with \`chmod 600 ${file}\` (and \`chmod 700 ${juspayConfigDir}\`), then re-run.`,
    )
  }
  return fs.readFile(file, "utf8")
}

// Atomic write at 0600: tmp file + rename, so a crash or concurrent reader never
// sees a partial token file. (Same convention as agent-setup/mcp-writer.ts.)
async function writeAtomic(file: string, contents: string): Promise<void> {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`
  await fs.writeFile(tmp, contents, { mode: 0o600 })
  if (process.platform !== "win32") {
    await fs.chmod(tmp, 0o600).catch(() => {})
  }
  await fs.rename(tmp, file)
}

function isOAuthState(value: unknown): value is OAuthState {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    typeof v.issuer === "string" &&
    typeof v.client_id === "string" &&
    typeof v.client_secret === "string" &&
    typeof v.access_token === "string" &&
    typeof v.refresh_token === "string" &&
    typeof v.expires_at === "number" &&
    typeof v.scope === "string"
  )
}

function isConfig(value: unknown): value is Config {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    typeof v.merchant_id === "string" &&
    v.merchant_id.length > 0 &&
    typeof v.client_id === "string" &&
    v.client_id.length > 0 &&
    (v.environment === "sandbox" || v.environment === "production")
  )
}
