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

const orchestrator = createNodeElement("orchestrator", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
const frame = createGroupFrame({ x: 600, y: 0, width: 900, height: 600 }, "B", { role: "backend", pantheon: "greek" }) as ExcalidrawElement;
const lone = createNodeElement("terminal", { x: 0, y: 900 }) as unknown as ExcalidrawElement;
const hand = { ...createWire(orchestrator, lone), customData: undefined } as ExcalidrawElement;

let frames: FrameRequestCallback[];
const updateScene = vi.fn();
const api = (elements: ExcalidrawElement[]) =>
  ({ getSceneElementsIncludingDeleted: () => elements, updateScene }) as unknown as ExcalidrawImperativeAPI;

beforeEach(() => {
  frames = [];
  updateScene.mockClear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
});
afterEach(() => vi.unstubAllGlobals());

it("marks a hand-drawn wire once, however many changes come before the frame (plan B3)", () => {
  const elements = [orchestrator, lone, hand];
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
  const wired = withWire([orchestrator, frame, lone], orchestrator.id, frame.id);
  const wire = wired[wired.length - 1];
  const elements = wired.filter((e) => e.id !== frame.id);
  scheduleWireUpkeep(api(elements), elements);
  frames.shift()!(0);
  const update = updateScene.mock.calls[0][0];
  expect(update.captureUpdate).toBe("never");
  expect(update.elements.find((e: ExcalidrawElement) => e.id === wire.id).isDeleted).toBe(true);
});

it("does nothing for a scene that needs nothing", () => {
  const elements = withWire([orchestrator, frame, lone], orchestrator.id, frame.id);
  scheduleWireUpkeep(api(elements), elements);
  expect(frames).toHaveLength(0);
});

it("brings a dropped wire back when its ends come back, as an undo does (plan B3)", () => {
  const wired = withWire([orchestrator, frame, lone], orchestrator.id, frame.id);
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
  const elements = withWire([orchestrator, frame, lone], orchestrator.id, frame.id, palette);
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
