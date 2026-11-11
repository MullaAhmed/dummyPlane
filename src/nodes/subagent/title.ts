import { taskExcerpt, taskSummary } from "@/agents/taskSummary";
import type { SubagentInfo, SubagentLine } from "./ipc";

/** What it was asked, in a line: the Agent tool's description, else its prompt's first line said as a task. */
export function subagentAbout(info: Pick<SubagentInfo, "description" | "prompt">): string {
  const description = info.description?.trim();
  if (description) return description;
  return taskSummary((info.prompt ?? "").split(/\r?\n/)[0]);
}

/** Its type, its name in its header: Explore, Plan… */
export const subagentType = (info: Pick<SubagentInfo, "agentType">): string => info.agentType || "subagent";

/** Its type and what it was asked: the Agent tool's description, else its prompt's first line. */
export function subagentTitle(info: Pick<SubagentInfo, "agentType" | "description" | "prompt">): string {
  const about = subagentAbout(info);
  const type = subagentType(info);
  return about ? `${type} · ${about}` : type;
}

/** Its tooltip: what it was asked, then its prompt's line when that says more. */
export function subagentDetail(info: Pick<SubagentInfo, "description" | "prompt">): string {
  const about = subagentAbout(info);
  const prompt = info.prompt ? taskExcerpt(info.prompt) : "";
  return prompt && prompt !== about ? `${about}\n${prompt}` : about;
}

/** Who spawned it, for the header's prefix: its parent subagent's type, else its terminal's name. */
export function parentLabel(parent: Pick<SubagentInfo, "agentType"> | undefined, terminalName: string, fallback: string): string {
  if (parent) return parent.agentType || fallback;
  return terminalName || fallback;
}

/**
 * Its answer, the text it hands back: its handback (a report line), else its
 * last words once it is done. A tool's output is never its answer, and while
 * it runs its last words are only its latest.
 */
export function subagentAnswer(entry: { state: SubagentInfo["state"]; lines: readonly SubagentLine[] }): SubagentLine | undefined {
  const last = (kind: SubagentLine["kind"]) => [...entry.lines].reverse().find((line) => line.kind === kind);
  return last("report") ?? (entry.state === "done" ? last("text") : undefined);
}
