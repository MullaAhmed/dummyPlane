import { messages } from "@/i18n";
import type { AgentState } from "./agentState";
import { agentsMessages } from "./messages";

/**
 * Counters of a group label (spec theme §11.4): "4 · 2 en cours", or
 * "4 · inactif".
 */
export function countsText(members: number, working: number): string {
  return messages(agentsMessages).summary.counts(members, working);
}

/** Names of the members still running, listed by the "Close the group" confirmation (spec §11.4). */
export function livingAgents(
  memberIds: readonly string[],
  nameOf: (id: string) => string,
  running: (id: string) => boolean,
): string[] {
  return memberIds.filter(running).map(nameOf);
}

/** "· 1 waiting", shown in amber after the counters; null when nobody waits. */
export function waitingText(waiting: number): string | null {
  if (waiting <= 0) return null;
  return messages(agentsMessages).summary.waiting(waiting);
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
export function membersIn(memberIds: readonly string[], state: "working" | "waiting", stateOf: (id: string) => AgentState | null): number {
  return memberIds.filter((id) => stateOf(id) === state).length;
}
