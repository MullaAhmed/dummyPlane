import { messages } from "@/i18n";
import { boardView } from "@/kanban/missionLink";
import { oneLine, sameName } from "@/mission/mission";
import type { KanbanPayload } from "@/nodes/types";
import { refused, said, type ToolResult } from "./agentTools";
import { DETAIL_CHARS, fitted, lined, shortened, shortenedKeepingLines } from "./compact";
import { agentMessages } from "./messages";

/**
 * What the board tools answer: `board` (a Fleet's, a Manager's) and `linked_boards` (an agent's, a Fleet's own). The
 * list is one line per card, its notes cut short (a GitHub issue's body fills a screen), the fields at their default
 * left out; a card asked for by `card` is answered alone and whole. Both stay under `MAX_ANSWER_CHARS` however many
 * cards there are: the last ones are left out, counted, with the call that reads them one by one.
 */

const t = () => messages(agentMessages).answers;

type Boards = { nodeId: string; board: KanbanPayload }[];
type FullCard = ReturnType<typeof boardView>["columns"][number]["cards"][number];

/** How much of a card's notes a list gives: the start of them, enough to tell the card from the next; the whole is one `card` away. */
const CARD_NOTES_CHARS = 80;

/** What a board's cards say in a list: nothing for what is at its default (no notes, no priority, no due date, no agent). */
function listedCard(card: FullCard) {
  return {
    id: card.id,
    title: card.title,
    ...(card.notes.trim() ? { notes: shortened(card.notes, CARD_NOTES_CHARS, "") } : {}),
    ...(card.priority !== "none" ? { priority: card.priority } : {}),
    ...(card.due ? { due: card.due } : {}),
    ...(card.github ? { issue: `${card.github.repo}#${card.github.number} ${card.github.state}` } : {}),
    ...(card.agent ? { agent: card.agent } : {}),
    ...(card.agent_status ? { agent_status: card.agent_status } : {}),
  };
}

const cardsOf = (boards: Boards) => boards.reduce((total, { board }) => total + board.columns.reduce((n, column) => n + column.cardIds.filter((id) => board.cards[id]).length, 0), 0);

/**
 * The boards, one line per card, `shown` cards in all: the first ones, the rest of each board counted. `extra` adds to
 * a board's own line what only its caller knows (`editable`).
 */
function listed(boards: Boards, tool: string, shown: number, extra: (nodeId: string) => Record<string, unknown>) {
  let left = shown;
  let cut = false;
  const views = boards.map(({ nodeId, board }) => {
    const view = boardView(nodeId, board);
    let hidden = 0;
    const columns = view.columns.map((column) => {
      const taken = Math.min(column.cards.length, left);
      left -= taken;
      hidden += column.cards.length - taken;
      const cards = column.cards.slice(0, taken);
      cut ||= cards.some((card) => oneLine(card.notes).length > CARD_NOTES_CHARS);
      return { ...column, cards: cards.map(listedCard) };
    });
    return { ...view, ...extra(nodeId), columns, ...(hidden > 0 ? { cards_left_out: t().left.cards(hidden, tool) } : {}) };
  });
  return { views, cut };
}

/** A card by its id, else by its title when one board card has it; or why not. */
function cardNamed(boards: Boards, raw: string): { nodeId: string; board: KanbanPayload; id: string } | string {
  const wanted = raw.trim();
  const byId = boards.find(({ board }) => board.cards[wanted]);
  if (byId) return { ...byId, id: wanted };
  const byTitle = wanted ? boards.flatMap(({ nodeId, board }) => Object.values(board.cards).filter((card) => sameName(card.title, wanted)).map((card) => ({ nodeId, board, id: card.id }))) : [];
  if (byTitle.length > 1) return t().cardTwice(wanted, byTitle.map((match) => match.id).join(", "));
  return byTitle[0] ?? t().noCard(wanted);
}

/** One card, whole: its notes (up to `DETAIL_CHARS`), its issue's link, and the column it stands in. */
function cardAnswer(boards: Boards, raw: string, note: string): ToolResult {
  const found = cardNamed(boards, raw);
  if (typeof found === "string") return refused(found);
  const view = boardView(found.nodeId, found.board);
  const column = view.columns.find((c) => c.cards.some((card) => card.id === found.id));
  const card = column?.cards.find((c) => c.id === found.id);
  if (!column || !card) return refused(t().noCard(raw.trim()));
  return said(lined({ note, board: found.nodeId, column: column.title, card: { ...card, notes: shortenedKeepingLines(card.notes, DETAIL_CHARS, t().rest) } }));
}

/**
 * The answer of a board tool for `boards`: the card named by `card` alone, else every board, its cards one per line.
 * `tool` is the one the agent called, named in the notes it cuts short; `note` is the tool's own reminder that cards are data.
 */
export function boardsAnswer(boards: Boards, { tool, note, card, extra = () => ({}) }: { tool: string; note: string; card: unknown; extra?: (nodeId: string) => Record<string, unknown> }): ToolResult {
  if (typeof card === "string" && card.trim()) return cardAnswer(boards, card, note);
  return said(
    fitted(cardsOf(boards), (shown) => {
      const { views, cut } = listed(boards, tool, shown, extra);
      return lined({ note: cut ? `${note} ${t().cardsCut(tool)}` : note, boards: views });
    }),
  );
}
