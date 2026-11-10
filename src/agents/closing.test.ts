// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { createRemovalGuard } from "@/canvas/removalGuard";
import { nodesStore, type NodeRecord } from "@/store/nodes";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";
import { uiStore } from "@/store/ui";
import { workspacesStore } from "@/store/workspaces";
import { closeGroup } from "./groups";
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

describe("closing running agents, confirmed (spec habillage §7.5, retours J8b)", () => {
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

  it("Close group, confirmed, lets the frame and its agents go", () => {
    scene = [element("g", { type: "frame", customData: undefined }), element("robin", { frameId: "g" }), element("cyborg", { frameId: "g" })];
    const check = createRemovalGuard(isRunning, scene);
    closeGroup("g");
    expect(scene.every((e) => e.isDeleted)).toBe(true);
    expect(check(scene, ["robin", "cyborg"])).toEqual({ dispose: ["robin", "cyborg"], restore: [], ask: null });
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
