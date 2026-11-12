import type { ReactNode } from "react";
import { useCanvas, useCanvasPlace, type CanvasPlace } from "../canvasStore";

/**
 * The scene's own units, scrolled and scaled like the nodes: a point (x, y) of
 * the scene shows at ((x + scrollX) × zoom, (y + scrollY) × zoom), where
 * `screenRectOf` puts it. What it holds comes in as `children`, made by the
 * overlay: a pan or a zoom draws this layer again, and leaves them as they are.
 */
export function SceneLayer({ children }: { children: ReactNode }) {
  const { scrollX, scrollY, zoom } = useCanvasPlace();
  return (
    <div className="absolute left-0 top-0" style={{ transform: `scale(${zoom}) translate(${scrollX}px, ${scrollY}px)`, transformOrigin: "0 0" }}>
      {children}
    </div>
  );
}

/**
 * Scrolled like the nodes, not scaled: what it holds is placed at the view's
 * zoom (a scene point x at x × zoom, `screenRectOf` without the scroll) and keeps
 * its own sizes, a 1px border or a 12px label, at any zoom. A pan draws this
 * layer again, and leaves its `children` as they are; a zoom draws them again.
 */
export function ScrollLayer({ children }: { children: ReactNode }) {
  const scrollX = useCanvas((s) => s.view.scrollX);
  const scrollY = useCanvas((s) => s.view.scrollY);
  const zoom = useCanvas((s) => s.view.zoom);
  return (
    <div className="absolute left-0 top-0" style={{ transform: `translate(${scrollX * zoom}px, ${scrollY * zoom}px)` }}>
      {children}
    </div>
  );
}

/** The view a ScrollLayer's children are placed with (`screenRectOf`): the view's zoom, the layer adding the scroll. */
export function scrollLayerPlace(zoom: number): CanvasPlace {
  return { scrollX: 0, scrollY: 0, zoom, offsetLeft: 0, offsetTop: 0 };
}
