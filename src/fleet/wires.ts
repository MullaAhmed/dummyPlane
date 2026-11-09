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
import type { Point } from "./terminals";

/**
 * Electric's lime (#B6F52B) is beyond what the dark filter can show: stored the
 * plain inverse way (#003800) it shows #a8d8a8, a pale mint. The nearest of all
 * 8-bit colors, #546100, shows #9fab57: an olive of the accent's own hue.
 */
const ELECTRIC_WIRE_SCENE = "#546100";

/**
 * The color a wire is stored in under `palette`: the palette's accent
 * (`--dp-accent`, the color the light running on the wire is drawn in) as the
 * canvas must show it. A light palette shows a stored color as is; Excalidraw's
 * dark filter shows the nearest it can to the accent (spec habillage §4.3), so
 * the accent goes through `toSceneColor` there: expressive's #FF781B is stored
 * #F25500 and shown #FC752C.
 */
export function wireColor(palette: ThemeChoice): string {
  if (palette === "electric") return ELECTRIC_WIRE_SCENE;
  const { accent, scheme } = PALETTES[palette];
  return sceneColorFor(accent, scheme);
}

/** Whether `color` is the color some palette draws a wire in: one the user did not pick. */
function isPaletteWireColor(color: string): boolean {
  const stored = color.toLowerCase();
  return (Object.keys(PALETTES) as ThemeChoice[]).some((palette) => wireColor(palette).toLowerCase() === stored);
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

/** What an orchestrator is wired to. */
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
 * A wire from an agent to the sub-agent it opened with spawn_agent, its start
 * bound to the parent: no orchestrator at either end, and the upkeep keeps the
 * mark through an orphaning and its undo.
 */
export function isSpawnWire(element: ExcalidrawElement): boolean {
  const data = element.customData?.dummyplane as { kind?: unknown; spawn?: unknown } | undefined;
  return data?.kind === "wire" && data.spawn === true;
}

/** What an orchestrator can be wired to: a group's frame or a terminal (not a plain frame). */
function isWireTarget(element: ExcalidrawElement | undefined): element is ExcalidrawElement {
  return element !== undefined && !element.isDeleted && (groupInfoOf(element) !== null || nodeKindOf(element) === "terminal");
}

/** The element at the other end of an arrow bound to `orchestratorId`, either way round. */
function otherEnd(arrow: ExcalidrawElement, orchestratorId: string): string | null {
  if (arrow.type !== "arrow") return null;
  const start = arrow.startBinding?.elementId;
  const end = arrow.endBinding?.elementId;
  if (start === orchestratorId) return end ?? null;
  if (end === orchestratorId) return start ?? null;
  return null;
}

/**
 * The groups and terminals wired to an orchestrator, from the arrows of the
 * scene: deleting an arrow or its target cuts the link (spec §13).
 */
export function orchestratorTargets(elements: readonly ExcalidrawElement[], orchestratorId: string): Links {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const links: Links = { groupIds: [], nodeIds: [] };
  for (const element of elements) {
    if (element.isDeleted) continue;
    const otherId = otherEnd(element, orchestratorId);
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

/** The links of every orchestrator of the scene. */
export function orchestratorLinks(elements: readonly ExcalidrawElement[]): Record<string, Links> {
  return Object.fromEntries(
    elements
      .filter((e) => !e.isDeleted && nodeKindOf(e) === "orchestrator")
      .map((o) => [o.id, orchestratorTargets(elements, o.id)]),
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
 * orchestrator dropped on a group's frame) are both reached on the side of
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

type ElbowForm = Pick<
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
 * routes it again from those fixed points whenever one of the two moves.
 */
function elbowForm(from: ExcalidrawElement, to: ExcalidrawElement): ElbowForm {
  const sides = wireSides(from, to);
  const startPoint = fixedPointOf(from, sides[0]);
  const endPoint = fixedPointOf(to, sides[1]);
  const start = scenePoint(from, startPoint);
  const points = route(start, sides, scenePoint(to, endPoint));
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
 * A complete elbow arrow from the side of `orchestrator` facing `target` to the
 * side of `target` facing it, without heads, in the color of `palette` (spec §13). Every base field is set
 * here, as for the nodes (Excalidraw's skeletons cannot bind to existing
 * elements). With `spawn`, `orchestrator` is an agent and `target` the
 * sub-agent it spawned (`isSpawnWire`).
 */
export function createWire(
  orchestrator: ExcalidrawElement,
  target: ExcalidrawElement,
  palette: ThemeChoice = currentPalette(),
  spawn = false,
): ExcalidrawElbowArrowElement {
  return {
    id: crypto.randomUUID(),
    type: "arrow",
    strokeColor: wireColor(palette),
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
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
    customData: { dummyplane: spawn ? { kind: "wire", spawn: true } : { kind: "wire" } },
    ...elbowForm(orchestrator, target),
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
      ...elbowForm(from, to),
      strokeColor,
      version: wire.version + 1,
      versionNonce: random(),
      updated: Date.now(),
    };
    return elbow;
  });
  return changed ? next : elements;
}

/** `elements` with a new wire, recorded on both ends, unless one already joins them (spec §13); `spawn` as for `createWire`. */
export function withWire(
  elements: readonly ExcalidrawElement[],
  orchestratorId: string,
  targetId: string,
  palette: ThemeChoice = currentPalette(),
  spawn = false,
): ExcalidrawElement[] {
  const orchestrator = elements.find((e) => e.id === orchestratorId && !e.isDeleted);
  const target = elements.find((e) => e.id === targetId && !e.isDeleted);
  if (!orchestrator || !target) return [...elements];
  const links = orchestratorTargets(elements, orchestratorId);
  if (links.groupIds.includes(targetId) || links.nodeIds.includes(targetId)) return [...elements];
  const wire = createWire(orchestrator, target, palette, spawn);
  const bind = (e: ExcalidrawElement): ExcalidrawElement => ({
    ...e,
    boundElements: [...(e.boundElements ?? []), { id: wire.id, type: "arrow" }],
    version: e.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  });
  return [...elements.map((e) => (e.id === orchestratorId || e.id === targetId ? bind(e) : e)), wire];
}

/** Arrows drawn by hand between an orchestrator and a group or terminal: they get the wire mark (spec §13). */
export function unmarkedWires(elements: readonly ExcalidrawElement[]): string[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const orchestrators = elements.filter((e) => !e.isDeleted && nodeKindOf(e) === "orchestrator").map((e) => e.id);
  return elements
    .filter((e) => !e.isDeleted && e.type === "arrow" && !isWire(e))
    .filter((arrow) =>
      orchestrators.some((id) => {
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

/** The agents an orchestrator commands. */
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

/** What a wire can still join: an orchestrator, a terminal or a group's frame, alive. */
function isWireEnd(element: ExcalidrawElement | undefined): boolean {
  return element !== undefined && (nodeKindOf(element) === "orchestrator" ? !element.isDeleted : isWireTarget(element));
}

/**
 * Wires with a missing end: ungrouping, closing a group or a terminal and
 * Suppr on an orchestrator leave the arrow behind, unbound or bound to
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

/**
 * Wires `orphanWires` deleted whose two ends are back: an undo restored the
 * node (and, for Suppr, the binding) but not the wire, which was deleted
 * outside the history. Only those the upkeep marked: a wire the user deleted
 * stays deleted.
 */
export function revivableWires(elements: readonly ExcalidrawElement[]): string[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  return elements
    .filter((e) => e.isDeleted && e.type === "arrow" && isWire(e) && (e.customData?.dummyplane as { orphaned?: unknown }).orphaned === true)
    .filter((arrow) => {
      const { startBinding, endBinding } = arrow as ExcalidrawArrowElement;
      return [startBinding, endBinding].every((b) => b && isWireEnd(byId.get(b.elementId)));
    })
    .map((arrow) => arrow.id);
}
