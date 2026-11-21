import { useStore } from "zustand";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { MAX_SPAWN_DEPTH } from "@/agents/spawnFamily";
import { FLEET_CAPABLE } from "@/fleet/capable";
import { MANAGER_ROLE, type AgentId } from "@/ipc/pty";
import { AGENTS } from "@/agents/catalog";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf, useNodes, type NodeRecord } from "@/store/nodes";
import { NEW_AGENT, sameName } from "./mission";
import { linkedTeamAgents, memberOf, missionOf, setMission } from "./store";

/**
 * Whether the model router is on at a node, and what decided it. The global setting ("Model router" in Settings)
 * is the default; a terminal's or a Fleet's switch set on or off overrides it for that node and everything under it,
 * and the nearest switch set wins: a sub-agent's own, then its mission's Fleet's (an agent of the team, the Manager),
 * then its spawner's, up the spawn tree. A switch left unset never vetoes anything above it, as a team agent's
 * unset switch never vetoed its mission's; one set off does, for its node and all that node spawns. Read at each
 * spawn, never copied into a child: turning a switch over changes what its whole tree spawns next.
 *
 * A Fleet's switch reaches a linked agent, or an agent of a linked group, only while it works for the mission:
 * from the plan that names it until the go-ahead, then while the mission runs with its sub-task sent (`memberOf`).
 * Before it is named, and once the mission is over, the agent follows its own switch, its spawner's and Settings.
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

/**
 * The Fleet whose mission a terminal works for: its Manager's Fleet, the running mission it is an agent of, or a
 * pending plan (before or during its go-ahead) that gives it, a linked agent, a sub-task. So what its switch shows
 * before the go-ahead is what the go-ahead applies (`./teamModel`).
 */
function fleetOver(nodes: Nodes, nodeId: string): string | undefined {
  const payload = terminalOf(nodes[nodeId]);
  if (!payload) return undefined;
  if (payload.role === MANAGER_ROLE && payload.fleet) return payload.fleet;
  return memberOf(nodeId)?.fleetId ?? planningFleet(nodes, nodeId, payload);
}

/**
 * The Fleet whose pending plan names this linked agent, read from the plan's names then its Fleet's wires; an agent
 * with no name goes by its CLI's label, as `linkedTeamAgents` lists it and a plan names it.
 */
function planningFleet(nodes: Nodes, nodeId: string, payload: TerminalPayload): string | undefined {
  const name = payload.name || AGENTS[payload.agent].label;
  for (const [fleetId, record] of Object.entries(nodes)) {
    const mission = missionOf(record);
    if (mission?.state !== "plan" && mission?.state !== "lancement") continue;
    if (!mission.plan?.some((task) => task.agent !== NEW_AGENT && sameName(task.agent, name))) continue;
    if (linkedTeamAgents(fleetId).some((agent) => agent.nodeId === nodeId)) return fleetId;
  }
  return undefined;
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

/** Stores a node's switch: a Fleet's (its mission's) or a terminal's; undefined: unset, it follows again. */
function storeRouter(nodeId: string, value: boolean | undefined) {
  if (nodesStore.getState().nodes[nodeId]?.kind === "fleet") setMission(nodeId, { router: value });
  else nodesStore.getState().update(nodeId, { router: value });
}

/**
 * Turns a node's switch on or off: the state is stored as set, even one it would inherit anyway, so it holds
 * whatever Settings or the switches above it become. "Follow" (`followRouter`) unsets it.
 */
export function setRouter(nodeId: string, on: boolean) {
  storeRouter(nodeId, on);
}

/** "Follow Settings", "Follow the switch above": the node's switch unset, it follows what it inherits again. */
export function followRouter(nodeId: string) {
  storeRouter(nodeId, undefined);
}

/** A node's switch as it shows: on or off as the router stands there, inherited or set. */
export function useRouterOn(nodeId: string): boolean {
  const global = useStore(modelRouterStore, (s) => s.on);
  return useNodes((s) => routerAt(s.nodes, nodeId, global).on);
}

/**
 * What the node's "Follow" reset would follow, while its own switch is set: "settings" when nothing above it is set,
 * "above" when a Fleet's or a spawner's switch is; null while it follows already, and the reset is not offered.
 */
export function useRouterFollow(nodeId: string): "settings" | "above" | null {
  const global = useStore(modelRouterStore, (s) => s.on);
  return useNodes((s) => (ownSwitch(s.nodes, nodeId) === undefined ? null : inheritedRouter(s.nodes, nodeId, global).at === undefined ? "settings" : "above"));
}

/** Why a terminal's switch has nothing to route: a Manager's, or an agent on a CLI without dummyPlane's tools. */
export type RouterInert = "manager" | "agent";

/**
 * Whether a terminal's switch can act. Every terminal shows the switch (its header, its "⋯" menu, its Edit panel), so
 * it is found in one place whatever runs there; this says whether it does anything. It does on an agent on a CLI with
 * dummyPlane's tools (Claude, Codex), whose sub-agents and sub-tasks the router routes. It does not on a Manager, who
 * runs a board, never a plan's agent, and whose tools hold no `spawn_agent`: its Fleet's switch routes the mission.
 * Nor does it on any other CLI or a shell, which get none of dummyPlane's tools and so open no sub-agents.
 *
 * Null: it acts. Else the reason, and the switch shows inert: off whatever Settings says (nothing is routed there),
 * greyed out, never written, with no "Follow".
 */
export function routerInert(payload: { agent: AgentId; role?: string }): RouterInert | null {
  if (payload.role === MANAGER_ROLE) return "manager";
  return FLEET_CAPABLE.includes(payload.agent) ? null : "agent";
}
