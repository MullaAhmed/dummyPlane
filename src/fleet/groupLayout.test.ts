import { describe, expect, it } from "vitest";
import type { Rect } from "@/canvas/groups";
import { NODE_SIZE } from "@/canvas/nodeElement";
import type { Point } from "./terminals";
import { arrangeInFrame, cellAt, clearSpot, freeCell, freeSpot, GROUP_GAP, groupGrid, NODE_GAP, orchestratorSpot, rectAround } from "./groupLayout";

const at = (x: number, y: number, size: { width: number; height: number }): Rect => ({ x, y, width: size.width, height: size.height });

describe("groupGrid", () => {
  it("sizes the frame of 1, 4, 5 and 12 agents (spec §11.3)", () => {
    expect([1, 4, 5, 12].map((n) => [groupGrid(n).width, groupGrid(n).height])).toEqual([
      [784, 520],
      [3016, 520],
      [3016, 984],
      [3016, 1448],
    ]);
  });

  it("lays the terminals out row by row, four per row", () => {
    const { cells } = groupGrid(5);
    expect(cells.map((c) => [c.x, c.y])).toEqual([
      [32, 48],
      [776, 48],
      [1520, 48],
      [2264, 48],
      [32, 512],
    ]);
  });
});

describe("freeCell", () => {
  const origin = { x: 100, y: 200 };
  const full = (n: number) => groupGrid(n).cells.map((c) => ({ ...c, x: c.x + origin.x, y: c.y + origin.y }));
  const frameOf = (n: number) => at(origin.x, origin.y, groupGrid(n));

  it("takes the first cell of an empty group", () => {
    expect(freeCell(frameOf(1), [])).toEqual({ cell: cellAt(origin, 0, 0), frame: frameOf(1) });
  });

  it("fills the hole left by a closed terminal first", () => {
    const members = full(4).filter((_, i) => i !== 1);
    expect(freeCell(frameOf(4), members).cell).toEqual(cellAt(origin, 1, 0));
  });

  it("keeps the cell of a terminal moved a little by hand", () => {
    const [first, ...rest] = full(4);
    const moved = { ...first, x: first.x + 30, y: first.y + 12 };
    expect(freeCell(frameOf(4), [moved, ...rest.slice(1)]).cell).toEqual(cellAt(origin, 1, 0));
  });

  it("grows a full frame by a column, up to four", () => {
    expect(freeCell(frameOf(2), full(2))).toEqual({ cell: cellAt(origin, 2, 0), frame: frameOf(3) });
  });

  it("grows a full frame of four columns by a row", () => {
    expect(freeCell(frameOf(4), full(4))).toEqual({ cell: cellAt(origin, 0, 1), frame: frameOf(5) });
  });

  it("does not grow onto a member straddling the frame's edge", () => {
    // Excalidraw keeps a member in its frame while it still crosses the border.
    const straddling = { ...cellAt(origin, 0, 0), x: origin.x + 1528 };
    const placed = freeCell(frameOf(2), [...full(2), straddling]);
    expect(placed.cell).toEqual(cellAt(origin, 0, 1));
  });

  it("uses the first cell of a frame smaller than a terminal and grows it", () => {
    const small = at(0, 0, { width: 300, height: 200 });
    expect(freeCell(small, [])).toEqual({ cell: cellAt({ x: 0, y: 0 }, 0, 0), frame: at(0, 0, groupGrid(1)) });
  });
});

describe("arrangeInFrame", () => {
  it("places several new terminals one after the other", () => {
    const origin = { x: 0, y: 0 };
    const members = groupGrid(2).cells;
    const placed = arrangeInFrame(at(0, 0, groupGrid(2)), members, 3);
    expect(placed.cells).toEqual([cellAt(origin, 2, 0), cellAt(origin, 3, 0), cellAt(origin, 0, 1)]);
    expect(placed.frame).toEqual(at(0, 0, groupGrid(5)));
  });
});

describe("clearSpot", () => {
  const spot = { x: 100, y: 100, width: 400, height: 300 };

  it("keeps a spot that covers nothing", () => {
    expect(clearSpot(spot, [{ x: 600, y: 0, width: 100, height: 100 }])).toEqual(spot);
  });

  it("moves a new group below what it would cover", () => {
    expect(clearSpot(spot, [{ x: 0, y: 0, width: 1000, height: 500 }])).toEqual({ ...spot, y: 500 + GROUP_GAP });
  });

  it("keeps moving down past content stacked below", () => {
    const obstacles = [
      { x: 0, y: 0, width: 1000, height: 500 },
      { x: 300, y: 650, width: 200, height: 200 },
    ];
    expect(clearSpot(spot, obstacles)).toEqual({ ...spot, y: 850 + GROUP_GAP });
  });
});

describe("orchestratorSpot", () => {
  it("puts an orchestrator to the left of the group, its top on the group's top", () => {
    expect(orchestratorSpot({ x: 1000, y: 500, width: 900, height: 600 })).toEqual({ x: 1000 - GROUP_GAP - 320, y: 880 });
  });
});

describe("freeSpot", () => {
  const size = NODE_SIZE.terminal;
  const center = { x: 1000, y: 800 };
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  /** Smallest gap between two rects, the gap along x or y (negative when they overlap). */
  const gapOf = (a: Rect, b: Rect) => Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));
  const launch = (at: Point, placed: Rect[]) => {
    const spot = freeSpot(rectAround(at, size), placed);
    placed.push(spot);
    return spot;
  };

  it("keeps the requested center on empty space (d)", () => {
    expect(freeSpot(rectAround(center, size), [])).toEqual(rectAround(center, size));
    const far = { x: 9000, y: 9000, width: 720, height: 440 };
    expect(freeSpot(rectAround(center, size), [far])).toEqual(rectAround(center, size));
  });

  it("does not stack two launches at the same center (a)", () => {
    const placed: Rect[] = [];
    const first = launch(center, placed);
    const second = launch(center, placed);
    const third = launch(center, placed);
    expect(overlaps(first, second)).toBe(false);
    expect(overlaps(second, third)).toBe(false);
    expect(overlaps(first, third)).toBe(false);
    expect(gapOf(first, second)).toBeGreaterThanOrEqual(NODE_GAP);
  });

  it("places a launch right of an existing terminal it would cover, NODE_GAP apart (b)", () => {
    const existing = rectAround(center, size);
    const spot = freeSpot(rectAround({ x: center.x + 100, y: center.y + 50 }, size), [existing]);
    expect(overlaps(spot, existing)).toBe(false);
    expect(gapOf(spot, existing)).toBe(NODE_GAP);
  });

  it("keeps clear of group frames and every node", () => {
    const frame = { x: 1000 - 50, y: 800 - 50, width: 2000, height: 2000 };
    const spot = freeSpot(rectAround(center, size), [frame]);
    expect(overlaps(spot, frame)).toBe(false);
  });

  it("gives a duplicate a spot that overlaps neither its source nor a neighbour (c)", () => {
    const source = rectAround(center, size);
    const neighbour = { x: source.x + source.width + NODE_GAP, y: source.y, width: size.width, height: size.height };
    // duplicateTerminal's requested center: right of the source, NODE_GAP apart.
    const requested = rectAround({ x: source.x + source.width * 1.5 + NODE_GAP, y: source.y + source.height / 2 }, size);
    const copy = freeSpot(requested, [source, neighbour]);
    expect(overlaps(copy, source)).toBe(false);
    expect(overlaps(copy, neighbour)).toBe(false);
    expect(gapOf(copy, source)).toBeGreaterThanOrEqual(NODE_GAP);
  });
});
