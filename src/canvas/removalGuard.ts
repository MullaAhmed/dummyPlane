import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/**
 * What to ask before running agents leave the canvas: their whole group, or the agents themselves; `release`, the
 * nodes the closing takes out of a group that goes with them (`remove`), which stay, in no group.
 */
export type Closing = { group: string } | { agents: string[]; remove: string[]; release?: string[] };

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
 * too (or shrank, which would cut them off), before asking. A node the change
 * kept but took out of a group that left (the undo of a first sub-agent: its
 * parent, loose again) goes back in it too, so that "Cancel" leaves the
 * family as it was; it is let out of the group once the closing is confirmed,
 * and the question is then the agents', not the group's: it stays.
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
    const released = [...was.values()].filter((e) => !caught.includes(e.id) && e.frameId !== null && left.includes(e.frameId) && now.has(e.id) && now.get(e.id)!.frameId !== e.frameId);
    const back = [...caught, ...left, ...changed, ...members.map((e) => e.id), ...released.map((e) => e.id)];
    const ask: Closing =
      released.length === 0 && left.length === 1 && changed.length === 0 && caught.every((id) => was.get(id)?.frameId === left[0])
        ? { group: left[0] }
        : {
            agents: caught,
            remove: [...caught, ...left, ...members.map((e) => e.id)],
            ...(released.length > 0 ? { release: released.map((e) => e.id) } : {}),
          };
    // The arrows that joined them: Excalidraw's own deletion frees their ends (an undo takes them), and a node put
    // back alone leaves them orphans, which the wire upkeep then deletes: a link the user drew, lost by a closing
    // they may yet cancel.
    const byId = new Map(elements.map((e) => [e.id, e]));
    const ends = (e: ExcalidrawElement) => {
      const { startBinding, endBinding } = e as { startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null };
      return [startBinding?.elementId, endBinding?.elementId];
    };
    const wires = [...was.values()].filter((e) => {
      if (e.type !== "arrow" || back.includes(e.id) || !ends(e).some((id) => id !== undefined && back.includes(id))) return false;
      const current = byId.get(e.id);
      return !current || current.isDeleted || ends(current).join() !== ends(e).join();
    });
    return {
      dispose: removed.filter((id) => !back.includes(id)),
      restore: [...back.map((id) => was.get(id)!), ...wires],
      ask,
    };
  };
}
