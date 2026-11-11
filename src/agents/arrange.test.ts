import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { arrangedElements, columnOrder, readingOrder, type ArrangeInput } from "./arrange";
import { COLUMN_GAP, GROUP_GAP, NODE_GAP, PADDING, PADDING_BOTTOM, PADDING_TOP, ROW_GAP } from "./groupLayout";

const W = 720;
const H = 440;

const node = (id: string, x: number, y: number, fields: Record<string, unknown> = {}) =>
  ({
    id,
    type: "embeddable",
    x,
    y,
    width: W,
    height: H,
    isDeleted: false,
    frameId: null,
    version: 1,
    link: `dummyplane://terminal/${id}`,
    customData: { kind: "terminal" },
    ...fields,
  }) as unknown as ExcalidrawElement;

const frame = (id: string, x: number, y: number, width: number, height: number, fields: Record<string, unknown> = {}) =>
  ({
    id,
    type: "frame",
    x,
    y,
    width,
    height,
    isDeleted: false,
    frameId: null,
    version: 1,
    customData: { dummyplane: { kind: "group", role: "general", pantheon: "olympus" } },
    ...fields,
  }) as unknown as ExcalidrawElement;

const shape = (id: string, x: number, y: number, fields: Record<string, unknown> = {}) =>
  ({ id, type: "rectangle", x, y, width: 50, height: 50, isDeleted: false, frameId: null, version: 1, ...fields }) as unknown as ExcalidrawElement;

const input = (elements: ExcalidrawElement[], rest: Partial<ArrangeInput> = {}): ArrangeInput => ({
  elements,
  parentOf: () => null,
  isMinimized: () => false,
  aspect: 16 / 10,
  ...rest,
});

const at = (result: ReturnType<typeof arrangedElements>, id: string) => {
  const e = result!.elements.find((el) => el.id === id)!;
  return { x: e.x, y: e.y, width: e.width, height: e.height };
};

describe("readingOrder and columnOrder", () => {
  const r = (x: number, y: number, h = 100) => ({ x, y, width: 100, height: h });
  it("reads rows top to bottom, each left to right, a little out of line still in its row", () => {
    const items = [r(500, 10), r(0, 300), r(0, 0), r(250, 40)];
    expect(readingOrder(items, (i) => i)).toEqual([r(0, 0), r(250, 40), r(500, 10), r(0, 300)]);
  });
  it("reads columns left to right, each top to bottom", () => {
    const items = [r(300, 0), r(0, 200), r(0, 0)];
    expect(columnOrder(items, (i) => i)).toEqual([r(0, 0), r(0, 200), r(300, 0)]);
  });
});

describe("arrangedElements", () => {
  it("packs loose terminals into a grid near the view's shape, from where the first one stood", () => {
    const elements = [node("a", 100, 100), node("b", 3000, 120), node("c", 50, 2000), node("d", 4000, 2600)];
    const result = arrangedElements(input(elements));
    expect(result).not.toBeNull();
    // Reading order a, b (first row), c, d; four 720x440 terminals take two rows of two.
    expect(at(result, "a")).toMatchObject({ x: 50, y: 100 });
    expect(at(result, "b")).toMatchObject({ x: 50 + W + NODE_GAP, y: 100 });
    expect(at(result, "c")).toMatchObject({ x: 50, y: 100 + H + ROW_GAP });
    expect(at(result, "d")).toMatchObject({ x: 50 + W + NODE_GAP, y: 100 + H + ROW_GAP });
    expect(result!.movedNodeIds).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("moves nothing a second time: an arranged canvas reads back in its own order", () => {
    const first = arrangedElements(input([node("a", 0, 0), node("b", 2000, 900), node("c", -300, 4000), node("d", 900, 30), node("e", 10, 10)]));
    expect(arrangedElements(input(first!.elements))).toBeNull();
  });

  it("gathers minimized terminals as tabs in a row of their own under the rest", () => {
    const tab = (id: string, x: number, y: number) => node(id, x, y, { width: 280, height: 68 });
    const elements = [node("a", 0, 0), tab("m1", 5000, -500), node("b", 900, 0), tab("m2", 100, 9000)];
    const minimized = new Set(["m1", "m2"]);
    const result = arrangedElements(input(elements, { isMinimized: (id) => minimized.has(id) }));
    // The tabs wait for the full terminals, even m1 which stood highest.
    expect(at(result, "a")).toMatchObject({ x: 0, y: -500 });
    expect(at(result, "b")).toMatchObject({ x: W + NODE_GAP, y: -500 });
    const tabsTop = -500 + H + ROW_GAP;
    expect(at(result, "m1")).toMatchObject({ x: 0, y: tabsTop, width: 280 });
    expect(at(result, "m2")).toMatchObject({ x: 280 + NODE_GAP, y: tabsTop });
  });

  it("moves a group whole, frame, members and drawings in it, and tidies its members into its grid", () => {
    const g = frame("g", 0, 0, 3000, 1500);
    const elements = [
      node("loose", 4000, 0),
      node("m2", 1500, 700, { frameId: "g" }),
      node("m1", 40, 60, { frameId: "g" }),
      shape("note", 200, 1300, { frameId: "g" }),
      g,
    ];
    const result = arrangedElements(input(elements));
    // In the group: m1 then m2, one column, the frame fitted around them.
    const group = at(result, "g");
    expect(group).toMatchObject({ width: 2 * PADDING + W, height: PADDING_TOP + 2 * H + ROW_GAP + PADDING_BOTTOM });
    expect(at(result, "m1")).toMatchObject({ x: group.x + PADDING, y: group.y + PADDING_TOP });
    expect(at(result, "m2")).toMatchObject({ x: group.x + PADDING, y: group.y + PADDING_TOP + H + ROW_GAP });
    // The group first in reading order, the loose terminal beside it, a group's gap apart.
    expect(group).toMatchObject({ x: 0, y: 0 });
    expect(at(result, "loose")).toMatchObject({ x: group.width + GROUP_GAP, y: 0 });
    // The drawing in the frame went with it: the frame did not move, so neither did it.
    expect(at(result, "note")).toMatchObject({ x: 200, y: 1300 });
  });

  it("moves the drawings a frame holds by as much as the frame", () => {
    const g = frame("g", 5000, 0, 2 * PADDING + W, PADDING_TOP + H + PADDING_BOTTOM);
    const elements = [node("first", 0, 0), node("m", 5000 + PADDING, PADDING_TOP, { frameId: "g" }), shape("s", 5100, 10, { frameId: "g" }), g];
    const result = arrangedElements(input(elements));
    const group = at(result, "g");
    expect(group.x).toBe(W + GROUP_GAP);
    expect(at(result, "s")).toMatchObject({ x: 5100 + group.x - 5000, y: 10 });
    expect(at(result, "m")).toMatchObject({ x: group.x + PADDING, y: PADDING_TOP });
  });

  it("leaves a folded group's members where they are", () => {
    const g = frame("g", 0, 0, 3000, 1500, { customData: { dummyplane: { kind: "group", role: "general", pantheon: "olympus", folded: true } } });
    const elements = [node("m1", 1500, 700, { frameId: "g" }), node("m2", 40, 60, { frameId: "g" }), g];
    expect(arrangedElements(input(elements))).toBeNull();
  });

  it("keeps a spawn tree's flowchart: the tree moves as one block", () => {
    const parents: Record<string, string> = { child: "root" };
    const elements = [node("x", 0, 0), node("root", 3000, 2000), node("child", 3000 + W + GROUP_GAP, 2000)];
    const result = arrangedElements(input(elements, { parentOf: (id) => parents[id] ?? null }));
    const root = at(result, "root");
    const child = at(result, "child");
    expect(child.x - root.x).toBe(W + GROUP_GAP);
    expect(child.y).toBe(root.y);
  });

  it("arranges only the selection when it holds two blocks or more, and everything when it holds one", () => {
    const elements = [node("a", 0, 0), node("b", 5000, 0), node("c", 0, 5000)];
    const some = arrangedElements(input(elements, { only: ["a", "b"] }));
    expect(at(some, "b")).toMatchObject({ x: W + NODE_GAP, y: 0 });
    expect(at(some, "c")).toMatchObject({ x: 0, y: 5000 });
    const all = arrangedElements(input(elements, { only: ["a"] }));
    expect(at(all, "c").y).toBeLessThan(5000);
  });

  it("tidies only inside a group when the selection is that group or some of its members", () => {
    const g = frame("g", 0, 0, 3000, 1500);
    const elements = [node("m1", 1500, 700, { frameId: "g" }), node("m2", 40, 60, { frameId: "g" }), g, node("far", 9000, 9000)];
    const result = arrangedElements(input(elements, { only: ["m1"] }));
    expect(at(result, "m2")).toMatchObject({ x: PADDING, y: PADDING_TOP });
    expect(at(result, "far")).toMatchObject({ x: 9000, y: 9000 });
  });

  it("puts a group's tabs in a row under its grid", () => {
    const tab = (id: string, x: number, y: number) => node(id, x, y, { width: 280, height: 68, frameId: "g" });
    const g = frame("g", 0, 0, 3000, 3000);
    const elements = [node("m1", 40, 60, { frameId: "g" }), tab("t1", 900, 900), tab("t2", 100, 2000), g];
    const result = arrangedElements(input(elements, { isMinimized: (id) => id.startsWith("t") }));
    const tabsTop = PADDING_TOP + H + ROW_GAP;
    expect(at(result, "t1")).toMatchObject({ x: PADDING, y: tabsTop });
    // The grid is one terminal wide (720): two tabs fit side by side.
    expect(at(result, "t2")).toMatchObject({ x: PADDING + 280 + COLUMN_GAP, y: tabsTop });
    expect(at(result, "g").height).toBe(PADDING_TOP + H + ROW_GAP + 68 + PADDING_BOTTOM);
  });

  it("ignores deleted elements and leaves the scene alone when there is nothing to move", () => {
    expect(arrangedElements(input([node("a", 0, 0)]))).toBeNull();
    expect(arrangedElements(input([node("a", 0, 0), node("gone", 5000, 5000, { isDeleted: true })]))).toBeNull();
  });
});
