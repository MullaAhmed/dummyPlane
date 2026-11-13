// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { Canvas } from "./Canvas";
import { canvasStore, EMPTY_VIEW } from "./canvasStore";

// A canvas that mounts: Excalidraw itself is not needed for what leaving it must leave behind.
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: () => null,
  getSceneVersion: () => 0,
  newElementWith: (element: object) => element,
  CaptureUpdateAction: { NEVER: "never", IMMEDIATELY: "immediately" },
}));
const { loadScene } = vi.hoisted(() => ({ loadScene: vi.fn() }));
vi.mock("./sceneCache", () => ({ loadScene, rememberScene: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  loadScene.mockReset();
  clearMocks();
  canvasStore.setState({ view: EMPTY_VIEW });
  document.body.replaceChildren();
});

it("leaves no selection, tool, mode or frame being renamed of its own for the next canvas, and keeps the view's place and size", async () => {
  mockIPC(() => undefined);
  loadScene.mockResolvedValue({ initialData: { elements: [], appState: {}, files: {} }, savedFileIds: [] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Canvas workspaceId="w1" />));
  // What the canvas on screen last told: a terminal selected, the rectangle tool, reading mode, a frame being renamed.
  canvasStore.setState({
    view: { scrollX: 120, scrollY: -40, zoom: 0.5, width: 1280, height: 720, offsetLeft: 4, offsetTop: 6, tool: "rectangle", selectedIds: ["batman"], editingFrame: "group", mode: "reading" },
  });
  await act(async () => root.unmount());
  const { view } = canvasStore.getState();
  expect(view).toMatchObject({ selectedIds: [], tool: "selection", mode: null, editingFrame: null });
  // Where it was and how large: read by the placement of what is made next, with no guard against a zero size.
  expect(view).toMatchObject({ scrollX: 120, scrollY: -40, zoom: 0.5, width: 1280, height: 720, offsetLeft: 4, offsetTop: 6 });
});
