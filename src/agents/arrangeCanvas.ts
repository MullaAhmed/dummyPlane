import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { arrangeLayoutStore } from "@/app/arrangeLayoutSetting";
import { canvasStore } from "@/canvas/canvasStore";
import { isMinimized } from "@/nodes/terminal/minimize";
import { isManagerNode } from "@/store/nodes";
import { arrangedElements, type ArrangeScope } from "./arrange";
import type { ArrangeLayout } from "./arrangeLayout";
import { anchorsOf } from "./attachments";
import { sceneAccess } from "./sceneAccess";
import { spawnedBy } from "./spawnTree";
import { rerouteWires } from "./wires";

/**
 * Arranges a workspace's canvas (see ./arrange.ts) in the chosen layout (the
 * "Arrange layout" setting): the selection `only` when it holds two blocks or
 * more, else everything (or as `scope` asks: the whole canvas, or the selection
 * alone), attached items with their anchors (./attachments.ts), in `layout`
 * when one is asked for (the group's "Arrange as a tree"); the wires of
 * whatever moved routed again. Asked for by the user, one undoable step; by Auto-arrange,
 * outside the undo history (an undo must take back what the user did, not
 * the tidying after it). The user's Arrange in another layout than the tree
 * lays a tree it laid out downward back into its flowchart, its mark taken
 * off, in that step; Auto-arrange leaves it downward. False when nothing moved.
 */
export function arrangeWorkspace(workspaceId: string, options: { only?: readonly string[]; scope?: ArrangeScope; layout?: ArrangeLayout; undoable: boolean }): boolean {
  const scene = sceneAccess(workspaceId);
  if (!scene) return false;
  const { view } = canvasStore.getState();
  const elements = scene.elements();
  const result = arrangedElements({
    elements,
    parentOf: spawnedBy,
    isMinimized,
    attachedTo: anchorsOf(elements),
    only: options.only,
    scope: options.scope,
    layout: options.layout ?? arrangeLayoutStore.getState().layout,
    aspect: view.width > 0 && view.height > 0 ? view.width / view.height : undefined,
    clearTreeMarks: options.undoable,
    isDownRoot: isManagerNode,
  });
  if (!result) return false;
  const next = rerouteWires(result.elements, result.movedNodeIds);
  if (!scene.shown) {
    scene.write(next);
    return true;
  }
  const api = canvasStore.getState().api;
  if (!api) return false;
  api.updateScene({ elements: next, captureUpdate: options.undoable ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER });
  return true;
}
