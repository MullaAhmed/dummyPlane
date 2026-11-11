import { messages } from "@/i18n";
import type { Permission } from "@/ipc/pty";
import { agentMessages } from "@/mcp/messages";
import { relaunchMode } from "@/nodes/terminal/launch";
import { relaunchTerminal } from "@/nodes/terminal/registry";
import { nodesStore, sessionOf, updateSession } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { notify } from "./events";
import { missionOf, releaseSpawnedPermission, setMission } from "./store";
import type { TicketSource } from "./tickets";

export const DEFAULT_AWAY_HOURS = 8;
export const MAX_AWAY_HOURS = 72;
export const DEFAULT_LABEL = "overnight";

export interface OvernightChoice {
  awayMin: number;
  agents: number;
  source: TicketSource;
  autoLaunch: boolean;
  permission: Permission;
}

/** The night as the dialog shows it again, to change it before it starts. */
export function choiceOf(fleetId: string): OvernightChoice | null {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!mission?.overnight || mission.budgetMin === undefined || !mission.tickets) return null;
  return { awayMin: mission.budgetMin, agents: mission.maxAgents, source: mission.tickets, autoLaunch: mission.autoLaunch === true, permission: mission.permission ?? "ask" };
}

/** A night can be changed or called off until its team is formed. */
export function nightEditable(fleetId: string): boolean {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  return mission?.overnight === true && (mission.state === "redaction" || mission.state === "plan");
}

/**
 * The fleet's own session for the night (backlog: the fleet's own permissions): nobody is there to say yes,
 * so it refuses what would ask (`dontAsk`, its deny list kept), and it gets Linear's read-only server when
 * its tickets are there. A change restarts it on the same conversation; a day mission puts it back.
 */
export async function nightSession(fleetId: string, night: { permission?: Permission; linear: boolean }): Promise<void> {
  const session = sessionOf(nodesStore.getState().nodes[fleetId]);
  if (!session) return;
  const patch = { permission: night.permission, linear: night.linear ? (true as const) : undefined };
  if (session.permission === patch.permission && session.linear === patch.linear) return;
  updateSession(fleetId, patch);
  if (isRunning(fleetId)) await relaunchTerminal(fleetId, { ...session, ...patch }, relaunchMode(session));
}

/** A restart that fails leaves the session as it was: the fleet is told all the same, a failed start shows on its node. */
const afterRestart = (restart: Promise<void>, then: () => void) =>
  restart.then(then, (error: unknown) => {
    console.warn("fleet session not restarted for the night", error);
    then();
  });

/** The dialog's answer: the mission is set for the night, then the fleet gets its orders (spec overnight mission §5.1). Again, it changes the night. */
export function startOvernight(fleetId: string, choice: OvernightChoice): Promise<void> {
  const { awayMin, agents, source, autoLaunch, permission } = choice;
  const changing = choiceOf(fleetId) !== null;
  const before = missionOf(nodesStore.getState().nodes[fleetId])?.permission;
  setMission(fleetId, { overnight: true, budgetMin: awayMin, maxAgents: agents, tickets: source, autoLaunch: autoLaunch || undefined, permission });
  // The Fleet's sub-agents (spawn_agent) do not keep what a night changed no longer lets them do.
  if (before !== permission) releaseSpawnedPermission(fleetId, before);
  const lines = messages(agentMessages).lines;
  const orders = (changing ? lines.overnightChanged : lines.overnightStart)(awayMin, agents, autoLaunch);
  // After the restart, if any: typed before it, the line would reach the session it ends. The new one's lines wait for its prompt (events.ts).
  return afterRestart(nightSession(fleetId, { permission, linear: source.kind === "linear" }), () => notify(fleetId, orders));
}

/** "Cancel the night": a regular mission again, its plan kept; the fleet is told, and goes back to its day session. */
export function cancelOvernight(fleetId: string): Promise<void> {
  if (!nightEditable(fleetId)) return Promise.resolve();
  releaseSpawnedPermission(fleetId, missionOf(nodesStore.getState().nodes[fleetId])?.permission);
  setMission(fleetId, { overnight: undefined, budgetMin: undefined, tickets: undefined, autoLaunch: undefined, permission: undefined, windDownTold: undefined, globalOverdue: undefined });
  return afterRestart(nightSession(fleetId, { linear: false }), () => notify(fleetId, messages(agentMessages).lines.overnightCancelled));
}
