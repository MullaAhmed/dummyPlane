// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { gitWindowStore } from "@/git/gitWindowStore";
import type { Workspace } from "@/ipc/db";
import { getByRole } from "@/lib/a11y";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { GitChip } from "./GitChip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let status: { branch: string; changed: number } | null;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  status = { branch: "main", changed: 3 };
  mockIPC((cmd) => (cmd === "git_status" ? status : undefined));
  projectsStore.setState({ projects: [{ id: "p", name: "api", path: "C:/code/api", position: 0, lastOpenedAt: 0, workspaceCount: 1, missing: false, liveAgents: 0 }], activeId: "p" });
  gitWindowStore.setState({ path: null });
  workspacesStore.setState({ projectId: null, workspaces: [], activeId: null, status: "loading" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  clearMocks();
});

it("opens the git window on the project's folder", async () => {
  await act(async () => root.render(<GitChip />));
  const chip = host.querySelector("button")!;
  expect(chip.textContent).toContain("main");
  expect(chip.textContent).toContain("3");
  // The name holds the changed count the chip shows (WCAG 2.5.3 label in name).
  expect(getByRole(host, "button", "Open the git window · main · 3 changed files")).toBe(chip);
  await act(async () => chip.click());
  expect(gitWindowStore.getState().path).toBe("C:/code/api");
});

it("shows nothing outside a repository", async () => {
  status = null;
  await act(async () => root.render(<GitChip />));
  expect(host.querySelector("button")).toBeNull();
});

it("reads the folder of the active workspace, not the project's, and follows a switch of workspace", async () => {
  const asked: string[] = [];
  mockIPC((cmd, args) => {
    if (cmd !== "git_status") return undefined;
    const path = (args as { path: string }).path;
    asked.push(path);
    return { branch: path === "D:/work/lib" ? "feature" : "main", changed: 0 };
  });
  const own = (id: string, folder: string | null): Workspace => ({ id, projectId: "p", name: id, position: 0, pantheon: null, kind: "canvas", folder });
  workspacesStore.setState({ projectId: "p", workspaces: [own("w1", "D:/work/lib"), own("w2", null)], activeId: "w1", status: "ready" });
  await act(async () => root.render(<GitChip />));
  expect(asked).toEqual(["D:/work/lib"]);
  expect(host.querySelector("button")!.textContent).toContain("feature");
  await act(async () => host.querySelector("button")!.click());
  expect(gitWindowStore.getState().path).toBe("D:/work/lib");
  // Another workspace, on the project's folder: the chip reads that one, and the old branch is gone meanwhile.
  await act(async () => workspacesStore.setState({ activeId: "w2" }));
  expect(asked[asked.length - 1]).toBe("C:/code/api");
  expect(host.querySelector("button")!.textContent).toContain("main");
});

it("names the branch alone when nothing changed", async () => {
  status = { branch: "main", changed: 0 };
  await act(async () => root.render(<GitChip />));
  expect(getByRole(host, "button", "Open the git window · main")).not.toBeNull();
});

it("cuts a long branch shorter on a window too narrow for it beside the command bar (under 1,150 px)", async () => {
  status = { branch: "feature/a-very-long-branch-name", changed: 1 };
  await act(async () => root.render(<GitChip />));
  const branch = host.querySelector<HTMLElement>("[data-branch]")!;
  expect(branch.className).toContain("max-w-20");
  expect(branch.className).toContain("min-[1150px]:max-w-[150px]");
  expect(branch.className).toContain("truncate");
});
