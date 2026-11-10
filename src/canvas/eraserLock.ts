import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/** `customData` key of an element the eraser guard locked: it was not locked before, and goes back to what it was when the eraser leaves. */
export const ERASER_MARK = "eraserLock";

export const isMarked = (element: ExcalidrawElement) => element.customData?.[ERASER_MARK] === true;

/** A lock the eraser guard put there: the node is still the double-click's to select. */
export const lockedByEraser = (element: ExcalidrawElement) => element.locked && isMarked(element);
