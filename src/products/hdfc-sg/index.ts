/**
 * The `hdfc-sg` product — HDFC SmartGateway. It exposes:
 *   • `agent-setup` — installs the HDFC SmartGateway integration skill into the
 *     user's OWN AI coding agents (skills only; no MCP, no auth).
 */

import type { Command } from "commander"

import type { CliContext, ProductModule } from "../../cli/types.js"
import { registerAgentSetup } from "./commands/agent-setup.js"

const DESCRIBE = "HDFC SmartGateway — AI-agent integration skill"

export const hdfcSg: ProductModule = {
  name: "hdfc-sg",
  describe: DESCRIBE,
  register(parent: Command, ctx: CliContext): void {
    const cmd = parent.command("hdfc-sg").description(DESCRIBE)
    // `juspay hdfc-sg` with no command → show the product's command list.
    cmd.action(() => cmd.help())
    registerAgentSetup(cmd, ctx)
  },
}
