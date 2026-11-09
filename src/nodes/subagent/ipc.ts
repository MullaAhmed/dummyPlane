import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "@/ipc/invoke";

/** One line of a subagent's transcript, as the backend summarises it. */
export interface SubagentLine {
  kind: "prompt" | "text" | "tool" | "result" | "error" | "report";
  text: string;
}

/** A subagent a Claude session runs (its Agent tool), from its hooks and its transcript's meta file. */
export interface SubagentInfo {
  /** The terminal node whose Claude session runs it. */
  nodeId: string;
  /** Claude's own id of the subagent, without the `agent-` prefix. */
  agentId: string;
  agentType: string;
  /** The subagent that spawned this one, for a nested subagent. */
  parentAgentId?: string;
  description?: string;
  /** First line of its prompt. */
  prompt?: string;
  state: "running" | "done";
}

export interface SubagentOutput {
  nodeId: string;
  agentId: string;
  lines: SubagentLine[];
}

export interface SubagentSnapshot extends SubagentInfo {
  lines: SubagentLine[];
}

export const onSubagent = (handler: (info: SubagentInfo) => void): Promise<UnlistenFn> =>
  listen<SubagentInfo>("agent-subagent", (event) => handler(event.payload));

export const onSubagentOutput = (handler: (output: SubagentOutput) => void): Promise<UnlistenFn> =>
  listen<SubagentOutput>("subagent-output", (event) => handler(event.payload));

/** The parent session or its process ended: its subagents go with it. */
export const onSubagentSessionEnded = (handler: (nodeId: string) => void): Promise<UnlistenFn> =>
  listen<{ nodeId: string }>("subagent-session-ended", (event) => handler(event.payload.nodeId));

/** The subagents still running, for a page that (re)loads. */
export const subagentSnapshot = () => call<SubagentSnapshot[]>("subagent_snapshot");
