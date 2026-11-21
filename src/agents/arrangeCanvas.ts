import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { arrangeLayoutStore } from "@/app/arrangeLayoutSetting";
import { canvasStore } from "@/canvas/canvasStore";
import { isMinimized } from "@/nodes/terminal/minimize";
import { isManagerNode } from "@/store/nodes";
import { arrangedElements, arrangesWholeCanvas, type ArrangeInput, type ArrangeScope } from "./arrange";
import type { ArrangeLayout } from "./arrangeLayout";
import { anchorsOf } from "./attachments";
import { sceneAccess } from "./sceneAccess";
import { spawnedBy } from "./spawnTree";
import { rerouteWires } from "./wires";

/** What an arrange of `elements` reads: the scene, the selection asked for, and the layout (the setting's when none is given). */
function arrangeInput(
  elements: readonly ExcalidrawElement[],
  options: { only?: readonly string[]; scope?: ArrangeScope; layout?: ArrangeLayout; undoable: boolean },
): ArrangeInput {
  const { view } = canvasStore.getState();
  return {
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
  };
}

/**
 * Whether an Arrange of `only` (as the palette's Arrange asks it: the selection when it holds several elements or lies in
 * one group, else the canvas) takes the whole canvas of this workspace, whether or not anything would move. False without a scene.
 */
export function arrangeCoversCanvas(workspaceId: string, only?: readonly string[]): boolean {
  const scene = sceneAccess(workspaceId);
  return scene !== null && arrangesWholeCanvas(arrangeInput(scene.elements(), { only, undoable: true }));
}

/**
 * Arranges a workspace's canvas (see ./arrange.ts) in the chosen layout (the
 * "Arrange layout" setting): the selection `only` when it holds several elements
 * (never the whole canvas then, even for one block), else everything (or as `scope` asks: the whole canvas, or the selection
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
  const result = arrangedElements(arrangeInput(scene.elements(), options));
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
