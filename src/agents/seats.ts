import { subagentSettingsStore } from "@/app/subagentSettings";
import type { Seats } from "@/mcp/messages";
import { isManagerNode, nodeNameOf, nodesStore, terminalOf, type NodeRecord } from "@/store/nodes";
import { MAX_SPAWN_DEPTH, spawnedAtWork } from "./spawnFamily";

/**
 * What a sub-agent costs its spawner's seats, and which sub-agents spend the user's usage outside their mission's plan:
 * the reads `spawn_agent` (./spawn) and a message that wakes a finished sub-agent into new work (`@/mcp/linkTools`)
 * share, so that both refuse for the same cap and in the same words.
 */

/**
 * Who holds the seats, by folder, every project's: `Superman, Aquaman (BOS-Mono); Shazam (upload-plans-hulk)`.
 * A cap held in another project is otherwise read as one's own closed terminals.
 */
function seatHolders(ids: readonly string[]): string {
  const nodes = nodesStore.getState().nodes;
  const byFolder = new Map<string, string[]>();
  for (const id of ids) {
    const folder = terminalOf(nodes[id])?.cwd.split(/[\\/]/).filter(Boolean).pop() ?? "?";
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), nodeNameOf(nodes[id]) || "a sub-agent"]);
  }
  return [...byFolder].map(([folder, names]) => `${names.join(", ")} (${folder})`).join("; ");
}

/**
 * The seats of the cap on sub-agents running at once (dummyPlane's Settings, every project counted) as a refusal
 * tells them, or null while one is free for one more sub-agent at work.
 */
export function fullCap(): Seats | null {
  const max = subagentSettingsStore.getState().maxSpawned;
  const running = spawnedAtWork();
  return running.length >= max ? { held: running.length, max, who: seatHolders(running) } : null;
}

/** Whether `record` is a Fleet whose mission is under way (its team launching or at work): its mission's plan is what it runs beside. */
export function underway(record: NodeRecord | undefined): boolean {
  if (record?.kind !== "fleet") return false;
  const state = record.payload.mission?.state;
  return state === "lancement" || state === "en_cours";
}

/**
 * What a caller refused for the cap can do next (`tooMany`, `wakeFull`): a Fleet and a mission's Manager have no shell,
 * and queue the task when a mission is under way; a manager sub-agent waits for its own; only an agent with a shell may
 * do the work itself.
 */
export function whoWaits(nodeId: string): "queue" | "wait" | "manager" | "agent" {
  const record = nodesStore.getState().nodes[nodeId];
  if (record?.kind === "fleet") return underway(record) ? "queue" : "wait";
  if (isManagerNode(nodeId)) return "queue";
  return terminalOf(record)?.coordinator ? "manager" : "agent";
}

/** Whether a model named by hand (an alias or an id) is of the high or extreme level: Opus or Fable. */
export const costlyModel = (model: string) => /opus|fable/i.test(model);

/**
 * Whether what `callerId` opens with spawn_agent is held to level low or medium (and to no Opus or Fable named by hand,
 * with the router off), and by whom: `fleet` when the caller is a Fleet whose mission is under way, its ad-hoc agents
 * running beside the plan; `below` when it is one of those ad-hoc agents or descends from one, the spawn_agent chain
 * (`spawnedBy`) leading up to such a Fleet. Null otherwise: a mission's Manager, its team and what they open (the plan
 * chose their levels), an agent no Fleet is over, or any agent once its Fleet's mission ended or before it launched.
 * `fleetId` is that Fleet: what `callerId` opens runs beside its mission, and its board gives it a card (`@/kanban/adHocCards`).
 */
export function adHocOf(callerId: string): { fleetId: string; limit: "fleet" | "below" } | null {
  const nodes = nodesStore.getState().nodes;
  const seen = new Set<string>();
  let id: string | undefined = callerId;
  // A cycle or a chain past the limit stops the walk, as it stops `spawnDepth`'s.
  while (id && !seen.has(id) && seen.size <= MAX_SPAWN_DEPTH + 1) {
    const record: NodeRecord | undefined = nodes[id];
    if (!record) return null;
    if (record.kind === "fleet") {
      if (!underway(record)) return null;
      // An ad-hoc agent the plan names (a linked agent of the mission) is a member: its levels are the plan's.
      const members = new Set(record.payload.mission?.members.map((m) => m.nodeId));
      if ([...seen].some((chained) => members.has(chained))) return null;
      return { fleetId: id, limit: id === callerId ? "fleet" : "below" };
    }
    // Its Manager runs its team from the plan: they, and what they open, are the mission's, not beside it.
    if (isManagerNode(id)) return null;
    seen.add(id);
    id = terminalOf(record)?.spawnedBy;
  }
  return null;
}

/** What `adHocOf` says of who binds `callerId`'s spawn_agent: the limit alone. */
export const adHocLimit = (callerId: string): "fleet" | "below" | null => adHocOf(callerId)?.limit ?? null;
