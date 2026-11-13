// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arrive } from "@/canvas/arrive";
import { completeArrival } from "@/commands/pendingArrival";
import type { Project, Workspace } from "@/ipc/db";
import { errorToasts } from "@/lib/errorToast.testkit";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { toast } from "sonner";
import { openNotification } from "./go";
import { notificationsStore, type NotificationEntry, type Plane } from "./store";

vi.mock("@/canvas/arrive", () => ({ arrive: vi.fn(() => true) }));
vi.mock("@/canvas/canvasFocus", () => ({ focusGroup: vi.fn(() => true) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const project = (id: string, name: string): Project => ({ id, name, path: `C:/${name}`, position: 0, lastOpenedAt: 0, workspaceCount: 1, missing: false, liveAgents: 0 });
const workspace = (id: string, projectId: string, name: string): Workspace => ({ id, projectId, name, position: 0, pantheon: null, kind: "canvas", folder: null });

const select = vi.fn();
const open = vi.fn(() => Promise.resolve());

/** A notification in the history, about `plane`. */
function noted(plane: Partial<Plane>): NotificationEntry {
  const entry: NotificationEntry = {
    id: "n1",
    at: 1,
    kind: "info",
    title: "Alan finished",
    read: false,
    plane: { projectId: "p1", workspaceId: "w1", nodeId: null, projectName: "Alpha", workspaceName: "Main", ...plane },
  };
  notificationsStore.setState({ entries: [entry] });
  return entry;
}
const isRead = () => notificationsStore.getState().entries[0].read;

beforeEach(() => {
  vi.mocked(arrive).mockClear().mockReturnValue(true);
  select.mockClear();
  open.mockClear();
  projectsStore.setState({ view: "project", activeId: "p1", projects: [project("p1", "Alpha"), project("p2", "Beta")], open } as never);
  workspacesStore.setState({ projectId: "p1", activeId: "w1", workspaces: [workspace("w1", "p1", "Main"), workspace("w2", "p1", "Second")], select } as never);
  nodesStore.setState({
    nodes: {
      alan: { workspaceId: "w2", kind: "terminal", payload: { name: "Alan" } },
      mine: { workspaceId: "w1", kind: "terminal", payload: { name: "Mine" } },
    },
  } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("a click on a notification", () => {
  it("reads it", async () => {
    await openNotification(noted({ workspaceId: "w1" }));
    expect(isRead()).toBe(true);
  });

  it("switches to the workspace it is about", async () => {
    await openNotification(noted({ workspaceId: "w2" }));
    expect(select).toHaveBeenCalledWith("w2");
    expect(arrive).not.toHaveBeenCalled();
  });

  it("centres on its node when the workspace is already on screen", async () => {
    await openNotification(noted({ workspaceId: "w1", nodeId: "mine" }));
    expect(arrive).toHaveBeenCalledWith("mine");
    expect(select).not.toHaveBeenCalled();
  });

  it("switches to the node's workspace, then centres on it once that canvas is on screen", async () => {
    await openNotification(noted({ workspaceId: "w2", nodeId: "alan" }));
    expect(select).toHaveBeenCalledWith("w2");
    expect(arrive).not.toHaveBeenCalled();
    completeArrival("w2");
    expect(arrive).toHaveBeenCalledWith("alan");
  });

  it("opens another project first, then reaches its workspace and node", async () => {
    nodesStore.setState({ nodes: { far: { workspaceId: "wb", kind: "terminal", payload: { name: "Far" } } } } as never);
    open.mockImplementationOnce(async () => {
      projectsStore.setState({ activeId: "p2" });
      workspacesStore.setState({ projectId: "p2", activeId: "wb", workspaces: [workspace("wb", "p2", "Elsewhere")] });
    });
    await openNotification(noted({ projectId: "p2", projectName: "Beta", workspaceId: "wb", nodeId: "far" }));
    expect(open).toHaveBeenCalledWith("p2");
    // Its canvas mounts a moment after the project opens: the node is reached when it does.
    completeArrival("wb");
    expect(arrive).toHaveBeenCalledWith("far");
    expect(isRead()).toBe(true);
  });

  it("opens the project again from the home screen, when it is the one that was open", async () => {
    projectsStore.setState({ view: "home" });
    await openNotification(noted({ workspaceId: "w2" }));
    expect(open).toHaveBeenCalledWith("p1");
  });

  it("only reads a notification whose node is gone, and goes to its workspace", async () => {
    await openNotification(noted({ workspaceId: "w2", nodeId: "closed-agent" }));
    expect(select).toHaveBeenCalledWith("w2");
    expect(arrive).not.toHaveBeenCalled();
    expect(isRead()).toBe(true);
  });

  it("only reads a notification whose workspace was closed: there is nowhere to go", async () => {
    await openNotification(noted({ workspaceId: "w-closed" }));
    expect(select).not.toHaveBeenCalled();
    expect(arrive).not.toHaveBeenCalled();
    expect(isRead()).toBe(true);
  });

  it("only reads a notification whose project was removed", async () => {
    await openNotification(noted({ projectId: "p9", workspaceId: "w9" }));
    expect(open).not.toHaveBeenCalled();
    expect(isRead()).toBe(true);
  });

  it("only reads a notification shown on the home screen, which has no plane", async () => {
    await openNotification(noted({ projectId: null, workspaceId: null }));
    expect(select).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(isRead()).toBe(true);
  });

  it("says so when the project will not open, and stays where it is", async () => {
    open.mockRejectedValueOnce(new Error("folder is gone"));
    await openNotification(noted({ projectId: "p2", workspaceId: "wb" }));
    expect(errorToasts(vi.mocked(toast.error)).map((t) => t.title)).toEqual(["Could not open Beta"]);
    expect(select).not.toHaveBeenCalled();
  });
});
