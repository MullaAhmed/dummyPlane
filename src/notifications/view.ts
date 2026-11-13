import type { NotificationEntry } from "./store";

export type NotificationFilter = "all" | "workspace" | "errors";

export const NOTIFICATION_FILTERS: readonly NotificationFilter[] = ["all", "workspace", "errors"];

/** The entries a filter keeps, in the order given: all of them, those about the workspace on screen, or the errors. */
export function filterNotifications(entries: readonly NotificationEntry[], filter: NotificationFilter, activeWorkspaceId: string | null): NotificationEntry[] {
  switch (filter) {
    case "workspace":
      return activeWorkspaceId === null ? [] : entries.filter((e) => e.plane.workspaceId === activeWorkspaceId);
    case "errors":
      return entries.filter((e) => e.kind === "error");
    default:
      return [...entries];
  }
}

/** How many entries each filter keeps: the numbers beside their names. */
export function filterCounts(entries: readonly NotificationEntry[], activeWorkspaceId: string | null): Record<NotificationFilter, number> {
  return {
    all: entries.length,
    workspace: filterNotifications(entries, "workspace", activeWorkspaceId).length,
    errors: filterNotifications(entries, "errors", activeWorkspaceId).length,
  };
}
