import { toast } from "sonner";
import { messages } from "@/i18n";
import { agentMessages } from "@/mcp/messages";
import { nodesStore } from "@/store/nodes";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";
import { activeCount, hasSeat } from "./active";
import { notify } from "./events";
import type { Member, Mission } from "./mission";
import { missionMessages } from "./messages";
import { pumpQueue } from "./queue";
import { isFleetClosed, missionOf, missionRunner } from "./store";

/** The running missions, of fleets still open, that `nodeId` is a member of. */
function memberships(nodeId: string): { fleetId: string; mission: Mission; member: Member }[] {
  const found: { fleetId: string; mission: Mission; member: Member }[] = [];
  for (const [fleetId, record] of Object.entries(nodesStore.getState().nodes)) {
    const mission = missionOf(record);
    if (mission?.state !== "en_cours" || isFleetClosed(fleetId)) continue;
    const member = mission.members.find((m) => m.nodeId === nodeId);
    if (member) found.push({ fleetId, mission, member });
  }
  return found;
}

/**
 * A member's terminal starts restarting. The relaunch tool refuses a full team; the user's own restart (its menu, its
 * resume card, a keystroke, "Resume all") is theirs and goes ahead. Counted from now on, the member keeps the queue from
 * starting anyone until fewer than Max agents are at work; the restart that takes the team past it is told, once: to
 * the mission's runner, and to the user.
 */
function restartBegan(nodeId: string) {
  for (const { fleetId, mission, member } of memberships(nodeId)) {
    // It held no seat before (stopped after its sub-task was typed), and holds one now.
    const newlyCounted = member.sentAt !== undefined && !isRunning(nodeId) && hasSeat(mission, nodeId);
    const active = activeCount(fleetId, mission);
    // The one restart that crosses the line: Resume all's next ones, past it already, say nothing more.
    if (!newlyCounted || active !== mission.maxAgents + 1) continue;
    notify(missionRunner(fleetId), messages(agentMessages).lines.pastMaxAgents(member.name, active, mission.maxAgents));
    toast(messages(missionMessages).pastMaxAgents(member.name, mission.name ?? "", active, mission.maxAgents));
  }
}

/** A member's restart ended without its terminal running (its spawn failed): the queue may have waited on its seat meanwhile. */
function restartEnded(nodeId: string) {
  if (isRunning(nodeId)) return;
  for (const { fleetId } of memberships(nodeId)) void pumpQueue(fleetId).catch(() => undefined);
}

/**
 * Watches the restarts of running missions' members (`relaunchSession`, `isRestarting`), whoever asked for them.
 * Installed at boot, beside `installRedelivery`. It never throws: it runs inside the store's update, in the restart.
 */
export function installRestartWatch(): () => void {
  return terminalStatusStore.subscribe((state, previous) => {
    if (state.restarts === previous.restarts) return;
    try {
      for (const nodeId of Object.keys(state.restarts)) if (!previous.restarts[nodeId]) restartBegan(nodeId);
      for (const nodeId of Object.keys(previous.restarts)) if (!state.restarts[nodeId]) restartEnded(nodeId);
    } catch (error) {
      console.warn("restart of a mission's agent not watched", error);
    }
  });
}
