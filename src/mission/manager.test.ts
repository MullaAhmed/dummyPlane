// @vitest-environment happy-dom
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import { GROUP_GAP } from "@/agents/groupLayout";
import { isLaunching } from "@/agents/spawnFamily";
import { addTerminal, removeNodes } from "@/agents/terminals";
import { quietly } from "@/agents/arrivals";
import { isSpawnWire, isWire } from "@/agents/wires";
import { readMission } from "./mission";
import type { KanbanPayload, TerminalPayload } from "@/nodes/types";
import { readTerminalPayload } from "@/nodes/types";
import { isManagerNode, nodesStore, terminalOf } from "@/store/nodes";
import { isAgentNode } from "@/agents/agentState";
import { workspacesStore } from "@/store/workspaces";
import { addTeamMember, boardSpot, managerCenter, managerPayload, setUpBoard, undoSetup } from "./manager";
import { missionOf, missionRunner } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", () => ({ stopTerminal: vi.fn(), markForAutostart: vi.fn(), quietFor: vi.fn(() => 0), freshText: vi.fn(() => "") }));
vi.mock("@/agents/spawnTree", () => ({ reflowSpawnTree: vi.fn(() => true) }));
vi.mock("@/agents/terminals", () => ({ addTerminal: vi.fn(), removeNodes: vi.fn(), removeFromStoredScene: vi.fn() }));
// The workspace's scene, on screen: what the setup reads and writes.
let scene: ExcalidrawElement[] = [];
vi.mock("@/agents/sceneAccess", () => ({
  sceneAccess: vi.fn(() => ({
    shown: true,
    elements: () => scene,
    write: (elements: readonly ExcalidrawElement[]) => (scene = [...elements]),
  })),
}));
vi.mock("./store", async (importOriginal) => ({ ...(await importOriginal<typeof import("./store")>()), fleetShown: vi.fn(() => true) }));

const session: TerminalPayload = { title: "Chef", name: "Chef", agent: "claude", cwd: "C:/code/proj", shell: "pwsh", command: "", claudeSessionId: "s0", role: "orchestrator", accountId: "work", model: "opus", effort: "high" };
const at = (kind: "fleet" | "kanban" | "terminal", x: number, y: number, id: string) => {
  const { width, height } = NODE_SIZE[kind];
  return { ...createNodeElement(kind, { x: x + width / 2, y: y + height / 2 }), id };
};
const wires = () => scene.filter((e) => !e.isDeleted && e.type === "arrow" && isWire(e)) as ExcalidrawArrowElement[];
const joined = (a: string, b: string) => wires().some((w) => [w.startBinding?.elementId, w.endBinding?.elementId].sort().join() === [a, b].sort().join());
const element = (id: string) => scene.find((e) => e.id === id && !e.isDeleted)!;

async function fleet(mission: Record<string, unknown> = {}) {
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", session, mission: { state: "lancement", maxAgents: 4, members: [], name: "Auth", ...mission } },
  });
}

beforeEach(() => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  nodesStore.setState({ nodes: {} });
  workspacesStore.setState({ activeId: "w1" });
  scene = [at("fleet", 0, 0, "chef")];
  let made = 0;
  // A terminal joins the scene where it is asked for, as addTerminal places one in free space.
  vi.mocked(addTerminal).mockImplementation(async (workspaceId, payload, center) => {
    const id = `t${++made}`;
    await nodesStore.getState().create(id, { workspaceId, kind: "terminal", payload });
    scene = [...scene, { ...createNodeElement("terminal", center), id }];
    return id;
  });
});

describe("where the board and its Manager go", () => {
  const fleetRect = { x: 0, y: 0, width: 640, height: 760 };

  it("puts the board right of the Fleet, GROUP_GAP away, tops aligned", () => {
    expect(boardSpot(fleetRect, [])).toEqual({ x: 640 + GROUP_GAP, y: 0, ...NODE_SIZE.kanban });
  });

  it("moves it down past what stands there, a row's air kept: a group the Fleet is wired to, its own sub-agent", () => {
    const group = { x: 700, y: -20, width: 800, height: 600 };
    const spot = boardSpot(fleetRect, [group]);
    expect(spot.x).toBe(640 + GROUP_GAP);
    expect(spot.y).toBeGreaterThan(group.y + group.height);
  });

  it("centers the Manager under the board, GROUP_GAP below it", () => {
    const board = { x: 736, y: 0, ...NODE_SIZE.kanban };
    expect(managerCenter(board)).toEqual({ x: 736 + 320, y: 400 + GROUP_GAP + NODE_SIZE.terminal.height / 2 });
  });
});

describe("setUpBoard at the go-ahead", () => {
  it("makes a board beside the Fleet, linked to it, and the Manager under it, wired Fleet–Board–Manager", async () => {
    await fleet();
    const setup = await setUpBoard("chef", "w1", missionOf(nodesStore.getState().nodes.chef)!, "claude", quietly("mission"));
    expect(setup).toMatchObject({ boardMade: true, managerMade: true });
    const board = nodesStore.getState().nodes[setup.boardId];
    expect(board?.kind).toBe("kanban");
    const payload = board!.payload as KanbanPayload;
    expect(payload.columns.map((c) => c.title)).toEqual(["To do", "In progress", "Done"]);
    // Linked to the Fleet: its cards follow the mission, its first column is the mission's to-do.
    expect(payload.orchestrator).toEqual({ nodeId: "chef", columnId: payload.columns[0].id });
    expect(element(setup.boardId)).toMatchObject({ x: 640 + GROUP_GAP, y: 0 });
    // The Manager: a terminal under the board, centered on it.
    const manager = element(setup.managerId);
    expect(manager.x + manager.width / 2).toBe(element(setup.boardId).x + NODE_SIZE.kanban.width / 2);
    expect(manager.y).toBe(NODE_SIZE.kanban.height + GROUP_GAP);
    expect(isManagerNode(setup.managerId)).toBe(true);
    // An agent like any other for every count (title bar, tabs, home card).
    expect(isAgentNode(nodesStore.getState().nodes[setup.managerId])).toBe(true);
    expect(joined("chef", setup.boardId)).toBe(true);
    expect(joined(setup.boardId, setup.managerId)).toBe(true);
    // Recorded at once: a launch tried again finds them; the team's lines go to the Manager from now on.
    expect(missionOf(nodesStore.getState().nodes.chef)).toMatchObject({ board: setup.boardId, manager: setup.managerId, boardMade: true });
    expect(missionRunner("chef")).toBe(setup.managerId);
    expect(vi.mocked(addTerminal).mock.calls[0][4]).toEqual(quietly("mission"));
  });

  it("reuses the board the mission was planned from (Plan with the fleet), where the user put it", async () => {
    await fleet();
    const handed: KanbanPayload = { columns: [{ id: "backlog", title: "Backlog", cardIds: [] }], cards: {}, orchestrator: { nodeId: "chef", columnId: "backlog" } };
    await nodesStore.getState().create("k1", { workspaceId: "w1", kind: "kanban", payload: handed });
    scene = [...scene, at("kanban", 2000, 1000, "k1")];
    const setup = await setUpBoard("chef", "w1", missionOf(nodesStore.getState().nodes.chef)!, "claude", quietly("mission"));
    expect(setup).toMatchObject({ boardId: "k1", boardMade: false });
    expect(scene.filter((e) => e.type === "embeddable" && e.customData?.kind === "kanban")).toHaveLength(1);
    expect(element("k1")).toMatchObject({ x: 2000, y: 1000 });
    expect(element(setup.managerId).y).toBe(1000 + NODE_SIZE.kanban.height + GROUP_GAP);
    expect(missionOf(nodesStore.getState().nodes.chef)?.boardMade).toBeUndefined();
  });

  it("finds the board and the Manager a launch cut short left, and makes no second one", async () => {
    await fleet();
    const first = await setUpBoard("chef", "w1", missionOf(nodesStore.getState().nodes.chef)!, "claude", quietly("mission"));
    const again = await setUpBoard("chef", "w1", missionOf(nodesStore.getState().nodes.chef)!, "claude", quietly("mission"));
    expect(again).toEqual({ boardId: first.boardId, boardMade: false, managerId: first.managerId, managerMade: false });
    expect(addTerminal).toHaveBeenCalledTimes(1);
    expect(wires()).toHaveLength(2);
    expect(missionOf(nodesStore.getState().nodes.chef)?.boardMade).toBe(true);
  });

  it("takes back what a failed launch made: the Manager and a new board, never a board the user handed over", async () => {
    await fleet();
    const setup = await setUpBoard("chef", "w1", missionOf(nodesStore.getState().nodes.chef)!, "claude", quietly("mission"));
    undoSetup("chef", "w1", setup);
    expect(removeNodes).toHaveBeenCalledWith([setup.managerId, setup.boardId]);
    expect(missionOf(nodesStore.getState().nodes.chef)).not.toHaveProperty("manager", expect.anything());
    expect(missionOf(nodesStore.getState().nodes.chef)?.board).toBeUndefined();
    vi.mocked(removeNodes).mockClear();
    undoSetup("chef", "w1", { boardId: "k1", boardMade: false, managerId: "m9", managerMade: true });
    expect(removeNodes).toHaveBeenCalledWith(["m9"]);
  });
});

describe("the Manager's terminal", () => {
  it("runs on the Fleet's CLI, in its folder, shell and account, with its model and effort, and the night's permission", async () => {
    await fleet({ permission: "work" });
    const payload = managerPayload("chef", missionOf(nodesStore.getState().nodes.chef)!, "claude", "Manager")!;
    expect(payload).toMatchObject({ name: "Manager", title: "Manager · Auth", agent: "claude", cwd: "C:/code/proj", shell: "pwsh", accountId: "work", model: "opus", effort: "high", permission: "work", role: "manager", fleet: "chef" });
    expect(payload.claudeSessionId).toEqual(expect.any(String));
    expect(payload.claudeSessionId).not.toBe("s0");
  });

  it("runs on Codex for a Codex Fleet, without a Claude model", async () => {
    await fleet();
    nodesStore.getState().update("chef", { session: { ...session, agent: "codex", model: "opus" } });
    const payload = managerPayload("chef", missionOf(nodesStore.getState().nodes.chef)!, "codex", "Manager")!;
    expect(payload).toMatchObject({ agent: "codex", role: "manager", fleet: "chef" });
    expect(payload.claudeSessionId).toBeUndefined();
  });

  it("is named Manager, numbered when the workspace has one already", async () => {
    await fleet();
    await nodesStore.getState().create("old", { workspaceId: "w1", kind: "terminal", payload: { ...session, role: undefined, name: "Manager" } });
    const setup = await setUpBoard("chef", "w1", missionOf(nodesStore.getState().nodes.chef)!, "claude", quietly("mission"));
    expect(terminalOf(nodesStore.getState().nodes[setup.managerId])?.name).toBe("Manager 2");
  });

  it("survives a restart as a Manager; a Manager without its Fleet reads as a plain agent", () => {
    const saved = JSON.parse(JSON.stringify({ ...session, role: "manager", fleet: "chef" }));
    expect(readTerminalPayload(saved)).toMatchObject({ role: "manager", fleet: "chef" });
    expect(readTerminalPayload({ ...saved, fleet: undefined })?.role).toBeUndefined();
    const mission = readMission(JSON.parse(JSON.stringify({ state: "en_cours", maxAgents: 4, members: [], manager: "m1", board: "b1", boardMade: true })));
    expect(mission).toMatchObject({ manager: "m1", board: "b1", boardMade: true });
    // A mission saved before Managers existed reads as before: its Fleet runs it.
    expect(readMission({ state: "en_cours", maxAgents: 4, members: [], frameId: "f1" })).not.toHaveProperty("manager");
  });
});

describe("a team agent under its Manager", () => {
  it("opens as the Manager's sub-agent, with its task, a spawn wire from the Manager, held until its sub-task is typed", async () => {
    await fleet();
    const setup = await setUpBoard("chef", "w1", missionOf(nodesStore.getState().nodes.chef)!, "claude", quietly("mission"));
    const payload: TerminalPayload = { title: "Robin", name: "Robin", agent: "claude", cwd: "C:/w/robin", shell: "default", command: "" };
    const id = (await addTeamMember("w1", setup.managerId, payload, "Login", quietly("mission")))!;
    expect(terminalOf(nodesStore.getState().nodes[id])).toMatchObject({ spawnedBy: setup.managerId, task: "Login", cwd: "C:/w/robin" });
    const wire = wires().find((w) => w.endBinding?.elementId === id)!;
    expect(wire.startBinding?.elementId).toBe(setup.managerId);
    expect(isSpawnWire(wire)).toBe(true);
    expect(isLaunching(id)).toBe(true);
  });
});
