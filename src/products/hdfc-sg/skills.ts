// The HDFC SmartGateway skill — a standalone `vercel-labs/skills` package served
// from the Juspay-owned repo github.com/juspay/merchant-skills (HDFC-SG/ folder,
// outside the jp-* `skills/` dir). Needs no MCP: the skill reads the integration
// kit in HDFC-SG/kits/ directly.
export const HDFC_SG_SKILL_PACKAGES = ["juspay/merchant-skills/HDFC-SG/hdfc-sg-integration"] as const

// Skill directory name as deployed by the `skills` CLI — the key for `skills remove`.
export const HDFC_SG_SKILL_NAMES = ["hdfc-sg-integration"] as const
