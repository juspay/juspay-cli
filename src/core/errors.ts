import pc from "picocolors"

// Exit codes. 0/1 are the usual; 2 means "we tried but something didn't land"
// (skills install failed, or every MCP write failed). Scripts can branch on 2.
export const EXIT_PARTIAL = 2

// Top-level catch: print a single red error line and exit 1.
export function fatal(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(pc.red("✗ ") + message + "\n")
  process.exit(1)
}
