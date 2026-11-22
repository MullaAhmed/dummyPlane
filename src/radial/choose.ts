import { runCommand, type CommandContext } from "@/commands/command";
import type { Point } from "@/agents/terminals";
import { openArc, opensArc } from "./arc";
import { closeRadial, radialStore, updateRadial } from "./radialState";
import { lineOf, RINGS, type RingSlot } from "./rings";

/** Closes the ring, then runs `definition`'s command, read in `context`, on the next frame (see `chooseSlot`). */
function run(definition: RingSlot | undefined, context: CommandContext) {
  closeRadial();
  const line = definition ? lineOf(definition, context) : null;
  if (!line?.enabled || !line.command) return;
  const { command, context: ctx } = line;
  requestAnimationFrame(() => runCommand(command, ctx));
}

/**
 * Closes the ring, then runs the slot's command on the next frame, once the
 * ring has left the screen: Excalidraw pastes only over its canvas. Evaluated now: a target gone meanwhile does nothing.
 * A wedge with an arc (More, Arrange, Other agent) opens it at once instead, and the ring stays; its arc already
 * open, it stays so; from an arc that took its own's place (Arrange's layouts, from More's), its own comes back.
 */
export function chooseSlot(slot: number, options: { keyboard?: boolean } = {}) {
  const { ring } = radialStore.getState();
  if (!ring) return;
  if (opensArc({ slot })) {
    // Clicked, or a slide released there: the ring stays, for a click in the arc, the wedge pointed at.
    updateRadial({ pressed: false, sliding: false, hovered: slot });
    if (!(ring.arc?.slot === slot && !ring.arc.parent)) openArc({ from: { slot }, keyboard: options.keyboard });
    return;
  }
  run(RINGS[ring.kind][slot], ring.context);
}

/**
 * A wedge of the open arc: as a slot of the ring, in the arc's context. One with an arc of its own (More's Arrange)
 * opens it in this one's place. An arc whose wedges came under the pointer chooses nothing until the pointer moves:
 * the click or the release that opened it, or a second one at once (a double click), never arranges.
 */
export function chooseItem(item: number, options: { keyboard?: boolean; at?: Point } = {}) {
  const { ring } = radialStore.getState();
  const arc = ring?.arc;
  if (!ring || !arc) return;
  if (arc.under) {
    if (ring.pressed || ring.sliding) updateRadial({ pressed: false, sliding: false });
    return;
  }
  if (opensArc({ item })) {
    updateRadial({ pressed: false, sliding: false });
    openArc({ from: { item }, keyboard: options.keyboard, at: options.at });
    return;
  }
  run(arc.slots[item], arc.context);
}
