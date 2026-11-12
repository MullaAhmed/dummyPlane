import { modelRouterStore } from "@/app/modelRouterSetting";
import { FLEET_CAPABLE } from "@/fleet/capable";
import { fleetAgent } from "@/fleet/fleetAgent";
import type { AgentId } from "@/ipc/pty";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, sessionOf, terminalOf } from "@/store/nodes";
import { NEW_AGENT, sameName, type Mission } from "./mission";
import { cliRouted, levelModel, type Level } from "./router";
import { missionRouterOn, routerAt } from "./routerState";
import { linkedTeamAgents } from "./store";

/**
 * The model router's say over a mission's team: which CLI it runs, which model a sub-task's level gives its agent,
 * and whether its tasks need a level. Apart from `./launch`, which forms the team, so the tools that read it
 * (add_tasks, hand_off, the mission panel) do not pull the launch in.
 */

/** The CLI a fleet's team runs on: the fleet's own (fleet/fleetAgent.ts). */
export function teamAgent(fleetId: string): AgentId {
  const agent = sessionOf(nodesStore.getState().nodes[fleetId])?.agent;
  return agent && FLEET_CAPABLE.includes(agent) ? agent : fleetAgent();
}

/**
 * Whether the router routes a linked agent's sub-task, read as `./routerState` routerAt reads it once the agent
 * works for the mission, so its switch shows before the go-ahead what the go-ahead applies: its own switch, then
 * the mission's Fleet's, then its spawner's and theirs, then Settings.
 */
function linkedRouted(mission: Mission, linked: TerminalPayload): boolean {
  if (linked.router !== undefined) return linked.router;
  if (mission.router !== undefined) return mission.router;
  return linked.spawnedBy ? routerAt(nodesStore.getState().nodes, linked.spawnedBy).on : modelRouterStore.getState().on;
}

/**
 * The router's model for a task, on the CLI of the agent that takes it: a linked agent's own, a new agent's the
 * team's. A linked agent whose own switch is set off keeps the model it has: the user turned the router off for it.
 * Else whether it is routed is read as its switch shows it (`linkedRouted`); a new agent follows the mission's
 * router (the Fleet's switch, else Settings). Routed, the task's level picks the model on that CLI (`@/mission/router`
 * levelModel: Claude's levels, Settings' map for another), and a linked agent keeps the model it has when the task
 * names no level or its CLI has no model for it. Not routed, none: the agent starts on its CLI's own model.
 */
export function teamModel(fleetId: string, mission: Mission, task: { level?: Level }, linked?: TerminalPayload): string | undefined {
  if (linked?.router === false) return linked.model;
  if (!(linked ? linkedRouted(mission, linked) : missionRouterOn(mission))) return undefined;
  const cli = linked?.agent ?? teamAgent(fleetId);
  return (task.level ? levelModel(cli, task.level, modelRouterStore.getState().levels) : undefined) ?? linked?.model;
}

/**
 * The model a plan's sub-task starts its agent on, as the go-ahead will choose it (`teamModel`): a linked agent's,
 * found by the name the plan gives it among the agents wired to the Fleet, else a new agent's.
 */
export function subTaskModel(fleetId: string, mission: Mission, task: { agent: string; level?: Level }): string | undefined {
  const linked = task.agent === NEW_AGENT ? undefined : linkedTeamAgents(fleetId).find((agent) => sameName(agent.name, task.agent));
  return teamModel(fleetId, mission, task, linked ? terminalOf(nodesStore.getState().nodes[linked.nodeId]) : undefined);
}

/**
 * Whether the mission's tasks need a level: its router is on and a level picks a model on its team's CLI (always on
 * Claude; on another, once Settings maps one). A Codex team with nothing mapped plans as it did, levels optional.
 */
export function levelsRequired(fleetId: string, mission: Mission): boolean {
  return missionRouterOn(mission) && cliRouted(teamAgent(fleetId), modelRouterStore.getState().levels);
}

