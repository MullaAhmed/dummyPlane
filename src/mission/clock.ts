import { toast } from "sonner";
import { messages } from "@/i18n";
import { agentMessages } from "@/mcp/messages";
import { nodesStore } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { notify } from "./events";
import { overruns, remainingGlobal, windingDown } from "./mission";
import { missionMessages } from "./messages";
import { isFleetClosed, missionOf, missionRunner, setMission, updateMember } from "./store";

/** How often the missions' clocks are read. */
export const CLOCK_MS = 15_000;

/** Overruns whose line waits for a free fleet: not queued twice, and recorded as told only once typed. */
const waiting = new Set<string>();

/** One look at every running mission's budgets; it never stops an agent. */
export function checkBudgets(now = Date.now()) {
  for (const [fleetId, record] of Object.entries(nodesStore.getState().nodes)) {
    const mission = missionOf(record);
    if (!mission || isFleetClosed(fleetId)) continue;
    const found = overruns(mission, now);
    const lines = messages(agentMessages).lines;
    const said = messages(missionMessages);
    for (const overrun of found.members) {
      // The clock runs while dummyPlane is closed: a stopped agent's overrun is for its restart, not a burst of toasts.
      if (!isRunning(overrun.nodeId)) continue;
      const key = `${fleetId}:${overrun.nodeId}:${overrun.level}`;
      if (waiting.has(key)) continue;
      const before = mission.members.find((m) => m.nodeId === overrun.nodeId)?.overdue ?? 0;
      // Overnight a budget is a target and nobody is there: the morning report shows it.
      if (overrun.level === 2 && !mission.overnight) toast.warning(said.overBudgetTwice(overrun.name, overrun.budget));
      const told = () => {
        waiting.delete(key);
        const known = missionOf(nodesStore.getState().nodes[fleetId])?.members.find((m) => m.nodeId === overrun.nodeId)?.overdue;
        updateMember(fleetId, overrun.nodeId, { overdue: known === 2 ? 2 : overrun.level });
      };
      if (before < 1 && !waiting.has(`${fleetId}:${overrun.nodeId}:1`)) {
        // Recorded as told once typed: a line lost with the app is told again at the next start.
        waiting.add(key);
        const over = mission.overnight ? lines.targetOver : lines.budgetOver;
        notify(missionRunner(fleetId), over(overrun.name, overrun.task, overrun.budget), told);
      } else told();
    }
    if (mission.state === "en_cours" && !mission.windDownTold && !mission.globalOverdue && !found.global && windingDown(mission, now) && !waiting.has(`${fleetId}:windDown`)) {
      waiting.add(`${fleetId}:windDown`);
      notify(missionRunner(fleetId), lines.windDown(remainingGlobal(mission, now) ?? 0), () => {
        waiting.delete(`${fleetId}:windDown`);
        setMission(fleetId, { windDownTold: true });
      });
    }
    if (found.global && !waiting.has(`${fleetId}:global`)) {
      waiting.add(`${fleetId}:global`);
      notify(missionRunner(fleetId), lines.globalOver(mission.budgetMin ?? 0), () => {
        waiting.delete(`${fleetId}:global`);
        setMission(fleetId, { globalOverdue: true });
      });
    }
  }
}

/** For the app's whole life. */
export function installMissionClock(): () => void {
  const timer = setInterval(() => checkBudgets(), CLOCK_MS);
  return () => clearInterval(timer);
}
