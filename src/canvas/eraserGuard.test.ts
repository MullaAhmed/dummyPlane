import { STORED_FLEET_KIND } from "./nodeElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { eraserGuard, releaseEraserLocks, scheduleEraserGuard } from "./eraserGuard";
import { lockedByEraser } from "./eraserLock";
import { createNodeElement, NODE_SIZE, type NodeKind } from "./nodeElement";
import { createRemovalGuard } from "./removalGuard";

// newElementWith as Excalidraw has it: an update that changes nothing gives back the same element, unless forced.
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "never" },
  newElementWith: (e: ExcalidrawElement, patch: Record<string, unknown>, force = false) => {
    const changed = Object.entries(patch).some(([key, value]) => value !== undefined && (typeof value === "object" && value !== null ? true : (e as unknown as Record<string, unknown>)[key] !== value));
    return changed || force ? { ...e, ...patch, version: e.version + 1 } : e;
  },
}));

const node = (kind: NodeKind, x: number, y: number): ExcalidrawElement => {
  const { width, height } = NODE_SIZE[kind];
  return createNodeElement(kind, { x: x + width / 2, y: y + height / 2 });
};
/** A drawn rectangle: what the eraser is for. */
const rectangle = (id: string, x: number, y: number, width = 100, height = 100): ExcalidrawElement =>
  ({ ...createNodeElement("note", { x: 0, y: 0 }), id, type: "rectangle", x, y, width, height, customData: undefined, link: null }) as unknown as ExcalidrawElement;
const frame = (id: string, x: number, y: number, width: number, height: number, folded = false): ExcalidrawElement =>
  ({
    ...rectangle(id, x, y, width, height),
    type: "frame",
    customData: { dummyplane: { kind: "group", role: "backend", pantheon: "egypt", ...(folded ? { folded: true } : {}) } },
  }) as unknown as ExcalidrawElement;
const inside = (element: ExcalidrawElement, frameId: string): ExcalidrawElement => ({ ...element, frameId });

const live = (elements: readonly ExcalidrawElement[]) => elements.filter((e) => !e.isDeleted).map((e) => e.id);

/**
 * Excalidraw 0.18.1's eraser, as its source has it (App.handleEraser, eraseElements,
 * getElementsAtPosition): what the path crosses and is not locked is pending, with
 * the rest of its group; on release, what is pending goes, and the children of a
 * pending frame. A click is a path of one point. Bounding boxes stand for hits.
 */
function erase(elements: readonly ExcalidrawElement[], path: [number, number][]): ExcalidrawElement[] {
  const pending = new Set<string>();
  const samples = path.flatMap(([x, y], i) => {
    if (i === 0) return [[x, y]];
    const [fromX, fromY] = path[i - 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x - fromX, y - fromY) / 5));
    return Array.from({ length: steps }, (_, s) => [fromX + ((x - fromX) * (s + 1)) / steps, fromY + ((y - fromY) * (s + 1)) / steps]);
  });
  for (const [x, y] of samples) {
    for (const e of elements) {
      if (e.isDeleted || e.locked || x < e.x || x > e.x + e.width || y < e.y || y > e.y + e.height) continue;
      pending.add(e.id);
      const group = e.groupIds[e.groupIds.length - 1];
      if (group) elements.filter((m) => !m.isDeleted && m.groupIds.includes(group)).forEach((m) => pending.add(m.id));
    }
  }
  return elements.map((e) => (pending.has(e.id) || (e.frameId && pending.has(e.frameId)) ? { ...e, isDeleted: true, version: e.version + 1 } : e));
}

/** The scene as the guard leaves it when the eraser is picked. */
const withEraser = (elements: ExcalidrawElement[]) => eraserGuard(elements, true) ?? elements;

/** What the app does with an erase it sees land: the removal guard on the nodes that left. */
function settle(before: readonly ExcalidrawElement[], after: readonly ExcalidrawElement[], running: boolean) {
  const removed = before.filter((e) => !e.isDeleted && e.customData?.kind && after.find((a) => a.id === e.id)?.isDeleted).map((e) => e.id);
  return { removed, verdict: createRemovalGuard(() => running, before)(after, removed) };
}

describe("the eraser against a terminal and the Fleet (Excalidraw's rules, modelled)", () => {
  // The terminal spans x 0..720, y 0..440; the Fleet x 1000..1640, y 0..760.
  const scene = () => [node("terminal", 0, 0), node("fleet", 1000, 0), rectangle("drawn", 600, 300, 500, 100)];

  it("is the problem to begin with: unguarded, a click erases the terminal", () => {
    const before = scene();
    expect(live(erase(before, [[100, 100]]))).toEqual([before[1].id, "drawn"]);
  });

  it.each([true, false])("leaves a terminal and the Fleet alone on a click, with no dialog (running: %s)", (running) => {
    const before = withEraser(scene());
    for (const point of [[100, 100], [1300, 300]] as [number, number][]) {
      const after = erase(before, [point]);
      expect(live(after)).toEqual(live(before));
      const { removed, verdict } = settle(before, after, running);
      expect(removed).toEqual([]);
      expect(verdict).toEqual({ dispose: [], restore: [], ask: null });
    }
  });

  it("leaves them alone on a drag across both, and still erases the drawn rectangle on the same path", () => {
    const before = withEraser(scene());
    const after = erase(before, [[50, 350], [1300, 350]]);
    expect(live(after)).toEqual([before[0].id, before[1].id]);
    const { removed, verdict } = settle(before, after, true);
    expect(removed).toEqual([]);
    expect(verdict).toEqual({ dispose: [], restore: [], ask: null });
  });

  it("erases a drawn rectangle that overlaps a terminal where the click lands, and nothing else", () => {
    const before = withEraser([node("terminal", 0, 0), rectangle("drawn", 300, 100, 200, 200)]);
    expect(live(erase(before, [[400, 200]]))).toEqual([before[0].id]);
  });

  it("does not let a group take a node with a drawing", () => {
    const grouped = { ...node("terminal", 0, 0), groupIds: ["g"] };
    const drawing = { ...rectangle("drawn", 800, 0), groupIds: ["g"] };
    const before = [grouped, drawing];
    // Unguarded, the drawing's click takes the whole group, the terminal with it.
    expect(live(erase(before, [[850, 50]]))).toEqual([]);
    const guarded = withEraser(before);
    expect(live(erase(guarded, [[850, 50]]))).toEqual([grouped.id, "drawn"]);
  });

  it("does not let a group frame take its terminals", () => {
    const home = frame("home", -20, -20, 1000, 500);
    const before = [home, inside(node("terminal", 0, 0), "home"), inside(rectangle("drawn", 750, 100, 150, 150), "home")];
    // Unguarded, touching the frame takes everything in it, the terminal with the rest.
    expect(live(erase(before, [[-10, 200]]))).toEqual([]);
    const guarded = withEraser(before);
    expect(live(erase(guarded, [[-10, 200]]))).toEqual(["home", before[1].id, "drawn"]);
    // A drawing in the frame is still erased on its own.
    expect(live(erase(guarded, [[800, 150]]))).toEqual(["home", before[1].id]);
  });

  it("does not let a drawing grouped with a frame take the frame, and the terminals it holds", () => {
    const home = { ...frame("home", -20, -20, 1000, 500), groupIds: ["g"] };
    const before = [home, inside(node("terminal", 0, 0), "home"), { ...rectangle("stroke", 1100, 0), groupIds: ["g"] }];
    // Unguarded, the group goes whole, the frame in it, and the frame takes the terminal along.
    expect(live(erase(before, [[1150, 50]]))).toEqual([]);
    const guarded = withEraser(before);
    expect(live(erase(guarded, [[1150, 50]]))).toEqual(["home", before[1].id, "stroke"]);
    expect(live(erase(guarded, [[1050, 50], [1250, 50]]))).toEqual(["home", before[1].id, "stroke"]);
  });

  it("follows groups inside groups: a frame grouped twice over is not taken by the outer group", () => {
    const home = { ...frame("home", -20, -20, 1000, 500), groupIds: ["pair", "all"] };
    const before = [
      home,
      inside(node("terminal", 0, 0), "home"),
      { ...rectangle("mate", 1100, 0), groupIds: ["pair", "all"] },
      { ...rectangle("outer", 1100, 200), groupIds: ["all"] },
    ];
    // Excalidraw erases the outermost group of what it touches.
    expect(live(erase(before, [[1150, 250]]))).toEqual([]);
    const guarded = withEraser(before);
    expect(live(erase(guarded, [[1150, 250]]))).toEqual(["home", before[1].id, "mate", "outer"]);
    expect(live(erase(guarded, [[1150, 50]]))).toEqual(["home", before[1].id, "mate", "outer"]);
  });

  it("does not let a frame holding a drawing that is grouped with a node be taken with a group of its own", () => {
    const box = { ...frame("box", 0, 600, 400, 300), groupIds: ["h"] };
    const before = [
      { ...node("note", 0, 0), groupIds: ["g"] },
      box,
      { ...inside(rectangle("held", 50, 650, 100, 100), "box"), groupIds: ["g"] },
      { ...rectangle("beside", 500, 600), groupIds: ["h"] },
    ];
    // Unguarded, the frame goes with `beside`, and the drawing in it, which is the node's.
    expect(live(erase(before, [[550, 650]]))).toEqual([before[0].id]);
    const guarded = withEraser(before);
    expect(live(erase(guarded, [[550, 650]]))).toEqual(live(before));
  });

  it("still erases a drawing that is grouped with nothing the guard keeps, beside the ones it keeps", () => {
    const home = { ...frame("home", -20, -20, 1000, 500), groupIds: ["g"] };
    const before = [
      home,
      inside(node("terminal", 0, 0), "home"),
      { ...rectangle("stroke", 1100, 0), groupIds: ["g"] },
      rectangle("free", 1100, 200),
      { ...rectangle("one", 1100, 400), groupIds: ["pair"] },
      { ...rectangle("two", 1100, 600), groupIds: ["pair"] },
    ];
    const guarded = withEraser(before);
    expect(live(erase(guarded, [[1150, 250]]))).toEqual(["home", before[1].id, "stroke", "one", "two"]);
    // A group of drawings only goes whole, as it always did.
    expect(live(erase(guarded, [[1150, 450]]))).toEqual(["home", before[1].id, "stroke", "free"]);
    expect(live(erase(guarded, [[1050, 50], [1250, 700]]))).toEqual(["home", before[1].id, "stroke"]);
  });

  it.each<NodeKind>(["note", "kanban", "git", "file", "subagent"])("protects a %s node too", (kind) => {
    const before = withEraser([node(kind, 0, 0)]);
    expect(live(erase(before, [[10, 10]]))).toEqual([before[0].id]);
  });
});

describe("eraserGuard", () => {
  it("locks every node, marked, and leaves the drawings alone", () => {
    const [terminal, manager, drawn] = [node("terminal", 0, 0), node("fleet", 1000, 0), rectangle("drawn", 0, 600)];
    const next = eraserGuard([terminal, manager, drawn], true)!;
    expect(next.map((e) => e.locked)).toEqual([true, true, false]);
    expect(next.every((e, i) => (i < 2) === lockedByEraser(e))).toBe(true);
    expect(next[2]).toBe(drawn);
    expect(next[0].customData).toEqual({ kind: "terminal", eraserLock: true });
  });

  it("locks the frame that holds a node, and what is grouped with a node, not a frame without one", () => {
    const home = frame("home", 0, 0, 800, 500);
    const empty = frame("empty", 2000, 0, 100, 100);
    const grouped = { ...rectangle("mate", 900, 0), groupIds: ["g"] };
    const other = { ...rectangle("other", 900, 200), groupIds: ["h"] };
    const next = eraserGuard([home, inside(node("terminal", 0, 0), "home"), empty, grouped, { ...node("note", 1000, 0), groupIds: ["g"] }, other], true)!;
    // The frame, its terminal, the empty frame, the drawing grouped with a node, that node, a drawing in another group.
    expect(next.map((e) => e.locked)).toEqual([true, true, false, true, true, false]);
  });

  it("locks a chain of groups and frames to its end, in whatever order the scene lists them", () => {
    const scene = [
      { ...frame("home", 0, 0, 800, 500), groupIds: ["a"] },
      inside(node("terminal", 0, 0), "home"),
      { ...rectangle("first", 900, 0), groupIds: ["a", "b"] },
      { ...rectangle("second", 900, 200), groupIds: ["b", "c"] },
      { ...rectangle("third", 900, 400), groupIds: ["c"] },
      { ...rectangle("apart", 900, 600), groupIds: ["d"] },
      { ...rectangle("apart-too", 900, 800), groupIds: ["d"] },
      rectangle("free", 900, 1000),
    ];
    const lockedIds = (elements: readonly ExcalidrawElement[]) => (eraserGuard(elements, true) ?? elements).filter((e) => e.locked).map((e) => e.id);
    // Locked: the frame, its terminal, and each drawing the chain a → b → c reaches. Not the two groups apart, nor the loose drawing.
    const chain = ["home", scene[1].id, "first", "second", "third"];
    expect(lockedIds(scene).sort()).toEqual([...chain].sort());
    expect(lockedIds([...scene].reverse()).sort()).toEqual([...chain].sort());
  });

  it("locks the frame that holds what is locked, and what is grouped with that frame", () => {
    const scene = [
      { ...node("note", 0, 0), groupIds: ["g"] },
      { ...inside(rectangle("held", 50, 650), "box"), groupIds: ["g"] },
      { ...frame("box", 0, 600, 400, 300), groupIds: ["h"] },
      { ...rectangle("beside", 500, 600), groupIds: ["h"] },
      inside(rectangle("other", 100, 800, 50, 50), "box"),
    ];
    // The note, its groupmate, the frame the groupmate is in, the frame's own groupmate; a drawing in the frame alone is not touched.
    expect((eraserGuard(scene, true) ?? scene).map((e) => e.locked)).toEqual([true, true, true, true, false]);
  });

  it("is a no-op when nothing needs to change", () => {
    expect(eraserGuard([], true)).toBeNull();
    expect(eraserGuard([rectangle("drawn", 0, 0)], true)).toBeNull();
    expect(eraserGuard([node("terminal", 0, 0), rectangle("drawn", 0, 0)], false)).toBeNull();
    const locked = eraserGuard([node("terminal", 0, 0)], true)!;
    expect(eraserGuard(locked, true)).toBeNull();
  });

  it("gives everything back when the eraser goes: the lock and the mark", () => {
    const original = [node("terminal", 0, 0), node("fleet", 1000, 0), { ...rectangle("mate", 900, 0), groupIds: ["g"] }, { ...node("note", 0, 600), groupIds: ["g"] }];
    const released = eraserGuard(eraserGuard(original, true)!, false)!;
    expect(released.map((e) => e.locked)).toEqual([false, false, false, false]);
    expect(released.map((e) => e.customData)).toEqual([{ kind: "terminal" }, { kind: STORED_FLEET_KIND }, undefined, { kind: "note" }]);
    expect(released.some(lockedByEraser)).toBe(false);
    expect(eraserGuard(released, false)).toBeNull();
  });

  it("gives back exactly the locks it made, a frame and its groupmates included, and not one that was the user's", () => {
    const home = { ...frame("home", 0, 0, 800, 500), groupIds: ["a"] };
    const original = [
      home,
      inside(node("terminal", 0, 0), "home"),
      { ...rectangle("mate", 900, 0), groupIds: ["a"] },
      { ...rectangle("theirs", 900, 200), groupIds: ["a"], locked: true },
      { ...rectangle("apart", 900, 400), groupIds: ["d"] },
    ];
    const guarded = eraserGuard(original, true)!;
    expect(guarded.map(lockedByEraser)).toEqual([true, true, true, false, false]);
    expect(guarded.map((e) => e.locked)).toEqual([true, true, true, true, false]);
    const released = eraserGuard(guarded, false)!;
    expect(released.map((e) => e.locked)).toEqual(original.map((e) => e.locked));
    expect(released.map((e) => e.customData)).toEqual(original.map((e) => e.customData));
    expect(released.some(lockedByEraser)).toBe(false);
    expect(released[3]).toBe(guarded[3]);
    expect(eraserGuard(released, false)).toBeNull();
  });

  it("releases a scene that was saved or restored with the eraser's locks on", () => {
    const saved = eraserGuard([node("terminal", 0, 0)], true)!;
    expect(eraserGuard(saved, false)![0].locked).toBe(false);
  });

  it("does not touch a lock someone else set, and does not take it off", () => {
    const own = { ...node("terminal", 0, 0), locked: true };
    const guarded = eraserGuard([own], true);
    expect(guarded).toBeNull();
    expect(eraserGuard([own], false)).toBeNull();
  });

  it("keeps a folded group's terminals locked when the eraser goes", () => {
    const home = frame("home", 0, 0, 800, 500, true);
    const hidden = { ...inside(node("terminal", 0, 0), "home"), locked: true };
    const shown = inside(node("terminal", 900, 0), "home");
    const scene = [home, hidden, shown];
    const guarded = eraserGuard(scene, true)!;
    // The hidden one was locked already: only the frame and the one in view are the guard's.
    expect(guarded.map((e) => lockedByEraser(e))).toEqual([true, false, true]);
    // The group is unfolded and folded again meanwhile: the fold's locks and the guard's meet.
    const refolded = guarded.map((e) => (e.id === shown.id ? { ...e, locked: true } : e));
    const released = eraserGuard(refolded, false)!;
    expect(released.map((e) => e.locked)).toEqual([false, true, true]);
  });

  it("locks again a node an unfold unlocked while the eraser is still active", () => {
    const guarded = eraserGuard([node("terminal", 0, 0)], true)!;
    const unfolded = [{ ...guarded[0], locked: false }];
    const next = eraserGuard(unfolded, true)!;
    expect(next[0].locked).toBe(true);
    expect(eraserGuard(next, true)).toBeNull();
  });

  it("does not lock a node that is gone, and cleans the mark off one that left", () => {
    const gone = { ...node("terminal", 0, 0), isDeleted: true };
    expect(eraserGuard([gone], true)).toBeNull();
    const marked = { ...gone, locked: true, customData: { kind: "terminal", eraserLock: true } };
    expect(eraserGuard([marked], true)![0].customData).toEqual({ kind: "terminal" });
  });

  it("settles even when the mark is all that is left to remove", () => {
    const stray = { ...rectangle("stray", 0, 0), customData: { eraserLock: true } };
    const next = eraserGuard([stray], false)!;
    expect(next[0].customData).toBeUndefined();
    expect(eraserGuard(next, false)).toBeNull();
  });
});

describe("scheduling", () => {
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  });
  afterEach(() => {
    // Let a programmed frame go, so that no test starts with the previous one's "pending".
    frames.splice(0).forEach((callback) => callback(0));
    vi.unstubAllGlobals();
  });

  function fakeApi(elements: ExcalidrawElement[], tool: string) {
    const state = { activeTool: { type: tool } };
    const updateScene = vi.fn((data: { elements?: ExcalidrawElement[]; captureUpdate?: string }) => void (data.elements && (elements = data.elements)));
    const api = { getAppState: () => state, getSceneElementsIncludingDeleted: () => elements, updateScene } as unknown as ExcalidrawImperativeAPI;
    return { api, state, updateScene, elements: () => elements, set: (next: ExcalidrawElement[]) => void (elements = next) };
  }

  it("locks the nodes a frame after the eraser is picked, outside the undo history", () => {
    const fake = fakeApi([node("terminal", 0, 0)], "eraser");
    scheduleEraserGuard(fake.api, fake.elements(), true);
    expect(fake.updateScene).not.toHaveBeenCalled();
    frames.splice(0).forEach((callback) => callback(0));
    expect(fake.updateScene).toHaveBeenCalledTimes(1);
    expect(fake.updateScene.mock.calls[0][0].captureUpdate).toBe("never");
    expect(fake.elements()[0].locked).toBe(true);
  });

  it("reads the tool when the frame comes, not when it was asked for", () => {
    const fake = fakeApi([node("terminal", 0, 0)], "eraser");
    scheduleEraserGuard(fake.api, fake.elements(), true);
    fake.state.activeTool = { type: "selection" };
    frames.splice(0).forEach((callback) => callback(0));
    expect(fake.updateScene).not.toHaveBeenCalled();
  });

  it("programs nothing when there is nothing to change, and one frame at a time", () => {
    const fake = fakeApi([rectangle("drawn", 0, 0)], "eraser");
    scheduleEraserGuard(fake.api, fake.elements(), true);
    expect(frames).toHaveLength(0);
    const busy = fakeApi([node("terminal", 0, 0)], "eraser");
    scheduleEraserGuard(busy.api, busy.elements(), true);
    scheduleEraserGuard(busy.api, busy.elements(), true);
    expect(frames).toHaveLength(1);
  });

  // Excalidraw's undo writes an element's customData back whole: the mark goes, the lock (not in its delta) stays.
  describe("when an undo takes the mark off", () => {
    const sceneWithGroup = () => {
      const home = frame("home", 0, 0, 800, 500, true);
      return [home, inside({ ...node("terminal", 0, 0), locked: true }, "home")];
    };
    const unmarked = (elements: ExcalidrawElement[], original: ExcalidrawElement[]) => elements.map((e, i) => ({ ...e, customData: original[i].customData }));

    it("releases the lock all the same", () => {
      const original = sceneWithGroup();
      const fake = fakeApi(original, "eraser");
      scheduleEraserGuard(fake.api, fake.elements(), true);
      frames.splice(0).forEach((callback) => callback(0));
      expect(lockedByEraser(fake.elements()[0])).toBe(true);
      fake.set(unmarked(fake.elements(), original));
      expect(fake.elements()[0].locked).toBe(true);
      expect(lockedByEraser(fake.elements()[0])).toBe(false);
      releaseEraserLocks(fake.api);
      expect(fake.elements().map((e) => e.locked)).toEqual([false, true]);
      expect(fake.elements()[0].customData).toEqual(original[0].customData);
    });

    it("marks it again while the eraser is still active", () => {
      const original = sceneWithGroup();
      const fake = fakeApi(original, "eraser");
      scheduleEraserGuard(fake.api, fake.elements(), true);
      frames.splice(0).forEach((callback) => callback(0));
      fake.set(unmarked(fake.elements(), original));
      scheduleEraserGuard(fake.api, fake.elements(), true);
      frames.splice(0).forEach((callback) => callback(0));
      expect(lockedByEraser(fake.elements()[0])).toBe(true);
      releaseEraserLocks(fake.api);
      expect(fake.elements()[0].locked).toBe(false);
    });

    it("does not take a lock the guard never made", () => {
      const own = { ...rectangle("own", 0, 0), locked: true };
      const fake = fakeApi([own], "selection");
      releaseEraserLocks(fake.api);
      expect(fake.updateScene).not.toHaveBeenCalled();
    });
  });

  it("releases the nodes now: before a double-click selects one", () => {
    const fake = fakeApi(eraserGuard([node("terminal", 0, 0)], true)!, "eraser");
    releaseEraserLocks(fake.api);
    expect(fake.elements()[0].locked).toBe(false);
    expect(fake.updateScene.mock.calls[0][0].captureUpdate).toBe("never");
    releaseEraserLocks(fake.api);
    expect(fake.updateScene).toHaveBeenCalledTimes(1);
  });
});
