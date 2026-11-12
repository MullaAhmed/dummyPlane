import { useEffect, type RefObject } from "react";
import { canvasStore } from "@/canvas/canvasStore";
import { nodesStore, sessionOf } from "@/store/nodes";
import { createFitScheduler, ZOOM_SETTLE_MS } from "./fitScheduler";
import { canvasMoved, layoutTerminal, mountTerminal, unmountTerminal } from "./registry";

// WebGL contexts are made once the view is still, not in the middle of a pan or a zoom (./webglPool.ts).
canvasStore.subscribe(({ view }, { view: previous }) => {
  if (view.scrollX !== previous.scrollX || view.scrollY !== previous.scrollY || view.zoom !== previous.zoom) canvasMoved();
});

/**
 * Shows the xterm of a node's session in `host` — a terminal's or an
 * fleet's — and keeps its grid fitted to the host and the zoom.
 * `ready`: the node has a session to show.
 */
export function useTerminalHost(nodeId: string, host: RefObject<HTMLDivElement | null>, ready: boolean) {
  useEffect(() => {
    const element = host.current;
    const session = sessionOf(nodesStore.getState().nodes[nodeId]);
    if (!ready || !element || !session) return;
    const zoom = () => canvasStore.getState().view.zoom;
    mountTerminal(nodeId, element, session, zoom());
    // Also when the host hides or shows again (scrolled out of the view, minimized): its size goes to 0 and back.
    const layout = () => layoutTerminal(nodeId, element, zoom());
    const onResize = createFitScheduler(layout);
    const onZoom = createFitScheduler(layout, ZOOM_SETTLE_MS);
    const observer = new ResizeObserver(onResize.schedule);
    observer.observe(element);
    const unsubscribe = canvasStore.subscribe((state, previous) => {
      if (state.view.zoom !== previous.view.zoom) onZoom.schedule();
    });
    return () => {
      observer.disconnect();
      unsubscribe();
      onResize.cancel();
      onZoom.cancel();
      unmountTerminal(nodeId, element);
    };
  }, [nodeId, host, ready]);
}
