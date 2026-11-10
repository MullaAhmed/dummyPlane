import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { GROUP_GAP } from "./groupLayout";

vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn().mockResolvedValue(undefined), saveNode: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { NEVER: "never", IMMEDIATELY: "immediately" } }));

const scene = vi.hoisted(() => ({ shown: true, elements: [] as unknown[] }));
const updateScene = vi.hoisted(() => vi.fn());
const editStoredScene = vi.hoisted(() => vi.fn());
vi.mock("./sceneAccess", () => ({
  sceneAccess: () => ({ shown: scene.shown, elements: () => scene.elements, write: vi.fn() }),
}));
vi.mock("@/canvas/canvasStore", () => ({ canvasStore: { getState: () => ({ api: { updateScene } }) } }));
vi.mock("@/canvas/sceneCache", () => ({ editStoredScene }));

const { createSpawnDragWatch, reflowSpawnTreesOf, reflowSpawnTree } = await import("./spawnTree");

const { width: W } = NODE_SIZE.terminal;

function terminal(id: string, x = 5000, y = 5000): ExcalidrawElement {
  return { ...(createNodeElement("terminal", { x: 0, y: 0 }) as unknown as ExcalidrawElement), id, x, y } as ExcalidrawElement;
}

function record(spawnedBy?: string) {
  const payload: TerminalPayload = { title: "", name: "", agent: "claude", cwd: "/", shell: "default", command: "", ...(spawnedBy ? { spawnedBy } : {}) };
  return { workspaceId: "w", kind: "terminal" as const, payload };
}

let frames: FrameRequestCallback[];

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  updateScene.mockClear();
  editStoredScene.mockClear();
  scene.shown = true;
  scene.elements = [terminal("root", 0, 0), terminal("a"), terminal("lone", 0, 3000)];
  nodesStore.setState({ nodes: { root: record(), a: record("root"), lone: record() } });
});

afterEach(() => vi.unstubAllGlobals());

const written = () => updateScene.mock.calls[updateScene.mock.calls.length - 1][0] as { elements: ExcalidrawElement[]; captureUpdate: string };
const at = (elements: readonly ExcalidrawElement[], id: string) => elements.find((e) => e.id === id)!;

describe("reflowSpawnTree", () => {
  it("moves the descendants on screen, out of the undo history", () => {
    expect(reflowSpawnTree("w", "a")).toBe(true);
    const { elements, captureUpdate } = written();
    expect(captureUpdate).toBe("never");
    expect({ x: at(elements, "a").x, y: at(elements, "a").y }).toEqual({ x: W + GROUP_GAP, y: 0 });
  });

  it("writes a scene not on screen to the stored scene", () => {
    scene.shown = false;
    expect(reflowSpawnTree("w", "root")).toBe(true);
    expect(updateScene).not.toHaveBeenCalled();
    expect(at(editStoredScene.mock.calls[0][1], "a").x).toBe(W + GROUP_GAP);
  });

  it("writes nothing when the tree is laid out already", () => {
    scene.elements = [terminal("root", 0, 0), terminal("a", W + GROUP_GAP, 0)];
    expect(reflowSpawnTree("w", "a")).toBe(false);
    expect(updateScene).not.toHaveBeenCalled();
  });
});

describe("reflowSpawnTreesOf", () => {
  it("lays the closed node's tree out again a frame later", () => {
    nodesStore.setState({ nodes: { root: record(), a: record("root"), b: record("root") } });
    scene.elements = [terminal("root", 0, 0), { ...terminal("a", W + GROUP_GAP, 0), isDeleted: true }, terminal("b", W + GROUP_GAP, 900)];
    reflowSpawnTreesOf("w", ["a"]);
    expect(updateScene).not.toHaveBeenCalled();
    frames.forEach((cb) => cb(0));
    expect(at(written().elements, "b").y).toBe(0);
  });

  it("ignores nodes nobody spawned", () => {
    reflowSpawnTreesOf("w", ["lone", "root"]);
    expect(frames).toHaveLength(0);
  });
});

describe("createSpawnDragWatch", () => {
  const dragging = (ids: string[], on: boolean) => ({ selectedElementIds: Object.fromEntries(ids.map((id) => [id, true as const])), selectedElementsAreBeingDragged: on });

  it("pins a spawned node the user dragged, when the drag ends", () => {
    const watch = createSpawnDragWatch("w");
    const laid = [terminal("root", 0, 0), terminal("a", W + GROUP_GAP, 0)];
    watch(laid, dragging(["a"], false));
    const moved = [laid[0], { ...laid[1], x: 3000, y: 2000 }];
    watch(moved, dragging(["a"], true));
    expect(frames).toHaveLength(0);
    scene.elements = moved;
    watch(moved, dragging(["a"], false));
    frames.forEach((cb) => cb(0));
    const a = at(written().elements, "a");
    expect(a.customData?.pinned).toBe(true);
    expect({ x: a.x, y: a.y }).toEqual({ x: 3000, y: 2000 });
  });

  it("takes a spawner's tree along when the spawner is dragged", () => {
    const watch = createSpawnDragWatch("w");
    const laid = [terminal("root", 0, 0), terminal("a", W + GROUP_GAP, 0)];
    watch(laid, dragging(["root"], false));
    const moved = [{ ...laid[0], x: 100, y: 200 }, laid[1]];
    watch(moved, dragging(["root"], true));
    scene.elements = moved;
    watch(moved, dragging(["root"], false));
    frames.forEach((cb) => cb(0));
    const { elements } = written();
    expect(at(elements, "root").customData?.pinned).toBeUndefined();
    expect({ x: at(elements, "a").x, y: at(elements, "a").y }).toEqual({ x: 100 + W + GROUP_GAP, y: 200 });
  });

  it("pins nothing when the layout moves a selected node", () => {
    const watch = createSpawnDragWatch("w");
    scene.elements = [terminal("root", 0, 0), terminal("a")];
    watch(scene.elements as ExcalidrawElement[], dragging(["a"], false));
    reflowSpawnTree("w", "a");
    // Its change reaches onChange even mid-drag of something else: the moved node stood there already.
    watch(written().elements, dragging(["a"], true));
    watch(written().elements, dragging(["a"], false));
    expect(frames).toHaveLength(0);
  });

  it("pins nothing when a node moves without a drag (undo, keyboard)", () => {
    const watch = createSpawnDragWatch("w");
    const laid = [terminal("root", 0, 0), terminal("a", W + GROUP_GAP, 0)];
    watch(laid, dragging(["a"], false));
    watch([laid[0], { ...laid[1], x: 1 }], dragging(["a"], false));
    expect(frames).toHaveLength(0);
  });
});

describe("closing and undoing", () => {
  it("puts a closed node's tree back in place when an undo brings it back", () => {
    nodesStore.setState({ nodes: { root: record(), a: record("root"), b: record("root"), a1: record("a") } });
    const laid = [terminal("root", 0, 0), terminal("a", W + GROUP_GAP, 0), terminal("b", W + GROUP_GAP, 1400), terminal("a1", 2 * (W + GROUP_GAP), 0)];
    // Closed: b and a1 close up into a's column.
    scene.elements = laid.map((e) => (e.id === "a" ? { ...e, isDeleted: true } : e));
    reflowSpawnTreesOf("w", ["a"]);
    frames.splice(0).forEach((cb) => cb(0));
    const closed = written().elements;
    expect(at(closed, "a1").x).toBe(W + GROUP_GAP);
    // The undo brings a back where it stood, over whatever took its place.
    scene.elements = closed.map((e) => (e.id === "a" ? { ...e, isDeleted: false } : e));
    reflowSpawnTreesOf("w", ["a"]);
    frames.splice(0).forEach((cb) => cb(0));
    const back = written().elements;
    expect({ x: at(back, "a").x, y: at(back, "a").y }).toEqual({ x: W + GROUP_GAP, y: 0 });
    expect({ x: at(back, "a1").x, y: at(back, "a1").y }).toEqual({ x: 2 * (W + GROUP_GAP), y: 0 });
    expect(at(back, "b").y).toBeGreaterThan(at(back, "a").y + at(back, "a").height);
  });
});

describe("dragging a whole tree", () => {
  it("pins no child dragged along with its spawner", () => {
    const watch = createSpawnDragWatch("w");
    const laid = [terminal("root", 0, 0), terminal("a", W + GROUP_GAP, 0)];
    const both = { selectedElementIds: { root: true as const, a: true as const } };
    watch(laid, { ...both, selectedElementsAreBeingDragged: false });
    const moved = laid.map((e) => ({ ...e, x: e.x + 500 }));
    watch(moved, { ...both, selectedElementsAreBeingDragged: true });
    scene.elements = moved;
    watch(moved, { ...both, selectedElementsAreBeingDragged: false });
    frames.forEach((cb) => cb(0));
    expect(updateScene).not.toHaveBeenCalled();
  });
});
