import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/** What to ask before running agents leave the canvas: their whole group, or the agents themselves. */
export type Closing = { group: string } | { agents: string[]; remove: string[] };

export interface RemovalVerdict {
  /** Nodes that may go: their terminals are freed. */
  dispose: string[];
  /** Elements to put back as they were before the change, outside the undo history. */
  restore: ExcalidrawElement[];
  ask: Closing | null;
}

/** Nodes about to leave the canvas after their confirmation ("Close the agent", "Close the group"). */
const confirmed = new Set<string>();

export function allowRemoval(ids: Iterable<string>) {
  for (const id of ids) confirmed.add(id);
}

const liveOf = (elements: readonly ExcalidrawElement[]) => new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));

/**
 * A running agent never leaves the canvas unasked: Ctrl+Z
 * undoing its launch, Redo, Delete, the eraser or an imported scene would
 * end its session. Given each change of the scene (deleted elements included)
 * and the nodes it removed, the guard lets the stopped and the confirmed ones
 * go, and puts the others back as they were, with their group when it left
 * too (or shrank, which would cut them off), before asking.
 */
export function createRemovalGuard(isRunning: (nodeId: string) => boolean, initial: readonly ExcalidrawElement[]) {
  let previous = initial;
  return (elements: readonly ExcalidrawElement[], removed: readonly string[]): RemovalVerdict => {
    const before = previous;
    previous = elements;
    const caught = removed.filter((id) => !confirmed.has(id) && isRunning(id));
    removed.forEach((id) => confirmed.delete(id));
    if (caught.length === 0) return { dispose: [...removed], restore: [], ask: null };

    const was = liveOf(before);
    const now = liveOf(elements);
    const frames = new Set(caught.map((id) => was.get(id)?.frameId).filter((id): id is string => !!id && was.has(id)));
    const left = [...frames].filter((id) => !now.has(id));
    const changed = [...frames].filter((id) => now.has(id) && now.get(id)!.version !== was.get(id)!.version);
    const members = [...was.values()].filter((e) => !caught.includes(e.id) && !now.has(e.id) && e.frameId !== null && left.includes(e.frameId));
    const back = [...caught, ...left, ...changed, ...members.map((e) => e.id)];
    const ask: Closing =
      left.length === 1 && changed.length === 0 && caught.every((id) => was.get(id)?.frameId === left[0])
        ? { group: left[0] }
        : { agents: caught, remove: [...caught, ...left, ...members.map((e) => e.id)] };
    return {
      dispose: removed.filter((id) => !back.includes(id)),
      restore: back.map((id) => was.get(id)!),
      ask,
    };
  };
}
