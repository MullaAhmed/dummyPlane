import { missionRunsBoard, wiredBoardsOf, type WiredBoard } from "@/agents/boardLinks";
import { talk } from "@/agents/talkWires";
import { messages } from "@/i18n";
import { addCard } from "@/kanban/board";
import { moveCardWithGithub } from "@/kanban/github";
import { boardView } from "@/kanban/missionLink";
import { oneLine, sameName } from "@/mission/mission";
import { KANBAN_PRIORITIES, type KanbanColumn, type KanbanPriority } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { refused, said, type ToolResult } from "./agentTools";
import { agentMessages } from "./messages";

/**
 * The tools of an agent, or a Fleet, wired to a Kanban board (`@/agents/boardLinks`): read the board's cards, add
 * one, move one. They work the same store as the board's own menu and the Manager's `move_card`: the Kanban node's
 * payload, through `@/kanban/board`, and a move goes through `moveCardWithGithub` so a linked issue follows. A mission's
 * own board is read-only to them: its Manager moves its cards.
 */

const t = () => messages(agentMessages);

/** The tools' names: the agent's and the Fleet's lists carry them, the Manager's does not. */
export const BOARD_TOOLS: ReadonlySet<string> = new Set(["linked_boards", "add_board_card", "move_board_card"]);

/** Their specs, after the linked agents' (`./linkTools.ts`). */
export function boardTools() {
  const d = t().tools;
  return [
    { name: "linked_boards", description: d.linkedBoards, inputSchema: { type: "object", properties: {} } },
    {
      name: "add_board_card",
      description: d.addBoardCard,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: d.boardCardTitle },
          notes: { type: "string", description: d.boardCardNotes },
          column: { type: "string", description: d.boardCardColumn },
          priority: { type: "string", enum: [...KANBAN_PRIORITIES], description: d.boardCardPriority },
          board: { type: "string", description: d.boardId },
        },
        required: ["title"],
      },
    },
    {
      name: "move_board_card",
      description: d.moveBoardCard,
      inputSchema: {
        type: "object",
        properties: { card: { type: "string", description: d.moveBoardCardCard }, column: { type: "string", description: d.moveBoardCardColumn } },
        required: ["card", "column"],
      },
    },
  ];
}

/** The boards wired to the caller; else why none can be used. */
function wired(nodeId: string): WiredBoard[] | ToolResult {
  const boards = wiredBoardsOf(nodeId);
  if (boards === null) return refused(t().links.noCanvas);
  return boards;
}

const isRefusal = (value: WiredBoard[] | ToolResult): value is ToolResult => !Array.isArray(value);

function listBoards(nodeId: string): ToolResult {
  const boards = wired(nodeId);
  if (isRefusal(boards)) return boards;
  if (boards.length === 0) return said(t().boards.none);
  // `editable`: a mission's board is read-only here, so the agent does not try, and fail, to write.
  const views = boards.map(({ nodeId: boardId, board }) => ({ ...boardView(boardId, board), editable: !missionRunsBoard(boardId) }));
  return said(JSON.stringify({ note: t().boards.note, boards: views }, null, 2));
}

/** A column of `columns` by its id, else by its title. */
const columnNamed = (columns: readonly KanbanColumn[], wanted: string) => columns.find((c) => c.id === wanted) ?? columns.find((c) => sameName(c.title, wanted));

/** The board to add to: the one named, or the only one wired. */
function boardToAdd(boards: WiredBoard[], raw: unknown): WiredBoard | ToolResult {
  const b = t().boards;
  const ids = boards.map((board) => board.nodeId).join(", ");
  if (boards.length === 0) return refused(b.none);
  const wanted = typeof raw === "string" ? raw.trim() : "";
  if (!wanted) return boards.length === 1 ? boards[0] : refused(b.which(ids));
  return boards.find((board) => board.nodeId === wanted) ?? refused(b.notWired(wanted, ids));
}

/** A board's cards are the Manager's while its mission is under way: the tools that write say so. */
const missionHolds = (boardId: string) => (missionRunsBoard(boardId) ? refused(t().boards.mission) : null);

function addBoardCard(nodeId: string, args: Record<string, unknown>): ToolResult {
  const boards = wired(nodeId);
  if (isRefusal(boards)) return boards;
  const found = boardToAdd(boards, args.board);
  if ("content" in found) return found;
  const held = missionHolds(found.nodeId);
  if (held) return held;
  const title = typeof args.title === "string" ? oneLine(args.title) : "";
  if (!title) return refused(t().boards.titleMissing);
  const priority = args.priority === undefined ? "none" : args.priority;
  if (!(KANBAN_PRIORITIES as readonly unknown[]).includes(priority)) return refused(t().boards.priorityUnknown(String(priority)));
  // Read again: the board is the node's now, and the user may have changed it meanwhile.
  const record = nodesStore.getState().nodes[found.nodeId];
  const board = record?.kind === "kanban" ? record.payload : found.board;
  if (board.columns.length === 0) return refused(t().boards.noColumns);
  const wantedColumn = typeof args.column === "string" ? args.column.trim() : "";
  const column = wantedColumn ? columnNamed(board.columns, wantedColumn) : board.columns[0];
  if (!column) return refused(t().fleet.columnUnknown(wantedColumn, board.columns.map((c) => c.title).join(", ")));
  const notes = typeof args.notes === "string" ? args.notes.trim() : "";
  let id = "";
  const next = addCard(board, column.id, { title, notes, priority: priority as KanbanPriority }, () => (id = crypto.randomUUID()));
  nodesStore.getState().update(found.nodeId, { columns: next.columns, cards: next.cards });
  talk(nodeId, found.nodeId);
  return said(t().boards.added(title, column.title, id));
}

/** The card `raw` names among the wired boards: by id, else by title when only one has it. */
function cardNamed(boards: WiredBoard[], raw: unknown): { board: WiredBoard; cardId: string } | ToolResult {
  const b = t().boards;
  const wanted = typeof raw === "string" ? raw.trim() : "";
  const byId = boards.find(({ board }) => board.cards[wanted]);
  if (byId) return { board: byId, cardId: wanted };
  const byTitle = wanted ? boards.flatMap((board) => Object.values(board.board.cards).filter((card) => sameName(card.title, wanted)).map((card) => ({ board, cardId: card.id }))) : [];
  if (byTitle.length > 1) return refused(b.cardAmbiguous(wanted, byTitle.map((match) => match.cardId).join(", ")));
  return byTitle[0] ?? refused(b.cardUnknown(wanted));
}

async function moveBoardCard(nodeId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const boards = wired(nodeId);
  if (isRefusal(boards)) return boards;
  if (boards.length === 0) return refused(t().boards.none);
  const found = cardNamed(boards, args.card);
  if ("content" in found) return found;
  const held = missionHolds(found.board.nodeId);
  if (held) return held;
  const card = found.board.board.cards[found.cardId];
  const wantedColumn = typeof args.column === "string" ? args.column.trim() : "";
  const column = columnNamed(found.board.board.columns, wantedColumn);
  if (!column) return refused(t().fleet.columnUnknown(wantedColumn, found.board.board.columns.map((c) => c.title).join(", ")));
  // Where `gh` runs for a linked issue: the agent's own folder (a Fleet has none: the project on screen). Never an empty
  // one, which would stand for a folder and keep the issue where it was.
  const folder = terminalOf(nodesStore.getState().nodes[nodeId])?.cwd.trim() || undefined;
  await moveCardWithGithub(found.board.nodeId, card.id, column.id, undefined, folder);
  talk(nodeId, found.board.nodeId);
  return said(t().fleet.cardMoved(card.title, column.title));
}

/** One call of an agent's, or a Fleet's, board tools, by name; null when `name` is none of them. */
export function boardTool(nodeId: string, name: string, args: Record<string, unknown>): ToolResult | Promise<ToolResult> | null {
  switch (name) {
    case "linked_boards":
      return listBoards(nodeId);
    case "add_board_card":
      return addBoardCard(nodeId, args);
    case "move_board_card":
      return moveBoardCard(nodeId, args);
    default:
      return null;
  }
}
