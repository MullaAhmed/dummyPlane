import type { NotificationType } from "./capture";
import type { NotificationEntry } from "./store";

export type NotificationFilter = "all" | "workspace" | "question" | "finished" | "board";

export const NOTIFICATION_FILTERS: readonly NotificationFilter[] = ["all", "workspace", "question", "finished", "board"];

/** The type a filter keeps, for the filters that keep one. */
const TYPE_OF: Partial<Record<NotificationFilter, NotificationType>> = { question: "question", finished: "finished", board: "board" };

/** The entries a filter keeps, in the order given: all of them, those about the workspace on screen, or one type. */
export function filterNotifications(entries: readonly NotificationEntry[], filter: NotificationFilter, activeWorkspaceId: string | null): NotificationEntry[] {
  if (filter === "workspace") return activeWorkspaceId === null ? [] : entries.filter((e) => e.plane.workspaceId === activeWorkspaceId);
  const type = TYPE_OF[filter];
  return type ? entries.filter((e) => e.type === type) : [...entries];
}

/** How many entries each filter keeps: the numbers beside their names. */
export function filterCounts(entries: readonly NotificationEntry[], activeWorkspaceId: string | null): Record<NotificationFilter, number> {
  return Object.fromEntries(NOTIFICATION_FILTERS.map((filter) => [filter, filterNotifications(entries, filter, activeWorkspaceId).length])) as Record<
    NotificationFilter,
    number
  >;
}
