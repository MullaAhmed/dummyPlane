import { setArrangeLayout } from "@/app/arrangeLayoutSetting";
import { arrangeCoversCanvas, arrangeWorkspace } from "./arrangeCanvas";
import type { ArrangeLayout } from "./arrangeLayout";

/** What an "Arrange as…" is asked of: the scene (the selection `only` when it holds several elements or lies in one group, else the canvas), or one group. */
export type ArrangeTarget = { kind: "scene"; only: readonly string[] } | { kind: "group"; id: string };

/**
 * Arranges `target` in `layout`, one undoable step. Picked for the whole canvas, the layout is also the "Arrange layout"
 * setting, so Auto-arrange, the next Arrange and the Settings row agree with it; picked for a group or a selection, it
 * is for this arrange alone and the setting stays as it is.
 */
export function arrangeAs(workspaceId: string, target: ArrangeTarget, layout: ArrangeLayout) {
  if (target.kind === "group") {
    arrangeWorkspace(workspaceId, { only: [target.id], layout, undoable: true });
    return;
  }
  // Before the arrange reads it: the store has the choice at once (its saving is awaited, and reports its own failure).
  if (arrangeCoversCanvas(workspaceId, target.only)) void setArrangeLayout(layout);
  arrangeWorkspace(workspaceId, { only: target.only, layout, undoable: true });
}
