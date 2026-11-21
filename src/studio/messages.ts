import { defineMessages } from "@/i18n";

export const studioMessages = defineMessages({
  open: "Code Studio",
  title: (name: string) => `Code Studio · ${name}`,
  // The files panel: its toggle's name (pressed or not) and the tree's.
  files: "Files",
  refresh: "Refresh the tree",
  filterLabel: "Filter the files",
  filterPlaceholder: "Filter the files…",
  readingTree: "Reading the repository…",
  treeFailed: "Could not read the project's files",
  treeNext: "Refresh the tree to read them again",
  noMatch: "No file matches",
  treeCut: (count: number) => `Only the first ${count} rows are shown: filter to narrow down`,
  // The project has more files than the tree can list: a file past the cut is in the project, not in the list or the filter.
  treeListCut: (count: number) => `Only the first ${count} entries are listed: the filter searches these only`,
  empty: "The repository is empty",
  pickFile: "Pick a file in the tree",
  readingFile: "Reading the file…",
  readFailed: (path: string) => `Could not open ${path}`,
  readNext: "Open it in another editor, or pick another file",
  // The tab's and the file bar's state word, the notes' too: the words its question uses.
  modified: "Unsaved changes",
  closeTab: (name: string) => `Close ${name}`,
  save: "Save (Ctrl+S)",
  saving: "Saving…",
  saveFailed: (path: string) => `Could not save ${path}`,
  /** The tab keeps its changes when a save fails. */
  saveNext: "Your changes stay in the tab: save again",
  saveConflict: (path: string) => `${path} changed on disk: choose which version to keep first`,
  /** A reload that failed, said in the tab: the buffer stays as it was. */
  reloadFailed: (path: string) => `Could not read ${path} again from the disk`,
  reloadNext: "Your version stays in the tab: reload again, or overwrite",
  changedOnDisk: "This file changed on disk, most likely because of an agent",
  reload: "Reload (loses my changes)",
  overwrite: "Overwrite with my version",
  deletedOnDisk: "This file was deleted from the disk",
  recreate: "Create the file again",
  drop: "Close without keeping",
  unsavedFiles: (count: number) => `these ${count} files`,
  // Unsaved changes, one question in one vocabulary: a tab closing (the decision bar) and the window closing (the dialog).
  unsaved: {
    title: (file: string) => `Save ${file}?`,
    description: "Your changes will be lost if you don't save them",
    save: "Save",
    discard: "Don't save",
    cancel: "Cancel",
  },
  preview: "Preview",
  edit: "Code",
  insert: "Insert",
  insertTitle: "Insert this file on the last canvas shown",
  // The ＋ menu's Markdown: a file of the project, rendered on the canvas.
  markdown: {
    pickTitle: "Open a Markdown file",
    filter: "Markdown",
    outside: "This file is not in the project",
    outsideNext: "Pick a Markdown file inside the project's folder",
  },
  goToLine: "Go to line",
  goToLinePlaceholder: "Line or line:column",
  goToLineInvalid: "A line number, e.g. 42 or 42:7",
  // The label beside the Save icon: `save` above is the hint, with the shortcut.
  saveLabel: "Save",
  // What the Markdown preview shows for an image without alt text.
  markdownImage: "image",
});
