import { messages } from "@/i18n";
import { cardDone, startMissionCards } from "@/kanban/fleetBoards";
import { agentMessages } from "@/mcp/messages";
import { nodesStore } from "@/store/nodes";
import { activeCount, freeSeat, holdSeat, moving, oneAtATime, seatHeld, seatsHeld, seatsOf } from "./active";
import { duplicateWork } from "./activeWork";
import type { ActiveWork } from "./duplicateTask";
import { notify } from "./events";
import { assign, leftBehind, mergeMember, newMember, subTaskText, withTeamNote, withTicketNote } from "./launch";
import { newWorktreeLine } from "./setup";
import { conflictPending, NEW_AGENT, noNewWork, type Member, type Mission, type QueuedTask, type Report, type SubTask } from "./mission";
import { agentState, canvasKnown, isFleetClosed, missionOf, missionRunner, setMission, updateMember } from "./store";
import { waitingOn, waitState } from "./waits";

const t = () => messages(agentMessages);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `report` comes mid-turn, the last commit may follow it; past this an agent's turn does not hold the queue up. */
const TURN_END_MS = 60_000;
const TURN_POLL_MS = 1000;

/** What the fleet last heard of its idle team, by mission: told once. */
const idleTold = new Map<string, string>();

const missionNow = (fleetId: string) => missionOf(nodesStore.getState().nodes[fleetId]);
const memberNow = (fleetId: string, nodeId: string) => missionNow(fleetId)?.members.find((m) => m.nodeId === nodeId && !m.handedTo);

/** New work may start: the mission runs, its fleet is open, and it is not winding down. */
const canStart = (fleetId: string, mission: Mission) => mission.state === "en_cours" && !noNewWork(mission, Date.now()) && !isFleetClosed(fleetId);

/** Fewer than Max agents are at work: one more may start. */
const seatLeft = (fleetId: string, mission: Mission) => activeCount(fleetId, mission) < mission.maxAgents;

/**
 * The queue's tasks whose card stands in its board's done column leave it: that work was done outside the queue (an
 * ad-hoc agent, the user, a card the runner moved), and a new agent on it would redo it, while the mission could not be
 * shown finished (12 Nov, wt-be-upload-land: two entries "already done and merged" still listed as waiting). Read where
 * the queue is read, not on one mover: the user drags cards too. The runner of a running mission hears which.
 */
export function settleQueue(fleetId: string): void {
  const mission = missionNow(fleetId);
  // Two waiting tasks may share a card (the second starts once the first is done): a card a task of the plan holds,
  // done with the merge of that task, says nothing of the one still waiting.
  const held = new Set((mission?.plan ?? []).map((task) => task.card));
  const over = (mission?.queue ?? []).filter((task) => task.card && !held.has(task.card) && cardDone(fleetId, task.card));
  if (!mission || over.length === 0) return;
  setMission(fleetId, { queue: (mission.queue ?? []).filter((task) => !over.includes(task)) });
  if (mission.state === "en_cours") notify(missionRunner(fleetId), t().lines.queueSettled(over.map((task) => task.title)));
}

/**
 * Done, its branch not in the mission's yet: a new agent's worktree, cut from the mission's branch, would miss its work.
 * Not one fixing its own merge conflict (`conflictPending`): a retry now would undo its resolution mid-way; its next
 * report merges it (`afterReport`), or a `merge` that names it.
 */
const unmerged = (mission: Mission) => mission.members.filter((m) => !m.handedTo && !m.abandoned && m.report?.status === "termine" && !m.merged && !conflictPending(m));

async function turnEnded(nodeId: string) {
  for (let waited = 0; waited < TURN_END_MS && agentState(nodeId) === "travaille"; waited += TURN_POLL_MS) {
    await new Promise((resolve) => setTimeout(resolve, TURN_POLL_MS));
  }
}

/** The mission and member as they stand, if the member's branch is still to merge for this report. */
function mergeable(fleetId: string, nodeId: string, report: Report) {
  const mission = missionNow(fleetId);
  const member = memberNow(fleetId, nodeId);
  if (!mission?.worktree || !member || mission.state !== "en_cours" || noNewWork(mission, Date.now())) return null;
  if (member.report?.at !== report.at || member.report.status !== "termine") return null;
  return { mission, worktree: mission.worktree, member };
}

/**
 * Merges the branch of a member that reported "done", once its turn ended:
 * the next task's new agent starts from its work (final review H3). Whether
 * it is in. Each wait may change everything: all is read again after it.
 */
async function mergeBranch(fleetId: string, nodeId: string): Promise<boolean> {
  const report = memberNow(fleetId, nodeId)?.report;
  if (!report || !mergeable(fleetId, nodeId, report)) return false;
  await turnEnded(nodeId);
  const ready = mergeable(fleetId, nodeId, report);
  if (!ready) return false;
  const { line, merged, uncommitted } = await mergeMember(fleetId, ready.worktree, ready.member);
  if (!merged || uncommitted) notify(missionRunner(fleetId), line);
  return merged;
}

/** While its branch merges, a member holds its seat (`./active`) and the first task: from the first instant, so that no new agent takes them before its work is in. */
async function mergeOnce(fleetId: string, nodeId: string): Promise<boolean> {
  if (moving.has(nodeId)) return false;
  moving.add(nodeId);
  try {
    return await mergeBranch(fleetId, nodeId);
  } finally {
    moving.delete(nodeId);
  }
}

/** Its branch merged, its seat goes to a new agent; on a conflict too: the fleet is told, and the queue goes on. */
async function mergeThenFill(fleetId: string, nodeId: string): Promise<void> {
  await mergeOnce(fleetId, nodeId);
  await fill(fleetId);
}

/** The duplicates the fleet's runner was told of, once each: `fill` runs at every report. */
const duplicateTold = new Set<string>();

/** The agent already on a waiting task, if one is: the fleet and its Manager do not count (`./duplicateTask`). */
function holderOf(fleetId: string, mission: Mission, task: QueuedTask): ActiveWork | null {
  return duplicateWork(task, nodesStore.getState().nodes[fleetId]?.workspaceId, [fleetId, mission.manager]);
}

/**
 * A waiting task that another agent is at work on is skipped: no second agent, its card untouched, it stays in the
 * queue and starts once that agent is no longer on it. The fleet's runner hears of it once, unless `tell` is off.
 */
function skipped(fleetId: string, mission: Mission, task: QueuedTask, tell = true): boolean {
  const who = holderOf(fleetId, mission, task);
  if (!who) return false;
  const key = `${fleetId}:${mission.startedAt}:${task.title}:${who.agentId}`;
  if (tell && !duplicateTold.has(key)) {
    duplicateTold.add(key);
    notify(missionRunner(fleetId), t().lines.duplicateSkipped(task.title, who));
  }
  return true;
}

/**
 * The queue's tasks nobody is starting on yet, and nobody else is at work on; the first ones wait for the members
 * being merged, whose seats they will take. A skipped duplicate takes no seat: the tasks behind it start.
 */
function unclaimed(fleetId: string, mission: Mission, tell = true): QueuedTask[] {
  // A task waiting for others (`waitsFor`) takes no seat, nor a merging member's, before each of them is in.
  const left = (mission.queue ?? []).filter((task) => !seatHeld(fleetId, task.title) && waitingOn(mission, task).length === 0 && !skipped(fleetId, mission, task, tell));
  return left.slice(mission.members.filter((m) => moving.has(m.nodeId)).length);
}

/** What a new agent's creation has to say, and the agent: it joined and took `task`, or why not; nothing when the mission no longer wants it. */
async function create(fleetId: string, task: QueuedTask): Promise<{ said: string; made?: Member } | undefined> {
  // Its turn may come long after it was asked for: all is read again.
  const record = nodesStore.getState().nodes[fleetId];
  const mission = missionOf(record);
  if (!record || !mission || !canStart(fleetId, mission) || !canvasKnown(fleetId)) return undefined;
  if (!mission.queue?.some((waiting) => waiting.title === task.title)) return undefined;
  // Read again too: an agent may have taken the task, or its card, while this one waited for its turn.
  if (skipped(fleetId, mission, task)) return undefined;
  // A new worktree: its agent is told how to fill it, read while the worktree is made.
  const lookingUp = newWorktreeLine(fleetId, record.workspaceId);
  const made = await newMember(fleetId, record.workspaceId, mission, { ...task, agent: NEW_AGENT });
  if (typeof made === "string") return { said: t().lines.newFailed(task.title, made) };
  const setup = await lookingUp;
  const now = missionNow(fleetId);
  // Finished meanwhile: its team is gone, this one would sit idle in its worktree.
  if (now?.state !== "en_cours") {
    leftBehind(fleetId, mission, made);
    return undefined;
  }
  const subTask: SubTask = { ...task, agent: made.name };
  const queue = (now.queue ?? []).filter((waiting) => waiting.title !== task.title);
  setMission(fleetId, { queue, plan: [...(now.plan ?? []), subTask], members: [...now.members, made] });
  // In the tick it joins the team: counted once, never twice nor not at all.
  freeSeat(fleetId, task.title);
  void startMissionCards(fleetId, [made], [subTask]).catch(() => undefined);
  void assign(fleetId, made, withTicketNote(fleetId, now, withTeamNote(now, subTaskText(now.name ?? "", subTask, made.branch, undefined, setup)), task));
  return { said: t().lines.newAgent(made.name, task.title, queue.length), made };
}

/** A new agent for `task`: its seat held by the caller before any wait, then created in turn with the others. */
async function startHeld(fleetId: string, task: QueuedTask): Promise<{ said: string; made?: Member } | undefined> {
  try {
    return await oneAtATime(fleetId, () => create(fleetId, task));
  } catch (error) {
    return { said: t().lines.newFailed(task.title, errorText(error)) };
  } finally {
    freeSeat(fleetId, task.title);
  }
}

/** A new agent for `task`, its seat held at once. */
async function startNew(fleetId: string, task: QueuedTask): Promise<void> {
  holdSeat(fleetId, task.title);
  const result = await startHeld(fleetId, task);
  if (result) notify(missionRunner(fleetId), result.said);
}

/**
 * New agents for the tasks waiting, while fewer than Max agents are at work:
 * each in a new terminal, in the task's group, else the mission's, on the
 * router's model (`newMember`). An agent that finished never takes another
 * task: a new conversation keeps each task's context apart. Each task once and
 * never past the cap, however many fills run at once: the seats are held
 * before the first wait.
 */
function fill(fleetId: string): Promise<void> {
  settleQueue(fleetId);
  const mission = missionNow(fleetId);
  if (!mission?.queue?.length || !canStart(fleetId, mission) || !canvasKnown(fleetId)) return Promise.resolve();
  const seats = mission.maxAgents - activeCount(fleetId, mission);
  if (seats <= 0) return Promise.resolve();
  return Promise.all(unclaimed(fleetId, mission).slice(0, seats).map((task) => startNew(fleetId, task))).then(() => undefined);
}

/**
 * The queue moves, up to Max agents at work: the branches of the members done
 * and not merged go into the mission's first, then new agents take the tasks.
 * After a task arrives, a conflict is resolved, or the mission starts.
 */
export async function pumpQueue(fleetId: string): Promise<void> {
  settleQueue(fleetId);
  const mission = missionNow(fleetId);
  if (!mission?.queue?.length || !canStart(fleetId, mission)) return;
  // Each merge holds its seat at once: the parallel fill leaves it its task.
  const merges = unmerged(mission).filter((m) => !moving.has(m.nodeId)).map((m) => mergeThenFill(fleetId, m.nodeId));
  await Promise.all([...merges, fill(fleetId)]);
}

/** What a waiting task still waits for, and where each stands. */
const unmet = (mission: Mission, task: QueuedTask) => waitingOn(mission, task).map((title) => ({ title, state: t().plan.state[waitState(mission, title)] }));

/** Nobody is left working: the fleet hears once why nothing moves any more. */
function tellIfIdle(fleetId: string) {
  const mission = missionNow(fleetId);
  if (mission?.state !== "en_cours" || !mission.queue) return;
  const team = mission.members.filter((m) => !m.handedTo);
  if (team.some((m) => !m.report || moving.has(m.nodeId)) || seatsHeld(fleetId) > 0) return;
  const waiting = mission.queue.filter((task) => waitingOn(mission, task).length > 0);
  // Nobody works, so what a task waits for will not come on its own: say which, not "no new agent could take it".
  const line =
    mission.queue.length === 0
      ? t().lines.queueEmpty(mission.overnight === true)
      : waiting.length > 0
        ? t().lines.queueWaits(waiting.map((task) => ({ title: task.title, waits: unmet(mission, task) })))
        : t().lines.queueStuck(mission.queue.length);
  const key = `${fleetId}:${mission.startedAt}`;
  if (idleTold.get(key) === line) return;
  idleTold.set(key, line);
  notify(missionRunner(fleetId), line);
}

/** The fleet's keys in what the queue remembers having told its runner: `fleetId:startedAt…`. */
const toldBy = (fleetId: string) => (key: string) => key.startsWith(`${fleetId}:`);

/** How many lines the queue remembers having told a fleet's runner: an idle team, a duplicate skipped. */
export const toldKept = (fleetId: string) => [...idleTold.keys()].filter(toldBy(fleetId)).length + [...duplicateTold].filter(toldBy(fleetId)).length;

/** Its mission ended (`endMission`): what its runner was told goes with it, or it would pile up mission after mission. */
export function forgetTold(fleetId: string) {
  for (const key of [...idleTold.keys()].filter(toldBy(fleetId))) idleTold.delete(key);
  for (const key of [...duplicateTold].filter(toldBy(fleetId))) duplicateTold.delete(key);
}

/**
 * An agent reported: whatever its status, it no
 * longer counts against Max agents, and a new agent, in a new terminal, takes
 * its seat and the next task. "Done", its branch is merged first, its seat
 * held meanwhile. Its own terminal takes no other task. The rest is the
 * fleet's to decide.
 */
export async function afterReport(fleetId: string, nodeId: string): Promise<void> {
  if (isFleetClosed(fleetId)) return;
  const mission = missionNow(fleetId);
  const member = memberNow(fleetId, nodeId);
  const merges = mission?.queue?.length && member?.report?.status === "termine" && canStart(fleetId, mission);
  // Merging first: `fill` sees its seat taken and leaves it the first task.
  await Promise.all([merges ? mergeThenFill(fleetId, nodeId) : undefined, fill(fleetId)]);
  tellIfIdle(fleetId);
}

/**
 * `next_task`: a new agent, in a new terminal, takes the queue's next task.
 * For an agent that reported "blocked" or "failed", its task is abandoned
 * (`reassign` no longer finds it), what it did not finish stays on its branch
 * and its terminal stays for the user to look at; "done", its branch is merged
 * first, as at its report.
 */
export async function giveNext(fleetId: string, member: Member): Promise<{ given: string } | { refused: string }> {
  const report = member.report;
  if (!report) return { refused: t().reassign.notDone(member.name) };
  if (member.abandoned) return { refused: t().lines.alreadyLeft(member.name) };
  settleQueue(fleetId);
  const mission = missionNow(fleetId);
  if (mission && noNewWork(mission, Date.now())) return { refused: t().lines.windingDown };
  if (!mission) return { refused: t().lines.nothingFor(member.name) };
  if (unclaimed(fleetId, mission, false).length === 0) {
    // Tasks wait, but another agent is on each: say who, the caller reads it here.
    const waiting = (mission.queue ?? []).filter((task) => !seatHeld(fleetId, task.title));
    const held = waiting.map((task) => ({ task, who: holderOf(fleetId, mission, task) })).find(({ who }) => who);
    if (held?.who) return { refused: t().lines.duplicateNext(held.task.title, held.who) };
    // Or tasks that wait for others: say for which.
    const blocked = waiting.find((task) => waitingOn(mission, task).length > 0);
    return { refused: blocked ? t().lines.nextWaits(blocked.title, unmet(mission, blocked)) : t().lines.nothingFor(member.name) };
  }
  if (!canvasKnown(fleetId)) return { refused: t().reassign.hidden };
  if (!seatLeft(fleetId, mission)) return { refused: t().lines.noSeat(seatsOf(fleetId, mission)) };
  if (report.status === "termine" && !member.merged && !(await mergeOnce(fleetId, member.nodeId))) return { refused: t().lines.notMoved(member.name) };
  // All is read again after the merge; the seat is held before the next wait.
  const now = missionNow(fleetId);
  const task = now && unclaimed(fleetId, now, false)[0];
  if (!now || !task) return { refused: t().lines.nothingFor(member.name) };
  if (!seatLeft(fleetId, now)) return { refused: t().lines.noSeat(seatsOf(fleetId, now)) };
  holdSeat(fleetId, task.title);
  const result = await startHeld(fleetId, task);
  if (!result?.made) return { refused: result?.said ?? t().lines.nothingFor(member.name) };
  if (report.status !== "termine") updateMember(fleetId, member.nodeId, { abandoned: true });
  return { given: result.said };
}
