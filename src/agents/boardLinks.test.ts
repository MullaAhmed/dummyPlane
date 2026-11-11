// @vitest-environment happy-dom
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement, type NodeKind } from "@/canvas/nodeElement";
import type { Mission } from "@/mission/mission";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { boardLinkable, linkAgentToBoard, missionRunsBoard, wiredBoardsOf } from "./boardLinks";
import { boardLinksOf, isWire } from "./wires";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "immediately" } }));

const element = (kind: NodeKind, id: string, x: number) => ({ ...createNodeElement(kind, { x, y: 0 }), id }) as unknown as ExcalidrawElement;
let scene: readonly ExcalidrawElement[] = [];
const updateScene = vi.fn(({ elements }: { elements: readonly ExcalidrawElement[] }) => void (scene = elements));
const wires = () => scene.filter((e) => !e.isDeleted && isWire(e));

const terminal = (id: string, agent: "claude" | "codex" | "shell", extra: Record<string, unknown> = {}) =>
  nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { title: "", name: id, agent, cwd: "C:/code", shell: "default", command: "", ...extra } });
const board = (id: string) =>
  nodesStore.getState().create(id, { workspaceId: "w1", kind: "kanban", payload: { columns: [{ id: "todo", title: "To do", cardIds: ["c1"] }], cards: { c1: { id: "c1", title: "Docs", notes: "", priority: "none" } } } });
const mission = (state: Mission["state"], boardId: string): Mission => ({ state, maxAgents: 1, members: [], board: boardId });

beforeAll(async () => {
  mockIPC(() => undefined);
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({ api: { getSceneElementsIncludingDeleted: () => scene, updateScene } as never });
  await terminal("batman", "claude");
  await terminal("cyborg", "codex");
  await terminal("sh", "shell");
  await terminal("boss", "claude", { role: "manager", fleet: "chef" });
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
  await board("b1");
  await board("b2");
});
beforeEach(() => {
  scene = [element("terminal", "batman", 0), element("terminal", "cyborg", 1200), element("terminal", "sh", 2400), element("terminal", "boss", 3600), element("fleet", "chef", 4800), element("kanban", "b1", 6000), element("kanban", "b2", 8000)];
  updateScene.mockClear();
});

it("wires an agent, or a Fleet, to a board in one undo step, then reads the link from the agent's end", () => {
  linkAgentToBoard("batman", "b1");
  expect(updateScene).toHaveBeenCalledTimes(1);
  expect(updateScene.mock.calls[0][0]).toMatchObject({ captureUpdate: "immediately" });
  expect(wires()).toHaveLength(1);
  expect(wiredBoardsOf("batman")?.map((b) => b.nodeId)).toEqual(["b1"]);
  expect(wiredBoardsOf("batman")?.[0].board.cards.c1.title).toBe("Docs");
  expect(wiredBoardsOf("cyborg")).toEqual([]);
  linkAgentToBoard("chef", "b2");
  expect(wiredBoardsOf("chef")?.map((b) => b.nodeId)).toEqual(["b2"]);
});

it("writes nothing for a pair already linked", () => {
  linkAgentToBoard("batman", "b1");
  linkAgentToBoard("batman", "b1");
  expect(updateScene).toHaveBeenCalledTimes(1);
  expect(wires()).toHaveLength(1);
});

it("never links a plain shell, a mission's Manager, or two nodes that are no agent and board", () => {
  linkAgentToBoard("sh", "b1");
  linkAgentToBoard("boss", "b1");
  linkAgentToBoard("batman", "cyborg");
  linkAgentToBoard("b1", "b2");
  linkAgentToBoard("batman", "missing");
  expect(updateScene).not.toHaveBeenCalled();
  expect(boardLinkable("sh")).toBe(false);
  expect(boardLinkable("boss")).toBe(false);
  expect(boardLinkable("b1")).toBe(false);
  expect(boardLinkable("batman")).toBe(true);
  expect(boardLinkable("chef")).toBe(true);
});

it("links two ways round: from the board's menu, the agent clicked is wired to it", () => {
  // `LinkMode` from a board calls it with the agent first, whichever end it started at.
  linkAgentToBoard("cyborg", "b2");
  expect(boardLinksOf(scene, "cyborg")).toEqual(["b2"]);
});

it("loses the link with the wire or the board", () => {
  linkAgentToBoard("batman", "b1");
  scene = scene.map((e) => (isWire(e) ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
  expect(wiredBoardsOf("batman")).toEqual([]);
  linkAgentToBoard("batman", "b1");
  expect(wiredBoardsOf("batman")?.map((b) => b.nodeId)).toEqual(["b1"]);
  scene = scene.map((e) => (e.id === "b1" ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
  expect(wiredBoardsOf("batman")).toEqual([]);
});

it("does not know the boards of a canvas it never read", () => {
  canvasStore.setState({ api: null });
  try {
    expect(wiredBoardsOf("batman")).toBeNull();
  } finally {
    canvasStore.setState({ api: { getSceneElementsIncludingDeleted: () => scene, updateScene } as never });
  }
});

it("says a board is a mission's while its mission is under way, and only then", () => {
  expect(missionRunsBoard("b1")).toBe(false);
  for (const state of ["lancement", "en_cours"] as const) {
    nodesStore.getState().update("chef", { mission: mission(state, "b1") });
    expect(missionRunsBoard("b1"), state).toBe(true);
    expect(missionRunsBoard("b2"), state).toBe(false);
  }
  for (const state of ["redaction", "plan", "terminee"] as const) {
    nodesStore.getState().update("chef", { mission: mission(state, "b1") });
    expect(missionRunsBoard("b1"), state).toBe(false);
  }
  nodesStore.getState().update("chef", { mission: undefined });
});
