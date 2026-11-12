import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { themeStore } from "@/app/theme";
import { createGroupFrame } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { nodesStore, type NodeRecord } from "@/store/nodes";
import { scheduleWireUpkeep } from "./wireUpkeep";
import * as wires from "./wires";

vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "never" },
  newElementWith: (e: object, fields: object) => ({ ...e, ...fields }),
}));

/** The seven scans the upkeep runs before it knows whether there is work, each counted. */
const SCANS = vi.hoisted(() => ["misfacedWires", "unmarkedWires", "orphanWires", "revivableWires", "outdatedWires", "staleWireBindings", "missingSpawnWires"] as const);

vi.mock("./wires", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./wires")>();
  return { ...actual, ...Object.fromEntries(SCANS.map((name) => [name, vi.fn(actual[name])])) };
});

/** How many scans ran so far, all seven together. */
const scans = () => SCANS.reduce((sum, name) => sum + vi.mocked(wires[name]).mock.calls.length, 0);

let frames: FrameRequestCallback[];
const updateScene = vi.fn();
/** The canvas at rest: nothing selected, the selection tool, no drag, the view at its origin. */
const REST = { selectedElementIds: {}, selectedElementsAreBeingDragged: false, activeTool: { type: "selection" }, scrollX: 0, scrollY: 0, zoom: { value: 1 } };
let appState: Record<string, unknown>;
/** One Excalidraw instance, as Canvas has: it reads the app state as it is when asked. */
const canvas = (elements: () => readonly ExcalidrawElement[]) =>
  ({ getSceneElementsIncludingDeleted: elements, getAppState: () => appState, updateScene }) as unknown as ExcalidrawImperativeAPI;

/** A fleet wired to a group, in the palette's color, and a lone terminal: a scene the upkeep has nothing to do for. Fresh copies: a test moves them in place. */
function wiredScene(): ExcalidrawElement[] {
  const fleet = createNodeElement("fleet", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
  const frame = createGroupFrame({ x: 600, y: 0, width: 900, height: 600 }, "B", { role: "backend", pantheon: "greek" }) as ExcalidrawElement;
  const lone = createNodeElement("terminal", { x: 0, y: 900 }) as unknown as ExcalidrawElement;
  return wires.withWire([fleet, frame, lone], fleet.id, frame.id, "calm");
}

beforeEach(() => {
  frames = [];
  vi.clearAllMocks();
  appState = { ...REST };
  themeStore.setState({ choice: "calm" });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
});
afterEach(() => {
  // An upkeep left scheduled would hold the next test's back.
  while (frames.length) frames.shift()!(0);
  vi.unstubAllGlobals();
  nodesStore.setState({ nodes: {} });
  themeStore.setState({ choice: "expressive" });
});

it("scans a scene with nothing to do once, then not again while only the view moves: a pan's frames", () => {
  const scene = wiredScene();
  const api = canvas(() => scene);
  scheduleWireUpkeep(api, scene);
  expect(scans()).toBe(SCANS.length);
  // A pan and a zoom: Excalidraw's onChange hands the same array, only the view moves, frame after frame.
  for (let frame = 1; frame <= 60; frame++) {
    appState = { ...appState, scrollX: frame * 12, scrollY: -frame * 5, zoom: { value: 1 + frame / 100 } };
    scheduleWireUpkeep(api, scene);
  }
  expect(scans()).toBe(SCANS.length);
  expect(frames).toHaveLength(0);
});

it("scans again when an element changes in place, the array is another one or its length moves, and does the work a real change needs", () => {
  let scene = wiredScene();
  const api = canvas(() => scene);
  scheduleWireUpkeep(api, scene);
  let before = scans();
  // A drag: the same array, the terminal moved in place, its version bumped.
  const lone = scene[2] as { x: number; version: number };
  lone.x += 40;
  lone.version += 1;
  scheduleWireUpkeep(api, scene);
  expect(scans()).toBeGreaterThan(before);
  before = scans();
  // A scene replaced by an array of the same elements.
  scene = [...scene];
  scheduleWireUpkeep(api, scene);
  expect(scans()).toBeGreaterThan(before);
  before = scans();
  // An element gone and another bumped by as much: the same version, one element fewer.
  const last = scene.pop()!;
  (scene[0] as { version: number }).version += last.version;
  scheduleWireUpkeep(api, scene);
  expect(scans()).toBeGreaterThan(before);
  expect(frames).toHaveLength(0);
  // An arrow drawn by hand from the fleet to a terminal: it gets the wire mark on the next frame.
  const target = createNodeElement("terminal", { x: 0, y: 1800 }) as unknown as ExcalidrawElement;
  const hand = { ...wires.createWire(scene[0], target, "calm"), customData: undefined } as ExcalidrawElement;
  scene = [...scene, target, hand];
  scheduleWireUpkeep(api, scene);
  expect(frames).toHaveLength(1);
  frames.shift()!(0);
  expect(updateScene).toHaveBeenCalledTimes(1);
  const marked = updateScene.mock.calls[0][0].elements.find((e: ExcalidrawElement) => e.id === hand.id);
  expect(marked.customData.dummyplane).toEqual({ kind: "wire" });
});

it("faces a wire once the user lets go, though the frame that lets go hands the same scene", () => {
  const fleet = createNodeElement("fleet", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
  const lone = createNodeElement("terminal", { x: 0, y: 900 }) as unknown as ExcalidrawElement;
  const wire = wires.createWire(fleet, lone, "calm");
  // The terminal dragged past the fleet: its wire still enters by the side that faced before.
  const scene = [fleet, { ...lone, x: 3000, y: 100 } as ExcalidrawElement, wire];
  const api = canvas(() => scene);
  appState = { ...REST, selectedElementsAreBeingDragged: true };
  scheduleWireUpkeep(api, scene);
  expect(frames).toHaveLength(0);
  appState = { ...REST };
  scheduleWireUpkeep(api, scene);
  expect(frames).toHaveLength(1);
});

it("recolors the wires when the palette changes, though the scene did not", () => {
  const scene = wiredScene();
  const api = canvas(() => scene);
  scheduleWireUpkeep(api, scene);
  expect(frames).toHaveLength(0);
  themeStore.setState({ choice: "electric" });
  scheduleWireUpkeep(api, scene);
  expect(frames).toHaveLength(1);
});

it("gives a sub-agent its spawn wire once its node says who spawned it, though the scene did not change", () => {
  const parent = createNodeElement("terminal", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
  const child = createNodeElement("terminal", { x: 1200, y: 0 }) as unknown as ExcalidrawElement;
  const scene = [parent, child];
  const api = canvas(() => scene);
  scheduleWireUpkeep(api, scene);
  expect(frames).toHaveLength(0);
  const payload = { title: "", name: "Robin", agent: "claude", cwd: "C:/code", shell: "default", command: "", spawnedBy: parent.id };
  nodesStore.setState({ nodes: { [child.id]: { workspaceId: "w1", kind: "terminal", payload } as NodeRecord } });
  scheduleWireUpkeep(api, scene);
  expect(frames).toHaveLength(1);
});
