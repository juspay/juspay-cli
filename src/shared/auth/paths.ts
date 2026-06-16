/**
 * Where Juspay's own credentials live — XDG-aware, NOT the shell rc (see the
 * wrapper plan §6.2). Ported from juspay-skills/claude-cli/src/paths.ts, trimmed
 * to just the auth locations this layer owns.
 *
 *   ~/.config/juspay/oauth.json   — the OAuth token set (0600, in a 0700 dir)
 *   ~/.config/juspay/config.json  — merchant metadata (0600)
 *
 * `XDG_CONFIG_HOME` is honoured so this matches gh / aws / gcloud / stripe.
 */

import os from "node:os"
import path from "node:path"

function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
}

export const juspayConfigDir = path.join(xdgConfigHome(), "juspay")
export const juspayConfigPath = path.join(juspayConfigDir, "config.json")
export const juspayOauthPath = path.join(juspayConfigDir, "oauth.json")
