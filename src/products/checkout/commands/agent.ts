/**
 * `juspay checkout agent` — drop the user straight into a ready-to-go OpenCode
 * session that's already authenticated with Juspay and wired with the jp-* skills,
 * the docs + dashboard MCP servers, and the Juspay agent + model (wrapper plan).
 *
 *   ensureAuth() → install jp-* skills (global, once) → provision inline config →
 *   launch OpenCode (token via env, nothing persisted to the user's setup)
 *
 * Plus the `auth login | logout | whoami` wrappers (plan §10.4): the *surface*
 * mounts under the product, but the *implementation* lives in shared/auth so a
 * second product can mount its own `auth` over the same code.
 *
 * This file is the only new entry point into the checkout product. It IMPORTS the
 * MCP URLs + skills list + installer from features/agent-setup READ-ONLY and edits
 * none of it — agent-setup keeps doing its own thing (plan §2 hard constraint).
 */

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"

import type { Command } from "commander"
import pc from "picocolors"

import type { CliContext } from "../../../cli/types.js"
import { ensureAuth, logout, whoami, type Identity } from "../../../shared/auth/index.js"
import {
  ensureOpencode,
  launchOpencode,
  provision,
  removeOpencode,
  type AgentSpec,
  type McpServer,
} from "../../../shared/opencode/index.js"
import { findAgent } from "../features/agent-setup/agents.js"
import {
  DASHBOARD_MCP_NAME,
  DOCS_MCP_ENDPOINT,
  DOCS_MCP_NAME,
  JUSPAY_MCP_ENDPOINT,
  OUR_SKILL_NAMES,
} from "../features/agent-setup/servers.js"
import { addSkills, removeSkills } from "../features/agent-setup/skills-installer.js"

// --- Checkout-specific provisioning (the bits the command supplies to the
// product-agnostic shared/opencode wrapper). ---

// Model: OpenCode Zen's free model — no API key, no custom provider, no Juspay LLM
// gateway dependency. (Switch to a Juspay-hosted model here once that gateway is
// live; see the wrapper plan §8.)
const MODEL = "opencode/big-pickle"

// The agent that loads first. Integration is the product's core job, so it's the
// default; users can switch to juspay-explain inside OpenCode at any time.
const DEFAULT_AGENT = "juspay-integrate"

// juspay-integrate — full read/write/exec. Drives an actual integration in the
// user's codebase via the jp-* skills + both MCP servers.
const INTEGRATE_AGENT: AgentSpec = {
  name: "juspay-integrate",
  description: "Build a Juspay payment integration in your codebase (edits code, runs commands)",
  mode: "primary",
  permission: { edit: "allow", bash: "allow" },
  prompt: [
    "You are Juspay-Integrate. You implement Juspay payment integrations directly in the",
    "user's codebase, end to end.",
    "",
    "Workflow — use the installed jp-* skills in order:",
    "  jp-prd          — capture WHAT the integration must do (the PRD).",
    "  jp-architecture — turn the PRD into a design + task checklist (the HOW).",
    "  jp-executor     — implement the integration from the PRD + architecture.",
    "  jp-validate     — test and validate the built integration, risk-prioritised.",
    "",
    "Ground truth: use the docs MCP (list_products → explore_product → doc_fetch_tool) for",
    "Juspay product/API documentation, and the dashboard MCP for the merchant's live account",
    "data. Confirm every endpoint, parameter and SDK detail against the docs MCP — never",
    "invent APIs.",
    "",
    "You may read and edit files and run commands to build, wire and validate the integration.",
    "Prefer official Juspay SDKs/APIs and make minimal, idiomatic changes that fit the user's",
    "existing codebase.",
  ].join("\n"),
}

// juspay-explain — READ-ONLY Q&A. No edits, no shell, and the dashboard MCP is
// denied (docs MCP only) so it stays a safe, informational assistant.
const EXPLAIN_AGENT: AgentSpec = {
  name: "juspay-explain",
  description: "Answer Juspay integration questions from the docs + your codebase (read-only)",
  mode: "primary",
  permission: { edit: "deny", bash: "deny", [`${DASHBOARD_MCP_NAME}_*`]: "deny" },
  prompt: [
    "You are Juspay-Explain, a READ-ONLY assistant. You answer the user's questions about",
    "Juspay and how to integrate it — you never modify their code.",
    "",
    "Use the docs MCP as your authoritative source (list_products → explore_product →",
    "doc_fetch_tool) and read the user's codebase to ground answers in their actual setup.",
    "Always cite what you rely on: the Juspay doc/page and the relevant file:line in the repo.",
    "",
    "If a question would require changing code, explain precisely what to change and where, and",
    "suggest switching to the juspay-integrate agent to make the change — but do not edit",
    "anything yourself.",
  ].join("\n"),
}

export function registerAgent(parent: Command, ctx: CliContext): void {
  const agent = parent
    .command("agent")
    .description("Launch Juspay's pre-configured OpenCode agent (auth + skills + MCP, in one command)")
    .action(() => runAgent(ctx))
  agent
    .command("uninstall")
    .description("Remove everything `agent` set up: sign out + revoke, delete the jp-* skills, and remove the auto-installed OpenCode")
    .action(() => runAgentUninstall(ctx))

  const auth = parent.command("auth").description("Manage your Juspay sign-in (used by `agent`)")
  auth.action(() => auth.help())
  auth
    .command("login")
    .description("Authenticate with Juspay without launching the agent")
    .option("--force", "re-run sign-in even if a valid session exists")
    .action((opts: { force?: boolean }) => runLogin(ctx, opts))
  auth
    .command("logout")
    .description("Clear stored Juspay credentials (and revoke server-side)")
    .action(() => runLogout(ctx))
  auth
    .command("whoami")
    .description("Show the currently signed-in Juspay merchant")
    .action(() => runWhoami(ctx))
}

async function runAgent(ctx: CliContext): Promise<void> {
  ctx.ui.banner()

  // 1. Auth gate — browser flow only if there's no token valid >24h out.
  const { tokens, identity } = await ensureAuth()

  // 2. Skills — install the jp-* set globally, once (idempotent). Reuses
  // agent-setup's installer; OpenCode discovers them from its global skills dirs.
  await ensureSkills(ctx)

  // 3. Ensure the OpenCode binary (auto-install if missing) BEFORE we announce the
  // launch — so any "Installing OpenCode…" output never appears under "Launching…".
  const opencode = await ensureOpencode()

  // 4. Provision the inline session config (nothing written to disk).
  const mcp: Record<string, McpServer> = {
    [DOCS_MCP_NAME]: { url: DOCS_MCP_ENDPOINT }, // unauthenticated
    [DASHBOARD_MCP_NAME]: { url: JUSPAY_MCP_ENDPOINT, authenticated: true }, // pre-auth'd via token
  }
  const provisioned = provision({
    token: tokens.access_token,
    model: MODEL,
    agents: [INTEGRATE_AGENT, EXPLAIN_AGENT],
    defaultAgent: DEFAULT_AGENT,
    mcp,
  })

  // 5. Show what we're launching, wait for the user to read it (OpenCode's TUI
  // takes over the whole screen), then hand off. On exit, control returns to the
  // shell with our banner back in scrollback.
  printLaunchSummary(ctx, identity)
  await waitToLaunch(ctx)
  await launchOpencode(opencode, provisioned)
}

// Gate the TUI takeover behind an explicit keypress so the banner is readable.
// Non-interactive (CI / no TTY): skip the prompt and launch right away.
function waitToLaunch(ctx: CliContext): Promise<void> {
  if (!process.stdin.isTTY) {
    ctx.ui.step("Launching OpenCode...")
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(
      "\n  " + pc.cyan("▸ ") + "Press Enter to launch OpenCode " + pc.dim("(Ctrl+C to cancel)") + " ",
      () => {
        rl.close()
        resolve()
      },
    )
  })
}

// True once all four jp-* skills are present in any of OpenCode's global skills
// dirs — lets re-runs skip the (slow) reinstall.
async function skillsInstalled(): Promise<boolean> {
  const home = os.homedir()
  const dirs = [
    path.join(home, ".config", "opencode", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, ".agents", "skills"),
  ]
  for (const dir of dirs) {
    const present = await Promise.all(OUR_SKILL_NAMES.map((n) => exists(path.join(dir, n))))
    if (present.every(Boolean)) return true
  }
  return false
}

async function ensureSkills(ctx: CliContext): Promise<void> {
  const opencode = findAgent("opencode")
  if (!opencode) return // registry change; nothing to target
  if (await skillsInstalled()) return
  ctx.ui.step("Setting up your Juspay agent (skills + MCP)...")
  await addSkills([opencode], "global")
}

function printLaunchSummary(ctx: CliContext, identity: Identity): void {
  // No technical inventory here — the user is about to be inside the TUI. Say what
  // this is (Juspay-wrapped OpenCode), the two agents they can switch between, and
  // how to manage the session.
  ctx.ui.panel("Juspay × OpenCode", [
    pc.dim("OpenCode — the open-source coding CLI — pre-configured with"),
    pc.dim("Juspay for payments integration, on OpenCode's free model."),
    "",
    pc.dim("Agents (switch anytime in OpenCode):"),
    "  " + pc.bold("juspay-integrate") + pc.dim("  build the integration (edits code)"),
    "  " + pc.bold("juspay-explain") + pc.dim("    answer Juspay questions (read-only)"),
    "",
    pc.dim("Signed in    ") + pc.bold(identity.merchant_id) + pc.dim(`  (${identity.environment})`),
    "",
    pc.dim("Switch login ") + pc.cyan("juspay checkout auth login"),
    pc.dim("Sign out     ") + pc.cyan("juspay checkout auth logout"),
  ])
}

async function runLogin(ctx: CliContext, opts: { force?: boolean }): Promise<void> {
  ctx.ui.banner()
  const { identity } = await ensureAuth({ force: opts.force })
  ctx.ui.done(`Signed in as merchant ${identity.merchant_id} (${identity.environment})`)
}

async function runLogout(ctx: CliContext): Promise<void> {
  ctx.ui.banner()
  const { revoked } = await logout()
  ctx.ui.done(
    revoked
      ? "Signed out — local credentials removed and the Juspay session was revoked."
      : "Signed out — local Juspay credentials removed.",
  )
}

// `juspay checkout agent uninstall` — the reverse of `agent`: tear down creds,
// skills, and the OpenCode install we created. The agent's MCP servers are
// provisioned inline at launch (never written to disk), so there's nothing
// persisted to remove there. We do NOT touch the user's own ~/.config/opencode.
async function runAgentUninstall(ctx: CliContext): Promise<void> {
  ctx.ui.banner()

  // 1. Sign out + best-effort server-side revoke + clear local creds.
  const { revoked } = await logout()
  ctx.ui.done(
    revoked ? "Signed out and revoked the Juspay session" : "Cleared local Juspay credentials",
  )

  // 2. Remove the jp-* skills. These are the shared Juspay skill set, so this
  // also clears them for anything configured via `agent-setup` — re-run that if
  // you still want them in your own agents.
  if (await removeSkills()) ctx.ui.done(`Removed Juspay skills: ${OUR_SKILL_NAMES.join(", ")}`)
  else ctx.ui.info("• No Juspay skills found to remove")

  // 3. Remove the OpenCode install we created (~/.opencode). A brew/npm opencode
  // elsewhere is left untouched.
  if (await removeOpencode()) ctx.ui.done("Removed OpenCode (~/.opencode)")
  else ctx.ui.info("• OpenCode wasn't installed by us (~/.opencode absent) — left untouched")

  ctx.ui.info("MCP servers are provisioned in-memory at launch — nothing persisted to remove.")
  process.stdout.write("\n  " + pc.cyan("Juspay agent removed.") + "\n\n")
}

async function runWhoami(ctx: CliContext): Promise<void> {
  ctx.ui.banner()
  const identity = await whoami()
  if (!identity) {
    process.stdout.write(
      "  " + pc.yellow("⚠ ") + "Not signed in. Run " + pc.cyan("juspay checkout auth login") + ".\n",
    )
    return
  }
  const expiresOn = new Date(identity.expires_at * 1000).toDateString()
  ctx.ui.summaryBox(`Merchant ${identity.merchant_id}`, [
    { label: "Merchant   ", value: identity.merchant_id },
    { label: "Environment", value: identity.environment },
    { label: "Session    ", value: `valid until ${expiresOn}` },
  ])
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
