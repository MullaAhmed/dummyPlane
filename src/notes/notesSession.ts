import { createFileSession, isDirty, type FileSession } from "@/studio/fileSession";
import { countUnsaved } from "@/studio/studioStore";
import { notesRead, notesVersion, notesWrite } from "./ipc";

/**
 * Each project's notes, as their tab edits them: the open note and its draft
 * live here, not in the tab, so that leaving the tab, the project or closing
 * the tab loses nothing; the window's close asks about a modified note
 * whichever tab is on screen (studio/QuitPrompt.tsx).
 */
const sessions = new Map<string, FileSession>();

export function notesSession(projectId: string): FileSession {
  let session = sessions.get(projectId);
  if (!session) {
    session = createFileSession({
      read: (name) => notesRead(projectId, name),
      version: (name) => notesVersion(projectId, name),
      write: (name, text, expected) => notesWrite(projectId, name, text, expected),
    });
    sessions.set(projectId, session);
  }
  return session;
}

countUnsaved({
  // Named as the files are on disk, so the quit's question names the note.
  tabs: () =>
    [...sessions.values()]
      .filter((session) => isDirty(session.getState()))
      .map((session) => ({ path: `.dummyplane/notes/${session.getState().file}.md`, session })),
  drop: () => {
    for (const session of sessions.values()) session.getState().dropFile();
  },
});

/** Tests start from no session. */
export function forgetNotesSessions() {
  sessions.clear();
}
