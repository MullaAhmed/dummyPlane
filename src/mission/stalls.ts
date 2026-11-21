import { toast } from "sonner";
import { dialogText, pendingDialog } from "@/agents/dialogs";
import { hasSpawnedAtWork } from "@/agents/spawnFamily";
import { talk } from "@/agents/talkWires";
import { messages } from "@/i18n";
import { agentMessages } from "@/mcp/messages";
import { freshText } from "@/nodes/terminal/registry";
import { recordNotification } from "@/notifications/capture";
import { agentActivityStore, type AgentActivity } from "@/store/agentActivity";
import { nodeNameOf, nodesStore } from "@/store/nodes";
import { isRestarting, isRunning } from "@/store/terminalStatus";
import { notify } from "./events";
import { missionMessages } from "./messages";
import type { Member, Mission } from "./mission";
import { isFleetClosed, missionOf, missionRunner } from "./store";

/**
 * What sits still in a running mission, and who is told, once per stall (the clock looks, `./clock`):
 * - a team agent idle too long without having reported, and not waiting for the user: its runner (its Manager, or its
 *   Fleet run the old way) reads what to do;
 * - a runner idle while the mission has open work (reports to merge, decisions to take, agents idle): the runner itself,
 *   or the Fleet for a Manager;
 * - an agent held long by a dialog or an expired login: only the user can end it, so the user hears it again, through the
 *   notification panel, a popup and, when the window is away, the system's notification; its runner too, for a team agent;
 * - a sub-agent's report typed into an idle parent that never took it up (its terminal compacted meanwhile): typed again.
 * The thresholds below follow what the sessions showed: stalls of 20 to 48 min noticed only by a babysitter, one agent idle
 * 136 min, one login expired overnight (about 10 h).
 */

/** A team agent idle this long without a report is stalled: a turn ends between two commands, a stall does not. */
export const MEMBER_IDLE_MS = 10 * 60_000;
/** A runner idle this long while the mission has open work is stalled: its team's news wakes it, nothing else. */
export const RUNNER_IDLE_MS = 5 * 60_000;
/** An agent held by a dialog this long is held by a user who is away: told again, to the user. */
export const HELD_MS = 10 * 60_000;
/** An agent idle at an expired login this long: nothing else will ever move it, so the user hears it soon. */
export const LOGIN_MS = 3 * 60_000;
/** A parent's terminal that has not taken up a report typed into it this long lost it (it compacted while idle). */
export const UNHEARD_MS = 3 * 60_000;

const MINUTE = 60_000;

/** Claude's words for a session whose login ran out: on screen, at its prompt, while no dialog is open. */
const LOGIN_EXPIRED = /login expired|please run \/login|oauth token (has )?expired|authentication_error/i;
/** How far down its screen the words count: higher up they are quoted text, a past error. */
const SCREEN_LINES = 12;

/** What each stall was told for: one notice per stall. A stall is a start (`since`), or for a runner the open work. */
const told = new Map<string, string>();

/** Reports typed into a parent, until it takes them up: `trackChildReport`. */
interface Typed {
  parentId: string;
  name: string;
  status: string;
  summary: string;
  at: number;
  /** Where the parent's activity stood when the line was typed: any other transition since is the line taken up. */
  since: number | undefined;
}
const typed: Typed[] = [];

/** For tests: forget what was told. */
export function forgetStalls() {
  told.clear();
  typed.length = 0;
}

/** A sub-agent's report was typed into `parentId` at `at`: if the parent never works on it, it is typed again. */
export function trackChildReport(parentId: string, name: string, status: string, summary: string, at = Date.now()) {
  typed.push({ parentId, name, status, summary, at, since: agentActivityStore.getState().activities[parentId]?.since });
}

const minutes = (ms: number) => Math.floor(ms / MINUTE);

/** Whether an idle agent's screen says its login expired. */
export function needsLogin(nodeId: string): boolean {
  return LOGIN_EXPIRED.test(freshText(nodeId, SCREEN_LINES));
}

/** An agent of a mission that is idle, at rest, its terminal running: since when, or null. */
function idleSince(nodeId: string): number | null {
  const act: AgentActivity | undefined = agentActivityStore.getState().activities[nodeId];
  return act?.activity === "idle" && !act.left && isRunning(nodeId) && !isRestarting(nodeId) ? act.since : null;
}

/** An agent held by a dialog: since when, or null. */
function waitingSince(nodeId: string): number | null {
  const act = agentActivityStore.getState().activities[nodeId];
  return act?.activity === "waiting" && isRunning(nodeId) ? act.since : null;
}

/** Says it once per stall: false when `key` was told for this `stall` already. */
function once(key: string, stall: string, seen: Set<string>): boolean {
  seen.add(key);
  if (told.get(key) === stall) return false;
  told.set(key, stall);
  return true;
}

/** The user hears an agent has waited for them long: a popup, the panel's entry, and the system's notification. */
function tellUser(nodeId: string, min: number, what: string | undefined, login: boolean) {
  const record = nodesStore.getState().nodes[nodeId];
  const t = messages(missionMessages);
  const title = t.stuckTitle(nodeNameOf(record) || "An agent", min);
  const description = login ? t.stuckLogin : t.stuckQuestion(what);
  toast.warning(title, { description });
  recordNotification({ type: "question", kind: "warning", title, description, context: { nodeId, workspaceId: record?.workspaceId } });
  // A window away is where a login that ran out overnight goes unseen. Imported late: it needs the app's window.
  void import("@/shell/waitingAlert").then(({ alertStuck }) => alertStuck(nodeId, title, description)).catch(() => undefined);
}

/** A member whose sub-task is open: typed, not reported, not handed over, not dropped. */
const open = (m: Member) => m.sentAt !== undefined && !m.report && !m.handedTo && !m.abandoned && !m.cleanedUp;

/**
 * What only the runner can move: reports to merge (once the team is done, or a queued task waits on one), blocked or failed
 * ones to decide, the mission left unfinished.
 * Agents idle without a report are not here: each is told on its own (`checkMember`). None when all is in the team's hands.
 */
export function openWork(mission: Mission): string[] {
  const t = messages(agentMessages).lines;
  const names = (members: Member[]) => members.map((m) => m.name).join(", ");
  // A done report waits for its merge, but a runner at rest while its teammates still work is doing what it should: it is
  // work only once nobody is left at work, or once a queued task waits behind that merge (`notMoved`).
  const atWork = mission.members.some(open);
  const unmerged =
    atWork && !(mission.queue?.length ?? 0) ? [] : mission.members.filter((m) => m.report?.status === "termine" && !m.merged && !m.cleanedUp && !m.handedTo);
  const undecided = mission.members.filter((m) => (m.report?.status === "bloque" || m.report?.status === "echec") && !m.handedTo && !m.abandoned);
  const work = [
    ...(unmerged.length ? [t.openUnmerged(names(unmerged))] : []),
    ...(undecided.length ? [t.openUndecided(names(undecided))] : []),
  ];
  const everyoneReported = mission.members.length > 0 && mission.members.every((m) => m.report || m.handedTo || m.abandoned);
  return work.length === 0 && everyoneReported && !(mission.queue?.length ?? 0) ? [t.openFinish] : work;
}

/** The runner of a mission, idle with open work: it is told (a Manager's Fleet hears it of its Manager). */
function checkRunner(fleetId: string, mission: Mission, now: number, seen: Set<string>) {
  const runner = missionRunner(fleetId);
  const work = openWork(mission);
  const key = `runner:${fleetId}`;
  // Open work keeps its notice: a runner that works on it for a moment and idles again with the same left is not told
  // twice. It is told again when that changes, or after the work was all done once.
  if (work.length === 0) return;
  seen.add(key);
  const since = idleSince(runner);
  if (since === null || now - since < RUNNER_IDLE_MS || !once(key, work.join("|"), seen)) return;
  const lines = messages(agentMessages).lines;
  const min = minutes(now - since);
  if (runner === fleetId) notify(fleetId, lines.runnerIdle(min, work.join("; ")));
  else notify(fleetId, lines.managerIdle(nodeNameOf(nodesStore.getState().nodes[runner]), min, work.join("; ")));
}

/** One team agent: idle without a report, or held long. */
function checkMember(fleetId: string, member: Member, now: number, seen: Set<string>) {
  const runner = missionRunner(fleetId);
  const lines = messages(agentMessages).lines;
  const id = member.nodeId;
  const held = waitingSince(id);
  if (held !== null && now - held >= HELD_MS && once(`held:${id}`, String(held), seen)) {
    const what = dialogText(pendingDialog(id));
    talk(id, runner);
    notify(runner, lines.heldLong(member.name, minutes(now - held), what));
    tellUser(id, minutes(now - held), what, false);
    return;
  }
  const idle = idleSince(id);
  if (idle === null) return;
  const waited = now - idle;
  if (waited >= LOGIN_MS && needsLogin(id)) {
    if (!once(`login:${id}`, String(idle), seen)) return;
    talk(id, runner);
    notify(runner, lines.memberLogin(member.name, minutes(waited)));
    tellUser(id, minutes(waited), undefined, true);
    return;
  }
  // Its own sub-agents at work: its turn ended to wait for their reports, not for want of work.
  if (waited < MEMBER_IDLE_MS || hasSpawnedAtWork(id) || !once(`idle:${id}`, String(idle), seen)) return;
  talk(id, runner);
  notify(runner, lines.memberIdle(member.name, member.task, minutes(waited)));
}

/** The Fleet and its Manager held long (the Fleet waits for the user's own answer: only the user hears it). */
function checkLeaders(fleetId: string, mission: Mission, now: number, seen: Set<string>) {
  const lines = messages(agentMessages).lines;
  for (const id of new Set([fleetId, mission.manager].filter((x): x is string => !!x))) {
    const held = waitingSince(id);
    if (held !== null && now - held >= HELD_MS && once(`held:${id}`, String(held), seen)) tellUser(id, minutes(now - held), dialogText(pendingDialog(id)), false);
    const idle = idleSince(id);
    if (idle === null || now - idle < LOGIN_MS || !needsLogin(id) || !once(`login:${id}`, String(idle), seen)) continue;
    if (id !== fleetId) notify(fleetId, lines.managerLogin(nodeNameOf(nodesStore.getState().nodes[id]), minutes(now - idle)));
    tellUser(id, minutes(now - idle), undefined, true);
  }
}

/** Reports typed into a parent that never took them up: typed again, once. */
function checkUnheard(now: number) {
  const lines = messages(agentMessages).lines;
  for (let i = typed.length - 1; i >= 0; i--) {
    const { parentId, name, status, summary, at, since } = typed[i];
    const act = agentActivityStore.getState().activities[parentId];
    // Gone, or its activity moved since the line was typed (it worked on it, even briefly): heard. At a dialog it is
    // not typed into, and the report waits.
    if (!isRunning(parentId) || !act || act.activity === "working" || act.since !== since) {
      typed.splice(i, 1);
      continue;
    }
    if (act.activity !== "idle" || act.left || now - at < UNHEARD_MS) continue;
    typed.splice(i, 1);
    notify(parentId, lines.reportAgain(name, status, summary));
  }
}

/** One look at every running mission: who sits still, and who has to hear it. It never stops nor types into an agent but by `notify`. */
export function checkStalls(now = Date.now()) {
  const seen = new Set<string>();
  for (const [fleetId, record] of Object.entries(nodesStore.getState().nodes)) {
    const mission = missionOf(record);
    if (mission?.state !== "en_cours" || isFleetClosed(fleetId)) continue;
    checkLeaders(fleetId, mission, now, seen);
    for (const member of mission.members) if (open(member)) checkMember(fleetId, member, now, seen);
    checkRunner(fleetId, mission, now, seen);
  }
  checkUnheard(now);
  // A stall over (its agent works, reported or went) is forgotten: the next one is told.
  for (const key of [...told.keys()]) if (!seen.has(key)) told.delete(key);
}
