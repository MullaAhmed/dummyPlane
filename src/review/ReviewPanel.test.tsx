// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { sendToAgents } from "@/agents/broadcast";
import { toast } from "sonner";
import { nodesStore } from "@/store/nodes";
import { ReviewPanel } from "./ReviewPanel";
import { reviewStore } from "./reviewStore";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/agents/broadcast", () => ({ sendToAgents: vi.fn(() => Promise.resolve({ sent: 1, skipped: [], waiting: [], unsuited: [], starting: [] })) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { warning: vi.fn(), error: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DIFF = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n const x = 1;\n-const y = 2;\n+const y = 3;\n";
let cutList = false;
let diffText = DIFF;
let calls: { cmd: string; args: Record<string, unknown> }[];
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  calls = [];
  diffText = DIFF;
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: args as Record<string, unknown> });
    if (cmd === "review_default_base") return "main";
    if (cmd === "review_changes")
      return {
        compared: "abc123",
        truncated: cutList,
        files: [
          { path: "src/a.ts", oldPath: null, status: "modified", added: 1, removed: 1 },
          { path: "notes.md", oldPath: null, status: "untracked", added: 4, removed: 0 },
        ],
      };
    if (cmd === "review_file_diff") return diffText;
    if (cmd === "review_files") return { files: ["README.md", "src/a.ts"], truncated: false };
    if (cmd === "review_read_file") return { text: "# Projet\nBonjour\n", size: 17, truncated: false };
    return undefined;
  });
  vi.mocked(sendToAgents).mockClear();
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code/proj", shell: "default", command: "" },
  });
  reviewStore.setState({ nodeId: null, remarks: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ReviewPanel />));
  await act(async () => reviewStore.getState().open("batman"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label)!;

it("lists what the agent changed since its base, and shows a file's diff", async () => {
  await vi.waitFor(() => expect(text()).toContain("src/a.ts"));
  expect(text()).toContain("Batman");
  expect(text()).toContain("Since main");
  expect(calls.find((c) => c.cmd === "review_changes")?.args).toEqual({ path: "C:/code/proj", base: "main" });
  await vi.waitFor(() => expect(host.querySelectorAll("[data-diff-line]").length).toBe(4));
  expect([...host.querySelectorAll("[data-diff-line]")].map((l) => l.getAttribute("data-diff-line"))).toEqual(["hunk", "ctx", "del", "add"]);
  await act(async () => button("Uncommitted").click());
  await vi.waitFor(() => expect(calls.filter((c) => c.cmd === "review_changes").pop()?.args).toEqual({ path: "C:/code/proj", base: null }));
});

it("says when the list of changes was cut", async () => {
  await vi.waitFor(() => expect(text()).toContain("src/a.ts"));
  expect(text()).not.toContain("List cut");
  cutList = true;
  await act(async () => button("Uncommitted").click());
  await vi.waitFor(() => expect(text()).toContain("List cut: only the first 2 changes are shown"));
});

it("takes remarks on lines and sends them to the agent in one message", async () => {
  await vi.waitFor(() => expect(host.querySelectorAll("[data-diff-line]").length).toBe(4));
  await act(async () => (host.querySelector('[data-diff-line="add"]') as HTMLElement).click());
  const field = host.querySelector<HTMLInputElement>('[aria-label="Remark on this line"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Why 3?");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(reviewStore.getState().remarks).toEqual([{ file: "src/a.ts", line: 2, lineText: "const y = 3;", text: "Why 3?" }]);
  await act(async () => button("Send to Batman").click());
  expect(sendToAgents).toHaveBeenCalledWith(["batman"], expect.stringContaining("- src/a.ts:2 `const y = 3;` — Why 3?"));
  await vi.waitFor(() => expect(reviewStore.getState().remarks).toEqual([]));
});

/** A key pressed on `target`: a native keydown that bubbles and can be cancelled, as the webview sends it. */
function press(target: Element, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

const cells = () => [...host.querySelectorAll<HTMLElement>("[data-diff-cell]")];

it("reaches every line of the diff from the keyboard: one tab stop, moved by the arrows, Home and End, each line named (P1-8)", async () => {
  await vi.waitFor(() => expect(cells()).toHaveLength(3));
  const grid = host.querySelector<HTMLElement>('[role="grid"]')!;
  expect(grid.getAttribute("aria-label")).toBe("Diff of src/a.ts");
  expect(document.getElementById(grid.getAttribute("aria-describedby")!)?.textContent).toContain("Enter adds a remark");
  // A row each, the hunk's included; only the lines that take a remark are stops.
  expect([...grid.children].map((row) => row.getAttribute("role"))).toEqual(["row", "row", "row", "row"]);
  expect(host.querySelector('[data-diff-line="hunk"]')!.getAttribute("role")).toBe("gridcell");
  expect(host.querySelector('[data-diff-line="hunk"]')!.hasAttribute("tabindex")).toBe(false);
  expect(cells().map((c) => c.getAttribute("aria-label"))).toEqual([
    "Unchanged, old line 1, new line 1: const x = 1;",
    "Removed, old line 2: const y = 2;",
    "Added, new line 2: const y = 3;",
  ]);
  expect(cells().map((c) => c.tabIndex)).toEqual([0, -1, -1]);
  // No native title on the lines (P2-20): their name and the keys hint say it, on focus too.
  expect(cells().some((c) => c.hasAttribute("title"))).toBe(false);

  cells()[0].focus();
  const down = await act(async () => press(cells()[0], "ArrowDown"));
  expect(down.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(cells()[1]);
  // The tab stop went with the focus: Tab out and back lands on this line.
  expect(cells().map((c) => c.tabIndex)).toEqual([-1, 0, -1]);
  await act(async () => press(cells()[1], "End"));
  expect(document.activeElement).toBe(cells()[2]);
  await act(async () => press(cells()[2], "ArrowDown"));
  expect(document.activeElement).toBe(cells()[2]);
  await act(async () => press(cells()[2], "Home"));
  expect(document.activeElement).toBe(cells()[0]);
  expect(cells().map((c) => c.tabIndex)).toEqual([0, -1, -1]);
});

it("keeps exactly one tab stop in the diff through a Refresh that drops the line it was on (P1-8)", async () => {
  await vi.waitFor(() => expect(cells()).toHaveLength(3));
  cells()[0].focus();
  await act(async () => press(cells()[0], "End"));
  expect(cells().map((c) => c.tabIndex)).toEqual([-1, -1, 0]);
  // The agent went on: the file now differs by one line only, and the line the stop was on is gone.
  diffText = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const x = 1;\n+const x = 2;\n";
  await act(async () => button("Refresh").click());
  await vi.waitFor(() => expect(cells()).toHaveLength(2));
  expect(cells().map((c) => c.tabIndex)).toEqual([0, -1]);
  // A Refresh that keeps the line keeps the stop on it.
  await act(async () => press(cells()[0], "ArrowDown"));
  const fetched = calls.filter((c) => c.cmd === "review_file_diff").length;
  await act(async () => button("Refresh").click());
  await vi.waitFor(() => expect(calls.filter((c) => c.cmd === "review_file_diff").length).toBeGreaterThan(fetched));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(cells().map((c) => c.tabIndex)).toEqual([-1, 0]);
});

it("adds a remark from the keyboard, then gives the keyboard back to its line, kept or cancelled (P1-8)", async () => {
  await vi.waitFor(() => expect(cells()).toHaveLength(3));
  const added = () => host.querySelector<HTMLElement>('[data-diff-line="add"]')!;
  added().focus();
  await act(async () => press(added(), "Enter"));
  const field = () => host.querySelector<HTMLInputElement>('[aria-label="Remark on this line"]');
  expect(document.activeElement).toBe(field());
  // The field sits in a row of the grid, under its line.
  expect(field()!.closest('[role="gridcell"]')?.parentElement?.getAttribute("role")).toBe("row");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), "Why 3?");
    field()!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => press(field()!, "Enter"));
  expect(reviewStore.getState().remarks).toEqual([{ file: "src/a.ts", line: 2, lineText: "const y = 3;", text: "Why 3?" }]);
  expect(field()).toBeNull();
  expect(document.activeElement).toBe(added());
  expect(added().tabIndex).toBe(0);

  await act(async () => press(added(), "Enter"));
  expect(document.activeElement).toBe(field());
  await act(async () => press(field()!, "Escape"));
  expect(field()).toBeNull();
  expect(document.activeElement).toBe(added());
  // Escape in the field was the field's: the review stays open, and nothing was added.
  expect(reviewStore.getState().nodeId).toBe("batman");
  expect(reviewStore.getState().remarks).toHaveLength(1);
});

it("lifts the selected file's letter and counts to text-2 on the accent's tint (P1-14)", async () => {
  await vi.waitFor(() => expect(text()).toContain("notes.md"));
  const row = (path: string) => [...host.querySelectorAll<HTMLButtonElement>("button[aria-current]")].find((b) => b.textContent?.includes(path))!;
  const inks = (b: HTMLElement) => [...b.querySelectorAll("span")].map((s) => s.className.match(/text-dp-[\w-]+/)?.[0]).filter(Boolean);
  expect(row("src/a.ts").getAttribute("aria-current")).toBe("true");
  expect(inks(row("src/a.ts"))).not.toContain("text-dp-danger");
  expect(inks(row("src/a.ts"))).not.toContain("text-dp-ok");
  // The other rows keep their colours.
  expect(inks(row("notes.md"))).toEqual(expect.arrayContaining(["text-dp-ok", "text-dp-danger"]));
});

it("browses the repository's files, read-only", async () => {
  await act(async () => button("Files").click());
  await vi.waitFor(() => expect(text()).toContain("README.md"));
  await act(async () => button("README.md").click());
  await vi.waitFor(() => expect(text()).toContain("Bonjour"));
  expect(calls.find((c) => c.cmd === "review_read_file")?.args).toEqual({ path: "C:/code/proj", file: "README.md" });
});

it("keeps its remarks when closed and opened again on the same agent (final review maj §5)", async () => {
  await act(async () => reviewStore.getState().add({ file: "src/a.ts", line: 2, text: "Why 3?" }));
  await act(async () => reviewStore.getState().close());
  await act(async () => reviewStore.getState().open("batman"));
  expect(reviewStore.getState().remarks).toHaveLength(1);
  await act(async () => reviewStore.getState().open("cyborg"));
  expect(reviewStore.getState().remarks).toEqual([]);
});

it("closes on Escape, unless another part of the window already used it (final review maj §5)", async () => {
  const menu = document.createElement("div");
  document.body.append(menu);
  menu.addEventListener("keydown", (e) => e.preventDefault());
  await act(async () => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(reviewStore.getState().nodeId).toBe("batman");
  const area = document.createElement("textarea");
  document.body.append(area);
  await act(async () => area.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(reviewStore.getState().nodeId).toBe("batman");
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(reviewStore.getState().nodeId).toBeNull();
});

it("shows the review's labels", async () => {
  await vi.waitFor(() => expect(text()).toContain("src/a.ts"));
  expect(text()).toContain("Review · Batman");
  expect(text()).toContain("Since main");
  expect(text()).toContain("Uncommitted");
  // The status is read as a word, not hidden in a hover-only title (P2-20).
  expect(host.querySelector("li [title]")).toBeNull();
  expect([...host.querySelectorAll(".sr-only")].map((e) => e.textContent)).toContain("modified");
  await vi.waitFor(() => expect(host.querySelectorAll("[data-diff-line]").length).toBe(4));
  await act(async () => reviewStore.getState().add({ file: "src/a.ts", line: 2, text: "Why 3?" }));
  expect(text()).toContain("1 remark");
  expect(button("Send to Batman")).toBeDefined();
  await act(async () => button("Send to Batman").click());
  expect(toast).toHaveBeenCalledWith("Review sent to Batman", { position: "top-center" });
});

it("keeps the file read and the remark being typed through Refresh and a click on another line (backlog 27 oct)", async () => {
  await vi.waitFor(() => expect(host.querySelectorAll("[data-diff-line]").length).toBe(4));
  await act(async () => (host.querySelector('[data-diff-line="add"]') as HTMLElement).click());
  const field = () => host.querySelector<HTMLInputElement>('[aria-label="Remark on this line"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), "half-way");
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => (host.querySelector('[data-diff-line="ctx"]') as HTMLElement).click());
  expect(field().value).toBe("half-way");
  await act(async () => button("Refresh").click());
  await vi.waitFor(() => expect(calls.filter((c) => c.cmd === "review_changes").length).toBe(2));
  expect(host.querySelectorAll("[data-diff-line]").length).toBe(4);
  expect(field().value).toBe("half-way");
});

it("tells the remarks wait when the agent is still starting, and keeps them", async () => {
  vi.mocked(sendToAgents).mockResolvedValueOnce({ sent: 0, skipped: [], waiting: [], unsuited: [], starting: ["Batman"] });
  vi.mocked(toast.warning).mockClear();
  await act(async () => reviewStore.getState().add({ file: "src/a.ts", line: 2, text: "Why 3?" }));
  await act(async () => button("Send to Batman").click());
  expect(toast.warning).toHaveBeenCalledWith("Batman is still starting: try again in a moment to send it the review");
  expect(reviewStore.getState().remarks).toHaveLength(1);
});

it("keeps a leading dot where it is in a path cut from its start (P2-40)", async () => {
  await vi.waitFor(() => expect(text()).toContain("src/a.ts"));
  const tails = [...host.querySelectorAll<HTMLElement>("[data-path-tail]")];
  expect(tails.length).toBeGreaterThan(0);
  for (const tail of tails) {
    expect(tail.style.direction).toBe("rtl");
    // The path itself stays left-to-right inside the cutting box.
    expect(tail.firstElementChild?.tagName).toBe("BDI");
  }
});

it("refreshes the Files tab out of an error, and reads the open file again (P2-47)", async () => {
  await vi.waitFor(() => expect(text()).toContain("src/a.ts"));
  let failing = true;
  let content = "first\n";
  mockIPC((cmd) => {
    if (cmd === "review_default_base") return "main";
    if (cmd === "review_changes") return { compared: "abc123", truncated: false, files: [] };
    if (cmd === "review_files") {
      if (failing) throw new Error("index.lock held");
      return { files: ["README.md"], truncated: false };
    }
    if (cmd === "review_read_file") return { text: content, size: content.length, truncated: false };
    return undefined;
  });
  const filesTab = [...host.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === "Files")!;
  await act(async () => void filesTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  await vi.waitFor(() => expect(text()).toContain("index.lock held"));
  failing = false;
  await act(async () => button("Refresh").click());
  await vi.waitFor(() => expect(text()).toContain("README.md"));
  expect(text()).not.toContain("index.lock held");

  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "README.md")!.click());
  await vi.waitFor(() => expect(text()).toContain("first"));
  content = "rewritten by the agent\n";
  await act(async () => button("Refresh").click());
  await vi.waitFor(() => expect(text()).toContain("rewritten by the agent"));
});

const typeRemark = (value: string) =>
  act(async () => {
    const field = host.querySelector<HTMLInputElement>('[aria-label="Remark on this line"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

it("keeps an open remark on its line when a refresh moves it, and files it there (P2-48)", async () => {
  await vi.waitFor(() => expect(host.querySelectorAll("[data-diff-line]").length).toBe(4));
  await act(async () => (host.querySelector('[data-diff-line="add"]') as HTMLElement).click());
  await typeRemark("Why 3?");
  // The agent wrote three lines above meanwhile: the added line is now line 5, row 7.
  diffText = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,5 @@\n+// one\n+// two\n+// three\n const x = 1;\n-const y = 2;\n+const y = 3;\n";
  await act(async () => button("Refresh").click());
  await vi.waitFor(() => expect(host.querySelectorAll("[data-diff-line]").length).toBe(7));
  const field = host.querySelector<HTMLInputElement>('[aria-label="Remark on this line"]')!;
  // The field sits under the same line, its words with it.
  expect(field.closest('[role="row"]')!.previousElementSibling!.textContent).toContain("const y = 3;");
  expect(field.value).toBe("Why 3?");
  await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(reviewStore.getState().remarks).toEqual([{ file: "src/a.ts", line: 5, lineText: "const y = 3;", text: "Why 3?" }]);
});

it("closes an open remark whose line a refresh made ambiguous, rather than file it on another line (P2-48)", async () => {
  await vi.waitFor(() => expect(host.querySelectorAll("[data-diff-line]").length).toBe(4));
  await act(async () => (host.querySelector('[data-diff-line="add"]') as HTMLElement).click());
  await typeRemark("kept for later");
  // Now two added lines read the same, neither where the first one was.
  diffText = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,4 @@\n+const y = 3;\n const x = 1;\n-const y = 2;\n+// moved\n+const y = 3;\n";
  await act(async () => button("Refresh").click());
  await vi.waitFor(() => expect(host.querySelectorAll("[data-diff-line]").length).toBe(6));
  expect(host.querySelector('[aria-label="Remark on this line"]')).toBeNull();
  expect(reviewStore.getState().remarks).toEqual([]);
  // The words typed are not lost: the next field opens with them.
  await act(async () => (host.querySelector('[data-diff-line="ctx"]') as HTMLElement).click());
  expect(host.querySelector<HTMLInputElement>('[aria-label="Remark on this line"]')!.value).toBe("kept for later");
});

it("does not draw the diff's lines again while a remark is typed (P2-59)", async () => {
  const { DiffRow } = await import("./DiffRow");
  // A memo component: the rows keep their props (the parsed line, one stable callback) while the field changes.
  expect((DiffRow as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  await vi.waitFor(() => expect(host.querySelectorAll("[data-diff-line]").length).toBe(4));
  const before = host.querySelector('[data-diff-line="ctx"]');
  await act(async () => (host.querySelector('[data-diff-line="add"]') as HTMLElement).click());
  await typeRemark("typing");
  expect(host.querySelector('[data-diff-line="ctx"]')).toBe(before);
});
