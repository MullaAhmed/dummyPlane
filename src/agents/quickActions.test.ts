// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { open as pickDirectory } from "@tauri-apps/plugin-dialog";
import { canvasStore, EMPTY_VIEW } from "@/canvas/canvasStore";
import { projectsStore, type Project } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { agentsStore } from "./agentsStore";
import { launchFolderStore } from "./launchFolder";
import { launchAt, newConsole, newTerminalInFolder } from "./quickActions";
import { addTerminal } from "./terminals";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/fleet/fleets", () => ({ addFleet: vi.fn(() => Promise.resolve()) }));
vi.mock("./naming", async (importOriginal) => ({ ...(await importOriginal<typeof import("./naming")>()), nameForNewAgent: vi.fn(() => Promise.resolve("Batman")) }));
vi.mock("./terminals", async (importOriginal) => ({ ...(await importOriginal<typeof import("./terminals")>()), addTerminal: vi.fn(() => Promise.resolve("node")) }));

const project = { id: "p1", name: "api", path: "D:\\code\\api", lastOpenedAt: 0, missing: false } as Project;
/** The launch of a terminal is not awaited by `launchAt`: lets it reach `addTerminal`. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** What the last terminal added was given: its payload, and where. */
const added = () => {
  const [, payload, center] = vi.mocked(addTerminal).mock.lastCall!;
  return { payload, center };
};

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.mocked(addTerminal).mockClear();
  vi.mocked(pickDirectory).mockReset();
  canvasStore.setState({ view: { ...EMPTY_VIEW, width: 1000, height: 800 }, frames: [] });
  workspacesStore.setState({
    projectId: "p1",
    workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder: null }],
    activeId: "w1",
    status: "ready",
  });
  agentsStore.setState({ loaded: true, shells: [], agents: [{ id: "claude", available: true }, { id: "shell", available: true }] } as never);
  projectsStore.setState({ projects: [project], activeId: "p1" });
  await settle();
  launchFolderStore.setState({ projectId: "p1", recent: [], loaded: true });
});
afterEach(() => {
  projectsStore.setState({ projects: [], activeId: null });
  clearMocks();
});

describe("a launch the user asks for", () => {
  it("starts in the project folder until the workspace picks another one", async () => {
    launchAt("claude");
    await settle();
    expect(added().payload).toMatchObject({ cwd: "D:\\code\\api", title: "Claude · api" });
  });

  it("starts in the workspace's folder once chosen, titled by its last segment", async () => {
    await launchFolderStore.getState().choose("D:\\work\\lib");
    launchAt("claude", { x: 10, y: 20 });
    await settle();
    expect(added()).toMatchObject({ payload: { agent: "claude", cwd: "D:\\work\\lib", title: "Claude · lib" }, center: { x: 10, y: 20 } });
  });

  it("is what New console does too, with the default agent", async () => {
    await launchFolderStore.getState().choose("D:\\work\\lib");
    await newConsole();
    await settle();
    expect(added().payload).toMatchObject({ agent: "claude", cwd: "D:\\work\\lib" });
  });

  it("takes the options it is given over the launch folder", async () => {
    await launchFolderStore.getState().choose("D:\\work\\lib");
    launchAt("shell", undefined, { cwd: "D:\\elsewhere", shell: "default", title: "", command: "" });
    await settle();
    expect(added().payload).toMatchObject({ cwd: "D:\\elsewhere", title: "Shell · elsewhere" });
  });
});

describe("New terminal in folder…", () => {
  it("asks for a folder, opened on the one in force, then starts the default agent there", async () => {
    vi.mocked(pickDirectory).mockResolvedValueOnce("D:\\other\\tool");
    await newTerminalInFolder({ x: 3, y: 4 });
    await settle();
    expect(pickDirectory).toHaveBeenCalledWith(expect.objectContaining({ directory: true, defaultPath: "D:\\code\\api" }));
    expect(added()).toMatchObject({ payload: { agent: "claude", cwd: "D:\\other\\tool", title: "Claude · tool" }, center: { x: 3, y: 4 } });
  });

  it("is a one-off: the folder is offered again, the next launches stay where they were", async () => {
    vi.mocked(pickDirectory).mockResolvedValueOnce("D:\\other\\tool");
    await newTerminalInFolder();
    await settle();
    expect(launchFolderStore.getState().recent).toEqual(["D:\\other\\tool"]);
    expect(workspacesStore.getState().workspaces[0].folder).toBeNull();
    launchAt("claude");
    await settle();
    expect(added().payload).toMatchObject({ cwd: "D:\\code\\api" });
  });

  it("opens the picker on the launch folder when one was chosen", async () => {
    await launchFolderStore.getState().choose("D:\\work\\lib");
    vi.mocked(pickDirectory).mockResolvedValueOnce(null);
    await newTerminalInFolder();
    expect(pickDirectory).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "D:\\work\\lib" }));
  });

  it("starts nothing when the picker is cancelled", async () => {
    vi.mocked(pickDirectory).mockResolvedValueOnce(null);
    await newTerminalInFolder();
    await settle();
    expect(addTerminal).not.toHaveBeenCalled();
    expect(launchFolderStore.getState().recent).toEqual([]);
  });
});
