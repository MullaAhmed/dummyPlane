import { terminalStatusStore, type TerminalStatus } from "@/store/terminalStatus";
import { hasSeat } from "./active";
import { pumpQueue } from "./queue";
import { memberships } from "./restartWatch";

/** Its process runs, or is about to: the terminal of a member at work. */
const live = (status: TerminalStatus | undefined) => status?.state === "running" || status?.state === "starting";

/**
 * The fleets whose queue a change of the terminals' statuses may let move: a running mission's member on its task left
 * the seat it held. Its process ended, or its terminal was closed (`disposeTerminal` removes its status), and none
 * counts it now (`hasSeat`): not while it restarts, nor once it reported (its report freed the seat then). The one that
 * never ran (its task not typed, `sentAt`) holds its seat until closed: its removal frees it.
 */
function freedSeats(statuses: Record<string, TerminalStatus>, previous: Record<string, TerminalStatus>): Set<string> {
  const fleets = new Set<string>();
  for (const [nodeId, before] of Object.entries(previous)) {
    const after = statuses[nodeId];
    // Still there, and not one that stopped running: nothing left.
    if (after && !(live(before) && !live(after))) continue;
    for (const { fleetId, mission, member } of memberships(nodeId)) {
      if (member.handedTo || member.report) continue;
      if ((live(before) || member.sentAt === undefined) && !hasSeat(mission, nodeId)) fleets.add(fleetId);
    }
  }
  return fleets;
}

/**
 * Watches the members of running missions leave: an agent that exits, a terminal the user closes. Its seat is free from
 * that instant (`activeMembers`), and the queue's tasks, which waited for a report or a restart's end to be moved,
 * start on it now, once: `pumpQueue` holds each task's seat before its first wait, so a second pump, or an exit
 * followed by the close of the same terminal, starts nothing twice. Installed at boot, beside `installRestartWatch`.
 * It never throws: it runs inside the store's update, in the close.
 */
export function installCloseWatch(): () => void {
  return terminalStatusStore.subscribe((state, previous) => {
    if (state.statuses === previous.statuses) return;
    try {
      for (const fleetId of freedSeats(state.statuses, previous.statuses)) void pumpQueue(fleetId).catch(() => undefined);
    } catch (error) {
      console.warn("seat of a mission's agent not watched", error);
    }
  });
}
