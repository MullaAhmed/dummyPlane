import { heldByDialog, pendingDialog } from "@/agents/dialogs";
import { takenOver } from "@/agents/finishedStop";
import { hasSpawnedAtWork, isLaunching } from "@/agents/spawnFamily";
import { isRestarting } from "@/store/terminalStatus";
import { handingOver, moving } from "./active";
import { agentState } from "./store";

/**
 * Why a team terminal stays open when the mission's cleanup, or its Manager's `close_agent`, would close it: what its
 * closing would cut. The policy for both lives here, so that it changes in one place.
 */
export type OpenReason = "launching" | "restarting" | "dialog" | "atWork" | "waiting" | "moving" | "subAgents" | "user";

/** Something under way in the terminal itself: still starting, held by a dialog only the user answers, at work or waiting for an answer. */
function ownWork(nodeId: string): OpenReason | null {
  if (isLaunching(nodeId)) return "launching";
  if (isRestarting(nodeId)) return "restarting";
  if (heldByDialog(nodeId) || pendingDialog(nodeId) !== null) return "dialog";
  const state = agentState(nodeId);
  return state === "travaille" ? "atWork" : state === "attend" ? "waiting" : null;
}

/** Whether the terminal is busy in its own right: what refuses the Fleet's cleanup while its Manager or an agent made for it is so. */
export const busyNow = (nodeId: string): boolean => ownWork(nodeId) !== null;

/**
 * Why the terminal `nodeId` must stay open, or null when it may close: an agent that finished (reported, idle at its
 * prompt) or stopped. Never one at work, waiting for an answer, held by a dialog, still launching or starting again,
 * one the merge queue or a hand-over is moving on, one whose own sub-agents are at work (their reports are typed into
 * it), or one the user is at.
 */
export function keptOpen(nodeId: string): OpenReason | null {
  const own = ownWork(nodeId);
  if (own) return own;
  if (moving.has(nodeId) || handingOver.has(nodeId)) return "moving";
  if (hasSpawnedAtWork(nodeId, busyNow)) return "subAgents";
  if (takenOver(nodeId)) return "user";
  return null;
}
