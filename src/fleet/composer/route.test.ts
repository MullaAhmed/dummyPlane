import { describe, expect, it } from "vitest";
import { targetOptions, type TargetAgent } from "../targets";
import { routeCommand, type RouteScope } from "./route";

const agents: TargetAgent[] = [
  { id: "b", name: "Thoth", groupName: null },
  { id: "d", name: "Zeus", groupName: null },
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
    expect(routeCommand("@thoth/zeus run tests", scope())).toMatchObject({ ids: ["b", "d"], instruction: "run tests", canSend: true });
  });

  it("falls back on the selection without @, and on nothing without a selection", () => {
    expect(routeCommand("run tests", scope({ fallback: ["d"] }))).toMatchObject({ ids: ["d"], canSend: true });
    expect(routeCommand("run tests", scope())).toMatchObject({ ids: [], canSend: false });
  });

  it("adds the chips to the typed names, once each", () => {
    expect(routeCommand("@zeus lint", scope({ chips: [{ kind: "agent", id: "b" }, { kind: "agent", id: "d" }] })).targets).toEqual([
      { kind: "agent", id: "b" },
      { kind: "agent", id: "d" },
    ]);
  });

  it("holds back a /command whose target is mistyped, rather than sending it to the selection", () => {
    expect(routeCommand("/clear @thoth/zues", scope({ fallback: ["d"] }))).toMatchObject({ unknown: "@thoth/zues", canSend: false });
  });

  it("has nothing to send with targets only", () => {
    expect(routeCommand("@thoth ", scope())).toMatchObject({ instruction: "", canSend: false });
  });
});
