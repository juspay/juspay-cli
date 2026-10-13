/**
 * The interactive pickers every agent-setup flow shares: which detected agents,
 * and which scope. Headless (no TTY) falls back to "all detected" + global.
 */

import { cancel, isCancel, multiselect, select } from "@clack/prompts"

import { hint } from "../../core/ui.js"
import type { AgentDef, Scope } from "./registry.js"

export async function pickAgents(detected: AgentDef[], interactive: boolean, message: string): Promise<AgentDef[]> {
  if (!interactive) return detected // CI/headless: configure all detected
  // Clack's multiselect only nags on an empty submit — many users don't realise
  // selection is space, not enter. State it up front.
  hint("space to select · ↑/↓ to move · enter to confirm")
  const ids = await multiselect({
    message,
    options: detected.map((a) => ({ value: a.id, label: a.label })),
    initialValues: [], // nothing pre-ticked — opt in
    required: true, // can't confirm an empty selection
  })
  if (isCancel(ids)) {
    cancel("Cancelled.")
    process.exit(0)
  }
  const set = new Set(ids as string[])
  return detected.filter((a) => set.has(a.id))
}

export async function pickScope(interactive: boolean): Promise<Scope> {
  if (!interactive) return "global" // CI/headless default
  const scope = await select({
    message: "Install where?",
    options: [
      { value: "global", label: "Global", hint: "available in every project" },
      { value: "project", label: "This project", hint: "lives in this repo (committable)" },
    ],
    initialValue: "global",
  })
  if (isCancel(scope)) {
    cancel("Cancelled.")
    process.exit(0)
  }
  return scope as Scope
}
