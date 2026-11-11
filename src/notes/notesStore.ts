import { toastError } from "@/lib/errorToast";
import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { workspacesStore } from "@/store/workspaces";
import { notesMessages } from "./messages";

interface NotesUi {
  /** The group whose notes are being chosen. */
  attaching: string | null;
}

/** Light on purpose: the rail, the palette and the group menu import it, CodeMirror stays out of the first load. */
export const notesStore = createStore<NotesUi>()(() => ({ attaching: null }));

export const useNotesUi = <T,>(selector: (state: NotesUi) => T) => useStore(notesStore, selector);

/** The project's notes, in their workspace tab: created the first time, selected after. */
export function openNotes() {
  void workspacesStore
    .getState()
    .openNotes()
    .catch((error: unknown) => toastError(messages(notesMessages).openFailed, { error }));
}

export const openGroupNotes = (groupId: string) => notesStore.setState({ attaching: groupId });
export const closeGroupNotes = () => notesStore.setState({ attaching: null });
