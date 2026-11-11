import { describe, expect, it } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElbowArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createGroupFrame, framesFromScene } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { PALETTES, type ThemeChoice } from "@/app/theme";
import { displayColorFor, toDisplayColor, toSceneColor } from "@/theme/sceneColors";
import {
  agentLinksOf,
  boardAt,
  boardLinksOf,
  createWire,
  elbowWires,
  isPaletteWireColor,
  isSpawnWire,
  isWire,
  linkedAgents,
  linkTargetAt,
  missingSpawnWires,
  staleWireBindings,
  withSpawnWires,
  fleetAt,
  fleetLinks,
  fleetsOf,
  fleetTargets,
  orphanReason,
  orphanWires,
  outdatedWires,
  rerouteWires,
  revivableWires,
  unmarkedWires,
  wireColor,
  wireKindOf,
  withAgentLink,
  withBoardLink,
  withTalkWire,
  withWire,
} from "./wires";

const PALETTE_IDS = Object.keys(PALETTES) as ThemeChoice[];

/** Squared RGB distance between two #rrggbb colors. */
function distance(a: string, b: string): number {
  const channels = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i + 1, i + 3), 16));
  return channels(a).reduce((sum, c, i) => sum + (c - channels(b)[i]) ** 2, 0);
}

const fleet = createNodeElement("fleet", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
const frame = createGroupFrame({ x: 600, y: -300, width: 900, height: 600 }, "Backend", { role: "backend", pantheon: "greek" }) as ExcalidrawElement;
const member = { ...createNodeElement("terminal", { x: 1000, y: 0 }), frameId: frame.id } as unknown as ExcalidrawElement;
const lone = createNodeElement("terminal", { x: 0, y: 900 }) as unknown as ExcalidrawElement;
const plain = { ...frame, id: "plain", customData: undefined } as ExcalidrawElement;
const base = [fleet, frame, member, lone, plain];

/** An arrow drawn by hand: no mark, bound the other way round. */
function handDrawn(from: ExcalidrawElement, to: ExcalidrawElement): ExcalidrawElement {
  const wire = createWire(from, to);
  return { ...wire, id: `hand-${to.id}`, customData: undefined } as ExcalidrawElement;
}

/** A wire as createWire made them before they were elbowed: three points curving through the middle one. */
function curvedWire(from: ExcalidrawElement, to: ExcalidrawElement, strokeColor = "#C2603F"): ExcalidrawElement {
  const start = { x: from.x + from.width + 8, y: from.y + from.height / 2 };
  const dx = to.x - 8 - start.x;
  const dy = to.y + to.height / 2 - start.y;
  return {
    ...createWire(from, to),
    id: `curved-${to.id}`,
    x: start.x,
    y: start.y,
    width: dx,
    height: Math.abs(dy),
    strokeColor,
    roundness: { type: 2 },
    points: [[0, 0], [dx / 2, dy / 2 - dx * 0.12], [dx, dy]],
    startBinding: { elementId: from.id, focus: 0, gap: 8 },
    endBinding: { elementId: to.id, focus: 0, gap: 8 },
    elbowed: false,
    fixedSegments: undefined,
    startIsSpecial: undefined,
    endIsSpecial: undefined,
    version: 3,
    versionNonce: 42,
  } as unknown as ExcalidrawElement;
}

/** Every segment runs straight across or straight down. */
const orthogonal = (points: readonly (readonly number[])[]) => points.slice(1).every(([x, y], i) => x === points[i][0] || y === points[i][1]);

/** A wire's ends on the scene. */
const ends = (wire: ExcalidrawArrowElement) => {
  const last = wire.points[wire.points.length - 1];
  return { start: { x: wire.x + wire.points[0][0], y: wire.y + wire.points[0][1] }, end: { x: wire.x + last[0], y: wire.y + last[1] } };
};

/** Where Excalidraw puts a fixed point on the scene (getGlobalFixedPointForBindableElement, unrotated). */
const fixedOnScene = (element: ExcalidrawElement, [rx, ry]: readonly number[]) => ({ x: element.x + element.width * rx, y: element.y + element.height * ry });

describe("withWire / createWire", () => {
  it("adds an orange elbow arrow without heads, bound at both ends", () => {
    const elements = withWire(base, fleet.id, frame.id);
    const wire = elements[elements.length - 1] as ExcalidrawElbowArrowElement;
    expect(wire).toMatchObject({
      type: "arrow",
      strokeColor: wireColor("expressive"),
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 0,
      roundness: null,
      elbowed: true,
      fixedSegments: null,
      startIsSpecial: false,
      endIsSpecial: false,
      startArrowhead: null,
      endArrowhead: null,
      startBinding: { elementId: fleet.id },
      endBinding: { elementId: frame.id },
      customData: { dummyplane: { kind: "wire" } },
    });
    expect(isWire(wire)).toBe(true);
    const bound = (id: string) => elements.find((e) => e.id === id)?.boundElements;
    expect(bound(fleet.id)).toEqual([{ id: wire.id, type: "arrow" }]);
    expect(bound(frame.id)).toEqual([{ id: wire.id, type: "arrow" }]);
  });

  it("does not wire the same target twice", () => {
    const once = withWire(base, fleet.id, lone.id);
    expect(withWire(once, fleet.id, lone.id)).toHaveLength(once.length);
  });

  it("is drawn in the default palette's accent as the dark filter shows it", () => {
    expect(wireColor("expressive")).toBe(toSceneColor("#F4F4F1"));
    expect(wireColor("expressive")).toBe("#000000");
  });

  it("is drawn in the accent of the palette it is created under", () => {
    expect(wireColor("calm")).toBe("#173F32");
    expect(wireColor("electric")).toBe("#010001");
    for (const palette of PALETTE_IDS) {
      expect(createWire(fleet, lone, palette).strokeColor, palette).toBe(wireColor(palette));
      const elements = withWire(base, fleet.id, lone.id, palette);
      expect(elements[elements.length - 1].strokeColor, palette).toBe(wireColor(palette));
    }
  });

  it("shows each palette's accent as close as its scheme allows: the light one as is, the dark ones through the filter", () => {
    expect(displayColorFor(wireColor("calm"), "light")).toBe(PALETTES.calm.accent);
    expect(displayColorFor(wireColor("expressive"), "dark")).toBe("#ededed");
    expect(displayColorFor(wireColor("electric"), "dark")).toBe("#eeedee");
  });

  it("stores electric's off-white where the filter shows it nearer than the plain inverse does", () => {
    const accent = PALETTES.electric.accent;
    const plain = toDisplayColor(toSceneColor(accent));
    expect(plain).toBe("#ededed");
    expect(distance(toDisplayColor(wireColor("electric")), accent)).toBeLessThan(distance(plain, accent));
  });

  it("gives each palette its own color", () => {
    expect(new Set(PALETTE_IDS.map((palette) => wireColor(palette).toLowerCase())).size).toBe(PALETTE_IDS.length);
  });

  it("goes out across, down half way, and in across to a target aside, from the facing sides", () => {
    const aside = createNodeElement("terminal", { x: 1200, y: 600 }) as unknown as ExcalidrawElement;
    const wire = createWire(fleet, aside);
    expect(wire.points).toHaveLength(4);
    expect(orthogonal(wire.points)).toBe(true);
    const [, bend, , last] = wire.points;
    expect(bend[1]).toBe(0);
    expect(bend[0]).toBeCloseTo(last[0] / 2);
    // Out of the fleet's right side, into the target's left side, 5 px off each (Excalidraw's FIXED_BINDING_DISTANCE).
    expect(wire.startBinding!.fixedPoint).toEqual([1 + 5 / fleet.width, 0.5001]);
    expect(wire.endBinding!.fixedPoint).toEqual([-5 / aside.width, 0.5001]);
    const { start, end } = ends(wire);
    expect(start).toEqual(fixedOnScene(fleet, wire.startBinding!.fixedPoint));
    expect(end.x).toBeCloseTo(fixedOnScene(aside, wire.endBinding!.fixedPoint).x);
    expect(end.y).toBeCloseTo(fixedOnScene(aside, wire.endBinding!.fixedPoint).y);
    expect(start.x - (fleet.x + fleet.width)).toBeCloseTo(5);
    expect(aside.x - end.x).toBeCloseTo(5);
    expect(wire).toMatchObject({ width: last[0], height: last[1] });
  });

  it("leaves from the left side for a target on the left", () => {
    const left = createNodeElement("terminal", { x: -1200, y: -600 }) as unknown as ExcalidrawElement;
    const wire = createWire(fleet, left);
    expect(orthogonal(wire.points)).toBe(true);
    expect(wire.points[1][0]).toBeLessThan(0);
    expect(wire.startBinding!.fixedPoint[0]).toBeLessThan(0);
    expect(wire.endBinding!.fixedPoint[0]).toBeGreaterThan(1);
  });

  it("goes down then across for a target under the fleet, never back through it", () => {
    const under = createNodeElement("terminal", { x: 300, y: 1200 }) as unknown as ExcalidrawElement;
    const wire = createWire(fleet, under);
    expect(wire.points).toHaveLength(4);
    expect(orthogonal(wire.points)).toBe(true);
    expect(wire.points[1]).toEqual([0, wire.points[1][1]]);
    expect(wire.points[1][1]).toBeGreaterThan(0);
    expect(wire.startBinding!.fixedPoint).toEqual([0.5001, 1 + 5 / fleet.height]);
    expect(wire.endBinding!.fixedPoint).toEqual([0.5001, -5 / under.height]);
    // Right under it: straight down, out of the bottom.
    const straight = createWire(fleet, lone);
    expect(straight.points).toHaveLength(2);
    expect(straight.points[1][0]).toBe(0);
    expect(straight.points[1][1]).toBeGreaterThan(0);
    // Above it: up.
    const above = createWire(fleet, createNodeElement("terminal", { x: 300, y: -1200 }) as unknown as ExcalidrawElement);
    expect(above.points[1][1]).toBeLessThan(0);
  });

  it("is one straight segment between level sides", () => {
    const wire = createWire(fleet, frame);
    expect(wire.points).toHaveLength(2);
    expect(wire.points[1][1]).toBe(0);
    expect(wire.points[1][0]).toBeGreaterThan(0);
  });

  it("goes around when the fleet stands on its group's frame", () => {
    const inside = createNodeElement("fleet", { x: 1000, y: 0 }) as unknown as ExcalidrawElement;
    const wire = createWire(inside, frame);
    expect(orthogonal(wire.points)).toBe(true);
    // Out to the left of both, then into the frame's left side from outside.
    const [, out, , last] = wire.points;
    expect(out[0]).toBeLessThan(last[0]);
    expect(out[0]).toBeLessThan(0);
    expect(wire.endBinding!.fixedPoint[0]).toBeLessThan(0);
  });
});

describe("elbowWires (wires saved before they were elbowed)", () => {
  const scene = (...extra: ExcalidrawElement[]) => [...base, ...extra];

  it("elbows a curved wire with the same id and ends, bound by fixed points", () => {
    const curved = curvedWire(fleet, member);
    const elements = scene(curved);
    const migrated = elbowWires(elements);
    const wire = migrated.find((e) => e.id === curved.id) as ExcalidrawElbowArrowElement;
    expect(wire).toMatchObject({
      elbowed: true,
      roundness: null,
      roughness: 0,
      fixedSegments: null,
      strokeColor: wireColor("expressive"),
      version: 4,
      startBinding: { elementId: fleet.id, fixedPoint: [1 + 5 / fleet.width, 0.5001] },
      endBinding: { elementId: member.id, fixedPoint: [-5 / member.width, 0.5001] },
      customData: { dummyplane: { kind: "wire" } },
    });
    expect(wire.versionNonce).not.toBe(42);
    expect(orthogonal(wire.points)).toBe(true);
    expect(ends(wire).start).toEqual(fixedOnScene(fleet, wire.startBinding!.fixedPoint));
    // Everything else is the same element.
    base.forEach((e, i) => expect(migrated[i]).toBe(e));
    // Still the same link.
    expect(fleetTargets(migrated, fleet.id)).toEqual(fleetTargets(elements, fleet.id));
  });

  it("gives a former terracotta wire the color of the palette it is elbowed under", () => {
    const curved = curvedWire(fleet, lone);
    for (const palette of PALETTE_IDS) {
      const wire = elbowWires(scene(curved), palette).find((e) => e.id === curved.id);
      expect(wire?.strokeColor, palette).toBe(wireColor(palette));
    }
  });

  it("keeps a colour picked for the wire, and its heads", () => {
    const picked = { ...curvedWire(fleet, lone, "#3F74A8"), endArrowhead: "arrow" } as ExcalidrawElement;
    const wire = elbowWires(scene(picked)).find((e) => e.id === picked.id) as ExcalidrawElbowArrowElement;
    expect(wire).toMatchObject({ elbowed: true, strokeColor: "#3F74A8", endArrowhead: "arrow" });
  });

  it("routes a wire drawn from its target from the target, as it is bound", () => {
    const reversed = { ...curvedWire(fleet, lone), startBinding: { elementId: lone.id, focus: 0, gap: 8 }, endBinding: { elementId: fleet.id, focus: 0, gap: 8 } } as ExcalidrawElement;
    const wire = elbowWires(scene(reversed)).find((e) => e.id === reversed.id) as ExcalidrawElbowArrowElement;
    expect(wire.startBinding!.elementId).toBe(lone.id);
    expect(wire.endBinding!.elementId).toBe(fleet.id);
    // Up out of the terminal's top, into the fleet's bottom.
    expect(wire.points[wire.points.length - 1][1]).toBeLessThan(0);
    expect(wire.startBinding!.fixedPoint[1]).toBeLessThan(0);
    expect(wire.endBinding!.fixedPoint[1]).toBeGreaterThan(1);
  });

  it("elbows a deleted wire too, which an undo may bring back", () => {
    const dropped = { ...curvedWire(fleet, lone), isDeleted: true } as ExcalidrawElement;
    expect(elbowWires(scene(dropped)).find((e) => e.id === dropped.id)).toMatchObject({ elbowed: true, isDeleted: true });
  });

  it("leaves plain arrows, elbowed wires and wires without an end alone", () => {
    const plainArrow = { ...curvedWire(fleet, lone), id: "plain-arrow", customData: undefined } as ExcalidrawElement;
    const elbowed = withWire(base, fleet.id, frame.id)[base.length];
    const endless = { ...curvedWire(fleet, lone), id: "endless", endBinding: null } as ExcalidrawElement;
    const gone = { ...curvedWire(fleet, lone), id: "gone", endBinding: { elementId: "nowhere", focus: 0, gap: 8 } } as ExcalidrawElement;
    const elements = scene(plainArrow, elbowed, endless, gone);
    expect(elbowWires(elements)).toBe(elements);
  });
});

describe("outdatedWires (a palette change recolors the wires, not the user's colors)", () => {
  const wireIn = (color: string, id = "w"): ExcalidrawElement => ({ ...createWire(fleet, lone, "expressive"), id, strokeColor: color });

  it("finds the wires in another palette's color, whichever palette they came from", () => {
    for (const to of PALETTE_IDS) {
      for (const from of PALETTE_IDS.filter((p) => p !== to)) {
        expect(outdatedWires([wireIn(wireColor(from))], to), `${from} to ${to}`).toEqual(["w"]);
      }
    }
  });

  it("leaves a wire already in the palette's color alone", () => {
    for (const palette of PALETTE_IDS) expect(outdatedWires([wireIn(wireColor(palette))], palette), palette).toEqual([]);
  });

  it("matches colors whatever their case", () => {
    expect(outdatedWires([wireIn(wireColor("calm").toLowerCase())], "expressive")).toEqual(["w"]);
    expect(outdatedWires([wireIn(wireColor("expressive").toUpperCase())], "expressive")).toEqual([]);
  });

  it("keeps a color the user picked, in any palette", () => {
    for (const palette of PALETTE_IDS) {
      expect(outdatedWires([wireIn("#3F74A8"), wireIn("#1e1e1e", "w2")], palette), palette).toEqual([]);
    }
  });

  it("recolors wires saved in a palette's former accent (calm's pink and the others'), which the user never picked", () => {
    for (const former of ["#F52B94", "#546100", "#f25500"]) {
      expect(isPaletteWireColor(former), former).toBe(true);
      for (const palette of PALETTE_IDS) expect(outdatedWires([wireIn(former)], palette), `${former} in ${palette}`).toEqual(["w"]);
    }
    expect(isPaletteWireColor("#3F74A8")).toBe(false);
  });

  it("looks at live wires only: not deleted ones, not plain arrows", () => {
    const old = wireColor("calm");
    const deleted = { ...wireIn(old, "gone"), isDeleted: true } as ExcalidrawElement;
    const plainArrow = { ...wireIn(old, "plain-arrow"), customData: undefined } as ExcalidrawElement;
    expect(outdatedWires([deleted, plainArrow, wireIn(old)], "expressive")).toEqual(["w"]);
  });
});

describe("fleetTargets", () => {
  it("finds the groups and terminals wired to the fleet, either way round", () => {
    const elements = [...withWire(base, fleet.id, frame.id), handDrawn(lone, fleet)];
    expect(fleetTargets(elements, fleet.id)).toEqual({ groupIds: [frame.id], nodeIds: [lone.id] });
  });

  it("drops deleted arrows, deleted targets and plain frames", () => {
    const wired = withWire(withWire(base, fleet.id, frame.id), fleet.id, plain.id);
    const arrows = wired.filter((e) => e.type === "arrow");
    expect(fleetTargets(wired, fleet.id)).toEqual({ groupIds: [frame.id], nodeIds: [] });
    const cut = wired.map((e) => (e.id === arrows[0].id ? { ...e, isDeleted: true } : e));
    expect(fleetTargets(cut, fleet.id).groupIds).toEqual([]);
    const gone = wired.map((e) => (e.id === frame.id ? { ...e, isDeleted: true } : e));
    expect(fleetTargets(gone, fleet.id).groupIds).toEqual([]);
  });

  it("maps every fleet of the scene", () => {
    const elements = withWire(base, fleet.id, lone.id);
    expect(fleetLinks(elements)).toEqual({ [fleet.id]: { groupIds: [], nodeIds: [lone.id] } });
  });
});

describe("unmarkedWires", () => {
  it("lists the hand-drawn arrows between a fleet and a target", () => {
    const hand = handDrawn(fleet, lone);
    const stray = { ...handDrawn(member, lone), id: "stray" } as ExcalidrawElement;
    const elements = [...withWire(base, fleet.id, frame.id), hand, stray];
    expect(unmarkedWires(elements)).toEqual([hand.id]);
  });
});

describe("linkTargetAt", () => {
  it("links a lone terminal, and the group of a terminal inside one", () => {
    const frames = framesFromScene(base);
    expect(linkTargetAt(base, frames, { x: lone.x + 10, y: lone.y + 10 })).toBe(lone.id);
    expect(linkTargetAt(base, frames, { x: member.x + 10, y: member.y + 10 })).toBe(frame.id);
    expect(linkTargetAt(base, frames, { x: frame.x + 5, y: frame.y + 5 })).toBe(frame.id);
    expect(linkTargetAt(base, frames, { x: -5000, y: -5000 })).toBeNull();
  });
});

describe("fleetAt (an agent's Link)", () => {
  it("finds the fleet under the pointer, never a terminal or a group", () => {
    expect(fleetAt(base, { x: fleet.x + 10, y: fleet.y + 10 })).toBe(fleet.id);
    expect(fleetAt(base, { x: lone.x + 10, y: lone.y + 10 })).toBeNull();
    expect(fleetAt(base, { x: frame.x + 5, y: frame.y + 5 })).toBeNull();
    expect(fleetAt([{ ...fleet, isDeleted: true }], { x: fleet.x + 10, y: fleet.y + 10 })).toBeNull();
  });
});

describe("fleetsOf (linkedAgents the other way round)", () => {
  it("names the fleets wired to an agent, directly or through its group", () => {
    const frames = framesFromScene(base);
    const links = { atlas: { groupIds: [frame.id], nodeIds: [] }, cyclops: { groupIds: [], nodeIds: [lone.id] }, idle: { groupIds: [], nodeIds: [] } };
    expect(fleetsOf(member.id, links, frames)).toEqual(["atlas"]);
    expect(fleetsOf(lone.id, links, frames)).toEqual(["cyclops"]);
    expect(fleetsOf("nobody", links, frames)).toEqual([]);
  });
});

describe("linkedAgents", () => {
  it("lists the agents of the wired groups, then the terminals wired directly", () => {
    const frames = framesFromScene(base);
    expect(linkedAgents({ groupIds: [frame.id], nodeIds: [lone.id, member.id] }, frames)).toEqual({
      groups: [frames.find((f) => f.id === frame.id)],
      directIds: [lone.id],
      agentIds: [member.id, lone.id],
    });
  });
});

describe("orphanWires", () => {
  const withoutIds = (elements: ExcalidrawElement[], ...ids: string[]) =>
    elements.map((e) => (ids.includes(e.id) ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));

  it("lists the wires whose target or fleet is gone, whatever way it went", () => {
    const wired = withWire(base, fleet.id, frame.id);
    const wire = wired[wired.length - 1];
    expect(orphanWires(wired)).toEqual([]);
    expect(orphanWires(withoutIds(wired, frame.id))).toEqual([wire.id]);
    expect(orphanWires(withoutIds(wired, fleet.id))).toEqual([wire.id]);
    // Ungroup or Delete: the element left the scene, the arrow lost its binding.
    expect(orphanWires(wired.filter((e) => e.id !== frame.id))).toEqual([wire.id]);
    const unbound = wired.map((e) => (e.id === wire.id ? ({ ...e, endBinding: null } as ExcalidrawElement) : e));
    expect(orphanWires(unbound)).toEqual([wire.id]);
  });

  it("keeps a plain arrow and an already deleted wire out of the list", () => {
    const wired = withWire(base, fleet.id, frame.id);
    const wire = wired[wired.length - 1];
    const plainArrow = { ...handDrawn(fleet, lone), customData: undefined, endBinding: null } as ExcalidrawElement;
    expect(orphanWires([...withoutIds(wired, frame.id, wire.id), plainArrow])).toEqual([]);
  });

  it("does not take an ungrouped frame for a gone target: a plain frame is no wire target", () => {
    const wired = withWire(base, fleet.id, frame.id);
    const ungrouped = wired.map((e) => (e.id === frame.id ? ({ ...e, customData: undefined } as ExcalidrawElement) : e));
    expect(orphanWires(ungrouped)).toEqual([wired[wired.length - 1].id]);
  });

  it("gives, for the log, a fleet wire's kind and an end that is no longer something a wire joins", () => {
    const wired = withWire(base, fleet.id, frame.id);
    const wire = wired[wired.length - 1];
    const ungrouped = wired.map((e) => (e.id === frame.id ? ({ ...e, customData: undefined } as ExcalidrawElement) : e));
    expect(orphanReason(wire, new Map(ungrouped.map((e) => [e.id, e])))).toBe(
      `wire ${wire.id} (fleet) deleted as orphaned: start ${fleet.id} ok; end ${frame.id} not a valid end (frame); listed by ${fleet.id}, ${frame.id}`,
    );
    // The fleet deleted: still a fleet's wire.
    const fleetGone = withoutIds(wired, fleet.id);
    expect(wireKindOf(wire, new Map(fleetGone.map((e) => [e.id, e])))).toBe("fleet");
  });

  it("calls a wire between two agents that is no spawn wire a link", () => {
    const peer = createNodeElement("terminal", { x: 1200, y: 900 }) as unknown as ExcalidrawElement;
    const linked = withAgentLink([lone, peer], lone.id, peer.id);
    const wire = linked[linked.length - 1];
    const byId = new Map(withoutIds(linked, peer.id).map((e) => [e.id, e]));
    expect(orphanReason(wire, byId)).toBe(`wire ${wire.id} (link) deleted as orphaned: start ${lone.id} ok; end ${peer.id} deleted; listed by ${lone.id}`);
  });
});

describe("revivableWires", () => {
  it("lists a wire the upkeep deleted once both its ends are back, as an undo brings them", () => {
    const wired = withWire(base, fleet.id, frame.id);
    const wire = wired[wired.length - 1];
    const dropped = { ...wire, isDeleted: true, customData: { dummyplane: { kind: "wire", orphaned: true } } } as ExcalidrawElement;
    const scene = [...wired.slice(0, -1), dropped];
    expect(revivableWires(scene)).toEqual([wire.id]);
    // Its target is still gone: nothing to bring back.
    expect(revivableWires(scene.map((e) => (e.id === frame.id ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e)))).toEqual([]);
    // A wire the user deleted (no orphan mark) stays deleted.
    const byUser = { ...dropped, customData: { dummyplane: { kind: "wire" } } } as ExcalidrawElement;
    expect(revivableWires([...wired.slice(0, -1), byUser])).toEqual([]);
    // Unbound again (the end came back, not the binding): not yet.
    const unbound = { ...dropped, endBinding: null } as ExcalidrawElement;
    expect(revivableWires([...wired.slice(0, -1), unbound])).toEqual([]);
  });

  it("brings none back between two ends a live arrow joins already (a spawn wire re-created meanwhile)", () => {
    const child = createNodeElement("terminal", { x: 1200, y: 900 }) as unknown as ExcalidrawElement;
    const first = withWire([lone, child], lone.id, child.id, "calm", true);
    const old = first[first.length - 1];
    const dropped = { ...old, isDeleted: true, customData: { dummyplane: { kind: "wire", spawn: true, orphaned: true } } } as ExcalidrawElement;
    // The fresh wire the upkeep made, the old one deleted beside it with both bindings back (an undo).
    const fresh = createWire(lone, child, "calm", true);
    expect(revivableWires([lone, child, dropped, fresh])).toEqual([]);
    expect(revivableWires([lone, child, dropped])).toEqual([old.id]);
  });
});

describe("rerouteWires (a node the app resizes: Excalidraw reroutes only what the user moves)", () => {
  const wire = createWire(fleet, member);
  const toLone = createWire(fleet, lone);
  const shrunk = { ...member, height: 68 } as ExcalidrawElement;

  it("routes the wires bound to the node again between their ends as they stand, and leaves the rest", () => {
    const elements = [fleet, frame, shrunk, lone, plain, wire, toLone];
    const next = rerouteWires(elements, new Set([member.id]));
    const rerouted = next[5] as ExcalidrawElbowArrowElement;
    expect(rerouted).toMatchObject({
      id: wire.id,
      elbowed: true,
      version: wire.version + 1,
      startBinding: { elementId: fleet.id },
      endBinding: { elementId: member.id },
      customData: { dummyplane: { kind: "wire" } },
    });
    expect(orthogonal(rerouted.points)).toBe(true);
    // Its end on the middle of the shrunk node's side, no longer where the full node had it.
    const end = fixedOnScene(shrunk, rerouted.endBinding!.fixedPoint);
    expect(ends(rerouted).end.x).toBeCloseTo(end.x);
    expect(ends(rerouted).end.y).toBeCloseTo(end.y);
    expect(ends(rerouted).end.y).not.toBeCloseTo(ends(wire).end.y);
    [0, 1, 2, 3, 4, 6].forEach((i) => expect(next[i]).toBe(elements[i]));
  });

  it("returns the scene itself when no live wire joins the nodes to a live end", () => {
    const elements = [fleet, frame, shrunk, lone, plain, wire];
    expect(rerouteWires(elements, new Set([plain.id]))).toBe(elements);
    expect(rerouteWires(base, new Set([member.id]))).toBe(base);
    const left = [fleet, shrunk, { ...wire, isDeleted: true } as ExcalidrawElement, handDrawn(fleet, member)];
    expect(rerouteWires(left, new Set([member.id]))).toBe(left);
    // Its other end is gone.
    const alone = [shrunk, wire];
    expect(rerouteWires(alone, new Set([member.id]))).toBe(alone);
  });
});

describe("spawn wires (spawn_agent)", () => {
  /** A sub-agent its terminal `lone` spawned, on its right. */
  const child = createNodeElement("terminal", { x: 1200, y: 900 }) as unknown as ExcalidrawElement;
  const spawned = () => {
    const elements = withWire([...base, child], lone.id, child.id, "expressive", true);
    return { elements, wire: elements[elements.length - 1] as ExcalidrawElbowArrowElement };
  };
  const withoutIds = (elements: ExcalidrawElement[], ...ids: string[]) =>
    elements.map((e) => (ids.includes(e.id) ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));

  it("joins the parent terminal to the sub-agent it spawned, marked as a spawn wire", () => {
    const { elements, wire } = spawned();
    expect(wire).toMatchObject({
      type: "arrow",
      elbowed: true,
      strokeColor: wireColor("expressive"),
      startBinding: { elementId: lone.id },
      endBinding: { elementId: child.id },
    });
    expect(wire.customData).toEqual({ dummyplane: { kind: "wire", spawn: true } });
    expect(isWire(wire)).toBe(true);
    expect(isSpawnWire(wire)).toBe(true);
    const bound = (id: string) => elements.find((e) => e.id === id)?.boundElements;
    expect(bound(lone.id)).toEqual([{ id: wire.id, type: "arrow" }]);
    expect(bound(child.id)).toEqual([{ id: wire.id, type: "arrow" }]);
    // Not twice.
    expect(withWire(elements, lone.id, child.id, "expressive", true)).toHaveLength(elements.length);
  });

  it("is not made by default, nor read on a plain wire or arrow", () => {
    expect(isSpawnWire(createWire(lone, child))).toBe(false);
    const plainWire = withWire([...base, child], lone.id, child.id);
    expect(isSpawnWire(plainWire[plainWire.length - 1])).toBe(false);
    expect(isSpawnWire(handDrawn(lone, child))).toBe(false);
    // The spawn flag alone, without the wire kind, is no wire.
    expect(isSpawnWire({ ...createWire(lone, child), customData: { dummyplane: { spawn: true } } } as ExcalidrawElement)).toBe(false);
  });

  it("stays while both terminals live, and goes once the sub-agent is closed", () => {
    const { elements, wire } = spawned();
    expect(orphanWires(elements)).toEqual([]);
    expect(orphanWires(withoutIds(elements, child.id))).toEqual([wire.id]);
    expect(orphanWires(withoutIds(elements, lone.id))).toEqual([wire.id]);
    expect(orphanWires(elements.filter((e) => e.id !== child.id))).toEqual([wire.id]);
  });

  it("comes back with the sub-agent an undo brings back", () => {
    const { elements, wire } = spawned();
    const dropped = { ...wire, isDeleted: true, customData: { dummyplane: { kind: "wire", spawn: true, orphaned: true } } } as ExcalidrawElement;
    const scene = [...elements.slice(0, -1), dropped];
    expect(revivableWires(scene)).toEqual([wire.id]);
    expect(revivableWires(withoutIds(scene, child.id))).toEqual([]);
  });

  it("is no fleet's link", () => {
    const { elements } = spawned();
    expect(fleetLinks(elements)).toEqual({ [fleet.id]: { groupIds: [], nodeIds: [] } });
    expect(unmarkedWires(elements)).toEqual([]);
  });

  it("says, when it goes, that it is a spawn wire and which end failed, and why", () => {
    const { elements, wire } = spawned();
    const byId = (scene: readonly ExcalidrawElement[]) => new Map(scene.map((e) => [e.id, e]));
    const closed = withoutIds(elements, child.id);
    expect(orphanReason(wire, byId(closed))).toBe(`wire ${wire.id} (spawn) deleted as orphaned: start ${lone.id} ok; end ${child.id} deleted; listed by ${lone.id}`);
    const gone = elements.filter((e) => e.id !== lone.id);
    expect(orphanReason(wire, byId(gone))).toBe(`wire ${wire.id} (spawn) deleted as orphaned: start ${lone.id} missing; end ${child.id} ok; listed by ${child.id}`);
    // Excalidraw unbinding the child's end takes the wire off the child's list too: only the parent still lists it.
    const unbound = { ...wire, endBinding: null } as ExcalidrawElement;
    const unlisted = elements.map((e) => (e.id === child.id ? ({ ...e, boundElements: [] } as ExcalidrawElement) : e.id === wire.id ? unbound : e));
    expect(orphanReason(unbound, byId(unlisted))).toBe(`wire ${wire.id} (spawn) deleted as orphaned: start ${lone.id} ok; end unbound; listed by ${lone.id}`);
  });

  it("adds what the canvas was doing when it went: the selection, a drag and the tool", () => {
    const { elements, wire } = spawned();
    const byId = new Map(withoutIds(elements, child.id).map((e) => [e.id, e]));
    expect(orphanReason(wire, byId, { selectedIds: [lone.id, wire.id, frame.id], dragging: true, tool: "selection" })).toBe(
      `wire ${wire.id} (spawn) deleted as orphaned: start ${lone.id} ok; end ${child.id} deleted; listed by ${lone.id}; selection 3 (wire yes, frame yes), dragging yes, tool selection`,
    );
    expect(orphanReason(wire, byId, { selectedIds: [], dragging: false, tool: "eraser" })).toMatch(/; selection 0 \(wire no, frame no\), dragging no, tool eraser$/);
  });

  it("keeps its mark and its color when a minimized end reroutes it", () => {
    const { elements, wire } = spawned();
    const shrunk = elements.map((e) => (e.id === child.id ? ({ ...e, height: 68 } as ExcalidrawElement) : e));
    const rerouted = rerouteWires(shrunk, new Set([child.id])).find((e) => e.id === wire.id) as ExcalidrawElbowArrowElement;
    expect(rerouted.version).toBe(wire.version + 1);
    expect(isSpawnWire(rerouted)).toBe(true);
    expect(rerouted.strokeColor).toBe(wire.strokeColor);
  });
});

describe("a Fleet's spawn wire (spawn_agent from a Fleet)", () => {
  /** A sub-agent the Fleet `fleet` spawned, on its right. */
  const kid = createNodeElement("terminal", { x: 1200, y: 0 }) as unknown as ExcalidrawElement;
  const spawned = () => withWire([...base, kid], fleet.id, kid.id, "calm", true);
  const wireOf = (elements: readonly ExcalidrawElement[]) => elements.find((e) => e.type === "arrow" && !e.isDeleted && isSpawnWire(e))!;

  it("joins the Fleet to its sub-agent, marked as a spawn wire, and is drawn once", () => {
    const elements = spawned();
    const wire = wireOf(elements);
    expect(wire).toMatchObject({ startBinding: { elementId: fleet.id }, endBinding: { elementId: kid.id } });
    expect(wireKindOf(wire, new Map(elements.map((e) => [e.id, e])))).toBe("spawn");
    expect(withWire(elements, fleet.id, kid.id, "calm", true)).toHaveLength(elements.length);
    expect(orphanWires(elements)).toEqual([]);
  });

  it("does not put the sub-agent on the Fleet's team: no link, no commander", () => {
    const elements = spawned();
    expect(fleetTargets(elements, fleet.id)).toEqual({ groupIds: [], nodeIds: [] });
    const links = fleetLinks(elements);
    expect(fleetsOf(kid.id, links, framesFromScene(elements))).toEqual([]);
    expect(unmarkedWires(elements)).toEqual([]);
    // Linked by hand afterwards, it is on the team: a fleet wire of its own.
    const linked = withWire(elements, fleet.id, kid.id, "calm");
    expect(linked).toHaveLength(elements.length + 1);
    expect(fleetTargets(linked, fleet.id).nodeIds).toEqual([kid.id]);
  });

  it("is given back by the upkeep when it is missing, as an agent's is", () => {
    const spawnerOf = (id: string) => (id === kid.id ? fleet.id : undefined);
    expect(missingSpawnWires([...base, kid], spawnerOf)).toEqual([{ parentId: fleet.id, childId: kid.id }]);
    const { elements } = withSpawnWires([...base, kid], spawnerOf, "calm");
    expect(wireOf(elements)).toMatchObject({ startBinding: { elementId: fleet.id }, endBinding: { elementId: kid.id } });
    expect(missingSpawnWires(elements, spawnerOf)).toEqual([]);
    // A closed Fleet gives none.
    const closed = [...base, kid].map((e) => (e.id === fleet.id ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
    expect(missingSpawnWires(closed, spawnerOf)).toEqual([]);
  });
});

describe("missing spawn wires (a spawn wire shows the child's spawnedBy)", () => {
  /** `lone` spawned `child`; `other` is nobody's. */
  const child = createNodeElement("terminal", { x: 1200, y: 900 }) as unknown as ExcalidrawElement;
  const other = createNodeElement("terminal", { x: 1200, y: 2000 }) as unknown as ExcalidrawElement;
  const spawnerOf = (id: string) => (id === child.id ? lone.id : undefined);
  const scene = [...base, child, other];
  const arrows = (elements: readonly ExcalidrawElement[]) => elements.filter((e) => e.type === "arrow" && !e.isDeleted) as ExcalidrawArrowElement[];
  const deleted = (elements: readonly ExcalidrawElement[], id: string) => elements.map((e) => (e.id === id ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));

  it("finds a sub-agent and its live spawner with no wire between them, and gives them one", () => {
    expect(missingSpawnWires(scene, spawnerOf)).toEqual([{ parentId: lone.id, childId: child.id }]);
    const { elements, added } = withSpawnWires(scene, spawnerOf, "calm");
    expect(added).toEqual([{ parentId: lone.id, childId: child.id }]);
    const [wire] = arrows(elements);
    expect(wire).toMatchObject({ startBinding: { elementId: lone.id }, endBinding: { elementId: child.id }, strokeColor: wireColor("calm") });
    expect(isSpawnWire(wire)).toBe(true);
    expect(elements.find((e) => e.id === lone.id)!.boundElements).toEqual([{ id: wire.id, type: "arrow" }]);
    expect(elements.find((e) => e.id === child.id)!.boundElements).toEqual([{ id: wire.id, type: "arrow" }]);
  });

  it("keeps the wire already there: a spawn wire, or a + Link either way round", () => {
    expect(missingSpawnWires(withWire(scene, lone.id, child.id, "calm", true), spawnerOf)).toEqual([]);
    expect(missingSpawnWires(withAgentLink(scene, child.id, lone.id), spawnerOf)).toEqual([]);
    expect(missingSpawnWires(withAgentLink(scene, lone.id, child.id), spawnerOf)).toEqual([]);
  });

  it("gives none when the spawner is closed or in another workspace, nor to a closed sub-agent", () => {
    expect(missingSpawnWires(deleted(scene, lone.id), spawnerOf)).toEqual([]);
    expect(missingSpawnWires(scene.filter((e) => e.id !== lone.id), spawnerOf)).toEqual([]);
    expect(missingSpawnWires(deleted(scene, child.id), spawnerOf)).toEqual([]);
    expect(missingSpawnWires(scene, () => undefined)).toEqual([]);
  });

  it("replaces a deleted wire, and one with an end unbound", () => {
    const wired = withWire(scene, lone.id, child.id, "calm", true);
    const wire = wired[wired.length - 1];
    expect(missingSpawnWires(deleted(wired, wire.id), spawnerOf)).toEqual([{ parentId: lone.id, childId: child.id }]);
    const unbound = wired.map((e) => (e.id === wire.id ? ({ ...e, endBinding: null } as ExcalidrawElement) : e));
    expect(missingSpawnWires(unbound, spawnerOf)).toEqual([{ parentId: lone.id, childId: child.id }]);
  });

  it("adds no second wire on a second pass", () => {
    const once = withSpawnWires(scene, spawnerOf, "calm").elements;
    const twice = withSpawnWires(once, spawnerOf, "calm");
    expect(twice.added).toEqual([]);
    expect(twice.elements).toBe(once);
    expect(arrows(twice.elements)).toHaveLength(1);
  });

  it("finds the live elements that still list a deleted wire", () => {
    const wired = withWire(scene, lone.id, child.id, "calm", true);
    const wire = wired[wired.length - 1];
    expect(staleWireBindings(wired)).toEqual([]);
    expect(staleWireBindings(deleted(wired, wire.id))).toEqual([lone.id, child.id]);
    // A deleted end is not live: only the other one is stale.
    expect(staleWireBindings(deleted(deleted(wired, wire.id), child.id))).toEqual([lone.id]);
  });
});

describe("agent links (two agents wired without a fleet)", () => {
  /** Another agent, below-right of `lone`. */
  const peer = createNodeElement("terminal", { x: 1200, y: 900 }) as unknown as ExcalidrawElement;
  const linked = () => {
    const elements = withAgentLink([...base, peer], lone.id, peer.id, "calm");
    return { elements, wire: elements[elements.length - 1] as ExcalidrawElbowArrowElement };
  };
  const withoutIds = (elements: ExcalidrawElement[], ...ids: string[]) =>
    elements.map((e) => (ids.includes(e.id) ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));

  it("wires the agent clicked first to the other, a plain wire recorded on both ends", () => {
    const { elements, wire } = linked();
    expect(elements).toHaveLength(base.length + 2);
    expect(wire).toMatchObject({ type: "arrow", elbowed: true, startBinding: { elementId: lone.id }, endBinding: { elementId: peer.id } });
    expect(isWire(wire)).toBe(true);
    expect(isSpawnWire(wire)).toBe(false);
    for (const end of [lone.id, peer.id]) expect(elements.find((e) => e.id === end)!.boundElements).toEqual([{ id: wire.id, type: "arrow" }]);
  });

  it("is symmetric: each end finds the other, and which way the wire runs", () => {
    const { elements, wire } = linked();
    expect(agentLinksOf(elements, lone.id)).toEqual([{ peerId: peer.id, wireId: wire.id, outgoing: true }]);
    expect(agentLinksOf(elements, peer.id)).toEqual([{ peerId: lone.id, wireId: wire.id, outgoing: false }]);
    expect(agentLinksOf(elements, member.id)).toEqual([]);
  });

  it("adds no second wire for a pair already linked, either way round, and no link to itself", () => {
    const { elements } = linked();
    expect(withAgentLink(elements, lone.id, peer.id)).toHaveLength(elements.length);
    expect(withAgentLink(elements, peer.id, lone.id)).toHaveLength(elements.length);
    expect(withAgentLink([...base, peer], lone.id, lone.id)).toHaveLength(base.length + 1);
  });

  it("links terminals only, alive: not a fleet, a group's frame or a closed agent", () => {
    const scene = [...base, peer];
    expect(withAgentLink(scene, lone.id, fleet.id)).toHaveLength(scene.length);
    expect(withAgentLink(scene, lone.id, frame.id)).toHaveLength(scene.length);
    expect(withAgentLink(withoutIds(scene, peer.id), lone.id, peer.id)).toHaveLength(scene.length);
    expect(withAgentLink(scene, lone.id, "nowhere")).toHaveLength(scene.length);
  });

  it("takes no hand-drawn arrow for a link, nor lets one stop a link", () => {
    const scene = [...base, peer, handDrawn(lone, peer)];
    expect(agentLinksOf(scene, lone.id)).toEqual([]);
    expect(withAgentLink(scene, lone.id, peer.id)).toHaveLength(scene.length + 1);
  });

  it("is never read as a fleet's link, and no upkeep touches it", () => {
    const { elements } = linked();
    const links = fleetLinks(elements);
    expect(links).toEqual({ [fleet.id]: { groupIds: [], nodeIds: [] } });
    expect(fleetsOf(lone.id, links, framesFromScene(elements))).toEqual([]);
    expect(fleetsOf(peer.id, links, framesFromScene(elements))).toEqual([]);
    expect(unmarkedWires(elements)).toEqual([]);
    expect(orphanWires(elements)).toEqual([]);
  });

  it("leaves a fleet's wire to an agent out of the agent's links", () => {
    const scene = withWire([...base, peer], fleet.id, lone.id);
    expect(agentLinksOf(scene, lone.id)).toEqual([]);
  });

  it("counts spawn_agent's wire as a link between parent and sub-agent", () => {
    const scene = withWire([...base, peer], lone.id, peer.id, "calm", true);
    const wire = scene[scene.length - 1];
    expect(agentLinksOf(scene, peer.id)).toEqual([{ peerId: lone.id, wireId: wire.id, outgoing: false }]);
    // Already wired: "+ Link" adds nothing.
    expect(withAgentLink(scene, peer.id, lone.id)).toHaveLength(scene.length);
  });

  it("is cut by deleting the wire, or an end, which takes the wire with it", () => {
    const { elements, wire } = linked();
    expect(agentLinksOf(withoutIds(elements, wire.id), lone.id)).toEqual([]);
    expect(agentLinksOf(withoutIds(elements, peer.id), lone.id)).toEqual([]);
    expect(orphanWires(withoutIds(elements, peer.id))).toEqual([wire.id]);
    const dropped = { ...wire, isDeleted: true, customData: { dummyplane: { kind: "wire", orphaned: true } } } as ExcalidrawElement;
    // An undo bringing the agent back brings the link back.
    expect(revivableWires([...elements.slice(0, -1), dropped])).toEqual([wire.id]);
  });
});

describe("an agent or a Fleet wired to a Kanban board", () => {
  const board = { ...createNodeElement("kanban", { x: 1800, y: 900 }), id: "board" } as unknown as ExcalidrawElement;
  const scene = [fleet, frame, member, lone, plain, board];
  const without = (elements: readonly ExcalidrawElement[], id: string) => elements.map((e) => (e.id === id ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
  const arrows = (elements: readonly ExcalidrawElement[]) => elements.filter((e) => e.type === "arrow" && !e.isDeleted);

  it("joins a terminal to a board with a wire, which both ends record", () => {
    const wired = withBoardLink(scene, lone.id, board.id);
    expect(arrows(wired)).toHaveLength(1);
    const wire = arrows(wired)[0] as ExcalidrawArrowElement;
    expect(isWire(wire)).toBe(true);
    expect([wire.startBinding?.elementId, wire.endBinding?.elementId]).toEqual([lone.id, board.id]);
    expect(boardLinksOf(wired, lone.id)).toEqual([board.id]);
    // Read from the agent's end only: a board is no agent.
    expect(boardLinksOf(wired, board.id)).toEqual([]);
    expect(wired.find((e) => e.id === board.id)!.boundElements).toEqual([{ id: wire.id, type: "arrow" }]);
  });

  it("joins a Fleet to a board too, without making the board part of the Fleet's links", () => {
    const wired = withBoardLink(scene, fleet.id, board.id);
    expect(boardLinksOf(wired, fleet.id)).toEqual([board.id]);
    expect(fleetTargets(wired, fleet.id)).toEqual({ groupIds: [], nodeIds: [] });
  });

  it("draws no second wire for a pair already linked", () => {
    const once = withBoardLink(scene, lone.id, board.id);
    const twice = withBoardLink(once, lone.id, board.id);
    expect(arrows(twice)).toHaveLength(1);
    expect(twice.every((e, i) => e === once[i])).toBe(true);
  });

  it("links an agent to several boards, in the order of its wires", () => {
    const other = { ...createNodeElement("kanban", { x: 2600, y: 900 }), id: "other" } as unknown as ExcalidrawElement;
    const wired = withBoardLink(withBoardLink([...scene, other], lone.id, board.id), lone.id, other.id);
    expect(boardLinksOf(wired, lone.id)).toEqual([board.id, other.id]);
  });

  it("joins only what a link joins: a terminal or a Fleet to a live board", () => {
    // A group's frame and a node that is no board.
    expect(withBoardLink(scene, frame.id, board.id)).toEqual(scene);
    expect(withBoardLink(scene, lone.id, member.id)).toEqual(scene);
    expect(withBoardLink(scene, board.id, board.id)).toEqual(scene);
    // A board that is gone, an agent that is gone.
    expect(withBoardLink(without(scene, board.id), lone.id, board.id).some((e) => e.type === "arrow")).toBe(false);
    expect(withBoardLink(without(scene, lone.id), lone.id, board.id).some((e) => e.type === "arrow")).toBe(false);
  });

  it("counts a wire the user drew, not a talk wire nor a spawn wire", () => {
    const talking = withTalkWire(scene, lone.id, board.id);
    expect(arrows(talking)).toHaveLength(1);
    expect(boardLinksOf(talking, lone.id)).toEqual([]);
    const spawned = withWire(scene, lone.id, board.id, undefined, true);
    expect(boardLinksOf(spawned, lone.id)).toEqual([]);
  });

  it("turns a talk wire already joining the pair into the link, not a second arrow", () => {
    const talking = withTalkWire(scene, lone.id, board.id) as ExcalidrawElement[];
    const linked = withBoardLink(talking, lone.id, board.id);
    expect(arrows(linked)).toHaveLength(1);
    expect(arrows(linked)[0].strokeStyle).toBe("solid");
    expect(boardLinksOf(linked, lone.id)).toEqual([board.id]);
  });

  it("is cut by deleting the wire, or the board, with the upkeep taking the wire a board leaves behind", () => {
    const wired = withBoardLink(scene, lone.id, board.id);
    const wire = arrows(wired)[0];
    expect(boardLinksOf(without(wired, wire.id), lone.id)).toEqual([]);
    expect(boardLinksOf(without(wired, board.id), lone.id)).toEqual([]);
    expect(orphanWires(without(wired, board.id))).toEqual([wire.id]);
    expect(orphanWires(without(wired, lone.id))).toEqual([wire.id]);
    expect(orphanWires(wired)).toEqual([]);
    // An undo bringing the board back brings the link back.
    const dropped = { ...wire, isDeleted: true, customData: { dummyplane: { kind: "wire", orphaned: true } } } as ExcalidrawElement;
    expect(revivableWires([...wired.filter((e) => e.id !== wire.id), dropped])).toEqual([wire.id]);
  });

  it("is a link, not a team: the wire reads as a plain one", () => {
    const wired = withBoardLink(scene, lone.id, board.id);
    expect(wireKindOf(arrows(wired)[0], new Map(wired.map((e) => [e.id, e])))).toBe("link");
  });

  it("designates the topmost live board under the pointer", () => {
    const over = { ...board, id: "over", x: board.x + 10, y: board.y + 10 } as ExcalidrawElement;
    const at = { x: board.x + 20, y: board.y + 20 };
    expect(boardAt([board, over], at)).toBe("over");
    expect(boardAt(without([board, over], "over"), at)).toBe("board");
    expect(boardAt([board], { x: board.x - 5, y: board.y })).toBeNull();
    // A terminal under the pointer is no board.
    expect(boardAt([lone], { x: lone.x + 10, y: lone.y + 10 })).toBeNull();
  });
});
