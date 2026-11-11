import type { TerminalReportStatus } from "@/nodes/types";
import type { AgentActivity } from "@/store/agentActivity";
import { sessionOf, type NodeRecord } from "@/store/nodes";
import type { TerminalStatus } from "@/store/terminalStatus";

/**
 * Where an agent stands: the one reading that every count shares (the title bar's counters, the rail's pip,
 * the agents panel's filters, the group labels, the tab badges, Go to). The status pill reads it the same way
 * (`pillOf`), so a count never says an agent works while its pill says otherwise.
 * - `starting`: its process is on its way;
 * - `active`: its process runs, its activity is not known yet;
 * - `working`, `waiting`: at work, or waiting for the user's answer;
 * - `ready`: resting, its turn over; `done`: resting on its last report (done, blocked or failed);
 * - `left`: its agent exited and the terminal is back at its shell: no agent is there ("Agent exited");
 * - `stopped`: no process (stopped, exited, or failed to start).
 */
export type AgentState = "starting" | "active" | "working" | "waiting" | "ready" | "done" | "left" | "stopped";

/** An agent's state from its process, its activity and its last report, in the pill's order. */
export function agentStateOf(status: TerminalStatus | undefined, activity?: AgentActivity, report?: TerminalReportStatus): AgentState {
  if (status?.state === "starting") return "starting";
  // An activity can outlive a process that stopped: only a running one has any.
  if (status?.state !== "running") return "stopped";
  if (activity?.left) return "left";
  if (activity?.activity === "working") return "working";
  if (activity?.activity === "waiting") return "waiting";
  if (report) return "done";
  return activity ? "ready" : "active";
}

/** The states of an agent whose process runs with the agent in it: what "active" counts. */
const LIVE: ReadonlySet<AgentState> = new Set<AgentState>(["active", "working", "waiting", "ready", "done"]);

export const isLive = (state: AgentState): boolean => LIVE.has(state);

/**
 * Whether a node counts as an agent: a Fleet, or any node with an agent's session, whatever its role (a
 * terminal today; `sessionOf` names the others). A plain shell console runs no agent: it is never counted.
 */
export function isAgentNode(record: NodeRecord | undefined): boolean {
  if (record?.kind === "fleet") return true;
  const session = sessionOf(record);
  return session !== undefined && session.agent !== "shell";
}

/** The state of node `id` if it is an agent, else null: what every count reads. */
export function agentStateIn(
  id: string,
  nodes: Readonly<Record<string, NodeRecord>>,
  statuses: Readonly<Record<string, TerminalStatus | undefined>>,
  activities: Readonly<Record<string, AgentActivity | undefined>>,
): AgentState | null {
  const record = nodes[id];
  if (!isAgentNode(record)) return null;
  return agentStateOf(statuses[id], activities[id], sessionOf(record)?.lastReport?.status);
}

/** Agents at work, waiting, and live (`active`): working and waiting are always part of active. */
export interface AgentTally {
  working: number;
  waiting: number;
  active: number;
}

/** The agents among `ids`, counted by state. */
export function tallyAgents(
  ids: Iterable<string>,
  nodes: Readonly<Record<string, NodeRecord>>,
  statuses: Readonly<Record<string, TerminalStatus | undefined>>,
  activities: Readonly<Record<string, AgentActivity | undefined>>,
): AgentTally {
  const tally: AgentTally = { working: 0, waiting: 0, active: 0 };
  for (const id of ids) {
    const state = agentStateIn(id, nodes, statuses, activities);
    if (state === null || !isLive(state)) continue;
    tally.active += 1;
    if (state === "working") tally.working += 1;
    if (state === "waiting") tally.waiting += 1;
  }
  return tally;
}

/** The ids of the nodes of `workspaceId`, on screen or not (a tab's badge, Go to). */
export function workspaceNodeIds(nodes: Readonly<Record<string, NodeRecord>>, workspaceId: string): string[] {
  return Object.keys(nodes).filter((id) => nodes[id].workspaceId === workspaceId);
}
