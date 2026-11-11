import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import { addFleet } from "@/fleet/fleets";
import { messages } from "@/i18n";
import { notify } from "@/mission/events";
import type { Member, SubTask } from "@/mission/mission";
import { missionOf } from "@/mission/store";
import type { KanbanAgentStatus, KanbanPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { moveCardWithGithub } from "./github";
import { kanbanMessages } from "./messages";
import { columnOf } from "./board";
import { doneTarget, flagCard, linkedTo, linkFleet, planRequest, setCardAgent, startCard, todoColumnOf, withBlockedColumn, withTaskCards, type CardTask } from "./missionLink";

// The Kanban node's fleet wiring: "Plan with the fleet", and its cards following the mission.

const t = () => messages(kanbanMessages);

function boardOf(nodeId: string): KanbanPayload | null {
  const record = nodesStore.getState().nodes[nodeId];
  return record?.kind === "kanban" ? record.payload : null;
}

/** The boards handed to a fleet. */
export function linkedBoards(fleetId: string): { nodeId: string; board: KanbanPayload }[] {
  return Object.entries(nodesStore.getState().nodes).flatMap(([nodeId, record]) =>
    record.kind === "kanban" && linkedTo(record.payload, fleetId) ? [{ nodeId, board: record.payload }] : [],
  );
}

/** Right of the board, for a new fleet. */
function besideBoard(boardId: string) {
  const element = canvasStore.getState().api?.getSceneElements().find((e) => e.id === boardId);
  if (!element) return null;
  return { x: element.x + element.width + 80 + 320, y: element.y + 380 };
}

/**
 * "Plan with the fleet": the column is handed to `fleetId`
 * (a new one with null) and its cards typed in its terminal, as soon as it is free.
 */
export async function planWithFleet(boardId: string, columnId: string, fleetId: string | null): Promise<boolean> {
  const record = nodesStore.getState().nodes[boardId];
  const board = boardOf(boardId);
  if (!record || !board) return false;
  const text = planRequest(board, columnId, t().plan);
  if (!text) {
    toast.error(t().plan.empty(board.columns.find((c) => c.id === columnId)?.title ?? ""));
    return false;
  }
  let target = fleetId;
  if (target === null) {
    const spot = besideBoard(boardId);
    target = spot ? await addFleet(record.workspaceId, spot) : null;
  }
  const fleet = target ? nodesStore.getState().nodes[target] : undefined;
  if (!target || fleet?.kind !== "fleet") return false;
  const latest = boardOf(boardId);
  if (latest) nodesStore.getState().update(boardId, { orchestrator: linkFleet(latest, target, columnId).orchestrator });
  notify(target, text);
  toast.success(t().plan.sent(fleet.payload.name));
  return true;
}

/** The project of the fleet's mission, which may not be the one on screen. */
const missionFolder = (fleetId: string) => missionOf(nodesStore.getState().nodes[fleetId])?.project;

/** The board holding a card among those handed to the fleet. */
function boardWithCard(fleetId: string, cardId: string): string | null {
  return linkedBoards(fleetId).find(({ board }) => board.cards[cardId])?.nodeId ?? null;
}

/** The mission starts: each sub-task's card goes "In progress", its agent as a chip. `members[i]` does `plan[i]`. */
export async function startMissionCards(fleetId: string, members: readonly Member[], plan: readonly SubTask[]) {
  for (const [i, task] of plan.entries()) {
    const member = members[i];
    if (!task.card || !member) continue;
    const boardId = boardWithCard(fleetId, task.card);
    const board = boardId ? boardOf(boardId) : null;
    const started = board ? startCard(board, task.card, member.name, t().inProgress) : null;
    if (!boardId || !started) continue;
    nodesStore.getState().update(boardId, { columns: started.board.columns, cards: started.board.cards });
    await moveCardWithGithub(boardId, task.card, started.columnId, undefined, missionFolder(fleetId));
  }
}

/** The card of a sub-task, by its title, and the board holding it. */
function taskCard(fleetId: string, plan: readonly SubTask[] | undefined, task: string): { boardId: string; board: KanbanPayload; card: string } | null {
  const card = plan?.find((s) => s.title === task)?.card;
  const boardId = card ? boardWithCard(fleetId, card) : null;
  const board = boardId ? boardOf(boardId) : null;
  return card && boardId && board ? { boardId, board, card } : null;
}

function saveCards(boardId: string, before: KanbanPayload, after: KanbanPayload) {
  if (after !== before) nodesStore.getState().update(boardId, { cards: after.cards });
}

/** A member reported done: its sub-task's card goes to the done column, its alert cleared, and its issue follows on GitHub. */
export async function finishMissionCard(fleetId: string, plan: readonly SubTask[] | undefined, task: string) {
  const found = taskCard(fleetId, plan, task);
  if (!found) return;
  const agent = found.board.cards[found.card].agent;
  if (agent) saveCards(found.boardId, found.board, setCardAgent(found.board, found.card, agent));
  const target = doneTarget(boardOf(found.boardId) ?? found.board, found.card);
  if (target) await moveCardWithGithub(found.boardId, found.card, target, undefined, missionFolder(fleetId));
}

/**
 * A member reported blocked or failed: its chip on alert. On a board a Manager runs, the card goes to the
 * "Blocked" column (made before the done column if the board has none); on a mission run the old way it
 * stays "In progress".
 */
export async function flagMissionCard(fleetId: string, plan: readonly SubTask[] | undefined, task: string, status: KanbanAgentStatus) {
  const found = taskCard(fleetId, plan, task);
  if (!found) return;
  const flagged = flagCard(found.board, found.card, status);
  if (!missionOf(nodesStore.getState().nodes[fleetId])?.manager) {
    saveCards(found.boardId, found.board, flagged);
    return;
  }
  const placed = withBlockedColumn(flagged, t().blocked);
  nodesStore.getState().update(found.boardId, { columns: placed.board.columns, cards: placed.board.cards });
  if (columnOf(placed.board, found.card)?.id !== placed.columnId) await moveCardWithGithub(found.boardId, found.card, placed.columnId, undefined, missionFolder(fleetId));
}

/** `reassign`: the card's chip names the agent it went to; on a board a Manager runs, it is "In progress" again. */
export async function reassignMissionCard(fleetId: string, plan: readonly SubTask[] | undefined, task: string, agent: string) {
  const found = taskCard(fleetId, plan, task);
  if (!found) return;
  if (!missionOf(nodesStore.getState().nodes[fleetId])?.manager) {
    saveCards(found.boardId, found.board, setCardAgent(found.board, found.card, agent));
    return;
  }
  const started = startCard(found.board, found.card, agent, t().inProgress);
  if (!started) return;
  nodesStore.getState().update(found.boardId, { columns: started.board.columns, cards: started.board.cards });
  if (columnOf(started.board, found.card)?.id !== started.columnId) await moveCardWithGithub(found.boardId, found.card, started.columnId, undefined, missionFolder(fleetId));
}

/** The board a Manager runs the fleet's mission on, if it is still there. */
export function missionBoard(fleetId: string): { nodeId: string; board: KanbanPayload } | null {
  const boardId = missionOf(nodesStore.getState().nodes[fleetId])?.board;
  const board = boardId ? boardOf(boardId) : null;
  return boardId && board ? { nodeId: boardId, board } : null;
}

/**
 * Tasks added to a mission a Manager runs: each one without a card gets one in the board's to-do column
 * (`todoColumnOf`). The tasks with their cards; as they were without a board.
 */
export function addTaskCards<T extends CardTask>(fleetId: string, tasks: readonly T[]): T[] {
  const found = missionBoard(fleetId);
  const column = found ? todoColumnOf(found.board, fleetId) : undefined;
  if (!found || !column) return [...tasks];
  // A task handling a card of another board handed to the fleet keeps it: that card follows it.
  const elsewhere = new Set(linkedBoards(fleetId).flatMap(({ nodeId, board }) => (nodeId === found.nodeId ? [] : Object.keys(board.cards))));
  const carded = withTaskCards(found.board, column.id, tasks, undefined, (cardId) => elsewhere.has(cardId));
  if (carded.board !== found.board) nodesStore.getState().update(found.nodeId, { columns: carded.board.columns, cards: carded.board.cards });
  return carded.tasks;
}

/** `move_card`: a card of the mission's board to a column; its GitHub issue follows like any move. */
export async function moveMissionCard(fleetId: string, cardId: string, columnId: string): Promise<void> {
  const found = missionBoard(fleetId);
  if (found?.board.cards[cardId]) await moveCardWithGithub(found.nodeId, cardId, columnId, undefined, missionFolder(fleetId));
}
