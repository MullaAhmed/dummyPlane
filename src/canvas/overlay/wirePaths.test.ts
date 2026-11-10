import { STORED_FLEET_KIND } from "@/canvas/nodeElement";
import { expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { SceneFrame } from "../groups";
import { activeWires, pathData, sameWirePaths, wirePaths, type WirePath } from "./wirePaths";

const fleet = { id: "chef", type: "embeddable", isDeleted: false, customData: { kind: STORED_FLEET_KIND } } as unknown as ExcalidrawElement;

function arrow(id: string, from: string, to: string, extra: Record<string, unknown> = {}): ExcalidrawElement {
  return {
    id,
    type: "arrow",
    isDeleted: false,
    x: 100,
    y: 50,
    points: [
      [0, 0],
      [40, 0],
      [40, 30],
      [80, 30],
    ],
    startBinding: { elementId: from, focus: 0, gap: 8 },
    endBinding: { elementId: to, focus: 0, gap: 8 },
    customData: { dummyplane: { kind: "wire" } },
    ...extra,
  } as unknown as ExcalidrawElement;
}

it("reads each wire's route in scene coordinates, from its fleet's end", () => {
  const paths = wirePaths([fleet, arrow("w1", "chef", "group"), arrow("w2", "batman", "chef")]);
  expect(paths).toEqual([
    { id: "w1", fleetId: "chef", targetId: "group", points: [{ x: 100, y: 50 }, { x: 140, y: 50 }, { x: 140, y: 80 }, { x: 180, y: 80 }] },
    // Drawn from the terminal to the fleet: read the other way.
    { id: "w2", fleetId: "chef", targetId: "batman", points: [{ x: 180, y: 80 }, { x: 140, y: 80 }, { x: 140, y: 50 }, { x: 100, y: 50 }] },
  ]);
});

it("leaves out deleted, unbound and unmarked arrows, and arrows that do not reach a fleet", () => {
  const paths = wirePaths([
    fleet,
    arrow("deleted", "chef", "group", { isDeleted: true }),
    arrow("unbound", "chef", "group", { endBinding: null }),
    arrow("plain", "chef", "group", { customData: undefined }),
    arrow("elsewhere", "batman", "group"),
  ]);
  expect(paths).toEqual([]);
});

const SPAWN = { customData: { dummyplane: { kind: "wire", spawn: true } } };

it("reads a spawn wire from the agent that spawned the sub-agent, no fleet at either end", () => {
  expect(wirePaths([arrow("s1", "batman", "cyborg", SPAWN)])).toEqual([
    { id: "s1", fleetId: "batman", targetId: "cyborg", points: [{ x: 100, y: 50 }, { x: 140, y: 50 }, { x: 140, y: 80 }, { x: 180, y: 80 }] },
  ]);
  // Next to a fleet's wires.
  expect(wirePaths([fleet, arrow("w1", "chef", "batman"), arrow("s1", "batman", "cyborg", SPAWN)]).map((p) => [p.id, p.fleetId, p.targetId])).toEqual([
    ["w1", "chef", "batman"],
    ["s1", "batman", "cyborg"],
  ]);
});

const terminal = (id: string) => ({ id, type: "embeddable", isDeleted: false, customData: { kind: "terminal" } }) as unknown as ExcalidrawElement;

it("reads a link between two agents from the agent it starts at, and lights it for a message either way", () => {
  const [link] = wirePaths([terminal("batman"), terminal("cyborg"), arrow("l1", "batman", "cyborg")]);
  expect(link).toMatchObject({ id: "l1", fleetId: "batman", targetId: "cyborg" });
  // batman to cyborg: a pulse on the wire's end naming its start, running toward the end.
  expect(activeWires([link], [], { cyborg: { direction: "toAgent", at: 4, fleetId: "batman" } })).toEqual([{ wire: link, direction: "toAgent", at: 4 }]);
  // cyborg to batman: the same pulse, running back.
  expect(activeWires([link], [], { cyborg: { direction: "toFleet", at: 5, fleetId: "batman" } })).toEqual([{ wire: link, direction: "toFleet", at: 5 }]);
  // A plain wire whose ends are not both live terminals is nobody's link.
  expect(wirePaths([terminal("batman"), { ...terminal("cyborg"), isDeleted: true } as ExcalidrawElement, arrow("l1", "batman", "cyborg")])).toEqual([]);
});

it("leaves out a wire between two unknown ends without the spawn mark, and a deleted or unbound spawn wire", () => {
  expect(wirePaths([arrow("w", "batman", "cyborg")])).toEqual([]);
  expect(wirePaths([arrow("spawn-only", "batman", "cyborg", { customData: { dummyplane: { spawn: true } } })])).toEqual([]);
  expect(wirePaths([arrow("gone", "batman", "cyborg", { ...SPAWN, isDeleted: true })])).toEqual([]);
  expect(wirePaths([arrow("loose", "batman", "cyborg", { ...SPAWN, endBinding: null })])).toEqual([]);
});

it("tells a route that moved from one that did not", () => {
  const [a] = wirePaths([fleet, arrow("w1", "chef", "group")]);
  const [b] = wirePaths([fleet, arrow("w1", "chef", "group")]);
  const [moved] = wirePaths([fleet, arrow("w1", "chef", "group", { x: 101 })]);
  expect(sameWirePaths([a], [b])).toBe(true);
  expect(sameWirePaths([a], [moved])).toBe(false);
  expect(sameWirePaths([a], [])).toBe(false);
});

const route = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 20 },
];
const toGroup: WirePath = { id: "w1", fleetId: "chef", targetId: "backend", points: route };
const toLone: WirePath = { id: "w2", fleetId: "chef", targetId: "shazam", points: route };
const otherChef: WirePath = { id: "w3", fleetId: "boss", targetId: "backend", points: route };
const frames = [{ id: "backend", group: { role: "backend" }, memberIds: ["batman", "cyborg"] }] as unknown as SceneFrame[];

it("lights a group's wire for its members' messages and a terminal's wire for its own", () => {
  const active = activeWires([toGroup, toLone, otherChef], frames, {
    cyborg: { direction: "toFleet", at: 5 },
    shazam: { direction: "toAgent", at: 3 },
  });
  expect(active.map((a) => [a.wire.id, a.direction, a.at])).toEqual([
    ["w1", "toFleet", 5],
    ["w2", "toAgent", 3],
    // No fleet named: every wire reaching Cyborg carries it.
    ["w3", "toFleet", 5],
  ]);
});

it("lights only the named fleet's wire, with the latest of its members' messages", () => {
  const active = activeWires([toGroup, toLone, otherChef], frames, {
    batman: { direction: "toAgent", at: 2, fleetId: "chef" },
    cyborg: { direction: "toFleet", at: 7, fleetId: "chef" },
  });
  expect(active.map((a) => [a.wire.id, a.direction, a.at])).toEqual([["w1", "toFleet", 7]]);
});

it("lights a spawn wire for the sub-agent's messages naming the agent that spawned it, not another fleet's", () => {
  const [spawn] = wirePaths([arrow("s1", "batman", "cyborg", SPAWN)]);
  const lit = activeWires([spawn], [], { cyborg: { direction: "toFleet", at: 4, fleetId: "batman" } });
  expect(lit.map((a) => [a.wire.id, a.direction, a.at])).toEqual([["s1", "toFleet", 4]]);
  expect(activeWires([spawn], [], { cyborg: { direction: "toAgent", at: 4, fleetId: "chef" } })).toEqual([]);
  // A message of the parent itself is not the sub-agent's.
  expect(activeWires([spawn], [], { batman: { direction: "toAgent", at: 4, fleetId: "batman" } })).toEqual([]);
});

it("draws the path the way the message goes, its corners rounded as Excalidraw rounds the wire's", () => {
  // The corner takes at most half of each side: 5 here.
  expect(pathData(route, "toAgent")).toBe("M0 0 L5 0 Q10 0 10 5 L10 20");
  expect(pathData(route, "toFleet")).toBe("M10 20 L10 5 Q10 0 5 0 L0 0");
  // Long sides: Excalidraw's 16.
  const long = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 200, y: 60 }];
  expect(pathData(long, "toAgent")).toBe("M0 0 L84 0 Q100 0 100 16 L100 44 Q100 60 116 60 L200 60");
  expect(pathData([{ x: 0, y: 0 }, { x: 0, y: 300 }], "toAgent")).toBe("M0 0 L0 300");
  expect(pathData([{ x: 0.123, y: 4.56 }], "toAgent")).toBe("M0.1 4.6");
  expect(pathData([], "toAgent")).toBe("");
});
