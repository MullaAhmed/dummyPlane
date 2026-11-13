import { describe, expect, it } from "vitest";
import type { NotificationType } from "./capture";
import type { NotificationEntry } from "./store";
import { filterCounts, filterNotifications, NOTIFICATION_FILTERS } from "./view";

const entry = (id: string, type: NotificationType, workspaceId: string | null): NotificationEntry => ({
  id,
  at: 0,
  type,
  kind: type === "question" ? "info" : "success",
  title: id,
  read: false,
  plane: { projectId: "p1", workspaceId, nodeId: null, projectName: "Alpha", workspaceName: null },
});

const entries = [entry("a", "question", "w1"), entry("b", "finished", "w2"), entry("c", "finished", "w1"), entry("d", "board", null), entry("e", "question", "w2")];
const ids = (list: NotificationEntry[]) => list.map((e) => e.id);

describe("the filters", () => {
  it("are All, This workspace, Questions, Finished and Boards: no Errors any more", () => {
    expect(NOTIFICATION_FILTERS).toEqual(["all", "workspace", "question", "finished", "board"]);
  });

  it("All keeps everything, in order", () => {
    expect(ids(filterNotifications(entries, "all", "w1"))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("This workspace keeps what is about the workspace on screen", () => {
    expect(ids(filterNotifications(entries, "workspace", "w1"))).toEqual(["a", "c"]);
    expect(ids(filterNotifications(entries, "workspace", "w2"))).toEqual(["b", "e"]);
  });

  it("This workspace keeps nothing when no workspace is on screen", () => {
    expect(filterNotifications(entries, "workspace", null)).toEqual([]);
  });

  it("Questions, Finished and Boards each keep their type, in any workspace", () => {
    expect(ids(filterNotifications(entries, "question", "w1"))).toEqual(["a", "e"]);
    expect(ids(filterNotifications(entries, "finished", "w1"))).toEqual(["b", "c"]);
    expect(ids(filterNotifications(entries, "board", "w1"))).toEqual(["d"]);
  });

  it("count what each keeps", () => {
    expect(filterCounts(entries, "w1")).toEqual({ all: 5, workspace: 2, question: 2, finished: 2, board: 1 });
  });
});
