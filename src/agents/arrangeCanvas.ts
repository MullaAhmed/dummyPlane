import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { canvasStore } from "@/canvas/canvasStore";
import { isMinimized } from "@/nodes/terminal/minimize";
import { arrangedElements } from "./arrange";
import { anchorsOf } from "./attachments";
import { sceneAccess } from "./sceneAccess";
import { spawnedBy } from "./spawnTree";
import { rerouteWires } from "./wires";

/**
 * Arranges a workspace's canvas (see ./arrange.ts): the selection `only` when
 * it holds two blocks or more, else everything, attached items with their
 * anchors (./attachments.ts); the wires of whatever moved routed again. Asked for by the user, one undoable step; by Auto-arrange,
 * outside the undo history (an undo must take back what the user did, not
 * the tidying after it). False when nothing moved.
 */
export function arrangeWorkspace(workspaceId: string, options: { only?: readonly string[]; undoable: boolean }): boolean {
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
    aspect: view.width > 0 && view.height > 0 ? view.width / view.height : undefined,
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
