/**
 * The `checkout` product — Euler + Payment Page + EC-headless. It exposes:
 *   • `agent-setup` — wires the Juspay MCP servers + skills into the user's OWN
 *     AI coding agents (configures third-party agents; tokenless, self-auth).
 *   • `agent` (+ `auth login|logout|whoami`) — launches JUSPAY'S pre-configured
 *     OpenCode agent: Juspay auth → skills + MCP + model, in one command.
 * The two are independent: agent-setup = "wire Juspay into *your* agents";
 * agent = "launch *Juspay's* agent". Future checkout commands register here too.
 */

import type { Command } from "commander"

import type { CliContext, ProductModule } from "../../cli/types.js"
import { registerAgent } from "./commands/agent.js"
import { registerAgentSetup } from "./commands/agent-setup.js"

const DESCRIBE = "Juspay Checkout — payment page, express checkout, and AI-agent integration"

export const checkout: ProductModule = {
  name: "checkout",
  describe: DESCRIBE,
  register(parent: Command, ctx: CliContext): void {
    const cmd = parent.command("checkout").description(DESCRIBE)
    // `juspay checkout` with no command → show the product's command list.
    cmd.action(() => cmd.help())
    registerAgentSetup(cmd, ctx)
    registerAgent(cmd, ctx)
  },
}
