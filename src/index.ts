#!/usr/bin/env node
/**
 * Entry point: build the root `juspay` program, construct the shared context,
 * let every product register its command tree, then parse. No command dispatch
 * lives here anymore — commander + the product registry own that.
 */

import { buildRootProgram } from "./cli/program.js"
import { PRODUCTS } from "./cli/registry.js"
import type { CliContext } from "./cli/types.js"
import { fatal } from "./core/errors.js"
import * as ui from "./core/ui.js"

async function main(): Promise<void> {
  const program = buildRootProgram()
  const ctx: CliContext = { ui }
  for (const p of PRODUCTS) p.register(program, ctx)

  // Bare `juspay` (no product/command) → show the command list, run nothing.
  if (process.argv.length <= 2) {
    program.help()
  }
  await program.parseAsync(process.argv)
}

main().catch(fatal)
