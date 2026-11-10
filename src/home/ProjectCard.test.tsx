// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { confirmAction } from "@/components/confirm";
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
