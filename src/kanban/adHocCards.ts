import { adHocOf } from "@/agents/seats";
import { cutWhole } from "@/lib/cut";
import { messages } from "@/i18n";
import { MAX_AD_HOC_CARDS, oneLine, type AdHocCard, type ReportStatus } from "@/mission/mission";
import { missionOf, setMission } from "@/mission/store";
import type { KanbanPayload } from "@/nodes/types";
import { nodeNameOf, nodesStore } from "@/store/nodes";
import { addCard, columnOf } from "./board";
import { missionBoard } from "./fleetBoards";
import { moveCardWithGithub } from "./github";
import { kanbanMessages } from "./messages";
import { doneTarget, flagCard, setCardAgent, withBlockedColumn, withInProgressColumn } from "./missionLink";

/**
 * The cards of the agents a Fleet opens with spawn_agent beside its running mission, outside its plan and its queue: the
 * mission's board shows them, so that the user sees on one board all the work its Fleet started. Only for the Fleet's own
 * ad-hoc agents and what descends from them while its mission is under way (`adHocOf`, the walk that also holds their
 * levels), on the board the mission runs on and no other; none for a mission's Manager, its team, or an agent no Fleet is
 * over. A card goes up "In progress" with its agent as the chip, the notes saying it is ad hoc; the agent's report moves
 * it: Done on "done", the "Blocked" column and an alert chip on "blocked" or "failed", as a member's does
 * (`@/kanban/fleetBoards`). There is no branch to merge for an agent beside the plan, so "done" is Done at once.
 */

const t = () => messages(kanbanMessages);

/** The notes of a card are one line, cut as the plan request cuts them. */
const MAX_NOTES = 280;

const boardOf = (nodeId: string): KanbanPayload | null => {
  const record = nodesStore.getState().nodes[nodeId];
  return record?.kind === "kanban" ? record.payload : null;
};

/**
 * `child`, a sub-agent `parentId` just opened with spawn_agent, gets its card on its mission's board when it is ad hoc.
 * Nothing when the parent runs beside no mission under way, when the mission has no board, or when the board is gone; never
 * throws, the sub-agent is open whatever happens here.
 */
export function cardAdHocAgent(parentId: string, child: { nodeId: string; name: string; title: string; task: string }): void {
  try {
    const over = adHocOf(parentId);
    if (!over) return;
    const found = missionBoard(over.fleetId);
    if (!found) return;
    const placed = withInProgressColumn(found.board, t().inProgress);
    const spawner = nodeNameOf(nodesStore.getState().nodes[parentId]) || "an agent";
    const task = oneLine(child.task);
    const known = new Set(Object.keys(placed.board.cards));
    const drafted = addCard(placed.board, placed.columnId, {
      title: child.title,
      notes: t().adHoc(spawner, task.length > MAX_NOTES ? `${cutWhole(task, MAX_NOTES - 1)}…` : task),
      priority: "none",
    });
    const card = Object.keys(drafted.cards).find((id) => !known.has(id));
    if (!card) return;
    const next = setCardAgent(drafted, card, child.name);
    nodesStore.getState().update(found.nodeId, { columns: next.columns, cards: next.cards });
    const mission = missionOf(nodesStore.getState().nodes[over.fleetId]);
    const entry: AdHocCard = { nodeId: child.nodeId, board: found.nodeId, card };
    setMission(over.fleetId, { adHoc: [...(mission?.adHoc ?? []).filter((c) => c.nodeId !== child.nodeId), entry].slice(-MAX_AD_HOC_CARDS) });
  } catch (error) {
    console.warn(`card of ${child.name} not made`, error);
  }
}

/** The card an ad-hoc agent has, and the Fleet whose mission kept it; none for any other agent. */
function adHocCardOf(nodeId: string): { fleetId: string; entry: AdHocCard } | null {
  for (const [fleetId, record] of Object.entries(nodesStore.getState().nodes)) {
    const entry = missionOf(record)?.adHoc?.find((c) => c.nodeId === nodeId);
    if (entry) return { fleetId, entry };
  }
  return null;
}

/**
 * An agent's `report`: its card, when it is an ad-hoc agent's, follows. Done goes to the board's done column with its alert
 * cleared; blocked or failed puts the chip on alert and the card in "Blocked" (made before the done column if the board has
 * none). A card the user took off the board is not made again.
 */
export async function adHocReported(nodeId: string, status: ReportStatus): Promise<void> {
  const found = adHocCardOf(nodeId);
  if (!found) return;
  const { fleetId, entry } = found;
  const board = boardOf(entry.board);
  const card = board?.cards[entry.card];
  if (!board || !card) return;
  const folder = missionOf(nodesStore.getState().nodes[fleetId])?.project;
  if (status === "termine") {
    const cleared = card.agent ? setCardAgent(board, entry.card, card.agent) : board;
    if (cleared !== board) nodesStore.getState().update(entry.board, { cards: cleared.cards });
    const target = doneTarget(cleared, entry.card);
    if (target) await moveCardWithGithub(entry.board, entry.card, target, undefined, folder);
    return;
  }
  const placed = withBlockedColumn(flagCard(board, entry.card, status === "bloque" ? "blocked" : "failed"), t().blocked);
  nodesStore.getState().update(entry.board, { columns: placed.board.columns, cards: placed.board.cards });
  if (columnOf(placed.board, entry.card)?.id !== placed.columnId) await moveCardWithGithub(entry.board, entry.card, placed.columnId, undefined, folder);
}
