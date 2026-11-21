// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { framesFromScene, groupOf, type Rect } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { cachedElements, editStoredScene, forgetScene, rememberScene } from "@/canvas/sceneCache";
import { arrangedElements } from "@/agents/arrange";
import { quietly } from "@/agents/arrivals";
import { anchorsOf } from "@/agents/attachments";
import { GROUP_GAP, overlap } from "@/agents/groupLayout";
import { settledMission } from "@/agents/missionLayout";
import { withFamilyGroup } from "@/agents/spawnGroup";
import { reflowSpawnTree, spawnedBy } from "@/agents/spawnTree";
import { addTerminal } from "@/agents/terminals";
import { withWire } from "@/agents/wires";
import { kanbanWidth } from "@/kanban/width";
import { sceneAccess } from "@/agents/sceneAccess";
import type { TerminalPayload } from "@/nodes/types";
import { isManagerNode, nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { addTeamMember, reflowTeam, setUpBoard, teamFrameOf, type MissionSetup } from "./manager";
import { missionOf } from "./store";

/**
 * A mission's go-ahead on a Fleet that already opened sub-agents of its own (spawn_agent), as the user's
 * canvas had it: the board, its Manager and the team docked beside the Fleet, under its sub-agents, and kept
 * so as the Fleet's tree changes (src/agents/missionLayout.ts). Each piece real but the terminal's start,
 * on the stored scene of a workspace that is not on screen.
 */

vi.mock("@excalidraw/excalidraw", () => ({ newElementWith: (e: object, fields: object) => ({ ...e, ...fields }) }));
vi.mock("@/nodes/terminal/registry", () => ({ stopTerminal: vi.fn(), markForAutostart: vi.fn(), quietFor: vi.fn(() => 0), freshText: vi.fn(() => "") }));
vi.mock("@/agents/terminals", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/agents/terminals")>()), addTerminal: vi.fn(), removeNodes: vi.fn(), removeFromStoredScene: vi.fn() }));

const session: TerminalPayload = { title: "Chef", name: "Chef", agent: "claude", cwd: "C:/code/proj", shell: "default", command: "", claudeSessionId: "s0", role: "orchestrator" };
const member = (name: string, extra: Partial<TerminalPayload> = {}): TerminalPayload => ({ title: name, name, agent: "claude", cwd: `C:/w/${name}`, shell: "default", command: "", ...extra });
const live = () => (cachedElements("w1") ?? []).filter((e) => !e.isDeleted);
const element = (id: string) => live().find((e) => e.id === id)!;
const at = (id: string) => ({ x: element(id).x, y: element(id).y });

/** Every two nodes of the canvas stand apart, and a group's frame covers no node outside it. */
function expectNoOverlap() {
  const nodes = live().filter((e) => e.type === "embeddable");
  for (const a of nodes) for (const b of nodes) if (a.id < b.id) expect(overlap(a, b), `${a.id} over ${b.id}`).toBe(0);
  for (const frame of live().filter((e) => e.type === "frame")) {
    for (const n of nodes) if (n.frameId !== frame.id) expect(overlap(frame, n), `${frame.name} over ${n.id}`).toBe(0);
  }
}

const within = (inner: Rect, outer: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  nodesStore.setState({ nodes: {} });
  canvasStore.setState({ api: null });
  workspacesStore.setState({ activeId: "w0" });
  rememberScene("w1", [{ ...createNodeElement("fleet", { x: 320, y: 380 }), id: "chef" }], {} as never, {}, []);
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", session, mission: { state: "lancement", maxAgents: 8, members: [], name: "Auth" } } });
  // addTerminal places a terminal as the app does (clear of every node), only its start left out.
  const { placeTerminal } = await vi.importActual<typeof import("@/agents/terminals")>("@/agents/terminals");
  let made = 0;
  vi.mocked(addTerminal).mockImplementation(async (workspaceId, payload, center, groupId = null) => {
    const id = `${payload.name.toLowerCase() || "t"}${++made}`;
    await nodesStore.getState().create(id, { workspaceId, kind: "terminal", payload });
    const scene = sceneAccess(workspaceId)!;
    scene.write(placeTerminal(scene.elements(), { ...createNodeElement("terminal", center), id }, groupId));
    return id;
  });
});
afterEach(() => forgetScene("w1"));

/** A sub-agent `parent` opens with spawn_agent: right of it, in its parent's group if it stands in one (as ../agents/spawn.ts places it), wired, its tree laid out. */
async function spawn(parent: string, name: string): Promise<string> {
  const from = element(parent);
  const group = groupOf(framesFromScene(live()), parent);
  const id = (await addTerminal("w1", member(name, { spawnedBy: parent }), { x: from.x + from.width + 400, y: from.y + 220 }, group?.id ?? null, quietly("spawn")))!;
  const scene = sceneAccess("w1")!;
  scene.write(withWire(scene.elements(), parent, id, undefined, true));
  reflowSpawnTree("w1", id);
  return id;
}

/** The Fleet's own sub-agents as the user's canvas had them: two, the second with four of its own. */
async function fleetHelpers(): Promise<string[]> {
  const helpers = [await spawn("chef", "Batman"), await spawn("chef", "Superman")];
  for (const name of ["Aquaman", "Flash", "Cyborg", "Wonder"]) await spawn(helpers[1], name);
  return helpers;
}

/** The go-ahead: the board and its Manager, then two new agents of the team under it. */
async function goAhead(): Promise<MissionSetup & { team: string[] }> {
  const setup = await setUpBoard("chef", "w1", missionOf(nodesStore.getState().nodes.chef)!, "claude", quietly("mission"));
  const team: string[] = [];
  for (const name of ["Thor", "Hulk"]) team.push((await addTeamMember("w1", setup.managerId, member(name), name, quietly("mission")))!);
  reflowTeam("w1", setup.managerId);
  return { ...setup, team };
}

/** Where the mission's nodes stand from its board: its shape. */
const shapeOf = (ids: readonly string[], boardId: string) => ids.map((id) => ({ x: element(id).x - element(boardId).x, y: element(id).y - element(boardId).y }));

describe("a mission docked beside a Fleet that has sub-agents of its own", () => {
  it("lands under the Fleet's sub-agents, the team a row under its Manager, nothing over anything", async () => {
    const helpers = await fleetHelpers();
    const before = helpers.map(at);
    const { boardId, managerId, team } = await goAhead();
    // The Fleet's own tree stays as it was.
    expect(helpers.map(at)).toEqual(before);
    const fleet = element("chef");
    expect(element(boardId).x).toBe(fleet.x + fleet.width + GROUP_GAP);
    const manager = element(managerId);
    // The team in one row under its Manager, not pushed away from it past the Fleet's tree.
    team.forEach((id) => expect(element(id).y, id).toBe(manager.y + manager.height + GROUP_GAP));
    expect(element(team[0]).x).toBe(manager.x);
    // The Manager and its team in their group, the frame grown around them, the board above it.
    const frame = teamFrameOf(live(), managerId)!;
    expect(frame).toMatchObject({ type: "frame", name: "Mission Auth" });
    for (const id of [managerId, ...team]) {
      expect(element(id).frameId, id).toBe(frame.id);
      expect(within(element(id), frame), id).toBe(true);
    }
    expect(element(boardId).frameId).toBeNull();
    expect(frame.x).toBe(element(boardId).x);
    expect(frame.y).toBe(element(boardId).y + element(boardId).height + GROUP_GAP);
    expectNoOverlap();
    // Laid out, it stays: the Fleet's tree and the team's reflow again to nothing.
    expect(reflowSpawnTree("w1", "chef")).toBe(false);
    expect(reflowSpawnTree("w1", managerId)).toBe(false);
  });

  it("keeps the Fleet's sub-agents beside it when it opens another: the mission makes room under them, its shape kept", async () => {
    const helpers = await fleetHelpers();
    const { boardId, managerId, team } = await goAhead();
    const mission = [boardId, managerId, ...team, teamFrameOf(live(), managerId)!.id];
    const shape = shapeOf(mission, boardId);
    const late = await spawn("chef", "Late");
    const fleet = element("chef");
    // Before, the Fleet's whole tree went right past the mission, far from its Fleet.
    for (const id of [...helpers, late]) expect(element(id).x, id).toBe(fleet.x + fleet.width + GROUP_GAP);
    expect(shapeOf(mission, boardId)).toEqual(shape);
    expect(element(boardId).y).toBeGreaterThan(element(late).y + element(late).height);
    expectNoOverlap();
  });

  it("stays docked when its board grows a column (Blocked): the board widens to the right, the Fleet's sub-agents stay beside it", async () => {
    const helpers = await fleetHelpers();
    const { boardId } = await goAhead();
    // The board as its node fits it once a fourth column comes (`kanbanWidth`): wider, its left edge where it was.
    editStoredScene("w1", (cachedElements("w1") ?? []).map((e) => (e.id === boardId ? { ...e, width: kanbanWidth(4) } : e)));
    const late = await spawn("chef", "Late");
    const fleet = element("chef");
    expect(element(boardId).x).toBe(fleet.x + fleet.width + GROUP_GAP);
    for (const id of [...helpers, late]) expect(element(id).x, id).toBe(fleet.x + fleet.width + GROUP_GAP);
    expectNoOverlap();
  });

  it("moves back up when that sub-agent of the Fleet closes", async () => {
    await fleetHelpers();
    const { boardId } = await goAhead();
    const landed = at(boardId);
    const late = await spawn("chef", "Late");
    expect(at(boardId)).not.toEqual(landed);
    editStoredScene("w1", (cachedElements("w1") ?? []).map((e) => (e.id === late ? { ...e, isDeleted: true } : e)));
    reflowSpawnTree("w1", late);
    expect(at(boardId)).toEqual(landed);
    expectNoOverlap();
  });

  it("stays where the user moved it, away from the Fleet, as the Fleet's tree changes", async () => {
    await fleetHelpers();
    const { boardId, managerId, team } = await goAhead();
    const mission = new Set([boardId, managerId, ...team]);
    // Moved by hand, all of it, far left of the Fleet.
    editStoredScene("w1", (cachedElements("w1") ?? []).map((e) => (mission.has(e.id) ? { ...e, x: e.x - 6000 } : e)));
    const placed = [...mission].map(at);
    await spawn("chef", "Late");
    expect([...mission].map(at)).toEqual(placed);
  });
});

describe("the mission's group", () => {
  it("takes a team agent's own sub-agent, under it, and grows: no group of its own under the Manager", async () => {
    await fleetHelpers();
    const { managerId, team } = await goAhead();
    const frame = teamFrameOf(live(), managerId)!;
    // spawn_agent offers a parent in no group a family group of its own: refused under a Manager, the parent is in the mission's.
    const options = { label: () => "Sub-agents", pantheon: "norse", isManager: isManagerNode, fullRect: (e: Rect) => e };
    expect(withFamilyGroup(live(), team[1], spawnedBy, options)).toBeNull();
    const kid = await spawn(team[1], "Batgirl");
    expect(element(kid).frameId).toBe(frame.id);
    expect(element(kid).y).toBe(element(team[1]).y + element(team[1]).height + GROUP_GAP);
    expect(within(element(kid), teamFrameOf(live(), managerId)!)).toBe(true);
    expect(live().filter((e) => e.type === "frame")).toHaveLength(1);
    expectNoOverlap();
  });

  it("moves with its board and Manager when its Fleet goes: the frame and all it holds", async () => {
    const { boardId, managerId, team } = await goAhead();
    const frameId = teamFrameOf(live(), managerId)!.id;
    const ids = [boardId, managerId, ...team, frameId];
    const before = ids.map(at);
    // The Fleet dragged by (-2000, 300), alone: what the drag left behind follows it.
    const dragged = live().map((e) => (e.id === "chef" ? { ...e, x: e.x - 2000, y: e.y + 300 } : e));
    const after = settledMission(dragged, "chef", { parentOf: spawnedBy, delta: { x: -2000, y: 300 }, moved: new Set(["chef"]) })!;
    const where = (id: string) => after.find((e) => e.id === id)!;
    ids.forEach((id, i) => expect({ x: where(id).x, y: where(id).y }, id).toEqual({ x: before[i].x - 2000, y: before[i].y + 300 }));
  });

  it("goes with its Fleet in an Arrange, as one block: the Fleet's sub-agents, the board, the group and its team keep their places", async () => {
    const helpers = await fleetHelpers();
    const { boardId, managerId, team } = await goAhead();
    const frameId = teamFrameOf(live(), managerId)!.id;
    // A lone terminal far off: the Arrange has two blocks to pack, so the mission's moves.
    rememberScene("w1", [...live(), { ...createNodeElement("terminal", { x: -9000, y: -9000 }), id: "lone" }], {} as never, {}, []);
    const before = live();
    const result = arrangedElements({ elements: before, parentOf: spawnedBy, isMinimized: () => false, attachedTo: anchorsOf(before), aspect: 16 / 10, isDownRoot: isManagerNode })!;
    const was = (id: string) => before.find((e) => e.id === id)!;
    const now = (id: string) => result.elements.find((e) => e.id === id)!;
    const shift = { x: now("chef").x - was("chef").x, y: now("chef").y - was("chef").y };
    expect(shift).not.toEqual({ x: 0, y: 0 });
    for (const id of [...helpers, boardId, frameId, managerId, ...team]) {
      expect({ x: now(id).x - was(id).x, y: now(id).y - was(id).y }, id).toEqual(shift);
      expect({ width: now(id).width, height: now(id).height }, id).toEqual({ width: was(id).width, height: was(id).height });
    }
  });
});
