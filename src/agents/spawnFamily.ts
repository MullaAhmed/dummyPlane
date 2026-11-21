import { agentActivityStore } from "@/store/agentActivity";
import type { TerminalReport } from "@/nodes/types";
import { isManagerNode, nodesStore, terminalOf } from "@/store/nodes";
import { isRestarting, statusOf } from "@/store/terminalStatus";
import type { ClosingAgents } from "@/store/ui";
import { isClosedNode } from "./closedNode";
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

/**
 * Whether a sub-agent's last task is reported and no new work was typed into it since. The set above is the app's run
 * only; `lastReport` is saved with the node and cleared by the first line typed after it (`onNewWork`), so after a
 * restart it alone says so: a check that read the set only would let a finished agent be woken, and seated, unasked.
 */
export function hasReported(nodeId: string): boolean {
  return reported.has(nodeId) || terminalOf(nodesStore.getState().nodes[nodeId])?.lastReport !== undefined;
}

/** New work its parent gave it (message_agent): at work again, it holds a seat and the duplicate guard sees it. */
export function unmarkReported(nodeId: string) {
  reported.delete(nodeId);
}

/** How long a message that gave a finished sub-agent new work holds its seat while the message is not typed (a session to start, a dialog open). */
export const WAKE_HOLD_MS = 120_000;

/** The sub-agents given new work that had reported, each with the report that stood then and the time (`wakeHeld`). */
const waking = new Map<string, { since: number; report: TerminalReport | undefined }>();

/**
 * The message that gives a sub-agent that reported new work, or starts its stopped session again, seats it at once:
 * its report stands until the message is typed, its process runs only once started again, and two such messages in
 * a row must not both pass a cap with one seat left, as `launching` holds a spawn's.
 */
export function holdWake(nodeId: string) {
  waking.set(nodeId, { since: Date.now(), report: terminalOf(nodesStore.getState().nodes[nodeId])?.lastReport });
}

/** Its message will not be typed (its session did not start again): the seat is free again. */
export function releaseWake(nodeId: string) {
  waking.delete(nodeId);
}

/**
 * Whether a sub-agent still holds the seat its new work gave it. From the moment its own state says so the seat is its
 * state's, and the hold lets go: its report changed (the message typed cleared it, or it reported again), or, with
 * none to clear, its process runs; or after WAKE_HOLD_MS.
 */
function wakeHeld(id: string): boolean {
  const held = waking.get(id);
  if (held === undefined) return false;
  const report = terminalOf(nodesStore.getState().nodes[id])?.lastReport;
  const answered = report !== held.report || (held.report === undefined && statusOf(id).state === "running");
  if (answered || Date.now() - held.since > WAKE_HOLD_MS) {
    waking.delete(id);
    return false;
  }
  return true;
}

/**
 * A sub-agent created, not stopped, not reported yet. Its report is kept with it (`lastReport`), the set above
 * only for this run: after a restart its resumed session is still a finished one, until new work clears it.
 * One whose terminal is being started again is at work through it: its old process's exit frees no seat.
 */
export function atWork(id: string): boolean {
  // First: a terminal the user closed holds nothing, though its launch is still waiting for a Claude that never comes
  // (a minute) or a start that began as it closed set its status to running.
  if (isClosedNode(id)) return false;
  if (launching.has(id) || wakeHeld(id)) return true;
  if (reported.has(id) || terminalOf(nodesStore.getState().nodes[id])?.lastReport) return false;
  const state = statusOf(id).state;
  return state === "running" || state === "starting" || isRestarting(id);
}

/**
 * Whether a sub-agent holds one of the spawn cap's seats: at work, and its agent still in its terminal. One that
 * quit to its shell (`left`) is a process that runs no agent: it spends nothing and does no work, so it holds none
 * (a mission's team keeps its seat then: its agent is resumed in place, `relaunchTakesSeat`).
 */
function holdsSeat(id: string): boolean {
  if (!atWork(id)) return false;
  if (launching.has(id) || waking.has(id) || isRestarting(id)) return true;
  return agentActivityStore.getState().activities[id]?.left !== true;
}

/**
 * Whether the cap on sub-agents counts `id`: an agent another agent spawned that is not a Manager's team agent, which
 * a mission's Max active agents counts instead.
 */
export function isCapped(id: string): boolean {
  const parent = terminalOf(nodesStore.getState().nodes[id])?.spawnedBy;
  return parent ? !isManagerNode(parent) : false;
}

/**
 * The sub-agents holding a seat of the cap now, every tree and workspace together: created, not stopped, not
 * closed, not reported yet. A mission's agents under their Manager are its team, counted by Max active agents, not
 * here; theirs count.
 */
export function spawnedAtWork(): string[] {
  return Object.keys(nodesStore.getState().nodes).filter((id) => isCapped(id) && holdsSeat(id));
}

export function runningSpawned(): number {
  return spawnedAtWork().length;
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
