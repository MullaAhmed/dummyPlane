import { createStore, useStore } from "zustand";

const KEY = "dummyplane.recentFunctions";
const MAX = 3;

function read(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** The last functions run from the palette, most recent first (retours J8b). */
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
