import type { Point } from "@/agents/terminals";

/**
 * The wheel: a round hub in the middle, then a donut of
 * wedges, one per command, an even gap between them. Every size is from the
 * center, in CSS pixels.
 */
export const HUB_RADIUS = 56;
/** Between two wedges, and between the hub and the wedges: the same width all along. */
export const WEDGE_GAP = 4;
export const INNER_RADIUS = HUB_RADIUS + WEDGE_GAP;
export const OUTER_RADIUS = 140;
/** The corners of a wedge: softer outside, tighter on the short inner arc. */
export const OUTER_CORNER = 10;
export const INNER_CORNER = 6;
/** How far the wedge pointed at moves out, along its middle. */
export const POP = 4;
const BAND = OUTER_RADIUS - INNER_RADIUS;
/** Past the outer edge, the pointer still points at the wedge in its direction, up to this far. */
export const HOVER_SLACK = 20;
/** The circle that catches the pointer: the wedges and the slack around them. */
export const HIT_RADIUS = OUTER_RADIUS + HOVER_SLACK;
/** On the hub, the pointer points at nothing: a slide released there chooses nothing. */
export const DEAD_ZONE = HUB_RADIUS;
/** Closer to the press, a slide points at nothing either: the ring moved off an edge sits away from it. */
export const PRESS_DEAD_ZONE = 24;
/** Farther from the press, the right button slides rather than clicks. */
export const SLIDE_THRESHOLD = 6;
const MARGIN = 8;
/** The wheel's reach from its center, the wedge pointed at included. */
const REACH = OUTER_RADIUS + POP;

/** The wedges of a full ring. */
export const FULL_RING = 8;

/** The direction of wedge `slot`'s middle, in radians: 0 at the top, clockwise, evenly spaced. */
function slotAngle(slot: number, count: number): number {
  return ((slot * (360 / count) - 90) * Math.PI) / 180;
}

/**
 * How far out wedge `slot`'s icon and name sit: half way from its inner to its outer edge at the
 * sides, where a name runs along the radius (it is wider than tall); 3 px farther out at the top and
 * bottom, where the wedge is wider outside than in. In between, in proportion.
 */
export function labelRadius(slot: number, count: number = FULL_RING): number {
  const upright = Math.sin(slotAngle(slot, count)) ** 2;
  // Not rounded: the diagonals land on a half pixel, and a rounding there would differ from one side to the other.
  return INNER_RADIUS + BAND / 2 + 3 * upright;
}

/** Where wedge `slot`'s middle is from the center, at `radius` (its icon and name by default). */
export function slotPosition(slot: number, count: number = FULL_RING, radius: number = labelRadius(slot, count)): Point {
  const angle = slotAngle(slot, count);
  // `+ 0` turns -0 into 0.
  return { x: Math.round(radius * Math.cos(angle)) + 0, y: Math.round(radius * Math.sin(angle)) + 0 };
}

/** The pointed wedge's move outward, along its middle. */
export function popOffset(slot: number, count: number = FULL_RING): Point {
  const angle = slotAngle(slot, count);
  return { x: +(POP * Math.cos(angle)).toFixed(2) + 0, y: +(POP * Math.sin(angle)).toFixed(2) + 0 };
}

/**
 * The slot the pointer points at, from its distance and direction to the
 * center, never from the element under it: the wedge pointed at moves out, and
 * its edge would flicker. Nothing on the hub, nothing past the slack around the
 * wedges; a gap belongs to the wedge whose share of the circle it is in.
 */
export function slotAt(center: Point, pointer: Point, count: number = FULL_RING): number | null {
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance < DEAD_ZONE || distance > HIT_RADIUS) return null;
  const fromTop = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return ((Math.round(fromTop / (360 / count)) % count) + count) % count;
}

/**
 * The slot a slide points at; nothing within the dead zone of the press too,
 * for a ring moved off an edge sits away from it: a jitter there would point
 * at a wedge.
 */
export function slideSlot(center: Point, press: Point, pointer: Point, count: number = FULL_RING): number | null {
  if (Math.hypot(pointer.x - press.x, pointer.y - press.y) < PRESS_DEAD_ZONE) return null;
  return slotAt(center, pointer, count);
}

export function isSlide(press: Point, pointer: Point): boolean {
  return Math.hypot(pointer.x - press.x, pointer.y - press.y) > SLIDE_THRESHOLD;
}

/** The ring's center: the click point, moved off the window's edges so that the wheel shows whole. */
export function ringCenter(point: Point, window: { width: number; height: number }): Point {
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
  return {
    x: clamp(point.x, REACH + MARGIN, window.width - REACH - MARGIN),
    y: clamp(point.y, REACH + MARGIN, window.height - REACH - MARGIN),
  };
}

const at = (radius: number, angle: number): Point => ({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
const num = (value: number) => +value.toFixed(2) + 0;
const xy = (p: Point) => `${num(p.x)} ${num(p.y)}`;

/**
 * A rounded corner of a wedge, where its side meets one of its two circles.
 * The side runs parallel to the share's edge at `edge`, half a gap inside it
 * (`toward` is +1 for the first side, -1 for the second), so that the gap
 * between two wedges is as wide at the hub as at the rim. The round is the
 * circle of radius `round` that touches both the side and the circle.
 */
function corner(edge: number, toward: 1 | -1, circle: number, round: number, outside: boolean) {
  const along = { x: Math.cos(edge), y: Math.sin(edge) };
  // Toward the inside of the wedge, across the side.
  const across = { x: -Math.sin(edge) * toward, y: Math.cos(edge) * toward };
  const reach = outside ? circle - round : circle + round;
  const off = WEDGE_GAP / 2 + round;
  const depth = Math.sqrt(reach * reach - off * off);
  const center = { x: depth * along.x + off * across.x, y: depth * along.y + off * across.y };
  return {
    onSide: { x: depth * along.x + (WEDGE_GAP / 2) * across.x, y: depth * along.y + (WEDGE_GAP / 2) * across.y },
    onCircle: { x: (center.x * circle) / reach, y: (center.y * circle) / reach },
  };
}

/**
 * The outline of wedge `slot`, centered on 0,0, for an SVG path: an annular
 * sector with rounded corners. Clockwise: the outer arc, the second side
 * inward, the inner arc back, the first side outward.
 */
export function wedgePath(slot: number, count: number = FULL_RING): string {
  return sectorPath(slotAngle(slot, count), Math.PI / count, INNER_RADIUS, OUTER_RADIUS);
}

/** An annular sector with rounded corners around direction `middle`, `half` wide on either side, from `inner` to `outer`. */
function sectorPath(middle: number, half: number, inner: number, outer: number): string {
  const first = middle - half;
  const second = middle + half;
  const outerFirst = corner(first, 1, outer, OUTER_CORNER, true);
  const outerSecond = corner(second, -1, outer, OUTER_CORNER, true);
  const innerSecond = corner(second, -1, inner, INNER_CORNER, false);
  const innerFirst = corner(first, 1, inner, INNER_CORNER, false);
  const large = 2 * half > Math.PI ? 1 : 0;
  return [
    `M ${xy(outerFirst.onCircle)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${xy(outerSecond.onCircle)}`,
    `A ${OUTER_CORNER} ${OUTER_CORNER} 0 0 1 ${xy(outerSecond.onSide)}`,
    `L ${xy(innerSecond.onSide)}`,
    `A ${INNER_CORNER} ${INNER_CORNER} 0 0 1 ${xy(innerSecond.onCircle)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${xy(innerFirst.onCircle)}`,
    `A ${INNER_CORNER} ${INNER_CORNER} 0 0 1 ${xy(innerFirst.onSide)}`,
    `L ${xy(outerFirst.onSide)}`,
    `A ${OUTER_CORNER} ${OUTER_CORNER} 0 0 1 ${xy(outerFirst.onCircle)}`,
    "Z",
  ].join(" ");
}

/* The More arc (nested More): a second band of wedges outside the ring, the same width as its
   own, past the pointed wedge's pop and a gap, fanned out along the ring's curve and centred on
   the More wedge. It never reaches in toward the hub. */

/** The arc's inner edge: the More wedge, pointed and moved out, still a gap away from it. */
export const ARC_INNER = OUTER_RADIUS + POP + WEDGE_GAP;
export const ARC_OUTER = ARC_INNER + BAND;
/**
 * One place of the arc, in radians: at its middle radius a name of two words under its icon
 * (72 px wide at most) fits across it at the top and bottom, where it runs along the curve.
 */
export const ARC_STEP = (28 * Math.PI) / 180;
/** Past the arc's outer edge, the pointer still points at the wedge in its direction, up to this far. */
export const ARC_HIT = ARC_OUTER + HOVER_SLACK;
/** The arc's reach from the center, its pointed wedge included. */
const ARC_REACH = ARC_OUTER + POP;

/** Where the More arc lies: the direction of its middle (radians, as `slotAngle`), and its wedges. */
export interface ArcLayout {
  middle: number;
  count: number;
}

/** The direction of arc wedge `item`'s middle: clockwise from its first, as the ring reads. */
export function arcAngle(arc: ArcLayout, item: number): number {
  return arc.middle + (item - (arc.count - 1) / 2) * ARC_STEP;
}

/** How far out an arc wedge's icon and name sit: as on the ring (`labelRadius`), in the arc's band. */
function arcLabelRadius(angle: number): number {
  return ARC_INNER + BAND / 2 + 3 * Math.sin(angle) ** 2;
}

/** Where arc wedge `item`'s icon and name sit, from the ring's center. */
export function arcPosition(arc: ArcLayout, item: number): Point {
  const angle = arcAngle(arc, item);
  const radius = arcLabelRadius(angle);
  return { x: Math.round(radius * Math.cos(angle)) + 0, y: Math.round(radius * Math.sin(angle)) + 0 };
}

/** The pointed arc wedge's move outward, along its middle. */
export function arcPopOffset(arc: ArcLayout, item: number): Point {
  const angle = arcAngle(arc, item);
  return { x: +(POP * Math.cos(angle)).toFixed(2) + 0, y: +(POP * Math.sin(angle)).toFixed(2) + 0 };
}

/** The outline of arc wedge `item`, centered on the ring's center. */
export function arcWedgePath(arc: ArcLayout, item: number): string {
  return sectorPath(arcAngle(arc, item), ARC_STEP / 2, ARC_INNER, ARC_OUTER);
}

/** The arc's side for the pointer: its band and the slack around it, from the ring's rim out (a plain sector). */
export function arcHitPath(arc: ArcLayout): string {
  const half = (arc.count * ARC_STEP) / 2;
  const first = arc.middle - half;
  const second = arc.middle + half;
  const large = 2 * half > Math.PI ? 1 : 0;
  return [
    `M ${xy(at(OUTER_RADIUS, first))}`,
    `L ${xy(at(ARC_HIT, first))}`,
    `A ${ARC_HIT} ${ARC_HIT} 0 ${large} 1 ${xy(at(ARC_HIT, second))}`,
    `L ${xy(at(OUTER_RADIUS, second))}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${large} 0 ${xy(at(OUTER_RADIUS, first))}`,
    "Z",
  ].join(" ");
}

/** `angle` brought into (-π, π]. */
function wrapped(angle: number): number {
  const turn = 2 * Math.PI;
  const a = ((angle % turn) + turn) % turn;
  return a > Math.PI ? a - turn : a;
}

/** The arc wedge the pointer points at: past the ring's rim, within the arc's sweep; null elsewhere. */
export function arcItemAt(center: Point, pointer: Point, arc: ArcLayout): number | null {
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= OUTER_RADIUS || distance > ARC_HIT) return null;
  const item = Math.round(wrapped(Math.atan2(dy, dx) - arc.middle) / ARC_STEP + (arc.count - 1) / 2);
  return item >= 0 && item < arc.count ? item : null;
}

/** What the pointer points at: a wedge of the ring (`slot`), or of the open More arc (`item`). */
export interface Pointing {
  slot: number | null;
  item: number | null;
}

/**
 * The pointer's aim. With the arc open, past the ring's rim is the arc's: the slack beyond
 * the ring's other wedges no longer points at them, so a pointer cutting across from the More
 * wedge to the arc's end never lands on a neighbour (and the arc stays open).
 */
export function pointingAt(center: Point, pointer: Point, count: number, arc: ArcLayout | null): Pointing {
  if (!arc) return { slot: slotAt(center, pointer, count), item: null };
  if (Math.hypot(pointer.x - center.x, pointer.y - center.y) <= OUTER_RADIUS) return { slot: slotAt(center, pointer, count), item: null };
  return { slot: null, item: arcItemAt(center, pointer, arc) };
}

/** A slide's aim (`slideSlot`): nothing within the dead zone of the press. */
export function slidePointing(center: Point, press: Point, pointer: Point, count: number, arc: ArcLayout | null): Pointing {
  if (Math.hypot(pointer.x - press.x, pointer.y - press.y) < PRESS_DEAD_ZONE) return { slot: null, item: null };
  return pointingAt(center, pointer, count, arc);
}

/** The arc, whole inside the window (MARGIN from its edges): the corners and the middle of each wedge's two arcs. */
function arcFits(center: Point, arc: ArcLayout, window: { width: number; height: number }): boolean {
  for (let item = 0; item < arc.count; item++) {
    const middle = arcAngle(arc, item);
    for (const t of [-0.5, -0.25, 0, 0.25, 0.5]) {
      for (const radius of [ARC_INNER, ARC_REACH]) {
        const p = at(radius, middle + t * ARC_STEP);
        const x = center.x + p.x;
        const y = center.y + p.y;
        if (x < MARGIN || x > window.width - MARGIN || y < MARGIN || y > window.height - MARGIN) return false;
      }
    }
  }
  return true;
}

/** The turns tried, in degrees, the smallest first: none, then a degree more each way by turn, round to the far side. */
function* turns(): Generator<number> {
  yield 0;
  for (let k = 1; k <= 180; k++) {
    yield k;
    yield -k;
  }
}

/**
 * The More arc of a ring of `ringCount` wedges, More at `moreSlot`, for `count` commands:
 * centred on the More wedge, unless that runs past the window's edge. It then turns along the
 * ring's curve, the least it can: by the ring's top edge, about 77° for five wedges, its end
 * still meeting the More wedge (shift); in a corner where no such place fits, round to the side
 * the window has room for (flip). Nowhere whole (a window smaller than the arc): centred on More.
 */
export function arcLayout(center: Point, moreSlot: number, ringCount: number, count: number, window: { width: number; height: number }): ArcLayout {
  const base = slotAngle(moreSlot, ringCount);
  for (const turn of turns()) {
    const arc = { middle: wrapped(base + (turn * Math.PI) / 180), count };
    if (arcFits(center, arc, window)) return arc;
  }
  return { middle: wrapped(base), count };
}

/** A point of the circle at `radius`, in the direction of wedge `slot`'s middle (for tests and drawing). */
export function pointToward(slot: number, count: number, radius: number): Point {
  return at(radius, slotAngle(slot, count));
}
