// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { Workspace } from "@/ipc/db";
import { projectsStore, type Project } from "./projects";
import { knownWorkspaceFolder, ownFolder, workspaceFolder } from "./workspaceFolder";
import { workspacesStore } from "./workspaces";

const project = (id: string, path: string) => ({ id, name: id, path, lastOpenedAt: 0, missing: false }) as Project;
const workspace = (id: string, projectId: string, folder: string | null, kind: Workspace["kind"] = "canvas"): Workspace => ({
  id,
  projectId,
  name: id,
  position: 0,
  pantheon: null,
  kind,
  folder,
});

beforeEach(() => {
  projectsStore.setState({ projects: [project("p1", "C:/code/api"), project("p2", "C:/code/web")], activeId: "p1" });
  workspacesStore.setState({
    projectId: "p1",
    workspaces: [workspace("w1", "p1", "D:/work/lib"), workspace("w2", "p1", null), workspace("c1", "p1", "D:/ignored", "code")],
    activeId: "w1",
    status: "ready",
  });
});

describe("the folder of a workspace", () => {
  it("is the one it picked, else its project's", () => {
    expect(workspaceFolder("w1")).toBe("D:/work/lib");
    expect(workspaceFolder("w2")).toBe("C:/code/api");
  });

  it("is the active workspace's when none is named", () => {
    expect(workspaceFolder()).toBe("D:/work/lib");
    workspacesStore.setState({ activeId: "w2" });
    expect(workspaceFolder()).toBe("C:/code/api");
  });

  it("follows a project that moved, for a workspace on the project's folder", () => {
    projectsStore.setState({ projects: [project("p1", "E:/moved/api"), project("p2", "C:/code/web")] });
    expect(workspaceFolder("w2")).toBe("E:/moved/api");
    expect(workspaceFolder("w1")).toBe("D:/work/lib");
  });

  it("leaves the code workspace on the project, whatever its row says", () => {
    expect(ownFolder(workspacesStore.getState().workspaces[2])).toBeNull();
    expect(workspaceFolder("c1")).toBe("C:/code/api");
  });

  it("is the active project's while there is no workspace", () => {
    workspacesStore.setState({ workspaces: [], activeId: null });
    expect(workspaceFolder()).toBe("C:/code/api");
  });

  it("is told apart from a workspace of another project: `knownWorkspaceFolder` is null for it", () => {
    expect(knownWorkspaceFolder("w1")).toBe("D:/work/lib");
    expect(knownWorkspaceFolder("elsewhere")).toBeNull();
  });
});
