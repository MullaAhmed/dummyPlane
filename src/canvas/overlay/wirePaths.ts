import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { isAgentLink, isSpawnWire, isWire } from "@/fleet/wires";
import type { Point } from "@/fleet/terminals";
import type { WireDirection, WirePulse } from "../wireActivity";
import { nodeKindOf } from "../nodeElement";
import type { SceneFrame } from "../groups";

/** A wire of the scene on screen, read from the orchestrator's end to the other one. */
export interface WirePath {
  id: string;
  /** The orchestrator; for a wire between two agents, the one it starts at (for a spawn wire, the parent). */
  orchestratorId: string;
  /** A group's frame or a terminal. */
  targetId: string;
  /** Scene coordinates, the orchestrator's end first. */
  points: Point[];
}

/** The wires of the scene that join an orchestrator to something, or two agents (a spawn wire, a link), with their route. */
export function wirePaths(elements: readonly ExcalidrawElement[]): WirePath[] {
  const orchestrators = new Set(elements.filter((e) => !e.isDeleted && nodeKindOf(e) === "orchestrator").map((e) => e.id));
  const byId = new Map(elements.map((e) => [e.id, e]));
  const paths: WirePath[] = [];
  for (const element of elements) {
    if (element.isDeleted || element.type !== "arrow" || !isWire(element)) continue;
    const arrow = element as ExcalidrawArrowElement;
    const start = arrow.startBinding?.elementId;
    const end = arrow.endBinding?.elementId;
    if (!start || !end) continue;
    const points = arrow.points.map(([x, y]) => ({ x: arrow.x + x, y: arrow.y + y }));
    // A wire drawn by hand from the target to the orchestrator reads the other way.
    if (orchestrators.has(start)) paths.push({ id: arrow.id, orchestratorId: start, targetId: end, points });
    else if (orchestrators.has(end)) paths.push({ id: arrow.id, orchestratorId: end, targetId: start, points: points.reverse() });
    // spawn_agent drew it from the parent, "+ Link" from the agent clicked first: a pulse on its end naming its start lights it.
    else if (isSpawnWire(arrow) || isAgentLink(arrow, byId)) paths.push({ id: arrow.id, orchestratorId: start, targetId: end, points });
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
        p.orchestratorId === q.orchestratorId &&
        p.targetId === q.targetId &&
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
 * its orchestrator lights only that orchestrator's wire.
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
      if (!pulse || (pulse.orchestratorId !== undefined && pulse.orchestratorId !== wire.orchestratorId)) continue;
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
