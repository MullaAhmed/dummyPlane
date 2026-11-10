// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Workspace } from "@/ipc/db";
import { canRemove, createWorkspacesStore, nextDefaultName, rebaseWorkspaceFolders, workspacesStore } from "./workspaces";

/** In-memory stand-in for the Rust workspace commands of project "p1". */
function fakeBackend(initial: string[] = [], activeSetting: string | null = null) {
  let counter = 0;
  const make = (name: string, position: number, kind: Workspace["kind"] = "canvas"): Workspace => ({
    id: `w${++counter}`,
    projectId: "p1",
    name,
    position,
    pantheon: null,
    kind,
    folder: null,
  });
  const db = {
    workspaces: initial.map((name, i) => make(name, i)),
    settings: new Map<string, unknown>(activeSetting ? [["ui.activeWorkspaceId.p1", activeSetting]] : []),
    /** The next saves of a folder are refused. */
    folderFails: false,
  };
  mockIPC((cmd, raw) => {
    const args = raw as Record<string, string>;
    switch (cmd) {
      case "list_workspaces":
        return db.workspaces.filter((w) => w.projectId === args.projectId).map((w) => ({ ...w }));
      case "create_workspace": {
        // One code workspace per project: the backend hands back the existing one.
        const existing = args.kind === "code" && db.workspaces.find((w) => w.kind === "code");
        if (existing) return existing;
        const w = make(args.name, db.workspaces.length, (args.kind as Workspace["kind"]) ?? "canvas");
        db.workspaces.push(w);
        return w;
      }
      case "rename_workspace":
        db.workspaces = db.workspaces.map((w) => (w.id === args.id ? { ...w, name: args.name } : w));
        return;
      case "delete_workspace":
        db.workspaces = db.workspaces.filter((w) => w.id !== args.id);
        return;
      case "set_workspace_folder":
        if (db.folderFails) throw { kind: "db", message: "database is locked" };
        db.workspaces = db.workspaces.map((w) => (w.id === args.id ? { ...w, folder: args.folder } : w));
        return;
      case "set_workspace_pantheon":
        db.workspaces = db.workspaces.map((w) => (w.id === args.id ? { ...w, pantheon: args.pantheon } : w));
        return;
      case "get_setting":
        return db.settings.get(args.key) ?? null;
      case "set_setting":
        db.settings.set(args.key, (raw as { value: unknown }).value);
        return;
    }
  });
  return db;
}

let store: ReturnType<typeof createWorkspacesStore>;
const state = () => store.getState();
const names = () => state().workspaces.map((w) => w.name);
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  store = createWorkspacesStore();
});
afterEach(() => clearMocks());

describe("nextDefaultName", () => {
  it("uses the smallest free number", () => {
    const ws = (...n: string[]) =>
      n.map((name, i) => ({ id: String(i), projectId: "p1", name, position: i, pantheon: null, kind: "canvas" as const, folder: null }));
    expect(nextDefaultName([])).toBe("Workspace 1");
    expect(nextDefaultName(ws("Workspace 2"))).toBe("Workspace 1");
    expect(nextDefaultName(ws("Workspace 1", "Workspace 2"))).toBe("Workspace 3");
  });
});

describe("workspaces store", () => {
  it("creates a first workspace when a project has none", async () => {
    const db = fakeBackend();
    await state().load("p1");
    expect(names()).toEqual(["Workspace 1"]);
    expect(db.workspaces).toHaveLength(1);
    expect(state().status).toBe("ready");
    expect(state().projectId).toBe("p1");
  });

  it("reopens the workspace that was active last time in this project", async () => {
    fakeBackend(["A", "B"], "w2");
    await state().load("p1");
    expect(state().activeId).toBe("w2");
  });

  it("falls back to the first workspace when the saved one is gone", async () => {
    fakeBackend(["A"], "deleted");
    await state().load("p1");
    expect(state().activeId).toBe("w1");
  });

  it("creates a workspace in the project, makes it active and remembers it", async () => {
    const db = fakeBackend(["Workspace 1"]);
    await state().load("p1");
    await state().create();
    await settled();
    expect(names()).toEqual(["Workspace 1", "Workspace 2"]);
    expect(db.workspaces[1].projectId).toBe("p1");
    expect(db.settings.get("ui.activeWorkspaceId.p1")).toBe(state().activeId);
  });

  it("renames with trimming and ignores blank names", async () => {
    const db = fakeBackend(["A"]);
    await state().load("p1");
    await state().rename("w1", "  Front  ");
    await state().rename("w1", "   ");
    expect(names()).toEqual(["Front"]);
    expect(db.workspaces[0].name).toBe("Front");
  });

  it("refuses a name another workspace of the project already has, case aside", async () => {
    const db = fakeBackend(["A", "Front"]);
    await state().load("p1");
    await expect(state().rename("w1", " front ")).rejects.toThrow("front");
    expect(names()).toEqual(["A", "Front"]);
    expect(db.workspaces[0].name).toBe("A");
    await state().rename("w2", "FRONT");
    expect(names()).toEqual(["A", "FRONT"]);
  });

  it("moves a tab to a place, and remembers the order for the next start", async () => {
    const db = fakeBackend(["A", "B", "C"]);
    await state().load("p1");
    await state().move("w3", 0);
    expect(names()).toEqual(["C", "A", "B"]);
    expect(db.settings.get("ui.workspaceOrder.p1")).toEqual(["w3", "w1", "w2"]);
    await state().move("w3", 99);
    expect(names()).toEqual(["A", "B", "C"]);
    store = createWorkspacesStore();
    await state().load("p1");
    expect(names()).toEqual(["A", "B", "C"]);
    await state().move("w2", 0);
    store = createWorkspacesStore();
    await state().load("p1");
    expect(names()).toEqual(["B", "A", "C"]);
  });

  it("never removes the last workspace", async () => {
    const db = fakeBackend(["A"]);
    await state().load("p1");
    await state().remove("w1");
    expect(names()).toEqual(["A"]);
    expect(db.workspaces).toHaveLength(1);
  });

  it("selects the next workspace when the active one is removed, or the previous when it was last", async () => {
    fakeBackend(["A", "B", "C"]);
    await state().load("p1");
    state().select("w2");
    await state().remove("w2");
    expect(state().activeId).toBe("w3");
    await state().remove("w3");
    expect(state().activeId).toBe("w1");
  });

  it("saves the pantheon of a workspace", async () => {
    const db = fakeBackend(["A"]);
    await state().load("p1");
    await state().setPantheon("w1", "marvel");
    expect(state().workspaces[0].pantheon).toBe("marvel");
    expect(db.workspaces[0].pantheon).toBe("marvel");
  });

  it("chooses the pantheon of a workspace once", async () => {
    const db = fakeBackend(["A"]);
    await state().load("p1");
    expect(await state().ensurePantheon("w1")).toBe("dc");
    expect(await state().ensurePantheon("w1")).toBe("dc");
    expect(db.workspaces[0].pantheon).toBe("dc");
  });

  it("gives the agents outside groups a pantheon no group uses", async () => {
    const db = fakeBackend(["A"]);
    await state().load("p1");
    expect(await state().ensurePantheon("w1", ["dc", "marvel"])).toBe("throne-of-glass");
    expect(db.workspaces[0].pantheon).toBe("throne-of-glass");
  });

  it("gives a new workspace the project's folder, and reads a workspace without one the same way", async () => {
    const db = fakeBackend(["A"]);
    delete (db.workspaces[0] as Partial<Workspace>).folder;
    await state().load("p1");
    await state().create();
    expect(state().workspaces.map((w) => w.folder)).toEqual([null, null]);
  });

  it("saves the folder of a workspace, and clears it with null", async () => {
    const db = fakeBackend(["A", "B"]);
    await state().load("p1");
    await state().setFolder("w1", "  D:/work/api  ");
    expect(state().workspaces.map((w) => w.folder)).toEqual(["D:/work/api", null]);
    expect(db.workspaces[0].folder).toBe("D:/work/api");
    await state().setFolder("w1", null);
    expect(state().workspaces[0].folder).toBeNull();
    expect(db.workspaces[0].folder).toBeNull();
    // A blank folder is no folder.
    await state().setFolder("w1", "D:/work/api");
    await state().setFolder("w1", "   ");
    expect(db.workspaces[0].folder).toBeNull();
  });

  it("changes the folder before the save comes back, and puts the old one back when it is refused", async () => {
    const db = fakeBackend(["A"]);
    await state().load("p1");
    await state().setFolder("w1", "D:/one");
    db.folderFails = true;
    const saving = state().setFolder("w1", "D:/two");
    expect(state().workspaces[0].folder).toBe("D:/two");
    await expect(saving).rejects.toBeDefined();
    expect(state().workspaces[0].folder).toBe("D:/one");
    expect(db.workspaces[0].folder).toBe("D:/one");
  });

  it("reads a workspace without a kind as a canvas", async () => {
    const db = fakeBackend(["A"]);
    delete (db.workspaces[0] as Partial<Workspace>).kind;
    await state().load("p1");
    expect(state().workspaces[0].kind).toBe("canvas");
  });

  it("creates the code workspace once and selects it", async () => {
    const db = fakeBackend(["A"]);
    await state().load("p1");
    const first = await state().openCode();
    expect(state().activeId).toBe(first);
    expect(state().workspaces.find((w) => w.id === first)?.kind).toBe("code");
    state().select("w1");
    expect(await state().openCode()).toBe(first);
    expect(db.workspaces.filter((w) => w.kind === "code")).toHaveLength(1);
    expect(state().workspaces).toHaveLength(2);
  });

  it("remembers the last canvas on screen through the code workspace", async () => {
    fakeBackend(["A", "B"]);
    await state().load("p1");
    state().select("w2");
    await state().openCode();
    expect(state().lastCanvasId).toBe("w2");
  });

  it("gives a project a canvas when it has only its code workspace", async () => {
    const db = fakeBackend();
    db.workspaces.push({ id: "c1", projectId: "p1", name: "Code", position: 0, pantheon: null, kind: "code", folder: null });
    await state().load("p1");
    expect(state().workspaces.map((w) => w.kind)).toEqual(["canvas", "code"]);
  });

  it("may remove the code workspace but never the last canvas", async () => {
    fakeBackend(["A"]);
    await state().load("p1");
    const code = await state().openCode();
    const [canvas, codeWorkspace] = state().workspaces;
    expect(canRemove(state().workspaces, canvas)).toBe(false);
    expect(canRemove(state().workspaces, codeWorkspace)).toBe(true);
    await state().remove("w1");
    expect(state().workspaces).toHaveLength(2);
    await state().remove(code!);
    expect(names()).toEqual(["A"]);
    expect(state().activeId).toBe("w1");
  });

  it("reports a backend failure", async () => {
    mockIPC(() => {
      throw { kind: "db", message: "disk I/O error" };
    });
    await state().load("p1");
    expect(state().status).toBe("error");
    expect(state().error).toContain("disk I/O error");
  });
});

describe("rebaseWorkspaceFolders", () => {
  const workspace = (id: string, folder: string | null): Workspace => ({ id, projectId: "p1", name: id, position: 0, pantheon: null, kind: "canvas", folder });
  const open = (projectId: string | null, folders: (string | null)[]) =>
    workspacesStore.setState({ projectId, workspaces: folders.map((folder, i) => workspace(`w${i}`, folder)) });
  const folders = () => workspacesStore.getState().workspaces.map((w) => w.folder);
  afterEach(() => workspacesStore.setState({ projectId: null, workspaces: [] }));

  it("moves the own folder of the open project's workspaces that lay inside the old folder, and no other", () => {
    open("p1", ["C:\\code\\api", "c:/code/API/web", "E:\\docs", "C:\\code\\apis", null]);
    rebaseWorkspaceFolders("p1", "C:\\code\\api", "D:\\api");
    expect(folders()).toEqual(["D:\\api", "D:\\api\\web", "E:\\docs", "C:\\code\\apis", null]);
  });

  it("leaves the workspaces in memory alone when they are another project's", () => {
    open("p2", ["C:\\code\\api\\web"]);
    rebaseWorkspaceFolders("p1", "C:\\code\\api", "D:\\api");
    expect(folders()).toEqual(["C:\\code\\api\\web"]);
  });

  it("does not touch the store when nothing moves", () => {
    open("p1", [null, "E:\\docs"]);
    const before = workspacesStore.getState().workspaces;
    rebaseWorkspaceFolders("p1", "C:\\code\\api", "D:\\api");
    expect(workspacesStore.getState().workspaces).toBe(before);
  });
});
