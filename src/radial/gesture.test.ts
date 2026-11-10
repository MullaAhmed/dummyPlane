import { describe, expect, it } from "vitest";
import {
  DEAD_ZONE,
  HIT_RADIUS,
  HUB_RADIUS,
  INNER_RADIUS,
  isSlide,
  OUTER_RADIUS,
  popOffset,
  ringCenter,
  slideSlot,
  slotAt,
  slotPosition,
  wedgePath,
  WEDGE_GAP,
} from "./gesture";

/** The points a wedge's outline goes through: its start, and the end of each line and arc. */
function points(path: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const [, command, args] of path.matchAll(/([MLA])([^MLAZ]*)/g)) {
    const n = args.trim().split(/\s+/).map(Number);
    const [x, y] = command === "A" ? n.slice(5) : n;
    out.push({ x, y });
  }
  return out;
}

describe("the wheel's geometry (spec menu radial §5)", () => {
  it("sizes the wheel: a hub, then the wedges one gap away from it", () => {
    expect([HUB_RADIUS, INNER_RADIUS, OUTER_RADIUS, WEDGE_GAP]).toEqual([56, 60, 140, 4]);
    // A slide released over the hub chooses nothing.
    expect(DEAD_ZONE).toBe(HUB_RADIUS);
    expect(HIT_RADIUS).toBe(OUTER_RADIUS + 20);
  });

  it("sets each wedge's icon and name clockwise from the top, half way out at the sides, a little farther at the top and bottom", () => {
    expect([0, 2, 4, 6].map((slot) => slotPosition(slot))).toEqual([
      { x: 0, y: -103 },
      { x: 100, y: 0 },
      { x: 0, y: 103 },
      { x: -100, y: 0 },
    ]);
    // The diagonals, alike.
    const [ne, se, sw, nw] = [1, 3, 5, 7].map((slot) => slotPosition(slot));
    expect(ne.x).toBe(-ne.y);
    expect([se, sw, nw]).toEqual([
      { x: ne.x, y: -ne.y },
      { x: -ne.x, y: -ne.y },
      { x: -ne.x, y: ne.y },
    ]);
    expect(ne.x).toBeGreaterThan(70);
  });

  it("moves the wedge pointed at 4 px out, along its middle", () => {
    expect([popOffset(0), popOffset(2), popOffset(4)]).toEqual([
      { x: 0, y: -4 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ]);
  });

  it("draws each wedge as a sector with rounded corners, an even gap from its neighbours, from the hub's gap to the rim", () => {
    for (const count of [5, 7, 8]) {
      for (let slot = 0; slot < count; slot++) {
        const path = wedgePath(slot, count);
        expect(path.startsWith("M ") && path.endsWith(" Z"), path).toBe(true);
        const at = points(path);
        const radius = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
        // Clockwise: the outer arc's ends on the rim, the inner arc's on the inner circle.
        expect(at).toHaveLength(9);
        expect([0, 1, 8].map((i) => radius(at[i]).toFixed(1))).toEqual(["140.0", "140.0", "140.0"]);
        expect([4, 5].map((i) => radius(at[i]).toFixed(1))).toEqual(["60.0", "60.0"]);
        // The sides run half a gap inside the share's edges, so two neighbours stand a gap apart all along.
        const across = (side: number, p: { x: number; y: number }) => {
          const edge = ((slot + side) * (360 / count) - 90) * (Math.PI / 180);
          return Math.abs(p.x * Math.sin(edge) - p.y * Math.cos(edge)).toFixed(1);
        };
        const half = (WEDGE_GAP / 2).toFixed(1);
        expect([across(0.5, at[2]), across(0.5, at[3]), across(-0.5, at[6]), across(-0.5, at[7])]).toEqual([half, half, half, half]);
      }
    }
  });

  it("points at the wedge in the pointer's direction, from the hub out to 20 px past the rim", () => {
    const center = { x: 300, y: 300 };
    const toward = (dx: number, dy: number) => slotAt(center, { x: 300 + dx, y: 300 + dy });
    expect([toward(0, -100), toward(70, -70), toward(100, 0), toward(70, 70), toward(0, 100), toward(-70, 70), toward(-100, 0), toward(-70, -70)]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    // On the hub: nothing; just past the hub, in the gap before the wedges: the wedge.
    expect([toward(0, -30), toward(0, -55), toward(0, -57)]).toEqual([null, null, 0]);
    // Past the rim: still the wedge, within the slack; beyond, nothing.
    expect([toward(0, -150), toward(0, -160), toward(0, -161)]).toEqual([0, 0, null]);
    // A gap between two wedges belongs to the one whose share it is in.
    expect([toward(38, -100), toward(43, -100)]).toEqual([0, 1]);
  });

  it("spreads a ring of fewer wedges evenly, with no empty place", () => {
    expect([0, 1, 2, 3].map((slot) => slotPosition(slot, 4))).toEqual([
      { x: 0, y: -103 },
      { x: 100, y: 0 },
      { x: 0, y: 103 },
      { x: -100, y: 0 },
    ]);
    const center = { x: 300, y: 300 };
    const toward = (dx: number, dy: number) => slotAt(center, { x: 300 + dx, y: 300 + dy }, 4);
    expect([toward(0, -100), toward(100, 0), toward(0, 100), toward(-100, 0)]).toEqual([0, 1, 2, 3]);
    // Five wedges: a fifth of the circle each, the second one up and to the right.
    expect(slotAt(center, { x: 300 + 100, y: 300 - 32 }, 5)).toBe(1);
    expect(slotAt(center, { x: 300 - 100, y: 300 - 32 }, 5)).toBe(4);
  });

  it("points at nothing within 24 px of the press, the ring moved off an edge (final review)", () => {
    const center = { x: 200, y: 200 };
    const press = { x: 290, y: 200 };
    expect(slideSlot(center, press, { x: 290, y: 215 })).toBeNull();
    expect(slideSlot(center, press, { x: 290, y: 230 })).toBe(2);
    expect(slideSlot(press, press, { x: 290, y: 260 })).toBe(4);
    // Back over the hub: nothing.
    expect(slideSlot(press, press, { x: 290, y: 240 })).toBeNull();
  });

  it("tells a slide from a click by 6 px", () => {
    expect(isSlide({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false);
    expect(isSlide({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(true);
  });

  it("keeps the wheel inside the window, its wedge pointed at included, 8 px from the edges", () => {
    const window = { width: 1000, height: 800 };
    expect(ringCenter({ x: 500, y: 400 }, window)).toEqual({ x: 500, y: 400 });
    expect(ringCenter({ x: 10, y: 10 }, window)).toEqual({ x: 152, y: 152 });
    expect(ringCenter({ x: 995, y: 795 }, window)).toEqual({ x: 848, y: 648 });
  });
});
