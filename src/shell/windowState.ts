import { getCurrentWindow } from "@tauri-apps/api/window";
import { toastError } from "@/lib/errorToast";
import { createStore } from "zustand";
import { messages } from "@/i18n";
import { shellMessages } from "./messages";

/** Whether the window is maximized, kept by the window buttons: "Maximize" or "Restore" in the palette. */
export const windowStore = createStore<{ maximized: boolean }>()(() => ({ maximized: false }));

type Failure = "minimizeFailed" | "restoreFailed" | "maximizeFailed" | "closeFailed";

function perform(action: () => Promise<void>, failure: Failure) {
  void action().catch((error: unknown) => {
    const t = messages(shellMessages);
    toastError(t.window[failure], { error });
  });
}

export function minimizeWindow() {
  perform(() => getCurrentWindow().minimize(), "minimizeFailed");
}

export function toggleMaximizeWindow() {
  const failure = windowStore.getState().maximized ? "restoreFailed" : "maximizeFailed";
  perform(() => getCurrentWindow().toggleMaximize(), failure);
}

/** close, not destroy: onCloseRequested saves first (src/app/close.ts). */
export function closeWindow() {
  perform(() => getCurrentWindow().close(), "closeFailed");
}
