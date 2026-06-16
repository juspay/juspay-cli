/**
 * Public surface of the shared auth layer. Products import from here (opt-in —
 * auth is never injected via CliContext): the agent command calls `ensureAuth()`
 * as its gate; the `checkout auth login|logout|whoami` wrappers map 1:1 onto
 * `ensureAuth` / `logout` / `whoami`.
 */

export { ensureAuth, getToken, logout, whoami, type Identity } from "./session.js"
export type { Config, Environment, OAuthState } from "./store.js"
export type { TokenSet } from "./oauth.js"
