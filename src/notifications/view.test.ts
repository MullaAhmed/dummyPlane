import { describe, expect, it } from "vitest";
import type { ToastKind } from "./capture";
import type { NotificationEntry } from "./store";
import { filterCounts, filterNotifications } from "./view";

const entry = (id: string, kind: ToastKind, workspaceId: string | null): NotificationEntry => ({
  id,
  at: 0,
  kind,
  title: id,
  read: false,
  plane: { projectId: "p1", workspaceId, nodeId: null, projectName: "Alpha", workspaceName: null },
});

const entries = [entry("a", "info", "w1"), entry("b", "error", "w2"), entry("c", "error", "w1"), entry("d", "success", null), entry("e", "warning", "w2")];
const ids = (list: NotificationEntry[]) => list.map((e) => e.id);

describe("the filters", () => {
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

  it("Errors keeps the errors, in any workspace", () => {
    expect(ids(filterNotifications(entries, "errors", "w1"))).toEqual(["b", "c"]);
  });

  it("count what each keeps", () => {
    expect(filterCounts(entries, "w1")).toEqual({ all: 5, workspace: 2, errors: 2 });
  });
});
