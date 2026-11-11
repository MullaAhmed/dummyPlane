import { createStore, useStore } from "zustand";

const KEY = "dummyplane.recentFunctions";
const MAX = 3;

/**
 * Stored data: the ids a saved list can hold from when the fleet was called the orchestrator, and what they
 * are now. They are carried over when the list is read, once; an id that no command has is filtered out
 * when the palette shows it, and the carried-over list is written back on the next `rememberFunction`.
 */
export const RENAMED_COMMANDS: ReadonlyMap<string, string> = new Map([
  ["agent.orchestrator", "agent.fleet"],
  ["group.orchestrate", "group.linkFleet"],
  ["orchestrator.write", "fleet.write"],
  ["orchestrator.rename", "fleet.rename"],
  ["orchestrator.link", "fleet.link"],
  ["orchestrator.paste", "fleet.paste"],
  ["orchestrator.remove", "fleet.remove"],
]);

function read(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(ids)) return [];
    const current = ids.filter((id): id is string => typeof id === "string").map((id) => RENAMED_COMMANDS.get(id) ?? id);
    return [...new Set(current)].slice(0, MAX);
  } catch {
    return [];
  }
}

/** The last functions run from the palette, most recent first. */
export const recentStore = createStore<{ ids: string[] }>()(() => ({ ids: read() }));

/** A function run from the palette heads "Recent", the oldest of three leaving; the palette's own are left out. */
export function rememberFunction(id: string) {
  if (id.startsWith("palette.")) return;
  const ids = [id, ...recentStore.getState().ids.filter((other) => other !== id)].slice(0, MAX);
  recentStore.setState({ ids });
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Kept until dummyPlane closes.
  }
}

export function useRecentFunctions(): string[] {
  return useStore(recentStore, (s) => s.ids);
}
