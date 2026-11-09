// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import { cachedElements, editStoredScene } from "@/canvas/sceneCache";
import { createWire } from "@/fleet/wires";
import { ptySendText } from "@/ipc/pty";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import {
  expandTerminal,
  installMinimizing,
  isMinimized,
  MINIMIZED_HEIGHT,
  minimizeTerminal,
  onAgentReported,
  onNewWork,
  resizedScene,
  settleMinimizedSize,
  toggleMinimized,
} from "./minimize";

vi.mock("@/canvas/sceneCache", () => ({ cachedElements: vi.fn(), editStoredScene: vi.fn() }));

interface SceneUpdate {
  elements?: readonly ExcalidrawElement[];
  appState?: { activeEmbeddable?: { element: ExcalidrawElement; state: string } };
  captureUpdate?: string;
}

const terminal: TerminalPayload = { title: "", name: "Isis", agent: "claude", cwd: "C:/p", shell: "default", command: "" };

/** The terminal's element, at `height` (600: neither the card's nor a new terminal's). */
const element = (height = 600) => ({ ...createNodeElement("terminal", { x: 0, y: 0 }), id: "isis", height }) as ExcalidrawElement;

// The canvas on screen: a scene that `updateScene` really changes.
let scene: readonly ExcalidrawElement[];
let appState: Record<string, unknown>;
const updateScene = vi.fn((data: SceneUpdate) => {
  if (data.elements) scene = data.elements;
});
const api = {
  getSceneElements: () => scene.filter((e) => !e.isDeleted),
  getSceneElementsIncludingDeleted: () => scene,
  getAppState: () => appState,
  updateScene,
} as unknown as ExcalidrawImperativeAPI;

const payload = () => terminalOf(nodesStore.getState().nodes.isis);
const heightOnScreen = () => scene.find((e) => e.id === "isis")?.height;

beforeEach(async () => {
  mockIPC(() => undefined);
  scene = [element()];
  appState = {};
  updateScene.mockClear();
  vi.mocked(cachedElements).mockReset();
  vi.mocked(editStoredScene).mockReset();
  canvasStore.setState({ api });
  workspacesStore.setState({ activeId: "w1" } as never);
  await nodesStore.getState().create("isis", { workspaceId: "w1", kind: "terminal", payload: terminal });
});
afterEach(() => {
  // Also cancels the saves still waiting.
  nodesStore.getState().forgetWorkspace("w1");
  canvasStore.setState({ api: null });
  workspacesStore.setState({ activeId: null } as never);
  clearMocks();
});

describe("minimizing and expanding a terminal of the workspace on screen", () => {
  it("shrinks its element to the card outside the undo history, then gives it its height back", () => {
    expect(minimizeTerminal("isis")).toBe(true);
    expect(updateScene).toHaveBeenCalledTimes(1);
    expect(updateScene.mock.calls[0][0]).toEqual({ elements: scene, captureUpdate: "NEVER" });
    expect(heightOnScreen()).toBe(MINIMIZED_HEIGHT);
    expect(scene[0].version).toBe(2);
    expect(payload()).toMatchObject({ minimized: true, expandedHeight: 600 });
    expect(isMinimized("isis")).toBe(true);

    expect(expandTerminal("isis")).toBe(true);
    expect(updateScene).toHaveBeenCalledTimes(2);
    expect(updateScene.mock.calls[1][0]).toEqual({ elements: scene, captureUpdate: "NEVER" });
    expect(heightOnScreen()).toBe(600);
    expect(payload()?.minimized).toBeUndefined();
    expect(payload()?.expandedHeight).toBeUndefined();
    expect(isMinimized("isis")).toBe(false);
  });

  it("keeps the first height when minimized twice", () => {
    minimizeTerminal("isis");
    expect(minimizeTerminal("isis")).toBe(false);
    expect(updateScene).toHaveBeenCalledTimes(1);
    expect(payload()?.expandedHeight).toBe(600);
    expandTerminal("isis");
    expect(heightOnScreen()).toBe(600);
  });

  it("does not expand a terminal that is not minimized, nor touch a node that is no terminal", async () => {
    expect(expandTerminal("isis")).toBe(false);
    expect(payload()).toEqual(terminal);
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "orchestrator", payload: { name: "Chef" } });
    expect(minimizeTerminal("chef")).toBe(false);
    expect(minimizeTerminal("nobody")).toBe(false);
    expect(expandTerminal("nobody")).toBe(false);
    expect(isMinimized("chef")).toBe(false);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("expands to a new terminal's height when it kept none", async () => {
    scene = [element(MINIMIZED_HEIGHT)];
    await nodesStore.getState().create("isis", { workspaceId: "w1", kind: "terminal", payload: { ...terminal, minimized: true } });
    expect(expandTerminal("isis")).toBe(true);
    expect(heightOnScreen()).toBe(NODE_SIZE.terminal.height);
  });

  it("keeps no height to give back from an element already at the card's height", () => {
    scene = [element(MINIMIZED_HEIGHT)];
    expect(minimizeTerminal("isis")).toBe(true);
    expect(payload()?.minimized).toBe(true);
    expect(payload()?.expandedHeight).toBeUndefined();
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("toggles between the card and the full terminal", () => {
    expect(toggleMinimized("isis")).toBe(true);
    expect(isMinimized("isis")).toBe(true);
    expect(heightOnScreen()).toBe(MINIMIZED_HEIGHT);
    expect(toggleMinimized("isis")).toBe(true);
    expect(isMinimized("isis")).toBe(false);
    expect(heightOnScreen()).toBe(600);
  });

  it("keeps the terminal active: Excalidraw knows its active node by the element object", () => {
    const original = scene[0];
    appState = { activeEmbeddable: { element: original, state: "active" } };
    minimizeTerminal("isis");
    const update = updateScene.mock.calls[0][0];
    const resized = update.elements!.find((e) => e.id === "isis");
    expect(resized).not.toBe(original);
    expect(resized?.height).toBe(MINIMIZED_HEIGHT);
    expect(update.appState?.activeEmbeddable?.element).toBe(resized);
    expect(update.appState?.activeEmbeddable?.state).toBe("active");
    expect(update.captureUpdate).toBe("NEVER");
  });

  it("leaves another node's activation alone", () => {
    appState = { activeEmbeddable: { element: { id: "other" }, state: "active" } };
    minimizeTerminal("isis");
    expect(updateScene.mock.calls[0][0]).not.toHaveProperty("appState");
  });
});

describe("a terminal of a workspace not on screen", () => {
  beforeEach(() => workspacesStore.setState({ activeId: "w2" } as never));

  it("is resized in its stored scene, not on the canvas on screen", () => {
    vi.mocked(cachedElements).mockReturnValue([element()]);
    expect(minimizeTerminal("isis")).toBe(true);
    expect(updateScene).not.toHaveBeenCalled();
    expect(cachedElements).toHaveBeenCalledWith("w1");
    expect(editStoredScene).toHaveBeenCalledTimes(1);
    const [workspaceId, minimized] = vi.mocked(editStoredScene).mock.calls[0];
    expect(workspaceId).toBe("w1");
    expect(minimized.find((e) => e.id === "isis")?.height).toBe(MINIMIZED_HEIGHT);
    expect(payload()).toMatchObject({ minimized: true, expandedHeight: 600 });

    vi.mocked(cachedElements).mockReturnValue(minimized);
    expect(expandTerminal("isis")).toBe(true);
    expect(vi.mocked(editStoredScene).mock.calls[1][1].find((e) => e.id === "isis")?.height).toBe(600);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("is minimized when its scene was never read, and the card takes its size once shown", () => {
    expect(minimizeTerminal("isis")).toBe(true);
    expect(editStoredScene).not.toHaveBeenCalled();
    expect(updateScene).not.toHaveBeenCalled();
    expect(payload()?.minimized).toBe(true);
    expect(payload()?.expandedHeight).toBeUndefined();
    // Its workspace comes on screen, the element still at full height.
    workspacesStore.setState({ activeId: "w1" } as never);
    settleMinimizedSize("isis");
    expect(heightOnScreen()).toBe(MINIMIZED_HEIGHT);
    expect(payload()?.expandedHeight).toBe(600);
    settleMinimizedSize("isis");
    expect(updateScene).toHaveBeenCalledTimes(1);
    expandTerminal("isis");
    expect(heightOnScreen()).toBe(600);
  });
});

it("settles nothing for a terminal that is not minimized", () => {
  settleMinimizedSize("isis");
  settleMinimizedSize("nobody");
  expect(updateScene).not.toHaveBeenCalled();
  expect(heightOnScreen()).toBe(600);
});

describe("resizedScene", () => {
  const chef = createNodeElement("orchestrator", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
  const isis = { ...createNodeElement("terminal", { x: 1500, y: 0 }), id: "isis" } as unknown as ExcalidrawElement;
  const seth = createNodeElement("terminal", { x: 1500, y: 1200 }) as unknown as ExcalidrawElement;
  const wire = createWire(chef, isis);
  const toSeth = createWire(chef, seth);

  it("routes the wires bound to the node again, and leaves the rest as it was", () => {
    const elements = [chef, isis, seth, wire, toSeth];
    const next = resizedScene(elements, "isis", MINIMIZED_HEIGHT);
    expect(next[1]).toMatchObject({ id: "isis", x: isis.x, y: isis.y, width: isis.width, height: MINIMIZED_HEIGHT, version: isis.version + 1 });
    const rerouted = next[3] as ExcalidrawArrowElement;
    expect(rerouted.id).toBe(wire.id);
    expect(rerouted.version).toBe(wire.version + 1);
    expect(rerouted.points).not.toEqual(wire.points);
    // Its end comes to the middle of the card's side.
    const last = rerouted.points[rerouted.points.length - 1];
    expect(rerouted.y + last[1]).toBeCloseTo(isis.y + MINIMIZED_HEIGHT / 2, 0);
    expect(next[0]).toBe(chef);
    expect(next[2]).toBe(seth);
    expect(next[4]).toBe(toSeth);
  });

  it("returns the scene itself when the node is already at that height, gone or deleted", () => {
    const elements = [chef, isis, wire];
    expect(resizedScene(elements, "isis", isis.height)).toBe(elements);
    expect(resizedScene(elements, "nobody", MINIMIZED_HEIGHT)).toBe(elements);
    const deleted = [chef, { ...isis, isDeleted: true }, wire];
    expect(resizedScene(deleted, "isis", MINIMIZED_HEIGHT)).toBe(deleted);
  });
});

describe("onAgentReported", () => {
  it("minimizes a terminal whose agent reports its work done, and keeps the report for its card", () => {
    onAgentReported("isis", "termine", "  All good  ");
    expect(payload()).toMatchObject({ minimized: true, expandedHeight: 600, lastReport: { status: "done", summary: "All good" } });
    expect(heightOnScreen()).toBe(MINIMIZED_HEIGHT);
  });

  it.each([
    ["bloque", "blocked"],
    ["echec", "failed"],
  ])("keeps a terminal reporting %s open, its report recorded: someone has to look", (statut, status) => {
    onAgentReported("isis", statut, "Needs a key");
    expect(payload()?.lastReport).toEqual({ status, summary: "Needs a key" });
    expect(isMinimized("isis")).toBe(false);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("changes nothing for a report `report` refuses: no summary, or a status it does not know", () => {
    const before = nodesStore.getState().nodes.isis;
    onAgentReported("isis", "termine", undefined);
    onAgentReported("isis", "done", "Shipped");
    onAgentReported("isis", "constructor", "All good");
    onAgentReported("isis", "__proto__", "All good");
    onAgentReported("isis", "termine", "");
    onAgentReported("isis", "termine", "   ");
    onAgentReported("isis", "termine", 42);
    onAgentReported("isis", "nope", "All good");
    onAgentReported("isis", undefined, "All good");
    onAgentReported("isis", 3, "All good");
    expect(nodesStore.getState().nodes.isis).toBe(before);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("ignores a node that is no terminal", async () => {
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "orchestrator", payload: { name: "Chef" } });
    const before = nodesStore.getState().nodes;
    expect(() => onAgentReported("chef", "termine", "Done")).not.toThrow();
    expect(() => onAgentReported("nobody", "termine", "Done")).not.toThrow();
    expect(nodesStore.getState().nodes).toBe(before);
  });

  it("never throws, even when the canvas does: the report must still reach its orchestrator", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = {
      ...api,
      getSceneElementsIncludingDeleted: () => {
        throw new Error("canvas gone");
      },
    };
    canvasStore.setState({ api: broken as unknown as ExcalidrawImperativeAPI });
    expect(() => onAgentReported("isis", "termine", "All good")).not.toThrow();
    expect(payload()?.lastReport).toEqual({ status: "done", summary: "All good" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("onNewWork", () => {
  it("expands a minimized terminal and drops its last report", () => {
    onAgentReported("isis", "termine", "All good");
    onNewWork("isis");
    expect(isMinimized("isis")).toBe(false);
    expect(payload()?.lastReport).toBeUndefined();
    expect(payload()?.expandedHeight).toBeUndefined();
    expect(heightOnScreen()).toBe(600);
  });

  it("drops the report of a terminal left open, without resizing it", () => {
    onAgentReported("isis", "bloque", "Needs a key");
    onNewWork("isis");
    expect(payload()?.lastReport).toBeUndefined();
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("changes nothing on a terminal neither minimized nor reported", () => {
    const before = nodesStore.getState().nodes;
    onNewWork("isis");
    onNewWork("nobody");
    expect(nodesStore.getState().nodes).toBe(before);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("hears every text sent to a terminal once installed, until uninstalled", async () => {
    const sent: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "pty_send_text") sent.push(args);
    });
    const uninstall = installMinimizing();
    try {
      minimizeTerminal("isis");
      await ptySendText("isis", "x");
      expect(isMinimized("isis")).toBe(false);
      expect(heightOnScreen()).toBe(600);
      expect(sent).toEqual([{ nodeId: "isis", text: "x" }]);
    } finally {
      uninstall();
    }
    minimizeTerminal("isis");
    await ptySendText("isis", "y");
    expect(isMinimized("isis")).toBe(true);
  });
});
