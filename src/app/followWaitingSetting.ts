import { toastError } from "@/lib/errorToast";
import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { appMessages } from "./messages";

const KEY = "notifications.follow";

/** "Go to agents that ask": the view follows an agent that starts waiting; the notice at the bottom left does not depend on it. */
export const followWaitingStore = createStore<{ enabled: boolean }>()(() => ({ enabled: true }));
export const useFollowWaiting = () => useStore(followWaitingStore, (s) => s.enabled);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** At boot. An unreadable setting keeps it on. */
export async function loadFollowWaiting() {
  try {
    followWaitingStore.setState({ enabled: (await getSetting<unknown>(KEY)) !== false });
  } catch (error) {
    console.warn(`notification settings: ${message(error)}`);
  }
}

export async function setFollowWaiting(enabled: boolean) {
  followWaitingStore.setState({ enabled });
  await setSetting(KEY, enabled).catch((error: unknown) => toastError(messages(appMessages).settingNotSaved, { error, next: messages(appMessages).settingForNow }));
}
