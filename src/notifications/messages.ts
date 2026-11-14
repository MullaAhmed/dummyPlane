import { defineMessages } from "@/i18n";

/** The notification panel's texts: the bell, the list of what agents and boards told, its filters and actions. */
export const notificationsMessages = defineMessages({
  title: "Notifications",
  /** The bell's name; with unread ones it says its number first, as the pip shows it (WCAG 2.5.3 label in name). */
  bell: "Notifications",
  bellUnread: (count: number) => `Notifications, ${count} unread`,
  close: "Close notifications",
  filters: "Show",
  filter: { all: "All", workspace: "This workspace", question: "Questions", finished: "Finished", board: "Boards" },
  list: "Notifications, newest first",
  markAllRead: "Mark all read",
  clear: "Clear",
  empty: "Nothing yet. An agent that finishes or asks you something, and a board whose cards are all done, are kept here.",
  noneInFilter: "Nothing here.",
  /** What a notification tells, shown on its row. */
  types: { finished: "Finished", board: "Board", question: "Question" },
  unread: "Unread",
  /** Where a notification was about when its workspace or project is gone. */
  closed: "(closed)",
  /** A notification that came with no project open (the home screen). */
  noProject: "No project open",
  openFailed: (project: string) => `Could not open ${project}`,
});
