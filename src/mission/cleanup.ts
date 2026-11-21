import { toast } from "sonner";
import { toastError } from "@/lib/errorToast";
import { cutWhole } from "@/lib/cut";
import { outlasts } from "@/lib/outlasts";
import { messages } from "@/i18n";
import { columnOf } from "@/kanban/board";
import { linkedBoards, missionBoard } from "@/kanban/fleetBoards";
import { doneColumn } from "@/kanban/githubSync";
import { agentMessages } from "@/mcp/messages";
import { nodesStore } from "@/store/nodes";
import { notify } from "./events";
import { cleanMission, cleaningNow, type MissionCleanup } from "./launch";
import { managerNameOf } from "./manager";
import { missionMessages } from "./messages";
import { showOutcomeToast } from "./missionToasts";
import { busyNow } from "./keptOpen";
import { oneLine, type Mission } from "./mission";
import { settleQueue } from "./queue";
import { missionOf } from "./store";

/**
 * A Fleet cleaning its finished mission up itself (`clean_up_mission`, and `propose_plan` on a finished mission):
 * the panel's own cleanup (`cleanMission`), which never loses work (uncommitted work is committed on its branch, a
 * branch not on the user's is kept), after the checks that keep it from cutting the mission's own work short. The
 * panel does not check: the user who clicks it has looked. Both go through `runCleanup`, one path: one run at a time
 * per Fleet, its toast shown once, and what it did told to the Fleet however long git takes.
 */

const t = () => messages(agentMessages).fleet;

/** The most of a summary handed back to the Fleet, in characters. */
const MAX_SUMMARY = 1500;

/**
 * How long a Fleet's tool waits for the cleanup before it answers that it is under way: well under the 30 s Rust gives
 * a tool (MCP_TIMEOUT, past which the Fleet hears only "dummyPlane is not responding"), the team's terminals' closing
 * first included. As `TICKETS_WAIT_MS`.
 */
export const CLEANUP_WAIT_MS = 20_000;

/**
 * Cleaned, with what to tell the Fleet; or not, with the reason, which names what blocks it; or still running when the
 * tool had to answer, or already running (`later`): its result comes to the Fleet's terminal (`notify`).
 */
export type FleetCleanup = { cleaned: true; text: string } | { cleaned: false; reason: string } | { cleaned: "later"; text: string };

/** The cleanup under way, by Fleet: what to tell the Fleet once it ends. Whoever started it, the panel or the Fleet. */
const runs = new Map<string, Promise<string>>();

/** The Fleets told their cleanup's result comes later, with what to add to it then: each hears it once. */
const awaited = new Map<string, string | undefined>();

/** Whether a cleanup of the Fleet's mission is under way: the panel's, the Fleet's own, propose_plan's. */
export const cleanupUnderWay = (fleetId: string) => runs.has(fleetId) || cleaningNow(fleetId);

/**
 * The mission's cleanup (`cleanMission`), the one path the panel's button, clean_up_mission and propose_plan share: what
 * it did shown to the user once (`showCleanup`), and what to tell the Fleet, its summary and checks included (read
 * before: the cleanup leaves the mission blank). A Fleet told it would hear later (`awaited`) hears it as it ends.
 */
function runCleanup(fleetId: string): Promise<string> {
  const f = t();
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  const name = mission?.name ?? "";
  const summary = (mission?.summary ?? "").trim();
  const checks = mission?.handChecks ?? [];
  const run = (async () => {
    let result: MissionCleanup | string;
    try {
      result = await cleanMission(fleetId);
    } catch (error) {
      result = error instanceof Error ? error.message : String(error);
    }
    // A string is git failing after the fact: the mission is blank all the same (`cleanMission` frees it in any case).
    const failure = typeof result === "string" ? result : undefined;
    if (typeof result === "string") toastError(messages(missionMessages).cleanFailed, { error: result });
    else showCleanup(name, result);
    const done = typeof result === "string" ? { removed: [], saved: [], kept: [], open: [] } : { removed: result.removed, saved: result.saved ?? [], kept: result.kept, open: openNames(result) };
    const moved = typeof result === "string" ? [] : (result.moved ?? []);
    const lines = [f.cleanedUp(name, done, failure) + (moved.length > 0 ? f.cleanedMoved(moved) : "")];
    if (summary || checks.length > 0) lines.push(f.cleanedSummary(summary.length > MAX_SUMMARY ? `${cutWhole(summary, MAX_SUMMARY)}…` : summary, checks));
    return lines.join(" ");
  })();
  runs.set(fleetId, run);
  void run.then((text) => {
    runs.delete(fleetId);
    if (!awaited.has(fleetId)) return;
    const then = awaited.get(fleetId);
    awaited.delete(fleetId);
    // Typed into a terminal: one line, a summary's Markdown and git's message flattened (Enter would send it halfway).
    notify(fleetId, oneLine(f.cleanEnded(text, then)));
  });
  return run;
}

/**
 * The panel's "Clean up the mission": the user who clicks it has looked, so no check. A click while a cleanup runs (a
 * second click, the Fleet's) starts nothing: the user is told it is under way, and its own toast comes as it ends.
 */
export async function cleanFromPanel(fleetId: string): Promise<void> {
  if (cleanupUnderWay(fleetId)) {
    toast(messages(missionMessages).cleanUnderWay);
    return;
  }
  await runCleanup(fleetId);
}

/**
 * The mission's own tasks that are not done: a card its plan or its queue gave a task, still outside its board's
 * done column, and every task still waiting in the queue. Cards the user keeps on a board for other work are
 * none of the mission's: they stay on the board anyway.
 */
export function openTasks(fleetId: string, mission: Mission): string[] {
  const boards = new Map(linkedBoards(fleetId).map(({ nodeId, board }) => [nodeId, board]));
  const own = missionBoard(fleetId);
  if (own) boards.set(own.nodeId, own.board);
  const titles = new Set<string>();
  for (const task of [...(mission.plan ?? []), ...(mission.queue ?? [])]) {
    const card = task.card;
    if (!card) continue;
    const board = [...boards.values()].find((b) => b.cards[card]);
    if (board && columnOf(board, card)?.id !== doneColumn(board)?.id) titles.add(task.title);
  }
  for (const task of mission.queue ?? []) titles.add(task.title);
  return [...titles];
}

/**
 * The agents made for the mission, and its Manager, that are at work now, waiting for an answer, held by a dialog or
 * starting (`busyNow`): the cleanup would close the Manager under them. A linked agent went back to the user's work.
 */
function atWork(fleetId: string, mission: Mission): string[] {
  const names = mission.members.filter((m) => !m.linked && m.nodeId && busyNow(m.nodeId)).map((m) => m.name);
  if (mission.manager && busyNow(mission.manager)) names.push(managerNameOf(fleetId));
  return names;
}

/** The team terminals a cleanup left open, each with why. */
const openNames = (result: MissionCleanup) => result.open.map(({ name, why }) => `${name} (${messages(missionMessages).openWhy[why]})`);

/**
 * What a cleanup did, shown to the user, from the panel's button or the Fleet's cleanup alike: what went, the work
 * saved, and each branch, worktree and terminal kept with why. It stays on screen until dismissed when anything was
 * kept: the user wanted only their own branches in their folder, and is told which are left and why.
 */
export function showCleanup(name: string, result: MissionCleanup) {
  const m = messages(missionMessages);
  const saved = result.saved ?? [];
  const moved = result.moved ?? [];
  const open = openNames(result);
  const lines = [
    m.cleanedRemoved(result.removed),
    saved.length > 0 ? m.cleanedSaved(saved) : "",
    moved.length > 0 ? m.cleanedMoved(moved) : "",
    result.kept.length > 0 ? m.cleanedKept(result.kept) : "",
    open.length > 0 ? m.cleanedOpen(open) : "",
  ];
  const kept = saved.length + moved.length + result.kept.length + open.length > 0;
  // One toast per mission: a result shown again replaces the earlier one, kept or not, and never stacks beside it.
  showOutcomeToast(`cleaned-${name}`, m.cleanedTitle(name), lines.filter(Boolean).join(" "), kept);
}

/**
 * Cleans the Fleet's finished mission up, as the panel's "Clean up the mission" does (`runCleanup`), unless it is
 * not finished, was an overnight run (its report is the user's, and the cleanup would restart this very session),
 * has its Manager or an agent made for it at work, or tasks not done. Uncommitted work and branches not merged no
 * longer refuse it: the cleanup commits the one on its branch and keeps the other, and says so.
 *
 * It answers within `wait` whatever git takes (a tool has 30 s): a cleanup still running then goes on, and its result
 * comes to the Fleet's terminal (`notify`, which waits while the user has typed there without sending), `then` after
 * it. One already under way is never started twice: the Fleet is told so, and hears its result as it ends.
 */
export async function cleanUpFinished(fleetId: string, then?: string, wait = CLEANUP_WAIT_MS): Promise<FleetCleanup> {
  const f = t();
  if (cleanupUnderWay(fleetId)) {
    awaited.set(fleetId, awaited.get(fleetId) ?? then);
    return { cleaned: "later", text: f.cleanAlreadyUnderWay };
  }
  // A task still waiting whose card is Done was done outside the queue: it is no open task.
  settleQueue(fleetId);
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!mission) return { cleaned: false, reason: f.gone };
  if (mission.state === "lancement" || mission.state === "en_cours") return { cleaned: false, reason: f.cleanRunning };
  if (mission.state !== "terminee") return { cleaned: false, reason: f.cleanNothing };
  if (mission.overnight) return { cleaned: false, reason: f.cleanOvernight };
  const working = atWork(fleetId, mission);
  if (working.length > 0) return { cleaned: false, reason: f.cleanAtWork(working.join(", ")) };
  const open = openTasks(fleetId, mission);
  if (open.length > 0) return { cleaned: false, reason: f.cleanUnsaved(f.cleanOpenTasks(open)) };
  const run = runCleanup(fleetId);
  if (!(await outlasts(run, wait))) return { cleaned: true, text: await run };
  // Still running: it goes on, and the Fleet hears it as it ends, unless it ended in the meantime.
  if (runs.get(fleetId) !== run) return { cleaned: true, text: await run };
  awaited.set(fleetId, then);
  return { cleaned: "later", text: f.cleanUnderWay(mission.name ?? "") };
}
