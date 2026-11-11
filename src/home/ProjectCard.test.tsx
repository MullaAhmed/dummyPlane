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

const actions = (host: Element) => host.querySelector<HTMLElement>('[aria-label="Project actions"]')!;

const project = (missing: boolean): Project => ({ id: "p", name: "api", path: "C:/api", position: 0, lastOpenedAt: 0, workspaceCount: 1, missing, liveAgents: 0 });

async function menuOf(missing: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ProjectCard project={project(missing)} />));
  await act(async () => actions(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
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
  await act(async () => actions(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent === "Remove from the list")!;
  await act(async () => item.click());
  expect(vi.mocked(confirmAction).mock.calls[0][0]).toMatchObject({ title: "Remove “api” from the list?", destructive: true });
  expect(remove).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  document.body.replaceChildren();
  remove.mockRestore();
});

describe("the card opens through a real button, and its actions never open it", () => {
  const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

  async function card(missing = false) {
    const open = vi.spyOn(projectsStore.getState(), "open").mockResolvedValue();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<ProjectCard project={project(missing)} />));
    const done = async () => {
      await act(async () => root.unmount());
      document.body.replaceChildren();
      open.mockRestore();
    };
    return { host, open, done };
  }

  it("opens the project from a native button named after it, stretched over the card", async () => {
    const { host, open, done } = await card();
    const self = getByRole(host, "button", "api");
    // A <button>: Enter and Space are the browser's own, no role="button" to restate them.
    expect(self.tagName).toBe("BUTTON");
    expect(self.className).toContain("after:inset-0");
    await act(async () => self.click());
    expect(open).toHaveBeenCalledTimes(1);
    // Its path describes it; the card as a whole is no longer one big button.
    expect(document.getElementById(self.getAttribute("aria-describedby")!)!.textContent).toBe("C:/api");
    expect(host.querySelector('[role="button"]')).toBeNull();
    await done();
  });

  it("keeps the actions menu and the name field out of the button, above its stretched layer", async () => {
    const { host, done } = await card();
    const self = getByRole(host, "button", "api");
    expect(self.contains(actions(host))).toBe(false);
    expect(actions(host).className).toContain("z-10");
    await act(async () => press(actions(host), "Enter"));
    await act(async () => getByRole(document.body, "menuitem", "Rename").click());
    // Once the menu has closed and handed focus around, the field is still there, with the keyboard.
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 60)));
    const field = host.querySelector("input")!;
    expect(field.getAttribute("aria-label")).toBe("Project name");
    expect(field.className).toContain("z-10");
    expect(document.activeElement).toBe(field);
    expect(host.querySelector("[data-open-project]")).toBeNull();
    await done();
  });

  it("says why a missing project does not open, and does nothing", async () => {
    const { host, open, done } = await card(true);
    const self = getByRole(host, "button", "api");
    expect(self.getAttribute("aria-disabled")).toBe("true");
    const described = self.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)!.textContent);
    expect(described).toContain("Folder not found");
    await act(async () => self.click());
    expect(open).not.toHaveBeenCalled();
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
