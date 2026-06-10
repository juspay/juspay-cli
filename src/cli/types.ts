/**
 * The contract every product implements. This is the durable seam of the CLI:
 * `juspay` is a pure dispatcher shell, and each PRODUCT (checkout, upi, …)
 * registers its own commands under its own namespace. Adding a product is a new
 * module + one line in registry.ts — never an edit to the entry point.
 *
 * Today the array of products is static (single bundled binary). If/when products
 * need independent releases, the registry can discover installed plugins instead;
 * this contract stays unchanged, so no product code is rewritten.
 */

import type { Command } from "commander"

// Shared services injected into every product (rather than imported ad hoc), so
// products stay decoupled from concrete implementations. Minimal by design —
// we add a service here only when a command actually needs it.
export type Ui = typeof import("../core/ui.js")

export interface CliContext {
  ui: Ui
}

export interface ProductModule {
  name: string // 'checkout' — the first-level token under `juspay`
  describe: string // shown in `juspay --help`
  // Attach this product's command tree to the root program.
  register(parent: Command, ctx: CliContext): void
}
