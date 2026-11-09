import { messages } from "@/i18n";
import { startMissionCards } from "@/kanban/orchestrate";
import { agentMessages } from "@/mcp/messages";
import { stopTerminal } from "@/nodes/terminal/registry";
import { nodesStore } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { activeCount, freeSeat, holdSeat, moving, oneAtATime, seatHeld, seatsHeld } from "./active";
import { notify } from "./events";
import { assign, mergeMember, newMember, restartIn, subTaskText, withTicketNote } from "./launch";
import { NEW_AGENT, noNewWork, oneLine, pastTask, type Member, type Mission, type QueuedTask, type SubTask } from "./mission";
import { modelFor } from "./router";
import { agentState, canvasKnown, isOrchestratorClosed, memberGroupId, missionOf, setMission } from "./store";

const t = () => messages(agentMessages);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `report` comes mid-turn, the last commit may follow it; past this an agent's turn does not hold the queue up. */
const TURN_END_MS = 60_000;
const TURN_POLL_MS = 1000;

/** What the orchestrator last heard of its idle team, by mission: told once. */
const idleTold = new Map<string, string>();

const missionNow = (orchestratorId: string) => missionOf(nodesStore.getState().nodes[orchestratorId]);
const memberNow = (orchestratorId: string, nodeId: string) => missionNow(orchestratorId)?.members.find((m) => m.nodeId === nodeId && !m.handedTo);

/** Whether an agent may take a task: of its group, or of none (spec overnight mission §4.3). */
const fits = (member: Member, task: QueuedTask) => !task.group || task.group.id === memberGroupId(member);

/** The first task an agent may take; never one a new agent is being started for. */
function nextFor(orchestratorId: string, mission: Mission, member: Member): QueuedTask | undefined {
  return mission.queue?.find((task) => fits(member, task) && !seatHeld(orchestratorId, task.title));
}

/** Those who finished and could take a task now. */
export function freeMembers(mission: Mission): Member[] {
  return mission.members.filter((m) => !m.handedTo && m.report?.status === "termine" && isRunning(m.nodeId));
}

/** New work may start: the mission runs, its orchestrator is open, and it is not winding down. */
const canStart = (orchestratorId: string, mission: Mission) => mission.state === "en_cours" && !noNewWork(mission, Date.now()) && !isOrchestratorClosed(orchestratorId);

/** Fewer than Max agents are at work: one more may start. */
const seatLeft = (orchestratorId: string, mission: Mission) => activeCount(orchestratorId, mission) < mission.maxAgents;

async function turnEnded(nodeId: string) {
  for (let waited = 0; waited < TURN_END_MS && agentState(nodeId) === "travaille"; waited += TURN_POLL_MS) {
    await new Promise((resolve) => setTimeout(resolve, TURN_POLL_MS));
  }
}

/** The member takes `task`: out of the queue and into the plan, where `reassign` and `mission` find it. */
function take(orchestratorId: string, mission: Mission, member: Member, report: NonNullable<Member["report"]>, task: QueuedTask): string {
  const subTask: SubTask = { ...task, agent: member.name };
  const model = modelFor(mission, subTask);
  const finished = report.status === "termine";
  const next: Member = {
    ...member,
    task: task.title,
    budgetMin: task.budgetMin,
    extraMin: undefined,
    overdue: undefined,
    report: undefined,
    sentAt: undefined,
    merged: undefined,
    model,
    done: finished ? [...(member.done ?? []), member.task] : member.done,
    past: [...(member.past ?? []), pastTask(member, report)],
  };
  const queue = (mission.queue ?? []).filter((waiting) => waiting !== task);
  setMission(orchestratorId, {
    queue,
    plan: [...(mission.plan ?? []), subTask],
    members: mission.members.map((m) => (m.nodeId === member.nodeId ? next : m)),
  });
  const brief = oneLine(task.brief);
  const text = t().lines.nextSubTask(mission.name ?? "", task.title, `${brief}${/[.!?]$/.test(brief) ? "" : "."}`, task.budgetMin, member.branch, mission.branch ?? "");
  // A new conversation: one task's context must not spill into the next, and its steps start over.
  void startMissionCards(orchestratorId, [next], [subTask]).catch(() => undefined);
  void assign(orchestratorId, next, withTicketNote(orchestratorId, mission, text, task), restartIn(member.nodeId, member.worktree, model, mission.permission));
  return t().lines.taken(member.name, task.title, queue.length);
}

/** The mission and member as they stand, if the member can still move on from this report. */
function stillMovable(orchestratorId: string, nodeId: string, report: NonNullable<Member["report"]>) {
  const mission = missionNow(orchestratorId);
  const member = memberNow(orchestratorId, nodeId);
  if (!mission || !member || mission.state !== "en_cours" || noNewWork(mission, Date.now()) || !isRunning(nodeId)) return null;
  if (member.report?.at !== report.at || member.report.status !== report.status) return null;
  const task = nextFor(orchestratorId, mission, member);
  return task ? { mission, member, task } : null;
}

/**
 * Moves a member that reported on to the queue's next task: its work merged
 * first when it is done, as for `reassign` (final review H3). What to say, if
 * anything. Each wait may change everything: all is read again after it.
 */
async function moveOn(orchestratorId: string, nodeId: string): Promise<string | undefined> {
  const report = memberNow(orchestratorId, nodeId)?.report;
  if (!report || !stillMovable(orchestratorId, nodeId, report)) return undefined;
  await turnEnded(nodeId);
  const ready = stillMovable(orchestratorId, nodeId, report);
  if (!ready) return undefined;
  if (report.status === "termine" && ready.mission.worktree) {
    const { line, merged, uncommitted } = await mergeMember(orchestratorId, ready.mission.worktree, ready.member);
    if (!merged || uncommitted) notify(orchestratorId, line);
    if (!merged) return undefined;
  }
  const merged = stillMovable(orchestratorId, nodeId, report);
  return merged ? take(orchestratorId, merged.mission, merged.member, report, merged.task) : undefined;
}

/** Moving on, a member holds its seat (`./active`): from the first instant, so that no new agent takes it. */
async function moveOnce(orchestratorId: string, nodeId: string): Promise<string | undefined> {
  if (moving.has(nodeId)) return undefined;
  moving.add(nodeId);
  try {
    return await moveOn(orchestratorId, nodeId);
  } finally {
    moving.delete(nodeId);
  }
}

/** A member moves on; a move that came to nothing (a conflict, a stopped terminal…) frees its seat for a new agent. */
async function moveAndTell(orchestratorId: string, nodeId: string): Promise<void> {
  const said = await moveOnce(orchestratorId, nodeId);
  if (said) notify(orchestratorId, said);
  // Never the whole queue again: it would merge a conflict over and over.
  else await fill(orchestratorId);
}

/** The queue's tasks nobody is starting on yet: a member moving on will take the first its group allows. */
function unclaimed(orchestratorId: string, mission: Mission): QueuedTask[] {
  const left = (mission.queue ?? []).filter((task) => !seatHeld(orchestratorId, task.title));
  for (const member of mission.members) {
    if (!moving.has(member.nodeId) || !member.report) continue;
    const i = left.findIndex((task) => fits(member, task));
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

/** What a new agent's creation has to say: it joined and took `task`, or why not; nothing when the mission no longer wants it. */
async function create(orchestratorId: string, task: QueuedTask): Promise<string | undefined> {
  // Its turn may come long after it was asked for: all is read again.
  const record = nodesStore.getState().nodes[orchestratorId];
  const mission = missionOf(record);
  if (!record || !mission || !canStart(orchestratorId, mission) || !canvasKnown(orchestratorId)) return undefined;
  if (!mission.queue?.some((waiting) => waiting.title === task.title)) return undefined;
  const made = await newMember(orchestratorId, record.workspaceId, mission, { ...task, agent: NEW_AGENT });
  if (typeof made === "string") return t().lines.newFailed(task.title, made);
  const now = missionNow(orchestratorId);
  // Finished meanwhile: its team is gone, this one would sit idle in its worktree.
  if (now?.state !== "en_cours") {
    stopTerminal(made.nodeId);
    return undefined;
  }
  const subTask: SubTask = { ...task, agent: made.name };
  const queue = (now.queue ?? []).filter((waiting) => waiting.title !== task.title);
  setMission(orchestratorId, { queue, plan: [...(now.plan ?? []), subTask], members: [...now.members, made] });
  // In the tick it joins the team: counted once, never twice nor not at all.
  freeSeat(orchestratorId, task.title);
  void startMissionCards(orchestratorId, [made], [subTask]).catch(() => undefined);
  void assign(orchestratorId, made, withTicketNote(orchestratorId, now, subTaskText(now.name ?? "", subTask, made.branch), task));
  return t().lines.newAgent(made.name, task.title, queue.length);
}

/** A new agent for `task`: its seat held at once, before any wait, then created in turn with the others. */
async function startNew(orchestratorId: string, task: QueuedTask): Promise<void> {
  holdSeat(orchestratorId, task.title);
  try {
    const said = await oneAtATime(orchestratorId, () => create(orchestratorId, task));
    if (said) notify(orchestratorId, said);
  } catch (error) {
    notify(orchestratorId, t().lines.newFailed(task.title, errorText(error)));
  } finally {
    freeSeat(orchestratorId, task.title);
  }
}

/**
 * New agents for the tasks no member will take, while fewer than Max agents
 * are at work: in the task's group, else the mission's, on the router's model
 * (`newMember`). Each task once and never past the cap, however many fills
 * run at once: the seats are held before the first wait.
 */
function fill(orchestratorId: string): Promise<void> {
  const mission = missionNow(orchestratorId);
  if (!mission?.queue?.length || !canStart(orchestratorId, mission) || !canvasKnown(orchestratorId)) return Promise.resolve();
  const seats = mission.maxAgents - activeCount(orchestratorId, mission);
  if (seats <= 0) return Promise.resolve();
  return Promise.all(unclaimed(orchestratorId, mission).slice(0, seats).map((task) => startNew(orchestratorId, task))).then(() => undefined);
}

/**
 * The queue moves, up to Max agents at work: every free member takes a task
 * its group allows, then new agents take the rest. After a task arrives, a
 * conflict is resolved, or the mission starts.
 */
export async function pumpQueue(orchestratorId: string): Promise<void> {
  const mission = missionNow(orchestratorId);
  if (!mission?.queue?.length) return;
  const left = unclaimed(orchestratorId, mission);
  const moves: Promise<void>[] = [];
  for (const member of freeMembers(mission)) {
    const i = left.findIndex((task) => fits(member, task));
    // A member moving on is in `moving` at once: the next one sees its seat taken.
    if (moving.has(member.nodeId) || i < 0 || !seatLeft(orchestratorId, mission)) continue;
    left.splice(i, 1);
    moves.push(moveAndTell(orchestratorId, member.nodeId));
  }
  await Promise.all([...moves, fill(orchestratorId)]);
}

/** Nobody is left working: the orchestrator hears once why nothing moves any more. */
function tellIfIdle(orchestratorId: string) {
  const mission = missionNow(orchestratorId);
  if (mission?.state !== "en_cours" || !mission.queue) return;
  const team = mission.members.filter((m) => !m.handedTo);
  if (team.some((m) => !m.report || moving.has(m.nodeId)) || seatsHeld(orchestratorId) > 0) return;
  const line = mission.queue.length === 0 ? t().lines.queueEmpty : t().lines.queueStuck(mission.queue.length);
  const key = `${orchestratorId}:${mission.startedAt}`;
  if (idleTold.get(key) === line) return;
  idleTold.set(key, line);
  notify(orchestratorId, line);
}

/**
 * An agent reported (spec overnight mission §4.3): "done", it takes the next
 * task its group allows if a seat is left; whatever its status, it no longer
 * counts against Max agents, and a new agent may take its seat. The rest is
 * the orchestrator's to decide.
 */
export async function afterReport(orchestratorId: string, nodeId: string): Promise<void> {
  if (isOrchestratorClosed(orchestratorId)) return;
  const mission = missionNow(orchestratorId);
  const member = memberNow(orchestratorId, nodeId);
  const movesOn = mission && member?.report?.status === "termine" && nextFor(orchestratorId, mission, member) && seatLeft(orchestratorId, mission);
  // Moving first: `fill` sees its seat taken and leaves it its task.
  await Promise.all([movesOn ? moveAndTell(orchestratorId, nodeId) : undefined, fill(orchestratorId)]);
  tellIfIdle(orchestratorId);
}

/** `next_task`: an agent that reported takes the next task, what it did not finish staying on its branch and its task abandoned. */
export async function giveNext(orchestratorId: string, member: Member): Promise<{ given: string } | { refused: string }> {
  if (!member.report) return { refused: t().reassign.notDone(member.name) };
  const mission = missionNow(orchestratorId);
  if (!isRunning(member.nodeId)) return { refused: t().orchestrator.stopped(member.name) };
  if (mission && noNewWork(mission, Date.now())) return { refused: t().lines.windingDown };
  if (!mission || !nextFor(orchestratorId, mission, member)) return { refused: t().lines.nothingFor(member.name) };
  const given = await moveOnce(orchestratorId, member.nodeId);
  return given ? { given } : { refused: t().lines.notMoved(member.name) };
}
