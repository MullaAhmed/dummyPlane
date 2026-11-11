import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { StoredFile } from "@/ipc/db";
import { debounce } from "@/lib/debounce";
import type { Rect } from "./groups";
import { nodeKindOf } from "./nodeElement";
import { createChangeDetector } from "./sceneChanges";

/** Viewport saved with the scene. */
export type SavedAppState = Pick<AppState, "scrollX" | "scrollY" | "zoom">;

export interface SceneSyncDeps {
  saveScene: (elementsJson: string, appStateJson: string, nodeIds: string[]) => Promise<void>;
  saveFiles: (files: StoredFile[]) => Promise<void>;
  onSceneChanged: (
    elements: readonly ExcalidrawElement[],
    appState: SavedAppState,
    files: BinaryFiles,
    savedFileIds: string[],
  ) => void;
  onNodesAdded: (ids: string[]) => void;
  onNodesRemoved: (ids: string[]) => void;
  delayMs?: number;
}

/** Ids of the dummyPlane nodes still on the canvas (deleted elements excluded). */
export function liveNodeIds(elements: readonly ExcalidrawElement[]): string[] {
  return elements.filter((e) => !e.isDeleted && nodeKindOf(e) !== null).map((e) => e.id);
}

/** The scene rectangle of each live node: where the overlays anchor. */
export function liveNodeRects(elements: readonly ExcalidrawElement[]): Record<string, Rect> {
  return Object.fromEntries(
    elements.filter((e) => !e.isDeleted && nodeKindOf(e) !== null).map((e) => [e.id, { x: e.x, y: e.y, width: e.width, height: e.height }]),
  );
}

/**
 * Turns Excalidraw's onChange stream into saves: the scene 500 ms
 * after the last real change, new images at once, and node additions/removals
 * as events (a removal stops a terminal; an undo brings a node back).
 */
export function createSceneSync(
  initial: { elements: readonly ExcalidrawElement[]; savedFileIds: Iterable<string> },
  deps: SceneSyncDeps,
) {
  let knownNodes = new Set(liveNodeIds(initial.elements));
  const savedFiles = new Set(initial.savedFileIds);
  const hasChanged = createChangeDetector(
    (version: number, appState: SavedAppState) => `${version}:${appState.scrollX}:${appState.scrollY}:${appState.zoom.value}`,
  );
  const persist = debounce((elements: readonly ExcalidrawElement[], appState: SavedAppState, nodeIds: string[]) => {
    const live = elements.filter((e) => !e.isDeleted);
    return deps.saveScene(JSON.stringify(live), JSON.stringify(appState), nodeIds);
  }, deps.delayMs ?? 500);

  const onChange = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
    sceneVersion: number,
  ) => {
    const live = liveNodeIds(elements);
    const liveSet = new Set(live);
    const added = live.filter((id) => !knownNodes.has(id));
    const removed = [...knownNodes].filter((id) => !liveSet.has(id));
    knownNodes = liveSet;
    if (added.length) deps.onNodesAdded(added);
    if (removed.length) deps.onNodesRemoved(removed);

    const newFiles = Object.values(files).filter((f) => !savedFiles.has(f.id));
    if (newFiles.length) {
      newFiles.forEach((f) => savedFiles.add(f.id));
      deps
        .saveFiles(newFiles.map((f) => ({ id: f.id, mimeType: f.mimeType, dataUrl: f.dataURL, created: f.created })))
        .catch((error: unknown) => {
          newFiles.forEach((f) => savedFiles.delete(f.id));
          console.warn("images not saved", error);
        });
    }

    const view: SavedAppState = { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom };
    if (!hasChanged(sceneVersion, view)) return;
    deps.onSceneChanged(elements, view, files, [...savedFiles]);
    persist(elements, view, live);
  };

  return {
    onChange,
    /** Writes the pending scene save now (workspace switch, window close). */
    flush: () => persist.flush(),
  };
}
