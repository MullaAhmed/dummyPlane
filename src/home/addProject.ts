import { open } from "@tauri-apps/plugin-dialog";
import { toastError } from "@/lib/errorToast";
import { messages } from "@/i18n";
import { projectsStore } from "@/store/projects";
import { homeMessages } from "./messages";

/** "Add a project" of the home screen and the palette: a folder, picked in Windows' dialog. */
export async function addProject() {
  const picked = await open({ directory: true, title: messages(homeMessages).pickFolder });
  if (typeof picked !== "string") return;
  await projectsStore
    .getState()
    .add(picked)
    .catch((error: unknown) => toastError(messages(homeMessages).addFailed, { error }));
}
