import { createStore, useStore } from "zustand";
import type { CommandContext } from "./command";

export type PaletteMode = "goTo" | "functions";

interface PaletteState {
  open: boolean;
  /** The field's text; `>` first makes the functions mode. */
  query: string;
  /** Taken when it opened: the functions are listed for that moment. */
  context: CommandContext | null;
  /** Where the keyboard was when it opened, and goes back when it closes. */
  returnFocus: HTMLElement | null;
  /** Counts openings: a palette closed then reopened at once ("Go to…" from the functions) is a new one, with the keyboard. */
  openings: number;
}

export const paletteStore = createStore<PaletteState>()(() => ({ open: false, query: "", context: null, returnFocus: null, openings: 0 }));

export function usePalette<T>(selector: (state: PaletteState) => T): T {
  return useStore(paletteStore, selector);
}

export function modeOf(query: string): PaletteMode {
  return query.trimStart().startsWith(">") ? "functions" : "goTo";
}

/** The search itself, without the functions' `>`. */
export function stripPrefix(query: string): string {
  return query.replace(/^\s*>\s?/, "");
}

/** Ctrl+P and Ctrl+Shift+P: opens the palette, or switches its mode keeping the search. */
export function openPalette(mode: PaletteMode, context: CommandContext) {
  const state = paletteStore.getState();
  const search = state.open ? stripPrefix(state.query) : "";
  const query = mode === "functions" ? `> ${search}` : search;
  if (state.open) {
    paletteStore.setState({ query });
    return;
  }
  const active = document.activeElement;
  paletteStore.setState((s) => ({
    open: true,
    query,
    context,
    returnFocus: active instanceof HTMLElement ? active : null,
    openings: s.openings + 1,
  }));
}

export function setPaletteQuery(query: string) {
  paletteStore.setState({ query });
}

/** Closes it; the keyboard goes back where it was when it opened. */
export function closePalette() {
  const { returnFocus } = paletteStore.getState();
  paletteStore.setState({ open: false, query: "", context: null, returnFocus: null });
  // Without scrolling: an xterm's textarea, at its cursor, can sit below the window's edge (see canvas/scrollPin.ts).
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}
