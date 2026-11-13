import { describe, expect, it } from "vitest";
import type { Project, Workspace } from "@/ipc/db";
import { planeLabel, planeText, type PlaneSources } from "./plane";
import type { Plane } from "./store";

const project = (id: string, name: string): Project => ({ id, name, path: `C:/${name}`, position: 0, lastOpenedAt: 0, workspaceCount: 1, missing: false, liveAgents: 0 });
const workspace = (id: string, projectId: string, name: string): Workspace => ({ id, projectId, name, position: 0, pantheon: null, kind: "canvas", folder: null });
const plane = (over: Partial<Plane> = {}): Plane => ({ projectId: "p1", workspaceId: "w1", nodeId: null, projectName: "Alpha", workspaceName: "Main", ...over });
const sources = (over: Partial<PlaneSources> = {}): PlaneSources => ({
  workspaces: [workspace("w1", "p1", "Main")],
  projectId: "p1",
  projects: [project("p1", "Alpha"), project("p2", "Beta")],
  ...over,
});
const CLOSED = "(closed)";

describe("the names of a plane", () => {
  it("are the ones the stores have now: a renamed workspace and project show their new names", () => {
    const label = planeLabel(plane(), sources({ workspaces: [workspace("w1", "p1", "Renamed")], projects: [project("p1", "Alpha 2")] }), CLOSED);
    expect(label).toEqual({ project: "Alpha 2", workspace: "Renamed" });
  });

  it("read (closed) for a workspace deleted from the open project", () => {
    expect(planeLabel(plane(), sources({ workspaces: [] }), CLOSED)).toEqual({ project: "Alpha", workspace: CLOSED });
  });

  it("read (closed) for a project removed, and the workspace with it", () => {
    const label = planeLabel(plane({ projectId: "p9", projectName: "Gone", workspaceId: "w9", workspaceName: "Old" }), sources(), CLOSED);
    expect(label).toEqual({ project: CLOSED, workspace: CLOSED });
  });

  it("keep the name a workspace had when its project is not the open one: it cannot be looked up", () => {
    const label = planeLabel(plane({ projectId: "p2", projectName: "Beta", workspaceId: "wb", workspaceName: "Elsewhere" }), sources(), CLOSED);
    expect(label).toEqual({ project: "Beta", workspace: "Elsewhere" });
  });

  it("keep the names they came with while the projects are not read yet", () => {
    expect(planeLabel(plane(), sources({ projects: [], workspaces: [] }), CLOSED)).toEqual({ project: "Alpha", workspace: CLOSED });
    expect(planeLabel(plane({ projectId: "p2", projectName: "Beta", workspaceName: "Elsewhere" }), sources({ projects: [], workspaces: [] }), CLOSED)).toEqual({
      project: "Beta",
      workspace: "Elsewhere",
    });
  });

  it("are none for a popup shown with no project open", () => {
    const label = planeLabel(plane({ projectId: null, workspaceId: null, projectName: null, workspaceName: null }), sources(), CLOSED);
    expect(label).toEqual({ project: null, workspace: null });
  });

  it("read (closed) for a workspace whose name was never known and is not in sight", () => {
    const label = planeLabel(plane({ projectId: "p2", projectName: "Beta", workspaceId: "wb", workspaceName: null }), sources(), CLOSED);
    expect(label).toEqual({ project: "Beta", workspace: CLOSED });
  });
});

describe("planeText", () => {
  it("joins the project and the workspace", () => {
    expect(planeText({ project: "Alpha", workspace: "Main" }, "No project open")).toBe("Alpha › Main");
  });

  it("says what there is of it, or that there is no project", () => {
    expect(planeText({ project: "Alpha", workspace: null }, "No project open")).toBe("Alpha");
    expect(planeText({ project: null, workspace: null }, "No project open")).toBe("No project open");
  });
});
