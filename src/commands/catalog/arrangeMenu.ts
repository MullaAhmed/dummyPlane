import type { ArrangeTarget } from "@/agents/arrangeAs";
import type { CommandContext } from "../command";
import { requestUi } from "../uiRequests";
import { windowPointOf } from "./menuPoint";

/**
 * Asks for the list of layouts of an "Arrange as…" (src/agents/ArrangeLayoutMenu.tsx) for `target`: at the point of the
 * radial menu's press, else the middle of the canvas. Nothing is arranged until a layout is picked.
 */
export function askArrangeLayout(ctx: CommandContext, target: ArrangeTarget) {
  if (!ctx.workspaceId) return;
  requestUi({ kind: "arrangeMenu", workspaceId: ctx.workspaceId, target, at: windowPointOf(ctx) });
}
