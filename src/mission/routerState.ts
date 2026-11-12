import { useStore } from "zustand";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { MAX_SPAWN_DEPTH } from "@/agents/spawnFamily";
import { FLEET_CAPABLE } from "@/fleet/capable";
import { MANAGER_ROLE, type AgentId } from "@/ipc/pty";
import { nodesStore, terminalOf, useNodes, type NodeRecord } from "@/store/nodes";
import { memberOf, missionOf, setMission } from "./store";

/**
 * Whether the model router is on at a node, and what decided it. The global setting ("Model router" in Settings)
 * is the default; a terminal's or a Fleet's switch set on or off overrides it for that node and everything under it,
 * and the nearest switch set wins: a sub-agent's own, then its mission's Fleet's (an agent of the team, the Manager),
 * then its spawner's, up the spawn tree. A switch left unset never vetoes anything above it, as a team agent's
 * unset switch never vetoed its mission's; one set off does, for its node and all that node spawns. Read at each
 * spawn, never copied into a child: turning a switch over changes what its whole tree spawns next.
 */
export interface RouterState {
  on: boolean;
  /** The node whose switch decided it; none: the global setting did. */
  at?: string;
}

type Nodes = Record<string, NodeRecord>;

/** The switch set at this very node: a Fleet's (its mission's), a terminal's own; undefined when it follows. */
function ownSwitch(nodes: Nodes, nodeId: string): boolean | undefined {
  const record = nodes[nodeId];
  if (record?.kind === "fleet") return missionOf(record)?.router;
  return terminalOf(record)?.router;
}

/** The Fleet whose mission a terminal works for: its Manager's Fleet, or the running mission it is an agent of. */
function fleetOver(nodes: Nodes, nodeId: string): string | undefined {
  const payload = terminalOf(nodes[nodeId]);
  if (!payload) return undefined;
  if (payload.role === MANAGER_ROLE && payload.fleet) return payload.fleet;
  return memberOf(nodeId)?.fleetId;
}

/** The Fleet's switch over a terminal that works for its mission, when set. */
function fleetSwitch(nodes: Nodes, nodeId: string): RouterState | undefined {
  const fleet = fleetOver(nodes, nodeId);
  const on = fleet === undefined ? undefined : ownSwitch(nodes, fleet);
  return on === undefined ? undefined : { on, at: fleet };
}

/**
 * The nearest switch set from `nodeId` up: at each node its own (skipped at `nodeId` itself without `withOwn`),
 * then its mission's Fleet's, then its spawner's; else the global setting. A cycle or a chain past the limit stops
 * the walk, as it stops `spawnDepth`'s.
 */
function walk(nodes: Nodes, nodeId: string, global: boolean, withOwn: boolean): RouterState {
  const seen = new Set<string>();
  let id: string | undefined = nodeId;
  while (id && !seen.has(id) && seen.size <= MAX_SPAWN_DEPTH + 1) {
    const own = id === nodeId && !withOwn ? undefined : ownSwitch(nodes, id);
    if (own !== undefined) return { on: own, at: id };
    const byFleet = fleetSwitch(nodes, id);
    if (byFleet) return byFleet;
    seen.add(id);
    id = terminalOf(nodes[id])?.spawnedBy;
  }
  return { on: global };
}

/** Whether the router governs what `nodeId` spawns, and the sub-tasks its mission gives it. */
export function routerAt(nodes: Nodes, nodeId: string, global = modelRouterStore.getState().on): RouterState {
  return walk(nodes, nodeId, global, true);
}

/** What `nodeId` would be under with its own switch unset: what its switch reads as "follow". */
export function inheritedRouter(nodes: Nodes, nodeId: string, global = modelRouterStore.getState().on): RouterState {
  return walk(nodes, nodeId, global, false);
}

/** A mission's router: its Fleet's switch when set, else the global setting. */
export function missionRouterOn(mission: { router?: boolean }, global = modelRouterStore.getState().on): boolean {
  return mission.router ?? global;
}

/**
 * Turns a node's switch: a Fleet's (its mission's) or a terminal's. A state that is what the node would inherit
 * anyway is stored as unset, so the switch follows the setting above it again; any other is stored as set.
 */
export function setRouter(nodeId: string, on: boolean) {
  const nodes = nodesStore.getState().nodes;
  const value = inheritedRouter(nodes, nodeId).on === on ? undefined : on;
  if (nodes[nodeId]?.kind === "fleet") setMission(nodeId, { router: value });
  else nodesStore.getState().update(nodeId, { router: value });
}

/** A node's switch as it shows: on or off as the router stands there, inherited or set. */
export function useRouterOn(nodeId: string): boolean {
  const global = useStore(modelRouterStore, (s) => s.on);
  return useNodes((s) => routerAt(s.nodes, nodeId, global).on);
}

/**
 * Whether a terminal has the switch: an agent on a CLI with dummyPlane's tools (Claude, Codex), whose sub-agents and
 * sub-tasks the router can route. A Manager runs a board, never a plan's agent: the router has nothing to give it.
 */
export const hasRouterSwitch = (payload: { agent: AgentId; role?: string }) => FLEET_CAPABLE.includes(payload.agent) && payload.role !== MANAGER_ROLE;
