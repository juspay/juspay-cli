# Juspay CLI

Add Juspay's MCP servers + the `integrate` skill to your AI coding agents — one command, any agent.

```sh
npx @sahyll/ai-2
```

You pick which agents to set up and whether to install **globally** (every project) or **just this project**. The CLI then wires up:

- **MCP servers** — `docs-mcp-server` (Juspay documentation) and `juspay-mcp` (dashboard: orders, payments, refunds, analytics, …).
- **Skill** — `integrate`, a guided wizard for integrating Juspay products.

No tokens are stored by this CLI — each agent authenticates the dashboard MCP itself, the first time it's used (in-agent OAuth).

## Supported agents

- **CLI:** Claude Code, Codex CLI, Gemini CLI, OpenCode CLI, GitHub Copilot CLI
- **Editors:** Cursor, Windsurf, VS Code / Copilot

Only the agents detected on your machine are offered.

## Commands

```sh
npx @sahyll/ai-2            # pick agents + scope, add the Juspay MCP + skills
npx @sahyll/ai-2 list       # show which agents are configured, and at which scope
npx @sahyll/ai-2 uninstall  # remove the MCP + skills (global + project) and sign out
npx @sahyll/ai-2 help
```

## Authenticating the dashboard MCP

After setup, each agent needs a one-time authentication for `juspay-mcp`:

- **Claude Code** — `/mcp` → `juspay-mcp` → Authenticate
- **Codex** — `codex mcp login juspay-mcp`
- **OpenCode** — `opencode mcp auth juspay-mcp`
- **Gemini / Cursor / Windsurf / VS Code** — prompts to sign in on first use

(`docs-mcp-server` needs no auth.)

## Clean reinstall

`scripts/cleanup-old.sh` removes the Juspay MCP + skills from every agent (global **and** project), signs out, and clears caches — handy before a fresh install:

```sh
bash scripts/cleanup-old.sh
```

## License

[MIT](./LICENSE)
