// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { createGroupFrame, groupInfoOf, type Rect } from "@/canvas/groups";
import { createNodeElement, nodeKindOf } from "@/canvas/nodeElement";
import { nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { linkAgents, linkedAgentsOf } from "./agentLinks";
import { frameAround, overlap } from "./groupLayout";
import { fleetTargets, isWire, orphanWires, withWire } from "./wires";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "immediately" },
  newElementWith: (e: object, patch: object) => ({ ...e, ...patch }),
}));

const element = (id: string, x: number, y = 0) => ({ ...createNodeElement("terminal", { x, y }), id }) as unknown as ExcalidrawElement;
let scene: readonly ExcalidrawElement[] = [];
const updateScene = vi.fn(({ elements }: { elements: readonly ExcalidrawElement[] }) => void (scene = elements));
const wires = () => scene.filter((e) => !e.isDeleted && isWire(e));
const live = (id: string) => scene.find((e) => e.id === id && !e.isDeleted)!;
const frames = () => scene.filter((e) => !e.isDeleted && e.type === "frame");
const rect = ({ x, y, width, height }: Rect): Rect => ({ x, y, width, height });
const holds = (frame: Rect, e: Rect) => e.x >= frame.x && e.y >= frame.y && e.x + e.width <= frame.x + frame.width && e.y + e.height <= frame.y + frame.height;

/** `ids` in a group of their own, its frame fitted around them, as Group makes it. */
function group(name: string, ...ids: string[]): string {
  const frame = createGroupFrame(frameAround(scene.filter((e) => ids.includes(e.id)).map(rect)), name, { role: "general", pantheon: "dc" });
  scene = [...scene.map((e) => (ids.includes(e.id) ? ({ ...e, frameId: frame.id } as ExcalidrawElement) : e)), frame];
  return frame.id;
}

beforeAll(async () => {
  mockIPC(() => undefined);
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({ api: { getSceneElementsIncludingDeleted: () => scene, updateScene } as never });
  const terminal = (id: string, agent: "claude" | "codex" | "shell", extra: Record<string, unknown> = {}) =>
    nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { title: "", name: id, agent, cwd: "C:/code", shell: "default", command: "", ...extra } });
  await terminal("batman", "claude");
  await terminal("cyborg", "codex");
  await terminal("sh", "shell");
  await terminal("flash", "claude");
  // Cyborg's sub-agent (spawn_agent).
  await terminal("robin", "claude", { spawnedBy: "cyborg" });
  // A mission's Manager.
  await terminal("boss", "claude", { role: "manager", fleet: "chef" });
  await nodesStore.getState().create("o", { workspaceId: "w1", kind: "output", payload: { title: "", source: "cyborg", ui: "", updatedAt: 0 } });
});
beforeEach(() => {
  scene = [element("batman", 0), element("cyborg", 1200), element("sh", 2400), element("flash", 3600)];
  updateScene.mockClear();
});

it("wires two agents in one undo step, then reads the link from both ends", () => {
  linkAgents("batman", "cyborg");
  expect(updateScene).toHaveBeenCalledTimes(1);
  expect(updateScene.mock.calls[0][0]).toMatchObject({ captureUpdate: "immediately" });
  expect(wires()).toHaveLength(1);
  expect(linkedAgentsOf("batman")).toEqual([{ nodeId: "cyborg", name: "cyborg", outgoing: true }]);
  expect(linkedAgentsOf("cyborg")).toEqual([{ nodeId: "batman", name: "batman", outgoing: false }]);
});

it("writes nothing for a pair already linked, either way round, nor for an agent and itself", () => {
  linkAgents("batman", "cyborg");
  linkAgents("cyborg", "batman");
  linkAgents("batman", "cyborg");
  linkAgents("batman", "batman");
  expect(updateScene).toHaveBeenCalledTimes(1);
  expect(wires()).toHaveLength(1);
});

it("never links a plain shell", () => {
  linkAgents("batman", "sh");
  linkAgents("sh", "batman");
  expect(updateScene).not.toHaveBeenCalled();
  expect(linkedAgentsOf("batman")).toEqual([]);
});

describe("makes the two agents a group", () => {
  it("wraps two agents in no group in a new one where they stand, with the wire, in one undo step", () => {
    const before = [rect(live("batman")), rect(live("cyborg"))];
    expect(linkAgents("batman", "cyborg")).toMatchObject({ kind: "grouped" });
    expect(updateScene).toHaveBeenCalledTimes(1);
    const [frame] = frames();
    expect(frame).toBeDefined();
    expect(groupInfoOf(frame)).not.toBeNull();
    expect(live("batman").frameId).toBe(frame.id);
    expect(live("cyborg").frameId).toBe(frame.id);
    // Nothing moved: the frame goes around them, the grid's padding on every side.
    expect([rect(live("batman")), rect(live("cyborg"))]).toEqual(before);
    expect(rect(frame)).toEqual(frameAround(before));
    expect(wires()).toHaveLength(1);
    // The frame last: Excalidraw keeps a frame above its children.
    expect(scene.findIndex((e) => e.id === frame.id)).toBeGreaterThan(scene.findIndex((e) => e.id === "cyborg"));
  });

  it("takes the other one into the group the first stands in, moved into its grid, either way round", () => {
    for (const [from, to] of [
      ["batman", "cyborg"],
      ["cyborg", "batman"],
    ]) {
      scene = [element("batman", 0), element("cyborg", 1200), element("sh", 2400), element("flash", 3600)];
      const frameId = group("Justice League", "batman");
      updateScene.mockClear();
      expect(linkAgents(from, to)).toMatchObject({ kind: "grouped", groupId: frameId });
      expect(updateScene).toHaveBeenCalledTimes(1);
      expect(frames()).toHaveLength(1);
      const frame = live(frameId);
      expect(live("cyborg").frameId).toBe(frameId);
      expect(holds(frame, live("cyborg"))).toBe(true);
      expect(holds(frame, live("batman"))).toBe(true);
      expect(overlap(rect(live("cyborg")), rect(live("batman")))).toBe(0);
      // The group's first free cell: under Batman.
      expect(live("cyborg").x).toBe(live("batman").x);
      expect(live("cyborg").y).toBeGreaterThan(live("batman").y + live("batman").height);
      expect(wires()).toHaveLength(1);
      expect(orphanWires(scene)).toEqual([]);
    }
  });

  it("brings the outputs of the agent that joins with it, into the group", () => {
    const frameId = group("Justice League", "batman");
    scene = [...scene, { ...createNodeElement("output", { x: 6000, y: 6000 }), id: "o" } as unknown as ExcalidrawElement];
    linkAgents("batman", "cyborg");
    const frame = live(frameId);
    expect(live("o").frameId).toBe(frameId);
    expect(holds(frame, live("o"))).toBe(true);
    expect(live("o").x).toBeGreaterThan(live("cyborg").x + live("cyborg").width);
    for (const other of ["batman", "cyborg"]) expect(overlap(rect(live("o")), rect(live(other)))).toBe(0);
  });

  it("keeps a Fleet's wire to the group bound to it as the frame grows", () => {
    scene = [...scene, { ...createNodeElement("fleet", { x: -2000, y: 0 }), id: "chef" } as unknown as ExcalidrawElement];
    const frameId = group("Justice League", "batman");
    scene = withWire(scene, "chef", frameId);
    linkAgents("cyborg", "batman");
    expect(fleetTargets(scene, "chef")).toEqual({ groupIds: [frameId], nodeIds: [] });
    expect(orphanWires(scene)).toEqual([]);
    // The agents' own link is no Fleet's: the Fleet still commands the group, not the agent.
    expect(wires()).toHaveLength(2);
  });

  it("does nothing more for two agents of one group", () => {
    const frameId = group("Justice League", "batman", "cyborg");
    const before = rect(live(frameId));
    expect(linkAgents("batman", "cyborg")).toEqual({ kind: "linked" });
    expect(frames()).toHaveLength(1);
    expect(rect(live(frameId))).toEqual(before);
    expect(wires()).toHaveLength(1);
  });

  it("never merges two groups: linked, each in its own, and says why", () => {
    const justice = group("Justice League", "batman");
    const titans = group("Teen Titans", "cyborg");
    const before = [rect(live(justice)), rect(live(titans)), rect(live("batman")), rect(live("cyborg"))];
    expect(linkAgents("batman", "cyborg")).toEqual({ kind: "notGrouped", reason: "otherGroups", groups: ["Justice League", "Teen Titans"] });
    expect(updateScene).toHaveBeenCalledTimes(1);
    expect([rect(live(justice)), rect(live(titans)), rect(live("batman")), rect(live("cyborg"))]).toEqual(before);
    expect(live("batman").frameId).toBe(justice);
    expect(live("cyborg").frameId).toBe(titans);
    expect(wires()).toHaveLength(1);
  });

  it("makes the group around the first one when something stands between them, the other joining it", () => {
    // Cyborg and the shell stand between Batman and Flash: no frame can hold the two where they are.
    expect(linkAgents("batman", "flash")).toMatchObject({ kind: "grouped" });
    expect(updateScene).toHaveBeenCalledTimes(1);
    const [frame] = frames();
    expect(live("batman").frameId).toBe(frame.id);
    expect(live("flash").frameId).toBe(frame.id);
    for (const other of ["cyborg", "sh"]) {
      expect(live(other).frameId).toBeNull();
      expect(overlap(rect(frame), rect(live(other)))).toBe(0);
    }
    // Batman stays where he stood.
    expect(rect(live("batman"))).toEqual(rect(element("batman", 0)));
  });

  it("never lays the joining agent, nor the grown frame, on a neighbour: the group goes around the other one, else nothing moves", () => {
    // A 2 x 2 square: Batman, Cyborg on top; the shell, Flash under them. Batman and Flash, the diagonal.
    scene = [element("batman", 0), element("cyborg", 1200), element("sh", 0, 600), element("flash", 1200, 600)];
    expect(linkAgents("batman", "flash")).toMatchObject({ kind: "grouped" });
    const [frame] = frames();
    // Under Batman stands the shell: the group goes around Flash, and Batman joins it under him.
    expect(live("flash").frameId).toBe(frame.id);
    expect(live("batman").frameId).toBe(frame.id);
    expect(rect(live("flash"))).toEqual(rect(element("flash", 1200, 600)));
    for (const other of ["cyborg", "sh"]) expect(overlap(rect(frame), rect(live(other)))).toBe(0);

    // Something under Flash too: no group, nothing moves, and the user is told why.
    scene = [element("batman", 0), element("cyborg", 1200), element("sh", 0, 600), element("flash", 1200, 600), element("under", 1200, 1200)];
    const before = scene.map(rect);
    updateScene.mockClear();
    expect(linkAgents("batman", "flash")).toEqual({ kind: "notGrouped", reason: "inTheWay" });
    expect(updateScene).toHaveBeenCalledTimes(1);
    expect(frames()).toHaveLength(0);
    expect(scene.filter((e) => !isWire(e)).map(rect)).toEqual(before);
    expect(wires()).toHaveLength(1);
  });

  it("leaves the agent out of a group whose growth would cover a neighbour, and says why", () => {
    scene = [element("batman", 0), element("cyborg", 1200), element("sh", 0, 600)];
    const frameId = group("Justice League", "batman");
    const before = rect(live(frameId));
    expect(linkAgents("cyborg", "batman")).toEqual({ kind: "notGrouped", reason: "inTheWay" });
    expect(live("cyborg").frameId).toBeNull();
    expect(rect(live("cyborg"))).toEqual(rect(element("cyborg", 1200)));
    expect(rect(live(frameId))).toEqual(before);
    expect(wires()).toHaveLength(1);
  });

  it("links but leaves the group alone when the agent would leave its sub-agents behind, and says why", () => {
    scene = [...scene, element("robin", 1200, 1200)];
    const frameId = group("Justice League", "batman");
    expect(linkAgents("batman", "cyborg")).toEqual({ kind: "notGrouped", reason: "family", agent: "cyborg" });
    expect(live("cyborg").frameId).toBeNull();
    expect(rect(live("cyborg"))).toEqual(rect(element("cyborg", 1200)));
    expect(rect(live(frameId))).toEqual(frameAround([rect(live("batman"))]));
    expect(wires()).toHaveLength(1);
  });

  it("never takes a mission's Manager, nor an agent into a mission's group", async () => {
    scene = [...scene, element("boss", 0, 3000)];
    expect(linkAgents("batman", "boss")).toEqual({ kind: "notGrouped", reason: "mission", agent: "boss" });
    expect(frames()).toHaveLength(0);
    // A Fleet's mission keeps its group: an agent let in would close with the mission.
    scene = [element("batman", 0), element("cyborg", 1200)];
    const frameId = group("Mission", "batman");
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", mission: { frameId } as never } });
    try {
      expect(linkAgents("cyborg", "batman")).toEqual({ kind: "notGrouped", reason: "mission", agent: "batman" });
      expect(live("cyborg").frameId).toBeNull();
      expect(wires()).toHaveLength(1);
    } finally {
      nodesStore.setState(({ nodes }) => ({ nodes: Object.fromEntries(Object.entries(nodes).filter(([id]) => id !== "chef")) }));
    }
  });

  it("never pulls an agent out of a frame drawn by hand", () => {
    const frameId = group("Sketch", "cyborg");
    scene = scene.map((e) => (e.id === frameId ? ({ ...e, customData: undefined } as ExcalidrawElement) : e));
    expect(linkAgents("batman", "cyborg")).toEqual({ kind: "notGrouped", reason: "frame", agent: "cyborg" });
    expect(live("cyborg").frameId).toBe(frameId);
    expect(frames()).toHaveLength(1);
  });

  it("routes the wire between the agents where they end up", () => {
    group("Justice League", "batman");
    linkAgents("batman", "cyborg");
    const wire = wires()[0] as ExcalidrawArrowElement;
    expect([wire.startBinding?.elementId, wire.endBinding?.elementId]).toEqual(["batman", "cyborg"]);
    // Its tip at Cyborg, who now stands under Batman: the wire goes down, not right to where he was.
    const points = (wire as unknown as { points: [number, number][] }).points;
    const [, tipY] = points[points.length - 1];
    expect(wire.y + tipY).toBeGreaterThan(live("batman").y + live("batman").height);
    expect(nodeKindOf(live("cyborg"))).toBe("terminal");
  });
});
