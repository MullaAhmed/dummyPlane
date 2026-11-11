import type {
  ExcalidrawArrowElement,
  ExcalidrawElbowArrowElement,
  ExcalidrawElement,
  FixedPoint,
  FixedPointBinding,
} from "@excalidraw/excalidraw/element/types";
import { currentPalette, PALETTES, type ThemeChoice } from "@/app/theme";
import { groupAt, groupInfoOf, type SceneFrame } from "@/canvas/groups";
import { findTerminalAt } from "@/canvas/hitTest";
import { nodeKindOf } from "@/canvas/nodeElement";
import { sceneColorFor } from "@/theme/sceneColors";
import { COLUMN_GAP, GROUP_GAP } from "./groupLayout";
import type { Point } from "./terminals";

/**
 * Electric's off-white (#F4F4F1) is beyond what the dark filter can show: stored the
 * plain inverse way (#000000) it shows #ededed, as expressive's does. The nearest of all
 * 8-bit colors, #010001, shows #eeedee: as light, and a color of electric's own.
 */
const ELECTRIC_WIRE_SCENE = "#010001";

/**
 * The color a wire is stored in under `palette`: the palette's accent
 * (`--dp-accent`, the color the light running on the wire is drawn in) as the
 * canvas must show it. A light palette shows a stored color as is; Excalidraw's
 * dark filter shows the nearest it can to the accent (spec habillage §4.3), so
 * the accent goes through `toSceneColor` there: expressive's #F4F4F1 is stored
 * #000000 and shown #EDEDED.
 */
export function wireColor(palette: ThemeChoice): string {
  if (palette === "electric") return ELECTRIC_WIRE_SCENE;
  const { accent, scheme } = PALETTES[palette];
  return sceneColorFor(accent, scheme);
}

/**
 * The colors wires were stored in under the palettes' former accents (calm's pink,
 * and the scene colors of electric's and expressive's), before each palette's
 * accent became its ink: still palette colors, not the user's picks.
 */
const FORMER_PALETTE_WIRE_COLORS = ["#f52b94", "#546100", "#f25500"];

/** Whether `color` is the color some palette draws a wire in, now or before: one the user did not pick. */
export function isPaletteWireColor(color: string): boolean {
  const stored = color.toLowerCase();
  return FORMER_PALETTE_WIRE_COLORS.includes(stored) || (Object.keys(PALETTES) as ThemeChoice[]).some((palette) => wireColor(palette).toLowerCase() === stored);
}

/** The terracotta wires were drawn with before: a wire still in it takes the palette's color when it is elbowed. */
const FORMER_WIRE_COLOR = "#c2603f";

// Excalidraw 0.18.1's constants (tests cannot load Excalidraw):
/**
 * FIXED_BINDING_DISTANCE: an elbow arrow's end stands this far off the element
 * it joins. Excalidraw only keeps a fixed point at that distance as it is.
 */
const GAP = 5;
/** The middle of a side as normalizeFixedPoint stores it (0.5 becomes 0.5001): restore() leaves it as is. */
const MIDDLE = 0.5001;
/** BASE_PADDING: how far a route keeps off the elements it goes around. */
const DETOUR = 40;
/** DEDUP_TRESHOLD: a step shorter than this is no step. */
const STRAIGHT = 1;

const random = () => Math.floor(Math.random() * 2 ** 31);

/** What a fleet is wired to. */
export interface Links {
  groupIds: string[];
  nodeIds: string[];
}

export const NO_LINKS: Links = { groupIds: [], nodeIds: [] };

export function isWire(element: ExcalidrawElement): boolean {
  const data = element.customData?.dummyplane as { kind?: unknown } | undefined;
  return data?.kind === "wire";
}

/**
 * A wire from an agent, or a Fleet, to the sub-agent it opened with
 * spawn_agent, its start bound to the parent: never a fleet's link to its team
 * (`fleetTargets`), and the upkeep keeps the mark through an orphaning and its undo.
 */
export function isSpawnWire(element: ExcalidrawElement): boolean {
  const data = element.customData?.dummyplane as { kind?: unknown; spawn?: unknown } | undefined;
  return data?.kind === "wire" && data.spawn === true;
}

/**
 * A wire drawn because a message passed between its two ends, which no wire
 * joined (./talkWires.ts): dashed, so it reads apart from the others by its
 * stroke, not its colour alone. Never a fleet's link to its team
 * (`fleetTargets`); between two terminals it is an agent link like any wire.
 */
export function isTalkWire(element: ExcalidrawElement): boolean {
  const data = element.customData?.dummyplane as { kind?: unknown; talk?: unknown } | undefined;
  return data?.kind === "wire" && data.talk === true;
}

/** What a wire's mark says besides that it is one: why it was drawn, and how it is routed. */
export interface WireFlags {
  /** From an agent, or a Fleet, to the sub-agent it opened (`isSpawnWire`). */
  spawn?: boolean;
  /** Drawn because a message passed (`isTalkWire`). */
  talk?: boolean;
  /** A vertical tree's wire from a parent to a child it laid out under it: out of the parent's bottom, into the child's top (./treeLayout.ts). */
  down?: boolean;
  /** A `down` wire to a child in a later row: round the riser left of the parent's children. */
  riser?: boolean;
}

const FLAG_NAMES = ["spawn", "talk", "down", "riser"] as const;

/** The flags `element`'s wire mark carries. */
export function wireFlagsOf(element: ExcalidrawElement): WireFlags {
  const data = element.customData?.dummyplane as Record<string, unknown> | undefined;
  const flags: WireFlags = {};
  for (const name of FLAG_NAMES) if (data?.[name] === true) flags[name] = true;
  return flags;
}

/** A wire's mark with `flags`, only those set: `{ kind: "wire" }` for a plain wire. */
export function wireMark(flags: WireFlags): Record<string, unknown> {
  const mark: Record<string, unknown> = { kind: "wire" };
  for (const name of FLAG_NAMES) if (flags[name]) mark[name] = true;
  return mark;
}

/** Whether two sets of flags say the same. */
export function sameFlags(a: WireFlags, b: WireFlags): boolean {
  return FLAG_NAMES.every((name) => Boolean(a[name]) === Boolean(b[name]));
}

/** `element`'s customData with its wire mark carrying `flags` instead, whatever else its mark and its data hold kept. */
export function withWireFlags(element: ExcalidrawElement, flags: WireFlags): Record<string, unknown> {
  const data = (element.customData?.dummyplane as Record<string, unknown> | undefined) ?? {};
  const rest = Object.fromEntries(Object.entries(data).filter(([key]) => !(FLAG_NAMES as readonly string[]).includes(key)));
  return { ...element.customData, dummyplane: { ...rest, ...wireMark(flags) } };
}

/** What a fleet can be wired to: a group's frame or a terminal (not a plain frame). */
function isWireTarget(element: ExcalidrawElement | undefined): element is ExcalidrawElement {
  return element !== undefined && !element.isDeleted && (groupInfoOf(element) !== null || nodeKindOf(element) === "terminal");
}

/** The element at the other end of an arrow bound to `fleetId`, either way round. */
function otherEnd(arrow: ExcalidrawElement, fleetId: string): string | null {
  if (arrow.type !== "arrow") return null;
  const start = arrow.startBinding?.elementId;
  const end = arrow.endBinding?.elementId;
  if (start === fleetId) return end ?? null;
  if (end === fleetId) return start ?? null;
  return null;
}

/**
 * The groups and terminals wired to a fleet, from the arrows of the
 * scene: deleting an arrow or its target cuts the link (spec §13). Not its
 * spawn wires: a sub-agent it opened with spawn_agent is not on its team; nor
 * its talk wires: a message that passed puts nobody on it.
 */
export function fleetTargets(elements: readonly ExcalidrawElement[], fleetId: string): Links {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const links: Links = { groupIds: [], nodeIds: [] };
  for (const element of elements) {
    if (element.isDeleted || isSpawnWire(element) || isTalkWire(element)) continue;
    const otherId = otherEnd(element, fleetId);
    const other = otherId ? byId.get(otherId) : undefined;
    if (!isWireTarget(other)) continue;
    if (groupInfoOf(other)) {
      if (!links.groupIds.includes(other.id)) links.groupIds.push(other.id);
    } else if (!links.nodeIds.includes(other.id)) {
      links.nodeIds.push(other.id);
    }
  }
  return links;
}

/** The links of every fleet of the scene. */
export function fleetLinks(elements: readonly ExcalidrawElement[]): Record<string, Links> {
  return Object.fromEntries(
    elements
      .filter((e) => !e.isDeleted && nodeKindOf(e) === "fleet")
      .map((o) => [o.id, fleetTargets(elements, o.id)]),
  );
}

export function sameLinks(a: Record<string, Links>, b: Record<string, Links>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((id, i) => id === y[i]);
  return keys.every((k) => b[k] !== undefined && same(a[k].groupIds, b[k].groupIds) && same(a[k].nodeIds, b[k].nodeIds));
}

type Side = "left" | "right" | "top" | "bottom";
type Box = Pick<ExcalidrawElement, "x" | "y" | "width" | "height">;

/**
 * The sides a wire leaves `from` by and reaches `to` by: facing each other,
 * side by side first, else one above the other. Boxes that overlap (an
 * fleet dropped on a group's frame) are both reached on the side of
 * `to` nearer the middle of `from`.
 */
function wireSides(from: Box, to: Box): [Side, Side] {
  const room = 2 * GAP;
  if (to.x >= from.x + from.width + room) return ["right", "left"];
  if (to.x + to.width <= from.x - room) return ["left", "right"];
  if (to.y >= from.y + from.height + room) return ["bottom", "top"];
  if (to.y + to.height <= from.y - room) return ["top", "bottom"];
  const middle = from.x + from.width / 2;
  const side = middle - to.x <= to.x + to.width - middle ? "left" : "right";
  return [side, side];
}

/** Excalidraw's fixed point for the middle of a side, GAP out: ratios of the box's width and height. */
function fixedPointOf(box: Box, side: Side): FixedPoint {
  const out = (size: number) => GAP / (size || 1);
  switch (side) {
    case "left":
      return [-out(box.width), MIDDLE];
    case "right":
      return [1 + out(box.width), MIDDLE];
    case "top":
      return [MIDDLE, -out(box.height)];
    case "bottom":
      return [MIDDLE, 1 + out(box.height)];
  }
}

/** Where a fixed point is on the scene, as Excalidraw places it (nodes and frames are not rotated). */
function scenePoint(box: Box, [ratioX, ratioY]: FixedPoint): Point {
  return { x: box.x + box.width * ratioX, y: box.y + box.height * ratioY };
}

/**
 * An orthogonal route from `start` to `end`, relative to `start`: out of the
 * start side, across half way, into the end side; straight when the ends are
 * level, around DETOUR past the farther one when both are on the same side.
 */
function route(start: Point, [startSide, endSide]: [Side, Side], end: Point): [number, number][] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (startSide === "top" || startSide === "bottom") {
    if (Math.abs(dx) < STRAIGHT) return [[0, 0], [0, dy]];
    return [[0, 0], [0, dy / 2], [dx, dy / 2], [dx, dy]];
  }
  if (startSide === endSide) {
    const across = startSide === "right" ? Math.max(0, dx) + DETOUR : Math.min(0, dx) - DETOUR;
    return [[0, 0], [across, 0], [across, dy], [dx, dy]];
  }
  if (Math.abs(dy) < STRAIGHT) return [[0, 0], [dx, 0]];
  return [[0, 0], [dx / 2, 0], [dx / 2, dy], [dx, dy]];
}

/** How a vertical tree's wire is routed: its `down` and `riser` flags. */
export type TreeRoute = Pick<WireFlags, "down" | "riser">;

/**
 * A vertical tree's route from `from` (the parent) to `to` (a child laid out
 * under it, ./treeLayout.ts), relative to `start`, out of the parent's bottom
 * and into the child's top, through the channels the layout leaves free. A child
 * of the first row: down to the middle of the gap under the parent, across,
 * down. A child of a later row (`riser`): down to the middle of the gap under
 * the parent, across to the riser COLUMN_GAP / 2 left of the parent (the
 * children's rows start at its left edge), down to the middle of the gap above
 * the child's row, across, down: the rows above are crossed in the channels
 * between them, never through a node. Read from the two boxes and the flags
 * alone, so every reroute draws the same route. Null when the boxes do not fit
 * the flags (the child is no longer below its parent): the wire takes the
 * plain route.
 */
function treeRoute(from: Box, to: Box, flags: TreeRoute, start: Point, end: Point): [number, number][] | null {
  if (!flags.down || to.y < from.y + from.height + 2 * GAP) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const under = from.y + from.height + GROUP_GAP / 2 - start.y;
  const above = to.y - GROUP_GAP / 2 - start.y;
  const riser = from.x - COLUMN_GAP / 2 - start.x;
  // A riser needs the channel above the child's row below the one under the parent; else the first row's route.
  if (flags.riser && above - under >= STRAIGHT && under > 0 && dy - above >= STRAIGHT) {
    return [[0, 0], [0, under], [riser, under], [riser, above], [dx, above], [dx, dy]];
  }
  return route(start, ["bottom", "top"], end);
}

export type ElbowForm = Pick<
  ExcalidrawElbowArrowElement,
  | "x"
  | "y"
  | "width"
  | "height"
  | "angle"
  | "points"
  | "lastCommittedPoint"
  | "elbowed"
  | "roundness"
  | "roughness"
  | "startBinding"
  | "endBinding"
  | "fixedSegments"
  | "startIsSpecial"
  | "endIsSpecial"
>;

/**
 * An elbow arrow from `from` to `to` as they stand: bound by fixed points at
 * the middle of the sides that face each other, routed through them. Excalidraw
 * routes it again from those fixed points whenever the user moves one of the
 * two (not when the app does). Arrange gives it to a drawn elbow arrow whose
 * ends it moved apart (./arrangeDrawings.ts). A vertical tree's wire (`route`
 * down) leaves the bottom of `from` and enters the top of `to` whichever sides
 * face each other (`treeRoute`), as long as `to` is below `from`.
 */
export function elbowForm(from: ExcalidrawElement, to: ExcalidrawElement, tree: TreeRoute = {}): ElbowForm {
  const below: [Side, Side] = ["bottom", "top"];
  const down = tree.down === true && to.y >= from.y + from.height + 2 * GAP;
  const sides = down ? below : wireSides(from, to);
  const startPoint = fixedPointOf(from, sides[0]);
  const endPoint = fixedPointOf(to, sides[1]);
  const start = scenePoint(from, startPoint);
  const end = scenePoint(to, endPoint);
  const points = (down ? treeRoute(from, to, tree, start, end) : null) ?? route(start, sides, end);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  // Focus and gap as Excalidraw's bindLinearElement writes them for an elbow arrow: the fixed point says it all.
  const binding = (elementId: string, fixedPoint: FixedPoint): FixedPointBinding => ({ elementId, focus: 0, gap: 0, fixedPoint });
  return {
    x: start.x,
    y: start.y,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    angle: 0 as ExcalidrawElbowArrowElement["angle"],
    points: points as unknown as ExcalidrawElbowArrowElement["points"],
    lastCommittedPoint: null,
    elbowed: true,
    // Excalidraw draws an elbow arrow's corners round whatever this says, and sets it to null.
    roundness: null,
    roughness: 0,
    startBinding: binding(from.id, startPoint),
    endBinding: binding(to.id, endPoint),
    fixedSegments: null,
    startIsSpecial: false,
    endIsSpecial: false,
  };
}

/**
 * A complete elbow arrow from the side of `fleet` facing `target` to the
 * side of `target` facing it, without heads, in the color of `palette` (spec §13). Every base field is set
 * here, as for the nodes (Excalidraw's skeletons cannot bind to existing
 * elements). With `spawn` (true, or flags with it), `fleet` is an agent and
 * `target` the sub-agent it spawned (`isSpawnWire`); a talk wire is dashed;
 * `down` and `riser` route it as a vertical tree's (`elbowForm`).
 */
export function createWire(
  fleet: ExcalidrawElement,
  target: ExcalidrawElement,
  palette: ThemeChoice = currentPalette(),
  spawn: boolean | WireFlags = false,
): ExcalidrawElbowArrowElement {
  const flags: WireFlags = typeof spawn === "boolean" ? (spawn ? { spawn: true } : {}) : spawn;
  return {
    id: crypto.randomUUID(),
    type: "arrow",
    strokeColor: wireColor(palette),
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    // Told apart by its stroke, in the wire's colour.
    strokeStyle: flags.talk ? "dashed" : "solid",
    opacity: 100,
    seed: random(),
    version: 1,
    versionNonce: random(),
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    startArrowhead: null,
    endArrowhead: null,
    customData: { dummyplane: wireMark(flags) },
    ...elbowForm(fleet, target, flags),
  };
}

/**
 * The wires of a scene as elbow arrows: those saved before wires were elbowed,
 * and the hand-drawn ones marked since, get a route between their ends as they
 * are now, with the same id and the same ends. Excalidraw's restore() unbinds an
 * elbow arrow whose binding has no fixed point; these have one. A wire whose end
 * is gone is left to `orphanWires`. The scene itself when nothing changes.
 */
export function elbowWires(elements: readonly ExcalidrawElement[], palette: ThemeChoice = currentPalette()): readonly ExcalidrawElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  let changed = false;
  const next = elements.map((element) => {
    if (element.type !== "arrow" || !isWire(element)) return element;
    const wire = element as ExcalidrawArrowElement;
    if (wire.elbowed) return element;
    const from = wire.startBinding && byId.get(wire.startBinding.elementId);
    const to = wire.endBinding && byId.get(wire.endBinding.elementId);
    if (!from || !to) return element;
    changed = true;
    const strokeColor = wire.strokeColor.toLowerCase() === FORMER_WIRE_COLOR ? wireColor(palette) : wire.strokeColor;
    const elbow: ExcalidrawElbowArrowElement = {
      ...wire,
      ...elbowForm(from, to, wireFlagsOf(wire)),
      strokeColor,
      version: wire.version + 1,
      versionNonce: random(),
      updated: Date.now(),
    };
    return elbow;
  });
  return changed ? next : elements;
}

/**
 * The wires bound to one of `nodeIds` routed again between their ends as they
 * stand: Excalidraw only reroutes an elbow when the user moves or resizes an
 * end, not when the app changes its size. A wire keeps its mark (a vertical
 * tree's routed by its flags, as its layout routed it), its color and its
 * stroke. The scene itself when no wire moves.
 */
export function rerouteWires(elements: readonly ExcalidrawElement[], nodeIds: ReadonlySet<string>): readonly ExcalidrawElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  let changed = false;
  const next = elements.map((element) => {
    if (element.isDeleted || element.type !== "arrow" || !isWire(element)) return element;
    const wire = element as ExcalidrawArrowElement;
    const start = wire.startBinding?.elementId;
    const end = wire.endBinding?.elementId;
    if (!start || !end || (!nodeIds.has(start) && !nodeIds.has(end))) return element;
    const from = byId.get(start);
    const to = byId.get(end);
    if (!from || !to || from.isDeleted || to.isDeleted) return element;
    changed = true;
    const elbow: ExcalidrawElbowArrowElement = { ...wire, ...elbowForm(from, to, wireFlagsOf(wire)), version: wire.version + 1, versionNonce: random(), updated: Date.now() };
    return elbow;
  });
  return changed ? next : elements;
}

/** `elements` with a new wire from `from` to `to`, recorded on both ends. */
function addWire(elements: readonly ExcalidrawElement[], from: ExcalidrawElement, to: ExcalidrawElement, palette: ThemeChoice, flags: boolean | WireFlags): ExcalidrawElement[] {
  const wire = createWire(from, to, palette, flags);
  const bind = (e: ExcalidrawElement): ExcalidrawElement => ({
    ...e,
    boundElements: [...(e.boundElements ?? []), { id: wire.id, type: "arrow" }],
    version: e.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  });
  return [...elements.map((e) => (e.id === from.id || e.id === to.id ? bind(e) : e)), wire];
}

/**
 * `elements` with a new wire, recorded on both ends, unless one already joins
 * them (spec §13); `spawn` as for `createWire`. A talk wire already joining
 * them becomes the link asked for (solid, no longer a talk wire), not a second
 * arrow over it.
 */
export function withWire(
  elements: readonly ExcalidrawElement[],
  fleetId: string,
  targetId: string,
  palette: ThemeChoice = currentPalette(),
  spawn = false,
): ExcalidrawElement[] {
  const fleet = elements.find((e) => e.id === fleetId && !e.isDeleted);
  const target = elements.find((e) => e.id === targetId && !e.isDeleted);
  if (!fleet || !target) return [...elements];
  const links = fleetTargets(elements, fleetId);
  if (links.groupIds.includes(targetId) || links.nodeIds.includes(targetId)) return [...elements];
  // `fleetTargets` leaves spawn wires out: one is not drawn twice.
  if (spawn && elements.some((e) => !e.isDeleted && isSpawnWire(e) && otherEnd(e, fleetId) === targetId)) return [...elements];
  const talking = spawn ? undefined : elements.find((e) => !e.isDeleted && isTalkWire(e) && otherEnd(e, fleetId) === targetId);
  if (talking) {
    const link = { ...talking, strokeStyle: "solid", customData: withWireFlags(talking, { ...wireFlagsOf(talking), talk: false }), version: talking.version + 1, versionNonce: random(), updated: Date.now() } as ExcalidrawElement;
    return elements.map((e) => (e === talking ? link : e));
  }
  return addWire(elements, fleet, target, palette, spawn);
}

/** A live wire's two bound ends, start then end; null for any other element, or a wire with a loose end. */
function boundEnds(element: ExcalidrawElement): [string, string] | null {
  if (element.isDeleted || element.type !== "arrow" || !isWire(element)) return null;
  const { startBinding, endBinding } = element as ExcalidrawArrowElement;
  return startBinding && endBinding ? [startBinding.elementId, endBinding.elementId] : null;
}

/** The group `nodeId` is a member of, read from its frame (a stored scene has no canvas frames); null for none. */
function groupFrameOf(nodeId: string, byId: ReadonlyMap<string, ExcalidrawElement>): string | null {
  const node = byId.get(nodeId);
  const frame = node?.frameId ? byId.get(node.frameId) : undefined;
  return frame && !frame.isDeleted && groupInfoOf(frame) ? frame.id : null;
}

/**
 * The live wire that joins `aId` and `bId`, either way round, whatever its
 * kind; else a Fleet's wire to the group the other one is a member of (it joins
 * the Fleet with each of them). Null when none does.
 */
export function joiningWire(elements: readonly ExcalidrawElement[], aId: string, bId: string): ExcalidrawArrowElement | null {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const wires = elements.flatMap((e) => {
    const ends = boundEnds(e);
    return ends ? [{ wire: e as ExcalidrawArrowElement, ends }] : [];
  });
  const joins = (x: string | null, y: string | null) => wires.find(({ ends: [s, e] }) => (s === x && e === y) || (s === y && e === x))?.wire;
  const direct = joins(aId, bId);
  if (direct) return direct;
  const isFleet = (id: string) => {
    const e = byId.get(id);
    return e !== undefined && !e.isDeleted && nodeKindOf(e) === "fleet";
  };
  if (isFleet(aId)) return joins(aId, groupFrameOf(bId, byId)) ?? null;
  if (isFleet(bId)) return joins(bId, groupFrameOf(aId, byId)) ?? null;
  return null;
}

/** What talks over a wire: a terminal, a Fleet or a Kanban board, alive. */
export function isTalker(element: ExcalidrawElement | undefined): element is ExcalidrawElement {
  if (element === undefined || element.isDeleted) return false;
  const kind = nodeKindOf(element);
  return kind === "terminal" || kind === "fleet" || kind === "kanban";
}

/**
 * `elements` with a plain wire from `fromId` to `toId` (no flags), recorded on
 * both ends, unless a live wire already joins them (`joiningWire`), one of them
 * is not a live node a wire joins, or they are one. For a mission's own wires:
 * its Fleet to its board, its board to its Manager.
 */
export function withWireBetween(elements: readonly ExcalidrawElement[], fromId: string, toId: string, palette: ThemeChoice = currentPalette()): ExcalidrawElement[] {
  return withJoin(elements, fromId, toId, palette, {});
}

/**
 * `elements` with a talk wire from `fromId` to `toId` (dashed), unless a live
 * wire already joins them (`joiningWire`), one of them is not a terminal, a
 * Fleet or a Kanban board alive, or they are one. The scene itself when none is drawn.
 */
export function withTalkWire(elements: readonly ExcalidrawElement[], fromId: string, toId: string, palette: ThemeChoice = currentPalette()): readonly ExcalidrawElement[] {
  const from = elements.find((e) => e.id === fromId);
  const to = elements.find((e) => e.id === toId);
  if (!isTalker(from) || !isTalker(to)) return elements;
  const next = withJoin(elements, fromId, toId, palette, { talk: true });
  return next.length === elements.length ? elements : next;
}

function withJoin(elements: readonly ExcalidrawElement[], fromId: string, toId: string, palette: ThemeChoice, flags: WireFlags): ExcalidrawElement[] {
  const from = elements.find((e) => e.id === fromId);
  const to = elements.find((e) => e.id === toId);
  if (fromId === toId || !from || !to || !isWireEnd(from) || !isWireEnd(to) || joiningWire(elements, fromId, toId)) return [...elements];
  return addWire(elements, from, to, palette, flags);
}

/**
 * A wire read the way its light runs (`@/canvas/overlay/wirePaths`): from a
 * Fleet at either end, else from where it starts. `from` and `to` are its ends'
 * ids, `reversed` whether that is against the arrow.
 */
export function wireReading(start: string, end: string, isFleet: (id: string) => boolean): { from: string; to: string; reversed: boolean } {
  if (!isFleet(start) && isFleet(end)) return { from: end, to: start, reversed: true };
  return { from: start, to: end, reversed: false };
}

const isLiveTerminal = (element: ExcalidrawElement | undefined): element is ExcalidrawElement =>
  element !== undefined && !element.isDeleted && nodeKindOf(element) === "terminal";

/**
 * A wire whose two ends are live terminals: two agents linked to each other, by
 * an agent's "+ Link" or by spawn_agent (`isSpawnWire`). No mark tells it apart,
 * so the orphan upkeep and its undo keep it as they keep any wire; and it is
 * never a fleet's link: `fleetTargets` only follows arrows bound
 * to a fleet.
 */
export function isAgentLink(element: ExcalidrawElement, byId: ReadonlyMap<string, ExcalidrawElement>): boolean {
  if (element.isDeleted || element.type !== "arrow" || !isWire(element)) return false;
  const { startBinding, endBinding } = element as ExcalidrawArrowElement;
  if (!startBinding || !endBinding) return false;
  return isLiveTerminal(byId.get(startBinding.elementId)) && isLiveTerminal(byId.get(endBinding.elementId));
}

/** One agent linked to another: the agent at the other end, and whether the wire starts at the first one. */
export interface AgentLink {
  peerId: string;
  wireId: string;
  outgoing: boolean;
}

/** The agents wired to `agentId`, either way round: links are symmetric, deleting the wire cuts it. */
export function agentLinksOf(elements: readonly ExcalidrawElement[], agentId: string): AgentLink[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const links: AgentLink[] = [];
  for (const element of elements) {
    if (!isAgentLink(element, byId)) continue;
    const { startBinding, endBinding } = element as ExcalidrawArrowElement;
    const start = startBinding!.elementId;
    const end = endBinding!.elementId;
    if (start === end || (start !== agentId && end !== agentId)) continue;
    const peerId = start === agentId ? end : start;
    if (!links.some((l) => l.peerId === peerId)) links.push({ peerId, wireId: element.id, outgoing: start === agentId });
  }
  return links;
}

/**
 * `elements` with a wire from agent `fromId` to agent `toId`, unless they are
 * the same, one is not a live terminal, or a wire already joins them either way
 * round. Only wires count: an arrow drawn by hand between them links nothing.
 */
export function withAgentLink(elements: readonly ExcalidrawElement[], fromId: string, toId: string, palette: ThemeChoice = currentPalette()): ExcalidrawElement[] {
  const from = elements.find((e) => e.id === fromId);
  const to = elements.find((e) => e.id === toId);
  if (fromId === toId || !isLiveTerminal(from) || !isLiveTerminal(to)) return [...elements];
  if (agentLinksOf(elements, fromId).some((l) => l.peerId === toId)) return [...elements];
  return addWire(elements, from, to, palette, false);
}

const isLiveBoard = (element: ExcalidrawElement | undefined): element is ExcalidrawElement =>
  element !== undefined && !element.isDeleted && nodeKindOf(element) === "kanban";

const isLiveFleet = (element: ExcalidrawElement | undefined): element is ExcalidrawElement =>
  element !== undefined && !element.isDeleted && nodeKindOf(element) === "fleet";

/**
 * The Kanban boards wired to `nodeId`, an agent (a terminal) or a Fleet, either way round: the link the user draws
 * with "+ Link" gives the agent that board's cards (`@/mcp/boardTools`), and deleting the wire or the board cuts
 * it. A talk wire (drawn because a message passed) and a spawn wire link nobody: only a wire the user drew counts.
 * A mission's own wires (its Fleet to its board, its board to its Manager) are plain wires too: the tools that
 * write refuse a mission's board (`@/agents/boardLinks`).
 */
export function boardLinksOf(elements: readonly ExcalidrawElement[], nodeId: string): string[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const boards: string[] = [];
  for (const element of elements) {
    if (element.isDeleted || element.type !== "arrow" || !isWire(element) || isSpawnWire(element) || isTalkWire(element)) continue;
    const { startBinding, endBinding } = element as ExcalidrawArrowElement;
    if (!startBinding || !endBinding) continue;
    const start = byId.get(startBinding.elementId);
    const end = byId.get(endBinding.elementId);
    const [node, board] = isLiveBoard(end) ? [start, end] : [end, start];
    if (!isLiveBoard(board) || node?.id !== nodeId || (!isLiveTerminal(node) && !isLiveFleet(node))) continue;
    if (!boards.includes(board.id)) boards.push(board.id);
  }
  return boards;
}

/**
 * `elements` with a wire from agent (or Fleet) `agentId` to the Kanban board `boardId`, unless they are not what a
 * link joins or one already links them. A talk wire already joining them becomes the link (solid), as `withWire` does
 * for a Fleet's.
 */
export function withBoardLink(elements: readonly ExcalidrawElement[], agentId: string, boardId: string, palette: ThemeChoice = currentPalette()): ExcalidrawElement[] {
  const agent = elements.find((e) => e.id === agentId);
  const board = elements.find((e) => e.id === boardId);
  if (!isLiveBoard(board) || (!isLiveTerminal(agent) && !isLiveFleet(agent))) return [...elements];
  if (boardLinksOf(elements, agentId).includes(boardId)) return [...elements];
  return withWire(elements, agentId, boardId, palette);
}

/** What a click of "Link" designates on a Kanban board: the topmost board under the pointer. */
export function boardAt(elements: readonly ExcalidrawElement[], point: Point): string | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i];
    if (!isLiveBoard(e)) continue;
    if (point.x >= e.x && point.x <= e.x + e.width && point.y >= e.y && point.y <= e.y + e.height) return e.id;
  }
  return null;
}

/** Who spawned a terminal (its payload's `spawnedBy`); null or undefined for none. */
export type SpawnerOf = (nodeId: string) => string | null | undefined;

/** A spawn wire the scene lacks: from the agent to the sub-agent it spawned. */
export interface MissingSpawnWire {
  parentId: string;
  childId: string;
}

const pairOf = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);

/**
 * The spawn wires the scene lacks. A spawn wire shows a fact the nodes keep
 * (the child's `spawnedBy`), so each live terminal whose spawner is a live
 * terminal or Fleet of the same scene has one, unless a live arrow bound to both
 * already joins them, either way round: a "+ Link" is enough, and `withWire`
 * would not add a second. A closed spawner, or one in another workspace, gets
 * none: the child hangs from its nearest live ancestor without a wire.
 */
export function missingSpawnWires(elements: readonly ExcalidrawElement[], spawnerOf: SpawnerOf): MissingSpawnWire[] {
  const terminals = new Set(elements.filter(isLiveTerminal).map((e) => e.id));
  const spawners = new Set([...terminals, ...elements.filter((e) => !e.isDeleted && nodeKindOf(e) === "fleet").map((e) => e.id)]);
  const joined = new Set<string>();
  for (const element of elements) {
    if (element.isDeleted || element.type !== "arrow") continue;
    const { startBinding, endBinding } = element as ExcalidrawArrowElement;
    if (startBinding && endBinding) joined.add(pairOf(startBinding.elementId, endBinding.elementId));
  }
  const missing: MissingSpawnWire[] = [];
  for (const childId of terminals) {
    const parentId = spawnerOf(childId);
    if (!parentId || parentId === childId || !spawners.has(parentId) || joined.has(pairOf(parentId, childId))) continue;
    missing.push({ parentId, childId });
  }
  return missing;
}

/** `elements` with the spawn wires `missingSpawnWires` finds, and which were added; the scene itself when none is missing. */
export function withSpawnWires(
  elements: readonly ExcalidrawElement[],
  spawnerOf: SpawnerOf,
  palette: ThemeChoice = currentPalette(),
): { elements: readonly ExcalidrawElement[]; added: MissingSpawnWire[] } {
  let next = elements;
  const added: MissingSpawnWire[] = [];
  for (const wire of missingSpawnWires(elements, spawnerOf)) {
    const after = withWire(next, wire.parentId, wire.childId, palette, true);
    if (after.length === next.length) continue;
    next = after;
    added.push(wire);
  }
  return { elements: next, added };
}

/**
 * Live elements (not arrows: a wire binds to nodes and frames) that still list
 * a deleted wire as bound to them: the upkeep deletes a wire without touching
 * its ends (Excalidraw's own delete would take it off their lists).
 */
export function staleWireBindings(elements: readonly ExcalidrawElement[]): string[] {
  const gone = new Set(elements.filter((e) => e.isDeleted && e.type === "arrow" && isWire(e)).map((e) => e.id));
  if (gone.size === 0) return [];
  return elements.filter((e) => !e.isDeleted && e.type !== "arrow" && e.boundElements?.some((b) => gone.has(b.id))).map((e) => e.id);
}

/** Arrows drawn by hand between a fleet and a group or terminal: they get the wire mark (spec §13). */
export function unmarkedWires(elements: readonly ExcalidrawElement[]): string[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const fleets = elements.filter((e) => !e.isDeleted && nodeKindOf(e) === "fleet").map((e) => e.id);
  return elements
    .filter((e) => !e.isDeleted && e.type === "arrow" && !isWire(e))
    .filter((arrow) =>
      fleets.some((id) => {
        const otherId = otherEnd(arrow, id);
        return isWireTarget(otherId ? byId.get(otherId) : undefined);
      }),
    )
    .map((arrow) => arrow.id);
}

/**
 * The live wires still in the color another palette draws them in, which the
 * palette has left behind: a new palette, a scene saved under another one, an
 * undo or redo bringing back an older color. A color the user picked is none of
 * the palettes' and stays.
 */
export function outdatedWires(elements: readonly ExcalidrawElement[], palette: ThemeChoice): string[] {
  const current = wireColor(palette).toLowerCase();
  return elements
    .filter((e) => !e.isDeleted && e.type === "arrow" && isWire(e))
    .filter((wire) => wire.strokeColor.toLowerCase() !== current && isPaletteWireColor(wire.strokeColor))
    .map((wire) => wire.id);
}

/** What a click of "Link" designates: a lone terminal, else the group under the pointer (spec §13). */
export function linkTargetAt(elements: readonly ExcalidrawElement[], frames: readonly SceneFrame[], point: Point): string | null {
  const terminal = findTerminalAt(elements, point.x, point.y);
  if (terminal) {
    const group = frames.find((f) => f.group !== null && f.memberIds.includes(terminal.id));
    return group ? group.id : terminal.id;
  }
  return groupAt(frames, point)?.id ?? null;
}

/** What a click of an agent's "Link" designates: the topmost fleet under the pointer. */
export function fleetAt(elements: readonly ExcalidrawElement[], point: Point): string | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i];
    if (e.isDeleted || nodeKindOf(e) !== "fleet") continue;
    if (point.x >= e.x && point.x <= e.x + e.width && point.y >= e.y && point.y <= e.y + e.height) return e.id;
  }
  return null;
}

/** The agents a fleet commands. */
export interface LinkedAgents {
  groups: SceneFrame[];
  /** Terminals wired directly, outside the wired groups. */
  directIds: string[];
  agentIds: string[];
}

export function linkedAgents(links: Links, frames: readonly SceneFrame[]): LinkedAgents {
  const groups = links.groupIds.flatMap((id) => frames.filter((f) => f.id === id && f.group !== null));
  const inGroups = groups.flatMap((g) => g.memberIds);
  const directIds = links.nodeIds.filter((id) => !inGroups.includes(id));
  return { groups, directIds, agentIds: [...new Set([...inGroups, ...directIds])] };
}

/** `linkedAgents` the other way round: the fleets that command `agentId`, directly or through its group. */
export function fleetsOf(agentId: string, links: Readonly<Record<string, Links>>, frames: readonly SceneFrame[]): string[] {
  return Object.entries(links)
    .filter(([, wired]) => linkedAgents(wired, frames).agentIds.includes(agentId))
    .map(([fleetId]) => fleetId);
}

/** What a wire can still join: a fleet, a terminal, a group's frame, an agent's output (show_output) or a Kanban board (a mission's), alive. */
export function isWireEnd(element: ExcalidrawElement | undefined): boolean {
  if (element === undefined) return false;
  const kind = nodeKindOf(element);
  return kind === "fleet" || kind === "output" || kind === "kanban" ? !element.isDeleted : isWireTarget(element);
}

/**
 * Wires with a missing end: ungrouping, closing a group or a terminal and
 * Suppr on a fleet leave the arrow behind, unbound or bound to
 * what is gone (plan B3). They go in the same update.
 */
export function orphanWires(elements: readonly ExcalidrawElement[]): string[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  return elements
    .filter((e) => !e.isDeleted && e.type === "arrow" && isWire(e))
    .filter((arrow) => {
      const { startBinding, endBinding } = arrow as ExcalidrawArrowElement;
      return ![startBinding, endBinding].every((b) => b && isWireEnd(byId.get(b.elementId)));
    })
    .map((arrow) => arrow.id);
}

/** What a wire joins: an agent to the sub-agent it spawned, two ends a message passed between, a fleet to what it commands, or two agents linked by hand. */
export type WireKind = "spawn" | "talk" | "fleet" | "link";

export function wireKindOf(wire: ExcalidrawElement, byId: ReadonlyMap<string, ExcalidrawElement>): WireKind {
  if (isSpawnWire(wire)) return "spawn";
  if (isTalkWire(wire)) return "talk";
  const { startBinding, endBinding } = wire as ExcalidrawArrowElement;
  const atFleet = [startBinding, endBinding].some((b) => {
    const end = b ? byId.get(b.elementId) : undefined;
    return end !== undefined && nodeKindOf(end) === "fleet";
  });
  return atFleet ? "fleet" : "link";
}

/** What the canvas was doing when a wire went: the gesture that left it without an end. */
export interface CanvasMoment {
  selectedIds: readonly string[];
  dragging: boolean;
  tool: string;
}

/**
 * Why `orphanWires` takes a wire, for the log: its kind, then each end, and
 * what is wrong with the one that cannot hold it (unbound, missing from the
 * scene, deleted, or not something a wire joins); the live elements that still
 * list it as bound (an end Excalidraw unbound no longer does); and, given the
 * moment, the selection, a drag and the tool then. One line, as text: the log
 * file shows an object as "[object Object]".
 */
export function orphanReason(wire: ExcalidrawElement, byId: ReadonlyMap<string, ExcalidrawElement>, moment?: CanvasMoment): string {
  const { startBinding, endBinding } = wire as ExcalidrawArrowElement;
  const end = (side: "start" | "end", binding: { elementId: string } | null | undefined) => {
    if (!binding) return `${side} unbound`;
    const element = byId.get(binding.elementId);
    if (!element) return `${side} ${binding.elementId} missing`;
    if (element.isDeleted) return `${side} ${binding.elementId} deleted`;
    if (!isWireEnd(element)) return `${side} ${binding.elementId} not a valid end (${element.type}${nodeKindOf(element) ? ` ${nodeKindOf(element)}` : ""})`;
    return `${side} ${binding.elementId} ok`;
  };
  const listing = [...byId.values()].filter((e) => !e.isDeleted && e.boundElements?.some((b) => b.id === wire.id)).map((e) => e.id);
  const reason = `wire ${wire.id} (${wireKindOf(wire, byId)}) deleted as orphaned: ${end("start", startBinding)}; ${end("end", endBinding)}; listed by ${listing.length ? listing.join(", ") : "none"}`;
  if (!moment) return reason;
  const selected = new Set(moment.selectedIds);
  const frameSelected = moment.selectedIds.some((id) => byId.get(id)?.type === "frame");
  const yes = (on: boolean) => (on ? "yes" : "no");
  return `${reason}; selection ${selected.size} (wire ${yes(selected.has(wire.id))}, frame ${yes(frameSelected)}), dragging ${yes(moment.dragging)}, tool ${moment.tool}`;
}

/**
 * Wires `orphanWires` deleted whose two ends are back: an undo restored the
 * node (and, for Suppr, the binding) but not the wire, which was deleted
 * outside the history. Only those the upkeep marked: a wire the user deleted
 * stays deleted.
 */
export function revivableWires(elements: readonly ExcalidrawElement[]): string[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  // Two ends a live arrow joins already (a spawn wire re-created meanwhile, a wire drawn again): no second one.
  const joined = new Set<string>();
  for (const e of elements) {
    if (e.isDeleted || e.type !== "arrow") continue;
    const { startBinding, endBinding } = e as ExcalidrawArrowElement;
    if (startBinding && endBinding) joined.add(pairOf(startBinding.elementId, endBinding.elementId));
  }
  return elements
    .filter((e) => e.isDeleted && e.type === "arrow" && isWire(e) && (e.customData?.dummyplane as { orphaned?: unknown }).orphaned === true)
    .filter((arrow) => {
      const { startBinding, endBinding } = arrow as ExcalidrawArrowElement;
      return [startBinding, endBinding].every((b) => b && isWireEnd(byId.get(b.elementId))) && !joined.has(pairOf(startBinding!.elementId, endBinding!.elementId));
    })
    .map((arrow) => arrow.id);
}
