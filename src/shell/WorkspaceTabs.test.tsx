// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore } from "@/store/nodes";
import { projectsStore, type Project } from "@/store/projects";
import { terminalStatusStore } from "@/store/terminalStatus";
import { requestUi } from "@/commands/uiRequests";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { Workspace } from "@/ipc/db";
import { getByRole, queryAllByRole } from "@/lib/a11y";
import { workspacesStore } from "@/store/workspaces";
import { TABS_HEIGHT } from "./layout";
import { WorkspaceTabs } from "./WorkspaceTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let calls: string[];
/** What the folder picker answers next; null is a cancelled picker. */
let picked: string | null;
/** What the backend was told about the folders of workspaces. */
let folderWrites: { id: string; folder: string | null }[];
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  calls = [];
  picked = null;
  folderWrites = [];
  projectsStore.setState({ projects: [{ id: "p1", name: "api", path: "D:/code/api", lastOpenedAt: 0, missing: false } as Project], activeId: "p1" });
  // The confirmation is answered "no": nothing is deleted.
  mockIPC((cmd, args) => {
    calls.push(cmd);
    if (cmd === "set_workspace_folder") folderWrites.push(args as { id: string; folder: string | null });
    if (cmd === "plugin:dialog|open") return picked;
    return cmd.startsWith("plugin:dialog|") ? false : undefined;
  });
  workspacesStore.setState({
    workspaces: [
      { id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, folder: null },
      { id: "w2", projectId: "p1", name: "Backend", position: 1, pantheon: null, folder: null },
    ],
    activeId: "w2",
  } as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <WorkspaceTabs />
        <ConfirmDialog />
      </>,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

const row = () => host.firstElementChild as HTMLElement;
const tabs = () => [...row().querySelectorAll<HTMLElement>("[data-tab]")];

it("shows the workspaces as browser tabs, then +, then empty space that moves the window (spec identité §5.2)", () => {
  expect(row().style.height).toBe(`${TABS_HEIGHT}px`);
  expect(tabs().map((t) => t.dataset.tab)).toEqual(["w1", "w2"]);
  expect(tabs()[1].dataset.active).toBe("true");
  expect(tabs()[1].className).toContain("bg-dp-tab-on");
  expect(row().querySelector('[aria-label="New workspace"]')).not.toBeNull();
  // The scrolling row itself never drags: a press on it would move the window instead of scrolling.
  expect(row().hasAttribute("data-tauri-drag-region")).toBe(false);
  const spacer = row().lastElementChild as HTMLElement;
  expect(spacer.getAttribute("data-tauri-drag-region")).toBe("");
  expect(spacer.querySelector("button")).toBeNull();
});

it("tells which workspace is on screen: the row is a navigation, the active tab its current page", async () => {
  const nav = getByRole(host, "navigation", "Workspaces");
  expect(nav).toBe(row());
  expect(getByRole(nav, "button", "Backend").getAttribute("aria-current")).toBe("page");
  expect(getByRole(nav, "button", "Workspace 1").hasAttribute("aria-current")).toBe(false);
  expect(queryAllByRole(nav, "button").filter((b) => b.getAttribute("aria-current") === "page")).toHaveLength(1);
  await act(async () => getByRole(nav, "button", "Workspace 1").click());
  expect(getByRole(nav, "button", "Workspace 1").getAttribute("aria-current")).toBe("page");
  expect(getByRole(nav, "button", "Backend").hasAttribute("aria-current")).toBe(false);
});

it("names a tab's agent count and folder in words, never a bare digit", async () => {
  await act(async () => {
    await nodesStore.getState().create("t1", {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: "Ada", name: "Ada", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
    });
    terminalStatusStore.getState().set("t1", { state: "running" });
    workspacesStore.setState({
      workspaces: workspacesStore.getState().workspaces.map((w) => (w.id === "w1" ? { ...w, folder: "D:/work/lib" } : w)),
    });
  });
  const tab = getByRole(host, "button", "Workspace 1, in lib, 1 active agent");
  expect(tab.querySelector("[data-badge]")!.textContent).toBe("1");
  // The active tab shows 0 with nothing running: no count to name.
  expect(getByRole(host, "button", "Backend").querySelector("[data-badge]")!.textContent).toBe("0");
});

it("scrolls the tabs sideways with the wheel, without a scrollbar eating their height", async () => {
  expect(row().className).toContain("[scrollbar-width:none]");
  expect(row().className).toContain("overflow-y-hidden");
  await act(async () => row().dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true })));
  expect(row().scrollLeft).toBe(120);
});

it("selects a tab from anywhere on it, its badge included", async () => {
  // An agent running in Workspace 1 gives its tab a badge.
  await act(async () => {
    await nodesStore.getState().create("t1", {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: "Ada", name: "Ada", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
    });
    terminalStatusStore.getState().set("t1", { state: "running" });
  });
  const badge = tabs()[0].querySelector<HTMLElement>("[data-badge]")!;
  expect(badge.textContent).toBe("1");
  await act(async () => badge.click());
  expect(workspacesStore.getState().activeId).toBe("w1");
  // The select button spans the whole tab, padding included.
  expect(badge.closest("button")!.className).toContain("self-stretch");
});

it("deletes a workspace from its × after the app's own confirmation, never the last one", async () => {
  const close = tabs()[0].querySelector<HTMLButtonElement>('[aria-label="Delete the workspace"]')!;
  expect(close.className).toContain("group-hover:opacity-100");
  await act(async () => close.click());
  // Asked in the app's dialog, in its look: never the system's message box.
  expect(calls.some((cmd) => cmd.startsWith("plugin:dialog|"))).toBe(false);
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Delete “Workspace 1”?");
  await act(async () => [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!.click());
  expect(workspacesStore.getState().workspaces).toHaveLength(2);
  await act(async () => workspacesStore.setState({ workspaces: workspacesStore.getState().workspaces.slice(0, 1) }));
  expect(host.querySelector('[aria-label="Delete the workspace"]')).toBeNull();
});

it("opens a tab's name editor on request (\"Rename the workspace\")", async () => {
  await act(async () => requestUi({ kind: "renameWorkspace", id: "w2" }));
  const field = row().querySelector("input")!;
  expect(field.value).toBe("Backend");
  expect(document.activeElement).toBe(field);
});

it("moves a tab with Alt+arrows from the keyboard, or by dragging it onto another", async () => {
  workspacesStore.setState({ projectId: "p1" });
  const first = tabs()[0].querySelector("button")!;
  await act(async () => void first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true })));
  expect(tabs().map((t) => t.dataset.tab)).toEqual(["w2", "w1"]);
  // Dragging w2 (now first) onto the tab at the right puts it there.
  await act(async () => {
    tabs()[0].dispatchEvent(new Event("dragstart", { bubbles: true }));
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    tabs()[1].dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    tabs()[1].dispatchEvent(drop);
  });
  expect(tabs().map((t) => t.dataset.tab)).toEqual(["w1", "w2"]);
});

describe("the folder of a workspace", () => {
  const withFolder = (folder: string | null, extra: Partial<Workspace>[] = []) =>
    act(async () =>
      workspacesStore.setState({
        workspaces: [
          { id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder },
          { id: "w2", projectId: "p1", name: "Backend", position: 1, pantheon: null, kind: "canvas", folder: null },
          ...extra.map((w, i) => ({ id: `x${i}`, projectId: "p1", name: `X${i}`, position: 2 + i, pantheon: null, kind: "canvas" as const, folder: null, ...w })),
        ],
        activeId: "w2",
      }),
    );
  const folderTag = (id: string) => host.querySelector(`[data-tab="${id}"] [data-tab-folder]`)?.textContent ?? null;
  const hintOf = async (id: string) => {
    await act(async () => host.querySelector<HTMLElement>(`[data-tab="${id}"] button`)!.focus());
    return document.querySelector('[role="tooltip"]')?.textContent ?? null;
  };
  const openMenu = async (id: string) => {
    await act(async () => void host.querySelector(`[data-tab="${id}"]`)!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  };
  const item = (text: string) => [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((e) => e.textContent === text);

  it("shows after the tab's name the folder it picked, and the full path in its hint; the project's own is only in the hint", async () => {
    await withFolder("D:/work/lib");
    expect(folderTag("w1")).toBe("lib");
    expect(folderTag("w2")).toBeNull();
    expect(await hintOf("w1")).toContain("D:/work/lib");
    await act(async () => host.querySelector<HTMLElement>('[data-tab="w1"] button')!.blur());
    expect(await hintOf("w2")).toContain("D:/code/api");
  });

  it("is picked from the tab's menu, for that tab's workspace even when it is not the active one", async () => {
    await withFolder(null);
    await openMenu("w1");
    expect(item("Folder…")).toBeTruthy();
    picked = "D:/work/picked";
    await act(async () => item("Folder…")!.click());
    expect(folderWrites).toEqual([{ id: "w1", folder: "D:/work/picked" }]);
    expect(folderTag("w1")).toBe("picked");
    expect(workspacesStore.getState().activeId).toBe("w2");
  });

  it("changes nothing when the picker is cancelled", async () => {
    await withFolder(null);
    await openMenu("w1");
    await act(async () => item("Folder…")!.click());
    expect(folderWrites).toEqual([]);
    expect(folderTag("w1")).toBeNull();
  });

  it("goes back to the project's folder from « Use the project folder », which is only offered after a pick", async () => {
    await withFolder(null);
    await openMenu("w1");
    expect(item("Use the project folder")!.hasAttribute("data-disabled")).toBe(true);
    await act(async () => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await withFolder("D:/work/lib");
    await openMenu("w1");
    expect(item("Use the project folder")!.hasAttribute("data-disabled")).toBe(false);
    await act(async () => item("Use the project folder")!.click());
    expect(folderWrites).toEqual([{ id: "w1", folder: null }]);
    expect(folderTag("w1")).toBeNull();
  });

  it("tells that terminals already open stay where they are", async () => {
    await withFolder(null);
    await openMenu("w1");
    expect(document.body.textContent).toContain("terminals already open stay where they are");
  });

  it("is not offered on the code workspace, which stays on the project", async () => {
    await withFolder(null, [{ kind: "code", name: "Code" }]);
    await openMenu("x0");
    expect(item("Rename")).toBeTruthy();
    expect(item("Folder…")).toBeUndefined();
    expect(folderTag("x0")).toBeNull();
  });
});
