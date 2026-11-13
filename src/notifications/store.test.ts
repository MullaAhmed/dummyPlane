// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Project, Workspace } from "@/ipc/db";
import { flushAll } from "@/lib/flush";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { capture, type Captured } from "./capture";
import {
  connectNotifications,
  loadNotifications,
  MAX_NOTIFICATIONS,
  notificationsStore,
  NOTIFICATIONS_KEY,
  planeOf,
  readNotifications,
  unreadCount,
} from "./store";

const project = (id: string, name: string): Project => ({ id, name, path: `C:/${name}`, position: 0, lastOpenedAt: 0, workspaceCount: 1, missing: false, liveAgents: 0 });
const workspace = (id: string, projectId: string, name: string): Workspace => ({ id, projectId, name, position: 0, pantheon: null, kind: "canvas", folder: null });

/** The app with project p1 open: its workspaces w1 (on screen) and w2. */
function showProject(active = "w1") {
  projectsStore.setState({ view: "project", activeId: "p1", projects: [project("p1", "Alpha"), project("p2", "Beta")] });
  workspacesStore.setState({
    projectId: "p1",
    activeId: active,
    status: "ready",
    workspaces: [workspace("w1", "p1", "Main"), workspace("w2", "p1", "Second")],
  });
}

let counter = 0;
/** A popup as the shim hands it over. */
const popup = (over: Partial<Captured> = {}): Captured => ({
  toastId: undefined,
  kind: "plain",
  title: `popup ${counter}`,
  description: undefined,
  action: undefined,
  context: null,
  at: 1_000 + counter++,
  ...over,
});
const add = (over: Partial<Captured> = {}) => notificationsStore.getState().add(popup(over));
const entries = () => notificationsStore.getState().entries;

let writes: { key: string; value: unknown }[];
let stored: Map<string, unknown>;

beforeEach(() => {
  counter = 0;
  writes = [];
  stored = new Map();
  notificationsStore.setState({ entries: [], loaded: false });
  nodesStore.setState({ nodes: {} });
  showProject();
  mockIPC((cmd, raw) => {
    const args = raw as { key: string; value: unknown };
    if (cmd === "get_setting") return stored.get(args.key) ?? null;
    if (cmd === "set_setting") writes.push({ key: args.key, value: args.value });
    return undefined;
  });
});
afterEach(() => {
  clearMocks();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("what a popup is about", () => {
  it("is the workspace on screen, with its project, for a plain popup", () => {
    add({ title: "Link copied" });
    expect(entries()[0]).toMatchObject({
      kind: "plain",
      title: "Link copied",
      read: false,
      plane: { projectId: "p1", workspaceId: "w1", nodeId: null, projectName: "Alpha", workspaceName: "Main" },
    });
  });

  it("is the workspace on screen when an error popup shows, whichever one that is", () => {
    showProject("w2");
    add({ kind: "error", title: "Could not push", description: "rejected" });
    expect(entries()[0]).toMatchObject({ kind: "error", description: "rejected", plane: { workspaceId: "w2", workspaceName: "Second" } });
  });

  it("is the node's workspace when the popup names a node, even with another canvas on screen", () => {
    nodesStore.setState({ nodes: { alan: { workspaceId: "w2", kind: "terminal", payload: { name: "Alan" } } } as never });
    add({ title: "Alan finished", context: { nodeId: "alan" } });
    expect(entries()[0].plane).toEqual({ projectId: "p1", workspaceId: "w2", nodeId: "alan", projectName: "Alpha", workspaceName: "Second" });
  });

  it("is the workspace a popup names, when it names no node", () => {
    add({ title: "Resume all conversations?", context: { workspaceId: "w2" } });
    expect(entries()[0].plane).toMatchObject({ workspaceId: "w2", nodeId: null, workspaceName: "Second" });
  });

  it("keeps the plane of a node in a project that is no longer open, from the workspaces seen this run", () => {
    connectNotifications();
    showProject();
    nodesStore.setState({ nodes: { old: { workspaceId: "w1", kind: "terminal", payload: { name: "Old" } } } as never });
    // Another project is opened: its list replaces the first one's.
    projectsStore.setState({ activeId: "p2" });
    workspacesStore.setState({ projectId: "p2", activeId: "x1", workspaces: [workspace("x1", "p2", "Other")] });
    add({ title: "Old finished", context: { nodeId: "old" } });
    expect(entries()[0].plane).toEqual({ projectId: "p1", workspaceId: "w1", nodeId: "old", projectName: "Alpha", workspaceName: "Main" });
  });

  it("is nothing on the home screen: no workspace is shown there", () => {
    projectsStore.setState({ view: "home" });
    add({ title: "No project" });
    expect(entries()[0].plane).toEqual({ projectId: null, workspaceId: null, nodeId: null, projectName: null, workspaceName: null });
  });

  it("is read when it is asked for, without recording anything", () => {
    expect(planeOf({ workspaceId: "w2" }).workspaceName).toBe("Second");
    expect(entries()).toEqual([]);
  });
});

describe("the history", () => {
  it("lists the newest popup first", () => {
    add({ title: "one" });
    add({ title: "two" });
    add({ title: "three" });
    expect(entries().map((e) => e.title)).toEqual(["three", "two", "one"]);
  });

  it("keeps the last 200, dropping the oldest", () => {
    for (let i = 0; i < MAX_NOTIFICATIONS + 5; i++) add({ title: `n${i}` });
    expect(entries()).toHaveLength(MAX_NOTIFICATIONS);
    expect(entries()[0].title).toBe(`n${MAX_NOTIFICATIONS + 4}`);
    expect(entries()[entries().length - 1].title).toBe("n5");
  });

  it("shows a popup again under the id it has as that popup, updated and unread, not a second entry", () => {
    add({ title: "Moving to web", toastId: "folder-move:n1" });
    notificationsStore.getState().markRead(entries()[0].id);
    add({ title: "Moving to api", toastId: "folder-move:n1" });
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ title: "Moving to api", read: false });
  });

  it("keeps an entry read when the same popup is shown again with the same words: an offer that returns with each visit", () => {
    add({ title: "Resume all conversations?", toastId: "resume-all-w1" });
    notificationsStore.getState().markRead(entries()[0].id);
    add({ title: "Resume all conversations?", toastId: "resume-all-w1" });
    expect(entries()).toHaveLength(1);
    expect(entries()[0].read).toBe(true);
    // A new description is news again.
    add({ title: "Resume all conversations?", description: "2 consoles", toastId: "resume-all-w1" });
    expect(entries()[0].read).toBe(false);
  });

  it("keeps popups with different ids, and those with none, apart", () => {
    add({ title: "a", toastId: 1 });
    add({ title: "b", toastId: 2 });
    add({ title: "c" });
    add({ title: "d" });
    expect(entries()).toHaveLength(4);
  });

  it("records an action's label", () => {
    add({ title: "Column removed", action: "Undo" });
    expect(entries()[0].action).toBe("Undo");
  });
});

describe("unread", () => {
  it("counts the popups not read yet, and a click reads one", () => {
    add({ title: "a" });
    add({ title: "b" });
    add({ title: "c" });
    expect(unreadCount(entries())).toBe(3);
    notificationsStore.getState().markRead(entries()[1].id);
    expect(unreadCount(entries())).toBe(2);
    expect(entries().find((e) => e.title === "b")?.read).toBe(true);
  });

  it("marks all read, leaving the entries", () => {
    add({ title: "a" });
    add({ title: "b" });
    notificationsStore.getState().markAllRead();
    expect(unreadCount(entries())).toBe(0);
    expect(entries()).toHaveLength(2);
  });

  it("clears the list", () => {
    add({ title: "a" });
    notificationsStore.getState().clear();
    expect(entries()).toEqual([]);
  });

  it("leaves the state alone when there is nothing to change", () => {
    const before = notificationsStore.getState().entries;
    notificationsStore.getState().markAllRead();
    notificationsStore.getState().clear();
    expect(notificationsStore.getState().entries).toBe(before);
  });
});

describe("what is saved", () => {
  it("reads back the entries it can, newest first, at most 200, and drops the rest", () => {
    const good = (i: number) => ({ id: `id${i}`, at: i, kind: "info", title: `t${i}`, read: i % 2 === 0, plane: { projectId: "p1", workspaceId: "w1", nodeId: null, projectName: "Alpha", workspaceName: "Main" } });
    const rows = [...Array.from({ length: 250 }, (_, i) => good(i)), null, 3, { id: "x" }, { ...good(999), kind: "bogus" }, { ...good(998), title: "" }, good(5)];
    const read = readNotifications(rows);
    expect(read).toHaveLength(MAX_NOTIFICATIONS);
    expect(read[0].id).toBe("id249");
    expect(readNotifications("nope")).toEqual([]);
    expect(readNotifications(null)).toEqual([]);
  });

  it("reads a row saved twice as one", () => {
    const row = { id: "a", at: 1, kind: "info", title: "t", read: false, plane: {} };
    expect(readNotifications([row, { ...row }])).toHaveLength(1);
  });

  it("reads an entry with its plane, its read mark, its description and its action", () => {
    const [entry] = readNotifications([
      { id: "a", at: 5, kind: "warning", title: "Past Max agents", description: "5 of 4", action: "Show", read: true, plane: { projectId: "p1", workspaceId: "w1", nodeId: "n1", projectName: "Alpha", workspaceName: "Main" } },
    ]);
    expect(entry).toEqual({
      id: "a",
      at: 5,
      kind: "warning",
      title: "Past Max agents",
      description: "5 of 4",
      action: "Show",
      read: true,
      plane: { projectId: "p1", workspaceId: "w1", nodeId: "n1", projectName: "Alpha", workspaceName: "Main" },
    });
  });

  it("writes the history a second after the last change, as one write, without the ids sonner showed them under", async () => {
    vi.useFakeTimers();
    await loadNotifications();
    await vi.advanceTimersByTimeAsync(1100);
    writes.length = 0;
    add({ title: "a", toastId: 7 });
    add({ title: "b" });
    add({ title: "c" });
    await vi.advanceTimersByTimeAsync(900);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].key).toBe(NOTIFICATIONS_KEY);
    const value = writes[0].value as Record<string, unknown>[];
    expect(value.map((e) => e.title)).toEqual(["c", "b", "a"]);
    expect(value.some((e) => "toastId" in e)).toBe(false);
  });

  it("writes at once when the app is asked to save everything (closing, switching project)", async () => {
    vi.useFakeTimers();
    await loadNotifications();
    await vi.advanceTimersByTimeAsync(1100);
    writes.length = 0;
    add({ title: "last words" });
    await flushAll();
    expect(writes).toHaveLength(1);
  });

  it("loads the saved history at boot, newest first", async () => {
    stored.set(NOTIFICATIONS_KEY, [
      { id: "a", at: 10, kind: "success", title: "older", read: true, plane: {} },
      { id: "b", at: 20, kind: "error", title: "newer", read: false, plane: { projectId: "p1", workspaceId: "w1", workspaceName: "Main", projectName: "Alpha" } },
    ]);
    await loadNotifications();
    expect(entries().map((e) => e.title)).toEqual(["newer", "older"]);
    expect(entries()[0]).toMatchObject({ read: false, plane: { workspaceId: "w1", workspaceName: "Main" } });
    expect(notificationsStore.getState().loaded).toBe(true);
  });

  it("puts what popped during boot above the saved history, and writes both", async () => {
    vi.useFakeTimers();
    stored.set(NOTIFICATIONS_KEY, [{ id: "a", at: 10, kind: "info", title: "from last run", read: true, plane: {} }]);
    connectNotifications();
    // The hooks warning of boot, shown before the history was read.
    capture({ kind: "warning", title: "Hooks are down" });
    expect(entries().map((e) => e.title)).toEqual(["Hooks are down"]);
    await loadNotifications();
    expect(entries().map((e) => e.title)).toEqual(["Hooks are down", "from last run"]);
    await vi.advanceTimersByTimeAsync(1100);
    expect((writes[writes.length - 1].value as { title: string }[]).map((e) => e.title)).toEqual(["Hooks are down", "from last run"]);
  });

  it("writes nothing before the saved history was read: it is the only copy", async () => {
    vi.useFakeTimers();
    connectNotifications();
    add({ title: "too early" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toEqual([]);
  });

  it("leaves a history it could not read on disk: nothing is written this run, and no popup says so", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockIPC((cmd, raw) => {
      if (cmd === "get_setting") throw new Error("db locked");
      if (cmd === "set_setting") writes.push(raw as { key: string; value: unknown });
      return undefined;
    });
    await loadNotifications();
    expect(notificationsStore.getState().loaded).toBe(false);
    add({ title: "after the failure" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toEqual([]);
    expect(entries()).toHaveLength(1);
  });

  it("does not loop when a save fails: it is logged, never shown as a popup", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await loadNotifications();
    await vi.advanceTimersByTimeAsync(1100);
    mockIPC((cmd) => {
      if (cmd === "set_setting") throw new Error("disk full");
      return null;
    });
    const before = entries().length;
    add({ title: "a" });
    await vi.advanceTimersByTimeAsync(1100);
    expect(warn).toHaveBeenCalledWith("notifications not saved", expect.anything());
    expect(entries()).toHaveLength(before + 1);
  });
});
