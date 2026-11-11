import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** What a Claude session's status line was given, as Claude Code sends it. */
export interface StatusEvent {
  nodeId: string;
  status: unknown;
}

export function onClaudeStatus(handler: (event: StatusEvent) => void): Promise<UnlistenFn> {
  return listen<StatusEvent>("claude-status", (event) => handler(event.payload));
}
