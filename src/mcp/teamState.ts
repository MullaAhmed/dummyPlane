import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, sessionOf } from "@/store/nodes";
import { isRestarting, isRunning } from "@/store/terminalStatus";
import { agentState, pillStateOf } from "@/mission/store";
import { outAgentState, outPillState } from "./protocol";

const MINUTE = 60_000;

/**
 * An agent's state in the words `team` and the lists of linked agents use. It is the canvas pill's own reading
 * (`pillStateOf`), so that `team` never says "idle" of an agent whose pill says Working, nor "stopped" of one that is
 * starting, and an agent resting on its report says so ("done", "blocked", "failed"). A node that is no agent keeps
 * the fleet's own reading.
 */
export function stateWord(nodeId: string): string {
  const restarting = isRestarting(nodeId);
  const pill = pillStateOf(nodeId);
  if (pill === null) return outAgentState(agentState(nodeId), restarting);
  return outPillState(pill, sessionOf(nodesStore.getState().nodes[nodeId])?.lastReport?.status, restarting);
}

/**
 * Whole minutes since the agent's activity last changed (it has been idle, at work or waiting this long); null when
 * its process does not run or no activity is known. "idle" says its turn is over, not that nothing runs: an agent
 * waiting on a background command is idle too, and this tells how long.
 */
export function stateMinutes(nodeId: string, now = Date.now()): number | null {
  const activity = agentActivityStore.getState().activities[nodeId];
  if (!activity || !isRunning(nodeId) || activity.left) return null;
  return Math.max(0, Math.floor((now - activity.since) / MINUTE));
}
