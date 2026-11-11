// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { LinkMode } from "@/agents/LinkMode";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { createNodeElement } from "@/canvas/nodeElement";
import { kanbanWidth } from "@/kanban/width";
import { nodesStore } from "@/store/nodes";
import { uiStore } from "@/store/ui";
import { KanbanNode } from "./KanbanNode";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { NEVER: "never" }, newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));
const link = vi.hoisted(() => vi.fn());
vi.mock("@/agents/boardLinks", async (importOriginal) => ({ ...(await importOriginal<object>()), linkAgentToBoard: link }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The link mode started from a board's menu, with the board's own node beside it: where the keyboard goes (WCAG 2.1.1). */
let host: HTMLDivElement;
let root: Root;

const press = async (target: Element, key: string) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => void target.dispatchEvent(event));
};
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]');
const menuButton = () => host.querySelector<HTMLElement>('button[aria-label="Board menu"]')!;

beforeEach(async () => {
  mockIPC(() => undefined);
  link.mockClear();
  await nodesStore.getState().create("tasks", { workspaceId: "w1", kind: "kanban", payload: { columns: [{ id: "todo", title: "To do", cardIds: [] }], cards: {} } });
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" } });
  const board = { ...createNodeElement("kanban", { x: 400, y: 400 }), id: "tasks", width: kanbanWidth(1) } as unknown as ExcalidrawElement;
  const batman = { ...createNodeElement("terminal", { x: 3000, y: 400 }), id: "batman" } as unknown as ExcalidrawElement;
  const scene = [board, batman];
  canvasStore.setState({ api: { getSceneElements: () => scene, getSceneElementsIncludingDeleted: () => scene } as never, view: EMPTY_VIEW, frames: [], links: {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<><KanbanNode nodeId="tasks" /><LinkMode /></>));
});
afterEach(async () => {
  await act(async () => root.unmount());
  uiStore.setState({ linking: null });
  canvasStore.setState({ api: null });
  document.body.replaceChildren();
});

const startFromMenu = async () => {
  await press(menuButton(), "Enter");
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent === "Link an agent…")!;
  await act(async () => item.click());
  // The menu hands the keyboard back to its button as it closes: the list must still have it after.
  await settle();
};

it("hands the keyboard to the mode's list, not back to the menu's button, when the mode starts from the menu", async () => {
  await startFromMenu();
  expect(uiStore.getState().linking).toBe("tasks");
  expect(listbox()).not.toBeNull();
  expect(document.activeElement).toBe(listbox());
});

it("gives the keyboard back to the board's menu button when the mode ends from the list, by Escape or a pick", async () => {
  await startFromMenu();
  await press(listbox()!, "Escape");
  expect(uiStore.getState().linking).toBeNull();
  expect(document.activeElement).toBe(menuButton());

  await startFromMenu();
  await press(listbox()!, "ArrowDown");
  await press(listbox()!, "Enter");
  expect(link).toHaveBeenCalledWith("batman", "tasks");
  expect(uiStore.getState().linking).toBeNull();
  expect(document.activeElement).toBe(menuButton());
});
