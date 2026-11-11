import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { isSpawnWire, isTalker, isTalkWire, isWire, wireReading } from "@/agents/wires";
import type { Point } from "@/agents/terminals";
import type { WireDirection, WirePulse } from "../wireActivity";
import { nodeKindOf } from "../nodeElement";
import type { SceneFrame } from "../groups";

/** A wire of the scene on screen, read from the fleet's end to the other one. */
export interface WirePath {
  id: string;
  /** The fleet; for a wire between two agents, the one it starts at (for a spawn wire, the parent). */
  fleetId: string;
  /** A group's frame, a terminal, a Kanban board (a mission's). */
  targetId: string;
  /** Scene coordinates, the fleet's end first. */
  points: Point[];
  /** A talk wire (`isTalkWire`): only a message between its two ends lights it. */
  talk?: true;
}

/**
 * The wires of the scene that join a fleet to something, or two of a
 * terminal, a Fleet and a Kanban board (a spawn wire, a link, a talk wire, a
 * mission's board to its Manager), with their route.
 */
export function wirePaths(elements: readonly ExcalidrawElement[]): WirePath[] {
  const fleets = new Set(elements.filter((e) => !e.isDeleted && nodeKindOf(e) === "fleet").map((e) => e.id));
  const byId = new Map(elements.map((e) => [e.id, e]));
  const paths: WirePath[] = [];
  for (const element of elements) {
    if (element.isDeleted || element.type !== "arrow" || !isWire(element)) continue;
    const arrow = element as ExcalidrawArrowElement;
    const start = arrow.startBinding?.elementId;
    const end = arrow.endBinding?.elementId;
    if (!start || !end) continue;
    // spawn_agent drew it from the parent, "+ Link" from the agent clicked first, a message from its sender: a pulse on
    // its end naming its start lights it. Not a wire between two things that do not talk (an output, a plain frame).
    const reaches = fleets.has(start) || fleets.has(end) || isSpawnWire(arrow) || isTalkWire(arrow) || (isTalker(byId.get(start)) && isTalker(byId.get(end)));
    if (!reaches) continue;
    const points = arrow.points.map(([x, y]) => ({ x: arrow.x + x, y: arrow.y + y }));
    // A wire drawn by hand from the target to the fleet reads the other way.
    const { from, to, reversed } = wireReading(start, end, (id) => fleets.has(id));
    paths.push({ id: arrow.id, fleetId: from, targetId: to, points: reversed ? points.reverse() : points, ...(isTalkWire(arrow) ? { talk: true as const } : {}) });
  }
  return paths;
}

export function sameWirePaths(a: readonly WirePath[], b: readonly WirePath[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i];
      return (
        p.id === q.id &&
        p.fleetId === q.fleetId &&
        p.targetId === q.targetId &&
        p.talk === q.talk &&
        p.points.length === q.points.length &&
        p.points.every((pt, j) => pt.x === q.points[j].x && pt.y === q.points[j].y)
      );
    })
  );
}

/** A wire showing a message, and which way it goes. */
export interface ActiveWire {
  wire: WirePath;
  direction: WireDirection;
  /** When the message passed: a newer one starts the animation again. */
  at: number;
}

/**
 * The wires that carry a recent message: a wire to a group carries its
 * members' messages, a wire to a terminal that terminal's. A pulse that names
 * its fleet lights only that fleet's wire (the wire's start); one that names
 * none lights every wire reaching the agent but a talk wire, which only a
 * message between its two ends lights.
 */
export function activeWires(
  wires: readonly WirePath[],
  frames: readonly SceneFrame[],
  pulses: Readonly<Record<string, WirePulse>>,
): ActiveWire[] {
  const active: ActiveWire[] = [];
  for (const wire of wires) {
    const group = frames.find((f) => f.id === wire.targetId && f.group !== null);
    const agents = group ? group.memberIds : [wire.targetId];
    let latest: WirePulse | undefined;
    for (const id of agents) {
      const pulse = pulses[id];
      if (!pulse || (pulse.fleetId === undefined ? wire.talk : pulse.fleetId !== wire.fleetId)) continue;
      if (!latest || pulse.at > latest.at) latest = pulse;
    }
    if (latest) active.push({ wire, direction: latest.direction, at: latest.at });
  }
  return active;
}

/** The radius Excalidraw rounds an elbow arrow's corners with (`generateElbowArrowShape(points, 16)`, 0.18.1). */
export const ELBOW_CORNER = 16;

/**
 * The SVG path of a route, in the direction the message travels. Its corners
 * are rounded as Excalidraw rounds the wire's, at most half of each side, so
 * the light runs on the line.
 */
export function pathData(points: readonly Point[], direction: WireDirection): string {
  const ordered = direction === "toAgent" ? points : [...points].reverse();
  if (ordered.length === 0) return "";
  const d = [`M${xy(ordered[0])}`];
  for (let i = 1; i < ordered.length - 1; i++) {
    const [prev, corner, next] = [ordered[i - 1], ordered[i], ordered[i + 1]];
    const radius = Math.min(ELBOW_CORNER, distance(corner, prev) / 2, distance(corner, next) / 2);
    d.push(`L${xy(toward(corner, prev, radius))}`, `Q${xy(corner)} ${xy(toward(corner, next, radius))}`);
  }
  if (ordered.length > 1) d.push(`L${xy(ordered[ordered.length - 1])}`);
  return d.join(" ");
}

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** The point `length` away from `from` on the way to `to`. */
function toward(from: Point, to: Point, length: number): Point {
  const span = distance(from, to);
  if (span === 0) return from;
  return { x: from.x + ((to.x - from.x) / span) * length, y: from.y + ((to.y - from.y) / span) * length };
}

const round = (n: number) => Math.round(n * 10) / 10;
const xy = (p: Point) => `${round(p.x)} ${round(p.y)}`;
