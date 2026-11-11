import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

type Selected = AppState["selectedElementIds"];

/** What is derived from the scene: its groups, nodes, links and wires; and from the selection: its drawn elements. */
export interface SceneDerive {
  scene: (elements: readonly ExcalidrawElement[]) => void;
  selection: (elements: readonly ExcalidrawElement[], selected: Selected) => void;
}

/**
 * Canvas's onChange, as far as the overlays and panels go: what it derives from
 * the scene, derived again only when the scene changed. Excalidraw calls onChange
 * on every frame of a pan or a zoom, where only the view moves, and each derivation
 * walks the whole scene (P2 #58). The scene changed when Excalidraw hands another
 * array, or its version (the sum of its elements' versions, which an edit in place
 * bumps) or its length moved. The drawn selection is derived again when the
 * selection changed too. The first call always derives: a canvas starts with an
 * empty store. One per canvas; `reset` forgets the last scene, when the store is emptied.
 */
export function createSceneDerivation(derive: SceneDerive) {
  let lastElements: readonly ExcalidrawElement[] | null = null;
  let lastKey = "";
  let lastSelected: Selected | null = null;
  const run = (elements: readonly ExcalidrawElement[], version: number, selected: Selected) => {
    const key = `${version}:${elements.length}`;
    const sceneChanged = elements !== lastElements || key !== lastKey;
    if (sceneChanged || selected !== lastSelected) derive.selection(elements, selected);
    if (sceneChanged) derive.scene(elements);
    lastElements = elements;
    lastKey = key;
    lastSelected = selected;
  };
  run.reset = () => {
    lastElements = null;
    lastKey = "";
    lastSelected = null;
  };
  return run;
}
