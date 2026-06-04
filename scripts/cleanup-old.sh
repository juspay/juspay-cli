#!/usr/bin/env bash
# Juspay AI — clean up EVERYTHING Juspay AI installed (any prior package name:
# @juspay/cli, @sahyll/ai, @sahyll/ai-2, @sahyll/juspay-claude), GLOBAL and in
# the CURRENT PROJECT, so you can run `npx @juspay/cli` from a clean slate.
# Also signs out of agents that cache OAuth tokens.
#
# SAFE: only removes Juspay's OWN MCP entries (docs-mcp-server, juspay-mcp,
# juspay-docs) and the `integrate` skill. Your other MCP servers / settings are
# preserved — we only delete a config FILE or DIR if it's left empty afterward.

echo "Cleaning up Juspay AI…"

# --- node helper: strip our MCP entries from a JSON config; if the container is
#     left empty drop it, and if the whole file is left empty, delete the file ---
CLEAN_JS='
const fs=require("fs");
const names=["docs-mcp-server","juspay-mcp","juspay-docs"];
const keys=["mcpServers","mcp","servers","mcp_servers"];
const file=process.argv[1];
let cfg; try{cfg=JSON.parse(fs.readFileSync(file,"utf8"))}catch{process.exit(0)}
let changed=false;
for(const k of keys){const b=cfg[k];if(b&&typeof b==="object"){let hit=false;for(const n of names){if(n in b){delete b[n];changed=true;hit=true}}if(hit&&Object.keys(b).length===0)delete cfg[k]}}
if(!changed)process.exit(0);
if(Object.keys(cfg).length===0){fs.rmSync(file);console.log("  removed "+file)}
else{fs.writeFileSync(file,JSON.stringify(cfg,null,2)+"\n");console.log("  cleaned "+file)}
'
clean_json(){ [ -f "$1" ] && node -e "$CLEAN_JS" "$1" 2>/dev/null; }

# --- strip our [mcp_servers.*] tables from a TOML config (Codex); delete if empty ---
clean_toml(){
  [ -f "$1" ] || return 0
  local tmp; tmp="$(mktemp)"
  awk '
    /^[[:space:]]*\[mcp_servers\.(juspay-mcp|docs-mcp-server|juspay-docs)\]/ {skip=1; next}
    /^[[:space:]]*\[/ {skip=0}
    !skip {print}
  ' "$1" > "$tmp"
  if grep -q "[^[:space:]]" "$tmp"; then mv "$tmp" "$1"; echo "  cleaned $1"
  else rm -f "$tmp" "$1"; echo "  removed $1"; fi
}

# 1) Global npm packages + commands
echo "→ Removing global packages…"
npm rm -g @juspay/cli @sahyll/ai @sahyll/ai-2 @sahyll/juspay-claude >/dev/null 2>&1
hash -r 2>/dev/null

# 2) Stored credentials / config + caches
echo "→ Removing stored credentials + caches…"
rm -rf "$HOME/.config/juspay" "$HOME/.config/genius"
rm -f  "$HOME/.claude/mcp-needs-auth-cache.json"
rm -rf "$HOME/.npm/_npx" >/dev/null 2>&1

# 3) Sign out of agents that cache OAuth creds (before removing their config)
echo "→ Signing out of agents…"
command -v codex    >/dev/null 2>&1 && codex mcp logout juspay-mcp >/dev/null 2>&1
command -v opencode >/dev/null 2>&1 && opencode mcp logout juspay-mcp >/dev/null 2>&1

# 4) GLOBAL (user-scope) configs + skills
echo "→ Cleaning global configs + skills…"
clean_json "$HOME/.claude.json"
clean_json "$HOME/.gemini/settings.json"
clean_json "$HOME/.cursor/mcp.json"
clean_json "$HOME/.codeium/windsurf/mcp_config.json"
clean_json "$HOME/.copilot/mcp-config.json"
clean_json "$HOME/.config/opencode/opencode.json"
clean_json "$HOME/Library/Application Support/Code/User/mcp.json"
clean_toml "$HOME/.codex/config.toml"
command -v claude >/dev/null 2>&1 && for n in docs-mcp-server juspay-mcp juspay-docs; do claude mcp remove --scope user "$n" >/dev/null 2>&1; done
command -v codex  >/dev/null 2>&1 && for n in docs-mcp-server juspay-mcp; do codex mcp remove "$n" >/dev/null 2>&1; done
# Remove every historical + current skill: old "integrate" + earlier
# "juspay-explainer"/"juspay-integrator" + the current jp-prd/jp-architecture/
# jp-executor trio. Safe to no-op when a skill isn't present.
for s in juspay-explainer juspay-integrator integrate jp-prd jp-architecture jp-executor; do
  rm -rf "$HOME/.claude/skills/$s" "$HOME/.agents/skills/$s"
  npx -y skills remove "$s" -g -y >/dev/null 2>&1
done

# 5) THIS PROJECT (current directory) — configs + skills + now-empty folders
echo "→ Cleaning this project: $PWD"
clean_json "$PWD/.mcp.json"
clean_json "$PWD/opencode.json"
clean_json "$PWD/.gemini/settings.json"
clean_json "$PWD/.cursor/mcp.json"
clean_json "$PWD/.windsurf/mcp_config.json"
clean_json "$PWD/.vscode/mcp.json"
clean_toml "$PWD/.codex/config.toml"
# Same skill list at project scope.
for s in juspay-explainer juspay-integrator integrate jp-prd jp-architecture jp-executor; do
  rm -rf "$PWD/.agents/skills/$s" "$PWD/.claude/skills/$s"
  npx -y skills remove "$s" -y >/dev/null 2>&1
done
rm -f  "$PWD/skills-lock.json"
# rmdir only removes EMPTY dirs (safe — keeps .claude if it has settings.local.json, etc.)
rmdir "$PWD/.agents/skills" "$PWD/.agents" "$PWD/.claude/skills" \
      "$PWD/.codex" "$PWD/.gemini" "$PWD/.cursor" "$PWD/.windsurf" "$PWD/.vscode" 2>/dev/null

# 6) Other repos under your home — strip our MCP entries from any project configs
echo "→ Scanning other projects for leftover MCP configs…"
find "$HOME" -maxdepth 6 -not -path "*/node_modules/*" -not -path "*/.git/*" \
  \( -name ".mcp.json" -o -name "opencode.json" \
     -o -path "*/.gemini/settings.json" -o -path "*/.cursor/mcp.json" \
     -o -path "*/.vscode/mcp.json" -o -path "*/.windsurf/mcp_config.json" \) 2>/dev/null \
  | while IFS= read -r f; do clean_json "$f"; done

echo
echo "✅ Cleanup complete. Install fresh with:  npx @juspay/cli"
