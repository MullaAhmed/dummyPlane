import { messages } from "@/i18n";
import { startMissionCards } from "@/kanban/orchestrate";
import { agentMessages } from "@/mcp/messages";
import { stopTerminal } from "@/nodes/terminal/registry";
import { nodesStore } from "@/store/nodes";
import { activeCount, freeSeat, holdSeat, moving, oneAtATime, seatHeld, seatsHeld } from "./active";
import { notify } from "./events";
import { assign, mergeMember, newMember, subTaskText, withTicketNote } from "./launch";
import { NEW_AGENT, noNewWork, type Member, type Mission, type QueuedTask, type Report, type SubTask } from "./mission";
import { agentState, canvasKnown, isOrchestratorClosed, missionOf, setMission, updateMember } from "./store";

const t = () => messages(agentMessages);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `report` comes mid-turn, the last commit may follow it; past this an agent's turn does not hold the queue up. */
const TURN_END_MS = 60_000;
const TURN_POLL_MS = 1000;

/** What the orchestrator last heard of its idle team, by mission: told once. */
const idleTold = new Map<string, string>();

const missionNow = (orchestratorId: string) => missionOf(nodesStore.getState().nodes[orchestratorId]);
const memberNow = (orchestratorId: string, nodeId: string) => missionNow(orchestratorId)?.members.find((m) => m.nodeId === nodeId && !m.handedTo);

/** New work may start: the mission runs, its orchestrator is open, and it is not winding down. */
const canStart = (orchestratorId: string, mission: Mission) => mission.state === "en_cours" && !noNewWork(mission, Date.now()) && !isOrchestratorClosed(orchestratorId);

/** Fewer than Max agents are at work: one more may start. */
const seatLeft = (orchestratorId: string, mission: Mission) => activeCount(orchestratorId, mission) < mission.maxAgents;

/** Done, its branch not in the mission's yet: a new agent's worktree, cut from the mission's branch, would miss its work. */
const unmerged = (mission: Mission) => mission.members.filter((m) => !m.handedTo && !m.abandoned && m.report?.status === "termine" && !m.merged);

async function turnEnded(nodeId: string) {
  for (let waited = 0; waited < TURN_END_MS && agentState(nodeId) === "travaille"; waited += TURN_POLL_MS) {
    await new Promise((resolve) => setTimeout(resolve, TURN_POLL_MS));
  }
}

/** The mission and member as they stand, if the member's branch is still to merge for this report. */
function mergeable(orchestratorId: string, nodeId: string, report: Report) {
  const mission = missionNow(orchestratorId);
  const member = memberNow(orchestratorId, nodeId);
  if (!mission?.worktree || !member || mission.state !== "en_cours" || noNewWork(mission, Date.now())) return null;
  if (member.report?.at !== report.at || member.report.status !== "termine") return null;
  return { mission, worktree: mission.worktree, member };
}

/**
 * Merges the branch of a member that reported "done", once its turn ended:
 * the next task's new agent starts from its work (final review H3). Whether
 * it is in. Each wait may change everything: all is read again after it.
 */
async function mergeBranch(orchestratorId: string, nodeId: string): Promise<boolean> {
  const report = memberNow(orchestratorId, nodeId)?.report;
  if (!report || !mergeable(orchestratorId, nodeId, report)) return false;
  await turnEnded(nodeId);
  const ready = mergeable(orchestratorId, nodeId, report);
  if (!ready) return false;
  const { line, merged, uncommitted } = await mergeMember(orchestratorId, ready.worktree, ready.member);
  if (!merged || uncommitted) notify(orchestratorId, line);
  return merged;
}

/** While its branch merges, a member holds its seat (`./active`) and the first task: from the first instant, so that no new agent takes them before its work is in. */
async function mergeOnce(orchestratorId: string, nodeId: string): Promise<boolean> {
  if (moving.has(nodeId)) return false;
  moving.add(nodeId);
  try {
    return await mergeBranch(orchestratorId, nodeId);
  } finally {
    moving.delete(nodeId);
  }
}

/** Its branch merged, its seat goes to a new agent; on a conflict too: the orchestrator is told, and the queue goes on. */
async function mergeThenFill(orchestratorId: string, nodeId: string): Promise<void> {
  await mergeOnce(orchestratorId, nodeId);
  await fill(orchestratorId);
}

/** The queue's tasks nobody is starting on yet; the first ones wait for the members being merged, whose seats they will take. */
function unclaimed(orchestratorId: string, mission: Mission): QueuedTask[] {
  const left = (mission.queue ?? []).filter((task) => !seatHeld(orchestratorId, task.title));
  return left.slice(mission.members.filter((m) => moving.has(m.nodeId)).length);
}

/** What a new agent's creation has to say, and the agent: it joined and took `task`, or why not; nothing when the mission no longer wants it. */
async function create(orchestratorId: string, task: QueuedTask): Promise<{ said: string; made?: Member } | undefined> {
  // Its turn may come long after it was asked for: all is read again.
  const record = nodesStore.getState().nodes[orchestratorId];
  const mission = missionOf(record);
  if (!record || !mission || !canStart(orchestratorId, mission) || !canvasKnown(orchestratorId)) return undefined;
  if (!mission.queue?.some((waiting) => waiting.title === task.title)) return undefined;
  const made = await newMember(orchestratorId, record.workspaceId, mission, { ...task, agent: NEW_AGENT });
  if (typeof made === "string") return { said: t().lines.newFailed(task.title, made) };
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
  return { said: t().lines.newAgent(made.name, task.title, queue.length), made };
}

/** A new agent for `task`: its seat held by the caller before any wait, then created in turn with the others. */
async function startHeld(orchestratorId: string, task: QueuedTask): Promise<{ said: string; made?: Member } | undefined> {
  try {
    return await oneAtATime(orchestratorId, () => create(orchestratorId, task));
  } catch (error) {
    return { said: t().lines.newFailed(task.title, errorText(error)) };
  } finally {
    freeSeat(orchestratorId, task.title);
  }
}

/** A new agent for `task`, its seat held at once. */
async function startNew(orchestratorId: string, task: QueuedTask): Promise<void> {
  holdSeat(orchestratorId, task.title);
  const result = await startHeld(orchestratorId, task);
  if (result) notify(orchestratorId, result.said);
}

/**
 * New agents for the tasks waiting, while fewer than Max agents are at work:
 * each in a new terminal, in the task's group, else the mission's, on the
 * router's model (`newMember`). An agent that finished never takes another
 * task: a new conversation keeps each task's context apart. Each task once and
 * never past the cap, however many fills run at once: the seats are held
 * before the first wait.
 */
function fill(orchestratorId: string): Promise<void> {
  const mission = missionNow(orchestratorId);
  if (!mission?.queue?.length || !canStart(orchestratorId, mission) || !canvasKnown(orchestratorId)) return Promise.resolve();
  const seats = mission.maxAgents - activeCount(orchestratorId, mission);
  if (seats <= 0) return Promise.resolve();
  return Promise.all(unclaimed(orchestratorId, mission).slice(0, seats).map((task) => startNew(orchestratorId, task))).then(() => undefined);
}

/**
 * The queue moves, up to Max agents at work: the branches of the members done
 * and not merged go into the mission's first, then new agents take the tasks.
 * After a task arrives, a conflict is resolved, or the mission starts.
 */
export async function pumpQueue(orchestratorId: string): Promise<void> {
  const mission = missionNow(orchestratorId);
  if (!mission?.queue?.length || !canStart(orchestratorId, mission)) return;
  // Each merge holds its seat at once: the parallel fill leaves it its task.
  const merges = unmerged(mission).filter((m) => !moving.has(m.nodeId)).map((m) => mergeThenFill(orchestratorId, m.nodeId));
  await Promise.all([...merges, fill(orchestratorId)]);
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
 * An agent reported (spec overnight mission §4.3): whatever its status, it no
 * longer counts against Max agents, and a new agent, in a new terminal, takes
 * its seat and the next task. "Done", its branch is merged first, its seat
 * held meanwhile. Its own terminal takes no other task. The rest is the
 * orchestrator's to decide.
 */
export async function afterReport(orchestratorId: string, nodeId: string): Promise<void> {
  if (isOrchestratorClosed(orchestratorId)) return;
  const mission = missionNow(orchestratorId);
  const member = memberNow(orchestratorId, nodeId);
  const merges = mission?.queue?.length && member?.report?.status === "termine" && canStart(orchestratorId, mission);
  // Merging first: `fill` sees its seat taken and leaves it the first task.
  await Promise.all([merges ? mergeThenFill(orchestratorId, nodeId) : undefined, fill(orchestratorId)]);
  tellIfIdle(orchestratorId);
}

/**
 * `next_task`: a new agent, in a new terminal, takes the queue's next task.
 * For an agent that reported "blocked" or "failed", its task is abandoned
 * (`reassign` no longer finds it), what it did not finish stays on its branch
 * and its terminal stays for the user to look at; "done", its branch is merged
 * first, as at its report.
 */
export async function giveNext(orchestratorId: string, member: Member): Promise<{ given: string } | { refused: string }> {
  const report = member.report;
  if (!report) return { refused: t().reassign.notDone(member.name) };
  if (member.abandoned) return { refused: t().lines.alreadyLeft(member.name) };
  const mission = missionNow(orchestratorId);
  if (mission && noNewWork(mission, Date.now())) return { refused: t().lines.windingDown };
  if (!mission || unclaimed(orchestratorId, mission).length === 0) return { refused: t().lines.nothingFor(member.name) };
  if (!canvasKnown(orchestratorId)) return { refused: t().reassign.hidden };
  if (!seatLeft(orchestratorId, mission)) return { refused: t().lines.noSeat(mission.maxAgents) };
  if (report.status === "termine" && !member.merged && !(await mergeOnce(orchestratorId, member.nodeId))) return { refused: t().lines.notMoved(member.name) };
  // All is read again after the merge; the seat is held before the next wait.
  const now = missionNow(orchestratorId);
  const task = now && unclaimed(orchestratorId, now)[0];
  if (!now || !task) return { refused: t().lines.nothingFor(member.name) };
  if (!seatLeft(orchestratorId, now)) return { refused: t().lines.noSeat(now.maxAgents) };
  holdSeat(orchestratorId, task.title);
  const result = await startHeld(orchestratorId, task);
  if (!result?.made) return { refused: result?.said ?? t().lines.nothingFor(member.name) };
  if (report.status !== "termine") updateMember(orchestratorId, member.nodeId, { abandoned: true });
  return { given: result.said };
}
