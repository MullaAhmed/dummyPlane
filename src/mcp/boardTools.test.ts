// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement, type NodeKind } from "@/canvas/nodeElement";
import { cachedElements, forgetScene, rememberScene } from "@/canvas/sceneCache";
import { NODE_GAP } from "@/agents/groupLayout";
import { boardLinksOf, withBoardLink } from "@/agents/wires";
import { moveCardWithGithub } from "@/kanban/github";
import type { Mission } from "@/mission/mission";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import type { KanbanPayload } from "@/nodes/types";
import { answer } from "./router";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "immediately", NEVER: "never" } }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(() => "") }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));
vi.mock("@/kanban/github", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/kanban/github")>();
  return { ...real, moveCardWithGithub: vi.fn(real.moveCardWithGithub) };
});

type Result = { content: { text: string }[]; isError?: boolean };
const call = (nodeId: string, name: string, args: Record<string, unknown> = {}) =>
  answer({ callId: 1, nodeId, method: "tools/call", params: { name, arguments: args } }) as Promise<Result>;
const textOf = (result: Result) => result.content[0].text;
const boardOf = (id: string) => (nodesStore.getState().nodes[id] as { payload: KanbanPayload }).payload;
const titles = (id: string, column: string) => {
  const board = boardOf(id);
  return board.columns.find((c) => c.id === column)!.cardIds.map((cardId) => board.cards[cardId].title);
};

const element = (kind: NodeKind, id: string, x: number) => ({ ...createNodeElement(kind, { x, y: 0 }), id }) as unknown as ExcalidrawElement;
const nodes = [element("terminal", "batman", 0), element("terminal", "cyborg", 1200), element("terminal", "boss", 2400), element("fleet", "chef", 3600), element("kanban", "b1", 4800), element("kanban", "b2", 7000), element("terminal", "blank", 9200)];
let scene: readonly ExcalidrawElement[] = nodes;
const wire = (agent: string, board: string) => (scene = withBoardLink(scene, agent, board));
// The canvas on screen: open_board writes its board and wire through updateScene, as the canvas would.
const sceneApi = {
  getSceneElements: () => scene.filter((e) => !e.isDeleted),
  getSceneElementsIncludingDeleted: () => scene,
  updateScene: ({ elements }: { elements: readonly ExcalidrawElement[] }) => void (scene = elements),
};

const freshBoard = (): KanbanPayload => ({
  columns: [
    { id: "todo", title: "To do", cardIds: ["c1", "c2"] },
    { id: "doing", title: "In progress", cardIds: [] },
    { id: "done", title: "Done", cardIds: [] },
  ],
  cards: {
    c1: { id: "c1", title: "Docs", notes: "Write the README", priority: "high" },
    c2: { id: "c2", title: "Login", notes: "", priority: "none" },
  },
});
const mission = (state: Mission["state"], board: string): Mission => ({ state, maxAgents: 1, members: [], manager: "boss", board });

beforeAll(async () => {
  mockIPC(() => undefined);
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({ api: sceneApi as never });
  const terminal = (id: string, extra: Record<string, unknown> = {}) =>
    nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { title: "", name: id, agent: "claude", cwd: `C:/code/${id}`, shell: "default", command: "", ...extra } });
  await terminal("batman");
  await terminal("cyborg");
  await terminal("blank", { cwd: "  " });
  await terminal("boss", { role: "manager", fleet: "chef" });
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
  await nodesStore.getState().create("b1", { workspaceId: "w1", kind: "kanban", payload: freshBoard() });
  await nodesStore.getState().create("b2", { workspaceId: "w1", kind: "kanban", payload: freshBoard() });
});
beforeEach(() => {
  scene = nodes;
  nodesStore.getState().update("b1", freshBoard());
  nodesStore.getState().update("b2", freshBoard());
  nodesStore.getState().update("chef", { mission: undefined });
  vi.mocked(moveCardWithGithub).mockClear();
});

const names = async (nodeId: string) => ((await answer({ callId: 1, nodeId, method: "tools/list", params: {} })) as { tools: { name: string }[] }).tools.map((t) => t.name);
const BOARD_TOOLS = ["linked_boards", "add_board_card", "move_board_card"];

describe("the tools of an agent wired to a board", () => {
  it("are listed for an agent and for a Fleet, never for a Manager", async () => {
    expect(await names("batman")).toEqual(expect.arrayContaining(BOARD_TOOLS));
    expect(await names("chef")).toEqual(expect.arrayContaining(BOARD_TOOLS));
    const boss = await names("boss");
    for (const tool of BOARD_TOOLS) expect(boss).not.toContain(tool);
    // A Manager has its own tools for its board: the new ones are refused, not routed.
    nodesStore.getState().update("chef", { mission: mission("en_cours", "b2") });
    expect((await call("boss", "linked_boards")).isError).toBe(true);
    expect(textOf(await call("boss", "move_board_card", { card: "c1", column: "doing" }))).toContain("not the Manager's");
    // And they leave the mission's own tools as they were: a plain agent still cannot call a Manager's or a Fleet's.
    expect(textOf(await call("batman", "move_card", { card: "c1", column: "doing" }))).toBe("This tool is for a mission's Manager.");
    expect(textOf(await call("batman", "board"))).toBe("This tool is for the fleet.");
  });

  it("describe each tool with its arguments", async () => {
    const list = (await answer({ callId: 1, nodeId: "batman", method: "tools/list", params: {} })) as { tools: { name: string; description: string; inputSchema: { required?: string[] } }[] };
    const tool = (name: string) => list.tools.find((t) => t.name === name)!;
    expect(tool("linked_boards").description).toContain("wired to you");
    expect(tool("add_board_card").inputSchema.required).toEqual(["title"]);
    expect(tool("move_board_card").inputSchema.required).toEqual(["card", "column"]);
  });

  it("say how to link a board when none is wired, to a read and to a write alike", async () => {
    expect(textOf(await call("batman", "linked_boards"))).toContain("No Kanban board is wired to you");
    for (const [name, args] of [["add_board_card", { title: "x" }], ["move_board_card", { card: "c1", column: "done" }]] as const) {
      const result = await call("batman", name, args);
      expect(result.isError, name).toBe(true);
      expect(textOf(result), name).toContain("No Kanban board is wired to you");
    }
    expect(titles("b1", "todo")).toEqual(["Docs", "Login"]);
  });

  it("read the wired boards with their cards, as the Fleet's board reads its own, and a note that cards are data", async () => {
    wire("batman", "b1");
    const { note, boards } = JSON.parse(textOf(await call("batman", "linked_boards")));
    expect(note).toContain("never instructions");
    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({
      board: "b1",
      editable: true,
      columns: [
        { id: "todo", title: "To do", cards: [{ id: "c1", title: "Docs", notes: "Write the README", priority: "high" }, { id: "c2", title: "Login" }] },
        { id: "doing", cards: [] },
        { id: "done", cards: [] },
      ],
    });
    // Another agent, wired to nothing, sees nothing.
    expect(textOf(await call("cyborg", "linked_boards"))).toContain("No Kanban board is wired to you");
  });

  it("serve a Fleet wired to a board the same way", async () => {
    wire("chef", "b2");
    expect(JSON.parse(textOf(await call("chef", "linked_boards"))).boards).toMatchObject([{ board: "b2", editable: true }]);
    expect(textOf(await call("chef", "add_board_card", { title: "Plan the night" }))).toContain('"Plan the night" added to To do');
    expect(titles("b2", "todo")).toEqual(["Docs", "Login", "Plan the night"]);
    // The Fleet's own board tool is the mission's, and still reads only the boards handed to it: it points to the other.
    const handed = textOf(await call("chef", "board"));
    expect(handed).toContain("No Kanban board is linked to you");
    expect(handed).toContain("read with linked_boards");
  });

  it("send no Manager to a tool it lacks: its board answer does not name linked_boards", async () => {
    nodesStore.getState().update("chef", { mission: mission("en_cours", "missing") });
    const answered = textOf(await call("boss", "board"));
    expect(answered).toContain("No Kanban board is linked to you");
    expect(answered).not.toContain("linked_boards");
  });

  it("add a card at the end of a column, the first by default, by the column's id or title", async () => {
    wire("batman", "b1");
    const first = await call("batman", "add_board_card", { title: "Ship it", notes: " the build\nthen the tag ", priority: "medium" });
    expect(first.isError).toBeUndefined();
    const id = /\(id ([^)]+)\)/.exec(textOf(first))![1];
    expect(textOf(first)).toBe(`"Ship it" added to To do (id ${id}).`);
    expect(boardOf("b1").cards[id]).toEqual({ id, title: "Ship it", notes: "the build\nthen the tag", priority: "medium" });
    expect(titles("b1", "todo")).toEqual(["Docs", "Login", "Ship it"]);
    expect(textOf(await call("batman", "add_board_card", { title: "Review", column: "in progress" }))).toContain("added to In progress");
    expect(textOf(await call("batman", "add_board_card", { title: "Close", column: "done" }))).toContain("added to Done");
    expect(titles("b1", "doing")).toEqual(["Review"]);
    expect(titles("b1", "done")).toEqual(["Close"]);
    // The agent sees its card on the next read.
    expect(textOf(await call("batman", "linked_boards"))).toContain("Ship it");
  });

  it("refuse a card with no title, an unknown priority or column, and a board without columns", async () => {
    wire("batman", "b1");
    expect(textOf(await call("batman", "add_board_card", { title: "  " }))).toBe("Give the card its title (title).");
    expect(textOf(await call("batman", "add_board_card", { title: "x", priority: "urgent" }))).toContain('Priority "urgent" is unknown');
    expect(textOf(await call("batman", "add_board_card", { title: "x", column: "Blocked" }))).toBe('No column "Blocked" on the board. Columns: To do, In progress, Done.');
    nodesStore.getState().update("b1", { columns: [], cards: {} });
    expect(textOf(await call("batman", "add_board_card", { title: "x" }))).toBe("This board has no column: the user adds one first.");
    expect(Object.keys(boardOf("b1").cards)).toEqual([]);
  });

  it("need the board named when several are wired, and take only a wired one", async () => {
    wire("batman", "b1");
    wire("batman", "b2");
    expect(textOf(await call("batman", "add_board_card", { title: "x" }))).toBe("Several boards are wired to you: give the board's id (board). Boards: b1, b2.");
    expect(textOf(await call("batman", "add_board_card", { title: "x", board: "b2" }))).toContain("added to To do");
    expect(titles("b2", "todo")).toEqual(["Docs", "Login", "x"]);
    expect(titles("b1", "todo")).toEqual(["Docs", "Login"]);
    scene = nodes;
    wire("batman", "b1");
    expect(textOf(await call("batman", "add_board_card", { title: "y", board: "b2" }))).toBe('"b2" is not wired to you. Wired: b1.');
    expect(JSON.parse(textOf(await call("batman", "linked_boards"))).boards.map((b: { board: string }) => b.board)).toEqual(["b1"]);
  });

  it("move a card to a column by its id, or by its title when it is alone, through the board's own move", async () => {
    wire("batman", "b1");
    expect(textOf(await call("batman", "move_board_card", { card: "c1", column: "doing" }))).toBe('"Docs" moved to In progress.');
    expect(titles("b1", "doing")).toEqual(["Docs"]);
    expect(titles("b1", "todo")).toEqual(["Login"]);
    // By title, a column by its id, case aside.
    expect(textOf(await call("batman", "move_board_card", { card: "login", column: "done" }))).toBe('"Login" moved to Done.');
    expect(titles("b1", "done")).toEqual(["Login"]);
    // A move runs where `gh` runs for the agent's own folder, so a linked issue follows.
    expect(moveCardWithGithub).toHaveBeenLastCalledWith("b1", "c2", "done", undefined, "C:/code/batman");
  });

  it("answer a move at once while `gh` is slow: its issue follows in the board's queue, never in the tool's 30 s", async () => {
    // gh that does not answer: a move waits up to 60 s per call, behind the board's earlier moves.
    let release: () => void = () => undefined;
    mockIPC((cmd) => (cmd.startsWith("github_") ? new Promise((resolve) => (release = () => resolve(null))) : undefined));
    const linked = (board: KanbanPayload): KanbanPayload => ({
      ...board,
      cards: { ...board.cards, c1: { ...board.cards.c1, github: { repo: "acme/app", number: 7, url: "https://github.com/acme/app/issues/7", state: "open" } } },
    });
    const late = <T,>(answer: Promise<T>) => Promise.race([answer, new Promise<string>((resolve) => setTimeout(() => resolve("still waiting on gh"), 300))]);
    try {
      wire("batman", "b1");
      nodesStore.getState().update("b1", linked(freshBoard()));
      const moved = await late(call("batman", "move_board_card", { card: "c1", column: "done" }));
      expect(moved).not.toBe("still waiting on gh");
      expect(titles("b1", "done")).toEqual(["Docs"]);
      // The Manager's own move_card, on the board its mission runs, the same.
      nodesStore.getState().update("b2", linked(freshBoard()));
      nodesStore.getState().update("chef", { mission: { ...mission("en_cours", "b2"), project: "C:/code" } });
      const managed = await late(call("boss", "move_card", { card: "c1", column: "done" }));
      expect(managed).not.toBe("still waiting on gh");
      expect(titles("b2", "done")).toEqual(["Docs"]);
    } finally {
      release();
      mockIPC(() => undefined);
    }
  });

  it("run `gh` nowhere in particular, not in an empty folder, when the agent has none", async () => {
    wire("blank", "b1");
    expect(textOf(await call("blank", "move_board_card", { card: "c1", column: "done" }))).toBe('"Docs" moved to Done.');
    expect(moveCardWithGithub).toHaveBeenLastCalledWith("b1", "c1", "done", undefined, undefined);
    // A Fleet has no folder of its own either.
    wire("chef", "b2");
    await call("chef", "move_board_card", { card: "c2", column: "done" });
    expect(moveCardWithGithub).toHaveBeenLastCalledWith("b2", "c2", "done", undefined, undefined);
  });

  it("find the card among several wired boards, and ask for its id when a title is shared", async () => {
    wire("batman", "b1");
    wire("batman", "b2");
    nodesStore.getState().update("b2", { cards: { ...freshBoard().cards, d1: { id: "d1", title: "Docs", notes: "", priority: "none" } }, columns: [{ id: "todo", title: "To do", cardIds: ["c1", "c2", "d1"] }, { id: "done", title: "Done", cardIds: [] }] });
    expect(textOf(await call("batman", "move_board_card", { card: "Docs", column: "done" }))).toBe('Several cards are titled "Docs": give its id instead (c1, c1, d1).');
    // c1 exists on both boards (the same id in the two fixtures): the first board's takes the move.
    expect(textOf(await call("batman", "move_board_card", { card: "d1", column: "done" }))).toBe('"Docs" moved to Done.');
    expect(titles("b2", "done")).toEqual(["Docs"]);
    expect(titles("b1", "done")).toEqual([]);
  });

  it("refuse an unknown card or column, and leave the board as it was", async () => {
    wire("batman", "b1");
    expect(textOf(await call("batman", "move_board_card", { card: "zz", column: "done" }))).toBe('No card "zz" on the boards wired to you (read the ids with linked_boards).');
    expect(textOf(await call("batman", "move_board_card", { card: "c1", column: "Blocked" }))).toBe('No column "Blocked" on the board. Columns: To do, In progress, Done.');
    expect(textOf(await call("batman", "move_board_card", { card: "", column: "done" }))).toContain("No card");
    expect(moveCardWithGithub).not.toHaveBeenCalled();
    expect(titles("b1", "todo")).toEqual(["Docs", "Login"]);
  });

  it("only touch the boards wired to the caller: another agent's board is out of reach", async () => {
    wire("batman", "b1");
    expect(textOf(await call("cyborg", "move_board_card", { card: "c1", column: "done" }))).toContain("No Kanban board is wired to you");
    expect(titles("b1", "todo")).toEqual(["Docs", "Login"]);
  });

  it("lose the board when its wire or the board is deleted", async () => {
    wire("batman", "b1");
    expect(JSON.parse(textOf(await call("batman", "linked_boards"))).boards).toHaveLength(1);
    const cut = scene.map((e) => (e.type === "arrow" ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
    scene = cut;
    expect(textOf(await call("batman", "linked_boards"))).toContain("No Kanban board is wired to you");
    scene = nodes;
    wire("batman", "b1");
    scene = scene.map((e) => (e.id === "b1" ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
    expect(textOf(await call("batman", "move_board_card", { card: "c1", column: "done" }))).toContain("No Kanban board is wired to you");
  });

  it("say when the canvas is not loaded", async () => {
    canvasStore.setState({ api: null });
    try {
      expect(textOf(await call("batman", "linked_boards"))).toBe("Your workspace's canvas is not loaded: open it in dummyPlane, then try again.");
    } finally {
      canvasStore.setState({ api: sceneApi as never });
    }
  });

  describe("on a mission's board, which its Manager runs", () => {
    beforeEach(() => {
      // The mission's own wires: its Fleet to its board, its board to its Manager, as `setUpBoard` draws them.
      wire("chef", "b2");
      wire("batman", "b2");
      nodesStore.getState().update("chef", { mission: mission("en_cours", "b2") });
    });

    it("read it, and say it is not theirs to change", async () => {
      for (const caller of ["chef", "batman"]) {
        const { boards } = JSON.parse(textOf(await call(caller, "linked_boards")));
        expect(boards, caller).toMatchObject([{ board: "b2", editable: false }]);
      }
    });

    it("refuse a Fleet, whose Manager moves its cards, and an agent wired to it alike", async () => {
      for (const caller of ["chef", "batman"]) {
        const move = await call(caller, "move_board_card", { card: "c1", column: "done" });
        expect(move.isError, caller).toBe(true);
        expect(textOf(move), caller).toBe("This board is run by a mission's Manager under way: read it, but its cards are not yours to add or move.");
        const add = await call(caller, "add_board_card", { title: "Sneak in" });
        expect(add.isError, caller).toBe(true);
        expect(textOf(add), caller).toContain("run by a mission's Manager");
      }
      expect(titles("b2", "todo")).toEqual(["Docs", "Login"]);
      expect(titles("b2", "done")).toEqual([]);
      expect(moveCardWithGithub).not.toHaveBeenCalled();
    });

    it("keep the Manager's own move_card and the Fleet's board as they were", async () => {
      expect(textOf(await call("boss", "move_card", { card: "c1", column: "done" }))).toContain('"Docs" moved to Done');
      expect(titles("b2", "done")).toEqual(["Docs"]);
      expect(textOf(await call("chef", "move_card", { card: "c1", column: "done" }))).toBe("This tool is for a mission's Manager.");
    });

    it("let a board written once its mission is finished, and one the mission does not run, be worked again", async () => {
      nodesStore.getState().update("chef", { mission: mission("terminee", "b2") });
      expect(textOf(await call("batman", "move_board_card", { card: "c1", column: "done" }))).toBe('"Docs" moved to Done.');
      wire("batman", "b1");
      nodesStore.getState().update("chef", { mission: mission("en_cours", "b2") });
      expect(textOf(await call("batman", "add_board_card", { title: "Free", board: "b1" }))).toContain("added to To do");
    });
  });
});

describe("open_board", () => {
  type Opened = { board: string; title: string; editable: boolean; columns: { id: string; title: string; cards: { id: string; title: string }[] }[] };
  /** The answer's JSON, after its first line. */
  const opened = (result: Result): Opened => {
    const text = textOf(result);
    return JSON.parse(text.slice(text.indexOf("\n") + 1)) as Opened;
  };
  const kanbans = () => Object.values(nodesStore.getState().nodes).filter((record) => record.kind === "kanban").length;
  const live = (id: string) => scene.find((e) => e.id === id && !e.isDeleted);
  const overlap = (a: ExcalidrawElement, b: ExcalidrawElement) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it("opens a board beside the agent, with its cards in the first column, wired to it and editable at once", async () => {
    const result = await call("batman", "open_board", {
      title: "  Issues\nto fix ",
      cards: [{ title: "#12 Login", notes: " OAuth ", priority: "high" }, { title: "#13 Docs" }],
    });
    expect(result.isError).toBeUndefined();
    const view = opened(result);
    expect(textOf(result).startsWith(`Board "Issues to fix" opened beside you (id ${view.board}) and wired to you`)).toBe(true);
    expect(view).toMatchObject({ title: "Issues to fix", editable: true });
    // The app's default columns, the cards in the first, in order.
    expect(view.columns.map((c) => c.title)).toEqual(["To do", "In progress", "Done"]);
    expect(view.columns[0].cards.map((c) => c.title)).toEqual(["#12 Login", "#13 Docs"]);
    // A Kanban node like the user's, named, its cards as the board's own menu makes them; no fleet's column.
    const board = boardOf(view.board);
    expect(nodesStore.getState().nodes[view.board]).toMatchObject({ workspaceId: "w1", kind: "kanban" });
    expect(board.title).toBe("Issues to fix");
    expect(board.columns.map((c) => c.id)).toEqual(view.columns.map((c) => c.id));
    const [login, docs] = view.columns[0].cards.map((c) => c.id);
    expect(board.cards[login]).toEqual({ id: login, title: "#12 Login", notes: "OAuth", priority: "high" });
    expect(board.cards[docs]).toEqual({ id: docs, title: "#13 Docs", notes: "", priority: "none" });
    expect(board.orchestrator).toBeUndefined();
    // On the canvas, clear of every other node, and wired to the agent as "+ Link" wires one.
    const placed = live(view.board)!;
    expect(placed).toBeDefined();
    for (const other of nodes) expect(overlap(placed, live(other.id)!), other.id).toBe(false);
    expect(boardLinksOf(scene, "batman")).toEqual([view.board]);
    expect(boardLinksOf(scene, "cyborg")).toEqual([]);

    // The board tools take it at once, no wire drawn by hand.
    expect(JSON.parse(textOf(await call("batman", "linked_boards"))).boards).toMatchObject([{ board: view.board, title: "Issues to fix", editable: true }]);
    expect(textOf(await call("batman", "add_board_card", { title: "#14 Tests" }))).toContain('"#14 Tests" added to To do');
    expect(textOf(await call("batman", "move_board_card", { card: "#12 Login", column: "In progress" }))).toBe('"#12 Login" moved to In progress.');
    expect(textOf(await call("batman", "move_board_card", { card: docs, column: "Done" }))).toBe('"#13 Docs" moved to Done.');
    expect(titles(view.board, view.columns[0].id)).toEqual(["#14 Tests"]);
    expect(titles(view.board, view.columns[1].id)).toEqual(["#12 Login"]);
    expect(titles(view.board, view.columns[2].id)).toEqual(["#13 Docs"]);
    // Nobody else's.
    expect(textOf(await call("cyborg", "linked_boards"))).toContain("No Kanban board is wired to you");
  });

  it("takes the columns named, in order, cards as bare titles, and lists sent as JSON text", async () => {
    const view = opened(await call("batman", "open_board", { title: "Release", columns: ["Backlog", " Doing ", "", "Shipped"], cards: ["Tag", "Notes"] }));
    expect(view.columns.map((c) => c.title)).toEqual(["Backlog", "Doing", "Shipped"]);
    expect(view.columns[0].cards.map((c) => c.title)).toEqual(["Tag", "Notes"]);
    const again = opened(await call("batman", "open_board", { title: "Later", columns: '["A", "B"]', cards: '[{"title": "x"}]' }));
    expect(again.columns.map((c) => c.title)).toEqual(["A", "B"]);
    expect(again.columns[0].cards.map((c) => c.title)).toEqual(["x"]);
    // Two boards of its own now: both wired, apart on the canvas, both its to change.
    expect(boardLinksOf(scene, "batman")).toEqual([view.board, again.board]);
    expect(overlap(live(view.board)!, live(again.board)!)).toBe(false);
    expect(textOf(await call("batman", "add_board_card", { title: "y" }))).toContain("Several boards are wired to you");
  });

  it("refuses a board it cannot make whole, and makes nothing", async () => {
    const before = kanbans();
    const refusal = async (args: Record<string, unknown>) => {
      const result = await call("batman", "open_board", args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      return textOf(result);
    };
    expect(await refusal({ title: "  " })).toBe("Give the board its name (title).");
    expect(await refusal({})).toBe("Give the board its name (title).");
    expect(await refusal({ title: "B", columns: ["To do", "to do"] })).toBe('Column "to do" is named twice: give each column a title of its own.');
    expect(await refusal({ title: "B", columns: "To do, Done" })).toBe("columns is a list of the columns' titles, in order.");
    expect(await refusal({ title: "B", columns: ["A", 3] })).toBe("columns is a list of the columns' titles, in order.");
    expect(await refusal({ title: "B", cards: { title: "x" } })).toContain("cards is a list of cards");
    expect(await refusal({ title: "B", cards: ["ok", { notes: "no title" }] })).toBe("Card 2 has no title: give each card its title.");
    expect(await refusal({ title: "B", cards: [{ title: "x", priority: "urgent" }] })).toBe('Card 1: priority "urgent" is unknown: none, low, medium or high.');
    expect(kanbans()).toBe(before);
    expect(scene).toBe(nodes);
  });

  it("serves a Fleet too: a board of its own, apart from its mission's", async () => {
    nodesStore.getState().update("chef", { mission: mission("en_cours", "b2") });
    const view = opened(await call("chef", "open_board", { title: "Follow-ups" }));
    expect(boardLinksOf(scene, "chef")).toEqual([view.board]);
    expect(boardOf(view.board).orchestrator).toBeUndefined();
    expect(JSON.parse(textOf(await call("chef", "linked_boards"))).boards).toMatchObject([{ board: view.board, editable: true }]);
    expect(textOf(await call("chef", "add_board_card", { title: "Ask about the API" }))).toContain("added to To do");
  });

  it("is not a Manager's: its board is the mission's", async () => {
    const before = kanbans();
    nodesStore.getState().update("chef", { mission: mission("en_cours", "b2") });
    const result = await call("boss", "open_board", { title: "Mine" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not the Manager's");
    expect(kanbans()).toBe(before);
  });

  it("says when the caller's canvas is not loaded, and makes nothing", async () => {
    const before = kanbans();
    canvasStore.setState({ api: null });
    try {
      const result = await call("batman", "open_board", { title: "Issues" });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Your workspace's canvas is not loaded: open it in dummyPlane, then try again.");
    } finally {
      canvasStore.setState({ api: sceneApi as never });
    }
    expect(kanbans()).toBe(before);
  });

  it("opens in the caller's workspace when it is not the one on screen, in its stored scene", async () => {
    await nodesStore.getState().create("robin", { workspaceId: "w2", kind: "terminal", payload: { title: "", name: "Robin", agent: "claude", cwd: "C:/code/robin", shell: "default", command: "" } });
    rememberScene("w2", [element("terminal", "robin", 0)], {} as never, {}, []);
    try {
      const view = opened(await call("robin", "open_board", { title: "Elsewhere" }));
      expect(nodesStore.getState().nodes[view.board]?.workspaceId).toBe("w2");
      expect(boardLinksOf(cachedElements("w2")!, "robin")).toEqual([view.board]);
      // Alone on its canvas, the board stands right beside the terminal, tops level.
      const stored = cachedElements("w2")!;
      const robin = stored.find((e) => e.id === "robin")!;
      expect(stored.find((e) => e.id === view.board)).toMatchObject({ x: robin.x + robin.width + NODE_GAP, y: robin.y });
      // The canvas on screen is left alone.
      expect(scene).toBe(nodes);
      expect(JSON.parse(textOf(await call("robin", "linked_boards"))).boards).toMatchObject([{ board: view.board, editable: true }]);
    } finally {
      forgetScene("w2");
    }
  });
});
