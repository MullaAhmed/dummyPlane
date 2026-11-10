import type { CanvasView } from "@/canvas/canvasStore";
import type { Rect } from "@/canvas/groups";
import { NODE_SIZE, type NodeKind } from "@/canvas/nodeElement";
import type { Point } from "./terminals";

type Viewport = Pick<CanvasView, "scrollX" | "scrollY" | "zoom" | "offsetLeft" | "offsetTop">;

/** The scene point under a pointer given in client (window) coordinates. */
export function sceneOf(client: Point, view: Viewport): Point {
  return {
    x: (client.x - view.offsetLeft) / view.zoom - view.scrollX,
    y: (client.y - view.offsetTop) / view.zoom - view.scrollY,
  };
}

/** The window point of a scene point, the inverse of `sceneOf`. */
export function clientOf(scene: Point, view: Viewport): Point {
  return {
    x: (scene.x + view.scrollX) * view.zoom + view.offsetLeft,
    y: (scene.y + view.scrollY) * view.zoom + view.offsetTop,
  };
}

/** The scene point at the middle of the canvas ("New console"). */
export function viewportCenter(view: Viewport & Pick<CanvasView, "width" | "height">): Point {
  return sceneOf({ x: view.offsetLeft + view.width / 2, y: view.offsetTop + view.height / 2 }, view);
}

/** Screen rectangle of the node about to be placed, a terminal by default, centered on the pointer (spec theme §10.1). */
export function ghostRect(pointer: Point, zoom: number, kind: NodeKind = "terminal") {
  const width = NODE_SIZE[kind].width * zoom;
  const height = NODE_SIZE[kind].height * zoom;
  return { left: pointer.x - width / 2, top: pointer.y - height / 2, width, height };
}

/** Where a scene rectangle shows inside the canvas (Excalidraw's mapping, without the canvas offset). */
export function screenRectOf(rect: Rect, view: Viewport): Rect {
  return {
    x: (rect.x + view.scrollX) * view.zoom,
    y: (rect.y + view.scrollY) * view.zoom,
    width: rect.width * view.zoom,
    height: rect.height * view.zoom,
  };
}

/** Window rectangle of a scene rectangle: the ghost of a terminal snapped into a group cell. */
export function clientRectOf(rect: Rect, view: Viewport) {
  const screen = screenRectOf(rect, view);
  return { left: screen.x + view.offsetLeft, top: screen.y + view.offsetTop, width: screen.width, height: screen.height };
}
