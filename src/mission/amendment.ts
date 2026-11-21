import { talk } from "@/agents/talkWires";
import { messages } from "@/i18n";
import { toastError } from "@/lib/errorToast";
import { removeCard, updateCard } from "@/kanban/board";
import { addTaskCards, missionBoard } from "@/kanban/fleetBoards";
import { agentMessages } from "@/mcp/messages";
import { nodesStore } from "@/store/nodes";
import { seatHeld } from "./active";
import { duplicateWork } from "./activeWork";
import { notify } from "./events";
import { fleetNameOf } from "./manager";
import { missionMessages } from "./messages";
import { MAX_QUEUE, namedCard, NEW_AGENT, oneLine, readTaskFields, sameName, type Amendment, type Mission, type PlanGroup, type QueuedTask } from "./mission";
import { pumpQueue } from "./queue";
import { missionOf, setMission } from "./store";
import { resolvedWaits, startedTitles, waitState } from "./waits";

/**
 * A running mission's plan is amended, not proposed again: the Fleet's `propose_plan` while the mission runs puts a
 * change to its waiting tasks before the user, who approves or declines it in the Fleet's panel as they did the first
 * plan. Nothing changes before. Only tasks no agent holds yet can be added, edited or dropped: those at work, reported
 * or done stay as they are, and an amendment naming one is refused, by name.
 */

const t = () => messages(agentMessages);

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const same = (a: string, b: string) => sameName(a, b);

/** The waiting tasks a new agent is being created for: its seat is held, so they are started though still in the queue. */
export const inFlightTitles = (fleetId: string, mission: Mission) => (mission.queue ?? []).map((task) => task.title).filter((title) => seatHeld(fleetId, title));

export interface Changes {
  /** Tasks to join the queue. */
  added: QueuedTask[];
  /** Waiting tasks to replace in their place, as they will be: what the amendment does not say is kept. */
  edited: QueuedTask[];
  /** Waiting tasks to drop, as they wait. */
  dropped: QueuedTask[];
}

/** What an amendment would do to the waiting tasks as they stand: no check of it. */
export function changesOf(queue: readonly QueuedTask[], amendment: Amendment): Changes {
  const added: QueuedTask[] = [];
  const edited: QueuedTask[] = [];
  for (const task of amendment.tasks) {
    const waiting = queue.find((other) => same(other.title, task.title));
    if (!waiting) {
      added.push(task);
      continue;
    }
    // The title, card and giver of a waiting task are its own: an edit changes what the agent will be asked to do.
    const merged: QueuedTask = { ...task, title: waiting.title };
    if (waiting.card && !merged.card) merged.card = waiting.card;
    if (waiting.handedBy) merged.handedBy = waiting.handedBy;
    edited.push(merged);
  }
  return { added, edited, dropped: queue.filter((task) => amendment.drop.some((title) => same(title, task.title))) };
}

/** Where a task an amendment may not touch stands, in words. */
function stateOf(mission: Mission, title: string, inFlight: readonly string[]): string {
  const e = t().plan.state;
  if (inFlight.some((other) => same(other, title))) return e.starting;
  const state = waitState(mission, title);
  return state === "queued" ? e.started : e[state];
}

/**
 * The amendment as it stands against the mission now: the waiting tasks it leaves, and what it changes. Or why it
 * cannot be applied, whole: a task it names that an agent holds (or is being given to), a task to drop that waits no
 * more, a queue past its limit, a wait that stands for no task or goes in circles. The same check proposes it and, read
 * again, approves it: a task may have started in between.
 */
export function settledAmendment(mission: Mission, amendment: Amendment, inFlight: readonly string[]): ({ queue: QueuedTask[] } & Changes) | string {
  const e = t();
  const queue = mission.queue ?? [];
  const started = startedTitles(mission);
  const named = [...amendment.drop, ...amendment.tasks.map((task) => task.title)];
  // Named as the mission has them, once each, whatever case the Fleet typed.
  const held = named.flatMap((title, i) => {
    const holds = [...started, ...inFlight].find((other) => same(other, title));
    return holds && named.findIndex((other) => same(other, title)) === i ? [holds] : [];
  });
  if (held.length > 0) return e.fleet.amendmentStarted(held.map((title) => ({ title, state: stateOf(mission, title, inFlight) })));
  const gone = amendment.drop.find((title) => !queue.some((task) => same(task.title, title)));
  if (gone !== undefined) return e.plan.amendmentNotWaiting(gone);
  // An edit of a task that left the queue meanwhile (its card Done, `settleQueue`) is no task to add again.
  const left = (amendment.replaces ?? []).find((title) => !queue.some((task) => same(task.title, title)));
  if (left !== undefined) return e.plan.amendmentEditGone(left);
  const both = amendment.drop.find((title) => amendment.tasks.some((task) => same(task.title, title)));
  if (both !== undefined) return e.fleet.amendmentBoth(both);
  const { added, edited, dropped } = changesOf(queue, amendment);
  const kept = queue.filter((task) => !dropped.includes(task) && !edited.some((other) => same(other.title, task.title)));
  if (kept.length + edited.length + added.length > MAX_QUEUE) return e.plan.queueFull(MAX_QUEUE);
  // What each task waits for, in the amendment's own order, against what is left of the queue and what has started.
  const batch = amendment.tasks.map((task) => edited.find((other) => same(other.title, task.title)) ?? task);
  const resolved = resolvedWaits(batch, kept, started, dropped.map((task) => task.title));
  if (typeof resolved === "string") return resolved;
  const final = (task: QueuedTask) => resolved.find((other) => same(other.title, task.title)) ?? task;
  return {
    queue: [...queue.filter((task) => !dropped.includes(task)).map((task) => (edited.some((other) => same(other.title, task.title)) ? final(task) : task)), ...added.map(final)],
    added: added.map(final),
    edited: edited.map(final),
    dropped,
  };
}

/**
 * `propose_plan` on a running mission: its arguments (internal names, `@/mcp/protocol`) as an amendment, checked
 * against the mission, or what is wrong. `task`: what the user asked, restated; `sous_taches`: tasks to add, or, under
 * the title of a waiting one, to replace it; `drop`: titles of waiting tasks to drop.
 */
export function proposedAmendment(
  args: Record<string, unknown>,
  mission: Mission,
  inFlight: readonly string[],
  groups: readonly PlanGroup[] = [],
  cards: readonly string[] = [],
): { amendment: Amendment; changes: Changes } | string {
  const e = t();
  const task = text(args.tache);
  if (!task) return e.plan.task;
  const raw = args.sous_taches === undefined || args.sous_taches === null ? [] : args.sous_taches;
  const asked = args.drop === undefined || args.drop === null ? [] : args.drop;
  if (!Array.isArray(raw)) return e.plan.atLeastOne;
  if (!Array.isArray(asked) || asked.some((title) => typeof title !== "string" || !text(title))) return e.fleet.amendmentDrop;
  if (raw.length === 0 && asked.length === 0) return e.plan.amendmentEmpty;
  const queue = mission.queue ?? [];
  const tasks: QueuedTask[] = [];
  for (const [i, item] of raw.entries()) {
    const r = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const n = i + 1;
    const fields = readTaskFields(r, n, mission);
    if (typeof fields === "string") return fields;
    // A waiting task has no agent yet: whoever has a seat first takes it, as for any queued task.
    const agent = text(r.agent);
    if (agent && !same(agent, NEW_AGENT)) return e.plan.amendmentAgent(n);
    const earlier = tasks.findIndex((other) => same(other.title, fields.title));
    if (earlier !== -1) return e.plan.titleTaken(n, fields.title, { kind: "call", n: earlier + 1 });
    const wanted = text(r.groupe);
    const group = wanted ? groups.find((g) => same(g.name, wanted)) : undefined;
    if (wanted && !group) return e.plan.notLinkedGroup(n, wanted);
    const card = namedCard(r, cards);
    if (card === null) return e.plan.card(n, String(r.card));
    // An edit keeps what it does not say: its group, its card, and the tasks it waits for.
    const waiting = queue.find((other) => same(other.title, fields.title));
    const waitsFor = Array.isArray(r.waits_for) ? fields.waitsFor : waiting?.waitsFor;
    const kept = group ?? waiting?.group;
    const carded = card || waiting?.card;
    tasks.push({ ...fields, ...(kept ? { group: { id: kept.id, name: kept.name } } : {}), ...(carded ? { card: carded } : {}), ...(waitsFor?.length ? { waitsFor } : {}) });
  }
  const drop = asked.map((title) => queue.find((other) => same(other.title, text(title)))?.title ?? text(title));
  const replaces = tasks.flatMap((other) => queue.filter((waiting) => same(waiting.title, other.title)).map((waiting) => waiting.title));
  const amendment: Amendment = { task, tasks, drop: drop.filter((title, i) => drop.findIndex((other) => same(other, title)) === i), ...(replaces.length > 0 ? { replaces } : {}) };
  const settled = settledAmendment(mission, amendment, inFlight);
  if (typeof settled === "string") return settled;
  // As they will be: the waits resolved to titles.
  return { amendment: { ...amendment, tasks: [...settled.edited, ...settled.added] }, changes: settled };
}

/** The agents' view of what an amendment changes: titles only. */
export const titlesOf = (changes: Changes) => ({ added: changes.added.map((task) => task.title), edited: changes.edited.map((task) => task.title), dropped: changes.dropped.map((task) => task.title) });

/** Tasks about to join the queue that an agent is already at work on (`./duplicateTask`), numbered as the amendment gave them. */
function alreadyOnIt(fleetId: string, mission: Mission, tasks: readonly QueuedTask[]) {
  const workspaceId = nodesStore.getState().nodes[fleetId]?.workspaceId;
  return tasks.flatMap((task, i) => {
    const who = duplicateWork(task, workspaceId, [fleetId, mission.manager]);
    return who ? [{ n: i + 1, title: task.title, who }] : [];
  });
}

/**
 * Cards of the tasks an amendment changes, on a board made for the mission: an edited task's card takes its new
 * brief, a dropped task's card goes (unless it is the user's own, on a board they handed over, or tied to a GitHub
 * issue). The titles of the dropped tasks whose card stays.
 */
function followOnBoard(fleetId: string, mission: Mission, edited: readonly QueuedTask[], dropped: readonly QueuedTask[]): string[] {
  const found = missionBoard(fleetId);
  const kept: string[] = [];
  let board = found?.board;
  for (const task of edited) {
    if (found && mission.boardMade && task.card && board?.cards[task.card]) board = updateCard(board, task.card, { notes: oneLine(task.brief) });
  }
  for (const task of dropped) {
    const card = task.card ? board?.cards[task.card] : undefined;
    if (!task.card || !card) continue;
    if (found && board && mission.boardMade && !card.github) board = removeCard(board, task.card);
    else kept.push(task.title);
  }
  if (found && board && board !== found.board) nodesStore.getState().update(found.nodeId, { columns: board.columns, cards: board.cards });
  return kept;
}

/**
 * "Apply the changes": the amendment is checked once more against the mission as it stands (a task may have started,
 * or the Manager queued another), then applied whole, or not at all: the Fleet is told which. The board follows (new
 * tasks get their card), the Manager and the Fleet hear what changed, and the queue goes on with it.
 */
export function approveAmendment(fleetId: string): void {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  const amendment = mission?.amendment;
  if (!mission || mission.state !== "en_cours" || !amendment) return;
  const voided = (reason: string) => {
    setMission(fleetId, { amendment: undefined });
    notify(fleetId, t().fleet.amendmentVoid(reason));
    toastError(messages(missionMessages).amendmentVoid, { error: reason });
  };
  const settled = settledAmendment(mission, amendment, inFlightTitles(fleetId, mission));
  if (typeof settled === "string") return voided(settled);
  const already = alreadyOnIt(fleetId, mission, settled.added);
  if (already.length > 0) return voided(t().fleet.duplicateTasks(already));
  // The new tasks get their card now, in the to-do column of a board a Manager runs.
  const carded = addTaskCards(fleetId, settled.added);
  const queue = settled.queue.map((task) => carded.find((other) => same(other.title, task.title)) ?? task);
  const kept = followOnBoard(fleetId, mission, settled.edited, settled.dropped);
  setMission(fleetId, { queue, amendment: undefined });
  const change = titlesOf(settled);
  const latest = missionOf(nodesStore.getState().nodes[fleetId]) ?? mission;
  if (latest.manager && latest.board) {
    talk(fleetId, latest.board);
    talk(latest.board, latest.manager);
    notify(latest.manager, t().lines.amendmentApplied(fleetNameOf(fleetId), change, kept));
  }
  notify(fleetId, t().fleet.amendmentApproved(change));
  void pumpQueue(fleetId);
}

/** "Decline": nothing changed; the Fleet is told, to ask the user what they want. */
export function declineAmendment(fleetId: string): void {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!mission?.amendment) return;
  setMission(fleetId, { amendment: undefined });
  notify(fleetId, t().fleet.amendmentDeclined);
}
