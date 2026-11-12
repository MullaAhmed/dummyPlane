import { talk } from "@/agents/talkWires";
import { messages } from "@/i18n";
import { agentMessages } from "@/mcp/messages";
import { nodesStore } from "@/store/nodes";
import { notify } from "./events";
import { endMission } from "./launch";
import { fleetNameOf } from "./manager";
import { missionOf } from "./store";

const t = () => messages(agentMessages);

/** Who stops the mission: its Fleet (`stop_mission`, with the reason it gives), or the user from the Fleet's panel. */
export type Stopper = { by: "fleet"; reason: string } | { by: "user" };

/**
 * Stops a running mission, as `finish` ends it (`endMission`): the agents created for it close, linked ones go back
 * to the project, its worktrees and branches stay until it is cleaned up, its Manager stays. The Manager hears who
 * stopped it; the Fleet, when it was the user, since it did not ask. False when no mission runs: nobody is told.
 * The Fleet's `stop_mission` and the panel's "Stop the mission" are this.
 */
export function stopMission(fleetId: string, stopper: Stopper): boolean {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (mission?.state !== "en_cours") return false;
  const l = t().lines;
  const fleet = fleetNameOf(fleetId);
  const user = stopper.by === "user";
  endMission(fleetId, user ? l.userStopSummary : l.stopSummary(fleet, stopper.reason));
  if (mission.manager) {
    if (mission.board) {
      talk(fleetId, mission.board);
      talk(mission.board, mission.manager);
    }
    notify(mission.manager, user ? l.userStopped : l.stoppedBy(fleet, stopper.reason));
  }
  if (user) notify(fleetId, l.userStoppedFleet);
  return true;
}
