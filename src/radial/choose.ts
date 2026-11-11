import { runCommand } from "@/commands/command";
import { openArc } from "./arc";
import { closeRadial, radialStore, updateRadial } from "./radialState";
import { ARCS, lineOf, moreSlotOf, RINGS, type RingSlot } from "./rings";

/** Closes the ring, then runs `definition`'s command on the next frame (see `chooseSlot`). */
function run(definition: RingSlot | undefined) {
  const { ring } = radialStore.getState();
  closeRadial();
  const line = ring && definition ? lineOf(definition, ring.context) : null;
  if (!line?.enabled || !line.command) return;
  const { command, context } = line;
  requestAnimationFrame(() => runCommand(command, context));
}

/**
 * Closes the ring, then runs the slot's command on the next frame, once the
 * ring has left the screen: Excalidraw pastes only over its canvas. Evaluated now: a target gone meanwhile does nothing (§7).
 * More opens its arc at once instead, and the ring stays.
 */
export function chooseSlot(slot: number) {
  const { ring } = radialStore.getState();
  if (!ring) return;
  if (slot === moreSlotOf(ring.kind)) {
    // Clicked, or a slide released there: the ring stays, for a click in the arc.
    updateRadial({ pressed: false, sliding: false });
    if (!ring.arc) openArc();
    return;
  }
  run(RINGS[ring.kind][slot]);
}

/** A wedge of the More arc: as a slot of the ring. */
export function chooseItem(item: number) {
  const { ring } = radialStore.getState();
  if (ring) run(ARCS[ring.kind][item]);
}
