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
 * The drawn elements of the selection, in scene order. OpenVibe's nodes are
 * embeddables and frames keep their own names and children: neither is drawn.
 */
export function drawnSelectionOf(elements: readonly ExcalidrawElement[], selected: Selected): ExcalidrawElement[] {
  return elements.filter((element) => selected[element.id] === true && isDrawn(element));
}

/** The same elements, same versions: the store keeps the old array when nothing moved. */
export function sameDrawn(a: readonly ExcalidrawElement[], b: readonly ExcalidrawElement[]): boolean {
  return a.length === b.length && a.every((element, i) => element.id === b[i].id && element.version === b[i].version);
}

export type Restyle = { strokeColor: string } | { backgroundColor: string };

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

/** The whole scene with `patch` on the selected drawn elements; everything else is returned as it was. */
export function restyleSelection(elements: readonly ExcalidrawElement[], selected: Selected, patch: Restyle): ExcalidrawElement[] {
  const ids = new Set(drawnSelectionOf(elements, selected).map((element) => element.id));
  return elements.map((element) => (ids.has(element.id) ? revise(element, patch) : element));
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
