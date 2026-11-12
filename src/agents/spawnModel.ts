import { modelRouterStore } from "@/app/modelRouterSetting";
import { messages } from "@/i18n";
import type { AgentId } from "@/ipc/pty";
import { agentMessages } from "@/mcp/messages";
import { outLevel } from "@/mcp/protocol";
import { levelModel, type Level } from "@/mission/router";
import { routerAt } from "@/mission/routerState";
import { nodeNameOf, nodesStore } from "@/store/nodes";
import { AGENTS } from "./catalog";

/**
 * The model of a sub-agent spawn_agent opens, the model router's say included. spawn_agent once knew only a model
 * named: with a Fleet's router on, a sub-agent the Fleet opened ran the model the Fleet named or the user's own
 * default, whatever its task's difficulty. A router now routes every sub-agent opened under it, as a mission's
 * router routes a team agent, and it is on everywhere unless Settings or a switch turns it off.
 */

/** Why a level picked no model: the router is off (at a node's switch, or in Settings), or the CLI has none for it. */
export type Unrouted = { off: true; at?: string } | { off?: undefined; cli: AgentId };

/**
 * Why a level picked no model, as `callerId` reads it: its own switch, the switch of the node above it (or of the
 * Fleet its task goes to) by name, Settings, or a CLI with no model for the level.
 */
export function unroutedText(why: Unrouted, level: Level, callerId: string): string {
  const u = messages(agentMessages).unrouted;
  if (!why.off) return u.noModel(AGENTS[why.cli].label, outLevel(level));
  if (why.at === undefined) return u.settings;
  return why.at === callerId ? u.here : u.at(nodeNameOf(nodesStore.getState().nodes[why.at]) || "an agent above you");
}

/** What the sub-agent starts on, and what its spawner should hear about it. */
export interface SpawnModel {
  /** Its model; none: its CLI's own default. */
  model?: string;
  /** The level that chose the model, when a router did. */
  level?: Level;
  /** The router took medium for want of a level. */
  defaulted?: true;
  /** A model named beside a level, which the router set aside. */
  dropped?: string;
  /** A level (given, or medium for want of one) that chose nothing, and why. */
  unused?: { level: Level; why: Unrouted };
  /** Refused: a model named with no level while a router is on, for a Claude sub-agent. Nothing opens. */
  needsLevel?: string;
}

/**
 * Under a router (`@/mission/routerState` routerAt: the nearest switch set at the spawner or above it, else
 * Settings), the level chooses the model on the sub-agent's CLI, as a mission's router does
 * (`@/mission/launch` teamModel): Claude's levels, Settings' map for another CLI; over a model named beside it;
 * medium with neither, as hand_off's task (`@/mcp/handOff`). For a Claude sub-agent, a model named with no level is
 * refused: letting it stand keeps every sub-agent on the model its spawner is used to naming, which is what the
 * router is there to end, and dropping it for medium would open a terminal on a model nobody chose. The four
 * levels reach the four models, so nothing needs forcing; the way around the router is the user's switch. Another
 * CLI keeps a model named with no level, and one named beside a level its map leaves empty. With no router: the
 * model named, else none.
 */
export function spawnModel(parentId: string, child: AgentId, asked: { model?: string; level?: Level }): SpawnModel {
  const named = asked.model || undefined;
  const router = routerAt(nodesStore.getState().nodes, parentId);
  if (!router.on) return { model: named, ...(asked.level ? { unused: { level: asked.level, why: { off: true, at: router.at } } } : {}) };
  if (!asked.level && named) return child === "claude" ? { needsLevel: named } : { model: named };
  const level = asked.level ?? "moyen";
  const defaulted = asked.level ? {} : { defaulted: true as const };
  const model = levelModel(child, level, modelRouterStore.getState().levels);
  if (!model) return { model: named, ...defaulted, unused: { level, why: { cli: child } } };
  return { model, level, ...defaulted, ...(named ? { dropped: named } : {}) };
}
