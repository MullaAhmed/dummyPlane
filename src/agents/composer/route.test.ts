import { describe, expect, it } from "vitest";
import { targetOptions, type TargetAgent } from "../targets";
import { routeCommand, type RouteScope } from "./route";

const agents: TargetAgent[] = [
  { id: "b", name: "Cyborg", groupName: null },
  { id: "d", name: "Deadpool", groupName: null },
];
const scope = (patch: Partial<RouteScope> = {}): RouteScope => ({
  chips: [],
  options: targetOptions(agents, []),
  agents,
  groups: [],
  fallback: [],
  ...patch,
});

describe("routeCommand", () => {
  it("sends the text without its mentions to the agents named after @", () => {
    expect(routeCommand("@cyborg/deadpool run tests", scope())).toMatchObject({ ids: ["b", "d"], instruction: "run tests", canSend: true });
  });

  it("falls back on the selection without @, and on nothing without a selection", () => {
    expect(routeCommand("run tests", scope({ fallback: ["d"] }))).toMatchObject({ ids: ["d"], canSend: true });
    expect(routeCommand("run tests", scope())).toMatchObject({ ids: [], canSend: false });
  });

  it("adds the chips to the typed names, once each", () => {
    expect(routeCommand("@deadpool lint", scope({ chips: [{ kind: "agent", id: "b" }, { kind: "agent", id: "d" }] })).targets).toEqual([
      { kind: "agent", id: "b" },
      { kind: "agent", id: "d" },
    ]);
  });

  it("holds back a /command whose target is mistyped, rather than sending it to the selection", () => {
    expect(routeCommand("/clear @cyborg/deadpoll", scope({ fallback: ["d"] }))).toMatchObject({ unknown: "@cyborg/deadpoll", canSend: false });
  });

  it("has nothing to send with targets only", () => {
    expect(routeCommand("@cyborg ", scope())).toMatchObject({ instruction: "", canSend: false });
  });
});

describe("a Fleet in the @ list", () => {
  const fleet: TargetAgent = { id: "f", name: "Fleet", groupName: null, fleet: true };
  const withFleet = [...agents, fleet];
  const scopeWithFleet = (patch: Partial<RouteScope> = {}): RouteScope => scope({ agents: withFleet, options: targetOptions(withFleet, []), ...patch });

  it("is written to by its name, as an agent is", () => {
    expect(routeCommand("@fleet plan the migration", scopeWithFleet())).toMatchObject({ ids: ["f"], instruction: "plan the migration", canSend: true });
    expect(routeCommand("@fleet/cyborg go", scopeWithFleet())).toMatchObject({ ids: ["f", "b"], canSend: true });
  });

  it("is listed under a word of its own, and left out of @all and its count", () => {
    const options = targetOptions(withFleet, []);
    expect(options.map((o) => [o.label, o.detail])).toEqual([
      ["@all", "2 agents"],
      ["@cyborg", "No group"],
      ["@deadpool", "No group"],
      ["@fleet", "Fleet"],
    ]);
    expect(routeCommand("@all lint", scopeWithFleet())).toMatchObject({ ids: ["b", "d"], canSend: true });
  });
});
