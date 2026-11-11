import { toastError } from "@/lib/errorToast";
import { messages } from "@/i18n";
import { call } from "@/ipc/invoke";
import { appMessages } from "./messages";

/** "Open the logs folder" of the palette, the settings menu and the error screens. */
export async function openLogDir() {
  try {
    await call<void>("open_log_dir");
  } catch (error) {
    toastError(messages(appMessages).logsFailed, { error });
  }
}
