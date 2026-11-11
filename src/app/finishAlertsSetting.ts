import { toastError } from "@/lib/errorToast";
import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { appMessages } from "./messages";

const KEY = "notifications.finish";

/** "Alert when an agent finishes": a main agent that reports or ends a real turn says so (`@/shell/finishAlert`). */
export const finishAlertsStore = createStore<{ enabled: boolean }>()(() => ({ enabled: true }));
export const useFinishAlerts = () => useStore(finishAlertsStore, (s) => s.enabled);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** At boot. An unreadable setting keeps it on. */
export async function loadFinishAlerts() {
  try {
    finishAlertsStore.setState({ enabled: (await getSetting<unknown>(KEY)) !== false });
  } catch (error) {
    console.warn(`notification settings: ${message(error)}`);
  }
}

export async function setFinishAlerts(enabled: boolean) {
  finishAlertsStore.setState({ enabled });
  await setSetting(KEY, enabled).catch((error: unknown) => toastError(messages(appMessages).settingNotSaved, { error, next: messages(appMessages).settingForNow }));
}
