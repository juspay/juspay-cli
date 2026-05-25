import pc from "picocolors"

const ANSI_RE = /\x1B\[[0-9;]*m/g

function visibleLen(s: string): number {
  return s.replace(ANSI_RE, "").length
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

class Spinner {
  private timer: NodeJS.Timeout | null = null
  private frame = 0
  private message: string
  private interactive: boolean

  constructor(message: string) {
    this.message = message
    this.interactive = Boolean(process.stdout.isTTY)
  }

  start(): this {
    if (!this.interactive) {
      // Non-TTY: print one static line so output isn't silent.
      process.stdout.write("  " + pc.dim("→ ") + this.message + "\n")
      return this
    }
    process.stdout.write("\x1B[?25l") // hide cursor
    this.render()
    this.timer = setInterval(() => this.render(), 80)
    return this
  }

  update(message: string): void {
    this.message = message
    if (!this.interactive) {
      process.stdout.write("  " + pc.dim("→ ") + message + "\n")
    }
  }

  done(finalMessage: string): void {
    this.stop()
    process.stdout.write("  " + pc.green("✓ ") + finalMessage + "\n")
  }

  fail(finalMessage: string): void {
    this.stop()
    process.stdout.write("  " + pc.red("✗ ") + finalMessage + "\n")
  }

  private render(): void {
    const glyph = pc.cyan(SPINNER_FRAMES[this.frame])
    process.stdout.write("\r\x1B[K  " + glyph + " " + this.message)
    this.frame = (this.frame + 1) % SPINNER_FRAMES.length
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.interactive) {
      process.stdout.write("\r\x1B[K") // clear current line
      process.stdout.write("\x1B[?25h") // show cursor
    }
  }
}

/**
 * Start a spinner with an initial message. Call `.done(msg)` when the work
 * completes — the spinner is replaced with a green ✓ line. `.fail(msg)`
 * replaces with a red ✗ line.
 *
 *   const s = spin("Fetching merchant details...")
 *   const result = await work()
 *   s.done("Merchant: " + result.id)
 */
export function spin(message: string): Spinner {
  return new Spinner(message).start()
}

export function banner(): void {
  process.stdout.write("\n")
  process.stdout.write("  " + pc.cyan(pc.bold("Juspay for AI agents")) + "\n")
  process.stdout.write("\n")
}

export function step(msg: string): void {
  process.stdout.write("  " + pc.dim("→ ") + msg + "\n")
}

export function done(msg: string): void {
  process.stdout.write("  " + pc.green("✓ ") + msg + "\n")
}

export function info(msg: string): void {
  process.stdout.write("  " + pc.dim(msg) + "\n")
}

export function warn(msg: string): void {
  process.stdout.write("  " + pc.yellow("⚠ ") + msg + "\n")
}

export type SummaryRow = {
  label: string
  value: string
}

/**
 * Render a rounded box with a title, a list of label/value rows (✓-prefixed),
 * and a footer line of secondary commands.
 */
export function summaryBox(title: string, rows: SummaryRow[]): void {
  const labelWidth = Math.max(...rows.map((r) => visibleLen(r.label)))
  const composed = rows.map((r) => {
    const padding = " ".repeat(labelWidth - visibleLen(r.label) + 2)
    return pc.green("✓ ") + pc.bold(r.label) + padding + r.value
  })

  const widest = Math.max(visibleLen(`  Setup `) + title.length, ...composed.map(visibleLen))
  const innerWidth = Math.max(widest + 4, 44)

  const top = "  " + pc.dim("╭─ ") + pc.bold(title) + " " + pc.dim("─".repeat(innerWidth - title.length - 4)) + pc.dim("╮")
  const empty = "  " + pc.dim("│") + " ".repeat(innerWidth) + pc.dim("│")
  const bottom = "  " + pc.dim("╰" + "─".repeat(innerWidth) + "╯")

  process.stdout.write("\n")
  process.stdout.write(top + "\n")
  process.stdout.write(empty + "\n")
  for (const line of composed) {
    const pad = " ".repeat(Math.max(0, innerWidth - visibleLen(line) - 4))
    process.stdout.write("  " + pc.dim("│") + "  " + line + pad + "  " + pc.dim("│") + "\n")
  }
  process.stdout.write(empty + "\n")
  process.stdout.write(bottom + "\n")
}

export function footer(primaryHint: string, otherCommands: string[]): void {
  process.stdout.write("\n")
  process.stdout.write("  " + primaryHint + "\n")
  process.stdout.write("\n")
  process.stdout.write("  " + pc.dim("Other: " + otherCommands.join(" · ")) + "\n")
  process.stdout.write("\n")
}
