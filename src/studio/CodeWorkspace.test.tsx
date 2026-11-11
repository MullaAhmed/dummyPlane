// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { insertFileNode } from "./insert";
import { projectsStore, type Project } from "@/store/projects";
import { CodeWorkspace } from "./CodeWorkspace";
import { editFile, studioStore } from "./studioStore";

vi.mock("./insert", () => ({ insertFileNode: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let calls: { cmd: string; args: Record<string, unknown> }[];
/** What the disk answers to a comparison. */
let disk: string | null;
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  calls = [];
  disk = "v1";
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: args as Record<string, unknown> });
    if (cmd === "studio_tree")
      return [
        { path: "docs", kind: "dir" },
        { path: "docs/guide.md", kind: "file" },
        { path: "main.ts", kind: "file" },
      ];
    if (cmd === "studio_read") return { text: "# Guide\n<script>alert(1)</script>\n", version: "v1" };
    if (cmd === "studio_version") return disk;
    if (cmd === "studio_write") return { status: "saved", version: "v2" };
    return undefined;
  });
  studioStore.setState({ project: null, tabsFor: null, tabs: [], active: null, parked: {}, pendingLine: null, quitting: false });
  const project: Project = {
    id: "p1",
    name: "proj",
    path: "C:/code/proj",
    position: 0,
    lastOpenedAt: 0,
    workspaceCount: 1,
    missing: false,
    liveAgents: 0,
  };
  projectsStore.setState({ projects: [project], activeId: "p1" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<CodeWorkspace />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

const modal = () => document.querySelector<HTMLElement>("[data-code-workspace]")!;
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());

it("browses the tree, edits a file, saves it with Ctrl+S and previews Markdown safely", async () => {
  await vi.waitFor(() => expect(modal().querySelector('[data-path="docs"]')).not.toBeNull());
  expect(modal().querySelector('[data-path="docs/guide.md"]')).toBeNull();
  await click(modal().querySelector('[data-path="docs"]'));
  await click(modal().querySelector('[data-path="docs/guide.md"]'));
  await vi.waitFor(() => expect(modal().querySelector('[data-editor="docs/guide.md"]')).not.toBeNull());
  expect(calls.find((c) => c.cmd === "studio_read")?.args).toMatchObject({ projectId: "p1", path: "docs/guide.md" });

  await act(async () => editFile("docs/guide.md", "# Guide\nedited\n"));
  expect(modal().querySelector('[data-tab="docs/guide.md"] [data-dirty]')).not.toBeNull();
  await act(async () => modal().dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })));
  await vi.waitFor(() => expect(calls.some((c) => c.cmd === "studio_write")).toBe(true));
  expect(calls.find((c) => c.cmd === "studio_write")?.args).toMatchObject({ projectId: "p1", path: "docs/guide.md", content: "# Guide\nedited\n", expected: "v1" });
  await vi.waitFor(() => expect(modal().querySelector("[data-dirty]")).toBeNull());

  await act(async () => editFile("docs/guide.md", "# Guide\n<script>alert(1)</script>\n"));
  await click([...modal().querySelectorAll("button")].find((b) => b.textContent === "Preview")!);
  const preview = modal().querySelector("[data-preview]")!;
  expect(preview.querySelector("h1")?.textContent).toBe("Guide");
  expect(preview.querySelector("script")).toBeNull();

  await click([...modal().querySelectorAll("button")].find((b) => b.textContent === "Insert")!);
  expect(insertFileNode).toHaveBeenCalledWith("docs/guide.md");
});

it("asks before closing a tab with unsaved changes", async () => {
  await vi.waitFor(() => expect(modal().querySelector('[data-path="main.ts"]')).not.toBeNull());
  await click(modal().querySelector('[data-path="main.ts"]'));
  await vi.waitFor(() => expect(studioStore.getState().tabs[0]?.session.getState().version).toBe("v1"));
  await act(async () => editFile("main.ts", "changed"));
  await click(modal().querySelector('[aria-label="Close main.ts"]'));
  expect(modal().querySelector('[role="alert"]')).not.toBeNull();
  expect(studioStore.getState().tabs).toHaveLength(1);
  await click([...modal().querySelectorAll("button")].find((b) => b.textContent === "Close without saving")!);
  expect(studioStore.getState().tabs).toHaveLength(0);
});

it("shows the project's files in a panel the bar folds, and closes the studio when it goes", async () => {
  expect(studioStore.getState().project).toBe("p1");
  await vi.waitFor(() => expect(modal().querySelector("[data-files]")).not.toBeNull());
  await click(modal().querySelector('nav [aria-label="Hide the files"]'));
  expect(modal().querySelector("[data-files]")).toBeNull();
  await click(modal().querySelector('nav [aria-label="Show the files"]'));
  expect(modal().querySelector("[data-files]")).not.toBeNull();
  await act(async () => root.render(<></>));
  expect(studioStore.getState().project).toBeNull();
});

const opened = async () => {
  await vi.waitFor(() => expect(modal().querySelector('[data-path="main.ts"]')).not.toBeNull());
  await click(modal().querySelector('[data-path="main.ts"]'));
  await vi.waitFor(() => expect(studioStore.getState().tabs[0]?.session.getState().version).toBe("v1"));
};

it("names its controls in the shared hint: a native title stays on the truncated names only", async () => {
  await opened();
  await vi.waitFor(() => expect(modal().querySelector("[data-editor]")).not.toBeNull());
  const titled = [...modal().querySelectorAll("button[title]")].filter((b) => !["tab", "treeitem"].includes(b.getAttribute("role") ?? ""));
  expect(titled).toEqual([]);
  expect(modal().querySelector('[role="tab"]')?.getAttribute("title")).toBe("main.ts");
});

it("answers a tab's discard bar like a dialog: Cancel, destructive, then the primary action", async () => {
  await opened();
  await act(async () => editFile("main.ts", "changed"));
  await click(modal().querySelector('[aria-label="Close main.ts"]'));
  const bar = [...modal().querySelectorAll<HTMLElement>('[role="alert"] button')];
  expect(bar.map((b) => b.textContent)).toEqual(["Cancel", "Close without saving", "Save and close"]);
  expect(bar[1].dataset.variant).toBe("destructive");
});

it("warns when a file with unsaved changes moved on the disk, and overwrites only on request", async () => {
  await opened();
  await act(async () => editFile("main.ts", "mine"));
  disk = "agent";
  await act(async () => window.dispatchEvent(new Event("focus")));
  await vi.waitFor(() => expect(modal().querySelector('[role="alert"]')?.textContent).toContain("changed on disk"));
  expect(calls.some((c) => c.cmd === "studio_write")).toBe(false);
  await click([...modal().querySelectorAll("button")].find((b) => b.textContent === "Overwrite with my version")!);
  await vi.waitFor(() => expect(calls.find((c) => c.cmd === "studio_write")?.args).toMatchObject({ content: "mine", expected: "agent" }));
});

it("closes the tab of a file deleted from the disk when asked", async () => {
  await opened();
  await act(async () => editFile("main.ts", "mine"));
  disk = null;
  await act(async () => window.dispatchEvent(new Event("focus")));
  await vi.waitFor(() => expect(modal().querySelector('[role="alert"]')?.textContent).toContain("was deleted from the disk"));
  await click([...modal().querySelectorAll("button")].find((b) => b.textContent === "Close without keeping")!);
  expect(studioStore.getState().tabs).toHaveLength(0);
});

it("leaves Ctrl+S to a dialog over the workspace", async () => {
  await opened();
  await act(async () => editFile("main.ts", "mine"));
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true })));
  dialog.remove();
  expect(calls.some((c) => c.cmd === "studio_write")).toBe(false);
});

it("lays the discard bar over the editor's top edge: the code under the pointer does not move down", async () => {
  await opened();
  await act(async () => editFile("main.ts", "changed"));
  await click(modal().querySelector('[aria-label="Close main.ts"]'));
  const bar = modal().querySelector<HTMLElement>('[role="alert"]')!;
  expect(bar.className.split(/\s+/)).toEqual(expect.arrayContaining(["absolute", "inset-x-0", "top-full", "z-10"]));
  expect(bar.parentElement!.className.split(/\s+/)).toContain("relative");
  // Under the tab strip, outside the editor's flow.
  expect(bar.previousElementSibling!.getAttribute("role")).toBe("tablist");
});
