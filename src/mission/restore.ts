import { sceneAccess } from "@/agents/sceneAccess";
import { withWireBetween } from "@/agents/wires";
import { messages } from "@/i18n";
import { agentMessages } from "@/mcp/messages";
import { relaunchMode } from "@/nodes/terminal/launch";
import { relaunchTerminal } from "@/nodes/terminal/registry";
import { nodesStore, terminalOf, type NodesState } from "@/store/nodes";
import { isRestarting, isRunning, statusOf, terminalStatusStore } from "@/store/terminalStatus";
import { activeCount, relaunchTakesSeat } from "./active";
import { notify } from "./events";
import { keepTeamFrame, managerNameOf } from "./manager";
import { oneLine, type ManagerSession, type Member, type Mission } from "./mission";
import { isFleetClosed, managedFleet, missionOf, setMission } from "./store";

/**
 * A mission running when dummyPlane quit comes back stopped: its Fleet, its Manager and its agents alike. Once its
 * Fleet or its Manager runs again (the user resumed it), the rest of it is started again on its own conversations,
 * as "Resume all" does for any terminal, and whoever runs it is told once which agents are back and which are not.
 * Decided then, not at boot: a project's nodes are read only once one of its workspaces is shown.
 */

const t = () => messages(agentMessages).lines;

/** The sessions alive in Rust when dummyPlane started (a webview reload): their missions never stopped. */
let liveAtStart: ReadonlySet<string> = new Set();
/** The terminals seen running since dummyPlane started: a mission whose Fleet or Manager ran already was not stopped by a restart. */
const ranSinceStart = new Set<string>();
/** The Fleets whose running mission was looked at once, restored or not. */
const considered = new Set<string>();

/** Agents a restore is starting again: their own "restarted" line is folded into its summary (`./events`). */
const restoring = new Set<string>();
export const isRestoring = (nodeId: string): boolean => restoring.has(nodeId);

/** A member still on its sub-task: not handed over nor abandoned, no report, not stopped by dummyPlane once it was done. */
function onWork(member: Member): boolean {
  if (member.handedTo || member.abandoned || member.report || member.cleanedUp) return false;
  return !terminalOf(nodesStore.getState().nodes[member.nodeId])?.stoppedFinished;
}

/** Whether a terminal is gone from the canvas: a closed one keeps its record, its element deleted. */
function closed(nodeId: string): boolean {
  const record = nodesStore.getState().nodes[nodeId];
  if (!record || !terminalOf(record)) return true;
  const scene = sceneAccess(record.workspaceId);
  // Its scene never read: nothing says it was closed.
  if (!scene) return false;
  const element = scene.elements().find((e) => e.id === nodeId);
  return element === undefined || element.isDeleted;
}

/** The mission's own wires, drawn again where the scene lost them: its Fleet to its board, its board to its Manager. */
function rewire(workspaceId: string, fleetId: string, mission: Mission) {
  const scene = sceneAccess(workspaceId);
  if (!scene || !mission.board) return;
  const before = scene.elements();
  let after = withWireBetween(before, fleetId, mission.board);
  if (mission.manager) after = withWireBetween(after, mission.board, mission.manager);
  if (after.length !== before.length) scene.write(after);
}

/** Starts a stopped terminal again on its own conversation; why it did not start, or null. */
async function resume(nodeId: string): Promise<string | null> {
  const payload = terminalOf(nodesStore.getState().nodes[nodeId]);
  if (!payload) return null;
  restoring.add(nodeId);
  try {
    await relaunchTerminal(nodeId, payload, relaunchMode(payload));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    restoring.delete(nodeId);
  }
  // A refused spawn leaves its error on the terminal, it does not throw.
  const status = statusOf(nodeId);
  return status.state === "error" ? status.message : null;
}

/**
 * The mission of `fleetId` is back: its Manager, then its agents on their sub-tasks, start again, and its runner hears
 * it. After dummyPlane's restart, or once its Fleet re-opened its Manager (`reopenedBy`, the Fleet's name): then the
 * Manager, started already, hears in one line what it runs and where its team stands, each time, as its conversation
 * may be a new one (none saved).
 */
async function restoreMission(fleetId: string, reopenedBy?: string): Promise<void> {
  const record = nodesStore.getState().nodes[fleetId];
  const mission = missionOf(record);
  if (!record || mission?.state !== "en_cours" || isFleetClosed(fleetId)) return;
  rewire(record.workspaceId, fleetId, mission);
  // A mission started before it kept its group's id keeps it now: its Manager may be closed later, its team gone with it.
  keepTeamFrame(fleetId);
  const managerId = mission.manager;
  if (managerId && closed(managerId)) {
    // Nobody to run the team: it stays stopped, and the Fleet hears why.
    notify(fleetId, t().restoredNoManager(managerNameOf(fleetId)));
    return;
  }
  // The Manager first: it runs the rest, and hears of them once its session is up.
  if (managerId && !reopenedBy && !isRunning(managerId) && !isRestarting(managerId)) await resume(managerId);
  const back: string[] = [];
  // Re-opened by its Fleet, the team may never have stopped: those at work did not lose their turn.
  const atWork: string[] = [];
  const notBack: string[] = [];
  for (const { nodeId } of mission.members) {
    // Read again at each turn: a report, a reassign or the user may have changed it while the previous one started.
    const now = missionOf(nodesStore.getState().nodes[fleetId]);
    const member = now?.members.find((m) => m.nodeId === nodeId);
    if (!now || now.state !== "en_cours" || !member || !onWork(member)) continue;
    if (closed(nodeId)) notBack.push(t().restoredClosed(member.name));
    // Started again meanwhile ("Resume all", its own node): back all the same.
    else if (isRunning(nodeId) || isRestarting(nodeId)) (reopenedBy ? atWork : back).push(member.name);
    // Its seat may have gone to another while it was stopped: Max active agents holds, as for relaunch.
    else if (relaunchTakesSeat(now, member) && activeCount(fleetId, now) >= now.maxAgents) notBack.push(t().restoredFull(member.name, now.maxAgents));
    else {
      const failure = await resume(nodeId);
      if (failure === null) back.push(member.name);
      else notBack.push(t().restoredFailed(member.name, failure));
    }
  }
  if (reopenedBy && managerId) {
    const now = missionOf(nodesStore.getState().nodes[fleetId]) ?? mission;
    const orders = { mission: now.name ?? "", fleet: reopenedBy, task: oneLine(now.task ?? ""), board: now.board ?? "", branch: now.branch ?? "", max: now.maxAgents };
    notify(managerId, t().reopened(orders, atWork, back, notBack));
    return;
  }
  if (back.length === 0 && notBack.length === 0) return;
  notify(managerId ?? fleetId, t().restored(back, notBack));
}

/**
 * Its Fleet re-opened, or started again, the Manager of its running mission (`relaunch`): the team stopped meanwhile
 * starts again and the Manager hears where things stand, once. Not a second time when its start reads as the
 * mission's return after a restart.
 */
export function restoreReopened(fleetId: string, fleet: string): void {
  considered.add(fleetId);
  void restoreMission(fleetId, fleet).catch((error: unknown) => console.warn("team not restored after its Manager was re-opened", error));
}

/** The Manager's node and conversation, as the mission keeps them for a re-open: what of them may change. */
const sameSession = (a: ManagerSession | undefined, b: ManagerSession) =>
  a?.nodeId === b.nodeId && a.agent === b.agent && a.name === b.name && a.claudeSessionId === b.claudeSessionId && a.codexSessionId === b.codexSessionId;

/**
 * Each running mission keeps its Manager's node and conversation (`Mission.managerSession`), as they are now: a
 * closed node's row goes with the next scene save, and the Fleet's `relaunch` re-opens it on that conversation.
 */
function keepManagerSessions(state: NodesState, previous: NodesState) {
  for (const [fleetId, record] of Object.entries(state.nodes)) {
    if (record.kind !== "fleet") continue;
    const mission = missionOf(record);
    const managerId = mission?.manager;
    if (!mission || !managerId || (mission.state !== "en_cours" && mission.state !== "lancement")) continue;
    if (state.nodes[managerId] === previous.nodes[managerId] && record === previous.nodes[fleetId]) continue;
    const payload = terminalOf(state.nodes[managerId]);
    if (!payload) continue;
    const kept: ManagerSession = {
      nodeId: managerId,
      agent: payload.agent,
      name: payload.name,
      ...(payload.claudeSessionId ? { claudeSessionId: payload.claudeSessionId } : {}),
      ...(payload.codexSessionId ? { codexSessionId: payload.codexSessionId } : {}),
    };
    if (!sameSession(mission.managerSession, kept)) setMission(fleetId, { managerSession: kept });
  }
}

/** The Fleet of the running mission `nodeId` is the Fleet or the Manager of, if any. */
function missionFleetOf(nodeId: string): string | undefined {
  const record = nodesStore.getState().nodes[nodeId];
  const fleetId = record?.kind === "fleet" ? nodeId : managedFleet(nodeId);
  return fleetId && missionOf(nodesStore.getState().nodes[fleetId])?.state === "en_cours" ? fleetId : undefined;
}

/**
 * Installed at boot once the sessions alive in Rust are known (`live`): a webview reload leaves them running, and
 * their missions with them. The first time a running mission's Fleet or Manager runs after that, if neither was
 * alive then nor ran since, the mission was stopped by dummyPlane's restart: it is restored (`restoreMission`).
 */
export function installMissionRestore(live: readonly string[]): () => void {
  liveAtStart = new Set(live);
  ranSinceStart.clear();
  considered.clear();
  keepManagerSessions(nodesStore.getState(), { ...nodesStore.getState(), nodes: {} });
  const offSessions = nodesStore.subscribe(keepManagerSessions);
  const offStatuses = terminalStatusStore.subscribe((state, previous) => {
    for (const [nodeId, status] of Object.entries(state.statuses)) {
      if (status.state !== "running" || previous.statuses[nodeId]?.state === "running") continue;
      const fleetId = missionFleetOf(nodeId);
      if (fleetId && !considered.has(fleetId)) {
        considered.add(fleetId);
        const managerId = missionOf(nodesStore.getState().nodes[fleetId])?.manager;
        const stopped = [fleetId, managerId].every((id) => id === undefined || (!liveAtStart.has(id) && !ranSinceStart.has(id)));
        if (stopped) void restoreMission(fleetId).catch((error: unknown) => console.warn("mission not restored after dummyPlane's restart", error));
      }
      ranSinceStart.add(nodeId);
    }
  });
  return () => {
    offSessions();
    offStatuses();
  };
}
