// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Project } from "@/ipc/db";
import { createProjectsStore } from "./projects";

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    path: `C:\\${id}`,
    position: 0,
    lastOpenedAt: 0,
    workspaceCount: 1,
    missing: false,
    liveAgents: 0,
    ...overrides,
  };
}

function fakeBackend(projects: Project[], active: string | null = null) {
  const db = {
    projects: [...projects],
    settings: new Map<string, unknown>(active !== null ? [["ui.activeProjectId", active]] : []),
    opened: [] as string[],
  };
  mockIPC((cmd, raw) => {
    const args = raw as Record<string, string>;
    switch (cmd) {
      case "list_projects":
        return db.projects.map((p) => ({ ...p }));
      case "create_project": {
        const created = project(`p${db.projects.length + 1}`, { path: args.path, name: "new" });
        db.projects.push(created);
        return created;
      }
      case "open_project":
        db.opened.push(args.id);
        return;
      case "rename_project":
        db.projects = db.projects.map((p) => (p.id === args.id ? { ...p, name: args.name } : p));
        return;
      case "relocate_project":
        db.projects = db.projects.map((p) => (p.id === args.id ? { ...p, path: args.path } : p));
        return;
      case "delete_project":
        db.projects = db.projects.filter((p) => p.id !== args.id);
        return ["w1", "w2"];
      case "get_setting":
        return db.settings.get(args.key) ?? null;
      case "set_setting":
        db.settings.set(args.key, (raw as { value: unknown }).value);
        return;
    }
  });
  return db;
}

const deps = { loadWorkspaces: vi.fn(async () => undefined), forgetWorkspaces: vi.fn(), rebaseTerminals: vi.fn(), rebaseWorkspaces: vi.fn() };
let store: ReturnType<typeof createProjectsStore>;
const state = () => store.getState();

beforeEach(() => {
  deps.loadWorkspaces.mockClear();
  deps.forgetWorkspaces.mockClear();
  deps.rebaseTerminals.mockClear();
  deps.rebaseWorkspaces.mockClear();
  store = createProjectsStore(deps);
});
afterEach(() => clearMocks());

describe("projects store", () => {
  it("reopens the last project and loads its workspaces", async () => {
    const db = fakeBackend([project("a"), project("b")], "b");
    await state().init();
    expect(state().view).toBe("project");
    expect(state().activeId).toBe("b");
    expect(deps.loadWorkspaces).toHaveBeenCalledWith("b");
    expect(db.opened).toEqual(["b"]);
  });

  it("shows the home screen when the saved project's folder is gone", async () => {
    fakeBackend([project("a", { missing: true })], "a");
    await state().init();
    expect(state().view).toBe("home");
    expect(deps.loadWorkspaces).not.toHaveBeenCalled();
  });

  it("opens the most recent project when none was ever chosen", async () => {
    fakeBackend([project("a", { lastOpenedAt: 1 }), project("b", { lastOpenedAt: 5 }), project("c", { lastOpenedAt: 9, missing: true })]);
    await state().init();
    expect(state().activeId).toBe("b");
  });

  it("shows the home screen after the project was closed", async () => {
    fakeBackend([project("a")], "");
    await state().init();
    expect(state().view).toBe("home");
  });

  it("adds a folder as a project and opens it", async () => {
    const db = fakeBackend([], "");
    await state().init();
    await state().add("C:\\code\\web");
    expect(state().projects.map((p) => p.path)).toEqual(["C:\\code\\web"]);
    expect(state().view).toBe("project");
    expect(db.settings.get("ui.activeProjectId")).toBe(state().activeId);
  });

  it("goes home keeping the last project, or closes it", async () => {
    const db = fakeBackend([project("a")], "a");
    await state().init();
    state().goHome();
    expect(state().view).toBe("home");
    expect(db.settings.get("ui.activeProjectId")).toBe("a");
    await state().open("a");
    await state().close();
    expect(state().view).toBe("home");
    expect(db.settings.get("ui.activeProjectId")).toBe("");
  });

  it("removes a project, forgets its workspaces and leaves it if it was open", async () => {
    fakeBackend([project("a"), project("b")], "a");
    await state().init();
    await state().remove("a");
    expect(state().projects.map((p) => p.id)).toEqual(["b"]);
    expect(deps.forgetWorkspaces).toHaveBeenCalledWith(["w1", "w2"]);
    expect(state().view).toBe("home");
    expect(state().activeId).toBeNull();
  });

  it("renames and relocates", async () => {
    fakeBackend([project("a")]);
    await state().init();
    await state().rename("a", "  API ");
    await state().relocate("a", "D:\\api");
    expect(state().projects[0]).toMatchObject({ name: "API", path: "D:\\api" });
    expect(deps.rebaseTerminals).toHaveBeenCalledWith("C:\\a", "D:\\api");
    expect(deps.rebaseWorkspaces).toHaveBeenCalledWith("a", "C:\\a", "D:\\api");
  });

  it("reports a backend failure at startup", async () => {
    mockIPC(() => {
      throw { kind: "db", message: "disk I/O error" };
    });
    await state().init();
    expect(state().view).toBe("error");
    expect(state().error).toContain("disk I/O error");
  });
});
