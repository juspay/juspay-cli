/**
 * The `checkout` product — Euler + Payment Page + EC-headless. Today it exposes a
 * single command, `agent-setup`, which wires the Juspay MCP servers + integration
 * skills into the user's AI coding agents. Future checkout commands (orders,
 * transactions, …) register here alongside it.
 */

import type { Command } from "commander"

import type { CliContext, ProductModule } from "../../cli/types.js"
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
  },
}
