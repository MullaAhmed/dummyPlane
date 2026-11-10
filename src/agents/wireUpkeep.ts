import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { currentPalette } from "@/app/theme";
import { isSpawnWire, orphanWires, outdatedWires, revivableWires, unmarkedWires, wireColor } from "./wires";

/** A wire's mark without the orphan flag: a spawn wire keeps `spawn`. */
const wireMark = (e: ExcalidrawElement) => (isSpawnWire(e) ? { kind: "wire", spawn: true } : { kind: "wire" });

/** An upkeep is already programmed for the next frame: further changes wait for it, not queue behind it. */
let pending = false;

/**
 * Hand-drawn wires get their mark, wires left without an end go and wires in
 * another palette's color take the current palette's accent (spec theme §13,
 * plan B3), outside the undo history, a frame after the change: changing the
 * scene from inside `onChange` would re-enter it. One upkeep at a time, each
 * reading the scene (and the palette) as it is then.
 */
export function scheduleWireUpkeep(api: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[]) {
  if (pending) return;
  const nothingToDo =
    unmarkedWires(elements).length === 0 &&
    orphanWires(elements).length === 0 &&
    revivableWires(elements).length === 0 &&
    outdatedWires(elements, currentPalette()).length === 0;
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
    if (marked.size === 0 && orphans.size === 0 && revived.size === 0 && outdated.size === 0) return;
    api.updateScene({
      elements: current.map((e) => {
        // Marked, so that an undo bringing its ends back brings the wire back too; a spawn wire stays one.
        if (orphans.has(e.id)) return newElementWith(e, { isDeleted: true, customData: { ...e.customData, dummyplane: { ...wireMark(e), orphaned: true } } });
        if (revived.has(e.id)) return newElementWith(e, { isDeleted: false, customData: { ...e.customData, dummyplane: wireMark(e) } });
        if (marked.has(e.id)) return newElementWith(e, { customData: { ...e.customData, dummyplane: { kind: "wire" } } });
        if (outdated.has(e.id)) return newElementWith(e, { strokeColor: wireColor(palette) });
        return e;
      }),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  });
}
