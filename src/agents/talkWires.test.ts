import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { createGroupFrame, framesFromScene } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { activeWires, wirePaths } from "@/canvas/overlay/wirePaths";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import { nodesStore } from "@/store/nodes";
import { scheduleWireUpkeep } from "./wireUpkeep";
import {
  agentLinksOf,
  elbowWires,
  fleetTargets,
  isTalkWire,
  joiningWire,
  orphanWires,
  rerouteWires,
  wireFlagsOf,
  wireKindOf,
  withTalkWire,
  withWire,
  withWireBetween,
} from "./wires";

vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn().mockResolvedValue(undefined), saveNode: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "never", IMMEDIATELY: "immediately" },
  newElementWith: (e: object, fields: object) => ({ ...e, ...fields }),
}));

const scene = vi.hoisted(() => ({ shown: true, known: true, elements: [] as unknown[] }));
const updateScene = vi.hoisted(() => vi.fn());
const write = vi.hoisted(() => vi.fn());
vi.mock("./sceneAccess", () => ({
  sceneAccess: () => (scene.known ? { shown: scene.shown, elements: () => scene.elements, write } : null),
}));
vi.mock("@/canvas/canvasStore", () => ({ canvasStore: { getState: () => ({ api: { updateScene } }) } }));

const { talk } = await import("./talkWires");

const node = (kind: "terminal" | "fleet" | "kanban", id: string, x: number, y: number, extra: Partial<ExcalidrawElement> = {}) =>
  ({ ...(createNodeElement(kind, { x: 0, y: 0 }) as unknown as ExcalidrawElement), id, x, y, ...extra }) as ExcalidrawElement;

const fleet = node("fleet", "fleet", 0, 0);
const board = node("kanban", "board", 1000, 0);
const manager = node("terminal", "mgr", 1000, 600);
const batman = node("terminal", "batman", 0, 1400);
const cyborg = node("terminal", "cyborg", 1000, 1400);
const frame = createGroupFrame({ x: 3000, y: 0, width: 1600, height: 600 }, "Backend", { role: "backend", pantheon: "greek" }) as ExcalidrawElement;
const flash = node("terminal", "flash", 3050, 80, { frameId: frame.id });
const base = [fleet, board, manager, batman, cyborg, frame, flash];

const arrows = (elements: readonly ExcalidrawElement[]) => elements.filter((e) => !e.isDeleted && e.type === "arrow") as ExcalidrawArrowElement[];
const ends = (wire: ExcalidrawArrowElement) => [wire.startBinding?.elementId, wire.endBinding?.elementId];

describe("talk wires (wires.ts)", () => {
  it("draws a dashed talk wire in the wire's colour between two ends no wire joins, once, either way round", () => {
    const once = withTalkWire(base, "batman", "cyborg", "calm");
    const [wire] = arrows(once);
    expect(ends(wire)).toEqual(["batman", "cyborg"]);
    expect(isTalkWire(wire)).toBe(true);
    expect(wire.strokeStyle).toBe("dashed");
    expect(wire.customData).toEqual({ dummyplane: { kind: "wire", talk: true } });
    expect(wireKindOf(wire, new Map(once.map((e) => [e.id, e])))).toBe("talk");
    // Recorded on both ends, as any wire.
    expect(once.find((e) => e.id === "batman")!.boundElements).toEqual([{ id: wire.id, type: "arrow" }]);
    expect(withTalkWire(once, "batman", "cyborg")).toBe(once);
    expect(withTalkWire(once, "cyborg", "batman")).toBe(once);
  });

  it("counts any live wire as joining the pair, and a Fleet's wire to a group as joining it with each member", () => {
    const spawned = withWire(base, "mgr", "cyborg", "calm", true);
    expect(withTalkWire(spawned, "cyborg", "mgr")).toBe(spawned);
    const teamed = withWire(base, "fleet", frame.id, "calm");
    expect(joiningWire(teamed, "flash", "fleet")?.id).toBe(arrows(teamed)[0].id);
    expect(withTalkWire(teamed, "flash", "fleet")).toBe(teamed);
    // A wire deleted no longer joins them.
    const gone = spawned.map((e) => (e.type === "arrow" ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
    expect(arrows(withTalkWire(gone, "cyborg", "mgr"))).toHaveLength(1);
  });

  it("joins a terminal, a Fleet or a Kanban board, alive, and nothing else", () => {
    expect(arrows(withTalkWire(base, "fleet", "board"))).toHaveLength(1);
    expect(withTalkWire(base, "batman", frame.id)).toBe(base);
    expect(withTalkWire(base, "batman", "nobody")).toBe(base);
    expect(withTalkWire(base, "batman", "batman")).toBe(base);
    const closed = base.map((e) => (e.id === "cyborg" ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
    expect(withTalkWire(closed, "batman", "cyborg")).toBe(closed);
  });

  it("is never a fleet's link to its team, but two terminals it joins are linked agents", () => {
    const talked = withTalkWire(base, "fleet", "batman");
    expect(fleetTargets(talked, "fleet")).toEqual({ groupIds: [], nodeIds: [] });
    const peers = withTalkWire(base, "batman", "cyborg");
    expect(agentLinksOf(peers, "cyborg").map((l) => l.peerId)).toEqual(["batman"]);
  });

  it("becomes the link when the user wires the Fleet to that agent, not a second arrow over it", () => {
    const talked = withTalkWire(base, "batman", "fleet");
    const linked = withWire(talked, "fleet", "batman", "calm");
    expect(arrows(linked)).toHaveLength(1);
    const [wire] = arrows(linked);
    expect(isTalkWire(wire)).toBe(false);
    expect(wire.strokeStyle).toBe("solid");
    expect(fleetTargets(linked, "fleet").nodeIds).toEqual(["batman"]);
  });

  it("keeps its mark and its dashes through every reroute", () => {
    const talked = withTalkWire(base, "batman", "cyborg", "calm");
    const moved = talked.map((e) => (e.id === "cyborg" ? ({ ...e, x: 2400, y: 2600 } as ExcalidrawElement) : e));
    const [rerouted] = arrows(rerouteWires(moved, new Set(["cyborg"])));
    expect(isTalkWire(rerouted)).toBe(true);
    expect(rerouted.strokeStyle).toBe("dashed");
    expect(rerouted.points).not.toEqual(arrows(talked)[0].points);
    const [elbowed] = arrows(elbowWires(moved.map((e) => (e.type === "arrow" ? ({ ...e, elbowed: false } as ExcalidrawElement) : e))));
    expect(wireFlagsOf(elbowed)).toEqual({ talk: true });
    expect(elbowed.strokeStyle).toBe("dashed");
  });

  it("keeps a wire to a Kanban board: the board is a wire's end", () => {
    const wired = withWireBetween(withWireBetween(base, "fleet", "board"), "board", "mgr");
    expect(arrows(wired).map(ends)).toEqual([
      ["fleet", "board"],
      ["board", "mgr"],
    ]);
    expect(arrows(wired).map((w) => w.customData)).toEqual([{ dummyplane: { kind: "wire" } }, { dummyplane: { kind: "wire" } }]);
    expect(orphanWires(wired)).toEqual([]);
    // Not a team link either: the board is nobody's agent.
    expect(fleetTargets(wired, "fleet")).toEqual({ groupIds: [], nodeIds: [] });
    // Once is enough, either way round.
    expect(withWireBetween(wired, "board", "fleet")).toHaveLength(wired.length);
    expect(withWireBetween(wired, "mgr", "board")).toHaveLength(wired.length);
    // The board closed: its wires go.
    const closed = wired.map((e) => (e.id === "board" ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
    expect(orphanWires(closed)).toHaveLength(2);
  });
});

describe("the upkeep keeps a wire's flags through an orphaning and its undo", () => {
  let frames: FrameRequestCallback[];
  const upkeepScene = vi.fn();
  const api = (elements: ExcalidrawElement[]) =>
    ({
      getSceneElementsIncludingDeleted: () => elements,
      getAppState: () => ({ selectedElementIds: {}, selectedElementsAreBeingDragged: false, activeTool: { type: "selection" } }),
      updateScene: upkeepScene,
    }) as unknown as ExcalidrawImperativeAPI;
  beforeEach(() => {
    frames = [];
    upkeepScene.mockClear();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["a talk wire", { talk: true }],
    ["a vertical tree's wire", { spawn: true, down: true, riser: true }],
  ])("%s", (_, flags) => {
    const talked = withTalkWire(base, "batman", "cyborg", "calm");
    const flagged = talked.map((e) => (e.type === "arrow" ? ({ ...e, customData: { dummyplane: { kind: "wire", ...flags } } } as ExcalidrawElement) : e));
    const closed = flagged.map((e) => (e.id === "cyborg" ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
    scheduleWireUpkeep(api(closed), closed, () => null);
    frames.shift()!(0);
    const orphaned = (upkeepScene.mock.calls[0][0].elements as ExcalidrawElement[]).find((e) => e.type === "arrow")!;
    expect(orphaned.isDeleted).toBe(true);
    expect(orphaned.customData).toEqual({ dummyplane: { kind: "wire", ...flags, orphaned: true } });
    // An undo brings cyborg back: the wire comes back with its flags.
    const back = (upkeepScene.mock.calls[0][0].elements as ExcalidrawElement[]).map((e) => (e.id === "cyborg" ? ({ ...e, isDeleted: false } as ExcalidrawElement) : e));
    scheduleWireUpkeep(api(back), back, () => null);
    frames.shift()!(0);
    const revived = (upkeepScene.mock.calls[1][0].elements as ExcalidrawElement[]).find((e) => e.type === "arrow")!;
    expect(revived.isDeleted).toBe(false);
    expect(revived.customData).toEqual({ dummyplane: { kind: "wire", ...flags } });
  });
});

describe("talk (a message passed)", () => {
  const pulses = () => wireActivityStore.getState().pulses;
  /** What the canvas lights for the pulses now, on the scene as written. */
  const lit = (elements: readonly ExcalidrawElement[]) => activeWires(wirePaths(elements), framesFromScene(elements), pulses());
  const latest = () => (updateScene.mock.calls.at(-1)?.[0] as { elements: ExcalidrawElement[]; captureUpdate: string }) ?? null;

  beforeEach(() => {
    clearWirePulses();
    updateScene.mockClear();
    write.mockClear();
    scene.shown = true;
    scene.known = true;
    scene.elements = base;
    const record = (kind: string) => ({ workspaceId: "w", kind, payload: {} });
    nodesStore.setState({
      nodes: Object.fromEntries(["fleet", "board", "mgr", "batman", "cyborg", "flash"].map((id) => [id, record(id === "fleet" ? "fleet" : id === "board" ? "kanban" : "terminal")])) as never,
    });
  });

  it("draws a talk wire on screen outside the undo history, and lights it from the sender", () => {
    talk("batman", "cyborg");
    const { elements, captureUpdate } = latest()!;
    expect(captureUpdate).toBe("never");
    const [wire] = arrows(elements);
    expect(ends(wire)).toEqual(["batman", "cyborg"]);
    expect(isTalkWire(wire)).toBe(true);
    expect(lit(elements)).toEqual([expect.objectContaining({ wire: expect.objectContaining({ id: wire.id }), direction: "toAgent" })]);
    // The answer runs back along the same wire: no second one.
    scene.elements = elements;
    talk("cyborg", "batman");
    expect(updateScene).toHaveBeenCalledTimes(1);
    expect(lit(elements)).toEqual([expect.objectContaining({ wire: expect.objectContaining({ id: wire.id }), direction: "toFleet" })]);
  });

  it("writes the stored scene when the workspace is not on screen", () => {
    scene.shown = false;
    talk("batman", "cyborg");
    expect(updateScene).not.toHaveBeenCalled();
    expect(arrows(write.mock.calls[0][0] as ExcalidrawElement[])).toHaveLength(1);
  });

  it("lights a Fleet's wire to a group for its member's messages, either way, with no talk wire", () => {
    const teamed = withWire(base, "fleet", frame.id, "calm");
    scene.elements = teamed;
    talk("fleet", "flash");
    expect(updateScene).not.toHaveBeenCalled();
    expect(pulses().flash).toMatchObject({ direction: "toAgent", fleetId: "fleet" });
    expect(lit(teamed).map((a) => [a.wire.targetId, a.direction])).toEqual([[frame.id, "toAgent"]]);
    talk("flash", "fleet");
    expect(lit(teamed).map((a) => [a.wire.targetId, a.direction])).toEqual([[frame.id, "toFleet"]]);
  });

  it("reads a wire drawn the other way round: the light still runs from the sender", () => {
    // The Manager's spawn wire to cyborg; cyborg answers it.
    const spawned = withWire(base, "mgr", "cyborg", "calm", true);
    scene.elements = spawned;
    talk("cyborg", "mgr");
    expect(pulses().cyborg).toMatchObject({ direction: "toFleet", fleetId: "mgr" });
    expect(lit(spawned).map((a) => a.direction)).toEqual(["toFleet"]);
    // A wire from an agent to a Fleet reads from the Fleet.
    const toFleet = withTalkWire(base, "batman", "fleet");
    scene.elements = toFleet;
    talk("fleet", "batman");
    expect(lit(toFleet).map((a) => [a.wire.fleetId, a.direction])).toEqual([["fleet", "toAgent"]]);
  });

  it("lights the board's wire to the Manager", () => {
    const wired = withWireBetween(base, "board", "mgr");
    scene.elements = wired;
    talk("board", "mgr");
    expect(updateScene).not.toHaveBeenCalled();
    expect(lit(wired).map((a) => [a.wire.fleetId, a.wire.targetId, a.direction])).toEqual([["board", "mgr", "toAgent"]]);
  });

  it("only pulses when the scene was never read, or an end is not on it", () => {
    scene.known = false;
    talk("batman", "cyborg");
    expect(pulses().cyborg).toMatchObject({ direction: "toAgent", fleetId: "batman" });
    scene.known = true;
    talk("batman", "ghost");
    expect(updateScene).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
