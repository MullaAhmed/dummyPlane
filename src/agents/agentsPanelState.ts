import { toast } from "sonner";
import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import type { PanelFilter } from "./agentsView";
import { agentsMessages } from "./messages";

/** Spec identity §5.6: the panel comes back as it was left. */
export const AGENTS_PANEL_KEY = "ui.agentsPanel";

interface AgentsPanelState {
  open: boolean;
  filter: PanelFilter;
}

export const agentsPanelStore = createStore<AgentsPanelState>()(() => ({ open: true, filter: "all" }));

export function useAgentsPanel<T>(selector: (state: AgentsPanelState) => T): T {
  return useStore(agentsPanelStore, selector);
}

/** Open unless it was closed: the panel shows the agents to a new user. */
export function readAgentsPanel(raw: unknown): boolean {
  return raw !== "closed";
}

/** At boot. An unreadable setting keeps the panel open. */
export async function loadAgentsPanel() {
  try {
    agentsPanelStore.setState({ open: readAgentsPanel(await getSetting<unknown>(AGENTS_PANEL_KEY)) });
  } catch (error) {
    console.warn(`agents panel: ${String(error)}`);
  }
}

export function setAgentsPanel(open: boolean) {
  // Reopened from the rail, the panel shows everyone: a filter left by a counter is not remembered.
  agentsPanelStore.setState((s) => ({ open, filter: open && !s.open ? "all" : s.filter }));
  void setSetting(AGENTS_PANEL_KEY, open ? "open" : "closed").catch((error: unknown) => {
    toast.error(messages(agentsMessages).settingNotSaved(String(error)));
  });
}

/**
 * A filter as it is kept now: one that no longer exists (an older build's Ready or
 * Stopped) becomes the one that took its place, any other unknown value All.
 */
export function readAgentsFilter(raw: unknown): PanelFilter {
  if (raw === "all" || raw === "active" || raw === "waiting" || raw === "working" || raw === "done") return raw;
  return raw === "idle" || raw === "stopped" ? "done" : "all";
}

export function setAgentsFilter(filter: PanelFilter) {
  agentsPanelStore.setState({ filter: readAgentsFilter(filter) });
}

/** A counter of the title bar: the panel, on what it counts. */
export function showAgents(filter: PanelFilter) {
  setAgentsPanel(true);
  setAgentsFilter(filter);
}
