import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { messages } from "@/i18n";
import { appMessages } from "./messages";

/** "About dummyPlane" of the settings menu and the palette. */
export async function showAbout() {
  const version = await getVersion();
  toast(`dummyPlane ${version}`, { description: messages(appMessages).aboutDescription });
}
