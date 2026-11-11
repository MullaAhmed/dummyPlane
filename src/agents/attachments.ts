import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { nodeKindOf } from "@/canvas/nodeElement";
import { nodesStore } from "@/store/nodes";

/**
 * Items attached to an anchor: a quick note beside its terminal, the output an
 * agent showed beside itself. Arrange (./arrange.ts) moves an item with its
 * anchor as one block:
 *
 * - inside a group, an item in its anchor's frame shares the anchor's place in
 *   the grid, where it stood beside it;
 * - an item outside the frame of its anchor's group stays outside it (it does
 *   not become a member: closing, ungrouping and the grid's free cells go by
 *   the frame) and moves with that side of the frame as the frame fits its
 *   members again;
 * - on the canvas, the item and its anchor's block (a group, a spawn tree, a
 *   node alone) move together.
 *
 * A feature plugs in one of two ways: its element names its anchor in
 * `customData.attachedTo` (nothing else to do), or it adds a rule to
 * ANCHOR_RULES, which may read the scene or a store (an output's source agent
 * is in its node's payload, and its wire).
 */

/** The id of the element `element` is attached to, read from `scene` (the live elements by id) or elsewhere; null for none. */
export type AnchorRule = (element: ExcalidrawElement, scene: ReadonlyMap<string, ExcalidrawElement>) => string | null | undefined;

/** The plainest plug: the item's element names its anchor's id in `customData.attachedTo`. */
export const markedAnchor: AnchorRule = (element) => {
  const id = element.customData?.attachedTo;
  return typeof id === "string" ? id : null;
};

/** What an agent showed with show_output (src/nodes/output): attached to that agent, its payload's source. */
export const outputSource: AnchorRule = (element) => {
  if (nodeKindOf(element) !== "output") return null;
  const record = nodesStore.getState().nodes[element.id];
  return record?.kind === "output" ? record.payload.source : null;
};

/**
 * A quick note (src/nodes/note): attached to the terminal or Fleet it stands
 * beside, its host, whose id its element keeps in `customData.note.of`.
 */
export const noteHost: AnchorRule = (element) => {
  if (nodeKindOf(element) !== "note") return null;
  const of = (element.customData?.note as { of?: unknown } | undefined)?.of;
  return typeof of === "string" ? of : null;
};

/** Every rule; the first that names a live element wins. */
export const ANCHOR_RULES: readonly AnchorRule[] = [markedAnchor, outputSource, noteHost];

/**
 * For Arrange: the anchor of each element of `elements`, by `rules`. Only a
 * live element other than the item itself counts as an anchor.
 */
export function anchorsOf(elements: readonly ExcalidrawElement[], rules: readonly AnchorRule[] = ANCHOR_RULES): (element: ExcalidrawElement) => string | null {
  const scene = new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  return (element) => {
    for (const rule of rules) {
      const id = rule(element, scene);
      if (id && id !== element.id && scene.has(id)) return id;
    }
    return null;
  };
}
