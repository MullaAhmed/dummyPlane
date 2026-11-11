import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { setThemeChoice, themeStore, type ThemeChoice } from "@/app/theme";
import { createGroupFrame } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { scheduleWireUpkeep } from "./wireUpkeep";
import { createWire, wireColor, withWire } from "./wires";

vi.mock("@/ipc/db", () => ({ getSetting: vi.fn(), setSetting: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "never" },
  newElementWith: (e: object, fields: object) => ({ ...e, ...fields }),
}));

const fleet = createNodeElement("fleet", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
const frame = createGroupFrame({ x: 600, y: 0, width: 900, height: 600 }, "B", { role: "backend", pantheon: "greek" }) as ExcalidrawElement;
const lone = createNodeElement("terminal", { x: 0, y: 900 }) as unknown as ExcalidrawElement;
const hand = { ...createWire(fleet, lone), customData: undefined } as ExcalidrawElement;

let frames: FrameRequestCallback[];
const updateScene = vi.fn();
/** The canvas as the upkeep reads it: one element selected, the selection tool, no drag. */
const appState = { selectedElementIds: { [lone.id]: true }, selectedElementsAreBeingDragged: false, activeTool: { type: "selection" } };
const api = (elements: ExcalidrawElement[]) =>
  ({ getSceneElementsIncludingDeleted: () => elements, getAppState: () => appState, updateScene }) as unknown as ExcalidrawImperativeAPI;

beforeEach(() => {
  frames = [];
  updateScene.mockClear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
});
afterEach(() => vi.unstubAllGlobals());

it("marks a hand-drawn wire once, however many changes come before the frame", () => {
  const elements = [fleet, lone, hand];
  scheduleWireUpkeep(api(elements), elements);
  scheduleWireUpkeep(api(elements), elements);
  scheduleWireUpkeep(api(elements), elements);
  expect(frames).toHaveLength(1);
  frames.shift()!(0);
  expect(updateScene).toHaveBeenCalledTimes(1);
  // Once it ran, a later need schedules again.
  scheduleWireUpkeep(api(elements), elements);
  expect(frames).toHaveLength(1);
  frames.shift()!(0);
});

it("deletes the wires left without an end, outside the undo history", () => {
  const wired = withWire([fleet, frame, lone], fleet.id, frame.id);
  const wire = wired[wired.length - 1];
  const elements = wired.filter((e) => e.id !== frame.id);
  scheduleWireUpkeep(api(elements), elements);
  frames.shift()!(0);
  const update = updateScene.mock.calls[0][0];
  expect(update.captureUpdate).toBe("never");
  expect(update.elements.find((e: ExcalidrawElement) => e.id === wire.id).isDeleted).toBe(true);
});

it("leaves a line in the log for each wire it deletes: the wire, its kind and the end that failed", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const child = createNodeElement("terminal", { x: 1200, y: 900 }) as unknown as ExcalidrawElement;
  const spawned = withWire([lone, child], lone.id, child.id, "calm", true);
  const wire = spawned[spawned.length - 1];
  const closed = spawned.map((e) => (e.id === child.id ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
  scheduleWireUpkeep(api(closed), closed);
  frames.shift()!(0);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(
    `wire ${wire.id} (spawn) deleted as orphaned: start ${lone.id} ok; end ${child.id} deleted; listed by ${lone.id}; selection 1 (wire no, frame no), dragging no, tool selection`,
  );
  warn.mockRestore();
});

it("logs nothing when no wire goes", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const elements = [fleet, lone, hand];
  scheduleWireUpkeep(api(elements), elements);
  frames.shift()!(0);
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

it("does nothing for a scene that needs nothing", () => {
  const elements = withWire([fleet, frame, lone], fleet.id, frame.id);
  scheduleWireUpkeep(api(elements), elements);
  expect(frames).toHaveLength(0);
});

it("brings a dropped wire back when its ends come back, as an undo does", () => {
  const wired = withWire([fleet, frame, lone], fleet.id, frame.id);
  const wire = wired[wired.length - 1];
  const gone = wired.filter((e) => e.id !== frame.id);
  scheduleWireUpkeep(api(gone), gone);
  frames.shift()!(0);
  const dropped = updateScene.mock.calls[0][0].elements.find((e: ExcalidrawElement) => e.id === wire.id);
  expect(dropped.customData.dummyplane).toMatchObject({ kind: "wire", orphaned: true });
  // Undo: the frame is back, the wire still deleted.
  updateScene.mockClear();
  const undone = [...wired.filter((e) => e.id !== wire.id), dropped];
  scheduleWireUpkeep(api(undone), undone);
  frames.shift()!(0);
  const revived = updateScene.mock.calls[0][0].elements.find((e: ExcalidrawElement) => e.id === wire.id);
  expect(revived.isDeleted).toBe(false);
  expect(revived.customData.dummyplane.orphaned).toBeUndefined();
});

it("keeps a spawn wire one through its orphaning and the undo that brings it back", () => {
  const child = createNodeElement("terminal", { x: 1200, y: 900 }) as unknown as ExcalidrawElement;
  const wired = withWire([fleet, lone, child], lone.id, child.id, "expressive", true);
  const wire = wired[wired.length - 1];
  // The sub-agent is closed: the wire goes, still a spawn wire.
  const gone = wired.map((e) => (e.id === child.id ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
  scheduleWireUpkeep(api(gone), gone);
  frames.shift()!(0);
  const dropped = updateScene.mock.calls[0][0].elements.find((e: ExcalidrawElement) => e.id === wire.id);
  expect(dropped.isDeleted).toBe(true);
  expect(dropped.customData.dummyplane).toEqual({ kind: "wire", spawn: true, orphaned: true });
  // Undo: the sub-agent is back, its wire with it.
  updateScene.mockClear();
  const undone = [...wired.filter((e) => e.id !== wire.id), dropped];
  scheduleWireUpkeep(api(undone), undone);
  frames.shift()!(0);
  const revived = updateScene.mock.calls[0][0].elements.find((e: ExcalidrawElement) => e.id === wire.id);
  expect(revived.isDeleted).toBe(false);
  expect(revived.customData.dummyplane).toEqual({ kind: "wire", spawn: true });
});

describe("spawn wires heal themselves (a spawn wire shows the child's spawnedBy)", () => {
  const child = createNodeElement("terminal", { x: 1200, y: 900 }) as unknown as ExcalidrawElement;
  const spawnerOf = (id: string) => (id === child.id ? lone.id : undefined);
  const live = (elements: readonly ExcalidrawElement[]) => elements.filter((e) => e.type === "arrow" && !e.isDeleted) as ExcalidrawArrowElement[];
  const at = (elements: readonly ExcalidrawElement[], id: string) => elements.find((e) => e.id === id)!;
  const pass = (elements: ExcalidrawElement[]) => {
    updateScene.mockClear();
    scheduleWireUpkeep(api(elements), elements, spawnerOf);
    frames.shift()?.(0);
    return updateScene.mock.calls[0]?.[0] as { elements: ExcalidrawElement[]; captureUpdate: string } | undefined;
  };

  it("gives a sub-agent its wire back when none joins it to its spawner, outside the undo history, and logs it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const update = pass([lone, child])!;
    expect(update.captureUpdate).toBe("never");
    const [wire] = live(update.elements);
    expect(wire).toMatchObject({ startBinding: { elementId: lone.id }, endBinding: { elementId: child.id } });
    expect(wire.customData).toEqual({ dummyplane: { kind: "wire", spawn: true } });
    expect(warn).toHaveBeenCalledWith(`spawn wire re-created: child ${child.id}, parent ${lone.id}`);
    // The next change finds nothing to do: no second wire.
    expect(pass(update.elements)).toBeUndefined();
    expect(frames).toHaveLength(0);
    warn.mockRestore();
  });

  it("replaces a wire whose sub-agent end Excalidraw unbound (the user's scene) by a fresh one, the dead one off both lists", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const wired = withWire([lone, child], lone.id, child.id, "calm", true);
    const wire = wired[wired.length - 1];
    // As the saved scene had it: the child's end unbound, the child no longer listing it, the parent still does.
    const unbound = wired.map((e) =>
      e.id === wire.id ? ({ ...e, endBinding: null } as ExcalidrawElement) : e.id === child.id ? ({ ...e, boundElements: [] } as ExcalidrawElement) : e,
    );
    const update = pass(unbound)!;
    expect(at(update.elements, wire.id)).toMatchObject({ isDeleted: true, customData: { dummyplane: { kind: "wire", spawn: true, orphaned: true } } });
    const [fresh] = live(update.elements);
    expect(fresh.id).not.toBe(wire.id);
    expect(fresh).toMatchObject({ startBinding: { elementId: lone.id }, endBinding: { elementId: child.id } });
    expect(at(update.elements, lone.id).boundElements).toEqual([{ id: fresh.id, type: "arrow" }]);
    expect(at(update.elements, child.id).boundElements).toEqual([{ id: fresh.id, type: "arrow" }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`wire ${wire.id} (spawn) deleted as orphaned: start ${lone.id} ok; end unbound`));
    expect(warn).toHaveBeenCalledWith(`spawn wire re-created: child ${child.id}, parent ${lone.id}`);
    expect(pass(update.elements)).toBeUndefined();
    warn.mockRestore();
  });

  it("leaves one wire when an undo gives the old orphan its bindings back beside the fresh one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const wired = withWire([lone, child], lone.id, child.id, "calm", true);
    const wire = wired[wired.length - 1];
    const unbound = wired.map((e) => (e.id === wire.id ? ({ ...e, endBinding: null } as ExcalidrawElement) : e));
    const healed = pass(unbound)!.elements;
    // The undo: the old wire's end bound again, the wire still deleted and marked.
    const undone = healed.map((e) => (e.id === wire.id ? ({ ...e, endBinding: (wire as ExcalidrawArrowElement).endBinding } as ExcalidrawElement) : e));
    const update = pass(undone);
    expect(live(update?.elements ?? undone)).toHaveLength(1);
    warn.mockRestore();
  });

  it("re-creates nothing when the spawner is closed: the sub-agent hangs from its nearest live ancestor", () => {
    const closed = { ...lone, isDeleted: true } as ExcalidrawElement;
    expect(pass([closed, child])).toBeUndefined();
    expect(frames).toHaveLength(0);
  });

  it("takes the ids of deleted wires off the lists of the elements still live", () => {
    const wired = withWire([fleet, frame, lone], fleet.id, frame.id);
    const wire = wired[wired.length - 1];
    // Deleted, its ends still listing it (the six ids left on the parent).
    const stale = wired.map((e) => (e.id === wire.id ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
    const update = pass(stale)!;
    expect(at(update.elements, fleet.id).boundElements).toEqual([]);
    expect(at(update.elements, frame.id).boundElements).toEqual([]);
    expect(pass(update.elements)).toBeUndefined();
  });

  it("lists a revived wire on its ends again, for Excalidraw to move it with them", () => {
    const wired = withWire([fleet, frame, lone], fleet.id, frame.id);
    const wire = wired[wired.length - 1];
    // Ungroup: the frame goes, the wire with it, off the fleet's list.
    const dropped = pass(wired.filter((e) => e.id !== frame.id))!.elements;
    expect(at(dropped, fleet.id).boundElements).toEqual([]);
    // Undo: the frame is back, without the deleted wire on its list (Excalidraw's history takes it off).
    const undone = [...dropped, { ...frame, boundElements: [] } as ExcalidrawElement];
    const update = pass(undone)!;
    expect(at(update.elements, wire.id).isDeleted).toBe(false);
    expect(at(update.elements, fleet.id).boundElements).toEqual([{ id: wire.id, type: "arrow" }]);
    expect(at(update.elements, frame.id).boundElements).toEqual([{ id: wire.id, type: "arrow" }]);
  });
});

it("revives a plain wire without the spawn mark", () => {
  const wired = withWire([fleet, frame, lone], fleet.id, frame.id);
  const wire = wired[wired.length - 1];
  const gone = wired.filter((e) => e.id !== frame.id);
  scheduleWireUpkeep(api(gone), gone);
  frames.shift()!(0);
  const dropped = updateScene.mock.calls[0][0].elements.find((e: ExcalidrawElement) => e.id === wire.id);
  expect(dropped.customData.dummyplane).toEqual({ kind: "wire", orphaned: true });
  updateScene.mockClear();
  const undone = [...wired.filter((e) => e.id !== wire.id), dropped];
  scheduleWireUpkeep(api(undone), undone);
  frames.shift()!(0);
  expect(updateScene.mock.calls[0][0].elements.find((e: ExcalidrawElement) => e.id === wire.id).customData.dummyplane).toEqual({ kind: "wire" });
});

const PALETTES_TO_TRY: ThemeChoice[] = ["calm", "electric", "expressive"];

/** Runs one upkeep and returns the scene it wrote, or null when it wrote nothing. */
function upkeep(elements: ExcalidrawElement[]): ExcalidrawElement[] | null {
  updateScene.mockClear();
  scheduleWireUpkeep(api(elements), elements);
  if (frames.length === 0) return null;
  frames.shift()!(0);
  return updateScene.mock.calls[0]?.[0].elements ?? null;
}

/** A scene with a wire created under `palette`; `extra` overrides fields of the wire. */
function wireIn(palette: ThemeChoice, extra: Partial<ExcalidrawArrowElement> = {}) {
  const elements = withWire([fleet, frame, lone], fleet.id, frame.id, palette);
  const wire = { ...elements[elements.length - 1], ...extra } as ExcalidrawArrowElement;
  return { wire, scene: [...elements.slice(0, -1), wire] };
}

describe("wire colors follow the palette", () => {
  afterEach(() => themeStore.setState({ choice: "expressive" }));

  for (const from of PALETTES_TO_TRY) {
    for (const to of PALETTES_TO_TRY.filter((p) => p !== from)) {
      it(`recolors a ${from} wire to ${to}'s accent, outside the undo history`, () => {
        themeStore.setState({ choice: to });
        const { wire, scene } = wireIn(from);
        expect(wire.strokeColor).toBe(wireColor(from));
        const written = upkeep(scene)!;
        expect(updateScene.mock.calls[0][0].captureUpdate).toBe("never");
        const next = written.find((e) => e.id === wire.id)!;
        expect(next.strokeColor).toBe(wireColor(to));
        // Only the color changed: same route, same bindings, same mark.
        expect(next).toMatchObject({ points: wire.points, startBinding: wire.startBinding, endBinding: wire.endBinding, customData: wire.customData });
      });
    }
  }

  it("keeps a color the user picked through every palette switch", () => {
    const { wire, scene } = wireIn("expressive", { strokeColor: "#3F74A8" });
    for (const palette of PALETTES_TO_TRY) {
      themeStore.setState({ choice: palette });
      expect(upkeep(scene), palette).toBeNull();
    }
    expect(scene.find((e) => e.id === wire.id)!.strokeColor).toBe("#3F74A8");
  });

  it("does nothing when the wire already has the palette's color", () => {
    for (const palette of PALETTES_TO_TRY) {
      themeStore.setState({ choice: palette });
      expect(upkeep(wireIn(palette).scene), palette).toBeNull();
    }
  });

  it("recolors a wire an undo or a redo brought back in an older color", () => {
    themeStore.setState({ choice: "calm" });
    const { wire, scene } = wireIn("expressive");
    expect(upkeep(scene)!.find((e) => e.id === wire.id)!.strokeColor).toBe(wireColor("calm"));
  });

  it("follows the palette setting as it is changed", async () => {
    await setThemeChoice("electric");
    const { wire, scene } = wireIn("electric");
    expect(wire.strokeColor).toBe(wireColor("electric"));
    expect(upkeep(scene)).toBeNull();
    await setThemeChoice("calm");
    expect(upkeep(scene)!.find((e) => e.id === wire.id)!.strokeColor).toBe(wireColor("calm"));
  });

  it("lets a wire left without an end go before it is recolored", () => {
    themeStore.setState({ choice: "calm" });
    const { wire, scene } = wireIn("expressive");
    const endless = scene.filter((e) => e.id !== frame.id);
    expect(upkeep(endless)!.find((e) => e.id === wire.id)!.isDeleted).toBe(true);
  });
});
