import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import { toastError } from "@/lib/errorToast";
import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { call } from "@/ipc/invoke";
import { appMessages } from "./messages";
import { hasUnsavedWork } from "@/studio/studioStore";
import { saveEverything } from "./close";

/** The first look, once the app has settled; then a look every 6 h (spec première version §6.4). */
export const FIRST_CHECK_MS = 10_000;
export const CHECK_EVERY_MS = 6 * 60 * 60_000;
/** A blocked connection must not leave "Check for updates" without an answer. */
export const CHECK_TIMEOUT_MS = 30_000;
const AUTO_KEY = "updates.auto";

/** Where an install stands: the download, with its share once its size is known, then the installer. */
export type UpdateStep = { kind: "downloading"; share: number | null } | { kind: "installing" };

export interface UpdatesState {
  /** "Check for updates automatically": the only request dummyPlane makes on its own. */
  auto: boolean;
  available: { version: string; notes: string } | null;
  /** 0 to 1 while the new version downloads. */
  progress: number | null;
  /** What the dialog says while an update installs: never a 0% that is only an unknown size, nor 100% once installing. */
  step: UpdateStep | null;
  dialogOpen: boolean;
}

export const updatesStore = createStore<UpdatesState>()(() => ({ auto: true, available: null, progress: null, step: null, dialogOpen: false }));
export const useUpdates = <T>(selector: (state: UpdatesState) => T) => useStore(updatesStore, selector);

/** The update found by the last check, downloaded and installed by `installUpdate`. */
let found: Update | null = null;
/** The one `installUpdate` holds: a check that finds the release again must not close it. */
let installing: Update | null = null;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** At boot. Unreadable settings keep checks on. */
export async function loadUpdateSettings() {
  try {
    updatesStore.setState({ auto: (await getSetting<unknown>(AUTO_KEY)) !== false });
  } catch (error) {
    console.warn(`update settings: ${message(error)}`);
  }
}

export async function setAutoUpdates(auto: boolean) {
  updatesStore.setState({ auto });
  await setSetting(AUTO_KEY, auto).catch((error: unknown) => toastError(messages(appMessages).settingNotSaved, { error, next: messages(appMessages).settingForNow }));
}

/** Asks GitHub for the latest release. An automatic check that fails only writes to the log. */
export async function checkForUpdate({ manual = false } = {}) {
  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    if (!update) {
      if (manual) toast(messages(appMessages).upToDate);
      return;
    }
    const previous = found;
    found = update;
    if (previous && previous !== installing) void previous.close().catch(() => undefined);
    // An automatic check never closes a dialog the user has open.
    updatesStore.setState((s) => ({ available: { version: update.version, notes: update.body ?? "" }, dialogOpen: manual || s.dialogOpen }));
  } catch (error) {
    if (manual) toastError(messages(appMessages).updateCheckFailed, { error, next: messages(appMessages).updateCheckNext });
    else console.warn(`update check failed: ${message(error)}`);
  }
}

/**
 * Downloads the new version, saves everything (scene, nodes, terminal histories),
 * then installs: Windows closes dummyPlane for the installer, which starts it again.
 */
export async function installUpdate() {
  const update = found;
  if (!update) return;
  let total = 0;
  let received = 0;
  installing = update;
  updatesStore.setState({ progress: 0, step: { kind: "downloading", share: null } });
  try {
    await update.download((event: DownloadEvent) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") received += event.data.chunkLength;
      const share = total > 0 ? Math.min(1, received / total) : null;
      updatesStore.setState({
        progress: event.event === "Finished" ? 1 : (share ?? 0),
        // Without a size there is no figure to give: "Downloading…", then "Installing…" once the download is done.
        step: event.event === "Finished" ? { kind: "installing" } : { kind: "downloading", share },
      });
    });
    // The installer closes dummyPlane: changes only the user can decide on stop it here, agents untouched.
    if (hasUnsavedWork()) {
      updatesStore.setState({ progress: null, step: null });
      toast.warning(messages(appMessages).updateWaitsForSave);
      return;
    }
    await saveEverything();
    await call<void>("prepare_for_update");
    await update.install();
  } finally {
    installing = null;
  }
}

/** For the app's whole life: 10 s after the start, then every 6 h, while automatic checks are on. */
export function startUpdateChecks(): () => void {
  const run = () => {
    if (updatesStore.getState().auto) void checkForUpdate();
  };
  const first = setTimeout(run, FIRST_CHECK_MS);
  const every = setInterval(run, CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
