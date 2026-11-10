import type { Point } from "@/agents/terminals";

/**
 * The wheel (spec menu radial §5.1): a round hub in the middle, then a donut of
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
/** On the hub, the pointer points at nothing (§5.2): a slide released there chooses nothing. */
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
  const half = Math.PI / count;
  const middle = slotAngle(slot, count);
  const first = middle - half;
  const second = middle + half;
  const outerFirst = corner(first, 1, OUTER_RADIUS, OUTER_CORNER, true);
  const outerSecond = corner(second, -1, OUTER_RADIUS, OUTER_CORNER, true);
  const innerSecond = corner(second, -1, INNER_RADIUS, INNER_CORNER, false);
  const innerFirst = corner(first, 1, INNER_RADIUS, INNER_CORNER, false);
  const large = 2 * half > Math.PI ? 1 : 0;
  return [
    `M ${xy(outerFirst.onCircle)}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${large} 1 ${xy(outerSecond.onCircle)}`,
    `A ${OUTER_CORNER} ${OUTER_CORNER} 0 0 1 ${xy(outerSecond.onSide)}`,
    `L ${xy(innerSecond.onSide)}`,
    `A ${INNER_CORNER} ${INNER_CORNER} 0 0 1 ${xy(innerSecond.onCircle)}`,
    `A ${INNER_RADIUS} ${INNER_RADIUS} 0 ${large} 0 ${xy(innerFirst.onCircle)}`,
    `A ${INNER_CORNER} ${INNER_CORNER} 0 0 1 ${xy(innerFirst.onSide)}`,
    `L ${xy(outerFirst.onSide)}`,
    `A ${OUTER_CORNER} ${OUTER_CORNER} 0 0 1 ${xy(outerFirst.onCircle)}`,
    "Z",
  ].join(" ");
}

/** A point of the circle at `radius`, in the direction of wedge `slot`'s middle (for tests and drawing). */
export function pointToward(slot: number, count: number, radius: number): Point {
  return at(radius, slotAngle(slot, count));
}
