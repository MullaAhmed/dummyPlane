import { createStore, useStore } from "zustand";
import type { CommandContext } from "@/commands/command";
import type { Point } from "@/fleet/terminals";
import type { RingKind } from "./rings";

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
