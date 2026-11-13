// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arrive } from "@/canvas/arrive";
import { completeArrival } from "@/commands/pendingArrival";
import type { Project, Workspace } from "@/ipc/db";
import { getByRole } from "@/lib/a11y";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import type { ToastKind } from "./capture";
import { NotificationsButton } from "./NotificationPanel";
import { notificationsStore, type NotificationEntry } from "./store";

vi.mock("@/canvas/arrive", () => ({ arrive: vi.fn(() => true) }));
vi.mock("@/canvas/canvasFocus", () => ({ focusGroup: vi.fn(() => true) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = (id: string, name: string): Project => ({ id, name, path: `C:/${name}`, position: 0, lastOpenedAt: 0, workspaceCount: 1, missing: false, liveAgents: 0 });
const workspace = (id: string, projectId: string, name: string): Workspace => ({ id, projectId, name, position: 0, pantheon: null, kind: "canvas", folder: null });

const select = vi.fn();
let host: HTMLDivElement;
let root: Root;

/** A notification; its type follows its tone unless given: info a question, plain a board, the others a finish. */
function note(id: string, kind: ToastKind, title: string, workspaceId: string | null, over: Partial<NotificationEntry> = {}): NotificationEntry {
  return {
    id,
    at: Date.now() - 60_000,
    type: kind === "info" ? "question" : kind === "plain" ? "board" : "finished",
    kind,
    title,
    read: false,
    plane: { projectId: workspaceId ? "p1" : null, workspaceId, nodeId: null, projectName: workspaceId ? "Alpha" : null, workspaceName: null },
    ...over,
  };
}

/** The history, newest first. */
const seed = (...entries: NotificationEntry[]) => notificationsStore.setState({ entries });

beforeEach(async () => {
  vi.mocked(arrive).mockClear();
  select.mockClear();
  projectsStore.setState({ view: "project", activeId: "p1", projects: [project("p1", "Alpha")] });
  workspacesStore.setState({ projectId: "p1", activeId: "w1", workspaces: [workspace("w1", "p1", "Main"), workspace("w2", "p1", "Second")], select } as never);
  nodesStore.setState({ nodes: { alan: { workspaceId: "w2", kind: "terminal", payload: { name: "Alan" } } } } as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const render = () => act(async () => root.render(<NotificationsButton />));
const content = () => document.body.querySelector<HTMLElement>('[data-slot="popover-content"]');
const rows = () => [...document.body.querySelectorAll<HTMLButtonElement>("[data-row]")];
const rowTitles = () => rows().map((r) => r.textContent ?? "");
const bell = () => host.querySelector<HTMLButtonElement>("button")!;
const press = (element: Element, key: string) => act(async () => void element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const open = async () => {
  await render();
  await act(async () => bell().click());
};
const button = (name: string) => getByRole(document.body, "button", name) as HTMLButtonElement;

describe("the bell", () => {
  it("says it is notifications, with no pip when nothing is unread", async () => {
    seed(note("a", "info", "Read", "w1", { read: true }));
    await render();
    expect(bell().getAttribute("aria-label")).toBe("Notifications");
    expect(bell().querySelector("[data-pip]")).toBeNull();
  });

  it("counts the unread ones in a pip and in its name, which starts with the same words", async () => {
    seed(note("a", "info", "One", "w1"), note("b", "error", "Two", "w1"), note("c", "info", "Read", "w1", { read: true }));
    await render();
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 2 unread");
    expect(bell().querySelector("[data-pip]")?.textContent).toBe("2");
  });

  it("caps the pip at 99+", async () => {
    seed(...Array.from({ length: 120 }, (_, i) => note(`n${i}`, "info", `n${i}`, "w1")));
    await render();
    expect(bell().querySelector("[data-pip]")?.textContent).toBe("99+");
  });

  it("opens the panel, and a second press closes it", async () => {
    seed(note("a", "info", "One", "w1"));
    await open();
    expect(content()).not.toBeNull();
    expect(bell().getAttribute("aria-expanded")).toBe("true");
    await act(async () => bell().click());
    expect(content()).toBeNull();
  });
});

describe("the panel", () => {
  it("lists every notification, newest first, with its text, its type, its time and its plane", async () => {
    seed(
      note("c", "error", "Batman · Failed", "w2", { description: "Tests red", at: Date.now() - 5 * 60_000 }),
      note("b", "success", "Board done: all 3 cards finished", "w1", { type: "board", at: Date.now() - 60 * 60_000 }),
      note("a", "info", "Robin · Waiting", null, { read: true, at: Date.now() - 3 * 24 * 3_600_000 }),
    );
    await open();
    expect(rows().map((r) => r.querySelector("span.min-w-0 span.min-w-0")?.textContent?.replace(/^Unread\. /, ""))).toEqual([
      "Batman · Failed",
      "Board done: all 3 cards finished",
      "Robin · Waiting",
    ]);
    // The row says its type: what it tells, not the popup's tone.
    expect(rows().map((r) => r.querySelector("[data-type]")?.textContent)).toEqual(["Finished", "Board", "Question"]);
    const first = rows()[0].textContent ?? "";
    expect(first).not.toContain("Error:");
    expect(first).toContain("Tests red");
    expect(first).toContain("5 min ago");
    // The plane: the project and the workspace, by their current names.
    expect(first).toContain("Alpha › Second");
    expect(rows()[1].textContent).toContain("Alpha › Main");
    expect(rows()[1].textContent).toContain("1 h ago");
    expect(rows()[2].textContent).toContain("No project open");
    expect(rows()[2].textContent).toContain("3 d ago");
  });

  it("shows a renamed workspace by its new name, and a closed one as (closed)", async () => {
    seed(note("a", "info", "About w2", "w2", { plane: { projectId: "p1", workspaceId: "w2", nodeId: null, projectName: "Alpha", workspaceName: "Old name" } }), note("b", "info", "About a closed one", "w7"));
    await open();
    expect(rows()[0].textContent).toContain("Alpha › Second");
    expect(rows()[1].textContent).toContain("Alpha › (closed)");
  });

  it("marks what is unread: by its dot and, for a screen reader, its words", async () => {
    seed(note("a", "info", "New", "w1"), note("b", "info", "Old", "w1", { read: true }));
    await open();
    expect(rows()[0].querySelector("[data-unread-dot]")).not.toBeNull();
    expect(rows()[0].textContent).toContain("Unread.");
    expect(rows()[1].querySelector("[data-unread-dot]")).toBeNull();
  });

  it("says when there is nothing to list", async () => {
    seed();
    await open();
    expect(content()?.textContent).toContain("Nothing yet. An agent that finishes or asks you something, and a board whose cards are all done, are kept here.");
    expect(button("Mark all read").disabled).toBe(true);
    expect(button("Clear").disabled).toBe(true);
  });

  it("has an accessible name on the panel, the filters, the list and every button", async () => {
    seed(note("a", "info", "One", "w1"));
    await open();
    expect(content()?.getAttribute("aria-label")).toBe("Notifications");
    expect(content()?.querySelector('[aria-label="Show"]')).not.toBeNull();
    expect(content()?.querySelector('[aria-label="Notifications, newest first"]')).not.toBeNull();
    for (const name of ["Mark all read", "Clear", "Close notifications"]) expect(button(name)).toBeDefined();
  });
});

describe("the filters", () => {
  const history = () =>
    seed(
      note("e", "plain", "Board in w2", "w2"),
      note("d", "error", "Failed in w1", "w1"),
      note("c", "info", "Question in w2", "w2"),
      note("b", "warning", "Blocked in w2", "w2"),
      note("a", "success", "Done in w1", "w1"),
    );
  const filter = (id: string) => document.body.querySelector<HTMLElement>(`[data-filter="${id}"]`)!;
  const filters = () => [...document.body.querySelectorAll<HTMLElement>("[data-filter]")];

  it("are All, This workspace, Questions, Finished and Boards, each with its count, and no Errors", async () => {
    history();
    await open();
    expect(rows()).toHaveLength(5);
    expect(filters().map((f) => f.textContent)).toEqual(["All5", "This workspace2", "Questions1", "Finished3", "Boards1"]);
    expect(document.body.querySelector('[data-filter="errors"]')).toBeNull();
  });

  it("This workspace keeps what is about the workspace on screen", async () => {
    history();
    await open();
    await act(async () => filter("workspace").click());
    expect(rowTitles().map((t) => /(Failed|Done) in w1/.exec(t)?.[0])).toEqual(["Failed in w1", "Done in w1"]);
    workspacesStore.setState({ activeId: "w2" });
    await act(async () => undefined);
    expect(rows()).toHaveLength(3);
    expect(rowTitles().join(" ")).toContain("Question in w2");
  });

  it("Questions, Finished and Boards keep their own type, of every workspace", async () => {
    history();
    await open();
    await act(async () => filter("question").click());
    expect(rowTitles().map((t) => /Question in w2/.exec(t)?.[0])).toEqual(["Question in w2"]);
    await act(async () => filter("finished").click());
    expect(rows()).toHaveLength(3);
    expect(rows().every((r) => r.querySelector("[data-type]")?.textContent === "Finished")).toBe(true);
    await act(async () => filter("board").click());
    expect(rowTitles().map((t) => /Board in w2/.exec(t)?.[0])).toEqual(["Board in w2"]);
  });

  it("says so when a filter keeps nothing, and keeps one filter on", async () => {
    seed(note("a", "info", "Only a question", "w1"));
    await open();
    await act(async () => filter("board").click());
    expect(rows()).toHaveLength(0);
    expect(content()?.textContent).toContain("Nothing here.");
    // Pressing the filter in force again keeps it on.
    await act(async () => filter("board").click());
    expect(filter("board").getAttribute("data-state")).toBe("on");
  });
});

describe("the actions", () => {
  it("Mark all read reads them, clears the pip and keeps the list", async () => {
    seed(note("a", "info", "One", "w1"), note("b", "info", "Two", "w1"));
    await open();
    await act(async () => button("Mark all read").click());
    expect(notificationsStore.getState().entries.every((e) => e.read)).toBe(true);
    expect(rows()).toHaveLength(2);
    expect(bell().getAttribute("aria-label")).toBe("Notifications");
    expect(button("Mark all read").disabled).toBe(true);
  });

  it("Clear empties the list, and the keyboard stays in the panel", async () => {
    seed(note("a", "info", "One", "w1"));
    await open();
    await act(async () => button("Clear").click());
    expect(notificationsStore.getState().entries).toEqual([]);
    expect(content()?.textContent).toContain("Nothing yet. An agent that finishes or asks you something, and a board whose cards are all done, are kept here.");
    expect(document.activeElement).toBe(button("Close notifications"));
  });

  it("Close closes it", async () => {
    seed(note("a", "info", "One", "w1"));
    await open();
    await act(async () => button("Close notifications").click());
    expect(content()).toBeNull();
  });
});

describe("a click on a notification", () => {
  it("goes to its workspace, centres on its node, reads it and closes the panel", async () => {
    seed(note("a", "info", "Alan finished", "w2", { plane: { projectId: "p1", workspaceId: "w2", nodeId: "alan", projectName: "Alpha", workspaceName: "Second" } }));
    await open();
    await act(async () => rows()[0].click());
    expect(select).toHaveBeenCalledWith("w2");
    completeArrival("w2");
    expect(arrive).toHaveBeenCalledWith("alan");
    expect(notificationsStore.getState().entries[0].read).toBe(true);
    expect(content()).toBeNull();
  });

  it("centres at once on a node of the workspace on screen", async () => {
    nodesStore.setState({ nodes: { mine: { workspaceId: "w1", kind: "terminal", payload: { name: "Mine" } } } } as never);
    seed(note("a", "info", "Mine finished", "w1", { plane: { projectId: "p1", workspaceId: "w1", nodeId: "mine", projectName: "Alpha", workspaceName: "Main" } }));
    await open();
    await act(async () => rows()[0].click());
    expect(arrive).toHaveBeenCalledWith("mine");
    expect(select).not.toHaveBeenCalled();
  });
});

describe("the keyboard", () => {
  const three = () => seed(note("c", "info", "Third", "w1"), note("b", "info", "Second", "w1"), note("a", "info", "First", "w1"));

  it("starts on the first notification when the panel opens", async () => {
    three();
    await open();
    expect(document.activeElement).toBe(rows()[0]);
  });

  it("moves through the notifications with the arrows, Home and End, with one row in the tab order", async () => {
    three();
    await open();
    await press(rows()[0], "ArrowDown");
    expect(document.activeElement).toBe(rows()[1]);
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    await press(rows()[1], "ArrowDown");
    expect(document.activeElement).toBe(rows()[2]);
    // The ends stop: no wrap, no escape from the list.
    await press(rows()[2], "ArrowDown");
    expect(document.activeElement).toBe(rows()[2]);
    await press(rows()[2], "ArrowUp");
    expect(document.activeElement).toBe(rows()[1]);
    await press(rows()[1], "Home");
    expect(document.activeElement).toBe(rows()[0]);
    await press(rows()[0], "End");
    expect(document.activeElement).toBe(rows()[2]);
  });

  it("has a native button per notification, which Enter and Space press", async () => {
    three();
    await open();
    expect(rows().every((r) => r.tagName === "BUTTON")).toBe(true);
  });

  it("closes on Escape", async () => {
    three();
    await open();
    await press(rows()[0], "Escape");
    expect(content()).toBeNull();
  });
});
