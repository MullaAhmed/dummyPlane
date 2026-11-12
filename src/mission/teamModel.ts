import { modelRouterStore } from "@/app/modelRouterSetting";
import { FLEET_CAPABLE } from "@/fleet/capable";
import { fleetAgent } from "@/fleet/fleetAgent";
import type { AgentId } from "@/ipc/pty";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, sessionOf } from "@/store/nodes";
import type { Mission } from "./mission";
import { cliRouted, levelModel, type Level } from "./router";
import { missionRouterOn } from "./routerState";

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
 * The router's model for a task, on the CLI of the agent that takes it: a linked agent's own, a new agent's the
 * team's. A linked agent's switch, when set, decides for it (on even with the mission's off, off even with it on);
 * else the mission's router does (the Fleet's switch, else the global setting). Routed, the task's level picks the
 * model on that CLI (`@/mission/router` levelModel: Claude's levels, Settings' map for another), and a linked agent
 * keeps the model it has when the task names no level or its CLI has no model for it. Not routed, none: the agent
 * starts on its CLI's own model.
 */
export function teamModel(fleetId: string, mission: Mission, task: { level?: Level }, linked?: TerminalPayload): string | undefined {
  if (!(linked?.router ?? missionRouterOn(mission))) return undefined;
  const cli = linked?.agent ?? teamAgent(fleetId);
  return (task.level ? levelModel(cli, task.level, modelRouterStore.getState().levels) : undefined) ?? linked?.model;
}

/**
 * Whether the mission's tasks need a level: its router is on and a level picks a model on its team's CLI (always on
 * Claude; on another, once Settings maps one). A Codex team with nothing mapped plans as it did, levels optional.
 */
export function levelsRequired(fleetId: string, mission: Mission): boolean {
  return missionRouterOn(mission) && cliRouted(teamAgent(fleetId), modelRouterStore.getState().levels);
}

