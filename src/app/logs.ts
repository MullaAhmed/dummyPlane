import { toast } from "sonner";
import { messages } from "@/i18n";
import { call } from "@/ipc/invoke";
import { appMessages } from "./messages";

/** "Open the logs folder" of the palette, the settings menu and the error screens. */
export async function openLogDir() {
  try {
    await call<void>("open_log_dir");
  } catch (error) {
    toast.error(messages(appMessages).logsFailed, { description: error instanceof Error ? error.message : String(error) });
  }
}
