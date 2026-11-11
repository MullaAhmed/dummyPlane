// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import { cachedElements, editStoredScene } from "@/canvas/sceneCache";
import { createWire } from "@/agents/wires";
import { ptySendText } from "@/ipc/pty";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import {
  expandTerminal,
  installMinimizing,
  isMinimized,
  MINIMIZED_HEIGHT,
  MINIMIZED_WIDTH,
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

const terminal: TerminalPayload = { title: "", name: "Batman", agent: "claude", cwd: "C:/p", shell: "default", command: "" };

/** The terminal's element, at `height` (600: neither the card's nor a new terminal's). */
const element = (height = 600) => ({ ...createNodeElement("terminal", { x: 0, y: 0 }), id: "batman", height }) as ExcalidrawElement;

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

const payload = () => terminalOf(nodesStore.getState().nodes.batman);
const heightOnScreen = () => scene.find((e) => e.id === "batman")?.height;
const widthOnScreen = () => scene.find((e) => e.id === "batman")?.width;
const CARD = { width: MINIMIZED_WIDTH, height: MINIMIZED_HEIGHT };

beforeEach(async () => {
  mockIPC(() => undefined);
  scene = [element()];
  appState = {};
  updateScene.mockClear();
  vi.mocked(cachedElements).mockReset();
  vi.mocked(editStoredScene).mockReset();
  canvasStore.setState({ api });
  workspacesStore.setState({ activeId: "w1" } as never);
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: terminal });
});
afterEach(() => {
  // Also cancels the saves still waiting.
  nodesStore.getState().forgetWorkspace("w1");
  canvasStore.setState({ api: null });
  workspacesStore.setState({ activeId: null } as never);
  clearMocks();
});

describe("minimizing and expanding a terminal of the workspace on screen", () => {
  it("shrinks its element to a small card from its corner, outside the undo history, then gives it its size back", () => {
    const { x, y } = scene[0];
    expect(minimizeTerminal("batman")).toBe(true);
    expect(updateScene).toHaveBeenCalledTimes(1);
    expect(updateScene.mock.calls[0][0]).toEqual({ elements: scene, captureUpdate: "NEVER" });
    expect(heightOnScreen()).toBe(MINIMIZED_HEIGHT);
    // A tab, not a strip as wide as the terminal; its top-left corner stays where it was.
    expect(widthOnScreen()).toBe(MINIMIZED_WIDTH);
    expect(scene[0]).toMatchObject({ x, y });
    expect(scene[0].version).toBe(2);
    expect(payload()).toMatchObject({ minimized: true, expandedHeight: 600, expandedWidth: NODE_SIZE.terminal.width });
    expect(isMinimized("batman")).toBe(true);

    expect(expandTerminal("batman")).toBe(true);
    expect(updateScene).toHaveBeenCalledTimes(2);
    expect(updateScene.mock.calls[1][0]).toEqual({ elements: scene, captureUpdate: "NEVER" });
    expect(heightOnScreen()).toBe(600);
    expect(widthOnScreen()).toBe(NODE_SIZE.terminal.width);
    expect(payload()?.minimized).toBeUndefined();
    expect(payload()?.expandedHeight).toBeUndefined();
    expect(payload()?.expandedWidth).toBeUndefined();
    expect(isMinimized("batman")).toBe(false);
  });

  it("gives a widened terminal its own width back", () => {
    scene = [{ ...element(), width: 1000 } as ExcalidrawElement];
    minimizeTerminal("batman");
    expect(widthOnScreen()).toBe(MINIMIZED_WIDTH);
    expect(payload()?.expandedWidth).toBe(1000);
    expandTerminal("batman");
    expect(widthOnScreen()).toBe(1000);
  });

  it("keeps the first height when minimized twice", () => {
    minimizeTerminal("batman");
    expect(minimizeTerminal("batman")).toBe(false);
    expect(updateScene).toHaveBeenCalledTimes(1);
    expect(payload()?.expandedHeight).toBe(600);
    expandTerminal("batman");
    expect(heightOnScreen()).toBe(600);
  });

  it("does not expand a terminal that is not minimized, nor touch a node that is no terminal", async () => {
    expect(expandTerminal("batman")).toBe(false);
    expect(payload()).toEqual(terminal);
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
    expect(minimizeTerminal("chef")).toBe(false);
    expect(minimizeTerminal("nobody")).toBe(false);
    expect(expandTerminal("nobody")).toBe(false);
    expect(isMinimized("chef")).toBe(false);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("expands to a new terminal's size when it kept none", async () => {
    scene = [{ ...element(MINIMIZED_HEIGHT), width: MINIMIZED_WIDTH } as ExcalidrawElement];
    await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { ...terminal, minimized: true } });
    expect(expandTerminal("batman")).toBe(true);
    expect(heightOnScreen()).toBe(NODE_SIZE.terminal.height);
    expect(widthOnScreen()).toBe(NODE_SIZE.terminal.width);
  });

  it("keeps no size to give back from an element already at the card's size", () => {
    scene = [{ ...element(MINIMIZED_HEIGHT), width: MINIMIZED_WIDTH } as ExcalidrawElement];
    expect(minimizeTerminal("batman")).toBe(true);
    expect(payload()?.minimized).toBe(true);
    expect(payload()?.expandedHeight).toBeUndefined();
    expect(payload()?.expandedWidth).toBeUndefined();
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("narrows a card left from before cards were narrow (a strip as wide as the terminal) once it is shown", async () => {
    scene = [element(MINIMIZED_HEIGHT)];
    await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { ...terminal, minimized: true, expandedHeight: 520 } });
    settleMinimizedSize("batman");
    expect(widthOnScreen()).toBe(MINIMIZED_WIDTH);
    expect(payload()).toMatchObject({ expandedHeight: 520, expandedWidth: NODE_SIZE.terminal.width });
    expandTerminal("batman");
    expect([widthOnScreen(), heightOnScreen()]).toEqual([NODE_SIZE.terminal.width, 520]);
  });

  it("toggles between the card and the full terminal", () => {
    expect(toggleMinimized("batman")).toBe(true);
    expect(isMinimized("batman")).toBe(true);
    expect(heightOnScreen()).toBe(MINIMIZED_HEIGHT);
    expect(toggleMinimized("batman")).toBe(true);
    expect(isMinimized("batman")).toBe(false);
    expect(heightOnScreen()).toBe(600);
  });

  it("keeps the terminal active: Excalidraw knows its active node by the element object", () => {
    const original = scene[0];
    appState = { activeEmbeddable: { element: original, state: "active" } };
    minimizeTerminal("batman");
    const update = updateScene.mock.calls[0][0];
    const resized = update.elements!.find((e) => e.id === "batman");
    expect(resized).not.toBe(original);
    expect(resized?.height).toBe(MINIMIZED_HEIGHT);
    expect(update.appState?.activeEmbeddable?.element).toBe(resized);
    expect(update.appState?.activeEmbeddable?.state).toBe("active");
    expect(update.captureUpdate).toBe("NEVER");
  });

  it("leaves another node's activation alone", () => {
    appState = { activeEmbeddable: { element: { id: "other" }, state: "active" } };
    minimizeTerminal("batman");
    expect(updateScene.mock.calls[0][0]).not.toHaveProperty("appState");
  });
});

describe("a terminal of a workspace not on screen", () => {
  beforeEach(() => workspacesStore.setState({ activeId: "w2" } as never));

  it("is resized in its stored scene, not on the canvas on screen", () => {
    vi.mocked(cachedElements).mockReturnValue([element()]);
    expect(minimizeTerminal("batman")).toBe(true);
    expect(updateScene).not.toHaveBeenCalled();
    expect(cachedElements).toHaveBeenCalledWith("w1");
    expect(editStoredScene).toHaveBeenCalledTimes(1);
    const [workspaceId, minimized] = vi.mocked(editStoredScene).mock.calls[0];
    expect(workspaceId).toBe("w1");
    expect(minimized.find((e) => e.id === "batman")?.height).toBe(MINIMIZED_HEIGHT);
    expect(payload()).toMatchObject({ minimized: true, expandedHeight: 600 });

    vi.mocked(cachedElements).mockReturnValue(minimized);
    expect(expandTerminal("batman")).toBe(true);
    expect(vi.mocked(editStoredScene).mock.calls[1][1].find((e) => e.id === "batman")?.height).toBe(600);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("is minimized when its scene was never read, and the card takes its size once shown", () => {
    expect(minimizeTerminal("batman")).toBe(true);
    expect(editStoredScene).not.toHaveBeenCalled();
    expect(updateScene).not.toHaveBeenCalled();
    expect(payload()?.minimized).toBe(true);
    expect(payload()?.expandedHeight).toBeUndefined();
    // Its workspace comes on screen, the element still at full height.
    workspacesStore.setState({ activeId: "w1" } as never);
    settleMinimizedSize("batman");
    expect(heightOnScreen()).toBe(MINIMIZED_HEIGHT);
    expect(payload()?.expandedHeight).toBe(600);
    settleMinimizedSize("batman");
    expect(updateScene).toHaveBeenCalledTimes(1);
    expandTerminal("batman");
    expect(heightOnScreen()).toBe(600);
  });
});

it("settles nothing for a terminal that is not minimized", () => {
  settleMinimizedSize("batman");
  settleMinimizedSize("nobody");
  expect(updateScene).not.toHaveBeenCalled();
  expect(heightOnScreen()).toBe(600);
});

describe("resizedScene", () => {
  const chef = createNodeElement("fleet", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
  const batman = { ...createNodeElement("terminal", { x: 1500, y: 0 }), id: "batman" } as unknown as ExcalidrawElement;
  const shazam = createNodeElement("terminal", { x: 1500, y: 1200 }) as unknown as ExcalidrawElement;
  const wire = createWire(chef, batman);
  const toShazam = createWire(chef, shazam);

  it("routes the wires bound to the node again, and leaves the rest as it was", () => {
    const elements = [chef, batman, shazam, wire, toShazam];
    const next = resizedScene(elements, "batman", CARD);
    expect(next[1]).toMatchObject({ id: "batman", x: batman.x, y: batman.y, width: MINIMIZED_WIDTH, height: MINIMIZED_HEIGHT, version: batman.version + 1 });
    const rerouted = next[3] as ExcalidrawArrowElement;
    expect(rerouted.id).toBe(wire.id);
    expect(rerouted.version).toBe(wire.version + 1);
    expect(rerouted.points).not.toEqual(wire.points);
    // Its end comes to the middle of the card's side.
    const last = rerouted.points[rerouted.points.length - 1];
    expect(rerouted.y + last[1]).toBeCloseTo(batman.y + MINIMIZED_HEIGHT / 2, 0);
    expect(next[0]).toBe(chef);
    expect(next[2]).toBe(shazam);
    expect(next[4]).toBe(toShazam);
  });

  it("returns the scene itself when the node is already at that size, gone or deleted", () => {
    const elements = [chef, batman, wire];
    expect(resizedScene(elements, "batman", { width: batman.width, height: batman.height })).toBe(elements);
    expect(resizedScene(elements, "nobody", CARD)).toBe(elements);
    const deleted = [chef, { ...batman, isDeleted: true }, wire];
    expect(resizedScene(deleted, "batman", CARD)).toBe(deleted);
  });
});

describe("onAgentReported", () => {
  it("minimizes a terminal whose agent reports its work done, and keeps the report for its card", () => {
    onAgentReported("batman", "termine", "  All good  ");
    expect(payload()).toMatchObject({ minimized: true, expandedHeight: 600, lastReport: { status: "done", summary: "All good" } });
    expect(heightOnScreen()).toBe(MINIMIZED_HEIGHT);
  });

  it.each([
    ["bloque", "blocked"],
    ["echec", "failed"],
  ])("keeps a terminal reporting %s open, its report recorded: someone has to look", (statut, status) => {
    onAgentReported("batman", statut, "Needs a key");
    expect(payload()?.lastReport).toEqual({ status, summary: "Needs a key" });
    expect(isMinimized("batman")).toBe(false);
    expect(updateScene).not.toHaveBeenCalled();
  });

  describe("the steps of the agent that reports", () => {
    const steps = [
      { title: "Plan", state: "fait" as const },
      { title: "Commit and report", state: "en_cours" as const },
      { title: "Ship", state: "a_venir" as const },
    ];
    const states = () => payload()?.steps?.map((s) => s.state);

    it("finishes them all when the agent reports done without having marked its last one", () => {
      nodesStore.getState().update("batman", { steps });
      onAgentReported("batman", "termine", "All good");
      expect(states()).toEqual(["fait", "fait", "fait"]);
    });

    it.each(["bloque", "echec"])("fails the step under way when it reports %s, the steps to come staying to come", (statut) => {
      nodesStore.getState().update("batman", { steps });
      onAgentReported("batman", statut, "Needs a key");
      expect(states()).toEqual(["fait", "echec", "a_venir"]);
    });

    it("leaves a terminal without steps without any, and the steps of a refused report as they were", () => {
      onAgentReported("batman", "termine", "All good");
      expect(payload()).not.toHaveProperty("steps");
      nodesStore.getState().update("batman", { steps });
      onAgentReported("batman", "termine", "  ");
      onAgentReported("batman", "done", "All good");
      expect(states()).toEqual(["fait", "en_cours", "a_venir"]);
    });

    it("keeps them settled when the agent gets new work: it declares new ones when it starts", () => {
      nodesStore.getState().update("batman", { steps });
      onAgentReported("batman", "termine", "All good");
      onNewWork("batman");
      expect(payload()?.lastReport).toBeUndefined();
      expect(states()).toEqual(["fait", "fait", "fait"]);
    });
  });

  it("changes nothing for a report `report` refuses: no summary, or a status it does not know", () => {
    const before = nodesStore.getState().nodes.batman;
    onAgentReported("batman", "termine", undefined);
    onAgentReported("batman", "done", "Shipped");
    onAgentReported("batman", "constructor", "All good");
    onAgentReported("batman", "__proto__", "All good");
    onAgentReported("batman", "termine", "");
    onAgentReported("batman", "termine", "   ");
    onAgentReported("batman", "termine", 42);
    onAgentReported("batman", "nope", "All good");
    onAgentReported("batman", undefined, "All good");
    onAgentReported("batman", 3, "All good");
    expect(nodesStore.getState().nodes.batman).toBe(before);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("ignores a node that is no terminal", async () => {
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
    const before = nodesStore.getState().nodes;
    expect(() => onAgentReported("chef", "termine", "Done")).not.toThrow();
    expect(() => onAgentReported("nobody", "termine", "Done")).not.toThrow();
    expect(nodesStore.getState().nodes).toBe(before);
  });

  it("never throws, even when the canvas does: the report must still reach its fleet", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = {
      ...api,
      getSceneElementsIncludingDeleted: () => {
        throw new Error("canvas gone");
      },
    };
    canvasStore.setState({ api: broken as unknown as ExcalidrawImperativeAPI });
    expect(() => onAgentReported("batman", "termine", "All good")).not.toThrow();
    expect(payload()?.lastReport).toEqual({ status: "done", summary: "All good" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("onNewWork", () => {
  it("expands a minimized terminal and drops its last report", () => {
    onAgentReported("batman", "termine", "All good");
    onNewWork("batman");
    expect(isMinimized("batman")).toBe(false);
    expect(payload()?.lastReport).toBeUndefined();
    expect(payload()?.expandedHeight).toBeUndefined();
    expect(heightOnScreen()).toBe(600);
  });

  it("drops the report of a terminal left open, without resizing it", () => {
    onAgentReported("batman", "bloque", "Needs a key");
    onNewWork("batman");
    expect(payload()?.lastReport).toBeUndefined();
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("changes nothing on a terminal neither minimized nor reported", () => {
    const before = nodesStore.getState().nodes;
    onNewWork("batman");
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
      minimizeTerminal("batman");
      await ptySendText("batman", "x");
      expect(isMinimized("batman")).toBe(false);
      expect(heightOnScreen()).toBe(600);
      expect(sent).toEqual([{ nodeId: "batman", text: "x" }]);
    } finally {
      uninstall();
    }
    minimizeTerminal("batman");
    await ptySendText("batman", "y");
    expect(isMinimized("batman")).toBe(true);
  });
});
