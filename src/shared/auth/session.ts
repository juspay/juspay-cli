/**
 * Session orchestration — the `acquireTokens()` / merchant-details logic ported
 * from juspay-skills/claude-cli/src/init.ts, plus the `ensureAuth()` gate the
 * wrapper plan (§5.1) calls first.
 *
 * Validity & refresh match the shipped behaviour exactly (plan §6.4): a token is
 * usable only if it expires >24h out; otherwise we re-run the full browser flow.
 * There is no silent refresh-token exchange yet (the refresh_token is stored but
 * unused) — that's a deliberate v1 port-as-is, not an oversight.
 */

import { JUSPAY_MCP_ENDPOINT, JUSPAY_MCP_ISSUER } from "./constants.js"
import { callMcpTool } from "./mcp-call.js"
import { runOAuthFlow } from "./oauth.js"
import {
  clearStore,
  readConfig,
  readOAuth,
  writeConfig,
  writeOAuth,
  type Config,
  type Environment,
  type OAuthState,
} from "./store.js"
import { done, spin, step } from "../../core/ui.js"

export type Identity = {
  merchant_id: string
  environment: Environment
  expires_at: number
}

// The auth gate: return a valid token + identity, running the browser flow only
// if there isn't already a token valid >24h out. Everything downstream (provision,
// launch) gets its bearer from here.
export async function ensureAuth(opts: { env?: Environment; force?: boolean } = {}): Promise<{
  tokens: OAuthState
  identity: Identity
}> {
  const { tokens, fresh } = await acquireTokens({ force: opts.force ?? false })
  const expiresOn = new Date(tokens.expires_at * 1000).toDateString()
  done(`Signed in · session valid until ${expiresOn}`)

  // Reuse cached merchant metadata ONLY when we reused an existing token. A freshly
  // acquired token (forced re-auth, or re-auth after expiry) may belong to a
  // different merchant, so the on-disk config.json could be stale — re-resolve.
  if (!fresh) {
    const cached = await readConfig().catch(() => null)
    if (cached) {
      return { tokens, identity: toIdentity(cached, tokens) }
    }
  }

  const config = await resolveMerchant(tokens.access_token, opts.env ?? "production")
  await writeConfig(config)
  return { tokens, identity: toIdentity(config, tokens) }
}

// Return a usable access token, or null if not signed in / expired. Does NOT
// trigger the browser flow — callers that want that use ensureAuth().
export async function getToken(): Promise<string | null> {
  const existing = await readOAuth().catch(() => null)
  if (existing && isStillValid(existing)) return existing.access_token
  return null
}

// `juspay checkout auth whoami` — show the current identity, or null if signed out.
export async function whoami(): Promise<Identity | null> {
  const tokens = await readOAuth().catch(() => null)
  if (!tokens || !isStillValid(tokens)) return null
  const config = await readConfig().catch(() => null)
  if (config) return toIdentity(config, tokens)

  // Token but no cached merchant metadata — fetch it once and cache.
  const resolved = await resolveMerchant(tokens.access_token, "production")
  await writeConfig(resolved)
  return toIdentity(resolved, tokens)
}

export type LogoutResult = { revoked: boolean }

// `juspay checkout auth logout` — drop local creds and best-effort server-side
// revoke. Returns whether the revoke call succeeded so the caller can report it.
export async function logout(): Promise<LogoutResult> {
  const tokens = await readOAuth().catch(() => null)
  await clearStore()
  if (!tokens) return { revoked: false }
  return { revoked: await revokeQuietly(tokens) }
}

// Returns the usable token plus whether it was freshly acquired (so the caller
// knows the cached merchant metadata can't be trusted).
async function acquireTokens(opts: { force: boolean }): Promise<{ tokens: OAuthState; fresh: boolean }> {
  const previous = await readOAuth().catch(() => null)
  if (!opts.force && previous && isStillValid(previous)) {
    return { tokens: previous, fresh: false }
  }

  step("Opening browser for sign-in...")
  const fresh = await runOAuthFlow(JUSPAY_MCP_ISSUER)
  await writeOAuth(fresh)
  // We just overwrote an existing credential on disk — revoke the OLD token
  // server-side (best-effort) so a forced/expired re-auth doesn't leave the
  // previous session dangling as a still-valid credential.
  if (previous) await revokeQuietly(previous)
  return { tokens: fresh, fresh: true }
}

// Treat tokens expiring in <24h as already expired — avoids handing the merchant
// a session that's about to die mid-integration.
function isStillValid(state: OAuthState): boolean {
  const skewSeconds = 24 * 60 * 60
  return state.expires_at > Math.floor(Date.now() / 1000) + skewSeconds
}

function toIdentity(config: Config, tokens: OAuthState): Identity {
  return { merchant_id: config.merchant_id, environment: config.environment, expires_at: tokens.expires_at }
}

async function resolveMerchant(bearer: string, env: Environment): Promise<Config> {
  const s = spin("Fetching merchant details...")
  let merchantId: string
  try {
    merchantId = await fetchMerchantId(bearer)
  } catch (err) {
    s.fail("Could not fetch merchant details")
    throw err
  }
  s.done(`Merchant: ${merchantId}`)
  return { merchant_id: merchantId, client_id: merchantId, environment: env }
}

async function fetchMerchantId(bearer: string): Promise<string> {
  const result = await callMcpTool(JUSPAY_MCP_ENDPOINT, bearer, "juspay_get_merchant_details", {})
  const merchantId = extractMerchantId(result)
  if (!merchantId) {
    throw new Error(
      "Could not find merchantId in juspay_get_merchant_details response. " +
        "Report this issue if it persists.",
    )
  }
  return merchantId
}

function extractMerchantId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined
  const r = result as Record<string, unknown>

  if (typeof r.merchantId === "string") return r.merchantId

  if (r.structuredContent && typeof r.structuredContent === "object") {
    const sc = r.structuredContent as Record<string, unknown>
    if (typeof sc.merchantId === "string") return sc.merchantId
  }

  if (Array.isArray(r.content)) {
    for (const item of r.content) {
      if (item && typeof item === "object") {
        const it = item as Record<string, unknown>
        if (it.type === "text" && typeof it.text === "string") {
          try {
            const parsed = JSON.parse(it.text) as Record<string, unknown>
            if (typeof parsed.merchantId === "string") return parsed.merchantId
          } catch {
            // not JSON; ignore
          }
        }
      }
    }
  }

  return undefined
}

// Best-effort server-side revoke (§13). The dashboard issuer advertises a
// revocation_endpoint; if it's reachable we revoke, but logout never fails on it
// — the local creds are already gone by the time we get here. Returns true if the
// revoke endpoint accepted our request.
//
// We revoke the refresh_token first: per RFC 7009 revoking a refresh token kills
// the whole grant (and the access tokens issued under it), so it's the complete
// teardown. We also revoke the access_token explicitly as belt-and-suspenders.
async function revokeQuietly(tokens: OAuthState): Promise<boolean> {
  try {
    const meta = await fetch(
      tokens.issuer.replace(/\/$/, "") + "/.well-known/oauth-authorization-server",
      { headers: { Accept: "application/json" } },
    ).then((r) => (r.ok ? (r.json() as Promise<{ revocation_endpoint?: string }>) : null))
    if (!meta?.revocation_endpoint) return false

    const revoke = (token: string, hint: "refresh_token" | "access_token") =>
      fetch(meta.revocation_endpoint!, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token,
          token_type_hint: hint,
          client_id: tokens.client_id,
          client_secret: tokens.client_secret,
        }).toString(),
      }).then((r) => r.ok)

    // RFC 7009 servers return 200 even for an already-invalid token, so an ok
    // response on the refresh-token revoke is our success signal.
    const refreshOk = await revoke(tokens.refresh_token, "refresh_token")
    await revoke(tokens.access_token, "access_token").catch(() => false)
    return refreshOk
  } catch {
    // best-effort; logout already cleared local state
    return false
  }
}
