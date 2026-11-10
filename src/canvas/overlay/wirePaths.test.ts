import { expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { SceneFrame } from "../groups";
import { activeWires, pathData, sameWirePaths, wirePaths, type WirePath } from "./wirePaths";

const orchestrator = { id: "chef", type: "embeddable", isDeleted: false, customData: { kind: "orchestrator" } } as unknown as ExcalidrawElement;

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

it("reads each wire's route in scene coordinates, from its orchestrator's end", () => {
  const paths = wirePaths([orchestrator, arrow("w1", "chef", "group"), arrow("w2", "isis", "chef")]);
  expect(paths).toEqual([
    { id: "w1", orchestratorId: "chef", targetId: "group", points: [{ x: 100, y: 50 }, { x: 140, y: 50 }, { x: 140, y: 80 }, { x: 180, y: 80 }] },
    // Drawn from the terminal to the orchestrator: read the other way.
    { id: "w2", orchestratorId: "chef", targetId: "isis", points: [{ x: 180, y: 80 }, { x: 140, y: 80 }, { x: 140, y: 50 }, { x: 100, y: 50 }] },
  ]);
});

it("leaves out deleted, unbound and unmarked arrows, and arrows that do not reach an orchestrator", () => {
  const paths = wirePaths([
    orchestrator,
    arrow("deleted", "chef", "group", { isDeleted: true }),
    arrow("unbound", "chef", "group", { endBinding: null }),
    arrow("plain", "chef", "group", { customData: undefined }),
    arrow("elsewhere", "isis", "group"),
  ]);
  expect(paths).toEqual([]);
});

const SPAWN = { customData: { dummyplane: { kind: "wire", spawn: true } } };

it("reads a spawn wire from the agent that spawned the sub-agent, no orchestrator at either end", () => {
  expect(wirePaths([arrow("s1", "isis", "thot", SPAWN)])).toEqual([
    { id: "s1", orchestratorId: "isis", targetId: "thot", points: [{ x: 100, y: 50 }, { x: 140, y: 50 }, { x: 140, y: 80 }, { x: 180, y: 80 }] },
  ]);
  // Next to an orchestrator's wires.
  expect(wirePaths([orchestrator, arrow("w1", "chef", "isis"), arrow("s1", "isis", "thot", SPAWN)]).map((p) => [p.id, p.orchestratorId, p.targetId])).toEqual([
    ["w1", "chef", "isis"],
    ["s1", "isis", "thot"],
  ]);
});

const terminal = (id: string) => ({ id, type: "embeddable", isDeleted: false, customData: { kind: "terminal" } }) as unknown as ExcalidrawElement;

it("reads a link between two agents from the agent it starts at, and lights it for a message either way", () => {
  const [link] = wirePaths([terminal("isis"), terminal("thot"), arrow("l1", "isis", "thot")]);
  expect(link).toMatchObject({ id: "l1", orchestratorId: "isis", targetId: "thot" });
  // isis to thot: a pulse on the wire's end naming its start, running toward the end.
  expect(activeWires([link], [], { thot: { direction: "toAgent", at: 4, orchestratorId: "isis" } })).toEqual([{ wire: link, direction: "toAgent", at: 4 }]);
  // thot to isis: the same pulse, running back.
  expect(activeWires([link], [], { thot: { direction: "toOrchestrator", at: 5, orchestratorId: "isis" } })).toEqual([{ wire: link, direction: "toOrchestrator", at: 5 }]);
  // A plain wire whose ends are not both live terminals is nobody's link.
  expect(wirePaths([terminal("isis"), { ...terminal("thot"), isDeleted: true } as ExcalidrawElement, arrow("l1", "isis", "thot")])).toEqual([]);
});

it("leaves out a wire between two unknown ends without the spawn mark, and a deleted or unbound spawn wire", () => {
  expect(wirePaths([arrow("w", "isis", "thot")])).toEqual([]);
  expect(wirePaths([arrow("spawn-only", "isis", "thot", { customData: { dummyplane: { spawn: true } } })])).toEqual([]);
  expect(wirePaths([arrow("gone", "isis", "thot", { ...SPAWN, isDeleted: true })])).toEqual([]);
  expect(wirePaths([arrow("loose", "isis", "thot", { ...SPAWN, endBinding: null })])).toEqual([]);
});

it("tells a route that moved from one that did not", () => {
  const [a] = wirePaths([orchestrator, arrow("w1", "chef", "group")]);
  const [b] = wirePaths([orchestrator, arrow("w1", "chef", "group")]);
  const [moved] = wirePaths([orchestrator, arrow("w1", "chef", "group", { x: 101 })]);
  expect(sameWirePaths([a], [b])).toBe(true);
  expect(sameWirePaths([a], [moved])).toBe(false);
  expect(sameWirePaths([a], [])).toBe(false);
});

const route = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 20 },
];
const toGroup: WirePath = { id: "w1", orchestratorId: "chef", targetId: "backend", points: route };
const toLone: WirePath = { id: "w2", orchestratorId: "chef", targetId: "seth", points: route };
const otherChef: WirePath = { id: "w3", orchestratorId: "boss", targetId: "backend", points: route };
const frames = [{ id: "backend", group: { role: "backend" }, memberIds: ["isis", "thoth"] }] as unknown as SceneFrame[];

it("lights a group's wire for its members' messages and a terminal's wire for its own", () => {
  const active = activeWires([toGroup, toLone, otherChef], frames, {
    thoth: { direction: "toOrchestrator", at: 5 },
    seth: { direction: "toAgent", at: 3 },
  });
  expect(active.map((a) => [a.wire.id, a.direction, a.at])).toEqual([
    ["w1", "toOrchestrator", 5],
    ["w2", "toAgent", 3],
    // No orchestrator named: every wire reaching Thoth carries it.
    ["w3", "toOrchestrator", 5],
  ]);
});

it("lights only the named orchestrator's wire, with the latest of its members' messages", () => {
  const active = activeWires([toGroup, toLone, otherChef], frames, {
    isis: { direction: "toAgent", at: 2, orchestratorId: "chef" },
    thoth: { direction: "toOrchestrator", at: 7, orchestratorId: "chef" },
  });
  expect(active.map((a) => [a.wire.id, a.direction, a.at])).toEqual([["w1", "toOrchestrator", 7]]);
});

it("lights a spawn wire for the sub-agent's messages naming the agent that spawned it, not another orchestrator's", () => {
  const [spawn] = wirePaths([arrow("s1", "isis", "thot", SPAWN)]);
  const lit = activeWires([spawn], [], { thot: { direction: "toOrchestrator", at: 4, orchestratorId: "isis" } });
  expect(lit.map((a) => [a.wire.id, a.direction, a.at])).toEqual([["s1", "toOrchestrator", 4]]);
  expect(activeWires([spawn], [], { thot: { direction: "toAgent", at: 4, orchestratorId: "chef" } })).toEqual([]);
  // A message of the parent itself is not the sub-agent's.
  expect(activeWires([spawn], [], { isis: { direction: "toAgent", at: 4, orchestratorId: "isis" } })).toEqual([]);
});

it("draws the path the way the message goes, its corners rounded as Excalidraw rounds the wire's", () => {
  // The corner takes at most half of each side: 5 here.
  expect(pathData(route, "toAgent")).toBe("M0 0 L5 0 Q10 0 10 5 L10 20");
  expect(pathData(route, "toOrchestrator")).toBe("M10 20 L10 5 Q10 0 5 0 L0 0");
  // Long sides: Excalidraw's 16.
  const long = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 200, y: 60 }];
  expect(pathData(long, "toAgent")).toBe("M0 0 L84 0 Q100 0 100 16 L100 44 Q100 60 116 60 L200 60");
  expect(pathData([{ x: 0, y: 0 }, { x: 0, y: 300 }], "toAgent")).toBe("M0 0 L0 300");
  expect(pathData([{ x: 0.123, y: 4.56 }], "toAgent")).toBe("M0.1 4.6");
  expect(pathData([], "toAgent")).toBe("");
});
