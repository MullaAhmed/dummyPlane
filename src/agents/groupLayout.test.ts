import { describe, expect, it } from "vitest";
import type { Rect } from "@/canvas/groups";
import { NODE_SIZE } from "@/canvas/nodeElement";
import type { Point } from "./terminals";
import { TIMELINE_ROOM } from "@/canvas/overlay/timeline";
import {
  arrangeInFrame,
  cellAt,
  CELL,
  clearSpot,
  COLUMN_GAP,
  freeCell,
  freeSpot,
  GROUP_GAP,
  groupGrid,
  NODE_GAP,
  fleetSpot,
  PADDING,
  PADDING_BOTTOM,
  PADDING_TOP,
  rectAround,
  ROW_GAP,
} from "./groupLayout";

const at = (x: number, y: number, size: { width: number; height: number }): Rect => ({ x, y, width: size.width, height: size.height });

describe("spacing", () => {
  it("keeps the step frieze, then 32 of air, between two rows, and 32 between columns", () => {
    expect([COLUMN_GAP, ROW_GAP, PADDING, PADDING_TOP, PADDING_BOTTOM]).toEqual([32, 56, 32, 48, 56]);
    // The frieze is TIMELINE_ROOM deep: what is left under it is as wide as the gap between columns.
    expect(ROW_GAP - TIMELINE_ROOM).toBe(COLUMN_GAP);
    expect(PADDING_BOTTOM - TIMELINE_ROOM).toBe(PADDING);
  });

  it("leaves the frieze of each terminal of a column clear of the one below it, with air", () => {
    const { cells } = groupGrid(4);
    for (let i = 1; i < cells.length; i++) {
      const frieze = cells[i - 1].y + cells[i - 1].height + TIMELINE_ROOM;
      expect(cells[i].y - frieze).toBe(COLUMN_GAP);
    }
  });

  it("keeps a Fleet's group GROUP_GAP away: three times the air, wider than any gap of the grid", () => {
    expect(GROUP_GAP).toBe(96);
    expect(GROUP_GAP).toBeGreaterThan(Math.max(COLUMN_GAP, ROW_GAP));
  });
});

describe("groupGrid", () => {
  it("sizes the frame of 1, 4, 5 and 12 agents", () => {
    expect([1, 4, 5, 12].map((n) => [groupGrid(n).width, groupGrid(n).height])).toEqual([
      [784, 544],
      [784, 2032],
      [1536, 2032],
      [2288, 2032],
    ]);
  });

  it("lays the terminals out column by column, four per column", () => {
    const { cells } = groupGrid(5);
    expect(cells.map((c) => [c.x, c.y])).toEqual([
      [32, 48],
      [32, 544],
      [32, 1040],
      [32, 1536],
      [784, 48],
    ]);
  });

  it("stacks up to four terminals in a single column, then opens the next column", () => {
    expect(groupGrid(3).cells.map((c) => c.x)).toEqual([32, 32, 32]);
    expect(groupGrid(8).cells.map((c) => c.x)).toEqual([32, 32, 32, 32, 784, 784, 784, 784]);
    expect(groupGrid(9).cells[8]).toEqual(cellAt({ x: 0, y: 0 }, 2, 0));
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
    expect(freeCell(frameOf(4), members).cell).toEqual(cellAt(origin, 0, 1));
  });

  it("fills a hole in an earlier column before the next column's cells", () => {
    const members = full(6).filter((_, i) => i !== 2);
    expect(freeCell(frameOf(6), members).cell).toEqual(cellAt(origin, 0, 2));
  });

  it("keeps the cell of a terminal moved a little by hand", () => {
    const [first, ...rest] = full(4);
    const moved = { ...first, x: first.x + 30, y: first.y + 12 };
    expect(freeCell(frameOf(4), [moved, ...rest.slice(1)]).cell).toEqual(cellAt(origin, 0, 1));
  });

  it("stacks a new terminal under the last one: a full column grows by a row, down to four", () => {
    expect(freeCell(frameOf(2), full(2))).toEqual({ cell: cellAt(origin, 0, 2), frame: frameOf(3) });
    expect(freeCell(frameOf(3), full(3))).toEqual({ cell: cellAt(origin, 0, 3), frame: frameOf(4) });
  });

  it("opens a new column to the right once the column holds four", () => {
    expect(freeCell(frameOf(4), full(4))).toEqual({ cell: cellAt(origin, 1, 0), frame: frameOf(5) });
  });

  it("keeps filling the new column downward, in a frame as tall as a full column", () => {
    expect(freeCell(frameOf(5), full(5))).toEqual({ cell: cellAt(origin, 1, 1), frame: frameOf(6) });
    expect(freeCell(frameOf(8), full(8))).toEqual({ cell: cellAt(origin, 2, 0), frame: frameOf(9) });
  });

  it("grows a frame laid out row by row down its first column, then to the right", () => {
    // A frame of the previous layout: four terminals side by side.
    const legacy = at(origin.x, origin.y, { width: 3016, height: 544 });
    const row = [0, 1, 2, 3].map((col) => cellAt(origin, col, 0));
    expect(freeCell(legacy, row)).toEqual({ cell: cellAt(origin, 0, 1), frame: { ...legacy, height: groupGrid(2).height } });
    const column = [0, 1, 2].map((r) => cellAt(origin, 0, r));
    expect(freeCell({ ...legacy, height: groupGrid(3).height }, [...row, ...column.slice(1)]).cell).toEqual(cellAt(origin, 1, 1));
  });

  it("keeps a terminal moved down by hand from taking the next cell on its frieze", () => {
    const [first, ...rest] = full(4);
    // Its frieze and half the air still fit above the cell below; 40 lower they do not.
    expect(freeCell(frameOf(4), [{ ...first, y: first.y + 16 }, ...rest.slice(1)]).cell).toEqual(cellAt(origin, 0, 1));
    expect(freeCell(frameOf(4), [{ ...first, y: first.y + 40 }, ...rest.slice(1)]).cell).not.toEqual(cellAt(origin, 0, 1));
  });

  it("does not grow onto a member straddling the frame's edge", () => {
    // Excalidraw keeps a member in its frame while it still crosses the border.
    const straddling = { ...cellAt(origin, 0, 0), y: origin.y + groupGrid(2).height - 100 };
    const placed = freeCell(frameOf(2), [...full(2), straddling]);
    expect(placed).toEqual({ cell: cellAt(origin, 0, 3), frame: frameOf(4) });
  });

  it("uses the first cell of a frame smaller than a terminal and grows it", () => {
    const small = at(0, 0, { width: 300, height: 200 });
    expect(freeCell(small, [])).toEqual({ cell: cellAt({ x: 0, y: 0 }, 0, 0), frame: at(0, 0, groupGrid(1)) });
  });
});

describe("freeCell in a group saved with the former spacing", () => {
  const origin = { x: 100, y: 200 };
  const OLD_GAP = 24;
  /** The frame of `columns` columns of `rows` rows, as the former layout drew it: 744 / 464 apart, 32 under the last row. */
  const oldFrame = (columns: number, rows: number) =>
    at(origin.x, origin.y, { width: 64 + columns * CELL.width + (columns - 1) * OLD_GAP, height: 48 + 32 + rows * CELL.height + (rows - 1) * OLD_GAP });
  const oldCell = (col: number, row: number) => at(origin.x + 32 + col * (CELL.width + OLD_GAP), origin.y + 48 + row * (CELL.height + OLD_GAP), CELL);
  /** The room a terminal's frieze takes under it. */
  const frieze = (r: Rect): Rect => ({ ...r, y: r.y + r.height, height: TIMELINE_ROOM });
  const touches = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it("hard-codes the former numbers it builds on", () => {
    expect([oldFrame(1, 4).width, oldFrame(1, 4).height]).toEqual([784, 1912]);
    expect([oldFrame(2, 4).width, oldFrame(1, 2).height, oldFrame(4, 1).width]).toEqual([1528, 984, 3016]);
    expect([0, 1, 2, 3].map((row) => oldCell(0, row).y - origin.y)).toEqual([48, 512, 976, 1440]);
    expect(oldCell(1, 0).x - origin.x).toBe(776);
  });

  it("never lands on a member nor on a frieze, whichever row of an old column was closed", () => {
    for (const closed of [0, 1, 2, 3]) {
      const members = [0, 1, 2, 3].filter((row) => row !== closed).map((row) => oldCell(0, row));
      const { cell, frame } = freeCell(oldFrame(1, 4), members);
      for (const member of members) {
        expect(touches(cell, member), `row ${closed} closed: the cell covers a member`).toBe(false);
        expect(touches(cell, frieze(member)), `row ${closed} closed: the cell covers a frieze`).toBe(false);
        expect(touches(frieze(cell), member), `row ${closed} closed: its frieze covers a member`).toBe(false);
      }
      // The frame holds it.
      expect(cell.y + cell.height + PADDING_BOTTOM).toBeLessThanOrEqual(frame.y + frame.height);
      expect(cell.x + cell.width + PADDING).toBeLessThanOrEqual(frame.x + frame.width);
    }
  });

  it("opens a new column when a full old column of four gets a fifth terminal", () => {
    const members = [0, 1, 2, 3].map((row) => oldCell(0, row));
    const placed = freeCell(oldFrame(1, 4), members);
    expect(placed.cell).toEqual(cellAt(origin, 1, 0));
    expect(placed.frame).toEqual({ ...oldFrame(1, 4), width: groupGrid(5).width });
  });

  it("stacks a terminal under the last of a partly filled old column, clear of its frieze", () => {
    const members = [0, 1, 2].map((row) => oldCell(0, row));
    const { cell, frame } = freeCell(oldFrame(1, 3), members);
    // The first row of the new grid that holds it: under the third terminal, its frieze and then some air.
    expect(cell).toEqual(cellAt(origin, 0, 3));
    expect(cell.y).toBeGreaterThanOrEqual(members[2].y + members[2].height + TIMELINE_ROOM + COLUMN_GAP);
    expect(frame).toEqual({ ...oldFrame(1, 3), height: groupGrid(4).height });
  });

  it("takes the first free cell of the second column of an old two-column frame", () => {
    const members = [0, 1, 2, 3].map((row) => oldCell(0, row)).concat(oldCell(1, 0));
    const placed = freeCell(oldFrame(2, 4), members);
    expect(placed.cell).toEqual(cellAt(origin, 1, 1));
    for (const member of members) {
      expect(touches(placed.cell, member)).toBe(false);
      expect(touches(placed.cell, frieze(member))).toBe(false);
    }
    // Two columns: the width of the grid of five.
    expect(placed.frame.width).toBe(groupGrid(5).width);
  });

  it("places a queue's several arrivals one after the other, none on another", () => {
    const members = [0, 1].map((row) => oldCell(0, row));
    const { cells } = arrangeInFrame(oldFrame(1, 2), members, 4);
    const all = [...members, ...cells];
    for (let i = 0; i < all.length; i++) {
      for (let j = 0; j < all.length; j++) {
        if (i === j) continue;
        expect(touches(all[i], all[j]), `${i} / ${j}`).toBe(false);
        expect(touches(all[i], frieze(all[j])), `${i} / frieze of ${j}`).toBe(false);
      }
    }
  });
});

describe("arrangeInFrame", () => {
  it("places several new terminals one after the other", () => {
    const origin = { x: 0, y: 0 };
    const members = groupGrid(2).cells;
    const placed = arrangeInFrame(at(0, 0, groupGrid(2)), members, 3);
    expect(placed.cells).toEqual([cellAt(origin, 0, 2), cellAt(origin, 0, 3), cellAt(origin, 1, 0)]);
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

describe("fleetSpot", () => {
  it("puts a fleet to the left of the group, its top on the group's top", () => {
    expect(fleetSpot({ x: 1000, y: 500, width: 900, height: 600 })).toEqual({ x: 1000 - GROUP_GAP - 320, y: 880 });
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

  it("places a launch clear of an existing terminal it would cover: ROW_GAP below it, NODE_GAP beside (b)", () => {
    const existing = rectAround(center, size);
    const spot = freeSpot(rectAround({ x: center.x + 100, y: center.y + 50 }, size), [existing]);
    expect(overlaps(spot, existing)).toBe(false);
    // Below it: the frieze of its steps hangs there.
    expect(gapOf(spot, existing)).toBe(ROW_GAP);
    // Beside it, nothing hangs: only NODE_GAP.
    const beside = freeSpot(rectAround({ x: center.x + 700, y: center.y + 400 }, size), [existing]);
    expect(overlaps(beside, existing)).toBe(false);
    expect(gapOf(beside, existing)).toBeGreaterThanOrEqual(NODE_GAP);
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
