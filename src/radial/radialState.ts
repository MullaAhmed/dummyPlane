import { createStore, useStore } from "zustand";
import type { CommandContext } from "@/commands/command";
import type { Point } from "@/agents/terminals";
import type { ArcLayout } from "./gesture";
import type { RingKind, RingSlot } from "./rings";

/**
 * An open arc: where it lies (gesture.ts `arcToward`), the wedge it belongs to, and its wedges (the
 * petals) as they stood when it opened: More's commands, Arrange's layouts, Other agent's agents.
 */
export interface OpenArc extends ArcLayout {
  /** The ring's wedge it hangs from, pointed while it is open: More for the layouts of More's Arrange too. */
  slot: number;
  /** Its wedges, read as it opened (the agents found, the saved layout), and the context they run in: their wedge's. */
  slots: readonly RingSlot[];
  context: CommandContext;
  /** Its wedge's full name: the arc's, for assistive technology. */
  label: string;
  /** The arc it took the place of and that arc's wedge it opened from (More's arc, at Arrange); none for a ring's wedge's. */
  parent?: { arc: OpenArc; item: number } | null;
  /**
   * Opened by the pointer from a wedge of the arc it replaced, its wedges came under the pointer: where it stood. It
   * points at nothing and a click or a release there chooses nothing until the pointer moves away from it.
   */
  under?: Point | null;
}

export interface RadialOpen {
  /** Where the right button went down, in the window. */
  client: Point;
  /** The ring's center: the click point moved off the window's edges. */
  center: Point;
  kind: RingKind;
  context: CommandContext;
  /** The right button is still down. */
  pressed: boolean;
  /** It moved more than 6 px: its release runs the slot it points at. */
  sliding: boolean;
  /** The slot pointed at: by the pointer's place on the wheel, the slide, or the arrows. */
  hovered: number | null;
  /** The keyboard turns the wheel (the arrows, Tab): the wedges move at once, never eased. The pointer's next move clears it. */
  keyboard?: boolean;
  /** The arc open: More's, or another wedge's (Arrange, Other agent). */
  arc?: OpenArc | null;
  /** The arc's wedge pointed at, by the pointer, the slide or the arrows. */
  item?: number | null;
  /** The keyboard opened the arc: it was there at once, and stays unanimated when the pointer moves on. */
  arcInstant?: boolean;
}

export const radialStore = createStore<{ ring: RadialOpen | null }>()(() => ({ ring: null }));

export function openRadial(ring: RadialOpen) {
  radialStore.setState({ ring });
}

export function closeRadial() {
  radialStore.setState({ ring: null });
}

export function updateRadial(patch: Partial<RadialOpen>) {
  const { ring } = radialStore.getState();
  if (ring) radialStore.setState({ ring: { ...ring, ...patch } });
}

export function useRadial<T>(selector: (state: { ring: RadialOpen | null }) => T): T {
  return useStore(radialStore, selector);
}
