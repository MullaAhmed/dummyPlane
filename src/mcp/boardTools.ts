import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { missionRunsBoard, wiredBoardsOf, type WiredBoard } from "@/agents/boardLinks";
import { freeSpotClear, NODE_GAP } from "@/agents/groupLayout";
import { laneCovers } from "@/agents/laneCover";
import type { Rect } from "@/canvas/groups";
import { sceneAccess } from "@/agents/sceneAccess";
import { clip } from "@/agents/taskSummary";
import { talk } from "@/agents/talkWires";
import { boardLinksOf, withBoardLink } from "@/agents/wires";
import { createNodeElement, NODE_SIZE, nodeKindOf } from "@/canvas/nodeElement";
import { messages } from "@/i18n";
import { addCard, emptyBoard, type CardDraft } from "@/kanban/board";
import { moveCardWithGithub } from "@/kanban/github";
import { kanbanMessages } from "@/kanban/messages";
import { oneLine, sameName } from "@/mission/mission";
import { KANBAN_PRIORITIES, type KanbanColumn, type KanbanPayload, type KanbanPriority } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { refused, said, type ToolResult } from "./agentTools";
import { boardsAnswer } from "./boardAnswer";
import { agentMessages } from "./messages";

/**
 * The tools of an agent, or a Fleet, wired to a Kanban board (`@/agents/boardLinks`): read the board's cards, add
 * one, move one. They work the same store as the board's own menu and the Manager's `move_card`: the Kanban node's
 * payload, through `@/kanban/board`, and a move goes through `moveCardWithGithub` so a linked issue follows. A mission's
 * own board is read-only to them: its Manager moves its cards. And open_board opens a board of the caller's own,
 * beside it and wired to it as "+ Link" wires one, for the work it tracks.
 */

const t = () => messages(agentMessages);

/** The tools' names: the agent's and the Fleet's lists carry them, the Manager's does not. */
export const BOARD_TOOLS: ReadonlySet<string> = new Set(["linked_boards", "add_board_card", "move_board_card", "open_board"]);

/** A board's name is a header's: longer ones are clipped. */
const MAX_BOARD_TITLE = 80;

/** Their specs, after the linked agents' (`./linkTools.ts`). */
export function boardTools() {
  const d = t().tools;
  return [
    { name: "linked_boards", description: d.linkedBoards, inputSchema: { type: "object", properties: { card: { type: "string", description: d.linkedBoardsCard } } } },
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
    {
      name: "open_board",
      description: d.openBoard,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: MAX_BOARD_TITLE, description: d.openBoardTitle },
          columns: { type: "array", items: { type: "string" }, description: d.openBoardColumns(messages(kanbanMessages).defaultColumns.join(", ")) },
          cards: {
            type: "array",
            description: d.openBoardCards,
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: d.boardCardTitle },
                notes: { type: "string", description: d.boardCardNotes },
                priority: { type: "string", enum: [...KANBAN_PRIORITIES], description: d.boardCardPriority },
              },
              required: ["title"],
            },
          },
        },
        required: ["title"],
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

function listBoards(nodeId: string, args: Record<string, unknown>): ToolResult {
  const boards = wired(nodeId);
  if (isRefusal(boards)) return boards;
  if (boards.length === 0) return said(t().boards.none);
  // `editable`: a mission's board is read-only here, so the agent does not try, and fail, to write.
  return boardsAnswer(boards, { tool: "linked_boards", note: t().boards.note, card: args.card, extra: (boardId) => ({ editable: !missionRunsBoard(boardId) }) });
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
  // The card lands at once; its issue follows in the board's GitHub queue, which a slow `gh` holds up to 60 s a call
  // behind the board's earlier moves, far past the 30 s Rust gives a tool. Its failure is the user's toast, as for a drag.
  void moveCardWithGithub(found.board.nodeId, card.id, column.id, undefined, folder).catch(() => undefined);
  talk(nodeId, found.board.nodeId);
  return said(t().fleet.cardMoved(card.title, column.title));
}

/** A list argument: an array, or the JSON text of one (some clients send a list as a string); null otherwise. */
function listArg(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** What open_board will make, checked whole before anything is: its name, its columns' titles, its first cards. */
function boardDraft(args: Record<string, unknown>): { title: string; columns: string[]; cards: CardDraft[] } | ToolResult {
  const b = t().boards;
  const title = clip(oneLine(typeof args.title === "string" ? args.title : ""), MAX_BOARD_TITLE);
  if (!title) return refused(b.nameMissing);

  let columns = [...messages(kanbanMessages).defaultColumns];
  if (args.columns !== undefined && args.columns !== null) {
    const raw = listArg(args.columns);
    if (!raw || raw.some((column) => typeof column !== "string")) return refused(b.columnsNotList);
    const named = (raw as string[]).map(oneLine).filter(Boolean);
    // Columns are found by title too (add_board_card, move_board_card): two of one name could not be told apart.
    const twice = named.find((column, i) => named.findIndex((other) => sameName(other, column)) !== i);
    if (twice) return refused(b.columnTwice(twice));
    if (named.length > 0) columns = named;
  }

  const cards: CardDraft[] = [];
  if (args.cards !== undefined && args.cards !== null) {
    const raw = listArg(args.cards);
    if (!raw) return refused(b.cardsNotList);
    for (const [i, item] of raw.entries()) {
      // A bare title is a card too.
      const card = typeof item === "string" ? { title: item } : typeof item === "object" && item !== null ? (item as Record<string, unknown>) : null;
      if (!card) return refused(b.cardsNotList);
      const cardTitle = typeof card.title === "string" ? oneLine(card.title) : "";
      if (!cardTitle) return refused(b.cardTitleMissing(i + 1));
      const priority = card.priority === undefined || card.priority === null ? "none" : card.priority;
      if (!(KANBAN_PRIORITIES as readonly unknown[]).includes(priority)) return refused(b.cardPriorityUnknown(i + 1, String(priority)));
      cards.push({ title: cardTitle, notes: typeof card.notes === "string" ? card.notes.trim() : "", priority: priority as KanbanPriority });
    }
  }
  return { title, columns, cards };
}

/**
 * Right of the caller, its top level with the caller's; then the nearest spot that covers no node nor group frame, and,
 * as it arrives without moving the view, none under the occupied lane of the canvas on screen (`avoid`, laneCovers).
 */
function besideCaller(caller: ExcalidrawElement, elements: readonly ExcalidrawElement[], avoid: readonly Rect[] = []) {
  const { width, height } = NODE_SIZE.kanban;
  const obstacles = elements.filter((e) => !e.isDeleted && (nodeKindOf(e) !== null || e.type === "frame")).map(({ x, y, width, height }) => ({ x, y, width, height }));
  return freeSpotClear({ x: caller.x + caller.width + NODE_GAP, y: caller.y, width, height }, obstacles, avoid);
}

/**
 * open_board: a new board beside the caller (an agent's terminal or a Fleet), in its workspace on screen or not, wired
 * to it in the same undo step, as "+ Link" wires one (`withBoardLink`): editable at once by the board tools. It takes
 * neither the view nor the keyboard, as a node nobody asked for (`@/agents/arrivals`). No `orchestrator`: a Fleet's
 * board of its own is not handed to its mission (`setUpBoard` takes only those).
 */
async function openBoard(nodeId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const b = t().boards;
  const draft = boardDraft(args);
  if ("content" in draft) return draft;
  const record = nodesStore.getState().nodes[nodeId];
  if (!record) return refused(b.gone);
  const workspaceId = record.workspaceId;
  // Checked before the node is made: a refusal leaves nothing behind.
  const scene = sceneAccess(workspaceId);
  if (!scene) return refused(t().links.noCanvas);
  if (!scene.elements().some((e) => e.id === nodeId && !e.isDeleted)) return refused(b.gone);

  let board: KanbanPayload = emptyBoard(draft.columns);
  for (const card of draft.cards) board = addCard(board, board.columns[0].id, card);
  const payload: KanbanPayload = { title: draft.title, ...board };
  const element = createNodeElement("kanban", { x: 0, y: 0 });
  // The node's row comes before its element: a scene save purges the rows of nodes it does not list.
  await nodesStore.getState().create(element.id, { workspaceId, kind: "kanban", payload });
  // Read after the wait: the scene may have changed meanwhile.
  const now = sceneAccess(workspaceId);
  const caller = now?.elements().find((e) => e.id === nodeId && !e.isDeleted);
  if (!now || !caller) return refused(now ? b.gone : t().links.noCanvas);
  const elements = now.elements();
  const spot = besideCaller(caller, elements, laneCovers(workspaceId));
  // A new element, not yet on the scene: placed by its coordinates alone.
  const placed = { ...element, x: spot.x, y: spot.y } as ExcalidrawElement;
  now.write(withBoardLink([...elements, placed], nodeId, element.id));
  if (!boardLinksOf(now.elements(), nodeId).includes(element.id)) return refused(b.notWiredAfterAll(draft.title, element.id));
  talk(nodeId, element.id);
  const view = {
    board: element.id,
    title: draft.title,
    editable: true,
    columns: payload.columns.map((column) => ({ id: column.id, title: column.title, cards: column.cardIds.map((id) => ({ id, title: payload.cards[id].title })) })),
  };
  return said(`${b.opened(draft.title, element.id)}\n${JSON.stringify(view, null, 2)}`);
}

/** One call of an agent's, or a Fleet's, board tools, by name; null when `name` is none of them. */
export function boardTool(nodeId: string, name: string, args: Record<string, unknown>): ToolResult | Promise<ToolResult> | null {
  switch (name) {
    case "linked_boards":
      return listBoards(nodeId, args);
    case "add_board_card":
      return addBoardCard(nodeId, args);
    case "move_board_card":
      return moveBoardCard(nodeId, args);
    case "open_board":
      return openBoard(nodeId, args);
    default:
      return null;
  }
}
