// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { followWaitingStore } from "@/app/followWaitingSetting";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { terminalWithKeyboard } from "@/canvas/keyboardFocus";
import { focusTerminal } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { installFollowWaiting } from "./followWaiting";

// What an arrival needs of its terminal: its keyboard, offered through the registry. No terminal here is minimized.
vi.mock("@/nodes/terminal/registry", () => ({ focusTerminal: vi.fn() }));
vi.mock("@/nodes/terminal/minimize", () => ({ expandTerminal: vi.fn(() => false) }));

const batman = { id: "batman", type: "embeddable", customData: { kind: "terminal" }, x: 100, y: 200, width: 720, height: 440 };
const updateScene = vi.fn();
let frames: FrameRequestCallback[];
let uninstall: () => void;

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  updateScene.mockClear();
  document.body.innerHTML = '<div data-terminal="batman"><div class="xterm"><textarea></textarea></div></div>';
  vi.mocked(focusTerminal).mockImplementation(() => document.querySelector("textarea")!.focus());
  followWaitingStore.setState({ enabled: true });
  canvasStore.setState({
    view: EMPTY_VIEW,
    // Zoomed out: the terminal is not shown whole at 100 %, so the arrival moves the view.
    api: {
      getSceneElements: () => [batman],
      getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 0.5 }, width: 1400, height: 900 }),
      updateScene,
    } as unknown as ExcalidrawImperativeAPI,
    frames: [],
  });
  projectsStore.setState({ view: "project" });
  workspacesStore.setState({ workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder: null }], activeId: "w1" });
  nodesStore.setState({
    nodes: { batman: { workspaceId: "w1", kind: "terminal", payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" } } },
  } as never);
  terminalStatusStore.setState({ statuses: { batman: { state: "running" } } });
  agentActivityStore.setState({ activities: {} });
  uninstall = installFollowWaiting();
});

afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("brings the view to the terminal that asks, and gives it the keyboard", () => {
  agentActivityStore.getState().apply({ nodeId: "batman", activity: "waiting", since: 1 });
  const { appState } = updateScene.mock.calls[0][0];
  expect(appState.zoom.value).toBe(1);
  expect(appState.scrollX).toBe(1400 / 2 - (100 + 720 / 2));
  expect(appState.activeEmbeddable).toEqual({ element: batman, state: "active" });
  frames.forEach((frame) => frame(0));
  expect(terminalWithKeyboard()).toBe("batman");
});
