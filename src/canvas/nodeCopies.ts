import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

const LINK = /^dummyplane:\/\/[a-z]+\/([\w-]+)$/;

/** The node id an dummyPlane embeddable points to, or null. */
export function sourceIdOf(link: string | null | undefined): string | null {
  return LINK.exec(link ?? "")?.[1] ?? null;
}

export interface AddedNodes {
  /** Undo of a deletion: the node's record is still in memory. */
  restored: string[];
  /** Ctrl+D, copy-paste or Alt+drag: a new element pointing to an existing node. */
  copies: { id: string; sourceId: string }[];
  /** Nothing to show (pasted from another session, imported). */
  orphans: string[];
}

/** How new node elements arrived on the canvas (spec habillage §7.5). */
export function classifyAddedNodes(
  ids: readonly string[],
  elements: readonly ExcalidrawElement[],
  hasRecord: (id: string) => boolean,
): AddedNodes {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const result: AddedNodes = { restored: [], copies: [], orphans: [] };
  for (const id of ids) {
    if (hasRecord(id)) {
      result.restored.push(id);
      continue;
    }
    const sourceId = sourceIdOf(byId.get(id)?.link);
    if (sourceId && sourceId !== id && hasRecord(sourceId)) result.copies.push({ id, sourceId });
    else result.orphans.push(id);
  }
  return result;
}
