import { nodesStore } from "@/store/nodes";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";
import { assign, deliveryPending } from "./launch";
import type { Member } from "./mission";
import { missionOf } from "./store";

/**
 * The member `nodeId` is in a running mission, whose sub-task waits to be typed: recorded by `assign` (`brief`),
 * never typed (no `sentAt`), still its own (not handed over, not reported).
 */
function undelivered(nodeId: string): { fleetId: string; member: Member; brief: string } | null {
  for (const [fleetId, record] of Object.entries(nodesStore.getState().nodes)) {
    const mission = missionOf(record);
    if (mission?.state !== "en_cours") continue;
    const member = mission.members.find((m) => m.nodeId === nodeId && m.brief && m.sentAt === undefined && !m.handedTo && !m.report && !m.abandoned);
    if (member?.brief) return { fleetId, member, brief: member.brief };
  }
  return null;
}

/**
 * Types a member's sub-task once more if nobody is typing it: the wait for its session lives in memory, and dummyPlane
 * may have restarted since, or its terminal stopped and started again. `assign` waits for its session as at the go-ahead.
 */
export function redeliver(nodeId: string): boolean {
  if (!isRunning(nodeId) || deliveryPending(nodeId)) return false;
  const found = undelivered(nodeId);
  if (!found) return false;
  void assign(found.fleetId, found.member, found.brief).catch((error: unknown) => console.warn(`sub-task of ${nodeId} not typed`, error));
  return true;
}

/**
 * Watches the terminals of running missions' members: one that starts running again with its sub-task never typed
 * gets it. Those already running when it installs are looked at once. Installed at boot, beside `installMissionEvents`.
 */
export function installRedelivery(): () => void {
  for (const record of Object.values(nodesStore.getState().nodes)) {
    const mission = missionOf(record);
    if (mission?.state !== "en_cours") continue;
    for (const member of mission.members) redeliver(member.nodeId);
  }
  return terminalStatusStore.subscribe((state, previous) => {
    for (const [nodeId, status] of Object.entries(state.statuses)) {
      if (status.state === "running" && previous.statuses[nodeId]?.state !== "running") redeliver(nodeId);
    }
  });
}
