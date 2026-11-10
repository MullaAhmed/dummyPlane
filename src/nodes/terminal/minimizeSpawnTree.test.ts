// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { layoutSpawnTree } from "@/agents/spawnLayout";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { expandTerminal, MINIMIZED_HEIGHT, minimizeTerminal } from "./minimize";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", NEVER: "NEVER" } }));
vi.mock("@/canvas/sceneCache", () => ({ cachedElements: vi.fn(), editStoredScene: vi.fn() }));

const terminal = (name: string, spawnedBy?: string): TerminalPayload => ({
  title: "",
  name,
  agent: "claude",
  cwd: "C:/p",
  shell: "default",
  command: "",
  ...(spawnedBy ? { spawnedBy } : {}),
});
const node = (id: string) => ({ ...createNodeElement("terminal", { x: 0, y: 0 }), id }) as ExcalidrawElement;
const parentOf = (id: string) => (id === "anubis" || id === "bastet" ? "ra" : null);

// The canvas on screen: a scene that `updateScene` really changes.
let scene: readonly ExcalidrawElement[];
const api = {
  getSceneElements: () => scene.filter((e) => !e.isDeleted),
  getSceneElementsIncludingDeleted: () => scene,
  getAppState: () => ({}),
  updateScene: (data: { elements?: readonly ExcalidrawElement[] }) => {
    if (data.elements) scene = data.elements;
  },
} as unknown as ExcalidrawImperativeAPI;
const at = (id: string) => scene.find((e) => e.id === id)!;

beforeEach(async () => {
  mockIPC(() => undefined);
  // Ra spawned Anubis then Bastet: the flowchart puts them one under the other, right of Ra.
  scene = layoutSpawnTree([node("ra"), node("anubis"), node("bastet")], parentOf, "anubis")!;
  canvasStore.setState({ api });
  workspacesStore.setState({ activeId: "w1" } as never);
  await nodesStore.getState().create("ra", { workspaceId: "w1", kind: "terminal", payload: terminal("Ra") });
  await nodesStore.getState().create("anubis", { workspaceId: "w1", kind: "terminal", payload: terminal("Anubis", "ra") });
  await nodesStore.getState().create("bastet", { workspaceId: "w1", kind: "terminal", payload: terminal("Bastet", "ra") });
});
afterEach(() => {
  nodesStore.getState().forgetWorkspace("w1");
  canvasStore.setState({ api: null });
  workspacesStore.setState({ activeId: null } as never);
  clearMocks();
});

it("moves a minimized sub-agent's sibling up into the room it freed, and down again when it expands", async () => {
  const bastetBefore = at("bastet").y;
  expect(bastetBefore).toBeGreaterThan(at("anubis").y + at("anubis").height);
  minimizeTerminal("anubis");
  expect(at("anubis").height).toBe(MINIMIZED_HEIGHT);
  await vi.waitFor(() => expect(at("bastet").y).toBeLessThan(bastetBefore));
  // Still below the card, clear of it.
  expect(at("bastet").y).toBeGreaterThan(at("anubis").y + MINIMIZED_HEIGHT);
  expect(at("ra").x).toBe(node("ra").x);
  expandTerminal("anubis");
  await vi.waitFor(() => expect(at("bastet").y).toBe(bastetBefore));
});
