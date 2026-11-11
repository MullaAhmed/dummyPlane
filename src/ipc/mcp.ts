import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "./invoke";

/** A question of dummyPlane's MCP server, for the interface to answer. */
export interface McpCall {
  callId: number;
  nodeId: string;
  method: "tools/list" | "tools/call";
  params: Record<string, unknown>;
}

export function onMcpCall(handler: (call: McpCall) => void): Promise<UnlistenFn> {
  return listen<McpCall>("mcp-call", (event) => handler(event.payload));
}

export const mcpReply = (callId: number, result: unknown) => call<void>("mcp_reply", { callId, result });

/** How many subagents a Claude session runs. */
export interface SubagentsEvent {
  nodeId: string;
  running: number;
}

export function onAgentSubagents(handler: (event: SubagentsEvent) => void): Promise<UnlistenFn> {
  return listen<SubagentsEvent>("agent-subagents", (event) => handler(event.payload));
}
