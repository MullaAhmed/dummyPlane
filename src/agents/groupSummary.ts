import { messages } from "@/i18n";
import type { AgentState } from "./agentState";
import { agentsMessages } from "./messages";

/** A group's members and how many stand in each state that its label tells (`ready`: at rest, its turn over or its report in). */
export interface GroupCounts {
  members: number;
  waiting: number;
  working: number;
  ready: number;
}

/** One piece of a group's summary; `waiting` is the one the label draws in the wait tone. */
export interface SummaryPart {
  text: string;
  waiting?: boolean;
}

/**
 * The pieces of a group label, worst first (the eye reads it at a distance): the members, then those who wait for
 * the user, then those at work. Nobody waits or works: "ready" when every member is at rest, else how many are, if any.
 * "3 · 1 waiting · 1 working", "3 · ready", "3".
 */
export function summaryParts({ members, waiting, working, ready }: GroupCounts): SummaryPart[] {
  const t = messages(agentsMessages).summary;
  const parts: SummaryPart[] = [{ text: String(members) }];
  if (waiting > 0) parts.push({ text: t.waiting(waiting), waiting: true });
  if (working > 0) parts.push({ text: t.working(working) });
  if (waiting === 0 && working === 0 && ready > 0) parts.push({ text: ready === members ? t.allReady : t.ready(ready) });
  return parts;
}

/** The summary of a group as one line: "4 · 1 waiting · 2 working". */
export function countsText(counts: GroupCounts): string {
  return summaryParts(counts)
    .map((part) => part.text)
    .join(" · ");
}

/** Names of the members still running, listed by the "Close the group" confirmation. */
export function livingAgents(
  memberIds: readonly string[],
  nameOf: (id: string) => string,
  running: (id: string) => boolean,
): string[] {
  return memberIds.filter(running).map(nameOf);
}

/** "1 agent", "8 agents". */
export function agentsText(count: number): string {
  return messages(agentsMessages).summary.agents(count);
}

/** "0 groupe", "2 groupes". */
export function groupsText(count: number): string {
  return messages(agentsMessages).summary.groups(count);
}

/**
 * Members in `state`, read as every count reads them (`agentStateIn`: null for a plain shell): an agent that
 * exited or whose process stopped is never at work, whatever activity it left behind.
 */
export function membersIn(memberIds: readonly string[], state: AgentState | readonly AgentState[], stateOf: (id: string) => AgentState | null): number {
  const wanted = typeof state === "string" ? [state] : state;
  return memberIds.filter((id) => {
    const own = stateOf(id);
    return own !== null && wanted.includes(own);
  }).length;
}
