/**
 * The product registry — the single place you edit to add a Juspay product to
 * the CLI. Each entry is a ProductModule that owns its own command namespace.
 */

import { checkout } from "../products/checkout/index.js"
import type { ProductModule } from "./types.js"

export const PRODUCTS: ProductModule[] = [
  checkout,
  // upi, hyperswitch, ...  ← one import + one line each
]
