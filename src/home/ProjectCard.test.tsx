// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { confirmAction } from "@/components/confirm";
import { getByRole, queryAllByRole } from "@/lib/a11y";
import { projectsStore, type Project } from "@/store/projects";
import { ProjectCard } from "./ProjectCard";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/components/confirm", () => ({ confirmAction: vi.fn(() => Promise.resolve(false)) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = (missing: boolean): Project => ({ id: "p", name: "api", path: "C:/api", position: 0, lastOpenedAt: 0, workspaceCount: 1, missing, liveAgents: 0 });

async function menuOf(missing: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ProjectCard project={project(missing)} />));
  await act(async () => host.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const items = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
  await act(async () => root.unmount());
  document.body.replaceChildren();
  return items;
}

it("offers Rename for a project that exists, not for a missing one", async () => {
  expect(await menuOf(false)).toContain("Rename");
  expect(await menuOf(true)).not.toContain("Rename");
});

it("asks in the app's own dialog before removing a project, and keeps it on Cancel", async () => {
  const remove = vi.spyOn(projectsStore.getState(), "remove").mockResolvedValue();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ProjectCard project={project(false)} />));
  await act(async () => host.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent === "Remove from the list")!;
  await act(async () => item.click());
  expect(vi.mocked(confirmAction).mock.calls[0][0]).toMatchObject({ title: "Remove “api” from the list?", destructive: true });
  expect(remove).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  document.body.replaceChildren();
  remove.mockRestore();
});

describe("the keyboard opens the project from the card only", () => {
  const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

  async function card() {
    const open = vi.spyOn(projectsStore.getState(), "open").mockResolvedValue();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<ProjectCard project={project(false)} />));
    const done = async () => {
      await act(async () => root.unmount());
      document.body.replaceChildren();
      open.mockRestore();
    };
    return { host, open, done };
  }

  it("opens the project on Enter or Space on the card", async () => {
    const { host, open, done } = await card();
    const self = getByRole(host, "button", /^api/);
    await act(async () => press(self, "Enter"));
    expect(open).toHaveBeenCalledTimes(1);
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    await act(async () => self.dispatchEvent(space));
    expect(open).toHaveBeenCalledTimes(2);
    // Space on a button must not scroll the page.
    expect(space.defaultPrevented).toBe(true);
    await done();
  });

  it("opens the actions menu on Enter on its button, not the project", async () => {
    const { host, open, done } = await card();
    await act(async () => press(getByRole(host, "button", "Project actions"), "Enter"));
    expect(queryAllByRole(document.body, "menuitem").length).toBeGreaterThan(0);
    expect(open).not.toHaveBeenCalled();
    await done();
  });

  it.each(["Rename", "Remove from the list"])("runs %s on Enter in the menu without opening the project", async (item) => {
    const { host, open, done } = await card();
    await act(async () => press(getByRole(host, "button", "Project actions"), "Enter"));
    await act(async () => press(getByRole(document.body, "menuitem", item), "Enter"));
    expect(open).not.toHaveBeenCalled();
    await done();
  });
});
