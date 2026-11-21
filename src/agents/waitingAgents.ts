import { useStore } from "zustand";
import { personActivities, useActivities } from "@/store/agentActivity";
import type { FleetDecisionKind } from "@/store/fleetDecisions";
import { nodesStore, useNodes, type NodeRecord } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { useWorkspaces, workspacesStore } from "@/store/workspaces";
import { AGENTS } from "./catalog";

/** An agent stopped until the user answers it. */
export interface WaitingAgent {
  id: string;
  kind: "terminal" | "fleet";
  name: string;
  workspaceId: string;
  /** Since when it waits, in ms. */
  since: number;
  /** What it says it waits for, if it says so: untrusted plain text. */
  message?: string;
  /** A Fleet that waits on a decision its panel asks (a plan's go-ahead, Land, Clean up), not on a question of its agent. */
  decision?: FleetDecisionKind;
}

/** A terminal without a first name goes by its agent's name; a fleet always has one. */
function nameOf(record: Extract<NodeRecord, { kind: WaitingAgent["kind"] }>): string {
  return record.kind === "terminal" ? record.payload.name || AGENTS[record.payload.agent].label : record.payload.name;
}

/** The running agents of `workspaceIds` waiting for an answer, the one waiting longest first. */
export function waitingAgents(
  workspaceIds: readonly string[],
  nodes: Readonly<Record<string, NodeRecord>>,
  statuses: Readonly<Record<string, { state: string } | undefined>>,
  activities: Readonly<Record<string, { activity: string; since: number; message?: string; decision?: FleetDecisionKind } | undefined>>,
): WaitingAgent[] {
  const wanted = new Set(workspaceIds);
  const agents: WaitingAgent[] = [];
  for (const [id, record] of Object.entries(nodes)) {
    const activity = activities[id];
    // A Kanban or a file on the canvas never waits.
    if (record.kind !== "terminal" && record.kind !== "fleet") continue;
    if (!wanted.has(record.workspaceId) || statuses[id]?.state !== "running" || activity?.activity !== "waiting") continue;
    agents.push({
      id,
      kind: record.kind,
      name: nameOf(record),
      workspaceId: record.workspaceId,
      since: activity.since,
      message: activity.message,
      ...(activity.decision ? { decision: activity.decision } : {}),
    });
  }
  return agents.sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
}

/** An agent of the open project, waiting or not: where a click on its notification arrives. */
export type OpenAgent = Pick<WaitingAgent, "id" | "kind" | "name" | "workspaceId">;

/** The terminal or fleet `nodeId` if it is in the open project, waiting or not. */
export function openAgent(nodeId: string): OpenAgent | undefined {
  const record = nodesStore.getState().nodes[nodeId];
  if (record?.kind !== "terminal" && record?.kind !== "fleet") return undefined;
  if (!workspacesStore.getState().workspaces.some((w) => w.id === record.workspaceId)) return undefined;
  return { id: nodeId, kind: record.kind, name: nameOf(record), workspaceId: record.workspaceId };
}

/** The agents waiting in the open project, at this moment, the Fleets that wait on a decision included (`personActivities`). */
export function currentWaitingAgents(): WaitingAgent[] {
  return waitingAgents(
    workspacesStore.getState().workspaces.map((w) => w.id),
    nodesStore.getState().nodes,
    terminalStatusStore.getState().statuses,
    personActivities(),
  );
}

/** The agents waiting in the open project, in every workspace, the Fleets that wait on a decision included. */
export function useWaitingAgents(): WaitingAgent[] {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const activities = useActivities();
  return waitingAgents(
    workspaces.map((w) => w.id),
    nodes,
    statuses,
    activities,
  );
}

/** The agent after `currentId`, looping; the first one when `currentId` does not wait. */
export function nextWaiting(agents: readonly WaitingAgent[], currentId: string | null): WaitingAgent | undefined {
  return agents[(agents.findIndex((a) => a.id === currentId) + 1) % agents.length];
}
