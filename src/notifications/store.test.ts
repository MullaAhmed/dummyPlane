// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Project, Workspace } from "@/ipc/db";
import { flushAll } from "@/lib/flush";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { recordNotification, type Recorded } from "./capture";
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
/** A notification as `recordNotification` hands it over. */
const note = (over: Partial<Recorded> = {}): Recorded => ({
  type: "finished",
  kind: "success",
  title: `note ${counter}`,
  description: undefined,
  context: null,
  read: false,
  at: 1_000 + counter++,
  ...over,
});
const add = (over: Partial<Recorded> = {}) => notificationsStore.getState().add(note(over));
const entries = () => notificationsStore.getState().entries;
const plane = { projectId: "p1", workspaceId: "w1", nodeId: null, projectName: "Alpha", workspaceName: "Main" };

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

describe("what a notification is about", () => {
  it("is the workspace on screen, with its project, when it names nothing", () => {
    add({ type: "board", title: "Board done: all 3 cards finished" });
    expect(entries()[0]).toMatchObject({
      type: "board",
      kind: "success",
      title: "Board done: all 3 cards finished",
      read: false,
      plane: { projectId: "p1", workspaceId: "w1", nodeId: null, projectName: "Alpha", workspaceName: "Main" },
    });
  });

  it("is the node's workspace when it names a node, even with another canvas on screen", () => {
    nodesStore.setState({ nodes: { alan: { workspaceId: "w2", kind: "terminal", payload: { name: "Alan" } } } as never });
    add({ title: "Alan · Done", context: { nodeId: "alan" } });
    expect(entries()[0].plane).toEqual({ projectId: "p1", workspaceId: "w2", nodeId: "alan", projectName: "Alpha", workspaceName: "Second" });
  });

  it("is the workspace it names, when it names no node", () => {
    add({ title: "x", context: { workspaceId: "w2" } });
    expect(entries()[0].plane).toMatchObject({ workspaceId: "w2", nodeId: null, workspaceName: "Second" });
  });

  it("keeps the plane of a node in a project that is no longer open, from the workspaces seen this run", () => {
    connectNotifications();
    showProject();
    nodesStore.setState({ nodes: { old: { workspaceId: "w1", kind: "terminal", payload: { name: "Old" } } } as never });
    // Another project is opened: its list replaces the first one's.
    projectsStore.setState({ activeId: "p2" });
    workspacesStore.setState({ projectId: "p2", activeId: "x1", workspaces: [workspace("x1", "p2", "Other")] });
    add({ title: "Old · Done", context: { nodeId: "old" } });
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

describe("the list", () => {
  it("lists the newest first, each with its type, its tone and the read mark it came with", () => {
    add({ type: "question", kind: "info", title: "one" });
    add({ type: "finished", kind: "error", title: "two", read: true });
    add({ type: "board", kind: "success", title: "three" });
    expect(entries().map((e) => [e.title, e.type, e.kind, e.read])).toEqual([
      ["three", "board", "success", false],
      ["two", "finished", "error", true],
      ["one", "question", "info", false],
    ]);
  });

  it("keeps the last 200, dropping the oldest", () => {
    for (let i = 0; i < MAX_NOTIFICATIONS + 5; i++) add({ title: `n${i}` });
    expect(entries()).toHaveLength(MAX_NOTIFICATIONS);
    expect(entries()[0].title).toBe(`n${MAX_NOTIFICATIONS + 4}`);
    expect(entries()[entries().length - 1].title).toBe("n5");
  });

  it("keeps two notifications with the same words apart: each is news of its own", () => {
    add({ title: "Batman · Done" });
    add({ title: "Batman · Done" });
    expect(entries()).toHaveLength(2);
  });
});

describe("unread", () => {
  it("counts those not read yet, and a click reads one", () => {
    add({ title: "a" });
    add({ title: "b" });
    add({ title: "c" });
    expect(unreadCount(entries())).toBe(3);
    notificationsStore.getState().markRead(entries()[1].id);
    expect(unreadCount(entries())).toBe(2);
    expect(entries().find((e) => e.title === "b")?.read).toBe(true);
  });

  it("reads an agent's questions once it no longer waits, and nothing else", () => {
    nodesStore.setState({ nodes: { batman: { workspaceId: "w1", kind: "terminal", payload: { name: "Batman" } }, robin: { workspaceId: "w1", kind: "terminal", payload: { name: "Robin" } } } as never });
    add({ type: "question", kind: "info", title: "Batman · Waiting", context: { nodeId: "batman" } });
    add({ type: "question", kind: "info", title: "Robin · Waiting", context: { nodeId: "robin" } });
    add({ type: "finished", title: "Batman · Done", context: { nodeId: "batman" } });
    notificationsStore.getState().markQuestionsRead("batman");
    expect(entries().map((e) => [e.title, e.read])).toEqual([
      ["Batman · Done", false],
      ["Robin · Waiting", false],
      ["Batman · Waiting", true],
    ]);
    const before = entries();
    notificationsStore.getState().markQuestionsRead("batman");
    expect(entries()).toBe(before);
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
  const row = (i: number, extra: Record<string, unknown> = {}) => ({ id: `id${i}`, at: i, type: "finished", kind: "success", title: `t${i}`, read: i % 2 === 0, plane, ...extra });

  it("reads back the entries it can, newest first, at most 200, and drops the rest", () => {
    const rows = [...Array.from({ length: 250 }, (_, i) => row(i)), null, 3, { id: "x" }, row(999, { kind: "bogus" }), row(998, { title: "" }), row(997, { type: "error" }), row(5)];
    const read = readNotifications(rows);
    expect(read).toHaveLength(MAX_NOTIFICATIONS);
    expect(read[0].id).toBe("id249");
    expect(readNotifications("nope")).toEqual([]);
    expect(readNotifications(null)).toEqual([]);
  });

  it("drops the popups of the old history, saved with no type: the panel keeps three kinds of news now", () => {
    const old = { id: "old", at: 9, kind: "error", title: "Could not push", description: "rejected", action: "Retry", read: false, plane };
    expect(readNotifications([old, row(1)]).map((e) => e.id)).toEqual(["id1"]);
  });

  it("reads a row saved twice as one", () => {
    expect(readNotifications([row(1), { ...row(1) }])).toHaveLength(1);
  });

  it("reads an entry with its type, its tone, its plane, its read mark and its description", () => {
    const [entry] = readNotifications([
      { id: "a", at: 5, type: "question", kind: "info", title: "Batman · Waiting", description: "Has a question for you", read: true, plane: { ...plane, nodeId: "batman" } },
    ]);
    expect(entry).toEqual({
      id: "a",
      at: 5,
      type: "question",
      kind: "info",
      title: "Batman · Waiting",
      description: "Has a question for you",
      read: true,
      plane: { ...plane, nodeId: "batman" },
    });
  });

  it("writes the list a second after the last change, as one write", async () => {
    vi.useFakeTimers();
    await loadNotifications();
    await vi.advanceTimersByTimeAsync(1100);
    writes.length = 0;
    add({ title: "a" });
    add({ title: "b" });
    add({ title: "c" });
    await vi.advanceTimersByTimeAsync(900);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].key).toBe(NOTIFICATIONS_KEY);
    expect((writes[0].value as Record<string, unknown>[]).map((e) => [e.title, e.type])).toEqual([
      ["c", "finished"],
      ["b", "finished"],
      ["a", "finished"],
    ]);
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

  it("loads the saved list at boot, newest first", async () => {
    stored.set(NOTIFICATIONS_KEY, [row(10, { title: "older", read: true }), row(20, { title: "newer", type: "question", kind: "info", read: false })]);
    await loadNotifications();
    expect(entries().map((e) => e.title)).toEqual(["newer", "older"]);
    expect(entries()[0]).toMatchObject({ type: "question", read: false, plane: { workspaceId: "w1", workspaceName: "Main" } });
    expect(notificationsStore.getState().loaded).toBe(true);
  });

  it("writes over the old popup history at the first save, once: what it could read stays", async () => {
    vi.useFakeTimers();
    const oldPopup = { id: "old", at: 9, kind: "warning", title: "Past Max agents", read: false, plane };
    stored.set(NOTIFICATIONS_KEY, [oldPopup, row(1, { title: "kept" })]);
    await loadNotifications();
    expect(entries().map((e) => e.title)).toEqual(["kept"]);
    await vi.advanceTimersByTimeAsync(1100);
    expect((writes[writes.length - 1].value as { id: string }[]).map((e) => e.id)).toEqual(["id1"]);
  });

  it("puts what was recorded during boot above the saved list, and writes both", async () => {
    vi.useFakeTimers();
    stored.set(NOTIFICATIONS_KEY, [row(10, { title: "from last run", read: true })]);
    connectNotifications();
    // A question asked before the list was read.
    recordNotification({ type: "question", kind: "info", title: "Batman · Waiting" });
    expect(entries().map((e) => e.title)).toEqual(["Batman · Waiting"]);
    await loadNotifications();
    expect(entries().map((e) => e.title)).toEqual(["Batman · Waiting", "from last run"]);
    await vi.advanceTimersByTimeAsync(1100);
    expect((writes[writes.length - 1].value as { title: string }[]).map((e) => e.title)).toEqual(["Batman · Waiting", "from last run"]);
  });

  it("writes nothing before the saved list was read: it is the only copy", async () => {
    vi.useFakeTimers();
    connectNotifications();
    add({ title: "too early" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toEqual([]);
  });

  it("leaves a list it could not read on disk: nothing is written this run, and no popup says so", async () => {
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
