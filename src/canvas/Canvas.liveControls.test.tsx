// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { Canvas } from "./Canvas";
import { canvasStore, EMPTY_VIEW } from "./canvasStore";
import { arrive } from "./arrive";
import { activatedByPress, liveControlAt } from "./liveControls";
import { createNodeElement } from "./nodeElement";
import { MinimizedCard } from "@/nodes/terminal/MinimizedCard";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";

// The props the canvas gives Excalidraw: its onChange is what is driven here, as Excalidraw would call it.
const { excalidraw, loadScene, focusTerminal } = vi.hoisted(() => ({
  excalidraw: { props: null as null | { onChange: (...args: unknown[]) => void; excalidrawAPI: (api: unknown) => void } },
  loadScene: vi.fn(),
  focusTerminal: vi.fn(),
}));
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: (props: typeof excalidraw.props) => {
    excalidraw.props = props;
    return null;
  },
  getSceneVersion: () => 0,
  newElementWith: (element: object) => element,
  CaptureUpdateAction: { NEVER: "never", IMMEDIATELY: "immediately" },
}));
vi.mock("./sceneCache", () => ({ loadScene, rememberScene: vi.fn() }));
vi.mock("@/nodes/terminal/registry", async (original) => ({ ...(await original<object>()), focusTerminal }));
// A minimized card's Expand and its size, watched: what they do to the scene has its own tests (minimize.test.ts).
const { expandTerminal } = vi.hoisted(() => ({ expandTerminal: vi.fn(() => true) }));
vi.mock("@/nodes/terminal/minimize", async (original) => ({ ...(await original<object>()), expandTerminal, settleMinimizedSize: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  loadScene.mockReset();
  focusTerminal.mockReset();
  expandTerminal.mockClear();
  nodesStore.setState({ nodes: {} });
  clearMocks();
  canvasStore.setState({ view: EMPTY_VIEW, api: null, nodeIds: [] });
  document.body.replaceChildren();
});

/** A canvas on screen at 50 %, with one terminal, and the Excalidraw it drives. */
async function mountCanvas() {
  mockIPC(() => undefined);
  loadScene.mockResolvedValue({ initialData: { elements: [], appState: {}, files: {} }, savedFileIds: [] });
  const node = createNodeElement("terminal", { x: 360, y: 220 });
  const state: Record<string, unknown> = {
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 0.5 },
    width: 1600,
    height: 900,
    offsetLeft: 0,
    offsetTop: 0,
    activeTool: { type: "selection" },
    selectedElementIds: {},
    selectedGroupIds: {},
    activeEmbeddable: null,
    editingFrame: null,
    viewModeEnabled: false,
    zenModeEnabled: false,
  };
  const updateScene = vi.fn((data: { appState?: Record<string, unknown> }) => Object.assign(state, data.appState ?? {}));
  const elements: ExcalidrawElement[] = [];
  const api = {
    getAppState: () => state,
    getSceneElements: () => [node],
    getSceneElementsIncludingDeleted: () => elements,
    getFiles: () => ({}),
    updateScene,
    refresh: vi.fn(),
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Canvas workspaceId="w1" />));
  await act(async () => excalidraw.props!.excalidrawAPI(api));
  /** Excalidraw telling a change of its state. */
  const change = async (patch: Record<string, unknown>) => {
    Object.assign(state, patch);
    await act(async () => excalidraw.props!.onChange(elements, { ...state }, {}));
    // The canvas answers an activation a frame later.
    await act(async () => new Promise((done) => requestAnimationFrame(() => done(undefined))));
  };
  return { node, state, updateScene, change, root };
}

it("shows a terminal activated by a click in its middle at 100 %, and gives it the keyboard", async () => {
  const { node, updateScene, change, root } = await mountCanvas();
  await change({ activeEmbeddable: { element: node, state: "active" } });
  expect(focusTerminal).toHaveBeenCalledWith(node.id);
  expect(updateScene).toHaveBeenCalledWith({ appState: expect.objectContaining({ zoom: { value: 1 } }) });
  await act(async () => root.unmount());
});

it("leaves the view and the keyboard alone for a terminal a press on one of its controls activated", async () => {
  const { node, updateScene, change, root } = await mountCanvas();
  // What installLiveControls does on the press, before Excalidraw tells the change.
  const button = document.createElement("button");
  document.body.insertAdjacentHTML("beforeend", `<div class="excalidraw"><div data-node-id="${node.id}"><header data-node-chrome=""></header></div></div>`);
  document.querySelector("header")!.append(button);
  const press = new PointerEvent("pointerdown", { button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(press, "isTrusted", { value: true });
  button.dispatchEvent(press);
  expect(updateScene).toHaveBeenCalledTimes(1);
  await change({});
  expect(focusTerminal).not.toHaveBeenCalled();
  expect(updateScene).toHaveBeenCalledTimes(1);
  // The press was the canvas's to read once.
  expect(activatedByPress(node.id)).toBe(false);
  await act(async () => root.unmount());
});

it("activates an inactive minimized terminal from its card's Expand, which expands it on the same click, the view left alone", async () => {
  const { node, updateScene, change, root } = await mountCanvas();
  const payload: TerminalPayload = { title: "Fix the login form", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "", minimized: true };
  nodesStore.setState({ nodes: { [node.id]: { workspaceId: "w1", kind: "terminal", payload } } });
  // The card as NodeHost shows it inside Excalidraw: the node's id on its wrapper.
  document.body.insertAdjacentHTML("beforeend", `<div class="excalidraw"><div data-node-id="${node.id}"></div></div>`);
  const card = createRoot(document.querySelector(`[data-node-id="${node.id}"]`)!);
  await act(async () => card.render(<MinimizedCard nodeId={node.id} payload={payload} status={{ state: "running" }} />));
  const expand = document.querySelector<HTMLButtonElement>('[data-minimized] button[aria-label="Expand"]')!;
  // A control of the node's chrome, which theme/excalidraw.css lets the pointer through to.
  expect(liveControlAt(expand)?.nodeId).toBe(node.id);
  const press = new PointerEvent("pointerdown", { button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(press, "isTrusted", { value: true });
  expand.dispatchEvent(press);
  expect(updateScene).toHaveBeenCalledExactlyOnceWith({
    appState: { activeEmbeddable: { element: node, state: "active" }, selectedElementIds: {}, selectedGroupIds: {} },
  });
  await change({});
  expect(focusTerminal).not.toHaveBeenCalled();
  expect(updateScene).toHaveBeenCalledTimes(1);
  await act(async () => expand.click());
  expect(expandTerminal).toHaveBeenCalledWith(node.id);
  await act(async () => card.unmount());
  await act(async () => root.unmount());
});

it("tells which node is the active one, for the Tab order, and none once it leaves or is only hovered", async () => {
  const { node, change, root } = await mountCanvas();
  await change({ activeEmbeddable: { element: node, state: "active" } });
  expect(canvasStore.getState().activeNode).toBe(node.id);
  await change({ activeEmbeddable: { element: node, state: "hover" } });
  expect(canvasStore.getState().activeNode).toBeNull();
  await change({ activeEmbeddable: { element: node, state: "active" } });
  await act(async () => root.unmount());
  // The next canvas starts with none.
  expect(canvasStore.getState().activeNode).toBeNull();
});

it("hides Excalidraw's link bar while a node is selected alone, not while a drawn shape is", async () => {
  const { node, change, root } = await mountCanvas();
  await change({});
  // The nodes the scene holds, as its derivation tells them.
  await act(async () => canvasStore.setState({ nodeIds: [node.id] }));
  await change({ selectedElementIds: { [node.id]: true } });
  expect(document.querySelector("[data-node-alone]")).not.toBeNull();
  await change({ selectedElementIds: { [node.id]: true, shape: true } });
  expect(document.querySelector("[data-node-alone]")).toBeNull();
  await change({ selectedElementIds: { shape: true } });
  expect(document.querySelector("[data-node-alone]")).toBeNull();
  await act(async () => root.unmount());
});

it("opens nothing for a node's link, and leaves a drawn shape's link to Excalidraw", async () => {
  const { node, root } = await mountCanvas();
  const onLinkOpen = (excalidraw.props as unknown as { onLinkOpen: (element: unknown, event: CustomEvent) => void }).onLinkOpen;
  const onNode = new CustomEvent("excalidraw-link", { cancelable: true });
  onLinkOpen(node, onNode);
  expect(onNode.defaultPrevented).toBe(true);
  const onShape = new CustomEvent("excalidraw-link", { cancelable: true });
  onLinkOpen({ ...node, type: "rectangle", customData: undefined, link: "https://example.com" }, onShape);
  expect(onShape.defaultPrevented).toBe(false);
  await act(async () => root.unmount());
});

it("puts an inactive node's controls in reach of the pointer with the selection tool only", async () => {
  const { change, root } = await mountCanvas();
  await change({});
  expect(document.querySelector("[data-live-controls]")).not.toBeNull();
  await change({ activeTool: { type: "rectangle" } });
  expect(document.querySelector("[data-live-controls]")).toBeNull();
  await act(async () => root.unmount());
});

// Last in the file: the arrival keeps offering the keyboard for FOCUS_FRAMES frames, which no later test must see.
it("keeps the person's zoom for a terminal a launch's arrival activated (arriveLaunched: moveView false)", async () => {
  const { node, updateScene, change, root } = await mountCanvas();
  arrive(node.id, { moveView: false });
  // The arrival's own update: the activation, no zoom, no scroll.
  expect(updateScene).toHaveBeenCalledTimes(1);
  expect(updateScene.mock.calls[0][0].appState).not.toHaveProperty("zoom");
  await change({});
  // Canvas hears the activation and leaves the view at 50 %: no full-size view.
  expect(updateScene).toHaveBeenCalledTimes(1);
  expect(updateScene).not.toHaveBeenCalledWith({ appState: expect.objectContaining({ zoom: { value: 1 } }) });
  await act(async () => root.unmount());
});
