/**
 * One-shot streamable-HTTP MCP tool call. Ported verbatim from
 * juspay-skills/claude-cli/src/mcp-call.ts (constants now come from ./constants).
 *
 * Performs initialize → tools/call against `endpoint`, returns the tool result.
 * Used by `whoami` to read merchant details right after OAuth.
 */

import { CLI_VERSION, USER_AGENT } from "./constants.js"

type JsonRpcOk = { jsonrpc: "2.0"; id: number | string; result: any }
type JsonRpcErr = { jsonrpc: "2.0"; id: number | string; error: { code: number; message: string } }
type JsonRpcResponse = JsonRpcOk | JsonRpcErr

export async function callMcpTool(
  endpoint: string,
  bearer: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<any> {
  let sessionId: string | undefined

  const initResult = await rpc(endpoint, bearer, sessionId, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "juspay-cli", version: CLI_VERSION },
    },
  })
  sessionId = initResult.sessionId

  if ("error" in initResult.body) {
    throw new Error(`MCP initialize failed: ${initResult.body.error.message}`)
  }

  await postNotification(endpoint, bearer, sessionId, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  })

  const callResult = await rpc(endpoint, bearer, sessionId, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: tool, arguments: args },
  })

  if ("error" in callResult.body) {
    throw new Error(`MCP tool '${tool}' failed: ${callResult.body.error.message}`)
  }
  return callResult.body.result
}

async function rpc(
  endpoint: string,
  bearer: string,
  sessionId: string | undefined,
  payload: object,
): Promise<{ body: JsonRpcResponse; sessionId?: string }> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders(bearer, sessionId),
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 400)}`)
  }
  const sid = res.headers.get("mcp-session-id") ?? sessionId
  const body = await readJsonRpc(res)
  return { body, sessionId: sid ?? undefined }
}

async function postNotification(
  endpoint: string,
  bearer: string,
  sessionId: string | undefined,
  payload: object,
): Promise<void> {
  // Notifications don't expect a response body. Some servers still return 202 — that's fine.
  await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders(bearer, sessionId),
    body: JSON.stringify(payload),
  })
}

function buildHeaders(bearer: string, sessionId?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${bearer}`,
    "User-Agent": USER_AGENT,
  }
  if (sessionId) h["Mcp-Session-Id"] = sessionId
  return h
}

async function readJsonRpc(res: Response): Promise<JsonRpcResponse> {
  const ct = res.headers.get("content-type") ?? ""
  const text = await res.text()
  if (ct.includes("text/event-stream")) {
    // Extract the first JSON-RPC payload from a `data: ` line.
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        const json = line.slice(5).trim()
        if (json) return JSON.parse(json) as JsonRpcResponse
      }
    }
    throw new Error("SSE response contained no JSON-RPC payload.")
  }
  return JSON.parse(text) as JsonRpcResponse
}
