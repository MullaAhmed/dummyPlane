import { nodesStore, terminalOf } from "@/store/nodes";
import { statusOf } from "@/store/terminalStatus";
import type { ClosingAgents } from "@/store/ui";
import { sceneAccess } from "./sceneAccess";

/**
 * The trees spawn_agent grows: each sub-agent's payload names the terminal
 * whose agent spawned it (`spawnedBy`). Read here, acted on in `./spawn`.
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

/**
 * Sub-agents that reported: their task is done, their seat free, though their
 * terminal stays open for the user (an agent cannot close it).
 */
const reported = new Set<string>();

export function markReported(nodeId: string) {
  reported.add(nodeId);
}

/** The sub-agents at work now, every tree and workspace together: created, not stopped, not reported yet. */
export function runningSpawned(): number {
  return Object.entries(nodesStore.getState().nodes).filter(([id, record]) => {
    if (!terminalOf(record)?.spawnedBy) return false;
    if (launching.has(id)) return true;
    const state = statusOf(id).state;
    return !reported.has(id) && (state === "running" || state === "starting");
  }).length;
}

/**
 * Where the flow layout re-arranges a spawn tree once a sub-agent opened or
 * closed: `reflowSpawnTree(workspaceId, nodeId)` of `src/fleet/flowLayout.ts`,
 * not on this branch yet. Until then a sub-agent stays where `addTerminal` put
 * it, right of its parent and clear of every other node.
 */
export function afterSpawnTreeChange(workspaceId: string, nodeId: string): void {
  void workspaceId;
  void nodeId;
}

/** A closing to confirm, with the sub-agents its agents opened that it does not take already. */
export function withSpawnedChildren(closing: ClosingAgents): ClosingAgents {
  const leaving = new Set(closing.remove);
  const children = [...new Set(closing.agents.flatMap(spawnedDescendants))].filter((id) => !leaving.has(id));
  return children.length > 0 ? { ...closing, children } : closing;
}
