import type { SubagentInfo } from "./ipc";

/** Its type and what it was asked: the Agent tool's description, else its prompt's first line. */
export function subagentTitle(info: Pick<SubagentInfo, "agentType" | "description" | "prompt">): string {
  const about = (info.description ?? info.prompt ?? "").split(/\r?\n/)[0].trim();
  const type = info.agentType || "subagent";
  return about ? `${type} · ${about}` : type;
}

/** Who spawned it, for the header's prefix: its parent subagent's type, else its terminal's name. */
export function parentLabel(parent: Pick<SubagentInfo, "agentType"> | undefined, terminalName: string, fallback: string): string {
  if (parent) return parent.agentType || fallback;
  return terminalName || fallback;
}
