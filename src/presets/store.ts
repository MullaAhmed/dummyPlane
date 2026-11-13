import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { presetsMessages } from "./messages";
import { freePresetName, MAX_PRESETS, readPresets, storedPresets, withoutPreset, withPreset, type TeamPreset } from "./model";

/** The setting that holds the presets. */
export const PRESETS_KEY = "presets.teams";

interface PresetsState {
  presets: TeamPreset[];
  /** The saved list was read: nothing is saved over a list not read. */
  loaded: boolean;
  load: () => Promise<void>;
  /** False when the list is full. */
  save: (preset: TeamPreset) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  /**
   * Puts a deleted preset back at `index` (the delete's undo), under a name of its own when one saved meanwhile took
   * its name: both are kept. The name it is back under; null when the list is full.
   */
  restore: (preset: TeamPreset, index: number) => Promise<string | null>;
}

const persist = (presets: TeamPreset[]) => setSetting(PRESETS_KEY, storedPresets(presets));

let reading: Promise<void> | null = null;

/** The list before changing it: a failed read stops the change, it does not read as an empty list. */
async function read() {
  await presetsStore.getState().load();
  if (!presetsStore.getState().loaded) throw new Error(messages(presetsMessages).notRead);
}

export const presetsStore = createStore<PresetsState>()((set, get) => ({
  presets: [],
  loaded: false,
  load: () => {
    if (get().loaded) return Promise.resolve();
    // One read at a time: the palette and a save ask together.
    reading ??= getSetting<unknown>(PRESETS_KEY)
      .then((raw) => set({ presets: readPresets(raw), loaded: true }))
      .catch((error: unknown) => console.warn("presets not read", error))
      .finally(() => {
        reading = null;
      });
    return reading;
  },
  save: async (preset) => {
    await read();
    const next = withPreset(get().presets, preset);
    if (next === null) return false;
    set({ presets: next });
    await persist(next);
    return true;
  },
  remove: async (id) => {
    await read();
    const next = withoutPreset(get().presets, id);
    set({ presets: next });
    await persist(next);
  },
  restore: async (preset, index) => {
    await read();
    const list = get().presets;
    // A second undo: it is back already.
    const back = list.find((p) => p.id === preset.id);
    if (back) return back.name;
    if (list.length >= MAX_PRESETS) return null;
    const restored = { ...preset, name: freePresetName(list, preset.name) };
    const at = Math.max(0, Math.min(index, list.length));
    const next = [...list.slice(0, at), restored, ...list.slice(at)];
    set({ presets: next });
    await persist(next);
    return restored.name;
  },
}));

export function usePresets<T>(selector: (state: PresetsState) => T): T {
  return useStore(presetsStore, selector);
}
