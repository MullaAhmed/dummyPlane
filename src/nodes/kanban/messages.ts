import { defineMessages } from "@/i18n";
import type { KanbanPriority } from "@/nodes/types";

/** The texts of the Kanban node (issue #29). */
export const kanbanNodeMessages = defineMessages<{
  notFound: string;
  title: string;
  empty: string;
  addColumn: string;
  linkAgent: string;
  newColumn: string;
  columnMenu: (title: string) => string;
  rename: string;
  removeColumn: string;
  columnRemoved: (title: string, cards: number) => string;
  cardRemoved: (title: string) => string;
  undo: string;
  doubleClickRename: string;
  cardCount: (count: number) => string;
  newCard: string;
  addCardTo: (title: string) => string;
  editCard: string;
  cardTitle: string;
  cardTitlePlaceholder: string;
  notes: string;
  notesPlaceholder: string;
  due: string;
  dueNone: string;
  dueToday: string;
  dueTomorrow: string;
  dueNextWeek: string;
  dueDate: string;
  priority: string;
  priorities: Record<KanbanPriority, string>;
  save: string;
  cancel: string;
  remove: string;
  overdue: string;
  githubIssue: (repo: string, number: number) => string;
  agentChip: (name: string) => string;
  agentAlert: Record<"blocked" | "failed", (name: string) => string>;
  card: {
    menu: string;
    moveTo: string;
    moveUp: string;
    moveDown: string;
    sendTo: string;
    noTerminal: string;
    moved: (column: string, position: number, count: number) => string;
    openIssue: string;
  };
  fleet: { plan: string; create: string; linked: (name: string) => string };
  github: {
    boardMenu: string;
    link: string;
    editLink: string;
    unlink: string;
    sync: string;
    syncing: string;
    linkTitle: string;
    linkHint: string;
    repo: string;
    repoPlaceholder: string;
    detecting: string;
    notDetected: string;
    repoInvalid: string;
    project: string;
    projectPlaceholder: string;
    projectInvalid: string;
    confirm: string;
    createIssue: string;
    creatingIssue: string;
    linkedTo: (repo: string) => string;
  };
}>(
  {
    notFound: "Board not found",
    title: "Kanban",
    empty: "No columns yet.",
    addColumn: "Add a column",
    linkAgent: "Link an agent…",
    newColumn: "New column",
    columnMenu: (title) => `${title} column menu`,
    rename: "Rename",
    removeColumn: "Delete the column",
    // Said by the toast that can take the delete back.
    columnRemoved: (title, cards) => `Column “${title}” deleted${cards === 0 ? "" : `, with its ${cards} card${cards === 1 ? "" : "s"}`}`,
    cardRemoved: (title) => `Card “${title}” deleted`,
    undo: "Undo",
    agentChip: (name) => `${name} is working on it`,
    agentAlert: { blocked: (name) => `${name} is blocked`, failed: (name) => `${name} failed` },
    card: {
      menu: "Card actions",
      moveTo: "Move to",
      moveUp: "Move up",
      moveDown: "Move down",
      sendTo: "Send to",
      noTerminal: "No terminal on this canvas",
      moved: (column, position, count) => `Moved to ${column}, ${position} of ${count}`,
      openIssue: "Open the issue on GitHub",
    },
    fleet: { plan: "Plan with the fleet", create: "New fleet", linked: (name) => `${name} (linked)` },
    doubleClickRename: "Double-click to rename",
    cardCount: (count) => `${count} card${count === 1 ? "" : "s"}`,
    newCard: "New card",
    addCardTo: (title) => `New card in ${title}`,
    editCard: "Edit the card",
    cardTitle: "Title",
    cardTitlePlaceholder: "What needs doing?",
    notes: "Notes",
    notesPlaceholder: "Details, links, criteria…",
    due: "Due",
    dueNone: "None",
    dueToday: "Today",
    dueTomorrow: "Tomorrow",
    dueNextWeek: "Next week",
    dueDate: "Date",
    priority: "Priority",
    priorities: { none: "None", low: "Low", medium: "Medium", high: "High" },
    save: "Save",
    cancel: "Cancel",
    remove: "Delete",
    overdue: "Overdue",
    githubIssue: (repo, number) => `Issue ${repo}#${number}`,
    github: {
      boardMenu: "Board menu",
      link: "Link to GitHub…",
      editLink: "Edit the GitHub link…",
      unlink: "Unlink from GitHub",
      sync: "Sync",
      syncing: "Syncing…",
      linkTitle: "Link to GitHub",
      linkHint: "The repository's issues become cards; moving a card closes, reopens or changes the Status on GitHub (through gh).",
      repo: "Repository",
      repoPlaceholder: "owner/name",
      detecting: "Detecting the repository…",
      notDetected: "No GitHub repository in the project's origin remote: type it in.",
      repoInvalid: "Expected: owner/name",
      project: "Project v2 (optional)",
      projectPlaceholder: "owner/number or Project URL",
      projectInvalid: "Expected: owner/number or https://github.com/orgs/…/projects/N",
      confirm: "Link and sync",
      createIssue: "Create the issue on GitHub",
      creatingIssue: "Creating…",
      linkedTo: (repo) => `Linked to ${repo}`,
    },
  },
);
