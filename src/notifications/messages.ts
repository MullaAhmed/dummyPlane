import { defineMessages } from "@/i18n";

/** The notification panel's texts: the bell, the list of popups the app has shown, its filters and actions. */
export const notificationsMessages = defineMessages({
  title: "Notifications",
  /** The bell's name; with unread ones it says its number first, as the pip shows it (WCAG 2.5.3 label in name). */
  bell: "Notifications",
  bellUnread: (count: number) => `Notifications, ${count} unread`,
  close: "Close notifications",
  filters: "Show",
  filter: { all: "All", workspace: "This workspace", errors: "Errors" },
  list: "Notifications, newest first",
  markAllRead: "Mark all read",
  clear: "Clear",
  empty: "Nothing has popped up yet. Popups the app shows are kept here.",
  noneInFilter: "Nothing here.",
  /** The kind of a popup, for a screen reader and the icon's name. */
  kinds: { success: "Success", error: "Error", warning: "Warning", info: "Info", plain: "Notice" },
  unread: "Unread",
  /** Where a popup was about when its workspace or project is gone. */
  closed: "(closed)",
  /** A popup shown with no project open (the home screen). */
  noProject: "No project open",
  /** A popup with an action button: what the button said. */
  action: (label: string) => `Offered: ${label}`,
  openFailed: (project: string) => `Could not open ${project}`,
});
