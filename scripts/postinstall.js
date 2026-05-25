#!/usr/bin/env node
// Print a next-steps banner after `npm install -g`. No actions taken here —
// OAuth, MCP registration, and skill install all happen when you run the CLI.

// Under `npx`, the bin runs immediately after install, so this banner would
// double up with the CLI's own output. Detect npx and stay silent.
const underNpx =
  process.env.npm_command === "exec" ||
  (process.env.npm_execpath || "").includes("npx") ||
  (process.env.npm_config_user_agent || "").includes("npx") ||
  (process.env.INIT_CWD || process.cwd()).includes("_npx")
if (underNpx) {
  process.exit(0)
}

const RESET = "\x1B[0m"
const BOLD = "\x1B[1m"
const CYAN = "\x1B[36m"
const DIM = "\x1B[2m"

process.stdout.write(`
  ${BOLD}${CYAN}Juspay for AI agents${RESET} installed.

  Next: run ${BOLD}npx @sahyll/ai-2${RESET} to add the Juspay MCP + skills to your agents.
  ${DIM}Each agent signs in to the MCP itself the first time you use it (one-time).${RESET}

`)
