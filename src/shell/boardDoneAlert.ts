import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { missionRunsBoard } from "@/agents/boardLinks";
import { goToNode } from "@/commands/goToRun";
import { messages } from "@/i18n";
import { namedDoneColumn } from "@/kanban/githubSync";
import type { KanbanPayload } from "@/nodes/types";
import { recordNotification } from "@/notifications/capture";
import { nodesStore, type NodeRecord } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { shellMessages } from "./messages";

const warn = (error: unknown) => console.warn("board done alert failed", error);

/**
 * How many cards a board holds when they are all in its Done column, else null. Its Done column is the one titled
 * like "Done" (`namedDoneColumn`), never the last one by default: a board without one is never done. An empty
 * board is not done either, nor one with a card in any other column. A column's id of a card the board no longer
 * has counts for nothing.
 */
export function doneCards(board: KanbanPayload): number | null {
  const done = namedDoneColumn(board);
  if (!done) return null;
  const isCard = (id: string) => board.cards[id] !== undefined;
  if (board.columns.some((c) => c !== done && c.cardIds.some(isCard))) return null;
  const count = done.cardIds.filter(isCard).length;
  return count > 0 ? count : null;
}

/**
 * The board is done: the panel keeps it, unread, and a toast with Show tells it while the window is focused.
 * No Windows notification: a board's cards are the user's own to move, or agents' the user wired to it.
 */
function alertDone(boardId: string, record: Extract<NodeRecord, { kind: "kanban" }>, count: number) {
  const t = messages(shellMessages).boardDoneAlert;
  const title = t.title(count);
  const { workspaceId } = record;
  recordNotification({ type: "board", kind: "success", title, context: { nodeId: boardId, workspaceId } });
  // Show reaches a board of the project on screen: one of another project (an agent moved its cards) is the panel
  // row's to reach, which opens its project first. A pending arrival for a workspace not loaded would fire later.
  const canShow = () => projectsStore.getState().view === "project" && workspacesStore.getState().workspaces.some((w) => w.id === workspaceId);
  void getCurrentWindow()
    .isFocused()
    .then((focused) => {
      if (!focused) return;
      const name = record.payload.title || t.board;
      toast.success(title, canShow() ? { action: { label: t.show, onClick: () => canShow() && goToNode(workspaceId, boardId, name) } } : undefined);
    })
    .catch(warn);
}

/**
 * Tells when a Kanban board becomes done (`doneCards`): once per change from not done to done, so a card moved out
 * and back tells again. A board's state where it is first seen, at install or when its workspace loads or it is
 * made, is where it starts: a board already done says nothing. The board of a running mission says nothing either:
 * the mission's end tells it.
 */
export function installBoardDoneAlerts(): () => void {
  /** Each board's payload last looked at, and whether it was done then. */
  const seen = new Map<string, { payload: KanbanPayload; done: boolean }>();
  const look = (nodes: Readonly<Record<string, NodeRecord>>, alert: boolean) => {
    for (const [id, record] of Object.entries(nodes)) {
      if (record.kind !== "kanban") continue;
      const before = seen.get(id);
      if (before?.payload === record.payload) continue;
      const count = doneCards(record.payload);
      seen.set(id, { payload: record.payload, done: count !== null });
      if (alert && before && !before.done && count !== null && !missionRunsBoard(id)) alertDone(id, record, count);
    }
    for (const id of seen.keys()) if (nodes[id]?.kind !== "kanban") seen.delete(id);
  };
  look(nodesStore.getState().nodes, false);
  return nodesStore.subscribe((state, previous) => {
    if (state.nodes !== previous.nodes) look(state.nodes, true);
  });
}
