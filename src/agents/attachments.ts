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
 * - an item outside the frame of its anchor's group never becomes a member of
 *   it (closing, ungrouping and the grid's free cells go by the frame). It
 *   stays outside the frame and goes with the side of the frame it stands by,
 *   as the frame fits its members again; or, `beside`, it keeps its place
 *   beside its anchor wherever that goes in the grid, and the grid makes room
 *   for it there (a quick note, which its own watch keeps beside its host);
 * - on the canvas, the item and its anchor's block (a group, a spawn tree, a
 *   node alone) move together.
 *
 * A feature plugs in one of two ways: its element names its anchor in
 * `customData.attachedTo` (nothing else to do), or it adds a rule to
 * ANCHOR_RULES, which may read the scene or a store (an output's source agent
 * is in its node's payload).
 */

/** An item's anchor, and how it goes with it in a group (see above). */
export interface Attachment {
  anchor: string;
  beside?: boolean;
}

/** What `element` is attached to, read from `scene` (the live elements by id) or elsewhere: an anchor's id, or an Attachment; null for none. */
export type AnchorRule = (element: ExcalidrawElement, scene: ReadonlyMap<string, ExcalidrawElement>) => string | Attachment | null | undefined;

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
 * A quick note (src/nodes/note): kept beside the terminal or Fleet it was
 * written for, its host, whose id its element keeps in `customData.note.of`.
 */
export const noteHost: AnchorRule = (element) => {
  if (nodeKindOf(element) !== "note") return null;
  const of = (element.customData?.note as { of?: unknown } | undefined)?.of;
  return typeof of === "string" ? { anchor: of, beside: true } : null;
};

/** Every rule; the first that names a live element wins. */
export const ANCHOR_RULES: readonly AnchorRule[] = [markedAnchor, outputSource, noteHost];

/**
 * For Arrange: what each element of `elements` is attached to, by `rules`.
 * Only a live element other than the item itself counts as an anchor.
 */
export function anchorsOf(elements: readonly ExcalidrawElement[], rules: readonly AnchorRule[] = ANCHOR_RULES): (element: ExcalidrawElement) => Attachment | null {
  const scene = new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  return (element) => {
    for (const rule of rules) {
      const found = rule(element, scene);
      const attachment = typeof found === "string" ? { anchor: found } : found;
      if (attachment && attachment.anchor !== element.id && scene.has(attachment.anchor)) return attachment;
    }
    return null;
  };
}
