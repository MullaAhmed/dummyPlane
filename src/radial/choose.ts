import { runCommand } from "@/commands/command";
import { closeRadial, radialStore } from "./radialState";
import { lineOf, RINGS } from "./rings";

/**
 * Closes the ring, then runs the slot's command on the next frame, once the
 * ring has left the screen: Excalidraw pastes only over its canvas (spec menu
 * radial §6.3). Evaluated now: a target gone meanwhile does nothing (§7).
 */
export function chooseSlot(slot: number) {
  const { ring } = radialStore.getState();
  closeRadial();
  const definition = ring ? RINGS[ring.kind][slot] : undefined;
  const line = ring && definition ? lineOf(definition, ring.context) : null;
  if (!ring || !line?.enabled) return;
  requestAnimationFrame(() => runCommand(line.command, ring.context));
}
