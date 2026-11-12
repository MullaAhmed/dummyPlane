import type { AgentId } from "@/ipc/pty";
import { LEVELS, type Level } from "@/mission/router";
import type { NodeRecord } from "@/store/nodes";

/**
 * The model of a sub-agent spawn_agent opens, the model router's say included. spawn_agent once knew only a model
 * named: with a Fleet's router on, a sub-agent the Fleet opened ran the user's own default model, whatever its task's
 * difficulty. The spawner's router now routes it as a mission's router routes a team agent.
 */

/** Whether the spawner's model router is on: a Fleet's switch (its mission's), or a terminal's own. */
export function spawnerRoutes(record: NodeRecord | undefined): boolean {
  if (record?.kind === "fleet") return record.payload.mission?.router === true;
  return record?.kind === "terminal" && record.payload.router === true;
}

/** What the sub-agent starts on: a model (none: the user's own default), and the level that chose it, if one did. */
export interface SpawnModel {
  model?: string;
  level?: Level;
}

/**
 * With the spawner's router on and a Claude sub-agent, the level given chooses the model, over a model named, as a
 * mission's router does (`@/mission/launch` teamModel); with no level a model named stands; with neither, medium, as
 * hand_off's task (`@/mcp/handOff`). With the router off, or on another CLI, which a Claude id would not suit: the
 * model named, else none.
 */
export function spawnModel(record: NodeRecord | undefined, child: AgentId, asked: { model?: string; level?: Level }): SpawnModel {
  const named = asked.model || undefined;
  if (child !== "claude" || !spawnerRoutes(record)) return { model: named };
  if (asked.level) return { model: LEVELS[asked.level].model, level: asked.level };
  if (named) return { model: named };
  return { model: LEVELS.moyen.model, level: "moyen" };
}
