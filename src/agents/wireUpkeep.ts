import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { currentPalette } from "@/app/theme";
import { nodesStore, terminalOf } from "@/store/nodes";
import {
  isWire,
  missingSpawnWires,
  orphanReason,
  orphanWires,
  outdatedWires,
  revivableWires,
  staleWireBindings,
  unmarkedWires,
  wireColor,
  wireFlagsOf,
  wireMark as markWith,
  withSpawnWires,
  type SpawnerOf,
} from "./wires";

/** A wire's mark without the orphan flag: a spawn wire keeps `spawn`, a talk wire `talk`, a vertical tree's its route (`down`, `riser`). */
const wireMark = (e: ExcalidrawElement) => markWith(wireFlagsOf(e));

/** The agent that spawned a terminal, as its node keeps it. */
const spawnedBy: SpawnerOf = (nodeId) => terminalOf(nodesStore.getState().nodes[nodeId])?.spawnedBy;

/**
 * `element`'s bound elements without the deleted wires `gone`, and with the
 * wires `back` (revived, bound to it) listed again: Excalidraw moves only the
 * arrows an element lists. The element itself when its list is right.
 */
function relisted(element: ExcalidrawElement, gone: ReadonlySet<string>, back: readonly string[]): ExcalidrawElement {
  const before = element.boundElements ?? [];
  const kept = before.filter((b) => !gone.has(b.id));
  const added = back.filter((id) => !kept.some((b) => b.id === id)).map((id) => ({ id, type: "arrow" as const }));
  if (kept.length === before.length && added.length === 0) return element;
  return newElementWith(element, { boundElements: [...kept, ...added] });
}

/** An upkeep is already programmed for the next frame: further changes wait for it, not queue behind it. */
let pending = false;

/**
 * Hand-drawn wires get their mark, wires left without an end go and wires in
 * another palette's color take the current palette's accent; a deleted wire leaves its ends' lists and a revived one is listed
 * again; then each sub-agent whose spawner is in the scene gets its spawn wire
 * back when none joins them (`missingSpawnWires`), a wire just deleted as
 * orphaned included: a fresh one, bound to both. Outside the undo history, a
 * frame after the change: changing the scene from inside `onChange` would
 * re-enter it. One upkeep at a time, each reading the scene (and the palette)
 * as it is then.
 */
export function scheduleWireUpkeep(api: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[], spawnerOf: SpawnerOf = spawnedBy) {
  if (pending) return;
  const nothingToDo =
    unmarkedWires(elements).length === 0 &&
    orphanWires(elements).length === 0 &&
    revivableWires(elements).length === 0 &&
    outdatedWires(elements, currentPalette()).length === 0 &&
    staleWireBindings(elements).length === 0 &&
    missingSpawnWires(elements, spawnerOf).length === 0;
  if (nothingToDo) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const current = api.getSceneElementsIncludingDeleted();
    const marked = new Set(unmarkedWires(current));
    const orphans = new Set(orphanWires(current));
    const revived = new Set(revivableWires(current));
    const palette = currentPalette();
    const outdated = new Set(outdatedWires(current, palette));
    // Evidence in the log file (app/log.ts) when a wire goes: which one, which end failed, and what the canvas was doing.
    if (orphans.size > 0) {
      const byId = new Map(current.map((e) => [e.id, e]));
      const { selectedElementIds, selectedElementsAreBeingDragged, activeTool } = api.getAppState();
      const moment = { selectedIds: Object.keys(selectedElementIds).filter((id) => selectedElementIds[id]), dragging: selectedElementsAreBeingDragged, tool: activeTool.type };
      for (const e of current) if (orphans.has(e.id)) console.warn(orphanReason(e, byId, moment));
    }
    // The wires deleted once this pass is done, and the ends each revived wire is listed on again.
    const gone = new Set([...current.filter((e) => e.isDeleted && e.type === "arrow" && isWire(e) && !revived.has(e.id)).map((e) => e.id), ...orphans]);
    const back = new Map<string, string[]>();
    for (const e of current) {
      if (!revived.has(e.id)) continue;
      const { startBinding, endBinding } = e as ExcalidrawArrowElement;
      for (const end of [startBinding?.elementId, endBinding?.elementId]) if (end) back.set(end, [...(back.get(end) ?? []), e.id]);
    }
    const kept = current.map((e) => {
      // Marked, so that an undo bringing its ends back brings the wire back too; a spawn wire stays one.
      if (orphans.has(e.id)) return newElementWith(e, { isDeleted: true, customData: { ...e.customData, dummyplane: { ...wireMark(e), orphaned: true } } });
      if (revived.has(e.id)) return newElementWith(e, { isDeleted: false, customData: { ...e.customData, dummyplane: wireMark(e) } });
      if (marked.has(e.id)) return newElementWith(e, { customData: { ...e.customData, dummyplane: { kind: "wire" } } });
      if (outdated.has(e.id)) return newElementWith(e, { strokeColor: wireColor(palette) });
      return e.isDeleted || e.type === "arrow" ? e : relisted(e, gone, back.get(e.id) ?? []);
    });
    // After the orphans went: one of them that joined an agent to its sub-agent gives way to a fresh wire.
    const healed = withSpawnWires(kept, spawnerOf, palette);
    // The trigger that leaves a spawn wire without an end is still unknown: each one re-created is logged.
    for (const { parentId, childId } of healed.added) console.warn(`spawn wire re-created: child ${childId}, parent ${parentId}`);
    if (healed.added.length === 0 && kept.every((e, i) => e === current[i])) return;
    api.updateScene({ elements: healed.elements, captureUpdate: CaptureUpdateAction.NEVER });
  });
}
