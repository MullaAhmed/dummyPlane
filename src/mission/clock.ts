import { toast } from "sonner";
import { messages } from "@/i18n";
import { agentMessages } from "@/mcp/messages";
import { nodesStore } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { notify } from "./events";
import { checkStalls } from "./stalls";
import { nearBudgets, overruns, remainingGlobal, windingDown, type Mission } from "./mission";
import { missionMessages } from "./messages";
import { agentState, isFleetClosed, missionOf, missionRunner, setMission, updateMember } from "./store";

/** How often the missions' clocks are read. */
export const CLOCK_MS = 15_000;

/**
 * The longest gap between two looks that still counts as a pause: a hidden window's timers run once a minute, which
 * is still dummyPlane running. A longer one (the machine asleep) is not a wait on the user: only this much is counted.
 */
export const MAX_LOOK_GAP_MS = 5 * 60_000;

/** Overruns whose line waits for a free fleet: not queued twice, and recorded as told only once typed. */
const waiting = new Set<string>();

/** When each mission's clock last looked: the time between two looks is what a pause adds. */
const lastLook = new Map<string, number>();

/** For tests: forget the looks. */
export function forgetLooks() {
  lastLook.clear();
  waiting.clear();
}

/**
 * Whether the whole mission only waits on the user: an agent of its team is held by a dialog (a permission, an expired
 * login) and none works, its runner included. The agents' budgets do not run then: nobody could have used the time.
 */
export function onlyUserWaits(fleetId: string, mission: Mission): boolean {
  const open = mission.members.filter((m) => m.sentAt !== undefined && !m.report && !m.handedTo && !m.abandoned && isRunning(m.nodeId));
  const agents = [...open.map((m) => m.nodeId), missionRunner(fleetId)].filter((id) => isRunning(id));
  const states = agents.map((id) => agentState(id));
  return open.some((m) => agentState(m.nodeId) === "attend") && !states.includes("travaille");
}

/** Adds the time since the last look to the budgets of a mission that only waits on the user. */
function countUserWait(fleetId: string, mission: Mission, now: number) {
  const last = lastLook.get(fleetId);
  lastLook.set(fleetId, now);
  const gap = last === undefined ? 0 : Math.min(now - last, MAX_LOOK_GAP_MS);
  if (gap <= 0 || mission.state !== "en_cours" || !onlyUserWaits(fleetId, mission)) return;
  for (const m of mission.members) {
    if (m.sentAt === undefined || m.report || m.handedTo || m.abandoned) continue;
    updateMember(fleetId, m.nodeId, { pausedMs: (m.pausedMs ?? 0) + gap });
  }
}

/** One look at every running mission's budgets; it never stops an agent. */
export function checkBudgets(now = Date.now()) {
  for (const [fleetId, record] of Object.entries(nodesStore.getState().nodes)) {
    const mission = missionOf(record);
    if (!mission || isFleetClosed(fleetId)) continue;
    countUserWait(fleetId, mission, now);
    // Its budgets as the time just counted left them: read again, not from the record taken before it.
    const counted = missionOf(nodesStore.getState().nodes[fleetId]) ?? mission;
    for (const near of nearBudgets(counted, now)) {
      const key = `${fleetId}:${near.nodeId}:near`;
      if (waiting.has(key) || !isRunning(near.nodeId)) continue;
      waiting.add(key);
      notify(missionRunner(fleetId), messages(agentMessages).lines.budgetNear(near.name, near.task, near.budget, near.left), () => {
        waiting.delete(key);
        updateMember(fleetId, near.nodeId, { nearTold: true });
      });
    }
    const found = overruns(counted, now);
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
  const timer = setInterval(() => {
    checkBudgets();
    checkStalls();
  }, CLOCK_MS);
  return () => clearInterval(timer);
}
