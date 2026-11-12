import { toastError } from "@/lib/errorToast";
import { createStore, useStore } from "zustand";
import { DEFAULT_ARRANGE_LAYOUT, readArrangeLayout, type ArrangeLayout } from "@/agents/arrangeLayout";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { appMessages } from "./messages";

const KEY = "canvas.arrangeLayout";

/**
 * "Arrange layout": the shape Arrange gives the canvas (src/agents/arrangeLayout.ts),
 * for Arrange, a group's Arrange and Auto-arrange alike. The tidy grid until
 * another is chosen.
 */
export const arrangeLayoutStore = createStore<{ layout: ArrangeLayout }>()(() => ({ layout: DEFAULT_ARRANGE_LAYOUT }));
export const useArrangeLayout = () => useStore(arrangeLayoutStore, (s) => s.layout);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** At boot. An unreadable or unknown setting keeps the grid. */
export async function loadArrangeLayout() {
  try {
    arrangeLayoutStore.setState({ layout: readArrangeLayout(await getSetting<unknown>(KEY)) });
  } catch (error) {
    console.warn(`canvas settings: ${message(error)}`);
  }
}

/** Another layout chosen: `onChanged` runs once it is in place (the Settings menu re-arranges a canvas Auto-arrange keeps tidy). */
export async function setArrangeLayout(layout: ArrangeLayout, onChanged?: () => void) {
  const next = readArrangeLayout(layout);
  const was = arrangeLayoutStore.getState().layout;
  arrangeLayoutStore.setState({ layout: next });
  if (next !== was) onChanged?.();
  await setSetting(KEY, next).catch((error: unknown) => toastError(messages(appMessages).settingNotSaved, { error, next: messages(appMessages).settingForNow }));
}
