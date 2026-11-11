import { toastError } from "@/lib/errorToast";
import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { appMessages } from "./messages";

const KEY = "notifications.native";

/** "Windows notifications"; the notice in the window does not depend on it. */
export const nativeNotificationsStore = createStore<{ enabled: boolean }>()(() => ({ enabled: true }));
export const useNativeNotifications = () => useStore(nativeNotificationsStore, (s) => s.enabled);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** At boot. An unreadable setting keeps them on. */
export async function loadNativeNotifications() {
  try {
    nativeNotificationsStore.setState({ enabled: (await getSetting<unknown>(KEY)) !== false });
  } catch (error) {
    console.warn(`notification settings: ${message(error)}`);
  }
}

export async function setNativeNotifications(enabled: boolean) {
  nativeNotificationsStore.setState({ enabled });
  await setSetting(KEY, enabled).catch((error: unknown) => toastError(messages(appMessages).settingNotSaved, { error, next: messages(appMessages).settingForNow }));
}
