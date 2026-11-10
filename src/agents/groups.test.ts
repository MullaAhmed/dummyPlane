// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canvasStore } from "@/canvas/canvasStore";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { projectsStore, type Project } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { toast } from "sonner";
import { cachedElements, forgetScene, rememberScene } from "@/canvas/sceneCache";
import { startUnseen } from "@/nodes/terminal/registry";
import { addAgentToGroup, closeGroup, closeStoredGroup, launchGroup, setGroupFolded, setGroupPantheon, setGroupSpeciality, showGroups } from "./groups";
import { announceArrival, quietly } from "./arrivals";
import { launchFolderStore } from "./launchFolder";
import { addTerminal, removeFromStoredScene } from "./terminals";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "i" }, newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/nodes/terminal/registry", () => ({ markForAutostart: vi.fn(), startUnseen: vi.fn(), disposeTerminal: vi.fn() }));
vi.mock("./arrivals", async (importOriginal) => ({ ...(await importOriginal<typeof import("./arrivals")>()), announceArrival: vi.fn() }));
vi.mock("./naming", async (importOriginal) => ({ ...(await importOriginal<typeof import("./naming")>()), nameForNewAgent: vi.fn(() => Promise.resolve("Isis")) }));
vi.mock("./terminals", async (importOriginal) => ({ ...(await importOriginal<typeof import("./terminals")>()), addTerminal: vi.fn(() => Promise.resolve()) }));

interface Element {
  id: string;
  type: string;
  isDeleted?: boolean;
  frameId?: string | null;
  customData?: Record<string, unknown>;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
}
let scene: Element[] = [];
beforeEach(() => {
  mockIPC(() => undefined);
  scene = [];
  projectsStore.setState({ projects: [], activeId: null });
  const api = {
    getSceneElements: () => scene,
    getSceneElementsIncludingDeleted: () => scene,
    updateScene: ({ elements }: { elements?: typeof scene }) => {
      if (elements) scene = elements;
    },
    getAppState: vi.fn(() => ({ width: 1400, height: 800 })),
    scrollToContent: vi.fn(),
  };
  canvasStore.setState({ api: api as unknown as ExcalidrawImperativeAPI });
  workspacesStore.setState({ activeId: "w1" });
});

it("staffs a mission's group with the names, folders and pantheon it is given, and says what it made", async () => {
  const made = await launchGroup(
    { name: "Mission Auth", role: "general", agents: ["claude", "claude"] },
    { cwd: "C:/code", shell: "default", title: "", command: "" },
    { x: 0, y: 0 },
    { pantheon: "egyptian", names: ["Isis", "Horus"], cwds: ["C:/w/auth-isis", "C:/w/auth-horus"] },
  );
  const frame = scene.find((e) => e.type === "frame");
  expect(made?.frameId).toBe(frame?.id);
  expect(made!.nodeIds.map((id) => [terminalOf(nodesStore.getState().nodes[id])?.name, terminalOf(nodesStore.getState().nodes[id])?.cwd])).toEqual([
    ["Isis", "C:/w/auth-isis"],
    ["Horus", "C:/w/auth-horus"],
  ]);
  expect(frame?.customData?.dummyplane).toMatchObject({ kind: "group", pantheon: "egyptian" });
});

it("sets a group's speciality as one undoable step, and leaves other frames alone (spec groupes spécialisés §2)", () => {
  const data = { kind: "group", role: "general", pantheon: "egyptian" };
  scene = [
    { id: "f1", type: "frame", customData: { dummyplane: data } },
    { id: "f2", type: "frame", customData: { dummyplane: data } },
    { id: "plain", type: "frame" },
  ];
  setGroupSpeciality("f1", "Frontend");
  expect(scene[0].customData?.dummyplane).toEqual({ ...data, speciality: "Frontend" });
  expect(scene[1].customData?.dummyplane).toEqual(data);
  setGroupSpeciality("plain", "Frontend");
  expect(scene[2].customData).toBeUndefined();
  setGroupSpeciality("f1", "");
  expect(scene[0].customData?.dummyplane).toEqual(data);
});

it("names the agents of a group from the pantheon it is composed with", async () => {
  const made = await launchGroup(
    { name: "Team", role: "general", agents: ["claude", "claude"], pantheon: "star-wars" },
    { cwd: "C:/code", shell: "default", title: "", command: "" },
    { x: 0, y: 0 },
  );
  const frame = scene.find((e) => e.type === "frame");
  expect(frame?.customData?.dummyplane).toMatchObject({ kind: "group", pantheon: "star-wars" });
  expect(made!.nodeIds.map((id) => terminalOf(nodesStore.getState().nodes[id])?.name)).toEqual(["Luke", "Leia"]);
});

it("changes a group's pantheon as one undoable step, and leaves other frames alone", () => {
  const data = { kind: "group", role: "general", pantheon: "dc", speciality: "API" };
  scene = [
    { id: "f1", type: "frame", customData: { dummyplane: data } },
    { id: "f2", type: "frame", customData: { dummyplane: data } },
    { id: "plain", type: "frame" },
  ];
  setGroupPantheon("f1", "marvel");
  expect(scene[0].customData?.dummyplane).toEqual({ ...data, pantheon: "marvel" });
  expect(scene[1].customData?.dummyplane).toEqual(data);
  setGroupPantheon("plain", "marvel");
  expect(scene[2].customData).toBeUndefined();
});

it("frames the groups it is given, and does nothing without one", () => {
  scene = [{ id: "f1", type: "frame" }, { id: "f2", type: "frame" }, { id: "t1", type: "embeddable" }];
  const scroll = vi.mocked(canvasStore.getState().api!.scrollToContent);
  showGroups([]);
  expect(scroll).not.toHaveBeenCalled();
  showGroups(["f1", "f2", "gone"]);
  expect(scroll.mock.calls[0][0]).toEqual([scene[0], scene[1]]);
});

it("shows a group too wide to read whole once, for all its agents to start, then frames its first terminals (review)", async () => {
  const api = canvasStore.getState().api!;
  vi.mocked(api.getAppState).mockReturnValue({ width: 1440, height: 900 } as never);
  const made = await launchGroup(
    { name: "Mission Auth", role: "general", agents: ["claude", "claude", "claude", "claude"] },
    { cwd: "C:/code", shell: "default", title: "", command: "" },
    { x: 0, y: 0 },
    { pantheon: "egyptian", names: ["Isis", "Horus", "Thoth", "Anubis"], cwds: ["C:/a", "C:/b", "C:/c", "C:/d"] },
  );
  const scroll = vi.mocked(api.scrollToContent);
  await vi.waitFor(() => expect(scroll.mock.calls.length).toBeGreaterThan(1));
  const first = scroll.mock.calls[0][0] as unknown as { id: string }[];
  expect(first.map((e) => e.id)).toEqual([made!.frameId]);
  const last = scroll.mock.calls[scroll.mock.calls.length - 1][0] as unknown as { id: string }[];
  expect(last.map((e) => e.id)).toEqual(made!.nodeIds.slice(0, last.length));
  expect(last.length).toBeLessThan(4);
});

describe("a group that arrives on its own (nobody asked for it)", () => {
  const staffing = { pantheon: "egyptian", names: ["Isis", "Horus"], cwds: ["C:/a", "C:/b"] };
  const options = { cwd: "C:/code", shell: "default" as const, title: "", command: "" };

  beforeEach(() => {
    vi.mocked(startUnseen).mockClear();
    vi.mocked(announceArrival).mockClear();
  });

  it("leaves the view alone, starts its agents where they are, and tells of them in one notice", async () => {
    const api = canvasStore.getState().api!;
    vi.mocked(api.scrollToContent).mockClear();
    const made = await launchGroup({ name: "Mission Auth", role: "general", agents: ["claude", "claude"] }, options, { x: 0, y: 0 }, staffing, quietly("mission"));
    expect(made?.nodeIds).toHaveLength(2);
    expect(api.scrollToContent).not.toHaveBeenCalled();
    // After the wait Excalidraw is given to mount what is in sight and start it, sized.
    await vi.waitFor(() => expect(startUnseen).toHaveBeenCalledTimes(2));
    expect(startUnseen).toHaveBeenCalledWith(made!.nodeIds[0], expect.objectContaining({ name: "Isis" }));
    expect(announceArrival).toHaveBeenCalledWith("w1", "mission", [
      { nodeId: made!.nodeIds[0], name: "Isis" },
      { nodeId: made!.nodeIds[1], name: "Horus" },
    ]);
  });

  it("is shown whole when the user launched it, as before: the canvas starts the agents, nothing is announced", async () => {
    const api = canvasStore.getState().api!;
    vi.mocked(api.scrollToContent).mockClear();
    await launchGroup({ name: "Team", role: "general", agents: ["claude", "claude"] }, options, { x: 0, y: 0 });
    expect(api.scrollToContent).toHaveBeenCalled();
    expect(startUnseen).not.toHaveBeenCalled();
    expect(announceArrival).not.toHaveBeenCalled();
  });
});

it("gives each agent of a staffed group the model the router chose, and none otherwise (backlog 27 oct)", async () => {
  const made = await launchGroup(
    { name: "Mission Auth", role: "general", agents: ["claude", "claude"] },
    { cwd: "C:/code", shell: "default", title: "", command: "" },
    { x: 0, y: 0 },
    { pantheon: "egyptian", names: ["Isis", "Horus"], cwds: ["C:/a", "C:/b"], models: ["opus", undefined] },
  );
  expect(made!.nodeIds.map((id) => terminalOf(nodesStore.getState().nodes[id])?.model)).toEqual(["opus", undefined]);
});

describe("a scene not on screen (spec mission de nuit §6.1)", () => {
  const options = { cwd: "C:/code", shell: "default" as const, title: "", command: "" };
  const saved = () => saves[saves.length - 1];
  let saves: { elementsJson: string; nodeIds: string[] }[];

  beforeEach(() => {
    saves = [];
    vi.mocked(startUnseen).mockClear();
    mockIPC((cmd, args) => {
      if (cmd === "save_scene") saves.push(args as (typeof saves)[number]);
      return undefined;
    });
    workspacesStore.setState({ activeId: "other" });
    rememberScene("w1", [{ id: "kept", type: "embeddable", isDeleted: false, x: 0, y: 0, width: 10, height: 10, customData: { kind: "terminal" } }] as never, {} as never, {}, []);
  });

  it("makes a group in the stored scene, saves every node, and starts its agents: nothing mounts them", async () => {
    const scroll = vi.mocked(canvasStore.getState().api!.scrollToContent);
    scroll.mockClear();
    const made = await launchGroup({ name: "Mission Auth", role: "general", agents: ["claude"] }, options, { x: 0, y: 0 }, { pantheon: "egyptian", names: ["Isis"], cwds: ["C:/w/isis"], workspaceId: "w1" });
    const ids = cachedElements("w1")!.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["kept", made!.frameId, made!.nodeIds[0]]));
    expect(scene).toEqual([]);
    expect(scroll).not.toHaveBeenCalled();
    expect(startUnseen).toHaveBeenCalledWith(made!.nodeIds[0], expect.objectContaining({ cwd: "C:/w/isis" }));
    // The save purges the rows of nodes it does not list.
    expect(saved().nodeIds).toEqual(expect.arrayContaining(["kept", made!.nodeIds[0]]));
    forgetScene("w1");
  });

  it("adds a terminal to it, and starts it", async () => {
    const payload = { title: "", name: "Thor", agent: "claude" as const, cwd: "C:/w/thor", shell: "default" as const, command: "" };
    const { addTerminal } = await vi.importActual<typeof import("./terminals")>("./terminals");
    const id = await addTerminal("w1", payload, { x: 0, y: 0 });
    expect(cachedElements("w1")!.map((e) => e.id)).toContain(id);
    expect(startUnseen).toHaveBeenCalledWith(id, payload);
    forgetScene("w1");
  });

  it("closes a group there with its terminals and wires, and frees them", async () => {
    const { disposeTerminal } = await import("@/nodes/terminal/registry");
    nodesStore.getState().forgetWorkspace("w1");
    const wire = { id: "w", type: "arrow", isDeleted: false, customData: { dummyplane: { kind: "wire" } }, startBinding: { elementId: "chef" }, endBinding: { elementId: "f1" } };
    rememberScene(
      "w1",
      [
        { id: "kept", type: "embeddable", isDeleted: false, frameId: null, customData: { kind: "terminal" } },
        { id: "f1", type: "frame", isDeleted: false, frameId: null, customData: { dummyplane: { kind: "group", role: "general", pantheon: "egyptian" } } },
        { id: "t1", type: "embeddable", isDeleted: false, frameId: "f1", customData: { kind: "terminal" } },
        wire,
      ] as never,
      {} as never,
      {},
      [],
    );
    closeStoredGroup("w1", "f1");
    expect(cachedElements("w1")!.filter((e) => e.isDeleted).map((e) => e.id)).toEqual(["f1", "t1", "w"]);
    expect(disposeTerminal).toHaveBeenCalledWith("t1");
    expect(disposeTerminal).not.toHaveBeenCalledWith("f1");
    await vi.waitFor(() => expect(saved()?.nodeIds).toEqual(["kept"]));
    forgetScene("w1");
  });

  it("leaves a scene on screen to its canvas", () => {
    workspacesStore.setState({ activeId: "w1" });
    scene = [{ id: "t1", type: "embeddable" }];
    removeFromStoredScene("w1", new Set(["t1"]));
    expect(scene[0].isDeleted).toBeUndefined();
    forgetScene("w1");
  });
});

it("closes a group with the wires that led to it (final review H2)", () => {
  const wire = (id: string, to: string): Element => ({ id, type: "arrow", customData: { dummyplane: { kind: "wire" } }, startBinding: { elementId: "chef" }, endBinding: { elementId: to } });
  scene = [
    { id: "f1", type: "frame", customData: { dummyplane: { kind: "group", role: "general", pantheon: "egyptian" } } },
    { id: "t1", type: "embeddable", frameId: "f1" },
    wire("w1", "f1"),
    wire("w2", "t1"),
    wire("w3", "ailleurs"),
  ];
  closeGroup("f1");
  expect(scene.filter((e) => e.isDeleted).map((e) => e.id)).toEqual(["f1", "t1", "w1", "w2"]);
});

it("folds and unfolds a group as one undoable step, keeping everything else (spec replier un groupe §3)", () => {
  const data = { kind: "group", role: "general", pantheon: "egyptian", speciality: "API" };
  scene = [{ id: "f1", type: "frame", customData: { dummyplane: data } }, { id: "plain", type: "frame" }, { id: "t1", type: "embeddable", customData: { kind: "terminal" }, frameId: "f1" } as never];
  setGroupFolded("f1", true);
  // Hidden agents cannot be selected, moved or deleted by a click on their empty cell.
  expect((scene[2] as { locked?: boolean }).locked).toBe(true);
  expect(scene[0].customData?.dummyplane).toEqual({ ...data, folded: true });
  setGroupFolded("plain", true);
  expect(scene[1].customData).toBeUndefined();
  setGroupFolded("f1", false);
  expect(scene[0].customData?.dummyplane).toEqual(data);
  expect((scene[2] as { locked?: boolean }).locked).toBe(false);
});

it("unfolds a folded group before adding an agent to it, so the agent shows and starts", async () => {
  const data = { kind: "group", role: "general", pantheon: "egyptian", folded: true };
  scene = [{ id: "f1", type: "frame", customData: { dummyplane: data } }];
  canvasStore.setState({ frames: [{ id: "f1", name: "G", x: 0, y: 0, width: 800, height: 500, group: { role: "general", pantheon: "egyptian", folded: true }, memberIds: [] }] as never });
  workspacesStore.setState({ activeId: "w1" });
  await addAgentToGroup("f1", "shell");
  expect(scene[0].customData?.dummyplane).not.toHaveProperty("folded");
});

it("does not fold a group whose agents have not started yet: a hidden agent never starts", () => {
  const data = { kind: "group", role: "general", pantheon: "egyptian" };
  scene = [{ id: "f1", type: "frame", customData: { dummyplane: data } }, { id: "t1", type: "embeddable", customData: { kind: "terminal" }, frameId: "f1" } as never];
  canvasStore.setState({ frames: [{ id: "f1", name: "G", x: 0, y: 0, width: 1, height: 1, group: { role: "general", pantheon: "egyptian" }, memberIds: ["t1"] }] as never });
  terminalStatusStore.getState().set("t1", { state: "starting" });
  setGroupFolded("f1", true);
  expect(scene[0].customData?.dummyplane).toEqual(data);
  expect(toast.error).toHaveBeenCalled();
  terminalStatusStore.getState().set("t1", { state: "running" });
  setGroupFolded("f1", true);
  expect(scene[0].customData?.dummyplane).toEqual({ ...data, folded: true });
});

describe("the folder agents of a group start in", () => {
  const openProject = async () => {
    projectsStore.setState({ projects: [{ id: "p1", name: "api", path: "D:\\code\\api", lastOpenedAt: 0, missing: false } as Project], activeId: "p1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    workspacesStore.setState({
      projectId: "p1",
      workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder: null }],
      activeId: "w1",
      status: "ready",
    });
    launchFolderStore.setState({ projectId: "p1", recent: [], loaded: true });
  };
  const plan = { name: "Team", role: "general" as const, agents: ["claude" as const] };
  const folderOf = (id: string) => terminalOf(nodesStore.getState().nodes[id])?.cwd;

  it("is the workspace's folder, for an agent added from the group's menu, titled by its last segment", async () => {
    await openProject();
    await launchFolderStore.getState().choose("D:\\work\\lib");
    scene = [{ id: "f1", type: "frame", customData: { dummyplane: { kind: "group", role: "general", pantheon: "egyptian" } } }];
    canvasStore.setState({ frames: [{ id: "f1", name: "G", x: 0, y: 0, width: 800, height: 500, group: { role: "general", pantheon: "egyptian" }, memberIds: [] }] as never });
    await addAgentToGroup("f1", "claude");
    expect(vi.mocked(addTerminal).mock.lastCall?.[1]).toMatchObject({ cwd: "D:\\work\\lib", title: "Claude · lib" });
  });

  it("is the workspace's too, for a group launched without options", async () => {
    await openProject();
    await launchFolderStore.getState().choose("D:\\work\\lib");
    const made = await launchGroup(plan, undefined, { x: 0, y: 0 });
    expect(folderOf(made!.nodeIds[0])).toBe("D:\\work\\lib");
  });

  it("is the project's, for a group launched without options in a workspace that picked no folder", async () => {
    await openProject();
    const made = await launchGroup(plan, undefined, { x: 0, y: 0 });
    expect(folderOf(made!.nodeIds[0])).toBe("D:\\code\\api");
  });

  it("is the one it is given, as the Compose window gives the launch folder", async () => {
    await openProject();
    const made = await launchGroup(plan, { cwd: "D:\\work\\lib", shell: "default", title: "", command: "" }, { x: 0, y: 0 });
    expect(folderOf(made!.nodeIds[0])).toBe("D:\\work\\lib");
  });
});
