import { toastError } from "@/lib/errorToast";
import { messages } from "@/i18n";
import { noteMessages } from "./messages";

/**
 * "Quick note" of a node's "⋯", the radial menu and the palette: a note beside
 * the terminal or the Fleet `hostId`, its text taking the keyboard
 * (`addNote`). Loaded when asked: the note's actions bring Excalidraw's
 * runtime, which a header has no other reason to load. Resolves with the
 * note's id, or null when the host is not on a canvas; a failure says so.
 */
export async function quickNote(hostId: string): Promise<string | null> {
  try {
    const { addNote } = await import("./notes");
    return await addNote(hostId);
  } catch (error) {
    toastError(messages(noteMessages).addFailed, { error });
    return null;
  }
}
