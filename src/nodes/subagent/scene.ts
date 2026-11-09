import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { nodeKindOf } from "@/canvas/nodeElement";

/** The scene without subagent nodes: a reloaded scene never brings back one that ended. */
export function withoutSubagents<T extends ExcalidrawElement>(elements: readonly T[]): T[] {
  return elements.filter((e) => nodeKindOf(e) !== "subagent");
}
