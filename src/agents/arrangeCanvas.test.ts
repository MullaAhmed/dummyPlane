import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { arrangeLayoutStore } from "@/app/arrangeLayoutSetting";
import { NODE_SIZE, toStoredKind, type NodeKind } from "@/canvas/nodeElement";
import { arrangeCoversCanvas, arrangeWorkspace } from "./arrangeCanvas";
import { NODE_GAP } from "./groupLayout";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", NEVER: "NEVER" } }));
vi.mock("@/nodes/terminal/minimize", () => ({ isMinimized: () => false }));
vi.mock("./spawnTree", () => ({ spawnedBy: () => null }));

const updateScene = vi.fn();
const write = vi.fn();
let shown = true;
let scene: readonly ExcalidrawElement[] = [];
vi.mock("@/canvas/canvasStore", () => ({
  canvasStore: { getState: () => ({ api: { updateScene }, view: { width: 1600, height: 1000 } }) },
}));
vi.mock("./sceneAccess", () => ({ sceneAccess: () => ({ shown, elements: () => scene, write }) }));

const element = (id: string, type: string, x: number, y: number, width: number, height: number, fields: Record<string, unknown> = {}) =>
  ({ id, type, x, y, width, height, angle: 0, isDeleted: false, frameId: null, groupIds: [], version: 1, ...fields }) as unknown as ExcalidrawElement;
const node = (id: string, kind: NodeKind, x: number, y: number) =>
  element(id, "embeddable", x, y, NODE_SIZE[kind].width, NODE_SIZE[kind].height, { frameId: "g", customData: { kind: toStoredKind(kind) } });

/** A group of a terminal, a kanban, a drawn rectangle with its text and an arrow from it to the terminal, all out of place. */
function messyGroup(): ExcalidrawElement[] {
  return [
    node("t", "terminal", 900, 700),
    node("k", "kanban", 2000, 100),
    element("r", "rectangle", 100, 100, 50, 50, { frameId: "g" }),
    element("l", "text", 105, 110, 40, 20, { frameId: "g", containerId: "r" }),
    element("a", "arrow", 150, 125, 750, 795, {
      frameId: "g",
      points: [
        [0, 0],
        [750, 795],
      ],
      startBinding: { elementId: "r", focus: 0, gap: 0 },
      endBinding: { elementId: "t", focus: 0, gap: 0 },
      elbowed: false,
    }),
    element("g", "frame", 0, 0, 4000, 3000, { customData: { dummyplane: { kind: "group", role: "general", pantheon: "olympus" } } }),
  ];
}

/** Four loose terminals, out of place: a and b on top, c and d under them. */
const looseTerminals = () =>
  ["a", "b", "c", "d"].map((id, i) =>
    element(id, "embeddable", (i % 2) * 5000, Math.floor(i / 2) * 5000, NODE_SIZE.terminal.width, NODE_SIZE.terminal.height, { customData: { kind: toStoredKind("terminal") } }),
  );
const written = () => updateScene.mock.calls[updateScene.mock.calls.length - 1][0].elements as ExcalidrawElement[];
const where = (elements: readonly ExcalidrawElement[]) => Object.fromEntries(elements.map((e) => [e.id, { x: e.x, y: e.y, width: e.width, height: e.height }]));

describe("arrangeWorkspace", () => {
  beforeEach(() => {
    updateScene.mockClear();
    write.mockClear();
    shown = true;
    arrangeLayoutStore.setState(arrangeLayoutStore.getInitialState());
  });

  it("takes a tree arrange's mark off in the user's Arrange, in its one undoable step, and leaves it to Auto-arrange", () => {
    arrangeLayoutStore.setState({ layout: "grid" });
    const marked = () => looseTerminals().map((e) => (e.id === "a" ? ({ ...e, customData: { ...e.customData, downTree: true } } as ExcalidrawElement) : e));
    scene = marked();
    updateScene.mockClear();
    expect(arrangeWorkspace("w", { undoable: true })).toBe(true);
    expect(updateScene).toHaveBeenCalledTimes(1);
    expect(updateScene.mock.calls[0][0].captureUpdate).toBe("IMMEDIATELY");
    expect(written().find((e) => e.id === "a")!.customData?.downTree).toBeUndefined();
    scene = marked();
    updateScene.mockClear();
    expect(arrangeWorkspace("w", { undoable: false })).toBe(true);
    expect(updateScene.mock.calls[0][0].captureUpdate).toBe("NEVER");
    expect(written().find((e) => e.id === "a")!.customData?.downTree).toBe(true);
  });

  it("lays the canvas out in the layout chosen in the settings, for Arrange and Auto-arrange alike", () => {
    // The grid: four terminals in two rows of two at the view's 16:10.
    scene = looseTerminals();
    arrangeWorkspace("w", { undoable: true });
    expect(new Set(written().map((e) => e.y)).size).toBe(2);
    arrangeLayoutStore.setState({ layout: "row" });
    for (const undoable of [true, false]) {
      scene = looseTerminals();
      expect(arrangeWorkspace("w", { undoable })).toBe(true);
      const row = written().sort((p, q) => p.x - q.x);
      expect(row.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
      expect(row.every((e) => e.y === 0)).toBe(true);
      expect(row.map((e) => e.x)).toEqual([0, 1, 2, 3].map((i) => i * (NODE_SIZE.terminal.width + NODE_GAP)));
    }
  });

  it("gives a group's Arrange the chosen layout too: its members side by side in one row", () => {
    scene = messyGroup();
    arrangeWorkspace("w", { only: ["g"], undoable: true });
    const grid = where(written());
    expect(grid.t.x).toBe(grid.k.x);
    arrangeLayoutStore.setState({ layout: "row" });
    scene = messyGroup();
    arrangeWorkspace("w", { only: ["g"], undoable: true });
    const row = where(written());
    expect(row.t.y).toBe(row.k.y);
    expect(row.k.x).toBeGreaterThan(row.t.x);
  });

  it("makes room for a group One row widens in the same undoable step: the neighbour it would cover moves with it", () => {
    const { width: w, height: h } = NODE_SIZE.terminal;
    // A group of two terminals, one under the other, and a terminal beside it, which the row would cover.
    const grouped = () => [
      element("g", "frame", 0, 0, 2 * 32 + w, 48 + 2 * h + 56 + 56, { customData: { dummyplane: { kind: "group", role: "general", pantheon: "olympus" } } }),
      node("t1", "terminal", 32, 48),
      node("t2", "terminal", 32, 48 + h + 56),
      element("n", "embeddable", 2 * 32 + w + 96, 0, w, h, { customData: { kind: toStoredKind("terminal") } }),
    ];
    arrangeLayoutStore.setState({ layout: "row" });
    scene = grouped();
    expect(arrangeWorkspace("w", { only: ["g"], undoable: true })).toBe(true);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const { elements, captureUpdate } = updateScene.mock.calls[0][0] as { elements: ExcalidrawElement[]; captureUpdate: string };
    expect(captureUpdate).toBe("IMMEDIATELY");
    const now = where(elements);
    expect(now.t2).toMatchObject({ y: now.t1.y });
    expect(now.n.x).toBeGreaterThanOrEqual(now.g.x + now.g.width + NODE_GAP);
    // Undo restores the scene before it, the neighbour included.
    expect(where(scene).n).toEqual({ x: 2 * 32 + w + 96, y: 0, width: w, height: h });
  });

  it("passes the scope on: the whole canvas whatever is selected, or the selection alone", () => {
    scene = looseTerminals();
    arrangeWorkspace("w", { undoable: true });
    const all = where(written());
    arrangeWorkspace("w", { only: ["a", "b"], scope: "canvas", undoable: true });
    expect(where(written())).toEqual(all);
    // One block selected: in `auto` the whole canvas moves, alone it stays as it is.
    updateScene.mockClear();
    expect(arrangeWorkspace("w", { only: ["a"], scope: "selection", undoable: true })).toBe(false);
    expect(updateScene).not.toHaveBeenCalled();
    expect(arrangeWorkspace("w", { only: ["a"], undoable: true })).toBe(true);
  });

  it("arranges a group's every member in one undoable step, leaving the scene before it intact for the undo", () => {
    scene = messyGroup();
    const before = structuredClone(scene);
    expect(arrangeWorkspace("w", { undoable: true })).toBe(true);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const { elements, captureUpdate } = updateScene.mock.calls[0][0] as { elements: ExcalidrawElement[]; captureUpdate: string };
    expect(captureUpdate).toBe("IMMEDIATELY");
    // Every member moved (the frame was fitted), each a new version of itself: Excalidraw's undo takes them all back at once.
    for (const id of ["t", "k", "r", "l", "a", "g"]) {
      const now = elements.find((e) => e.id === id)!;
      const was = before.find((e) => e.id === id)!;
      expect(now).not.toBe(scene.find((e) => e.id === id));
      expect(now.version).toBeGreaterThan(was.version);
      expect({ x: now.x, y: now.y, width: now.width, height: now.height }).not.toEqual({ x: was.x, y: was.y, width: was.width, height: was.height });
    }
    // What undo restores is untouched: the scene before the arrangement, as it was.
    expect(scene).toEqual(before);
  });

  it("arranges for Auto-arrange outside the undo history", () => {
    scene = messyGroup();
    expect(arrangeWorkspace("w", { undoable: false })).toBe(true);
    expect(updateScene.mock.calls[0][0]).toMatchObject({ captureUpdate: "NEVER" });
  });

  it("writes a scene not on screen, and reports nothing moved when all stands arranged", () => {
    shown = false;
    scene = messyGroup();
    expect(arrangeWorkspace("w", { undoable: true })).toBe(true);
    expect(updateScene).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    scene = write.mock.calls[0][0] as ExcalidrawElement[];
    expect(arrangeWorkspace("w", { undoable: true })).toBe(false);
  });
});

describe("arrangeCoversCanvas", () => {
  it("says whether an Arrange of the selection takes the whole canvas, as the arrange itself reads it", () => {
    scene = looseTerminals();
    expect(arrangeCoversCanvas("w")).toBe(true);
    expect(arrangeCoversCanvas("w", [])).toBe(true);
    expect(arrangeCoversCanvas("w", ["a"])).toBe(true);
    expect(arrangeCoversCanvas("w", ["a", "b"])).toBe(false);
    // Whether or not anything would move.
    expect(arrangeCoversCanvas("w", ["a", "b", "c", "d"])).toBe(false);
  });
});
