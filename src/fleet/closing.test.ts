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
  scene = [element("isis"), element("thot"), element("anubis")];
  canvasStore.setState({
    api: {
      getSceneElementsIncludingDeleted: () => scene,
      getSceneElements: () => scene.filter((e) => !e.isDeleted),
      updateScene: ({ elements }: { elements?: ExcalidrawElement[] }) => {
        if (elements) scene = elements;
      },
    } as unknown as ExcalidrawImperativeAPI,
  });
  for (const id of ["isis", "thot", "ra"]) terminalStatusStore.getState().set(id, { state: "running" });
  uiStore.setState({ closing: null });
  nodesStore.setState({ nodes: {} });
});

describe("closing running agents, confirmed (spec habillage §7.5, retours J8b)", () => {
  it("asks first for a running agent, naming it", () => {
    requestClose("isis");
    expect(uiStore.getState().closing).toEqual({ agents: ["isis"], remove: ["isis"] });
  });

  it("once confirmed, removes the agents in one step, and the guard lets them go", () => {
    const check = createRemovalGuard(isRunning, scene);
    removeNodes(["isis", "thot"]);
    expect(scene.filter((e) => e.isDeleted).map((e) => e.id)).toEqual(["isis", "thot"]);
    expect(check(scene, ["isis", "thot"])).toEqual({ dispose: ["isis", "thot"], restore: [], ask: null });
  });

  it("gives no pass to a node already gone: back by an undo and running, it still asks (final review)", () => {
    const check = createRemovalGuard(isRunning, [element("isis")]);
    scene = [element("isis", { isDeleted: true }), element("thot")];
    removeNodes(["isis"]);
    expect(check([element("thot")], ["isis"]).ask).toEqual({ agents: ["isis"], remove: ["isis"] });
  });

  it("Close group, confirmed, lets the frame and its agents go", () => {
    scene = [element("g", { type: "frame", customData: undefined }), element("ra", { frameId: "g" }), element("thot", { frameId: "g" })];
    const check = createRemovalGuard(isRunning, scene);
    closeGroup("g");
    expect(scene.every((e) => e.isDeleted)).toBe(true);
    expect(check(scene, ["ra", "thot"])).toEqual({ dispose: ["ra", "thot"], restore: [], ask: null });
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
    scene = [element("isis"), element("anubis"), element("horus"), element("seth")];
  });

  it("asks for a stopped agent whose sub-agent is still on the canvas, offering to close it too", () => {
    nodesStore.setState({ nodes: { anubis: terminal("Anubis"), horus: terminal("Horus", "anubis") } });
    requestClose("anubis");
    expect(uiStore.getState().closing).toEqual({ agents: ["anubis"], remove: ["anubis"], children: ["horus"] });
    expect(deleted()).toEqual([]);
  });

  it("offers the sub-agents' own sub-agents too", () => {
    nodesStore.setState({ nodes: { anubis: terminal("Anubis"), horus: terminal("Horus", "anubis"), seth: terminal("Seth", "horus") } });
    requestClose("anubis");
    expect(uiStore.getState().closing?.children).toEqual(["horus", "seth"]);
  });

  it("names a running agent's sub-agents with it", () => {
    nodesStore.setState({ nodes: { isis: terminal("Isis"), horus: terminal("Horus", "isis") } });
    requestClose("isis");
    expect(uiStore.getState().closing).toEqual({ agents: ["isis"], remove: ["isis"], children: ["horus"] });
  });

  it("closes a stopped agent at once when it opened none", () => {
    nodesStore.setState({ nodes: { anubis: terminal("Anubis"), horus: terminal("Horus") } });
    requestClose("anubis");
    expect(uiStore.getState().closing).toBeNull();
    expect(deleted()).toEqual(["anubis"]);
  });

  it("closes a stopped agent at once when its sub-agents are closed already", () => {
    nodesStore.setState({ nodes: { anubis: terminal("Anubis"), horus: terminal("Horus", "anubis") } });
    scene = scene.map((e) => (e.id === "horus" ? element("horus", { isDeleted: true }) : e));
    requestClose("anubis");
    expect(uiStore.getState().closing).toBeNull();
    expect(deleted()).toEqual(["anubis", "horus"]);
  });
});
