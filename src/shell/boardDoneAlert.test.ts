// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { goToNode } from "@/commands/goToRun";
import { NEW_MISSION } from "@/mission/mission";
import type { KanbanPayload } from "@/nodes/types";
import { onRecord, type Recorded } from "@/notifications/capture";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { doneCards, installBoardDoneAlerts } from "./boardDoneAlert";

const win = vi.hoisted(() => ({ isFocused: vi.fn(() => Promise.resolve(true)) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/commands/goToRun", () => ({ goToNode: vi.fn() }));
vi.mock("@excalidraw/excalidraw", () => ({}));

/** A board of To do, In progress and Done, its cards placed as `place` says. */
function board(place: Record<string, "todo" | "doing" | "done">, extra: Partial<KanbanPayload> = {}): KanbanPayload {
  const ids = (column: string) => Object.keys(place).filter((id) => place[id] === column);
  return {
    columns: [
      { id: "todo", title: "To do", cardIds: ids("todo") },
      { id: "doing", title: "In progress", cardIds: ids("doing") },
      { id: "done", title: "Done", cardIds: ids("done") },
    ],
    cards: Object.fromEntries(Object.keys(place).map((id) => [id, { id, title: id, notes: "", priority: "none" as const }])),
    ...extra,
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve));
const setBoard = (id: string, payload: KanbanPayload, workspaceId = "w1") =>
  nodesStore.setState((s) => ({ nodes: { ...s.nodes, [id]: { workspaceId, kind: "kanban", payload } } }));

let recorded: Recorded[] = [];
let stopRecording: () => void = () => undefined;
let uninstall: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  win.isFocused.mockResolvedValue(true);
  projectsStore.setState({ view: "project" });
  workspacesStore.setState({ workspaces: [{ id: "w1", projectId: "p1", name: "Main", position: 0, pantheon: null, kind: "canvas", folder: null }] });
  nodesStore.setState({ nodes: {} });
  recorded = [];
  stopRecording = onRecord((n) => recorded.push(n));
  setBoard("b1", board({ a: "todo", b: "doing" }));
  uninstall = installBoardDoneAlerts();
});

afterEach(() => {
  uninstall();
  stopRecording();
});

describe("a board is done", () => {
  it("when it has cards and every one is in its Done column", () => {
    expect(doneCards(board({ a: "done", b: "done" }))).toBe(2);
    expect(doneCards(board({ a: "done", b: "doing" }))).toBeNull();
  });

  it("never when it is empty", () => {
    expect(doneCards(board({}))).toBeNull();
  });

  it("only in a column titled like Done: the last column is no Done column by default", () => {
    const review = board({ a: "done" });
    review.columns[2] = { ...review.columns[2], title: "Review" };
    expect(doneCards(review)).toBeNull();
    const fait = board({ a: "done" });
    fait.columns[2] = { ...fait.columns[2], title: "Terminé" };
    expect(doneCards(fait)).toBe(1);
  });

  it("counts the cards it has, not an id a column keeps of a card gone", () => {
    const dangling = board({ a: "done" });
    dangling.columns[0] = { ...dangling.columns[0], cardIds: ["ghost"] };
    dangling.columns[2] = { ...dangling.columns[2], cardIds: ["a", "ghost2"] };
    expect(doneCards(dangling)).toBe(1);
  });
});

describe("the alert", () => {
  it("tells once when the last card reaches Done: a toast with Show, and the panel, the board as its plane", async () => {
    setBoard("b1", board({ a: "done", b: "doing" }));
    setBoard("b1", board({ a: "done", b: "done" }));
    await settled();
    expect(recorded.map(({ type, kind, title, context, read }) => ({ type, kind, title, context, read }))).toEqual([
      { type: "board", kind: "success", title: "Board done: all 2 cards finished", context: { nodeId: "b1", workspaceId: "w1" }, read: false },
    ]);
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Board done: all 2 cards finished", { action: { label: "Show", onClick: expect.any(Function) } });
    const action = vi.mocked(toast.success).mock.calls[0][1]!.action as unknown as { onClick: () => void };
    action.onClick();
    expect(goToNode).toHaveBeenCalledWith("w1", "b1", "the board");
    // Still done, a card's notes edited: nothing more.
    const edited = board({ a: "done", b: "done" });
    edited.cards.a = { ...edited.cards.a, notes: "shipped" };
    setBoard("b1", edited);
    await settled();
    expect(recorded).toHaveLength(1);
  });

  it("tells again when a card goes out of Done and comes back", async () => {
    setBoard("b1", board({ a: "done", b: "done" }));
    setBoard("b1", board({ a: "done", b: "doing" }));
    setBoard("b1", board({ a: "done", b: "done" }, { title: "Release" }));
    await settled();
    expect(recorded).toHaveLength(2);
    const action = vi.mocked(toast.success).mock.calls[1][1]!.action as unknown as { onClick: () => void };
    action.onClick();
    expect(goToNode).toHaveBeenCalledWith("w1", "b1", "Release");
  });

  it("says its one card in words of one", async () => {
    setBoard("b1", board({ a: "done" }));
    await settled();
    expect(recorded[0].title).toBe("Board done: its one card finished");
  });

  it("keeps it in the panel without a toast while the window is not focused, and never as a Windows notification", async () => {
    win.isFocused.mockResolvedValue(false);
    setBoard("b1", board({ a: "done", b: "done" }));
    await settled();
    expect(recorded).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("offers no Show for a board of another project, which the panel's row reaches, nor goes once the project changed", async () => {
    // An agent of a project not on screen finished the board.
    setBoard("far", board({ a: "todo" }), "w9");
    setBoard("far", board({ a: "done" }), "w9");
    await settled();
    expect(recorded.map((n) => n.context)).toEqual([{ nodeId: "far", workspaceId: "w9" }]);
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Board done: its one card finished", undefined);
    // A board of the open project, its Show clicked after another project was opened.
    setBoard("b1", board({ a: "done", b: "done" }));
    await settled();
    workspacesStore.setState({ workspaces: [] });
    const action = vi.mocked(toast.success).mock.calls[1][1]!.action as unknown as { onClick: () => void };
    action.onClick();
    expect(goToNode).not.toHaveBeenCalled();
  });

  it("offers no Show at home: no canvas to arrive on", async () => {
    projectsStore.setState({ view: "home" });
    setBoard("b1", board({ a: "done", b: "done" }));
    await settled();
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Board done: all 2 cards finished", undefined);
  });

  it("says nothing of a board already done where it is first seen: at install, or when its workspace loads", async () => {
    uninstall();
    setBoard("b1", board({ a: "done" }));
    uninstall = installBoardDoneAlerts();
    setBoard("b2", board({ a: "done", b: "done" }), "w2");
    // A change that leaves them done.
    setBoard("b1", board({ a: "done" }, { title: "Renamed" }));
    await settled();
    expect(recorded).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says nothing of an empty board, nor of one with no column titled Done", async () => {
    setBoard("b1", board({}));
    const review = board({ a: "done", b: "done" });
    review.columns[2] = { ...review.columns[2], title: "Review" };
    setBoard("b1", review);
    await settled();
    expect(recorded).toEqual([]);
  });

  it("says nothing of the board a mission runs: the mission's end tells it", async () => {
    nodesStore.setState((s) => ({ nodes: { ...s.nodes, chef: { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", mission: { ...NEW_MISSION, state: "en_cours", board: "b1" } } } } }));
    setBoard("b1", board({ a: "done", b: "done" }));
    await settled();
    expect(recorded).toEqual([]);
    // Its mission over, the board was done already: nothing more either.
    nodesStore.setState((s) => ({ nodes: { ...s.nodes, chef: { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", mission: { ...NEW_MISSION, state: "terminee", board: "b1" } } } } }));
    setBoard("b1", board({ a: "done", b: "done" }, { title: "After" }));
    await settled();
    expect(recorded).toEqual([]);
  });

  it("forgets a board that leaves the store, and takes it as new if it comes back", async () => {
    nodesStore.setState({ nodes: {} });
    setBoard("b1", board({ a: "done" }));
    await settled();
    expect(recorded).toEqual([]);
  });

  it("stops when uninstalled", async () => {
    uninstall();
    setBoard("b1", board({ a: "done", b: "done" }));
    await settled();
    expect(recorded).toEqual([]);
  });
});
