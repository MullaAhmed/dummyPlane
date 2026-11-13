// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { createRemovalGuard } from "@/canvas/removalGuard";
import { relaunchSession } from "@/nodes/terminal/session";
import { nodesStore, type NodeRecord } from "@/store/nodes";
import { isAlive, isRunning, terminalStatusStore } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { closeGroup, requestCloseGroup } from "./groups";
import { removeNodes, requestClose } from "./terminals";

// Excalidraw does not load under Vitest (roughjs): its two helpers, as they behave.
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", NEVER: "NEVER" },
  newElementWith: (e: ExcalidrawElement, updates: object) => ({ ...e, ...updates, version: e.version + 1 }),
}));
vi.mock("@/nodes/terminal/registry", () => ({ markForAutostart: vi.fn() }));

const element = (id: string, fields: Record<string, unknown> = {}) =>
  ({ id, type: "embeddable", x: 0, y: 0, width: 300, height: 200, isDeleted: false, frameId: null, version: 1, customData: { kind: "terminal" }, ...fields }) as unknown as ExcalidrawElement;

let scene: ExcalidrawElement[];

beforeEach(() => {
  scene = [element("batman"), element("cyborg"), element("flash")];
  canvasStore.setState({
    api: {
      getSceneElementsIncludingDeleted: () => scene,
      getSceneElements: () => scene.filter((e) => !e.isDeleted),
      updateScene: ({ elements }: { elements?: ExcalidrawElement[] }) => {
        if (elements) scene = elements;
      },
    } as unknown as ExcalidrawImperativeAPI,
  });
  for (const id of ["batman", "cyborg", "robin"]) terminalStatusStore.getState().set(id, { state: "running" });
  uiStore.setState({ closing: null });
  nodesStore.setState({ nodes: {} });
});

describe("closing running agents, confirmed", () => {
  it("asks first for a running agent, naming it", () => {
    requestClose("batman");
    expect(uiStore.getState().closing).toEqual({ agents: ["batman"], remove: ["batman"] });
  });

  it("once confirmed, removes the agents in one step, and the guard lets them go", () => {
    const check = createRemovalGuard(isRunning, scene);
    removeNodes(["batman", "cyborg"]);
    expect(scene.filter((e) => e.isDeleted).map((e) => e.id)).toEqual(["batman", "cyborg"]);
    expect(check(scene, ["batman", "cyborg"])).toEqual({ dispose: ["batman", "cyborg"], restore: [], ask: null });
  });

  it("gives no pass to a node already gone: back by an undo and running, it still asks (final review)", () => {
    const check = createRemovalGuard(isRunning, [element("batman")]);
    scene = [element("batman", { isDeleted: true }), element("cyborg")];
    removeNodes(["batman"]);
    expect(check([element("cyborg")], ["batman"]).ask).toEqual({ agents: ["batman"], remove: ["batman"] });
  });

  it("undoing a first sub-agent still running: the family put back whole to ask, then, confirmed, the sub-agent and its group go and its parent stays loose", () => {
    const family = [element("batman", { frameId: "g" }), element("robin", { frameId: "g" }), element("g", { type: "frame", customData: undefined })];
    const check = createRemovalGuard(isRunning, family);
    // The one undo step: the sub-agent and its group gone, its parent loose again.
    const undone = [element("batman", { version: 2 }), { ...family[1], isDeleted: true, version: 2 }, { ...family[2], isDeleted: true, version: 2 }] as ExcalidrawElement[];
    const verdict = check(undone, ["robin"]);
    // Put back before the question, as the canvas does: Cancel leaves the family as it was.
    scene = undone.map((e) => verdict.restore.find((r) => r.id === e.id) ?? e);
    expect(scene.filter((e) => !e.isDeleted).map((e) => [e.id, e.frameId])).toEqual([["batman", "g"], ["robin", "g"], ["g", null]]);
    const ask = verdict.ask as { remove: string[]; release?: string[] };
    removeNodes(ask.remove, ask.release);
    expect(scene.filter((e) => !e.isDeleted).map((e) => [e.id, e.frameId])).toEqual([["batman", null]]);
    expect(check(scene, ["robin"]).ask).toBeNull();
  });

  it("Close group, confirmed, lets the frame and its agents go", () => {
    scene = [element("g", { type: "frame", customData: undefined }), element("robin", { frameId: "g" }), element("cyborg", { frameId: "g" })];
    const check = createRemovalGuard(isRunning, scene);
    closeGroup("g");
    expect(scene.every((e) => e.isDeleted)).toBe(true);
    expect(check(scene, ["robin", "cyborg"])).toEqual({ dispose: ["robin", "cyborg"], restore: [], ask: null });
  });
});

describe("closing an agent being started again (review 13 Nov)", () => {
  const term = { cols: 80, rows: 24, write: () => undefined };
  const shell = { title: "Batman", name: "Batman", agent: "shell" as const, cwd: "C:/code", shell: "default" as const, command: "" };
  // The pty as the app sees it: a kill answered by the exit boot's pty-exit handler records.
  beforeEach(() =>
    mockIPC((cmd, args) => {
      if (cmd === "pty_kill") terminalStatusStore.getState().set((args as { nodeId: string }).nodeId, { state: "exited", code: null });
      return cmd === "pty_spawn" ? 1 : undefined;
    }),
  );
  afterEach(() => {
    clearMocks();
    uiStore.setState({ closingGroup: null });
    canvasStore.setState({ frames: [] });
  });

  it("asks first, as for a running one, from its header and when the canvas loses it: its old process gone, its new one on its way", async () => {
    const seen: unknown[] = [];
    await relaunchSession("batman", term, shell, "new", () => {
      requestClose("batman");
      seen.push(uiStore.getState().closing, createRemovalGuard(isAlive, scene)(scene, ["batman"]).ask);
    });
    expect(seen).toEqual([
      { agents: ["batman"], remove: ["batman"] },
      { agents: ["batman"], remove: ["batman"] },
    ]);
    expect(scene.find((e) => e.id === "batman")?.isDeleted).toBe(false);
  });

  it("asks before closing a group one of whose agents is being started again", async () => {
    canvasStore.setState({ frames: [{ id: "g", name: "Serveurs", x: 0, y: 0, width: 10, height: 10, group: { role: "backend", pantheon: "egypt" }, memberIds: ["batman"] }] });
    let asked: string | null = null;
    await relaunchSession("batman", term, shell, "new", () => {
      requestCloseGroup("g");
      asked = uiStore.getState().closingGroup;
    });
    expect(asked).toBe("g");
  });
});

describe("closing an agent that opened sub-agents (spawn_agent)", () => {
  const terminal = (name: string, spawnedBy?: string): NodeRecord => ({
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: name, name, agent: "claude", cwd: "C:/code", shell: "default", command: "", ...(spawnedBy ? { spawnedBy } : {}) },
  });
  const deleted = () => scene.filter((e) => e.isDeleted).map((e) => e.id);

  beforeEach(() => {
    // The scene on screen is w1's: its sub-agents are read there.
    workspacesStore.setState({ activeId: "w1" });
    scene = [element("batman"), element("flash"), element("aquaman"), element("shazam")];
  });

  it("asks for a stopped agent whose sub-agent is still on the canvas, offering to close it too", () => {
    nodesStore.setState({ nodes: { flash: terminal("Flash"), aquaman: terminal("Aquaman", "flash") } });
    requestClose("flash");
    expect(uiStore.getState().closing).toEqual({ agents: ["flash"], remove: ["flash"], children: ["aquaman"] });
    expect(deleted()).toEqual([]);
  });

  it("offers the sub-agents' own sub-agents too", () => {
    nodesStore.setState({ nodes: { flash: terminal("Flash"), aquaman: terminal("Aquaman", "flash"), shazam: terminal("Shazam", "aquaman") } });
    requestClose("flash");
    expect(uiStore.getState().closing?.children).toEqual(["aquaman", "shazam"]);
  });

  it("names a running agent's sub-agents with it", () => {
    nodesStore.setState({ nodes: { batman: terminal("Batman"), aquaman: terminal("Aquaman", "batman") } });
    requestClose("batman");
    expect(uiStore.getState().closing).toEqual({ agents: ["batman"], remove: ["batman"], children: ["aquaman"] });
  });

  it("closes a stopped agent at once when it opened none", () => {
    nodesStore.setState({ nodes: { flash: terminal("Flash"), aquaman: terminal("Aquaman") } });
    requestClose("flash");
    expect(uiStore.getState().closing).toBeNull();
    expect(deleted()).toEqual(["flash"]);
  });

  it("closes a stopped agent at once when its sub-agents are closed already", () => {
    nodesStore.setState({ nodes: { flash: terminal("Flash"), aquaman: terminal("Aquaman", "flash") } });
    scene = scene.map((e) => (e.id === "aquaman" ? element("aquaman", { isDeleted: true }) : e));
    requestClose("flash");
    expect(uiStore.getState().closing).toBeNull();
    expect(deleted()).toEqual(["flash", "aquaman"]);
  });
});
