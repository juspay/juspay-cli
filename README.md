# Juspay CLI

The `juspay` command-line tool — payments, checkout, and AI-agent integration tooling.

Today it ships the **`checkout`** product, whose `agent-setup` command adds Juspay's MCP servers + the `jp-prd` / `jp-architecture` / `jp-executor` / `jp-validate` integration skills to your AI coding agents.

```sh
npx juspay checkout agent-setup
```

Or install once and run it anywhere:

```sh
npm i -g juspay
juspay checkout agent-setup
```

You pick which agents to set up and whether to install **globally** (every project) or **just this project**. The CLI then wires up:

- **MCP servers** — `docs-mcp-server` (Juspay documentation) and `juspay-mcp` (dashboard: orders, payments, refunds, analytics, …).
- **Skills** — a four-step integration workflow:
  - `jp-prd` — capture *what* the integration must do (PRD).
  - `jp-architecture` — turn the PRD into a design + task checklist (*how*).
  - `jp-executor` — implement the integration from the PRD + architecture.
  - `jp-validate` — test/validate the built integration, risk-prioritised with a PASS / CONCERNS / FAIL gate.

No tokens are stored by this CLI — each agent authenticates the dashboard MCP itself, the first time it's used (in-agent OAuth).

## Supported agents

- **CLI:** Claude Code, Codex CLI, Gemini CLI, OpenCode CLI, GitHub Copilot CLI
- **Editors:** Cursor, Windsurf, VS Code / Copilot

Only the agents detected on your machine are offered.

## Commands

```sh
juspay                                  # show the command list
juspay checkout agent-setup             # pick agents + scope, add the Juspay MCP + skills
juspay checkout agent-setup list        # show which agents are configured, and at which scope
juspay checkout agent-setup uninstall   # remove the MCP + skills (global + project) and sign out
```

(Prefix any of these with `npx ` to run without a global install, e.g. `npx juspay checkout agent-setup`.)

## Authenticating the dashboard MCP

After setup, each agent needs a one-time authentication for `juspay-mcp`:

- **Claude Code** — `/mcp` → `juspay-mcp` → Authenticate
- **Codex** — `codex mcp login juspay-mcp`
- **OpenCode** — `opencode mcp auth juspay-mcp`
- **Gemini / Cursor / Windsurf / VS Code** — prompts to sign in on first use

(`docs-mcp-server` needs no auth.)

## Clean removal

`juspay checkout agent-setup uninstall` removes the Juspay MCP + skills from every agent (global **and** project) and signs out — handy before a fresh install:

```sh
npx juspay checkout agent-setup uninstall
```

## License

[Apache 2.0](./LICENSE)
