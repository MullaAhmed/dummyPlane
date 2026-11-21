import { createStore, useStore } from "zustand";
import type { Insets } from "@/shell/layout";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI, NormalizedZoomValue } from "@excalidraw/excalidraw/types";
import { sameLinks, type Links } from "@/agents/wires";
import { sameFrames, type Rect, type SceneFrame } from "./groups";
import { sameDrawn } from "./drawnSelection";
import { sameWirePaths, type WirePath } from "./overlay/wirePaths";

/** The part of Excalidraw's state that the shell around the canvas shows. */
export interface CanvasView {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
  /** Excalidraw's active tool type ("selection", "rectangle", "freedraw"…). */
  tool: string;
  selectedIds: string[];
  /** The frame whose name Excalidraw is editing (its group label hides meanwhile). */
  editingFrame: string | null;
  /** Alt+Z hides the tools, Alt+R makes the canvas read-only: either needs a visible way out. */
  mode: "zen" | "reading" | null;
}

export const EMPTY_VIEW: CanvasView = {
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  width: 0,
  height: 0,
  offsetLeft: 0,
  offsetTop: 0,
  tool: "selection",
  selectedIds: [],
  editingFrame: null,
  mode: null,
};

export function viewFrom(appState: AppState): CanvasView {
  return {
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: appState.zoom.value,
    width: appState.width,
    height: appState.height,
    offsetLeft: appState.offsetLeft,
    offsetTop: appState.offsetTop,
    tool: appState.activeTool.type,
    selectedIds: Object.keys(appState.selectedElementIds)
      .filter((id) => appState.selectedElementIds[id])
      .sort(),
    editingFrame: appState.editingFrame ?? null,
    mode: appState.viewModeEnabled ? "reading" : appState.zenModeEnabled ? "zen" : null,
  };
}

/** No inset: the whole viewport. */
const WHOLE: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The view that shows an element at 100 %, centered in the viewport less `area` (the work area, shell/layout.ts: the
 * bars, the rails and an occupied lane). One wider than that keeps its left edge on the area's, where its lines start.
 * Set in one `updateScene`: `scrollToContent` right after a zoom change keeps the zoom it read before it.
 */
export function fullSizeView(
  element: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  area: Insets = WHOLE,
) {
  const room = viewport.width - area.left - area.right;
  const left = element.width <= room ? area.left + (room - element.width) / 2 : area.left;
  return {
    zoom: { value: 1 as NormalizedZoomValue },
    scrollX: left - element.x,
    scrollY: (area.top + viewport.height - area.bottom) / 2 - (element.y + element.height / 2),
  };
}

export function sameView(a: CanvasView, b: CanvasView): boolean {
  return (
    a.scrollX === b.scrollX &&
    a.scrollY === b.scrollY &&
    a.zoom === b.zoom &&
    a.width === b.width &&
    a.height === b.height &&
    a.offsetLeft === b.offsetLeft &&
    a.offsetTop === b.offsetTop &&
    a.tool === b.tool &&
    a.editingFrame === b.editingFrame &&
    a.mode === b.mode &&
    a.selectedIds.length === b.selectedIds.length &&
    a.selectedIds.every((id, i) => id === b.selectedIds[i])
  );
}

interface CanvasState {
  /** The Excalidraw instance of the workspace on screen. */
  api: ExcalidrawImperativeAPI | null;
  view: CanvasView;
  setApi: (api: ExcalidrawImperativeAPI | null) => void;
  /** Called on every Excalidraw onChange; listeners only hear real changes. */
  setView: (view: CanvasView) => void;
  /** Frames and groups of the scene on screen, derived on every change. */
  frames: SceneFrame[];
  setFrames: (frames: SceneFrame[]) => void;
  /** Ids of the dummyPlane nodes on the canvas on screen (deleted ones excluded). */
  nodeIds: string[];
  setNodeIds: (ids: string[]) => void;
  /** What each fleet of the scene is wired to. */
  links: Record<string, Links>;
  setLinks: (links: Record<string, Links>) => void;
  /** The route of each wire, from its fleet: where WireActivity shows the messages. */
  wires: WirePath[];
  setWires: (wires: WirePath[]) => void;
  /** The scene rectangle of each node: where the overlays anchor. */
  nodeRects: Record<string, Rect>;
  setNodeRects: (rects: Record<string, Rect>) => void;
  /** The drawn (non-node) elements selected on screen: what the selection panel acts on. */
  drawnSelection: ExcalidrawElement[];
  setDrawnSelection: (elements: ExcalidrawElement[]) => void;
  /** Each quick note's host, while that terminal or Fleet is on the canvas (src/nodes/note/link.ts). */
  noteHosts: Record<string, string>;
  setNoteHosts: (hosts: Record<string, string>) => void;
  /** The node Excalidraw lets the pointer into (its active embeddable), null when none: the others keep out of the Tab order (NodeHost). */
  activeNode: string | null;
  setActiveNode: (id: string | null) => void;
}

export const canvasStore = createStore<CanvasState>()((set, get) => ({
  api: null,
  view: EMPTY_VIEW,
  setApi: (api) => set({ api }),
  setView: (view) => {
    if (!sameView(get().view, view)) set({ view });
  },
  frames: [],
  setFrames: (frames) => {
    if (!sameFrames(get().frames, frames)) set({ frames });
  },
  nodeIds: [],
  setNodeIds: (ids) => {
    const current = get().nodeIds;
    if (ids.length !== current.length || ids.some((id, i) => id !== current[i])) set({ nodeIds: ids });
  },
  nodeRects: {},
  setNodeRects: (rects) => {
    const current = get().nodeRects;
    const ids = Object.keys(rects);
    const same =
      ids.length === Object.keys(current).length &&
      ids.every((id) => {
        const a = rects[id];
        const b = current[id];
        return b !== undefined && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
      });
    if (!same) set({ nodeRects: rects });
  },
  drawnSelection: [],
  setDrawnSelection: (elements) => {
    if (!sameDrawn(get().drawnSelection, elements)) set({ drawnSelection: elements });
  },
  noteHosts: {},
  setNoteHosts: (hosts) => {
    const current = get().noteHosts;
    const ids = Object.keys(hosts);
    if (ids.length !== Object.keys(current).length || ids.some((id) => current[id] !== hosts[id])) set({ noteHosts: hosts });
  },
  links: {},
  setLinks: (links) => {
    if (!sameLinks(get().links, links)) set({ links });
  },
  wires: [],
  setWires: (wires) => {
    if (!sameWirePaths(get().wires, wires)) set({ wires });
  },
  activeNode: null,
  setActiveNode: (id) => {
    if (get().activeNode !== id) set({ activeNode: id });
  },
}));

export function useCanvas<T>(selector: (state: CanvasState) => T): T {
  return useStore(canvasStore, selector);
}

/** Where the scene sits in the canvas's box: all an overlay places itself with (the offsets are the box's own, 0). */
export type CanvasPlace = Pick<CanvasView, "scrollX" | "scrollY" | "zoom" | "offsetLeft" | "offsetTop">;

/**
 * The view's scroll and zoom, read one by one: an overlay placed with them re-renders when they
 * move, not when the selection, the tool or the mode does, which `view` also holds (P2 #58).
 */
export function useCanvasPlace(): CanvasPlace {
  const scrollX = useCanvas((s) => s.view.scrollX);
  const scrollY = useCanvas((s) => s.view.scrollY);
  const zoom = useCanvas((s) => s.view.zoom);
  return { scrollX, scrollY, zoom, offsetLeft: 0, offsetTop: 0 };
}
