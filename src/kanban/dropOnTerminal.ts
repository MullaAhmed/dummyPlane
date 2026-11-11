import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import { findTerminalAt } from "@/canvas/hitTest";
import { sendToAgents } from "@/agents/broadcast";
import { sceneOf } from "@/agents/placement";
import { messages } from "@/i18n";
import { nodesStore, terminalOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { KANBAN_CARD_MIME } from "@/nodes/kanban/drag";
import { cardText } from "./board";
import { kanbanMessages } from "./messages";

// WebView2 may report a drop at clientX/clientY 0: the last dragover is where it was dropped.
let lastDragPoint: { x: number; y: number } | null = null;
let dragging: { nodeId: string; cardId: string } | null = null;
let tracking = false;

/** Outside every board: there, a card is ours to drop, not Excalidraw's (it would make a text element of it). */
const outsideBoards = (event: Event) => !(event.target instanceof Element && event.target.closest("[data-kanban]"));

/** A drag that carries one of our cards: a tab, a file from the OS or a scene element is none of ours. */
const carriesCard = (event: DragEvent) => !!dragging && !!event.dataTransfer?.types.includes(KANBAN_CARD_MIME);

function trackDragPoint() {
  if (tracking || typeof window === "undefined") return;
  tracking = true;
  window.addEventListener(
    "dragover",
    (event) => {
      if (!carriesCard(event)) return;
      lastDragPoint = { x: event.clientX, y: event.clientY };
      if (!outsideBoards(event)) return;
      event.stopPropagation();
      if (terminalAtClient(lastDragPoint)) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      }
    },
    true,
  );
  // The one place a card is sent: a drop the terminal under it accepted. A drag cancelled
  // with Escape, or let go anywhere else, ends with no drop, and sends nothing.
  window.addEventListener(
    "drop",
    (event) => {
      if (!carriesCard(event) || !outsideBoards(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const card = dragging!;
      const point = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : (lastDragPoint ?? { x: 0, y: 0 });
      endCardDrag();
      const terminalId = terminalAtClient(point);
      if (terminalId) void sendCardToTerminal(card.nodeId, card.cardId, terminalId);
    },
    true,
  );
}

/** Called when a card starts being dragged, so its drop point is known and Excalidraw does not take it. */
export function startCardDrag(nodeId?: string, cardId?: string) {
  trackDragPoint();
  lastDragPoint = null;
  dragging = nodeId && cardId ? { nodeId, cardId } : null;
}

/**
 * Called on every card's dragend, whatever became of it (dropped on a terminal, moved
 * between columns, cancelled): the gesture is over and nothing of it stays armed.
 */
export function endCardDrag() {
  dragging = null;
  lastDragPoint = null;
}

/** The terminal node under a window point, if any. */
export function terminalAtClient(client: { x: number; y: number }): string | null {
  const { api, view } = canvasStore.getState();
  if (!api) return null;
  const scene = sceneOf(client, view);
  return findTerminalAt(api.getSceneElements(), scene.x, scene.y)?.id ?? null;
}

/**
 * Types the card's text into a running terminal, then Enter (issue #29). A card
 * from GitHub may hold anybody's text: its note comes first, so that it cannot
 * open on a `/command`, and a plain shell would run it, line by line.
 */
export async function sendCardToTerminal(nodeId: string, cardId: string, terminalId: string): Promise<boolean> {
  const t = messages(kanbanMessages);
  const record = nodesStore.getState().nodes[nodeId];
  const card = record?.kind === "kanban" ? record.payload.cards[cardId] : undefined;
  if (!card) return false;
  const terminal = terminalOf(nodesStore.getState().nodes[terminalId]);
  const name = terminal?.name || terminal?.title || t.agent;
  if (!isRunning(terminalId)) {
    toast.error(t.notRunning(name));
    return false;
  }
  if (card.github && terminal?.agent === "shell") {
    toast.error(t.notInShell);
    return false;
  }
  const text = card.github ? `${t.fromIssue}\n\n${cardText(card)}` : cardText(card);
  // Enter would answer an open dialog: `sendToAgents` leaves that agent alone.
  const { sent, waiting } = await sendToAgents([terminalId], text);
  if (sent > 0) toast.success(t.sent(name));
  else if (waiting.length > 0) toast.error(t.waiting(name));
  else toast.error(t.notRunning(name));
  return sent > 0;
}
