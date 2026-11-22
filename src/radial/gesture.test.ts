import { describe, expect, it } from "vitest";
import { TITLE_BAR_HEIGHT } from "@/shell/layout";
import { OVERLAY_TOP } from "@/shell/overlayBounds";
import {
  ARC_HIT,
  ARC_INNER,
  ARC_OUTER,
  ARC_STEP,
  arcAngle,
  arcItemAt,
  arcLayout,
  arcPosition,
  arcToward,
  MIN_ARC_STEP,
  slotDirection,
  arcWedgePath,
  pointingAt,
  POP,
  slidePointing,
  type ArcLayout,
  DEAD_ZONE,
  HIT_RADIUS,
  HUB_RADIUS,
  INNER_RADIUS,
  isSlide,
  OUTER_RADIUS,
  popOffset,
  ringArea,
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

describe("the wheel's geometry", () => {
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

  it("keeps the wheel under the title bar at the 960x600 minimum: its top one gap below the bar, wherever the click was", () => {
    const area = ringArea({ innerWidth: 960, innerHeight: 600 });
    expect(area).toEqual({ width: 960, height: 600, top: TITLE_BAR_HEIGHT });
    // The ring-on-canvas frame: a click at y 152 put the wheel's top at y 6, over the title bar.
    const center = ringCenter({ x: 480, y: 152 }, area);
    expect(center).toEqual({ x: 480, y: TITLE_BAR_HEIGHT + 8 + OUTER_RADIUS + POP });
    expect(center.y - OUTER_RADIUS - POP).toBe(OVERLAY_TOP);
    // Still whole at the bottom, and a click in the middle stays where it was.
    expect(ringCenter({ x: 480, y: 599 }, area).y + OUTER_RADIUS + POP).toBe(600 - 8);
    expect(ringCenter({ x: 480, y: 300 }, area)).toEqual({ x: 480, y: 300 });
  });
});

describe("the More arc's geometry (nested More)", () => {
  const window = { width: 1440, height: 900 };
  const degrees = (radians: number) => Math.round((radians * 180) / Math.PI);
  /** How far the arc turned from More's direction (↖, -135°), in degrees, within a half turn either way. */
  const turnOf = (arc: ArcLayout) => ((((degrees(arc.middle) + 135) % 360) + 540) % 360) - 180;
  const at = (center: { x: number; y: number }, angle: number, radius: number) => ({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  /** Every corner of every wedge of the arc, inside the window by 8 px. */
  const whole = (center: { x: number; y: number }, arc: ArcLayout) =>
    Array.from({ length: arc.count }, (_, i) => i).every((i) =>
      points(arcWedgePath(arc, i)).every((p) => center.x + p.x >= 8 && center.x + p.x <= window.width - 8 && center.y + p.y >= 8 && center.y + p.y <= window.height - 8),
    );

  it("lies outside the ring, past the pointed wedge's pop and a gap, as wide as its band: it never reaches in toward the hub", () => {
    expect(ARC_INNER).toBe(OUTER_RADIUS + POP + WEDGE_GAP);
    expect(ARC_OUTER - ARC_INNER).toBe(OUTER_RADIUS - INNER_RADIUS);
    const arc = { middle: -Math.PI / 2, count: 3 };
    for (let i = 0; i < 3; i++) {
      for (const p of points(arcWedgePath(arc, i))) expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(ARC_INNER - 0.01);
    }
  });

  it("fans out from the More wedge along the ring's curve, centred on it, clockwise, one step apart", () => {
    const arc = arcLayout({ x: 720, y: 450 }, 7, 8, 5, window);
    expect(degrees(arc.middle)).toBe(-135);
    expect([0, 1, 2, 3, 4].map((i) => degrees(arcAngle(arc, i)))).toEqual([-191, -163, -135, -107, -79]);
    expect(degrees(ARC_STEP)).toBe(28);
    // Its labels sit half way across its band, as the ring's do.
    const label = arcPosition({ middle: 0, count: 1 }, 0);
    expect(label).toEqual({ x: Math.round(ARC_INNER + (ARC_OUTER - ARC_INNER) / 2), y: 0 });
  });

  it("turns along the curve, the least it can, when the window's edge cuts it, still touching the More wedge (shift)", () => {
    // The ring as near the top as it goes: centred on ↖, the arc would run past the top.
    const center = { x: 720, y: 152 };
    expect(whole(center, { middle: (-135 * Math.PI) / 180, count: 5 })).toBe(false);
    const arc = arcLayout(center, 7, 8, 5, window);
    expect(whole(center, arc)).toBe(true);
    const turned = turnOf(arc);
    expect(Math.abs(turned)).toBeGreaterThan(0);
    // Its end still meets the More wedge (45° wide on a ring of 8).
    expect(Math.abs(turned)).toBeLessThanOrEqual((5 * 28) / 2 + 45 / 2);
  });

  it("goes round to the side with room in a corner where no turn still spanning More fits (flip)", () => {
    const center = { x: 152, y: 152 };
    const arc = arcLayout(center, 7, 8, 5, window);
    expect(whole(center, arc)).toBe(true);
    expect(Math.abs(turnOf(arc))).toBeGreaterThan((5 * 28) / 2 + 45 / 2);
  });

  it("never fans out over the title bar: at 960x600 it turns until every wedge is one gap below the bar", () => {
    const area = ringArea({ innerWidth: 960, innerHeight: 600 });
    const center = ringCenter({ x: 480, y: 10 }, area);
    // Centred on More (↖), the arc would rise over the bar.
    const below = (arc: ArcLayout) =>
      Array.from({ length: arc.count }, (_, i) => i).every((i) => points(arcWedgePath(arc, i)).every((p) => center.y + p.y >= OVERLAY_TOP - 0.5));
    expect(below({ middle: (-135 * Math.PI) / 180, count: 5 })).toBe(false);
    expect(below(arcLayout(center, 7, 8, 5, area))).toBe(true);
  });

  it("stays centred on More when nowhere fits (a window smaller than the arc)", () => {
    expect(degrees(arcLayout({ x: 100, y: 100 }, 7, 8, 5, { width: 200, height: 200 }).middle)).toBe(-135);
  });

  it("points at the arc's wedge in its direction, from the ring's rim out to the slack past the arc", () => {
    const center = { x: 500, y: 500 };
    const arc = { middle: -Math.PI / 2, count: 3 };
    expect(arcItemAt(center, at(center, -Math.PI / 2, 190), arc)).toBe(1);
    expect(arcItemAt(center, at(center, -Math.PI / 2 - ARC_STEP, 150), arc)).toBe(0);
    expect(arcItemAt(center, at(center, -Math.PI / 2 + ARC_STEP, ARC_HIT - 1), arc)).toBe(2);
    // Past its ends, inside the ring, past the slack: none.
    expect(arcItemAt(center, at(center, -Math.PI / 2 + 2 * ARC_STEP, 190), arc)).toBeNull();
    expect(arcItemAt(center, at(center, -Math.PI / 2, OUTER_RADIUS - 1), arc)).toBeNull();
    expect(arcItemAt(center, at(center, -Math.PI / 2, ARC_HIT + 1), arc)).toBeNull();
  });

  it("leaves the ring's slack to the arc while it is open: past the rim, a neighbour of More is no longer pointed at", () => {
    const center = { x: 500, y: 500 };
    const arc = { middle: (-135 * Math.PI) / 180, count: 2 };
    const pastPause = at(center, Math.PI, 150);
    expect(pointingAt(center, pastPause, 8, null)).toEqual({ slot: 6, item: null });
    expect(pointingAt(center, pastPause, 8, arc)).toEqual({ slot: null, item: null });
    // On the ring itself, the ring's wedges still answer.
    expect(pointingAt(center, at(center, Math.PI, 100), 8, arc)).toEqual({ slot: 6, item: null });
    // A slide's jitter near the press points at nothing.
    expect(slidePointing(center, center, at(center, -Math.PI / 2, 10), 8, arc)).toEqual({ slot: null, item: null });
  });
});

describe("an arc of many wedges (Arrange's seven layouts, Other agent's agents)", () => {
  const degrees = (radians: number) => Math.round((radians * 180) / Math.PI);
  /** Every corner of every wedge of the arc inside the area, 8 px from its edges, under the title bar. */
  const inside = (center: { x: number; y: number }, arc: ArcLayout, area: { width: number; height: number; top?: number }) =>
    Array.from({ length: arc.count }, (_, i) => i).every((i) =>
      points(arcWedgePath(arc, i)).every(
        (p) => center.x + p.x >= 8 - 0.5 && center.x + p.x <= area.width - 8 + 0.5 && center.y + p.y >= (area.top ?? 0) + 8 - 0.5 && center.y + p.y <= area.height - 8 + 0.5,
      ),
    );
  /** Where a ring can stand in the area: its centre moved off the edges, from the corners to the middle. */
  const centres = (area: { width: number; height: number; top?: number }) =>
    [0, 0.25, 0.5, 0.75, 1].flatMap((fx) => [0, 0.25, 0.5, 0.75, 1].map((fy) => ringCenter({ x: fx * area.width, y: fy * area.height }, area)));

  it("fans out from its wedge, centred on it, one step apart, where the window has room", () => {
    // The canvas ring's Arrange, ↙ on a ring of eight, in the middle of a wide window.
    const arc = arcToward({ x: 720, y: 450 }, slotDirection(5, 8), 7, { width: 1440, height: 900 });
    expect([arc.count, arc.step]).toEqual([7, undefined]);
    expect(arc.middle).toBeCloseTo(slotDirection(5, 8), 9);
    expect([0, 3, 6].map((i) => degrees(arcAngle(arc, i)))).toEqual([51, 135, 219]);
  });

  it("stays whole inside the window wherever the ring stands, at 960x600 and 1280x800, its wedges narrowed only where it must", () => {
    for (const [width, height] of [
      [960, 600],
      [1280, 800],
    ]) {
      const area = ringArea({ innerWidth: width, innerHeight: height });
      for (const center of centres(area)) {
        for (const count of [7, 9]) {
          for (let slot = 0; slot < 8; slot++) {
            const arc = arcToward(center, slotDirection(slot, 8), count, area);
            expect(inside(center, arc, area), `${width}x${height} ${count} at ${center.x},${center.y} from ${slot}`).toBe(true);
            expect(arc.step ?? ARC_STEP).toBeGreaterThanOrEqual(MIN_ARC_STEP - 1e-9);
          }
        }
      }
    }
  });

  it("keeps More's arc as it was: never narrowed, wherever the ring stands at 960x600", () => {
    const area = ringArea({ innerWidth: 960, innerHeight: 600 });
    for (const center of centres(area)) {
      for (const count of [2, 3, 5]) expect(arcLayout(center, 7, 8, count, area).step).toBeUndefined();
    }
  });

  it("narrows in a corner, where seven wedges at ARC_STEP fit nowhere, and points at its wedges by their narrower step", () => {
    const area = ringArea({ innerWidth: 960, innerHeight: 600 });
    const corner = ringCenter({ x: 0, y: 0 }, area);
    const arc = arcToward(corner, slotDirection(7, 8), 7, area);
    expect(arc.step).toBeDefined();
    expect(arc.step!).toBeLessThan(ARC_STEP);
    expect(inside(corner, arc, area)).toBe(true);
    const center = { x: 500, y: 500 };
    const narrow = { middle: 0, count: 7, step: (20 * Math.PI) / 180 };
    const toward = (angle: number) => ({ x: center.x + 190 * Math.cos(angle), y: center.y + 190 * Math.sin(angle) });
    expect([0, 3, 6].map((i) => arcItemAt(center, toward(arcAngle(narrow, i)), narrow))).toEqual([0, 3, 6]);
    expect(arcItemAt(center, toward(arcAngle(narrow, 6) + (20 * Math.PI) / 180), narrow)).toBeNull();
  });
});
