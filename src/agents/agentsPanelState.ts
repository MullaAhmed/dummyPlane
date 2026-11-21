import { toastError } from "@/lib/errorToast";
import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import type { PanelFilter } from "./agentsView";
import { agentsMessages } from "./messages";

/** The panel comes back as it was left. */
export const AGENTS_PANEL_KEY = "ui.agentsPanel";

/** Narrower than this (CSS px) the panel would lie over the work it lists: it starts folded. */
export const NARROW_WINDOW = 1100;

interface AgentsPanelState {
  open: boolean;
  filter: PanelFilter;
  /** A work window folded the panel, which was open: it comes back with the window unless the person chose since. */
  held: boolean;
}

export const agentsPanelStore = createStore<AgentsPanelState>()(() => ({ open: true, filter: "all", held: false }));

export function useAgentsPanel<T>(selector: (state: AgentsPanelState) => T): T {
  return useStore(agentsPanelStore, selector);
}

/** Open unless it was closed: the panel shows the agents to a new user. */
export function readAgentsPanel(raw: unknown): boolean {
  return raw !== "closed";
}

/**
 * At boot. An unreadable setting keeps the panel open. In a window narrower than NARROW_WINDOW it starts folded
 * whatever was saved: that is not saved, a wider window finds the person's own choice.
 */
export async function loadAgentsPanel(width = window.innerWidth) {
  let open = agentsPanelStore.getState().open;
  try {
    open = readAgentsPanel(await getSetting<unknown>(AGENTS_PANEL_KEY));
  } catch (error) {
    console.warn(`agents panel: ${String(error)}`);
  }
  agentsPanelStore.setState({ open: open && width >= NARROW_WINDOW, held: false });
}

/** The person's choice, saved; it also ends a fold a work window made (the person's choice wins). */
export function setAgentsPanel(open: boolean) {
  // Reopened from the rail, the panel shows everyone: a filter left by a counter is not remembered.
  agentsPanelStore.setState((s) => ({ open, held: false, filter: open && !s.open ? "all" : s.filter }));
  void setSetting(AGENTS_PANEL_KEY, open ? "open" : "closed").catch((error: unknown) => {
    toastError(messages(agentsMessages).settingNotSaved, { error, next: messages(agentsMessages).settingForNow });
  });
}

/**
 * A work window (the review panel, the git window, Code Studio, Notes) came up: an open panel folds to its rail badge
 * and remembers to come back. Not saved: the saved setting stays what the person chose.
 */
export function holdAgentsPanel() {
  agentsPanelStore.setState((s) => (s.open ? { open: false, held: true } : s));
}

/** The last work window went: a panel it folded comes back as it was (its filter too); one the person opened or closed since is left. */
export function releaseAgentsPanel() {
  agentsPanelStore.setState((s) => (s.held ? { open: true, held: false } : s));
}

/**
 * A filter as it is kept now: one that no longer exists (an older build's Ready or
 * Stopped) becomes the one that took its place, any other unknown value, the removed
 * Active one included, All.
 */
export function readAgentsFilter(raw: unknown): PanelFilter {
  if (raw === "all" || raw === "waiting" || raw === "working" || raw === "done") return raw;
  return raw === "idle" || raw === "stopped" ? "done" : "all";
}

export function setAgentsFilter(filter: PanelFilter) {
  agentsPanelStore.setState({ filter: readAgentsFilter(filter) });
}

/** The title bar's Working count: the panel, on the agents at work. */
export function showAgents(filter: PanelFilter) {
  setAgentsPanel(true);
  setAgentsFilter(filter);
}
