import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * What the small selection panel acts on. Excalidraw's own properties panel is
 * hidden (excalidraw.css), so these rules decide which selected elements the
 * panel restyles, duplicates and deletes.
 */

type Selected = Readonly<Record<string, true>>;

/** A drawn element: a shape, a line, an arrow, a text, a freedraw stroke, an image. */
export function isDrawn(element: ExcalidrawElement): boolean {
  return !element.isDeleted && element.type !== "embeddable" && element.type !== "frame" && element.type !== "magicframe";
}

/**
 * The drawn elements of the selection, in scene order. dummyPlane's nodes are
 * embeddables and frames keep their own names and children: neither is drawn.
 */
export function drawnSelectionOf(elements: readonly ExcalidrawElement[], selected: Selected): ExcalidrawElement[] {
  return elements.filter((element) => selected[element.id] === true && isDrawn(element));
}

/** The same elements, same versions: the store keeps the old array when nothing moved. */
export function sameDrawn(a: readonly ExcalidrawElement[], b: readonly ExcalidrawElement[]): boolean {
  return a.length === b.length && a.every((element, i) => element.id === b[i].id && element.version === b[i].version);
}

export type Roughness = 0 | 1 | 2;
export type ArrowType = "sharp" | "round" | "elbow";

export type Restyle =
  | { strokeColor: string }
  | { backgroundColor: string }
  | { roughness: Roughness }
  | { arrowType: ArrowType };

/** A connection stroke: a line or an arrow. Sloppiness applies to these only. */
export function isConnector(element: ExcalidrawElement): boolean {
  return element.type === "arrow" || element.type === "line";
}

/** How an arrow bends: elbowed, curved (rounded) or straight between its points. */
export function arrowTypeOf(element: ExcalidrawElement): ArrowType {
  const arrow = element as { elbowed?: boolean; roundness?: unknown };
  if (arrow.elbowed) return "elbow";
  return arrow.roundness ? "round" : "sharp";
}

/** The sloppiness shown for a connection stroke: Excalidraw's roughness, 0 (clean) to 2 (rough). */
export function roughnessOf(element: ExcalidrawElement): Roughness {
  const roughness = (element as { roughness?: number }).roughness;
  return roughness === 1 || roughness === 2 ? roughness : 0;
}

type Point = readonly [number, number];
type Binding = { elementId: string; focus: number; gap: number; fixedPoint?: readonly [number, number] };
type Arrow = ExcalidrawElement & { points: readonly Point[]; startBinding: Binding | null; endBinding: Binding | null; elbowed?: boolean };

/** Excalidraw's PROPORTIONAL_RADIUS roundness: the line curves through its points. */
const ROUND = { type: 2 };

/**
 * An elbow arrow places its ends by a ratio inside the element each end is bound
 * to. An arrow made by hand or by a wire has none, so it is read off where the
 * end sits now, kept inside the element: the elbow leaves the same side.
 */
function withFixedPoint(arrow: Arrow, end: "start" | "end", byId: ReadonlyMap<string, ExcalidrawElement>): Binding | null {
  const binding = end === "start" ? arrow.startBinding : arrow.endBinding;
  const target = binding && byId.get(binding.elementId);
  if (!binding || !target || target.width === 0 || target.height === 0) return binding;
  const point = end === "start" ? arrow.points[0] : arrow.points[arrow.points.length - 1];
  const clamp = (ratio: number) => Math.min(1, Math.max(0, ratio));
  return {
    ...binding,
    fixedPoint: [clamp((arrow.x + point[0] - target.x) / target.width), clamp((arrow.y + point[1] - target.y) / target.height)],
  };
}

/**
 * What switches `arrow` to `type`, as Excalidraw's own "arrow type" does: an
 * elbow keeps only its two ends (Excalidraw routes it from them), a bent arrow
 * keeps its points, and the roundness tells round from sharp.
 */
function arrowTypePatch(arrow: Arrow, type: ArrowType, byId: ReadonlyMap<string, ExcalidrawElement>): Record<string, unknown> {
  const ends = type === "elbow" || arrow.elbowed ? [arrow.points[0], arrow.points[arrow.points.length - 1]] : arrow.points;
  const xs = ends.map(([x]) => x);
  const ys = ends.map(([, y]) => y);
  const patch: Record<string, unknown> = {
    roundness: type === "round" ? ROUND : null,
    elbowed: type === "elbow",
    points: ends,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  if (type === "elbow") {
    patch.startBinding = withFixedPoint(arrow, "start", byId);
    patch.endBinding = withFixedPoint(arrow, "end", byId);
  }
  return patch;
}

/** A new version of `element` with `patch`: what Excalidraw's `newElementWith` does, undoable as a change. */
function revise(element: ExcalidrawElement, patch: Record<string, unknown>): ExcalidrawElement {
  return {
    ...element,
    ...patch,
    version: element.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  } as ExcalidrawElement;
}

/** What `restyle` changes on `element`; null when it does not apply there (sloppiness: connection strokes; arrow type: arrows). */
function restylePatch(
  element: ExcalidrawElement,
  restyle: Restyle,
  byId: ReadonlyMap<string, ExcalidrawElement>,
): Record<string, unknown> | null {
  if ("roughness" in restyle) return isConnector(element) ? { roughness: restyle.roughness } : null;
  if ("arrowType" in restyle) return element.type === "arrow" ? arrowTypePatch(element as Arrow, restyle.arrowType, byId) : null;
  return restyle;
}

/** The whole scene with `patch` on the selected drawn elements it applies to; everything else is returned as it was. */
export function restyleSelection(elements: readonly ExcalidrawElement[], selected: Selected, patch: Restyle): ExcalidrawElement[] {
  const ids = new Set(drawnSelectionOf(elements, selected).map((element) => element.id));
  const byId = new Map(elements.map((element) => [element.id, element]));
  return elements.map((element) => {
    const change = ids.has(element.id) ? restylePatch(element, patch, byId) : null;
    return change ? revise(element, change) : element;
  });
}

/** Soft-deletes the selected drawn elements, and the texts bound inside them, as Excalidraw's delete does. */
export function deleteSelection(elements: readonly ExcalidrawElement[], selected: Selected): ExcalidrawElement[] {
  const ids = new Set(drawnSelectionOf(elements, selected).map((element) => element.id));
  for (const element of elements) {
    if (element.isDeleted) continue;
    const container = (element as { containerId?: string | null }).containerId;
    if (container && ids.has(container)) ids.add(element.id);
  }
  return elements.map((element) => (ids.has(element.id) && !element.isDeleted ? revise(element, { isDeleted: true }) : element));
}

export interface Duplicate {
  /** The whole scene, the copies appended on top. */
  elements: ExcalidrawElement[];
  /** Ids of the copies, to select them. Empty when nothing drawn was selected. */
  copies: string[];
}

/**
 * Copies the selected drawn elements, shifted by `offset`. Ids, group ids and
 * bindings are renamed to the copies; a binding to something not copied is
 * dropped, so a copy never attaches to the original it was made from.
 */
export function duplicateSelection(
  elements: readonly ExcalidrawElement[],
  selected: Selected,
  { offset, newId }: { offset: number; newId: () => string },
): Duplicate {
  const sources = drawnSelectionOf(elements, selected);
  if (sources.length === 0) return { elements: [...elements], copies: [] };

  const copyOf = new Map(sources.map((element) => [element.id, newId()]));
  const groupOf = new Map<string, string>();
  const group = (id: string) => {
    let next = groupOf.get(id);
    if (!next) {
      next = newId();
      groupOf.set(id, next);
    }
    return next;
  };
  const rebind = (binding: { elementId: string } | null | undefined) =>
    binding && copyOf.has(binding.elementId) ? { ...binding, elementId: copyOf.get(binding.elementId)! } : null;

  const copies = sources.map((element) => {
    const linked = element as {
      containerId?: string | null;
      startBinding?: { elementId: string } | null;
      endBinding?: { elementId: string } | null;
      boundElements?: readonly { id: string; type: string }[] | null;
    };
    const patch: Record<string, unknown> = {
      id: copyOf.get(element.id),
      x: element.x + offset,
      y: element.y + offset,
      index: null,
      groupIds: element.groupIds.map(group),
      frameId: null,
      boundElements: linked.boundElements?.filter((b) => copyOf.has(b.id)).map((b) => ({ ...b, id: copyOf.get(b.id)! })) || null,
    };
    if ("containerId" in linked) patch.containerId = linked.containerId && copyOf.has(linked.containerId) ? copyOf.get(linked.containerId) : null;
    if ("startBinding" in linked) patch.startBinding = rebind(linked.startBinding);
    if ("endBinding" in linked) patch.endBinding = rebind(linked.endBinding);
    return revise(element, patch);
  });

  return { elements: [...elements, ...copies], copies: copies.map((element) => element.id) };
}
