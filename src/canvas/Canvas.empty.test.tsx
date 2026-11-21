// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Canvas } from "./Canvas";
import { canvasStore, EMPTY_VIEW } from "./canvasStore";

// Excalidraw is a stand-in that keeps the props the canvas hands it: the test plays its onChange.
const { excalidraw } = vi.hoisted(() => ({ excalidraw: { props: null as null | { onChange: (...args: unknown[]) => void } } }));
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: (props: { onChange: (...args: unknown[]) => void }) => {
    excalidraw.props = props;
    return null;
  },
  getSceneVersion: (elements: readonly unknown[]) => elements.length,
  newElementWith: (element: object) => element,
  CaptureUpdateAction: { NEVER: "never", IMMEDIATELY: "immediately" },
}));
const { loadScene } = vi.hoisted(() => ({ loadScene: vi.fn() }));
vi.mock("./sceneCache", () => ({ loadScene, rememberScene: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const terminal = (id: string, isDeleted = false) => ({
  id,
  type: "embeddable",
  customData: { kind: "terminal" },
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  isDeleted,
  frameId: null,
  groupIds: [],
  version: 1,
});
const appState = {
  scrollX: 0,
  scrollY: 0,
  zoom: { value: 1 },
  width: 1000,
  height: 700,
  offsetLeft: 0,
  offsetTop: 0,
  activeTool: { type: "selection" },
  selectedElementIds: {},
  editingFrame: null,
  viewModeEnabled: false,
  zenModeEnabled: false,
  activeEmbeddable: null,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mockIPC(() => undefined);
  excalidraw.props = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  loadScene.mockReset();
  clearMocks();
  canvasStore.setState({ view: EMPTY_VIEW });
  document.body.replaceChildren();
});

const open = async (elements: unknown[]) => {
  loadScene.mockResolvedValue({ initialData: { elements, appState: {}, files: {} }, savedFileIds: [] });
  await act(async () => root.render(<Canvas workspaceId="w1" />));
};
const change = (elements: unknown[]) => act(async () => excalidraw.props!.onChange(elements, appState, {}));
const invitation = () => host.querySelector<HTMLElement>("[data-empty-canvas]");

it("invites the first launch on an empty canvas, and goes once a terminal is launched", async () => {
  await open([]);
  expect(invitation()?.textContent).toContain("Right-click to launch an agent");
  // Excalidraw's first change, still nothing on the scene: it stays.
  await change([]);
  expect(invitation()).not.toBeNull();
  // The launch: a terminal on the scene.
  await change([terminal("batman")]);
  expect(invitation()).toBeNull();
});

it("never shows on a workspace that holds terminals, not even before Excalidraw's first change", async () => {
  await open([terminal("batman")]);
  expect(invitation()).toBeNull();
  await change([terminal("batman")]);
  expect(invitation()).toBeNull();
});

it("comes back when the last terminal is closed: a deleted element is not on the canvas", async () => {
  await open([terminal("batman")]);
  await change([terminal("batman", true)]);
  expect(invitation()).not.toBeNull();
});

it("stays out of the pointer's way, so a right-click through it still opens the ring", async () => {
  await open([]);
  expect(invitation()!.className).toContain("pointer-events-none");
});
