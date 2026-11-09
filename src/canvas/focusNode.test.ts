import { expect, it, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { expandTerminal } from "@/nodes/terminal/minimize";
import { focusTerminal } from "@/nodes/terminal/registry";
import { activeTerminalStore } from "./activeTerminal";
import { canvasStore, fullSizeView } from "./canvasStore";
import { focusNode } from "./focusNode";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", () => ({ focusTerminal: vi.fn() }));
// No terminal here is minimized, but the one a test makes so.
vi.mock("@/nodes/terminal/minimize", () => ({ expandTerminal: vi.fn(() => false) }));

it("activates the element a fleet panel click centers on (spec habillage §5.5)", () => {
  const element = { id: "t1", x: 0, y: 0, width: 400, height: 300 };
  const updateScene = vi.fn();
  const api = {
    getSceneElements: () => [element],
    getAppState: () => ({ width: 1000, height: 800, zoom: { value: 1 }, scrollX: 0, scrollY: 0 }),
    updateScene,
  };
  canvasStore.setState({ api: api as unknown as ExcalidrawImperativeAPI });
  focusNode("t1");
  expect(updateScene.mock.calls[0][0].appState.activeEmbeddable).toEqual({ element, state: "active" });
});

it("unfolds the folded group of the agent first (spec replier un groupe §2)", async () => {
  const setGroupFolded = vi.fn();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.doMock("@/fleet/groups", () => ({ setGroupFolded }));
  const element = { id: "t1", x: 0, y: 0, width: 400, height: 300 };
  canvasStore.setState({
    frames: [{ id: "g", name: "G", x: 0, y: 0, width: 1, height: 1, group: { role: "general", pantheon: "greek", folded: true }, memberIds: ["t1"] }] as never,
    api: {
      getSceneElements: () => [element],
      getAppState: () => ({ width: 1000, height: 800, zoom: { value: 1 }, scrollX: 0, scrollY: 0 }),
      updateScene: vi.fn(),
    } as unknown as ExcalidrawImperativeAPI,
  });
  focusNode("t1");
  await vi.waitFor(() => expect(setGroupFolded).toHaveBeenCalledWith("g", false));
  canvasStore.setState({ frames: [] });
});

it("replaces the old selection with the terminal it opens, so Send goes to that one", () => {
  const element = { id: "t1", type: "embeddable", customData: { kind: "terminal" }, x: 0, y: 0, width: 400, height: 300 };
  const updateScene = vi.fn();
  activeTerminalStore.setState({ id: "t9" });
  canvasStore.setState({
    frames: [],
    api: {
      getSceneElements: () => [element],
      getAppState: () => ({ width: 1000, height: 800, zoom: { value: 1 }, scrollX: 0, scrollY: 0, selectedElementIds: { t9: true } }),
      updateScene,
    } as unknown as ExcalidrawImperativeAPI,
  });
  focusNode("t1");
  const appState = updateScene.mock.calls[0][0].appState;
  expect(appState.selectedElementIds).toEqual({});
  expect(appState.selectedGroupIds).toEqual({});
  expect(activeTerminalStore.getState().id).toBe("t1");
  activeTerminalStore.setState({ id: null });
});

it("does not make an orchestrator the active terminal", () => {
  const element = { id: "o1", type: "embeddable", customData: { kind: "orchestrator" }, x: 0, y: 0, width: 400, height: 300 };
  activeTerminalStore.setState({ id: "t1" });
  canvasStore.setState({
    frames: [],
    api: {
      getSceneElements: () => [element],
      getAppState: () => ({ width: 1000, height: 800, zoom: { value: 1 }, scrollX: 0, scrollY: 0 }),
      updateScene: vi.fn(),
    } as unknown as ExcalidrawImperativeAPI,
  });
  focusNode("o1");
  expect(activeTerminalStore.getState().id).toBe("t1");
  activeTerminalStore.setState({ id: null });
});

it("expands a minimized terminal first, then centers and activates its element at full size", () => {
  const full = { id: "t1", type: "embeddable", customData: { kind: "terminal" }, x: 0, y: 0, width: 400, height: 300 };
  const card = { ...full, height: 68 };
  let scene = [card];
  vi.mocked(expandTerminal).mockClear();
  vi.mocked(expandTerminal).mockImplementationOnce(() => {
    scene = [full];
    return true;
  });
  const updateScene = vi.fn();
  const view = { width: 1000, height: 800, zoom: { value: 1 }, scrollX: 0, scrollY: 0 };
  canvasStore.setState({
    frames: [],
    api: { getSceneElements: () => scene, getAppState: () => view, updateScene } as unknown as ExcalidrawImperativeAPI,
  });
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => frames.push(run));
  vi.mocked(focusTerminal).mockClear();
  focusNode("t1");
  expect(expandTerminal).toHaveBeenCalledWith("t1");
  const { appState } = updateScene.mock.calls[0][0];
  expect(appState.activeEmbeddable.element).toBe(full);
  expect(appState.scrollY).toBe(fullSizeView(full, view).scrollY);
  expect(appState.scrollY).not.toBe(fullSizeView(card, view).scrollY);
  // Its xterm shows only once React renders it expanded: the keyboard goes to it a frame later.
  expect(focusTerminal).not.toHaveBeenCalled();
  frames.forEach((run) => run(0));
  expect(focusTerminal).toHaveBeenCalledWith("t1");
  // An earlier test's arrival still runs on a timer: it needs a frame to ask for.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  activeTerminalStore.setState({ id: null });
});
