/**
 * Checkout's skills: the four jp-* packages, installed/removed through the
 * product-agnostic shared installer (shared/skills). This module only binds
 * checkout's package list, so callers keep a zero-arg-list API.
 */

import { OUR_SKILL_NAMES, SKILLS_PACKAGES, type AgentDef, type Scope } from "../../../../shared/agents/index.js"
import * as skills from "../../../../shared/skills/index.js"

// Re-export so callers (index.ts summary, etc.) can name the installed skills
// without reaching into servers.ts directly.
export { OUR_SKILL_NAMES } from "../../../../shared/agents/index.js"

export function addSkills(agents: AgentDef[], scope: Scope): Promise<void> {
  return skills.addSkills(SKILLS_PACKAGES, agents, scope)
}

export function removeSkills(): Promise<boolean> {
  return skills.removeSkills(OUR_SKILL_NAMES)
}
