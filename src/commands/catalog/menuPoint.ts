import { clientOf } from "@/agents/placement";
import type { Point } from "@/agents/terminals";
import { canvasStore } from "@/canvas/canvasStore";
import type { CommandContext } from "../command";

/**
 * The point of the window a list of the canvas (src/agents/PointMenu.tsx) opens at: where the radial menu was pressed, else
 * the middle of the canvas (from the palette).
 */
export function windowPointOf(ctx: CommandContext): Point {
  const { view } = canvasStore.getState();
  return ctx.at ? clientOf(ctx.at, view) : { x: view.offsetLeft + view.width / 2, y: view.offsetTop + view.height / 2 };
}
