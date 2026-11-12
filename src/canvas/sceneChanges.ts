import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * Excalidraw calls onChange on every pointer move. Only a different key (scene
 * version plus viewport) is a change worth saving.
 */
export function createChangeDetector<A extends unknown[]>(keyOf: (...args: A) => string) {
  let lastKey: string | undefined;
  return (...args: A): boolean => {
    const key = keyOf(...args);
    if (key === lastKey) return false;
    lastKey = key;
    return true;
  };
}

/** The scene's version, as Excalidraw's getSceneVersion counts it: the sum of its elements' versions, which an edit in place bumps. */
export function sceneVersionOf(elements: readonly ExcalidrawElement[]): number {
  let version = 0;
  for (const e of elements) version += e.version;
  return version;
}

/**
 * The scene as a gate reads it: the array, its version and its length. Excalidraw
 * calls onChange on every frame of a pan or a zoom with the same array and the same
 * versions: the same stamp. An edit in place moves the version, a scene replaced
 * hands another array, an element gone and another bumped by as much moves the length.
 */
export interface SceneStamp {
  elements: readonly ExcalidrawElement[];
  version: number;
  length: number;
}

/** `elements`' stamp; its version counted here when the caller has not got it already. */
export function sceneStamp(elements: readonly ExcalidrawElement[], version = sceneVersionOf(elements)): SceneStamp {
  return { elements, version, length: elements.length };
}

/** Whether a gate's inputs are the ones it saw last, each compared by identity: false when it saw none yet. */
export function sameInputs<T extends object>(last: T | null, now: T): boolean {
  return last !== null && (Object.keys(now) as (keyof T)[]).every((key) => last[key] === now[key]);
}
