import { describe, expect, it } from "vitest";
import type { ExcalidrawArrowElement, ExcalidrawElbowArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createGroupFrame, framesFromScene } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { PALETTES, type ThemeChoice } from "@/app/theme";
import { displayColorFor, toDisplayColor, toSceneColor } from "@/theme/sceneColors";
import {
  agentLinksOf,
  createWire,
  elbowWires,
  isPaletteWireColor,
  isSpawnWire,
  isWire,
  linkedAgents,
  linkTargetAt,
  orchestratorAt,
  orchestratorLinks,
  orchestratorsOf,
  orchestratorTargets,
  orphanWires,
  outdatedWires,
  rerouteWires,
  revivableWires,
  unmarkedWires,
  wireColor,
  withAgentLink,
  withWire,
} from "./wires";

const PALETTE_IDS = Object.keys(PALETTES) as ThemeChoice[];

/** Squared RGB distance between two #rrggbb colors. */
function distance(a: string, b: string): number {
  const channels = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i + 1, i + 3), 16));
  return channels(a).reduce((sum, c, i) => sum + (c - channels(b)[i]) ** 2, 0);
}

const orchestrator = createNodeElement("orchestrator", { x: 0, y: 0 }) as unknown as ExcalidrawElement;
const frame = createGroupFrame({ x: 600, y: -300, width: 900, height: 600 }, "Backend", { role: "backend", pantheon: "greek" }) as ExcalidrawElement;
const member = { ...createNodeElement("terminal", { x: 1000, y: 0 }), frameId: frame.id } as unknown as ExcalidrawElement;
const lone = createNodeElement("terminal", { x: 0, y: 900 }) as unknown as ExcalidrawElement;
const plain = { ...frame, id: "plain", customData: undefined } as ExcalidrawElement;
const base = [orchestrator, frame, member, lone, plain];

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
    const elements = withWire(base, orchestrator.id, frame.id);
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
      startBinding: { elementId: orchestrator.id },
      endBinding: { elementId: frame.id },
      customData: { dummyplane: { kind: "wire" } },
    });
    expect(isWire(wire)).toBe(true);
    const bound = (id: string) => elements.find((e) => e.id === id)?.boundElements;
    expect(bound(orchestrator.id)).toEqual([{ id: wire.id, type: "arrow" }]);
    expect(bound(frame.id)).toEqual([{ id: wire.id, type: "arrow" }]);
  });

  it("does not wire the same target twice", () => {
    const once = withWire(base, orchestrator.id, lone.id);
    expect(withWire(once, orchestrator.id, lone.id)).toHaveLength(once.length);
  });

  it("is drawn in the default palette's accent as the dark filter shows it", () => {
    expect(wireColor("expressive")).toBe(toSceneColor("#F4F4F1"));
    expect(wireColor("expressive")).toBe("#000000");
  });

  it("is drawn in the accent of the palette it is created under", () => {
    expect(wireColor("calm")).toBe("#173F32");
    expect(wireColor("electric")).toBe("#010001");
    for (const palette of PALETTE_IDS) {
      expect(createWire(orchestrator, lone, palette).strokeColor, palette).toBe(wireColor(palette));
      const elements = withWire(base, orchestrator.id, lone.id, palette);
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
    const wire = createWire(orchestrator, aside);
    expect(wire.points).toHaveLength(4);
    expect(orthogonal(wire.points)).toBe(true);
    const [, bend, , last] = wire.points;
    expect(bend[1]).toBe(0);
    expect(bend[0]).toBeCloseTo(last[0] / 2);
    // Out of the orchestrator's right side, into the target's left side, 5 px off each (Excalidraw's FIXED_BINDING_DISTANCE).
    expect(wire.startBinding!.fixedPoint).toEqual([1 + 5 / orchestrator.width, 0.5001]);
    expect(wire.endBinding!.fixedPoint).toEqual([-5 / aside.width, 0.5001]);
    const { start, end } = ends(wire);
    expect(start).toEqual(fixedOnScene(orchestrator, wire.startBinding!.fixedPoint));
    expect(end.x).toBeCloseTo(fixedOnScene(aside, wire.endBinding!.fixedPoint).x);
    expect(end.y).toBeCloseTo(fixedOnScene(aside, wire.endBinding!.fixedPoint).y);
    expect(start.x - (orchestrator.x + orchestrator.width)).toBeCloseTo(5);
    expect(aside.x - end.x).toBeCloseTo(5);
    expect(wire).toMatchObject({ width: last[0], height: last[1] });
  });

  it("leaves from the left side for a target on the left", () => {
    const left = createNodeElement("terminal", { x: -1200, y: -600 }) as unknown as ExcalidrawElement;
    const wire = createWire(orchestrator, left);
    expect(orthogonal(wire.points)).toBe(true);
    expect(wire.points[1][0]).toBeLessThan(0);
    expect(wire.startBinding!.fixedPoint[0]).toBeLessThan(0);
    expect(wire.endBinding!.fixedPoint[0]).toBeGreaterThan(1);
  });

  it("goes down then across for a target under the orchestrator, never back through it", () => {
    const under = createNodeElement("terminal", { x: 300, y: 1200 }) as unknown as ExcalidrawElement;
    const wire = createWire(orchestrator, under);
    expect(wire.points).toHaveLength(4);
    expect(orthogonal(wire.points)).toBe(true);
    expect(wire.points[1]).toEqual([0, wire.points[1][1]]);
    expect(wire.points[1][1]).toBeGreaterThan(0);
    expect(wire.startBinding!.fixedPoint).toEqual([0.5001, 1 + 5 / orchestrator.height]);
    expect(wire.endBinding!.fixedPoint).toEqual([0.5001, -5 / under.height]);
    // Right under it: straight down, out of the bottom.
    const straight = createWire(orchestrator, lone);
    expect(straight.points).toHaveLength(2);
    expect(straight.points[1][0]).toBe(0);
    expect(straight.points[1][1]).toBeGreaterThan(0);
    // Above it: up.
    const above = createWire(orchestrator, createNodeElement("terminal", { x: 300, y: -1200 }) as unknown as ExcalidrawElement);
    expect(above.points[1][1]).toBeLessThan(0);
  });

  it("is one straight segment between level sides", () => {
    const wire = createWire(orchestrator, frame);
    expect(wire.points).toHaveLength(2);
    expect(wire.points[1][1]).toBe(0);
    expect(wire.points[1][0]).toBeGreaterThan(0);
  });

  it("goes around when the orchestrator stands on its group's frame", () => {
    const inside = createNodeElement("orchestrator", { x: 1000, y: 0 }) as unknown as ExcalidrawElement;
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
    const curved = curvedWire(orchestrator, member);
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
      startBinding: { elementId: orchestrator.id, fixedPoint: [1 + 5 / orchestrator.width, 0.5001] },
      endBinding: { elementId: member.id, fixedPoint: [-5 / member.width, 0.5001] },
      customData: { dummyplane: { kind: "wire" } },
    });
    expect(wire.versionNonce).not.toBe(42);
    expect(orthogonal(wire.points)).toBe(true);
    expect(ends(wire).start).toEqual(fixedOnScene(orchestrator, wire.startBinding!.fixedPoint));
    // Everything else is the same element.
    base.forEach((e, i) => expect(migrated[i]).toBe(e));
    // Still the same link.
    expect(orchestratorTargets(migrated, orchestrator.id)).toEqual(orchestratorTargets(elements, orchestrator.id));
  });

  it("gives a former terracotta wire the color of the palette it is elbowed under", () => {
    const curved = curvedWire(orchestrator, lone);
    for (const palette of PALETTE_IDS) {
      const wire = elbowWires(scene(curved), palette).find((e) => e.id === curved.id);
      expect(wire?.strokeColor, palette).toBe(wireColor(palette));
    }
  });

  it("keeps a colour picked for the wire, and its heads", () => {
    const picked = { ...curvedWire(orchestrator, lone, "#3F74A8"), endArrowhead: "arrow" } as ExcalidrawElement;
    const wire = elbowWires(scene(picked)).find((e) => e.id === picked.id) as ExcalidrawElbowArrowElement;
    expect(wire).toMatchObject({ elbowed: true, strokeColor: "#3F74A8", endArrowhead: "arrow" });
  });

  it("routes a wire drawn from its target from the target, as it is bound", () => {
    const reversed = { ...curvedWire(orchestrator, lone), startBinding: { elementId: lone.id, focus: 0, gap: 8 }, endBinding: { elementId: orchestrator.id, focus: 0, gap: 8 } } as ExcalidrawElement;
    const wire = elbowWires(scene(reversed)).find((e) => e.id === reversed.id) as ExcalidrawElbowArrowElement;
    expect(wire.startBinding!.elementId).toBe(lone.id);
    expect(wire.endBinding!.elementId).toBe(orchestrator.id);
    // Up out of the terminal's top, into the orchestrator's bottom.
    expect(wire.points[wire.points.length - 1][1]).toBeLessThan(0);
    expect(wire.startBinding!.fixedPoint[1]).toBeLessThan(0);
    expect(wire.endBinding!.fixedPoint[1]).toBeGreaterThan(1);
  });

  it("elbows a deleted wire too, which an undo may bring back", () => {
    const dropped = { ...curvedWire(orchestrator, lone), isDeleted: true } as ExcalidrawElement;
    expect(elbowWires(scene(dropped)).find((e) => e.id === dropped.id)).toMatchObject({ elbowed: true, isDeleted: true });
  });

  it("leaves plain arrows, elbowed wires and wires without an end alone", () => {
    const plainArrow = { ...curvedWire(orchestrator, lone), id: "plain-arrow", customData: undefined } as ExcalidrawElement;
    const elbowed = withWire(base, orchestrator.id, frame.id)[base.length];
    const endless = { ...curvedWire(orchestrator, lone), id: "endless", endBinding: null } as ExcalidrawElement;
    const gone = { ...curvedWire(orchestrator, lone), id: "gone", endBinding: { elementId: "nowhere", focus: 0, gap: 8 } } as ExcalidrawElement;
    const elements = scene(plainArrow, elbowed, endless, gone);
    expect(elbowWires(elements)).toBe(elements);
  });
});

describe("outdatedWires (a palette change recolors the wires, not the user's colors)", () => {
  const wireIn = (color: string, id = "w"): ExcalidrawElement => ({ ...createWire(orchestrator, lone, "expressive"), id, strokeColor: color });

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

describe("orchestratorTargets", () => {
  it("finds the groups and terminals wired to the orchestrator, either way round", () => {
    const elements = [...withWire(base, orchestrator.id, frame.id), handDrawn(lone, orchestrator)];
    expect(orchestratorTargets(elements, orchestrator.id)).toEqual({ groupIds: [frame.id], nodeIds: [lone.id] });
  });

  it("drops deleted arrows, deleted targets and plain frames", () => {
    const wired = withWire(withWire(base, orchestrator.id, frame.id), orchestrator.id, plain.id);
    const arrows = wired.filter((e) => e.type === "arrow");
    expect(orchestratorTargets(wired, orchestrator.id)).toEqual({ groupIds: [frame.id], nodeIds: [] });
    const cut = wired.map((e) => (e.id === arrows[0].id ? { ...e, isDeleted: true } : e));
    expect(orchestratorTargets(cut, orchestrator.id).groupIds).toEqual([]);
    const gone = wired.map((e) => (e.id === frame.id ? { ...e, isDeleted: true } : e));
    expect(orchestratorTargets(gone, orchestrator.id).groupIds).toEqual([]);
  });

  it("maps every orchestrator of the scene", () => {
    const elements = withWire(base, orchestrator.id, lone.id);
    expect(orchestratorLinks(elements)).toEqual({ [orchestrator.id]: { groupIds: [], nodeIds: [lone.id] } });
  });
});

describe("unmarkedWires", () => {
  it("lists the hand-drawn arrows between an orchestrator and a target", () => {
    const hand = handDrawn(orchestrator, lone);
    const stray = { ...handDrawn(member, lone), id: "stray" } as ExcalidrawElement;
    const elements = [...withWire(base, orchestrator.id, frame.id), hand, stray];
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

describe("orchestratorAt (an agent's Link)", () => {
  it("finds the orchestrator under the pointer, never a terminal or a group", () => {
    expect(orchestratorAt(base, { x: orchestrator.x + 10, y: orchestrator.y + 10 })).toBe(orchestrator.id);
    expect(orchestratorAt(base, { x: lone.x + 10, y: lone.y + 10 })).toBeNull();
    expect(orchestratorAt(base, { x: frame.x + 5, y: frame.y + 5 })).toBeNull();
    expect(orchestratorAt([{ ...orchestrator, isDeleted: true }], { x: orchestrator.x + 10, y: orchestrator.y + 10 })).toBeNull();
  });
});

describe("orchestratorsOf (linkedAgents the other way round)", () => {
  it("names the orchestrators wired to an agent, directly or through its group", () => {
    const frames = framesFromScene(base);
    const links = { atlas: { groupIds: [frame.id], nodeIds: [] }, hermes: { groupIds: [], nodeIds: [lone.id] }, idle: { groupIds: [], nodeIds: [] } };
    expect(orchestratorsOf(member.id, links, frames)).toEqual(["atlas"]);
    expect(orchestratorsOf(lone.id, links, frames)).toEqual(["hermes"]);
    expect(orchestratorsOf("nobody", links, frames)).toEqual([]);
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

describe("orphanWires (plan B3)", () => {
  const withoutIds = (elements: ExcalidrawElement[], ...ids: string[]) =>
    elements.map((e) => (ids.includes(e.id) ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));

  it("lists the wires whose target or orchestrator is gone, whatever way it went", () => {
    const wired = withWire(base, orchestrator.id, frame.id);
    const wire = wired[wired.length - 1];
    expect(orphanWires(wired)).toEqual([]);
    expect(orphanWires(withoutIds(wired, frame.id))).toEqual([wire.id]);
    expect(orphanWires(withoutIds(wired, orchestrator.id))).toEqual([wire.id]);
    // Ungroup or Delete: the element left the scene, the arrow lost its binding.
    expect(orphanWires(wired.filter((e) => e.id !== frame.id))).toEqual([wire.id]);
    const unbound = wired.map((e) => (e.id === wire.id ? ({ ...e, endBinding: null } as ExcalidrawElement) : e));
    expect(orphanWires(unbound)).toEqual([wire.id]);
  });

  it("keeps a plain arrow and an already deleted wire out of the list", () => {
    const wired = withWire(base, orchestrator.id, frame.id);
    const wire = wired[wired.length - 1];
    const plainArrow = { ...handDrawn(orchestrator, lone), customData: undefined, endBinding: null } as ExcalidrawElement;
    expect(orphanWires([...withoutIds(wired, frame.id, wire.id), plainArrow])).toEqual([]);
  });

  it("does not take an ungrouped frame for a gone target: a plain frame is no wire target", () => {
    const wired = withWire(base, orchestrator.id, frame.id);
    const ungrouped = wired.map((e) => (e.id === frame.id ? ({ ...e, customData: undefined } as ExcalidrawElement) : e));
    expect(orphanWires(ungrouped)).toEqual([wired[wired.length - 1].id]);
  });
});

describe("revivableWires (plan B3 undo)", () => {
  it("lists a wire the upkeep deleted once both its ends are back, as an undo brings them", () => {
    const wired = withWire(base, orchestrator.id, frame.id);
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
});

describe("rerouteWires (a node the app resizes: Excalidraw reroutes only what the user moves)", () => {
  const wire = createWire(orchestrator, member);
  const toLone = createWire(orchestrator, lone);
  const shrunk = { ...member, height: 68 } as ExcalidrawElement;

  it("routes the wires bound to the node again between their ends as they stand, and leaves the rest", () => {
    const elements = [orchestrator, frame, shrunk, lone, plain, wire, toLone];
    const next = rerouteWires(elements, new Set([member.id]));
    const rerouted = next[5] as ExcalidrawElbowArrowElement;
    expect(rerouted).toMatchObject({
      id: wire.id,
      elbowed: true,
      version: wire.version + 1,
      startBinding: { elementId: orchestrator.id },
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
    const elements = [orchestrator, frame, shrunk, lone, plain, wire];
    expect(rerouteWires(elements, new Set([plain.id]))).toBe(elements);
    expect(rerouteWires(base, new Set([member.id]))).toBe(base);
    const left = [orchestrator, shrunk, { ...wire, isDeleted: true } as ExcalidrawElement, handDrawn(orchestrator, member)];
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

  it("is no orchestrator's link", () => {
    const { elements } = spawned();
    expect(orchestratorLinks(elements)).toEqual({ [orchestrator.id]: { groupIds: [], nodeIds: [] } });
    expect(unmarkedWires(elements)).toEqual([]);
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

describe("agent links (two agents wired without an orchestrator)", () => {
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

  it("links terminals only, alive: not an orchestrator, a group's frame or a closed agent", () => {
    const scene = [...base, peer];
    expect(withAgentLink(scene, lone.id, orchestrator.id)).toHaveLength(scene.length);
    expect(withAgentLink(scene, lone.id, frame.id)).toHaveLength(scene.length);
    expect(withAgentLink(withoutIds(scene, peer.id), lone.id, peer.id)).toHaveLength(scene.length);
    expect(withAgentLink(scene, lone.id, "nowhere")).toHaveLength(scene.length);
  });

  it("takes no hand-drawn arrow for a link, nor lets one stop a link", () => {
    const scene = [...base, peer, handDrawn(lone, peer)];
    expect(agentLinksOf(scene, lone.id)).toEqual([]);
    expect(withAgentLink(scene, lone.id, peer.id)).toHaveLength(scene.length + 1);
  });

  it("is never read as an orchestrator's link, and no upkeep touches it", () => {
    const { elements } = linked();
    const links = orchestratorLinks(elements);
    expect(links).toEqual({ [orchestrator.id]: { groupIds: [], nodeIds: [] } });
    expect(orchestratorsOf(lone.id, links, framesFromScene(elements))).toEqual([]);
    expect(orchestratorsOf(peer.id, links, framesFromScene(elements))).toEqual([]);
    expect(unmarkedWires(elements)).toEqual([]);
    expect(orphanWires(elements)).toEqual([]);
  });

  it("leaves an orchestrator's wire to an agent out of the agent's links", () => {
    const scene = withWire([...base, peer], orchestrator.id, lone.id);
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
