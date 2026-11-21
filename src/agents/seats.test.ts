// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { subagentSettingsStore } from "@/app/subagentSettings";
import { NEW_MISSION, type Mission } from "@/mission/mission";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, type NodeRecord } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { adHocLimit, adHocOf, costlyModel, fullCap, underway, whoWaits } from "./seats";

// sceneAccess, which the counts of ./spawnFamily read, pulls Excalidraw in.
vi.mock("@excalidraw/excalidraw", () => ({ newElementWith: (e: { version: number }, fields: object) => ({ ...e, ...fields, version: e.version + 1 }) }));

const terminal = (name: string, extra: Partial<TerminalPayload> = {}): NodeRecord => ({
  workspaceId: "w1",
  kind: "terminal",
  payload: { title: name, name, agent: "claude", cwd: "C:/code/wt", shell: "pwsh", command: "", ...extra },
});
const fleet = (mission?: Mission): NodeRecord => ({ workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", ...(mission ? { mission } : {}) } });
const mission = (state: Mission["state"]): Mission => ({ ...NEW_MISSION, state });

beforeEach(() => {
  nodesStore.setState({ nodes: {} });
  for (const id of Object.keys(terminalStatusStore.getState().statuses)) terminalStatusStore.getState().remove(id);
  subagentSettingsStore.setState({ maxSpawned: 2 });
});

describe("the limit on what a Fleet's ad-hoc agents open (adHocLimit)", () => {
  /** A Fleet over an ad-hoc agent, its sub-agent, and a loose agent no Fleet is over. */
  function tree(state: Mission["state"] | undefined) {
    nodesStore.setState({
      nodes: {
        fleet: fleet(state ? mission(state) : undefined),
        adhoc: terminal("Adhoc", { spawnedBy: "fleet" }),
        grandchild: terminal("Grandchild", { spawnedBy: "adhoc" }),
        loose: terminal("Loose"),
        loosechild: terminal("Loosechild", { spawnedBy: "loose" }),
      },
    });
  }

  it("binds the Fleet itself as `fleet`, its ad-hoc agents and whatever descends from them as `below`, while its mission launches or runs", () => {
    for (const state of ["lancement", "en_cours"] as const) {
      tree(state);
      expect(adHocLimit("fleet")).toBe("fleet");
      expect(adHocLimit("adhoc")).toBe("below");
      expect(adHocLimit("grandchild")).toBe("below");
    }
  });

  it("binds no agent a Fleet is not over, nor any once its mission is not under way: it lifts with the mission", () => {
    tree("en_cours");
    expect(adHocLimit("loose")).toBeNull();
    expect(adHocLimit("loosechild")).toBeNull();
    for (const state of ["redaction", "plan", "terminee", undefined] as const) {
      tree(state);
      for (const id of ["fleet", "adhoc", "grandchild"]) expect(adHocLimit(id)).toBeNull();
    }
  });

  it("stops at a mission's Manager: it, its team and what they open are the plan's, though the Manager stands under the Fleet", () => {
    nodesStore.setState({
      nodes: {
        fleet: fleet(mission("en_cours")),
        manager: terminal("Manager", { role: "manager", fleet: "fleet", spawnedBy: "fleet" }),
        thor: terminal("Thor", { spawnedBy: "manager" }),
        thorschild: terminal("Thorschild", { spawnedBy: "thor" }),
      },
    });
    for (const id of ["manager", "thor", "thorschild"]) expect(adHocLimit(id)).toBeNull();
  });

  it("leaves out an ad-hoc agent the plan names: a linked agent of the mission is a member, its levels the plan's", () => {
    nodesStore.setState({
      nodes: {
        fleet: fleet({ ...mission("en_cours"), members: [{ nodeId: "adhoc", name: "Adhoc", task: "Docs", budgetMin: 20, linked: true, branch: "b", worktree: "w" }] }),
        adhoc: terminal("Adhoc", { spawnedBy: "fleet" }),
        grandchild: terminal("Grandchild", { spawnedBy: "adhoc" }),
        other: terminal("Other", { spawnedBy: "fleet" }),
      },
    });
    for (const id of ["adhoc", "grandchild"]) expect(adHocLimit(id)).toBeNull();
    // Another ad-hoc agent of the same Fleet is still held.
    expect(adHocLimit("other")).toBe("below");
  });

  it("names the Fleet each ad-hoc agent stands under (adHocOf): its card is on that Fleet's mission board", () => {
    tree("en_cours");
    expect(adHocOf("fleet")).toEqual({ fleetId: "fleet", limit: "fleet" });
    expect(adHocOf("adhoc")).toEqual({ fleetId: "fleet", limit: "below" });
    expect(adHocOf("grandchild")).toEqual({ fleetId: "fleet", limit: "below" });
    expect(adHocOf("loose")).toBeNull();
    tree("terminee");
    expect(adHocOf("adhoc")).toBeNull();
  });

  it("is not lost on a cycle of spawners, nor on an agent that left the store", () => {
    nodesStore.setState({ nodes: { a: terminal("A", { spawnedBy: "b" }), b: terminal("B", { spawnedBy: "a" }) } });
    expect(adHocLimit("a")).toBeNull();
    expect(adHocLimit("gone")).toBeNull();
  });

  it("holds Opus and Fable named by hand as it holds their levels", () => {
    for (const model of ["opus", "Opus", "claude-opus-5-5", "fable", "claude-fable-5-2"]) expect(costlyModel(model)).toBe(true);
    for (const model of ["sonnet", "haiku", "claude-sonnet-5-5", ""]) expect(costlyModel(model)).toBe(false);
  });
});

describe("what a refused caller can do next (whoWaits)", () => {
  it("queues for a Fleet with a mission under way and for a mission's Manager, waits for a Fleet with none, and sends a manager sub-agent to its parent", () => {
    nodesStore.setState({
      nodes: {
        running: fleet(mission("en_cours")),
        idle: fleet(mission("terminee")),
        manager: terminal("Manager", { role: "manager", fleet: "running" }),
        boss: terminal("Boss", { coordinator: true }),
        plain: terminal("Plain"),
      },
    });
    expect(underway(nodesStore.getState().nodes.running)).toBe(true);
    expect(underway(nodesStore.getState().nodes.idle)).toBe(false);
    expect(whoWaits("running")).toBe("queue");
    expect(whoWaits("idle")).toBe("wait");
    expect(whoWaits("manager")).toBe("queue");
    expect(whoWaits("boss")).toBe("manager");
    expect(whoWaits("plain")).toBe("agent");
    expect(whoWaits("gone")).toBe("agent");
  });
});

describe("the cap on sub-agents running at once (fullCap)", () => {
  it("is full at the cap and says who holds the seats, by folder; a seat is free below it", () => {
    nodesStore.setState({ nodes: { top: terminal("Top"), one: terminal("One", { spawnedBy: "top" }), two: terminal("Two", { spawnedBy: "top" }) } });
    terminalStatusStore.getState().set("one", { state: "running" });
    expect(fullCap()).toBeNull();
    terminalStatusStore.getState().set("two", { state: "running" });
    expect(fullCap()).toEqual({ held: 2, max: 2, who: "One, Two (wt)" });
  });
});
