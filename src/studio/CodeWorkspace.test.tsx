// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { openUrl } from "@tauri-apps/plugin-opener";
import { undoDepth } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { insertFileNode } from "./insert";
import { projectsStore, type Project } from "@/store/projects";
import { CodeWorkspace } from "./CodeWorkspace";
import { editFile, studioStore } from "./studioStore";

vi.mock("./insert", () => ({ insertFileNode: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let calls: { cmd: string; args: Record<string, unknown> }[];
/** What the tree reads: three entries, unless a test wants more. */
let entries: { path: string; kind: "file" | "dir" }[];
/** What a file reads. */
let fileText: string;
/** What the disk answers to a comparison. */
let disk: string | null;
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  calls = [];
  disk = "v1";
  entries = [
    { path: "docs", kind: "dir" },
    { path: "docs/guide.md", kind: "file" },
    { path: "main.ts", kind: "file" },
  ];
  fileText = "# Guide\n<script>alert(1)</script>\n";
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: args as Record<string, unknown> });
    if (cmd === "studio_tree") return entries;
    if (cmd === "studio_read") return { text: fileText, version: "v1" };
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
  // One name, its state pressed or not (P2-15).
  const toggle = () => modal().querySelector('nav [aria-label="Files"]')!;
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  await click(toggle());
  expect(modal().querySelector("[data-files]")).toBeNull();
  expect(toggle().getAttribute("aria-pressed")).toBe("false");
  await click(toggle());
  expect(modal().querySelector("[data-files]")).not.toBeNull();
  await act(async () => root.render(<></>));
  expect(studioStore.getState().project).toBeNull();
});

const opened = async () => {
  await vi.waitFor(() => expect(modal().querySelector('[data-path="main.ts"]')).not.toBeNull());
  await click(modal().querySelector('[data-path="main.ts"]'));
  await vi.waitFor(() => expect(studioStore.getState().tabs[0]?.session.getState().version).toBe("v1"));
};

it("names its controls, its documents and its rows in the shared hint, never a native title (P2-20)", async () => {
  await opened();
  await vi.waitFor(() => expect(modal().querySelector("[data-editor]")).not.toBeNull());
  await act(async () => editFile("main.ts", "changed"));
  expect(modal().querySelectorAll("button[title], [data-dirty][title]")).toHaveLength(0);
  // A document of the strip: a button, the one shown aria-current; its unsaved dot is read as words.
  const doc = modal().querySelector<HTMLElement>('[data-tab="main.ts"] button')!;
  expect(doc.getAttribute("role")).toBeNull();
  expect(doc.getAttribute("aria-current")).toBe("page");
  expect(doc.textContent).toContain("Modified, not saved");
  expect(modal().querySelector("[data-dirty]")!.getAttribute("aria-hidden")).toBe("true");
  expect(modal().querySelector('[role="tab"], [role="tablist"]')).toBeNull();
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
  expect(bar.previousElementSibling!.hasAttribute("data-doc-strip")).toBe(true);
});

const items = () => [...modal().querySelectorAll<HTMLElement>('[role="treeitem"]')];
const press = (target: Element, key: string) =>
  act(async () => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  });

it("walks the tree from the keyboard: one tab stop, the arrows, Home and End, each row placed (P2-15)", async () => {
  await vi.waitFor(() => expect(items()).toHaveLength(2));
  const tree = modal().querySelector('[role="tree"]')!;
  expect(tree.getAttribute("aria-label")).toBe("Files");
  expect(items().map((i) => i.tabIndex)).toEqual([0, -1]);
  expect(items().map((i) => `${i.getAttribute("aria-level")}:${i.getAttribute("aria-posinset")}/${i.getAttribute("aria-setsize")}`)).toEqual(["1:1/2", "1:2/2"]);

  items()[0].focus();
  // Right opens the folder, then goes in.
  await press(items()[0], "ArrowRight");
  expect(items().map((i) => i.dataset.path)).toEqual(["docs", "docs/guide.md", "main.ts"]);
  expect(items()[0].getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(items()[0]);
  await press(items()[0], "ArrowRight");
  expect(document.activeElement).toBe(items()[1]);
  expect(items()[1].getAttribute("aria-level")).toBe("2");
  expect(items().map((i) => i.tabIndex)).toEqual([-1, 0, -1]);
  // Left goes to the parent, then closes it.
  await press(items()[1], "ArrowLeft");
  expect(document.activeElement).toBe(items()[0]);
  await press(items()[0], "ArrowLeft");
  expect(items()).toHaveLength(2);
  expect(items()[0].getAttribute("aria-expanded")).toBe("false");
  const end = await press(items()[0], "End");
  expect(end.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(items()[1]);
  await press(items()[1], "ArrowDown");
  expect(document.activeElement).toBe(items()[1]);
  await press(items()[1], "Home");
  expect(document.activeElement).toBe(items()[0]);
  // Enter is the row's own click: a file opens.
  await click(items()[1]);
  await vi.waitFor(() => expect(studioStore.getState().active).toBe("main.ts"));
});

it("says when the tree stops at its 2000 rows (P2-52)", async () => {
  await act(async () => root.unmount());
  entries = Array.from({ length: 2001 }, (_, i) => ({ path: `f${String(i).padStart(4, "0")}.ts`, kind: "file" as const }));
  root = createRoot(host);
  await act(async () => root.render(<CodeWorkspace />));
  await vi.waitFor(() => expect(items()).toHaveLength(2000));
  expect(modal().querySelector("[data-files]")!.textContent).toContain("Only the first 2000 rows are shown: filter to narrow down");
});

it("keeps the editor and its undo history through a look at the preview (P2-49)", async () => {
  await vi.waitFor(() => expect(modal().querySelector('[data-path="docs"]')).not.toBeNull());
  await click(modal().querySelector('[data-path="docs"]'));
  await click(modal().querySelector('[data-path="docs/guide.md"]'));
  await vi.waitFor(() => expect(modal().querySelector('[data-editor="docs/guide.md"]')).not.toBeNull());
  const editor = modal().querySelector('[data-editor="docs/guide.md"]');
  const view = EditorView.findFromDOM(modal().querySelector<HTMLElement>(".cm-editor")!)!;
  await act(async () => view.dispatch({ changes: { from: view.state.doc.length, insert: "typed" } }));
  await click([...modal().querySelectorAll("button")].find((b) => b.textContent === "Preview")!);
  expect(modal().querySelector("[data-preview]")).not.toBeNull();
  // Hidden under the preview, not destroyed.
  expect(modal().querySelector('[data-editor="docs/guide.md"]')).toBe(editor);
  expect(editor!.parentElement!.className.split(/\s+/)).toContain("hidden");
  await click([...modal().querySelectorAll("button")].find((b) => b.textContent === "Code")!);
  expect(modal().querySelector('[data-editor="docs/guide.md"]')).toBe(editor);
  expect(EditorView.findFromDOM(modal().querySelector<HTMLElement>(".cm-editor")!)).toBe(view);
  expect(undoDepth(view.state)).toBe(1);
});

it("opens the preview's links: the web through the system, a relative path in the studio (P2-51)", async () => {
  fileText = "[site](https://x.dev) [main](../main.ts#top) [here](#top)\n";
  await vi.waitFor(() => expect(modal().querySelector('[data-path="docs"]')).not.toBeNull());
  await click(modal().querySelector('[data-path="docs"]'));
  await click(modal().querySelector('[data-path="docs/guide.md"]'));
  await vi.waitFor(() => expect(studioStore.getState().tabs[0]?.session.getState().version).toBe("v1"));
  await click([...modal().querySelectorAll("button")].find((b) => b.textContent === "Preview")!);
  const link = (text: string) => [...modal().querySelectorAll<HTMLElement>("[data-preview] a")].find((a) => a.textContent === text);
  const web = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => void link("site")!.dispatchEvent(web));
  expect(web.defaultPrevented).toBe(true);
  expect(openUrl).toHaveBeenCalledWith("https://x.dev");
  // A bare anchor goes nowhere here: it stays text.
  expect(link("here")).toBeUndefined();
  await click(link("main")!);
  await vi.waitFor(() => expect(studioStore.getState().active).toBe("main.ts"));
});

it("shows a row's path in the app's hint when its long name is cut, and spares a short one the hint (P2-20, P2-59)", async () => {
  await act(async () => root.unmount());
  entries = [
    { path: "a-very-long-file-name-that-the-panel-cannot-hold.ts", kind: "file" },
    { path: "main.ts", kind: "file" },
    // Wide glyphs: 18 characters, but a full em each.
    { path: "設計書と仕様書の最新版ドラフト.md", kind: "file" },
  ];
  root = createRoot(host);
  await act(async () => root.render(<CodeWorkspace />));
  await vi.waitFor(() => expect(items()).toHaveLength(3));
  const long = items().find((i) => i.dataset.path?.startsWith("a-very"))!;
  const short = items().find((i) => i.dataset.path === "main.ts")!;
  const wide = items().find((i) => i.dataset.path?.endsWith(".md"))!;
  expect(short.getAttribute("data-slot")).toBeNull();
  expect(long.getAttribute("data-slot")).toBe("tooltip-trigger");
  expect(wide.getAttribute("data-slot")).toBe("tooltip-trigger");
  const name = long.querySelector(".truncate")!;
  Object.defineProperty(name, "scrollWidth", { configurable: true, value: 400 });
  Object.defineProperty(name, "clientWidth", { configurable: true, value: 180 });
  await act(async () => long.focus());
  expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain("a-very-long-file-name-that-the-panel-cannot-hold.ts");
});
