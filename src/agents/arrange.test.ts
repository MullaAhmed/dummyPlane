import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { arrangedElements, columnOrder, readingOrder, type ArrangeInput } from "./arrange";
import { ARRANGE_LAYOUTS, columnHeightsOf, type ArrangeLayout } from "./arrangeLayout";
import { anchorsOf } from "./attachments";
import { COLUMN_GAP, GROUP_GAP, MAX_ROWS, NODE_GAP, overlap, PADDING, PADDING_BOTTOM, PADDING_TOP, ROW_GAP } from "./groupLayout";

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
    // In the group: m1 then m2, one column; the drawing in a row under them; the frame fitted around them all.
    const group = at(result, "g");
    const drawingsTop = PADDING_TOP + 2 * H + ROW_GAP + ROW_GAP;
    expect(group).toMatchObject({ width: 2 * PADDING + W, height: drawingsTop + 50 + PADDING_BOTTOM });
    expect(at(result, "m1")).toMatchObject({ x: group.x + PADDING, y: group.y + PADDING_TOP });
    expect(at(result, "m2")).toMatchObject({ x: group.x + PADDING, y: group.y + PADDING_TOP + H + ROW_GAP });
    // The group first in reading order, the loose terminal beside it, a group's gap apart.
    expect(group).toMatchObject({ x: 0, y: 0 });
    expect(at(result, "loose")).toMatchObject({ x: group.width + GROUP_GAP, y: 0 });
    // Before, a drawing in a group stayed where it was; now it is one of the members laid out.
    expect(at(result, "note")).toMatchObject({ x: group.x + PADDING, y: group.y + drawingsTop });
  });

  it("moves the drawings a frame drawn by hand holds by as much as the frame", () => {
    // A plain frame: nothing in it is laid out again (a group's drawings now are, see above).
    const g = frame("g", 5000, 0, 2 * PADDING + W, PADDING_TOP + H + PADDING_BOTTOM, { customData: undefined });
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

const geometry = (result: ReturnType<typeof arrangedElements>) => result!.elements.map((e) => ({ id: e.id, ...at(result, e.id) }));

describe("arrange layouts", () => {
  /** Five loose terminals, out of place; reading order a, b (first row), c, d, e; the first stood at (50, 100). */
  const loose = () => [node("a", 100, 100), node("b", 3000, 120), node("c", 50, 2000), node("d", 4000, 2600), node("e", 7000, 5000)];
  const ids = ["a", "b", "c", "d", "e"];
  const slot = (column: number, row: number) => ({ x: 50 + column * (W + NODE_GAP), y: 100 + row * (H + ROW_GAP) });

  /** Each layout but the grid: the column and row of the i-th block in reading order. */
  const canvasCells: [ArrangeLayout, (i: number) => [number, number]][] = [
    ["row", (i) => [i, 0]],
    ["column", (i) => [0, i]],
    ["columns-2", (i) => [i % 2, Math.floor(i / 2)]],
    ["columns-3", (i) => [i % 3, Math.floor(i / 3)]],
    ["columns-4", (i) => [i % 4, Math.floor(i / 4)]],
  ];

  for (const [layout, cell] of canvasCells) {
    it(`lays loose terminals out in ${layout}, whatever the view's shape, from where the first one stood`, () => {
      for (const aspect of [16 / 10, 1 / 3, 6]) {
        const result = arrangedElements(input(loose(), { layout, aspect }));
        ids.forEach((id, i) => expect(at(result, id), `${layout} ${aspect} ${id}`).toMatchObject(slot(...cell(i))));
      }
    });
  }

  /** A group of five terminals, about one column out of place (m1 to m5 top to bottom), alone on the canvas. */
  const group = () => [frame("g", 0, 0, 3000, 3000), ...[1, 2, 3, 4, 5].map((i) => node(`m${i}`, 40 + (i % 2) * 7, 60 + (i - 1) * 560, { frameId: "g" }))];
  const memberCell = (column: number, row: number) => ({ x: PADDING + column * (W + COLUMN_GAP), y: PADDING_TOP + row * (H + ROW_GAP) });

  /** Each layout: the column and row of m1 to m5 in the group's grid, filled top to bottom then left to right. */
  const groupCells: Record<ArrangeLayout, [number, number][]> = {
    grid: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
    ],
    row: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ],
    column: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ],
    "columns-2": [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ],
    "columns-3": [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
    ],
    "columns-4": [
      [0, 0],
      [0, 1],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
    // Five members nothing joins: five roots side by side, in rows packed to the view's shape.
    tree: [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
  };

  for (const layout of ARRANGE_LAYOUTS) {
    it(`gives a group's grid the ${layout} layout and fits the frame to it`, () => {
      const result = arrangedElements(input(group(), { layout }));
      const cells = groupCells[layout];
      cells.forEach(([column, row], i) => expect(at(result, `m${i + 1}`), `${layout} m${i + 1}`).toMatchObject(memberCell(column, row)));
      const columns = Math.max(...cells.map(([c]) => c)) + 1;
      const rows = Math.max(...cells.map(([, r]) => r)) + 1;
      expect(at(result, "g")).toEqual({
        x: 0,
        y: 0,
        width: 2 * PADDING + columns * W + (columns - 1) * COLUMN_GAP,
        height: PADDING_TOP + rows * H + (rows - 1) * ROW_GAP + PADDING_BOTTOM,
      });
    });
  }

  it("cuts a group's columns: the grid's of MAX_ROWS, one row, one column, or N as even as they go", () => {
    // The grid, as before: columns of MAX_ROWS, the last one shorter.
    for (let count = 1; count <= 13; count++) {
      const rows = Math.min(count, MAX_ROWS);
      const before = Array.from({ length: Math.ceil(count / rows) }, (_, c) => Math.min(rows, count - c * rows));
      expect(columnHeightsOf(count, "grid", MAX_ROWS)).toEqual(before);
    }
    expect(columnHeightsOf(5, "row", MAX_ROWS)).toEqual([1, 1, 1, 1, 1]);
    expect(columnHeightsOf(5, "column", MAX_ROWS)).toEqual([5]);
    // N columns as soon as there are N pieces: 9 in 4 columns, not 3 of 3; 4 in 3 columns, not 2 of 2.
    expect(columnHeightsOf(9, "columns-4", MAX_ROWS)).toEqual([3, 2, 2, 2]);
    expect(columnHeightsOf(4, "columns-3", MAX_ROWS)).toEqual([2, 1, 1]);
    expect(columnHeightsOf(2, "columns-4", MAX_ROWS)).toEqual([1, 1]);
    for (const layout of ARRANGE_LAYOUTS) {
      expect(columnHeightsOf(0, layout, MAX_ROWS)).toEqual([]);
      for (let count = 1; count <= 13; count++) {
        const heights = columnHeightsOf(count, layout, MAX_ROWS);
        expect(
          heights.reduce((a, b) => a + b, 0),
          `${layout} ${count}`,
        ).toBe(count);
        expect(heights.every((h) => h >= 1)).toBe(true);
      }
    }
  });

  /** Loose terminals, a group of five with a tab in it, loose tabs, a spawn tree and a drawing outside frames, all out of place. */
  function mixed(): { elements: ExcalidrawElement[]; rest: Partial<ArrangeInput> } {
    const tab = (id: string, x: number, y: number, fields: Record<string, unknown> = {}) => node(id, x, y, { width: 280, height: 68, ...fields });
    const parents: Record<string, string> = { kid: "root" };
    return {
      elements: [
        ...loose(),
        frame("g", 9000, 0, 3000, 3000),
        ...[1, 2, 3, 4, 5].map((i) => node(`m${i}`, 9040, 60 + (i - 1) * 560, { frameId: "g" })),
        tab("tg", 9500, 2850, { frameId: "g" }),
        tab("t1", 500, 8000),
        tab("t2", 12000, -300),
        tab("t3", 3000, 9000),
        node("root", 15000, 0),
        node("kid", 15000 + W + GROUP_GAP, 300),
        shape("s", -4000, -4000),
      ],
      rest: { isMinimized: (id) => id.startsWith("t"), parentOf: (id) => parents[id] ?? null },
    };
  }

  for (const layout of ARRANGE_LAYOUTS) {
    it(`moves nothing a second time in the ${layout} layout`, () => {
      for (const aspect of [16 / 10, 1 / 2, 4]) {
        const { elements, rest } = mixed();
        const first = arrangedElements(input(elements, { ...rest, layout, aspect }));
        expect(first, `${layout} ${aspect}`).not.toBeNull();
        expect(arrangedElements(input(first!.elements, { ...rest, layout, aspect })), `${layout} ${aspect}`).toBeNull();
      }
    });
  }

  it("leaves no block over another on the whole canvas, in every layout: Arrange of everything, and Auto-arrange, lay every block out", () => {
    for (const layout of ARRANGE_LAYOUTS) {
      for (const aspect of [16 / 10, 1 / 2, 4]) {
        const { elements, rest } = mixed();
        const result = arrangedElements(input(elements, { ...rest, layout, aspect }));
        // Every node and frame outside frames (the drawing s, outside frames, stays where it is, as ever).
        const top = result!.elements.filter((e) => e.frameId === null && (e.type === "frame" || e.customData?.kind !== undefined));
        for (const a of top) for (const b of top) if (a !== b) expect(overlap(a, b), `${layout} ${aspect} ${a.id} ${b.id}`).toBe(0);
      }
    }
  });

  it("lays the grid out as before: the grid asked for is the default", () => {
    const { elements, rest } = mixed();
    for (const aspect of [16 / 10, 1 / 2, 4]) {
      expect(geometry(arrangedElements(input(elements, { ...rest, layout: "grid", aspect })))).toEqual(geometry(arrangedElements(input(elements, { ...rest, aspect }))));
    }
    // The default, pinned: four loose terminals in two rows of two at 16:10 (as in "packs loose terminals into a grid").
    const four = arrangedElements(input(loose().slice(0, 4), { layout: "grid" }));
    expect(at(four, "d")).toMatchObject({ x: 50 + W + NODE_GAP, y: 100 + H + ROW_GAP });
  });

  it("keeps the tabs in rows under the rest, as wide as it", () => {
    const tab = (id: string, x: number, y: number) => node(id, x, y, { width: 280, height: 68 });
    const elements = [...loose().slice(0, 2), tab("t1", 5000, -500), tab("t2", 100, 9000), tab("t3", 200, 9500)];
    const result = arrangedElements(input(elements, { layout: "column", isMinimized: (id) => id.startsWith("t") }));
    // One column of terminals, 720 wide, from the corner of all that stood (x 100 of a and t2, y -500 of t1): two tabs side by side under it, the third under them.
    const tabsTop = -500 + 2 * H + ROW_GAP + ROW_GAP;
    expect(at(result, "a")).toMatchObject({ x: 100, y: -500 });
    expect(at(result, "b")).toMatchObject({ x: 100, y: -500 + H + ROW_GAP });
    expect(at(result, "t1")).toMatchObject({ x: 100, y: tabsTop });
    expect(at(result, "t2")).toMatchObject({ x: 100 + 280 + NODE_GAP, y: tabsTop });
    expect(at(result, "t3")).toMatchObject({ x: 100, y: tabsTop + 68 + ROW_GAP });
  });
});

describe("arrange scope", () => {
  const elements = () => [node("a", 0, 0), node("b", 5000, 0), node("c", 0, 5000), shape("s", 9000, 9000)];

  it("arranges the whole canvas when asked to, whatever is selected", () => {
    const all = arrangedElements(input(elements()));
    for (const only of [["a", "b"], ["a"], [], ["s"]]) {
      expect(geometry(arrangedElements(input(elements(), { only, scope: "canvas" }))), only.join()).toEqual(geometry(all));
    }
  });

  it("arranges the selection alone when asked to, never falling back to the whole canvas", () => {
    const some = arrangedElements(input(elements(), { only: ["a", "b"], scope: "selection" }));
    expect(at(some, "b")).toMatchObject({ x: W + NODE_GAP, y: 0 });
    expect(at(some, "c")).toMatchObject({ x: 0, y: 5000 });
    // One block, nothing, or drawings outside groups alone: nothing to arrange, nothing moves (in `auto`, the whole canvas would).
    for (const only of [["a"], [], ["s"]]) {
      expect(arrangedElements(input(elements(), { only, scope: "selection" })), only.join()).toBeNull();
      expect(arrangedElements(input(elements(), { only, scope: "auto" })), only.join()).not.toBeNull();
    }
  });

  it("tidies inside a group when the selection asked for is that group or some of its members", () => {
    const scene = [node("m1", 1500, 700, { frameId: "g" }), node("m2", 40, 60, { frameId: "g" }), frame("g", 0, 0, 3000, 1500), node("far", 9000, 9000)];
    for (const only of [["m1"], ["g"]]) {
      const result = arrangedElements(input(scene, { only, scope: "selection" }));
      expect(at(result, "m2"), only.join()).toMatchObject({ x: PADDING, y: PADDING_TOP });
      expect(at(result, "far"), only.join()).toMatchObject({ x: 9000, y: 9000 });
    }
  });

  it("arranges as before when no scope is given", () => {
    for (const only of [["a", "b"], ["a"], []]) {
      expect(geometry(arrangedElements(input(elements(), { only, scope: "auto" }))), only.join()).toEqual(geometry(arrangedElements(input(elements(), { only }))));
    }
  });
});

describe("a group's Arrange makes room", () => {
  /** A group of four terminals in the grid's one column, as the grid leaves it, its corner at (0, 0). */
  const columnWidth = 2 * PADDING + W;
  const columnHeight = PADDING_TOP + 4 * H + 3 * ROW_GAP + PADDING_BOTTOM;
  const column = () => [frame("g", 0, 0, columnWidth, columnHeight), ...[0, 1, 2, 3].map((i) => node(`m${i}`, PADDING, PADDING_TOP + i * (H + ROW_GAP), { frameId: "g" }))];
  /** The frame "One row" makes of the same four. */
  const rowWidth = 2 * PADDING + 4 * W + 3 * COLUMN_GAP;
  const rowHeight = PADDING_TOP + H + PADDING_BOTTOM;
  /** The same four already in one row. */
  const row = () => [frame("g", 0, 0, rowWidth, rowHeight), ...[0, 1, 2, 3].map((i) => node(`m${i}`, PADDING + i * (W + COLUMN_GAP), PADDING_TOP, { frameId: "g" }))];

  /** A quick note beside `host`, as src/nodes/note writes it. */
  const quickNote = (id: string, host: string, x: number, y: number) =>
    node(id, x, y, { width: 280, height: 200, link: `dummyplane://note/${id}`, customData: { kind: "note", note: { of: host, x: "right", dx: 16, y: "top", dy: 0 } } });
  /** An item attached to `anchor` (`customData.attachedTo`), as an output is to its agent: it moves with it, and nothing re-seats it afterwards. */
  const attachedItem = (id: string, anchor: string, x: number, y: number) =>
    node(id, x, y, { width: 560, height: 520, link: `dummyplane://output/${id}`, customData: { kind: "output", attachedTo: anchor } });

  /** The group's Arrange (its frame's ring, or the group selected): `only` the group. */
  const arrange = (elements: ExcalidrawElement[], rest: Partial<ArrangeInput> = {}) => arrangedElements(input(elements, { attachedTo: anchorsOf(elements), only: ["g"], ...rest }));
  const offset = (result: ReturnType<typeof arrangedElements>, a: string, b: string) => ({ x: at(result, b).x - at(result, a).x, y: at(result, b).y - at(result, a).y });
  /** `element` left as it was: the very same object, not a moved copy. */
  const same = (result: ReturnType<typeof arrangedElements>, element: ExcalidrawElement) => expect(result!.elements.find((e) => e.id === element.id), element.id).toBe(element);

  it("pushes a neighbour the One-row frame now covers out of its way, with its quick note and its output", () => {
    const below = node("below", 0, columnHeight + GROUP_GAP);
    const elements = [
      ...column(),
      node("n", columnWidth + GROUP_GAP, 0),
      quickNote("q", "n", columnWidth + GROUP_GAP + W + 16, 0),
      attachedItem("o", "n", columnWidth + GROUP_GAP, H + ROW_GAP),
      below,
    ];
    const result = arrange(elements, { layout: "row" });
    const g = at(result, "g");
    expect(g).toEqual({ x: 0, y: 0, width: rowWidth, height: rowHeight });
    // Clear of the grown frame, on the side it stood, by the gap canvas Arrange keeps beside a group (more than NODE_GAP).
    const n = at(result, "n");
    expect(n.x - (g.x + g.width)).toBeGreaterThanOrEqual(NODE_GAP);
    expect(n).toMatchObject({ x: rowWidth + GROUP_GAP, y: 0 });
    // What is attached to it went with it.
    expect(offset(result, "n", "o")).toEqual({ x: 0, y: H + ROW_GAP });
    expect(offset(result, "n", "q")).toEqual({ x: W + 16, y: 0 });
    for (const id of ["n", "q", "o"]) expect(overlap(at(result, id), g), id).toBe(0);
    expect(result!.movedNodeIds.has("n")).toBe(true);
    // The row frame is shorter than the column was: what stood under it is in nobody's way.
    same(result, below);
  });

  it("leaves a neighbour the frame does not reach exactly where it stands", () => {
    const below = node("below", 0, columnHeight + GROUP_GAP);
    const beyond = node("beyond", rowWidth + 10, 0);
    const result = arrange([...column(), below, beyond], { layout: "row" });
    expect(at(result, "g")).toMatchObject({ width: rowWidth, height: rowHeight });
    same(result, below);
    same(result, beyond);
    expect(result!.movedNodeIds.has("beyond")).toBe(false);
  });

  it("gives the grid layout today's result: a frame that grew into nothing moves nothing else", () => {
    // Four terminals out of place in a big frame, about one column (m0 to m3 top to bottom); the grid makes it a column, narrower and shorter.
    const messy = () => [
      frame("g", 0, 0, 3000, 3000),
      node("m0", 40, 60, { frameId: "g" }),
      node("m1", 100, 900, { frameId: "g" }),
      node("m2", 60, 1500, { frameId: "g" }),
      node("m3", 150, 2400, { frameId: "g" }),
    ];
    const right = node("right", 3000 + GROUP_GAP, 0);
    // A loose terminal the frame already covered part of: the column covers less of it, so it stays, as today.
    const over = node("over", columnWidth - 100, 1000);
    const alone = arrange(messy(), { layout: "grid" });
    const result = arrange([...messy(), right, over], { layout: "grid" });
    expect(at(result, "g")).toEqual({ x: 0, y: 0, width: columnWidth, height: columnHeight });
    [0, 1, 2, 3].forEach((i) => expect(at(result, `m${i}`)).toMatchObject({ x: PADDING, y: PADDING_TOP + i * (H + ROW_GAP) }));
    expect(geometry(result).filter((e) => e.id !== "right" && e.id !== "over")).toEqual(geometry(alone));
    same(result, right);
    same(result, over);
    expect(result!.movedNodeIds).toEqual(new Set(["g", "m0", "m1", "m2", "m3"]));
  });

  it("moves nothing the second time, in every layout", () => {
    for (const layout of ARRANGE_LAYOUTS) {
      for (const [name, start, width, height] of [
        ["column", column, columnWidth, columnHeight],
        ["row", row, rowWidth, rowHeight],
      ] as const) {
        // Beside the frame: a terminal with its quick note, then another one; under it, a third.
        const elements = [
          ...start(),
          node("n", width + GROUP_GAP, 0),
          quickNote("q", "n", width + GROUP_GAP + W + 16, 0),
          node("c", width + GROUP_GAP + W + 16 + 280 + NODE_GAP, 0),
          node("d", 0, height + GROUP_GAP),
        ];
        const first = arrange(elements, { layout });
        expect(arrange(first ? first.elements : elements, { layout }), `${layout} from a ${name}`).toBeNull();
      }
    }
  });

  it("pushes on down the chain: a pushed neighbour pushes the one it lands on, the same way", () => {
    // b stands beside the column; c past where the row frame ends, which the frame never reaches: b lands on it.
    const b = node("b", columnWidth + GROUP_GAP, 0);
    const c = node("c", rowWidth + 100, 0);
    const dx = rowWidth + GROUP_GAP + W + NODE_GAP + W + 200;
    const d = node("d", dx, 0);
    const result = arrange([...column(), b, c, d], { layout: "row" });
    expect(at(result, "b")).toMatchObject({ x: rowWidth + GROUP_GAP, y: 0 });
    // Right of b, as it stood, a node's gap from it (two lone terminals: NODE_GAP, as canvas Arrange keeps them).
    expect(at(result, "c")).toMatchObject({ x: rowWidth + GROUP_GAP + W + NODE_GAP, y: 0 });
    // d is in nobody's way once c has moved: it stays.
    same(result, d);
  });

  it("keeps the order and the gaps of a row of neighbours it covers", () => {
    const xs = [0, 1, 2].map((i) => columnWidth + GROUP_GAP + i * (W + NODE_GAP));
    const result = arrange([...column(), ...xs.map((x, i) => node(`r${i}`, x, 0))], { layout: "row" });
    [0, 1, 2].forEach((i) => expect(at(result, `r${i}`), `r${i}`).toMatchObject({ x: rowWidth + GROUP_GAP + i * (W + NODE_GAP), y: 0 }));
  });

  it("pushes down what stands under a frame One column makes taller, and leaves what stood beside it", () => {
    const under = node("under", 0, rowHeight + GROUP_GAP);
    const beside = node("beside", rowWidth + GROUP_GAP, 0);
    const result = arrange([...row(), under, beside], { layout: "column" });
    expect(at(result, "g")).toEqual({ x: 0, y: 0, width: columnWidth, height: columnHeight });
    expect(at(result, "under")).toMatchObject({ x: 0, y: columnHeight + GROUP_GAP });
    same(result, beside);
  });

  it("makes room for an output that rides right with the frame's side, as well as for the frame", () => {
    // m0's output stands right of the frame, outside it: it goes right as far as the frame grows, and lands where n stood beyond it.
    const ox = columnWidth + GROUP_GAP;
    const nx = ox + 560 + GROUP_GAP;
    const elements = [...column(), attachedItem("o", "m0", ox, 0), node("n", nx, 0)];
    const result = arrange(elements, { layout: "row" });
    const g = at(result, "g");
    expect(at(result, "o")).toMatchObject({ x: ox + rowWidth - columnWidth, y: 0 });
    // n stood right of the output: right of it again, a group's gap from it (the output is the group's).
    expect(at(result, "n")).toMatchObject({ x: at(result, "o").x + 560 + GROUP_GAP, y: 0 });
    for (const id of ["o", "n"]) expect(overlap(at(result, id), g), id).toBe(0);
    expect(overlap(at(result, "n"), at(result, "o"))).toBe(0);
    expect(arrange(result!.elements, { layout: "row" })).toBeNull();
  });

  it("settles a pile of neighbours the frame grows over: all clear of it, none covering more of another than before", () => {
    // A pile the user left beside the column, each terminal on the one before it.
    const pile = [0, 1, 2, 3, 4].map((i) => node(`p${i}`, columnWidth + GROUP_GAP + 10 * i, 10 * i));
    const result = arrange([...column(), ...pile], { layout: "row" });
    const g = at(result, "g");
    for (const p of pile) expect(overlap(at(result, p.id), g), p.id).toBe(0);
    for (const p of pile) for (const q of pile) if (p !== q) expect(overlap(at(result, p.id), at(result, q.id)), `${p.id} ${q.id}`).toBeLessThanOrEqual(overlap(p, q));
    expect(at(result, "p0")).toMatchObject({ x: rowWidth + GROUP_GAP, y: 0 });
    expect(arrange(result!.elements, { layout: "row" })).toBeNull();
  });

  it("moves another group it covers whole: its frame, its members and the drawings in it", () => {
    const hx = columnWidth + GROUP_GAP;
    const elements = [
      ...column(),
      frame("h", hx, 0, 2 * PADDING + W, PADDING_TOP + H + ROW_GAP + 50 + PADDING_BOTTOM),
      node("h1", hx + PADDING, PADDING_TOP, { frameId: "h" }),
      shape("hs", hx + PADDING, PADDING_TOP + H + ROW_GAP, { frameId: "h" }),
    ];
    const result = arrange(elements, { layout: "row" });
    const dx = rowWidth + GROUP_GAP - hx;
    expect(at(result, "h")).toMatchObject({ x: hx + dx, y: 0 });
    expect(at(result, "h1")).toMatchObject({ x: hx + PADDING + dx, y: PADDING_TOP });
    expect(at(result, "hs")).toMatchObject({ x: hx + PADDING + dx, y: PADDING_TOP + H + ROW_GAP });
    expect(result!.movedNodeIds).toEqual(new Set(["m1", "m2", "m3", "g", "h", "h1"]));
  });
});

describe("Arrange of a selection makes room", () => {
  /** Three terminals one under the other at x 0, a terminal beside the first, and one far off; reading order a, u, b, c. */
  const scene = () => [node("a", 0, 0), node("b", 0, H + ROW_GAP), node("c", 0, 2 * (H + ROW_GAP)), node("u", W + GROUP_GAP, 0), node("far", 9000, 9000)];
  const same = (result: ReturnType<typeof arrangedElements>, id: string, elements: readonly ExcalidrawElement[]) =>
    expect(result!.elements.find((e) => e.id === id), id).toBe(elements.find((e) => e.id === id));

  for (const scope of ["auto", "selection"] as const) {
    it(`pushes the terminal left out that One row now covers past the row, a node's gap from it (${scope})`, () => {
      const elements = scene();
      const result = arrangedElements(input(elements, { only: ["a", "b", "c"], scope, layout: "row" }));
      [0, 1, 2].forEach((i) => expect(at(result, "abc"[i])).toMatchObject({ x: i * (W + NODE_GAP), y: 0 }));
      // It stood right of them: it goes right, past c, the last one to cover it.
      expect(at(result, "u")).toMatchObject({ x: 3 * (W + NODE_GAP), y: 0 });
      same(result, "far", elements);
      expect(arrangedElements(input(result!.elements, { only: ["a", "b", "c"], scope, layout: "row" }))).toBeNull();
    });
  }

  it("leaves what the selection does not reach where it stands, in the grid as before", () => {
    // The grid packs the three in two rows, a and b side by side: u, further right, is in nobody's way, nor is far.
    const elements = [...scene().filter((e) => e.id !== "u"), node("u", 3 * (W + GROUP_GAP), 0)];
    const result = arrangedElements(input(elements, { only: ["a", "b", "c"], layout: "grid" }));
    expect(at(result, "b")).toMatchObject({ x: W + NODE_GAP, y: 0 });
    same(result, "u", elements);
    same(result, "far", elements);
  });
});
