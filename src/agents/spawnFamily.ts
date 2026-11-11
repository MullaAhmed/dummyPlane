import { nodesStore, terminalOf } from "@/store/nodes";
import { statusOf } from "@/store/terminalStatus";
import type { ClosingAgents } from "@/store/ui";
import { sceneAccess } from "./sceneAccess";

/**
 * The families spawn_agent grows: each sub-agent's payload names the terminal
 * whose agent spawned it (`spawnedBy`). Their depth, their seats and their
 * closing are read here; spawning is `./spawn`, their layout `./spawnTree`.
 */

/** How many spawn_agent levels a tree has at most: a top agent's sub-agent is at depth 1. */
export const MAX_SPAWN_DEPTH = 3;

/** The agent that spawned `nodeId`, if one did. */
export function spawnedByOf(nodeId: string): string | undefined {
  return terminalOf(nodesStore.getState().nodes[nodeId])?.spawnedBy;
}

/** How many spawn_agent hops lead from `nodeId` up to its top agent: 0 for an agent nobody spawned. */
export function spawnDepth(nodeId: string): number {
  const nodes = nodesStore.getState().nodes;
  const seen = new Set<string>();
  let depth = 0;
  let id: string | undefined = nodeId;
  // A cycle or a chain past the limit stops the walk: the limit is all that matters.
  while (id && !seen.has(id) && depth <= MAX_SPAWN_DEPTH) {
    seen.add(id);
    id = terminalOf(nodes[id])?.spawnedBy;
    if (id) depth++;
  }
  return depth;
}

/** Whether a node is on its workspace's canvas: a closed one stays in memory, its element deleted, for Ctrl+Z. */
function onCanvas(nodeId: string): boolean {
  const record = nodesStore.getState().nodes[nodeId];
  const element = record && sceneAccess(record.workspaceId)?.elements().find((e) => e.id === nodeId);
  return element !== undefined && !element.isDeleted;
}

/** The sub-agents spawned from `nodeId`, theirs too, still on the canvas: they close with it if the user wants. */
export function spawnedDescendants(nodeId: string): string[] {
  const children = new Map<string, string[]>();
  for (const [id, record] of Object.entries(nodesStore.getState().nodes)) {
    const parent = terminalOf(record)?.spawnedBy;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const found: string[] = [];
  const seen = new Set([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      found.push(child);
      queue.push(child);
    }
  }
  return found.filter(onCanvas);
}

/** Sub-agents created and not yet given their task: they count before their process runs. */
const launching = new Set<string>();

export function markLaunching(nodeId: string, on: boolean) {
  if (on) launching.add(nodeId);
  else launching.delete(nodeId);
}

/** Whether a sub-agent still waits for its Claude and its task: a line typed now could land in its shell. */
export function isLaunching(nodeId: string): boolean {
  return launching.has(nodeId);
}

/**
 * Sub-agents that reported: their task is done, their seat free, though their
 * terminal stays open for the user (an agent cannot close it).
 */
const reported = new Set<string>();

export function markReported(nodeId: string) {
  reported.add(nodeId);
}

/** A sub-agent created, not stopped, not reported yet. */
function atWork(id: string): boolean {
  if (launching.has(id)) return true;
  const state = statusOf(id).state;
  return !reported.has(id) && (state === "running" || state === "starting");
}

/** The sub-agents at work now, every tree and workspace together: created, not stopped, not reported yet. */
export function runningSpawned(): number {
  return Object.entries(nodesStore.getState().nodes).filter(([id, record]) => Boolean(terminalOf(record)?.spawnedBy) && atWork(id)).length;
}

/**
 * Whether a sub-agent `nodeId` opened is still at work: its turn ending is a
 * wait for their reports, not the end of its task. `busy` narrows the running
 * ones (their activity); one still launching always counts.
 */
export function hasSpawnedAtWork(nodeId: string, busy: (id: string) => boolean = () => true): boolean {
  return Object.entries(nodesStore.getState().nodes).some(
    ([id, record]) => terminalOf(record)?.spawnedBy === nodeId && (launching.has(id) || (atWork(id) && busy(id))),
  );
}

/** A closing to confirm, with the sub-agents its agents opened that it does not take already. */
export function withSpawnedChildren(closing: ClosingAgents): ClosingAgents {
  const leaving = new Set(closing.remove);
  const children = [...new Set(closing.agents.flatMap(spawnedDescendants))].filter((id) => !leaving.has(id));
  return children.length > 0 ? { ...closing, children } : closing;
}
