// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Workspace } from "@/ipc/db";
import { projectsStore, type Project } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { defaultLaunchOptions } from "./launchAgent";
import { folderName, launchFolderKey, launchFolderStore, MAX_RECENT_FOLDERS, pushRecent, readSaved, sameFolder } from "./launchFolder";

vi.mock("@excalidraw/excalidraw", () => ({}));

const project = (id: string, path: string): Project => ({ id, name: id, path, lastOpenedAt: 0, missing: false }) as Project;
const workspace = (id: string, projectId: string, folder: string | null = null, kind: Workspace["kind"] = "canvas"): Workspace => ({
  id,
  projectId,
  name: id,
  position: 0,
  pantheon: null,
  kind,
  folder,
});

let saved: Record<string, unknown>;
let writes: { key: string; value: unknown }[];
/** What the backend was told about the folders of workspaces. */
let folderWrites: { id: string; folder: string | null }[];

beforeEach(() => {
  saved = {};
  writes = [];
  folderWrites = [];
  mockIPC((cmd, args) => {
    const { key, value } = args as { key: string; value: unknown };
    if (cmd === "get_setting") return key in saved ? saved[key] : null;
    if (cmd === "set_setting") {
      writes.push({ key, value });
      saved[key] = value;
    }
    if (cmd === "set_workspace_folder") folderWrites.push(args as { id: string; folder: string | null });
  });
  projectsStore.setState({ projects: [project("p1", "D:\\code\\api"), project("p2", "D:\\code\\web")], activeId: null });
  workspacesStore.setState({ projectId: "p1", workspaces: [workspace("w1", "p1"), workspace("w2", "p1")], activeId: "w1", status: "ready" });
  launchFolderStore.setState({ projectId: null, recent: [], loaded: false });
});
afterEach(() => clearMocks());

/** Lets the project's saved list be read and what it started be written. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** The project becomes the active one, which is what loads its list; loaded again by hand when it already was. */
const open = async (id: string) => {
  projectsStore.setState({ activeId: id });
  await launchFolderStore.getState().load(id);
  await settle();
};
const folderOf = (id: string) => workspacesStore.getState().workspaces.find((w) => w.id === id)?.folder;

describe("folders", () => {
  it("tells the same folder apart from another, whatever its case, separator or trailing one", () => {
    expect(sameFolder("D:\\Code\\API\\", "d:/code/api")).toBe(true);
    expect(sameFolder("D:\\code\\api", "D:\\code\\web")).toBe(false);
  });

  it("names a folder by its last segment", () => {
    expect(folderName("D:\\code\\api")).toBe("api");
    expect(folderName("/home/me/web/")).toBe("web");
  });

  it("puts the folder first, once, and keeps the list short", () => {
    expect(pushRecent(["a", "b"], "B")).toEqual(["B", "a"]);
    expect(pushRecent(["a"], "  ")).toEqual(["a"]);
    const full = Array.from({ length: MAX_RECENT_FOLDERS }, (_, i) => `d:/f${i}`);
    expect(pushRecent(full, "d:/new")).toEqual(["d:/new", ...full.slice(0, MAX_RECENT_FOLDERS - 1)]);
  });

  it("reads what was saved, and nothing from what is unreadable", () => {
    expect(readSaved({ folder: "D:\\x", recent: ["D:\\x", "D:\\y", "D:\\x", 3, ""] })).toEqual({ folder: "D:\\x", recent: ["D:\\x", "D:\\y"] });
    for (const raw of [null, undefined, 4, "x", { folder: 3, recent: "no" }]) expect(readSaved(raw)).toEqual({ folder: null, recent: [] });
  });
});

describe("the launch folder of a workspace", () => {
  it("is the project's own until another one is chosen", async () => {
    await open("p1");
    expect(defaultLaunchOptions().cwd).toBe("D:\\code\\api");
  });

  it("holds for every launch of that workspace, Fleet sessions and installs included, and is saved in the database", async () => {
    await open("p1");
    await launchFolderStore.getState().choose("D:\\other\\lib");
    expect(folderOf("w1")).toBe("D:\\other\\lib");
    expect(defaultLaunchOptions().cwd).toBe("D:\\other\\lib");
    expect(defaultLaunchOptions("w1").cwd).toBe("D:\\other\\lib");
    expect(folderWrites).toEqual([{ id: "w1", folder: "D:\\other\\lib" }]);
    await settle();
    // The list of recent folders stays the project's, in the settings.
    expect(writes).toEqual([{ key: launchFolderKey("p1"), value: { recent: ["D:\\other\\lib"] } }]);
  });

  it("is the workspace's own: another workspace of the project keeps the project's folder", async () => {
    await open("p1");
    await launchFolderStore.getState().choose("D:\\other\\lib");
    expect(defaultLaunchOptions("w2").cwd).toBe("D:\\code\\api");
    workspacesStore.setState({ activeId: "w2" });
    expect(defaultLaunchOptions().cwd).toBe("D:\\code\\api");
    workspacesStore.setState({ activeId: "w1" });
    expect(defaultLaunchOptions().cwd).toBe("D:\\other\\lib");
  });

  it("can be set on a workspace that is not the active one, as the tab's menu does", async () => {
    await open("p1");
    await launchFolderStore.getState().choose("D:\\elsewhere", "w2");
    expect(folderOf("w1")).toBeNull();
    expect(folderOf("w2")).toBe("D:\\elsewhere");
    expect(defaultLaunchOptions("w2").cwd).toBe("D:\\elsewhere");
    expect(defaultLaunchOptions().cwd).toBe("D:\\code\\api");
  });

  it("goes back to the project folder, which clears the workspace's", async () => {
    await open("p1");
    await launchFolderStore.getState().choose("D:\\one");
    await launchFolderStore.getState().useProjectFolder();
    expect(folderOf("w1")).toBeNull();
    expect(defaultLaunchOptions().cwd).toBe("D:\\code\\api");
    expect(folderWrites[folderWrites.length - 1]).toEqual({ id: "w1", folder: null });
  });

  it("is not a choice when the folder picked is the project's own", async () => {
    await open("p1");
    await launchFolderStore.getState().choose("D:\\one");
    await launchFolderStore.getState().choose("d:/code/api/");
    expect(folderOf("w1")).toBeNull();
    expect(launchFolderStore.getState().recent).toEqual(["D:\\one"]);
  });

  it("follows the project's folder when the project is moved", async () => {
    await open("p1");
    projectsStore.setState({ projects: [project("p1", "E:\\moved\\api"), project("p2", "D:\\code\\web")] });
    expect(defaultLaunchOptions().cwd).toBe("E:\\moved\\api");
    // A workspace with a folder of its own does not move with it.
    await launchFolderStore.getState().choose("D:\\mine");
    projectsStore.setState({ projects: [project("p1", "F:\\again\\api"), project("p2", "D:\\code\\web")] });
    expect(defaultLaunchOptions().cwd).toBe("D:\\mine");
  });

  it("puts the old folder back and rejects when the save is refused", async () => {
    await open("p1");
    await launchFolderStore.getState().choose("D:\\one");
    mockIPC((cmd) => {
      if (cmd === "set_workspace_folder") throw { kind: "db", message: "database is locked" };
    });
    await expect(launchFolderStore.getState().choose("D:\\two")).rejects.toBeDefined();
    expect(folderOf("w1")).toBe("D:\\one");
    expect(defaultLaunchOptions().cwd).toBe("D:\\one");
  });

  it("leaves the code workspace on the project: nothing to choose there", async () => {
    await open("p1");
    workspacesStore.setState({ workspaces: [workspace("c1", "p1", null, "code"), workspace("w1", "p1")], activeId: "c1" });
    await launchFolderStore.getState().choose("D:\\one");
    expect(folderWrites).toEqual([]);
    expect(defaultLaunchOptions().cwd).toBe("D:\\code\\api");
  });

  it("comes back after a restart: the folder from the workspace, the recent ones from the settings", async () => {
    await open("p1");
    await launchFolderStore.getState().choose("D:\\one");
    await launchFolderStore.getState().choose("D:\\two");
    await settle();
    // A new session: the database hands the workspace back with its folder; only the settings list was saved.
    workspacesStore.setState({ workspaces: [workspace("w1", "p1", "D:\\two"), workspace("w2", "p1")] });
    launchFolderStore.setState({ projectId: null, recent: [], loaded: false });
    await open("p1");
    expect(defaultLaunchOptions().cwd).toBe("D:\\two");
    expect(launchFolderStore.getState().recent).toEqual(["D:\\two", "D:\\one"]);
  });

  it("offers a folder used once again, without making it the next launches' folder", async () => {
    await open("p1");
    launchFolderStore.getState().remember("D:\\once");
    expect(folderOf("w1")).toBeNull();
    expect(defaultLaunchOptions().cwd).toBe("D:\\code\\api");
    expect(launchFolderStore.getState().recent).toEqual(["D:\\once"]);
    await settle();
    expect(writes[writes.length - 1]).toEqual({ key: launchFolderKey("p1"), value: { recent: ["D:\\once"] } });
  });

  it("keeps the recent folders of each project to that project", async () => {
    saved[launchFolderKey("p2")] = { recent: ["D:\\p2-folder"] };
    await open("p1");
    await launchFolderStore.getState().choose("D:\\p1-folder");
    await settle();
    projectsStore.setState({ activeId: "p2" });
    await settle();
    expect(launchFolderStore.getState().recent).toEqual(["D:\\p2-folder"]);
    projectsStore.setState({ activeId: "p1" });
    await settle();
    expect(launchFolderStore.getState().recent).toEqual(["D:\\p1-folder"]);
  });
});

describe("the project-wide launch folder an earlier version saved", () => {
  it("goes to the active workspace once, and is dropped from the saved list", async () => {
    saved[launchFolderKey("p1")] = { folder: "D:\\old", recent: ["D:\\old"] };
    await open("p1");
    await settle();
    expect(folderOf("w1")).toBe("D:\\old");
    expect(folderOf("w2")).toBeNull();
    expect(folderWrites).toEqual([{ id: "w1", folder: "D:\\old" }]);
    expect(saved[launchFolderKey("p1")]).toEqual({ recent: ["D:\\old"] });
  });

  it("waits for the workspaces of the project to be loaded", async () => {
    saved[launchFolderKey("p1")] = { folder: "D:\\old", recent: [] };
    workspacesStore.setState({ projectId: null, workspaces: [], activeId: null, status: "loading" });
    await open("p1");
    expect(folderWrites).toEqual([]);
    // Still saved with the folder: nothing was lost while it waited.
    expect(saved[launchFolderKey("p1")]).toEqual({ folder: "D:\\old", recent: [] });
    workspacesStore.setState({ projectId: "p1", workspaces: [workspace("w1", "p1")], activeId: "w1", status: "ready" });
    await settle();
    expect(folderOf("w1")).toBe("D:\\old");
    expect(saved[launchFolderKey("p1")]).toEqual({ recent: [] });
  });

  it("leaves a workspace that already has a folder alone", async () => {
    saved[launchFolderKey("p1")] = { folder: "D:\\old", recent: [] };
    workspacesStore.setState({ workspaces: [workspace("w1", "p1", "D:\\mine"), workspace("w2", "p1")] });
    await open("p1");
    await settle();
    expect(folderOf("w1")).toBe("D:\\mine");
    expect(folderWrites).toEqual([]);
    expect(saved[launchFolderKey("p1")]).toEqual({ recent: [] });
  });

  it("is kept for next time when the workspace could not take it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    saved[launchFolderKey("p1")] = { folder: "D:\\old", recent: [] };
    mockIPC((cmd, args) => {
      const { key } = args as { key: string };
      if (cmd === "get_setting") return key in saved ? saved[key] : null;
      if (cmd === "set_setting") saved[key] = (args as { value: unknown }).value;
      if (cmd === "set_workspace_folder") throw { kind: "db", message: "database is locked" };
    });
    await open("p1");
    await settle();
    expect(folderOf("w1")).toBeNull();
    expect(saved[launchFolderKey("p1")]).toEqual({ folder: "D:\\old", recent: [] });
    warn.mockRestore();
  });
});

describe("a recent folder used before the saved list is read", () => {
  it("stays at the head of it, and is saved with the saved recent folders", async () => {
    saved[launchFolderKey("p1")] = { recent: ["D:\\old"] };
    projectsStore.setState({ activeId: "p1" });
    const loading = launchFolderStore.getState().load("p1");
    await launchFolderStore.getState().choose("D:\\new");
    await loading;
    expect(launchFolderStore.getState().recent).toEqual(["D:\\new", "D:\\old"]);
    await settle();
    expect(writes[writes.length - 1]).toEqual({ key: launchFolderKey("p1"), value: { recent: ["D:\\new", "D:\\old"] } });
  });

  it("saves nothing over a list it could not read, but the folder still holds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockIPC((cmd, args) => {
      if (cmd === "get_setting") throw { kind: "db", message: "database is locked" };
      if (cmd === "set_setting") writes.push(args as { key: string; value: unknown });
    });
    projectsStore.setState({ activeId: "p1" });
    await launchFolderStore.getState().load("p1");
    await launchFolderStore.getState().choose("D:\\mine");
    expect(defaultLaunchOptions().cwd).toBe("D:\\mine");
    await settle();
    expect(writes).toEqual([]);
    warn.mockRestore();
  });
});
