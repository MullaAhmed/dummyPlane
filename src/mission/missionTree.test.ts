// @vitest-environment happy-dom
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { createNodeElement, NODE_SIZE } from "@/canvas/nodeElement";
import { cachedElements, editStoredScene, forgetScene, rememberScene } from "@/canvas/sceneCache";
import { quietly } from "@/agents/arrivals";
import { COLUMN_GAP, GROUP_GAP } from "@/agents/groupLayout";
import { reflowSpawnTree } from "@/agents/spawnTree";
import { addTerminal } from "@/agents/terminals";
import { isWire, wireFlagsOf } from "@/agents/wires";
import { sceneAccess } from "@/agents/sceneAccess";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { withTeamNote } from "./launch";
import { addTeamMember, reflowTeam, setUpBoard } from "./manager";
import { missionOf } from "./store";

/**
 * The go-ahead's canvas end to end, each piece real: the board and its Manager (`./manager`), the team as the
 * Manager's sub-agents, and the vertical tree the spawn layout gives them (`@/agents/spawnTree`), on the stored
 * scene of a workspace that is not on screen (an overnight run's). Only the terminal's own start is mocked.
 */

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", () => ({ stopTerminal: vi.fn(), markForAutostart: vi.fn(), quietFor: vi.fn(() => 0), freshText: vi.fn(() => "") }));
vi.mock("@/agents/terminals", () => ({ addTerminal: vi.fn(), removeNodes: vi.fn(), removeFromStoredScene: vi.fn() }));

const session: TerminalPayload = { title: "Chef", name: "Chef", agent: "claude", cwd: "C:/code/proj", shell: "default", command: "", claudeSessionId: "s0", role: "orchestrator" };
const member = (name: string): TerminalPayload => ({ title: name, name, agent: "claude", cwd: `C:/w/${name}`, shell: "default", command: "" });
const live = () => (cachedElements("w1") ?? []).filter((e) => !e.isDeleted);
const element = (id: string) => live().find((e) => e.id === id)!;
const wireTo = (id: string) => live().find((e) => e.type === "arrow" && isWire(e) && (e as ExcalidrawArrowElement).endBinding?.elementId === id) as ExcalidrawArrowElement;
const rect = (e: ExcalidrawElement) => ({ x: e.x, y: e.y, width: e.width, height: e.height });
const crosses = (a: { x: number; y: number }, b: { x: number; y: number }, r: { x: number; y: number; width: number; height: number }) => {
  // An axis-aligned segment through the inside of a box (its border excluded).
  const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return x2 > r.x + 1 && x1 < r.x + r.width - 1 && y2 > r.y + 1 && y1 < r.y + r.height - 1;
};

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  nodesStore.setState({ nodes: {} });
  canvasStore.setState({ api: null });
  // The fleet's workspace is not the one on screen: everything goes through its stored scene.
  workspacesStore.setState({ activeId: "w0" });
  rememberScene("w1", [{ ...createNodeElement("fleet", { x: 320, y: 380 }), id: "chef" }], {} as never, {}, []);
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", session, mission: { state: "lancement", maxAgents: 8, members: [], name: "Auth" } } });
  let made = 0;
  vi.mocked(addTerminal).mockImplementation(async (workspaceId, payload, center) => {
    const id = `${payload.name.toLowerCase() || "t"}${++made}`;
    await nodesStore.getState().create(id, { workspaceId, kind: "terminal", payload });
    const scene = sceneAccess(workspaceId)!;
    scene.write([...scene.elements(), { ...createNodeElement("terminal", center), id }]);
    return id;
  });
});
afterEach(() => forgetScene("w1"));

describe("the go-ahead's board, Manager and tree, together (spec babysitter Fleet)", () => {
  it("lays five agents out under the Manager, four in a row and the fifth below, the board and the Manager left where they stand", async () => {
    const setup = await setUpBoard("chef", "w1", missionOf(nodesStore.getState().nodes.chef)!, "claude", quietly("mission"));
    const board = rect(element(setup.boardId));
    const manager = rect(element(setup.managerId));
    const ids: string[] = [];
    for (const name of ["Robin", "Cyborg", "Raven", "Starfire", "Beast"]) ids.push((await addTeamMember("w1", setup.managerId, member(name), name, quietly("mission")))!);
    reflowTeam("w1", setup.managerId);

    expect(rect(element(setup.boardId))).toEqual(board);
    expect(rect(element(setup.managerId))).toEqual(manager);
    const { width, height } = NODE_SIZE.terminal;
    const firstRow = manager.y + manager.height + GROUP_GAP;
    ids.slice(0, 4).forEach((id, i) => expect(rect(element(id))).toEqual({ x: manager.x + i * (width + COLUMN_GAP), y: firstRow, width, height }));
    expect(rect(element(ids[4]))).toEqual({ x: manager.x, y: firstRow + height + GROUP_GAP, width, height });
    // Their wires leave the Manager's bottom: the first row's straight down, the fifth's round the riser.
    ids.slice(0, 4).forEach((id) => expect(wireFlagsOf(wireTo(id))).toEqual({ spawn: true, down: true }));
    expect(wireFlagsOf(wireTo(ids[4]))).toEqual({ spawn: true, down: true, riser: true });
    // No wire of the tree runs through a node.
    const nodes = live().filter((e) => e.type === "embeddable");
    for (const id of ids) {
      const wire = wireTo(id);
      const points = wire.points.map(([x, y]) => ({ x: wire.x + x, y: wire.y + y }));
      for (let i = 1; i < points.length; i++) {
        for (const node of nodes) expect(crosses(points[i - 1], points[i], rect(node)), `${id}'s wire through ${node.id}`).toBe(false);
      }
    }
    // Laid out, it stays: a second reflow changes nothing.
    expect(reflowSpawnTree("w1", setup.managerId)).toBe(false);
  });

  it("closes up when an agent leaves: the fifth moves up into the first row and loses its riser", async () => {
    const setup = await setUpBoard("chef", "w1", missionOf(nodesStore.getState().nodes.chef)!, "claude", quietly("mission"));
    const ids: string[] = [];
    for (const name of ["Robin", "Cyborg", "Raven", "Starfire", "Beast"]) ids.push((await addTeamMember("w1", setup.managerId, member(name), name, quietly("mission")))!);
    reflowTeam("w1", setup.managerId);
    const firstRowY = element(ids[0]).y;
    // Cyborg's terminal closes (Ctrl+Z keeps its record).
    editStoredScene("w1", (cachedElements("w1") ?? []).map((e) => (e.id === ids[1] ? { ...e, isDeleted: true } : e)));
    reflowSpawnTree("w1", ids[1]);
    expect(element(ids[4]).y).toBe(firstRowY);
    expect(wireFlagsOf(wireTo(ids[4]))).toEqual({ spawn: true, down: true });
  });

  it("tells each agent who runs the mission, and that it reaches the Manager and its teammates", async () => {
    const setup = await setUpBoard("chef", "w1", missionOf(nodesStore.getState().nodes.chef)!, "claude", quietly("mission"));
    const mission = missionOf(nodesStore.getState().nodes.chef)!;
    expect(mission.manager).toBe(setup.managerId);
    expect(withTeamNote(mission, "Do it.")).toBe(
      "Do it. Manager runs this mission: message it or a teammate with message_agent (linked_agents lists them), and report to it with report.",
    );
    expect(withTeamNote({ ...mission, manager: undefined }, "Do it.")).toBe("Do it.");
  });
});
