import { canvasStore, type CanvasView } from "@/canvas/canvasStore";
import type { Rect } from "@/canvas/groups";
import { laneOccupied } from "@/shell/lane";
import { LANE_ROOM } from "@/shell/layout";
import { workspacesStore } from "@/store/workspaces";
import { sceneOf } from "./placement";

/**
 * The scene box an occupied lane covers as the view stands: the work area's right inset (the lane, its gap and the
 * activity rail), the canvas's height. None while the lane is free or the view is not measured yet.
 */
export function laneCover(view: Pick<CanvasView, "scrollX" | "scrollY" | "zoom" | "offsetLeft" | "offsetTop" | "width" | "height">, occupied: boolean): Rect | null {
  if (!occupied || view.width === 0 || view.height === 0 || view.zoom <= 0) return null;
  const corner = sceneOf({ x: view.offsetLeft + view.width - LANE_ROOM, y: view.offsetTop }, view);
  return { x: corner.x, y: corner.y, width: LANE_ROOM / view.zoom, height: view.height / view.zoom };
}

/**
 * What a node arriving on its own beside another (a sub-agent, an agent's output) keeps out from under, in the
 * workspace `workspaceId`: the occupied lane on the canvas on screen, where it would land behind the Agents panel or
 * the Edit panel. It moves to the nearest spot clear of it (groupLayout's `freeSpot`), out of view when that is nearer:
 * it starts there all the same, and its arrival notice shows it. Nothing on another workspace's canvas.
 */
export function laneCovers(workspaceId: string): Rect[] {
  if (workspacesStore.getState().activeId !== workspaceId) return [];
  const cover = laneCover(canvasStore.getState().view, laneOccupied());
  return cover ? [cover] : [];
}
