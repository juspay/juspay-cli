/**
 * The root commander program — the `juspay` dispatcher shell. It holds no
 * behavior of its own; products attach their command trees to it (see registry.ts).
 * commander gives us the nested sub-command tree + auto-generated help, replacing
 * the hand-rolled arg ladder and showHelp() the CLI used to carry.
 */

import { Command } from "commander"

import pkg from "../../package.json" with { type: "json" }

export function buildRootProgram(): Command {
  const program = new Command()
  program
    .name("juspay")
    .description("Juspay CLI — payments, checkout, and AI-agent integration tooling")
    .version(pkg.version, "-v, --version", "output the version number")
  // Show product-level (global) options in sub-command help too, so the tree
  // reads consistently as it grows.
  program.configureHelp({ showGlobalOptions: true })
  return program
}
