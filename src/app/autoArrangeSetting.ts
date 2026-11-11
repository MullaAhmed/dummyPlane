import { toast } from "sonner";
import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { appMessages } from "./messages";

const KEY = "canvas.autoArrange";

/**
 * "Auto-arrange terminals": the canvas tidies itself (Arrange, src/agents/arrange.ts)
 * whenever a node opens or closes and a terminal is minimized or expanded. Off
 * until turned on: it moves what the user placed by hand.
 */
export const autoArrangeStore = createStore<{ enabled: boolean }>()(() => ({ enabled: false }));
export const useAutoArrange = () => useStore(autoArrangeStore, (s) => s.enabled);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** At boot. An unreadable setting keeps it off. */
export async function loadAutoArrange() {
  try {
    autoArrangeStore.setState({ enabled: (await getSetting<unknown>(KEY)) === true });
  } catch (error) {
    console.warn(`canvas settings: ${message(error)}`);
  }
}

/** Turned on, the canvas on screen is arranged at once, one undoable step (`onEnabled`). */
export async function setAutoArrange(enabled: boolean, onEnabled?: () => void) {
  const was = autoArrangeStore.getState().enabled;
  autoArrangeStore.setState({ enabled });
  if (enabled && !was) onEnabled?.();
  await setSetting(KEY, enabled).catch((error: unknown) => toast.error(messages(appMessages).settingNotSaved(message(error))));
}
