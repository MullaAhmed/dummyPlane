// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import type { LogEntry, NoPush, RepoState } from "@/ipc/repo";
import type { ChangedFile } from "@/ipc/review";
import { reviewStore } from "@/review/reviewStore";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { sourceFiles } from "@/theme/cssBlocks";
import { GitWindow } from "./GitWindow";
import { gitWindowStore } from "./gitWindowStore";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = (path: string, status: ChangedFile["status"] = "modified", counts: [number, number] | null = [2, 1]): ChangedFile => ({
  path,
  oldPath: null,
  status,
  added: counts?.[0] ?? null,
  removed: counts?.[1] ?? null,
});

const base: RepoState = { branch: "main", upstream: "origin/main", ahead: 2, behind: 0, pushTo: "origin/main", head: "abc", noPush: null, files: [], stamps: { "src/a.ts": "s1", "b.txt": "s2" }, truncated: false };

let repo: RepoState;
let history: LogEntry[];
let calls: { cmd: string; args: Record<string, unknown> }[];
let fail: Record<string, string>;
let host: HTMLDivElement;
let root: Root;

const called = (cmd: string) => calls.filter((c) => c.cmd === cmd);

beforeEach(() => {
  repo = { ...base, files: [file("src/a.ts"), file("b.txt", "untracked", [4, 0])] };
  history = [{ hash: "abcdef0123", shortHash: "abcdef0", author: "Mathilde", date: 1_700_000_000, subject: "feat: the first one", parents: [], refs: [] }];
  calls = [];
  fail = {};
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: args as Record<string, unknown> });
    if (fail[cmd]) throw fail[cmd];
    if (cmd === "repo_state") return repo;
    if (cmd === "repo_history") return history;
    if (cmd === "review_file_diff") return "@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n";
    if (cmd === "repo_commit") return "1234567";
  });
  projectsStore.setState({ projects: [{ id: "p", name: "api", path: "C:/code/api", position: 0, lastOpenedAt: 0, workspaceCount: 1, missing: false, liveAgents: 0 }], activeId: "p" });
  reviewStore.setState({ nodeId: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  clearMocks();
  document.body.replaceChildren();
  gitWindowStore.setState({ path: null });
});

const render = async () => {
  gitWindowStore.getState().open("C:/code/api");
  await act(async () => root.render(<GitWindow />));
};
const button = (text: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
const labelled = (label: string) => document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
/** A Radix checkbox: a button that says its state in `aria-checked`, clicked like a box. */
const check = (label: string) => {
  const box = labelled(label);
  return { get checked() { return box.getAttribute("aria-checked") === "true"; }, click: () => box.click() };
};
const typeMessage = (value: string) =>
  act(async () => {
    const area = labelled("Commit message") as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });

describe("the changes (spec fenêtre git §3.1)", () => {
  it("lists the files with status and +/−, all checked", async () => {
    await render();
    const row = document.body.querySelector<HTMLElement>("[data-git-file='src/a.ts']")!;
    expect(row.textContent).toContain("M");
    expect(row.textContent).toContain("+2");
    expect(row.textContent).toContain("−1");
    expect(check("Include src/a.ts").checked).toBe(true);
    expect(check("Include b.txt").checked).toBe(true);
    expect(button("Commit (2)")).toBeTruthy();
    expect(document.body.textContent).toContain("Changes (2)");
  });

  it("marks a binary file without counts", async () => {
    repo.files = [file("logo.png", "modified", null)];
    await render();
    const row = document.body.querySelector("[data-git-file='logo.png']")!;
    expect(row.textContent).not.toContain("+");
  });

  it("shows the diff of the file clicked, read-only, with the review panel's rows", async () => {
    await render();
    expect(document.body.querySelector("[data-diff-line]")).not.toBeNull();
    await act(async () => button("b.txt")!.click());
    expect(called("review_file_diff").pop()!.args).toMatchObject({ path: "C:/code/api", file: repo.files[1], base: null });
    expect(document.body.querySelector("[data-diff-line='add']")!.textContent).toContain("new");
    expect(document.body.querySelector("[data-diff-line='add']")!.getAttribute("title")).toBeNull();
  });

  it("checks and unchecks all, and a new file arrives checked while unchecked ones stay so", async () => {
    await render();
    await act(async () => check("Include all").click());
    expect(check("Include src/a.ts").checked).toBe(false);
    expect(button("Commit (0)")!.disabled).toBe(true);
    await act(async () => check("Include all").click());
    expect(check("Include src/a.ts").checked).toBe(true);
    await act(async () => check("Include src/a.ts").click());
    repo = { ...repo, files: [...repo.files, file("new.ts", "untracked")] };
    await act(async () => labelled("Refresh").click());
    expect(check("Include src/a.ts").checked).toBe(false);
    expect(check("Include new.ts").checked).toBe(true);
  });

  it("says when the list was cut: what is not shown cannot be committed", async () => {
    repo = { ...repo, truncated: true };
    await render();
    expect(document.body.textContent).toContain("List cut: only the first 2 changes are shown");
  });

  it("keeps the message and the choices when a refresh fails, and says why", async () => {
    await render();
    await act(async () => check("Include b.txt").click());
    await typeMessage("fix: something");
    fail.repo_state = "index.lock";
    await act(async () => labelled("Refresh").click());
    expect(document.body.querySelector("[role='alert']")!.textContent).toContain("index.lock");
    expect((labelled("Commit message") as HTMLTextAreaElement).value).toBe("fix: something");
    expect(check("Include b.txt").checked).toBe(false);
  });

  it("never lets an older answer overwrite a newer one", async () => {
    const answers: ((state: RepoState) => void)[] = [];
    await render();
    mockIPC((cmd) => {
      if (cmd === "repo_state") return new Promise((resolve) => answers.push(resolve));
      if (cmd === "review_file_diff") return "";
    });
    await act(async () => labelled("Refresh").click());
    await act(async () => labelled("Refresh").click());
    await act(async () => answers[1]({ ...repo, files: [file("newer.ts")] }));
    await act(async () => answers[0]({ ...repo, files: [file("older.ts")] }));
    expect(document.body.querySelector("[data-git-file='newer.ts']")).not.toBeNull();
    expect(document.body.querySelector("[data-git-file='older.ts']")).toBeNull();
  });

  it("says when nothing changed", async () => {
    repo.files = [];
    await render();
    expect(document.body.textContent).toContain("Nothing to commit");
  });

  it("says why a folder cannot be read", async () => {
    fail.repo_state = "not a git repository";
    await render();
    expect(document.body.textContent).toContain("not a git repository");
  });
});

describe("the commit (spec fenêtre git §3.2)", () => {
  it("needs a message and a file", async () => {
    await render();
    expect(button("Commit (2)")!.disabled).toBe(true);
    await typeMessage("   ");
    expect(button("Commit (2)")!.disabled).toBe(true);
    await typeMessage("fix: something");
    expect(button("Commit (2)")!.disabled).toBe(false);
  });

  it("commits the checked files only, then empties the message and reads again", async () => {
    await render();
    await act(async () => check("Include b.txt").click());
    await typeMessage("fix: something");
    calls = [];
    await act(async () => button("Commit (1)")!.click());
    expect(called("repo_commit")[0].args).toEqual({ path: "C:/code/api", files: [repo.files[0]], message: "fix: something" });
    expect((labelled("Commit message") as HTMLTextAreaElement).value).toBe("");
    expect(called("repo_state").length).toBe(1);
    expect(toast).toHaveBeenCalledWith("Commit 1234567 created");
  });

  it("keeps the message and the choices through a look at the history", async () => {
    await render();
    await act(async () => check("Include b.txt").click());
    await typeMessage("fix: something");
    await act(async () => button("History")!.click());
    await act(async () => button("Changes")!.click());
    expect((labelled("Commit message") as HTMLTextAreaElement).value).toBe("fix: something");
    expect(check("Include b.txt").checked).toBe(false);
  });

  it("never pushes after a commit", async () => {
    await render();
    await typeMessage("fix: something");
    await act(async () => button("Commit (2)")!.click());
    expect(called("repo_push")).toEqual([]);
  });

  it("shows git's refusal and keeps the message", async () => {
    fail.repo_commit = "pre-commit: no way";
    await render();
    await typeMessage("fix: something");
    await act(async () => button("Commit (2)")!.click());
    expect(document.body.querySelector("[role='alert']")!.textContent).toContain("pre-commit: no way");
    expect((labelled("Commit message") as HTMLTextAreaElement).value).toBe("fix: something");
  });
});

describe("discarding (spec fenêtre git §3.3)", () => {
  const ask = (path: string) => act(async () => labelled(`Discard ${path}`).click());

  it("touches nothing before the dialog's button", async () => {
    await render();
    await ask("src/a.ts");
    expect(called("repo_discard")).toEqual([]);
    const dialog = document.body.querySelector("[role='dialog']")!;
    expect(dialog.textContent).toContain("src/a.ts");
    expect(dialog.textContent).toContain("cannot be undone");
  });

  it("does nothing when cancelled", async () => {
    await render();
    await ask("src/a.ts");
    await act(async () => button("Cancel")!.click());
    expect(called("repo_discard")).toEqual([]);
    expect(document.body.querySelector("[role='dialog']")).toBeNull();
  });

  it("discards the confirmed file exactly as it was listed, then reads again", async () => {
    await render();
    await ask("src/a.ts");
    calls = [];
    await act(async () => button("Discard this file")!.click());
    expect(called("repo_discard")[0].args).toEqual({ path: "C:/code/api", file: repo.files[0], stamp: "s1" });
    expect(called("repo_state").length).toBe(1);
  });

  it("drops the question when the file leaves the list, so it cannot come back", async () => {
    await render();
    await ask("src/a.ts");
    const kept = repo.files;
    repo = { ...repo, files: [] };
    await act(async () => labelled("Refresh").click());
    repo = { ...repo, files: kept };
    await act(async () => labelled("Refresh").click());
    expect(document.body.querySelector("[role='dialog']")).toBeNull();
    expect(called("repo_discard")).toEqual([]);
  });

  it("says an untracked file will be deleted", async () => {
    await render();
    await ask("b.txt");
    expect(document.body.querySelector("[role='dialog']")!.textContent).toContain("will be deleted");
  });

  it("shows the refusal when the file changed meanwhile, and reads again", async () => {
    fail.repo_discard = "src/a.ts changed since confirmation: nothing was touched.";
    await render();
    await ask("src/a.ts");
    calls = [];
    await act(async () => button("Discard this file")!.click());
    expect(document.body.querySelector("[role='alert']")!.textContent).toContain("nothing was touched");
    expect(called("repo_state").length).toBe(1);
  });
});

describe("the history (spec fenêtre git §3.4)", () => {
  it("shows hash, author and date", async () => {
    await render();
    await act(async () => button("History")!.click());
    const row = document.body.querySelector<HTMLElement>("[data-git-commit='abcdef0123']")!;
    expect(row.textContent).toContain("abcdef0");
    expect(row.textContent).toContain("feat: the first one");
    expect(row.textContent).toContain("Mathilde");
    expect(row.textContent).toMatch(/2023/);
  });

  it("says when there is no commit", async () => {
    history = [];
    await render();
    await act(async () => button("History")!.click());
    expect(document.body.textContent).toContain("No commit yet");
  });

  const commit = (hash: string, subject: string, parents: string[], refs: LogEntry["refs"] = []): LogEntry => ({
    hash,
    shortHash: hash.slice(0, 7),
    author: "Mathilde",
    date: 1_700_000_000,
    subject,
    parents,
    refs,
  });
  const row = (hash: string) => document.body.querySelector<HTMLElement>(`[data-git-commit='${hash}']`)!;

  it("draws a graph beside every commit, the merges apart, and names the branches and tags", async () => {
    history = [
      commit("merge000", "Merge branch 'side'", ["main0000", "side0000"], [
        { kind: "branch", name: "main", current: true },
        { kind: "remote", name: "origin/main", current: false },
      ]),
      commit("side0000", "feat: on the side", ["root0000"], [{ kind: "branch", name: "side", current: false }]),
      commit("main0000", "fix: on main", ["root0000"]),
      commit("root0000", "first", [], [{ kind: "tag", name: "v1", current: false }]),
    ];
    await render();
    await act(async () => button("History")!.click());
    for (const entry of history) expect(row(entry.hash).querySelector("svg[aria-hidden]"), entry.hash).not.toBeNull();
    // Every row's graph is as wide as the widest, so the subjects line up.
    expect(new Set(history.map((entry) => row(entry.hash).querySelector("svg")!.getAttribute("width"))).size).toBe(1);
    expect(row("merge000").hasAttribute("data-git-merge")).toBe(true);
    expect(row("side0000").hasAttribute("data-git-merge")).toBe(false);
    expect(row("merge000").textContent).toContain("main");
    expect(row("merge000").textContent).toContain("origin/main");
    expect(row("merge000").querySelector("[title='Branch main · HEAD']")).not.toBeNull();
    expect(row("root0000").querySelector("[title='Tag v1']")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Only the latest");
  });

  it("counts the names past the first two, so the subject keeps its room", async () => {
    history = [
      commit("abcdef0123", "feat: the first one", [], [
        { kind: "branch", name: "main", current: true },
        { kind: "branch", name: "next", current: false },
        { kind: "tag", name: "v2", current: false },
      ]),
    ];
    await render();
    await act(async () => button("History")!.click());
    expect(row("abcdef0123").textContent).toContain("+1");
    expect(row("abcdef0123").textContent).not.toContain("v2");
  });

  it("says when older commits are left out", async () => {
    history = [commit("abcdef0123", "feat: the latest", ["0123456789"]), commit("0123456789", "feat: the one before", ["notloaded"])];
    await render();
    await act(async () => button("History")!.click());
    expect(document.body.textContent).toContain("Only the latest 2 commits are shown");
  });

  it("dates today's commits by their time", async () => {
    history = [{ ...commit("abcdef0123", "feat: just now", []), date: Math.floor(Date.now() / 1000) }];
    await render();
    await act(async () => button("History")!.click());
    expect(row("abcdef0123").querySelector("time")!.textContent).toMatch(/^\d\d:\d\d$/);
  });
});

describe("pushing (spec fenêtre git §3.5)", () => {
  it("only ever pushes on the button's click", async () => {
    await render();
    await act(async () => labelled("Refresh").click());
    await act(async () => button("History")!.click());
    expect(called("repo_push")).toEqual([]);
    calls = [];
    await act(async () => button("Push 2 → origin/main")!.click());
    expect(called("repo_push")).toEqual([{ cmd: "repo_push", args: { path: "C:/code/api", branch: "main", target: "origin/main", head: "abc" } }]);
    expect(called("repo_state").length).toBe(1);
    expect(toast).toHaveBeenCalledWith("Pushed to origin/main");
  });

  it("offers a branch without upstream", async () => {
    repo = { ...repo, upstream: null, ahead: 0 };
    await render();
    expect(button("Push → origin/main")!.disabled).toBe(false);
  });

  /** A disabled button takes no focus: its wrapper tells why, in the app's hint, never a native title. */
  const whyHint = async () => {
    expect(button("Push")!.hasAttribute("title"), "a hint, not a native title").toBe(false);
    await act(async () => button("Push")!.parentElement!.focus());
    return document.querySelector('[role="tooltip"]')?.textContent ?? null;
  };

  it("is greyed when up to date", async () => {
    repo = { ...repo, ahead: 0 };
    await render();
    expect(button("Push")!.disabled).toBe(true);
    expect(await whyHint()).toBe("Already up to date");
  });

  it.each<[NoPush, string]>([
    ["noRemote", "This repository has no remote"],
    ["manyRemotes", "Several remotes and no origin: push from a terminal"],
    ["detached", "Detached HEAD: no branch to push"],
    ["noCommit", "No commit to push"],
    ["mirror", "This remote is a mirror: push from a terminal"],
  ])("says why it cannot push: %s", async (noPush, why) => {
    repo = { ...repo, upstream: null, ahead: 0, pushTo: null, noPush };
    await render();
    expect(button("Push")!.disabled).toBe(true);
    expect(await whyHint()).toBe(why);
  });

  it("shows a refused push", async () => {
    fail.repo_push = "rejected: fetch first";
    await render();
    await act(async () => button("Push 2 → origin/main")!.click());
    expect(document.body.querySelector("[role='alert']")!.textContent).toContain("rejected: fetch first");
  });

  it("has one caller in the whole application: the window's button (spec fenêtre git §2.3)", () => {
    const callers = Object.entries(sourceFiles()).filter(([, text]) => /repoPush|repo_push/.test(text));
    expect(callers.map(([path]) => path.replace(/\\/g, "/").replace(/^.*src\//, "")).sort()).toEqual(["git/GitWindow.tsx", "ipc/repo.ts"]);
  });
});

describe("the window", () => {
  it("closes on its button and when the review panel opens", async () => {
    await render();
    await act(async () => labelled("Close").click());
    expect(gitWindowStore.getState().path).toBeNull();
    await render();
    await act(async () => reviewStore.getState().open("isis"));
    expect(gitWindowStore.getState().path).toBeNull();
  });

  it("closes the review panel when it opens", async () => {
    reviewStore.getState().open("isis");
    gitWindowStore.getState().open("C:/code/api");
    expect(reviewStore.getState().nodeId).toBeNull();
  });

  it("closes when another project opens", async () => {
    await render();
    await act(async () => projectsStore.setState({ activeId: null }));
    expect(gitWindowStore.getState().path).toBeNull();
  });

  it("labels the window in English", async () => {
    await render();
    expect(document.body.textContent).toContain("Changes (2)");
    expect(button("Commit (2)")).toBeTruthy();
    expect(button("Push 2 → origin/main")).toBeTruthy();
    await act(async () => labelled("Discard src/a.ts").click());
    expect(document.body.querySelector("[role='dialog']")!.textContent).toContain("cannot be undone");
    // One way out: the footer's Cancel, no corner ✕ beside it.
    expect(document.body.querySelector("[data-slot='dialog-close']")).toBeNull();
    expect(button("Cancel")!.getAttribute("data-variant")).toBe("ghost");
    expect(button("Discard this file")!.getAttribute("data-variant")).toBe("destructive");
    await act(async () => button("Cancel")!.click());
    await act(async () => button("History")!.click());
    expect(document.body.querySelector("[data-git-commit]")).not.toBeNull();
  });
});

describe("the folder it follows", () => {
  const own = (id: string, folder: string | null) => ({ id, projectId: "p", name: id, position: 0, pantheon: null, kind: "canvas" as const, folder });

  it("is the active workspace's: it stays open on that folder, and closes when a workspace of another one comes up", async () => {
    workspacesStore.setState({ projectId: "p", workspaces: [own("w1", "D:/work/lib"), own("w2", null)], activeId: "w1", status: "ready" });
    gitWindowStore.getState().open("D:/work/lib");
    await act(async () => root.render(<GitWindow />));
    expect(gitWindowStore.getState().path).toBe("D:/work/lib");
    expect(calls.some((c) => c.cmd === "repo_state" && c.args.path === "D:/work/lib")).toBe(true);
    await act(async () => workspacesStore.setState({ activeId: "w2" }));
    expect(gitWindowStore.getState().path).toBeNull();
  });

  it("closes when the workspace's folder changes under it", async () => {
    workspacesStore.setState({ projectId: "p", workspaces: [own("w1", null)], activeId: "w1", status: "ready" });
    await render();
    expect(gitWindowStore.getState().path).toBe("C:/code/api");
    await act(async () => workspacesStore.setState({ workspaces: [own("w1", "D:/work/lib")] }));
    expect(gitWindowStore.getState().path).toBeNull();
  });
});
