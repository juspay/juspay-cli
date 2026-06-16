/**
 * Dashboard OAuth — DCR + PKCE + loopback. Ported from
 * juspay-skills/claude-cli/src/oauth.ts (the shipped, production flow), adjusted
 * for this CLI: imports the User-Agent from ./constants, client_name + error
 * hints reference `juspay checkout auth login`.
 *
 * This runs the same OAuth the Juspay dashboard MCP uses, so the token is a real
 * dashboard credential (reused for `whoami` and as the model gateway apiKey).
 */

import { spawn } from "node:child_process"
import crypto from "node:crypto"
import http from "node:http"

import pc from "picocolors"

import { USER_AGENT } from "./constants.js"

const REDIRECT_PORT = 33418
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

const SCOPES = [
  "analytics:read",
  "orders:read",
  "orders:write",
  "settings:read",
  "gateways:read",
  "reports:read",
  "users:read",
  "alerts:read",
].join(" ")

export type TokenSet = {
  issuer: string
  client_id: string
  client_secret: string
  access_token: string
  refresh_token: string
  expires_at: number
  scope: string
}

type AuthServerMeta = {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
}

type DcrResponse = {
  client_id: string
  client_secret: string
}

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
  token_type: string
}

export async function runOAuthFlow(issuer: string): Promise<TokenSet> {
  const meta = await discover(issuer)
  const dcr = await registerClient(meta.registration_endpoint)
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest())
  const state = base64url(crypto.randomBytes(16))

  const { code, returnedState } = await captureCode((codeUrl) => {
    const authUrl =
      meta.authorization_endpoint +
      "?" +
      new URLSearchParams({
        response_type: "code",
        client_id: dcr.client_id,
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString()
    process.stdout.write("  " + pc.dim(`If the browser doesn't open: ${authUrl}\n`))
    openBrowser(authUrl)
    return codeUrl
  })

  if (returnedState !== state) {
    throw new Error("OAuth state mismatch — aborting.")
  }

  const tok = await exchangeCode({
    tokenEndpoint: meta.token_endpoint,
    code,
    verifier,
    clientId: dcr.client_id,
    clientSecret: dcr.client_secret,
  })

  const issuedAt = Math.floor(Date.now() / 1000)
  return {
    issuer,
    client_id: dcr.client_id,
    client_secret: dcr.client_secret,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: issuedAt + tok.expires_in,
    scope: tok.scope ?? SCOPES,
  }
}

async function discover(issuer: string): Promise<AuthServerMeta> {
  const url = issuer.replace(/\/$/, "") + "/.well-known/oauth-authorization-server"
  const r = await fetchJson(url)
  if (!r.authorization_endpoint || !r.token_endpoint || !r.registration_endpoint) {
    throw new Error(`Auth server metadata at ${url} is missing required endpoints.`)
  }
  return r as AuthServerMeta
}

async function registerClient(registrationEndpoint: string): Promise<DcrResponse> {
  const body = {
    client_name: "juspay-cli",
    redirect_uris: [REDIRECT_URI],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: SCOPES,
  }
  const r = await fetchJson(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.client_id || !r.client_secret) {
    throw new Error("Dynamic client registration did not return client_id/client_secret.")
  }
  return r as DcrResponse
}

async function exchangeCode(params: {
  tokenEndpoint: string
  code: string
  verifier: string
  clientId: string
  clientSecret: string
}): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: REDIRECT_URI,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code_verifier: params.verifier,
  })
  const r = await fetchJson(params.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  })
  if (!r.access_token || !r.refresh_token || typeof r.expires_in !== "number") {
    throw new Error("Token endpoint did not return access_token/refresh_token/expires_in.")
  }
  return r as TokenResponse
}

function captureCode(
  startBrowser: (codeUrl: string) => void,
): Promise<{ code: string; returnedState: string }> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      server.close()
    }

    const server = http.createServer((req, res) => {
      if (!req.url) return
      const u = new URL(req.url, REDIRECT_URI)
      if (u.pathname !== "/callback") {
        res.writeHead(404)
        res.end()
        return
      }
      const code = u.searchParams.get("code")
      const returnedState = u.searchParams.get("state") ?? ""
      const error = u.searchParams.get("error")
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      if (error) {
        res.end(`<h2>Sign-in failed: ${escapeHtml(error)}</h2><p>You can close this tab.</p>`)
        cleanup()
        reject(new Error(`OAuth error from authorization server: ${error}`))
        return
      }
      if (!code) {
        res.end("<h2>Missing code.</h2><p>You can close this tab.</p>")
        cleanup()
        reject(new Error("Authorization server callback was missing the code parameter."))
        return
      }
      res.end(
        "<h2>Signed in successfully.</h2><p>You can close this tab and return to the terminal.</p>",
      )
      cleanup()
      resolve({ code, returnedState })
    })
    server.on("error", (err: NodeJS.ErrnoException) => {
      cleanup()
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${REDIRECT_PORT} is already in use. Close whatever is using it and re-run \`juspay checkout auth login\`.`,
          ),
        )
      } else {
        reject(err)
      }
    })
    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      startBrowser(REDIRECT_URI)
      timer = setTimeout(() => {
        cleanup()
        reject(
          new Error(
            `Sign-in timed out after ${OAUTH_TIMEOUT_MS / 60000} minutes. Re-run \`juspay checkout auth login\` to retry.`,
          ),
        )
      }, OAUTH_TIMEOUT_MS)
    })
  })
}

function openBrowser(url: string): void {
  // Open the URL with NO shell, passing it as a single argument so query-string
  // characters survive intact. On Windows we must NOT use the cmd.exe `start`
  // builtin: cmd splits the URL at `&` (command separator) and mangles `%xx`
  // percent-encoding, so the browser would get a truncated authorize URL with no
  // redirect_uri (→ "redirect_uri is required"). rundll32 receives the URL as one
  // verbatim argv entry and hands it to the default browser unmodified.
  let cmd: string
  let args: string[]
  if (process.platform === "darwin") {
    cmd = "open"
    args = [url]
  } else if (process.platform === "win32") {
    cmd = "rundll32"
    args = ["url.dll,FileProtocolHandler", url]
  } else {
    cmd = "xdg-open"
    args = [url]
  }
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref()
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(init?.headers ?? {}),
      },
    })
  } catch (err) {
    // Node's fetch throws `fetch failed` with the real reason buried in `cause`.
    // Surface enough detail to diagnose proxy / DNS / TLS / refused issues.
    const cause = (err as { cause?: { code?: string; message?: string } }).cause
    const detail = cause?.code ? `${cause.code}${cause.message ? ` — ${cause.message}` : ""}` : (err as Error).message
    throw new Error(`Could not reach ${url}\n  ${detail}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status} from ${url}${text ? `: ${text.slice(0, 300)}` : ""}`)
  }
  return res.json()
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  )
}
