import type { AgentId } from "@/ipc/pty";
import { LEVELS, type Level } from "@/mission/router";
import { memberOf } from "@/mission/store";
import { nodesStore, terminalOf, type NodeRecord } from "@/store/nodes";
import { MAX_SPAWN_DEPTH } from "./spawnFamily";

/**
 * The model of a sub-agent spawn_agent opens, the model router's say included. spawn_agent once knew only a model
 * named: with a Fleet's router on, a sub-agent the Fleet opened ran the model the Fleet named or the user's own
 * default, whatever its task's difficulty. A router now routes every sub-agent opened under it, as a mission's
 * router routes a team agent.
 */

/** Whether a Fleet's switch routes Claude agents: its mission's router, on a Claude Fleet (`@/mission/launch` teamModel). */
function fleetRoutes(record: NodeRecord | undefined): boolean {
  return record?.kind === "fleet" && record.payload.mission?.router === true && (record.payload.session?.agent ?? "claude") === "claude";
}

/** Whether a router is on at this very node: a Fleet's switch, a terminal's own, or its running mission's. */
function routesHere(nodes: Record<string, NodeRecord>, nodeId: string): boolean {
  const record = nodes[nodeId];
  if (record?.kind === "fleet") return fleetRoutes(record);
  const terminal = terminalOf(record);
  if (!terminal) return false;
  if (terminal.router === true) return true;
  const mission = memberOf(nodeId);
  return mission !== null && fleetRoutes(nodes[mission.fleetId]);
}

/**
 * Whether a model router governs what `nodeId` spawns: one is on at it, or at an agent up its spawn tree (who
 * spawned it, who spawned that one…). Read at each spawn, never copied into a child: the switches say where a
 * router is on, and turning one off stops it for the whole tree below. A sub-agent's own switch stays off, and
 * off it vetoes nothing above it, as a team agent's does not veto its mission's (`@/mission/router` modelFor).
 */
export function routerGoverns(nodeId: string): boolean {
  const nodes = nodesStore.getState().nodes;
  const seen = new Set<string>();
  let id: string | undefined = nodeId;
  // A cycle or a chain past the limit stops the walk, as it stops `spawnDepth`'s.
  while (id && !seen.has(id) && seen.size <= MAX_SPAWN_DEPTH + 1) {
    if (routesHere(nodes, id)) return true;
    seen.add(id);
    id = terminalOf(nodes[id])?.spawnedBy;
  }
  return false;
}

/** What the sub-agent starts on, and what its spawner should hear about it. */
export interface SpawnModel {
  /** Its model; none: the user's own default. */
  model?: string;
  /** The level that chose the model, when a router did. */
  level?: Level;
  /** The router took medium for want of a level. */
  defaulted?: true;
  /** A model named beside a level, which the router set aside. */
  dropped?: string;
  /** A level given while no router is on: it chose nothing. */
  unused?: Level;
  /** Refused: a model named with no level while a router is on. Nothing opens. */
  needsLevel?: string;
}

/**
 * Under a router (`routerGoverns`) and for a Claude sub-agent, the level chooses the model, as a mission's router
 * does (`@/mission/launch` teamModel): over a model named beside it; medium with neither, as hand_off's task
 * (`@/mcp/handOff`). A model named with no level is refused: letting it stand keeps every sub-agent on the model
 * its spawner is used to naming, which is what the switch is there to end, and dropping it for medium would open
 * a terminal on a model nobody chose. The four levels reach the four models, so nothing needs forcing; the way
 * around the router is the user's switch. With no router, or on another CLI, which a Claude id would not suit:
 * the model named, else none.
 */
export function spawnModel(parentId: string, child: AgentId, asked: { model?: string; level?: Level }): SpawnModel {
  const named = asked.model || undefined;
  if (child !== "claude" || !routerGoverns(parentId)) return { model: named, ...(asked.level ? { unused: asked.level } : {}) };
  if (asked.level) return { model: LEVELS[asked.level].model, level: asked.level, ...(named ? { dropped: named } : {}) };
  if (named) return { needsLevel: named };
  return { model: LEVELS.moyen.model, level: "moyen", defaulted: true };
}
