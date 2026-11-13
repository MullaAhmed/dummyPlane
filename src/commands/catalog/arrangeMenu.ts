import type { ArrangeTarget } from "@/agents/arrangeAs";
import { clientOf } from "@/agents/placement";
import { canvasStore } from "@/canvas/canvasStore";
import type { CommandContext } from "../command";
import { requestUi } from "../uiRequests";

/**
 * Asks for the list of layouts of an "Arrange as…" (src/agents/ArrangeLayoutMenu.tsx) for `target`: at the point of the
 * radial menu's press, else the middle of the canvas. Nothing is arranged until a layout is picked.
 */
export function askArrangeLayout(ctx: CommandContext, target: ArrangeTarget) {
  if (!ctx.workspaceId) return;
  const { view } = canvasStore.getState();
  const at = ctx.at ? clientOf(ctx.at, view) : { x: view.offsetLeft + view.width / 2, y: view.offsetTop + view.height / 2 };
  requestUi({ kind: "arrangeMenu", workspaceId: ctx.workspaceId, target, at });
}
