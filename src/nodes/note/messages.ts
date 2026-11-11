import { defineMessages } from "@/i18n";

/** The texts of a quick note (src/nodes/note). */
export const noteMessages = defineMessages({
  /** "Quick note", in the ⋯ menus of a terminal and of a Fleet. */
  add: "Quick note",
  /** The card's title: beside which node it stands, or alone once that node closed. */
  title: "Note",
  titleOf: (host: string) => `Note · ${host}`,
  /** The text field's name for assistive technology. */
  field: (host: string) => (host ? `Note on ${host}` : "Note"),
  placeholder: "Write a note…",
  delete: "Delete the note",
  /** Its host closed: it stays on the canvas, alone. */
  alone: "Its terminal was closed: this note stays here on its own.",
  deleted: (count: number) => (count === 1 ? "Note deleted" : `${count} notes deleted`),
  undo: "Undo",
  notFound: "Note not found",
  addFailed: (error: string) => `The note could not be added: ${error}`,
});
