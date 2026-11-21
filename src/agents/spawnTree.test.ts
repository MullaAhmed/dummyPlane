import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { COLUMN_GAP, GROUP_GAP } from "./groupLayout";
import { isSpawnWire, orphanWires, withWire } from "./wires";

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

  it("lays a mission's Manager's team out downward, its wires out of the Manager's bottom", () => {
    const manager = { ...record(), payload: { ...record().payload, role: "manager" as const, fleet: "f" } };
    nodesStore.setState({ nodes: { mgr: manager, m0: record("mgr"), m1: record("mgr") } });
    scene.elements = withWire(withWire([terminal("mgr", 0, 0), terminal("m0"), terminal("m1")], "mgr", "m0", "calm", true), "mgr", "m1", "calm", true);
    expect(reflowSpawnTree("w", "mgr")).toBe(true);
    const { elements } = written();
    expect({ x: at(elements, "m0").x, y: at(elements, "m0").y }).toEqual({ x: 0, y: NODE_SIZE.terminal.height + GROUP_GAP });
    expect({ x: at(elements, "m1").x, y: at(elements, "m1").y }).toEqual({ x: W + COLUMN_GAP, y: NODE_SIZE.terminal.height + GROUP_GAP });
    const wires = elements.filter((e) => e.type === "arrow");
    expect(wires.map((e) => e.customData?.dummyplane)).toEqual([
      { kind: "wire", spawn: true, down: true },
      { kind: "wire", spawn: true, down: true },
    ]);
    // Laid out: a second reflow writes nothing.
    scene.elements = elements;
    updateScene.mockClear();
    expect(reflowSpawnTree("w", "m1")).toBe(false);
    expect(updateScene).not.toHaveBeenCalled();
  });

  it("lays a tree Arrange laid out as a tree out downward again, from its marked root (./arrangeTree.ts)", () => {
    const root = { ...terminal("root", 0, 0), customData: { ...terminal("root").customData, downTree: true } } as ExcalidrawElement;
    scene.elements = withWire([root, terminal("a")], "root", "a", "calm", true);
    expect(reflowSpawnTree("w", "a")).toBe(true);
    expect({ x: at(written().elements, "a").x, y: at(written().elements, "a").y }).toEqual({ x: 0, y: NODE_SIZE.terminal.height + GROUP_GAP });
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

  it("walks a scene once while only the view moves, and still pins the node dragged after it: a pan's frames", () => {
    let walks = 0;
    // The scene as Excalidraw hands it, each walk over it counted.
    const counted = (elements: ExcalidrawElement[]) =>
      new Proxy(elements, {
        get: (target, key, receiver) => {
          if (key === Symbol.iterator) walks++;
          return Reflect.get(target, key, receiver);
        },
      });
    const watch = createSpawnDragWatch("w");
    const laid = [terminal("root", 0, 0), terminal("a", W + GROUP_GAP, 0)];
    const still = counted(laid);
    watch(still, dragging(["a"], false), 2);
    expect(walks).toBe(1);
    // A pan: the same scene, the same version, no drag, frame after frame.
    for (let frame = 0; frame < 60; frame++) watch(still, dragging(["a"], false), 2);
    expect(walks).toBe(1);
    // Then a drag, and its end on a frame that hands the same scene: the drag's end is looked at.
    const moved = counted([laid[0], { ...laid[1], x: 3000, y: 2000, version: laid[1].version + 1 }]);
    watch(moved, dragging(["a"], true), 3);
    scene.elements = moved;
    watch(moved, dragging(["a"], false), 3);
    expect(walks).toBe(3);
    frames.forEach((cb) => cb(0));
    expect(at(written().elements, "a").customData?.pinned).toBe(true);
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

describe("spawn wires through a drag of the children", () => {
  const dragging = (ids: string[], on: boolean) => ({ selectedElementIds: Object.fromEntries(ids.map((id) => [id, true as const])), selectedElementsAreBeingDragged: on });

  it("keeps every wire bound at both ends when five of six children are dragged 1 px and pinned", () => {
    // The user's tree: an agent and six sub-agents, a spawn wire to each.
    const kids = ["k1", "k2", "k3", "k4", "k5", "k6"];
    nodesStore.setState({ nodes: { root: record(), ...Object.fromEntries(kids.map((id) => [id, record("root")])) } });
    let elements: ExcalidrawElement[] = [terminal("root", 0, 0), ...kids.map((id) => terminal(id))];
    for (const id of kids) elements = withWire(elements, "root", id, "calm", true);
    scene.elements = elements;
    reflowSpawnTree("w", "root");
    const laid = written().elements;
    const wireTo = (all: readonly ExcalidrawElement[], id: string) => all.find((e) => e.type === "arrow" && (e as ExcalidrawArrowElement).endBinding?.elementId === id);

    const watch = createSpawnDragWatch("w");
    const five = kids.slice(0, 5);
    watch(laid, dragging(five, false));
    const moved = laid.map((e) => (five.includes(e.id) ? { ...e, y: e.y + 1, version: e.version + 1 } : e));
    watch(moved, dragging(five, true));
    scene.elements = moved;
    watch(moved, dragging(five, false));
    frames.splice(0).forEach((cb) => cb(0));
    const after = written().elements;

    expect(orphanWires(after)).toEqual([]);
    for (const id of kids) {
      const wire = wireTo(after, id)!;
      expect(wire).toMatchObject({ isDeleted: false, startBinding: { elementId: "root" }, endBinding: { elementId: id } });
      expect(isSpawnWire(wire)).toBe(true);
      expect(at(after, id).boundElements).toEqual([{ id: wire.id, type: "arrow" }]);
      expect(at(after, "root").boundElements).toContainEqual({ id: wire.id, type: "arrow" });
    }
    five.forEach((id) => expect(at(after, id).customData?.pinned).toBe(true));
    expect(at(after, "k6").customData?.pinned).toBeUndefined();
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

describe("a mission follows its Fleet (./missionLayout.ts)", () => {
  const dragging = (ids: string[], on: boolean) => ({ selectedElementIds: Object.fromEntries(ids.map((id) => [id, true as const])), selectedElementsAreBeingDragged: on });
  const node = (kind: "fleet" | "kanban", id: string, x: number, y: number) => ({ ...(createNodeElement(kind, { x: 0, y: 0 }) as unknown as ExcalidrawElement), id, x, y }) as ExcalidrawElement;
  const mission = ["board", "mgr", "m1", "m2"];
  const where = (elements: readonly ExcalidrawElement[], ids: readonly string[]) => ids.map((id) => ({ x: at(elements, id).x, y: at(elements, id).y }));
  const shifted = (points: readonly { x: number; y: number }[], dx: number, dy: number) => points.map((p) => ({ x: p.x + dx, y: p.y + dy }));

  /** A Fleet, its board docked right of it, the Manager under the board and two agents of its team, as the go-ahead lays them out; `helpers`, the Fleet's own sub-agents. */
  function missionScene(helpers: string[] = []): ExcalidrawElement[] {
    const manager = { ...record(), payload: { ...record().payload, role: "manager", fleet: "fleet" } };
    nodesStore.setState({
      nodes: {
        fleet: { workspaceId: "w", kind: "fleet", payload: { name: "Chef", mission: { board: "board", manager: "mgr" } } },
        board: { workspaceId: "w", kind: "kanban", payload: {} },
        mgr: manager,
        m1: record("mgr"),
        m2: record("mgr"),
        ...Object.fromEntries(helpers.map((id) => [id, record("fleet")])),
      } as never,
    });
    let elements = [node("fleet", "fleet", 0, 0), node("kanban", "board", 640 + GROUP_GAP, 0), terminal("mgr", 600, 496), terminal("m1"), terminal("m2"), ...helpers.map((id) => terminal(id))];
    elements = withWire(withWire(elements, "fleet", "board"), "board", "mgr");
    for (const id of ["m1", "m2"]) elements = withWire(elements, "mgr", id, "calm", true);
    for (const id of helpers) elements = withWire(elements, "fleet", id, "calm", true);
    scene.elements = elements;
    reflowSpawnTree("w", "mgr");
    if (helpers.length > 0) reflowSpawnTree("w", "fleet");
    return scene.elements as ExcalidrawElement[];
  }

  /** The drag of `ids` by (dx, dy), as Excalidraw hands it to the watch, its end's frames run. */
  function drag(laid: readonly ExcalidrawElement[], ids: string[], dx: number, dy: number): ExcalidrawElement[] {
    const watch = createSpawnDragWatch("w");
    watch(laid, dragging(ids, false));
    const moved = laid.map((e) => (ids.includes(e.id) ? { ...e, x: e.x + dx, y: e.y + dy, version: e.version + 1 } : e));
    watch(moved, dragging(ids, true));
    scene.elements = moved;
    watch(moved, dragging(ids, false));
    frames.splice(0).forEach((cb) => cb(0));
    return scene.elements as ExcalidrawElement[];
  }

  // The scene as each write leaves it: the follow, then the Fleet's reflow, read it in turn.
  beforeEach(() => updateScene.mockImplementation(({ elements }: { elements: ExcalidrawElement[] }) => (scene.elements = elements)));
  afterEach(() => updateScene.mockImplementation(() => undefined));

  it("takes its board, Manager and team along when a Fleet with no sub-agent of its own is dragged", () => {
    const laid = missionScene();
    const after = drag(laid, ["fleet"], 500, 300);
    expect(where(after, mission)).toEqual(shifted(where(laid, mission), 500, 300));
    for (const id of mission) expect(at(after, id).customData?.pinned, id).toBeUndefined();
  });

  it("takes its sub-agents and its mission along, the mission still under them, when a Fleet with sub-agents is dragged", () => {
    const laid = missionScene(["h1", "h2"]);
    // Docked under the Fleet's own sub-agents.
    expect(at(laid, "board").y).toBeGreaterThan(at(laid, "h2").y + at(laid, "h2").height);
    const after = drag(laid, ["fleet"], -400, 700);
    expect(where(after, [...mission, "h1", "h2"])).toEqual(shifted(where(laid, [...mission, "h1", "h2"]), -400, 700));
  });

  it("takes the Manager and team along when the board is dragged, and leaves the mission where it was put", () => {
    const laid = missionScene(["h1"]);
    const after = drag(laid, ["board"], -3000, 200);
    expect(where(after, mission)).toEqual(shifted(where(laid, mission), -3000, 200));
    // Away from its Fleet now: the Fleet's next layout leaves it there.
    reflowSpawnTree("w", "fleet");
    expect(where(scene.elements as ExcalidrawElement[], mission)).toEqual(where(after, mission));
  });

  it("pins no agent of the team dragged along with its Fleet", () => {
    const laid = missionScene();
    const after = drag(laid, ["fleet", "m1"], 300, 0);
    expect(where(after, mission)).toEqual(shifted(where(laid, mission), 300, 0));
    expect(at(after, "m1").customData?.pinned).toBeUndefined();
  });

  /** The scene moved without a drag (the arrow keys, an undo), as Excalidraw hands it to the watch, the next frames run. */
  function nudge(watch: ReturnType<typeof createSpawnDragWatch>, laid: readonly ExcalidrawElement[], ids: string[], dx: number, dy: number): ExcalidrawElement[] {
    const moved = laid.map((e) => (ids.includes(e.id) ? { ...e, x: e.x + dx, y: e.y + dy, version: e.version + 1 } : e));
    scene.elements = moved;
    watch(moved, dragging(ids, false));
    frames.splice(0).forEach((cb) => cb(0));
    return scene.elements as ExcalidrawElement[];
  }

  it("takes its sub-agents and mission along when a Fleet moves with the arrow keys, and back when its drag is undone", () => {
    const laid = missionScene(["h1"]);
    const all = [...mission, "h1"];
    const watch = createSpawnDragWatch("w");
    watch(laid, dragging(["fleet"], false));
    const keyed = nudge(watch, laid, ["fleet"], 0, 40);
    expect(where(keyed, all)).toEqual(shifted(where(laid, all), 0, 40));
    // Ctrl+Z of a drag takes the Fleet back alone: what followed it was out of the undo history.
    const undone = nudge(watch, keyed, ["fleet"], 500, -300);
    expect(where(undone, all)).toEqual(shifted(where(laid, all), 500, -260));
  });

  it("moves nothing more when the Fleet moved with its mission (an Arrange)", () => {
    const laid = missionScene();
    const watch = createSpawnDragWatch("w");
    watch(laid, dragging([], false));
    updateScene.mockClear();
    const arranged = nudge(watch, laid, ["fleet", ...mission], -800, 120);
    expect(updateScene).not.toHaveBeenCalled();
    expect(where(arranged, mission)).toEqual(shifted(where(laid, mission), -800, 120));
  });
});
