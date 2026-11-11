import { STORED_FLEET_KIND } from "@/canvas/nodeElement";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canvasStore } from "@/canvas/canvasStore";
import { nodesStore, type NodeRecord } from "@/store/nodes";
import { NEW_MISSION } from "./mission";
import { rememberScene, forgetScene } from "@/canvas/sceneCache";
import { workspacesStore } from "@/store/workspaces";
import { agentGroup, canvasKnown, linkedTeamAgents, linkedGroups, memberBudgets, memberOf, fleetShown, setFleetClosed, workspaceCanvas } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));

it("gives each agent of a running mission its time and budget, for the bars", () => {
  const member = { name: "Batman", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w" };
  const nodes: Record<string, NodeRecord> = {
    chef: {
      workspaceId: "w1",
      kind: "fleet",
      payload: { name: "Chef", mission: { ...NEW_MISSION, state: "en_cours", members: [{ ...member, nodeId: "batman", sentAt: 0, extraMin: 5 }, { ...member, nodeId: "aquaman" }, { ...member, nodeId: "shazam", sentAt: 0, handedTo: "Batman" }] } },
    },
    fini: { workspaceId: "w1", kind: "fleet", payload: { name: "Fini", mission: { ...NEW_MISSION, state: "terminee", members: [{ ...member, nodeId: "cyborg", sentAt: 0 }] } } },
  };
  expect(memberBudgets(nodes, 6 * 60_000)).toEqual({ batman: { spent: 6, budget: 15 } });
});

it("freezes the time of an agent that reported at its report and gives its status for the bar", () => {
  const member = { name: "Batman", task: "Login", budgetMin: 50, linked: false, branch: "b", worktree: "w", sentAt: 0 };
  const min = 60_000;
  const report = (status: "termine" | "bloque" | "echec") => ({ summary: "s", status, at: 22 * min });
  const nodes: Record<string, NodeRecord> = {
    chef: {
      workspaceId: "w1",
      kind: "fleet",
      payload: {
        name: "Chef",
        mission: {
          ...NEW_MISSION,
          state: "en_cours",
          members: [
            { ...member, nodeId: "batman", report: report("termine") },
            { ...member, nodeId: "aquaman", report: report("bloque") },
            { ...member, nodeId: "shazam", report: report("echec") },
            { ...member, nodeId: "robin" },
          ],
        },
      },
    },
  };
  const at = (minutes: number) => memberBudgets(nodes, minutes * min);
  expect(at(30)).toEqual({
    batman: { spent: 22, budget: 50, report: "termine" },
    aquaman: { spent: 22, budget: 50, report: "bloque" },
    shazam: { spent: 22, budget: 50, report: "echec" },
    robin: { spent: 30, budget: 50 },
  });
  // Never growing after the report; the one still working goes on.
  expect(at(200).batman).toEqual({ spent: 22, budget: 50, report: "termine" });
  expect(at(200).robin).toEqual({ spent: 200, budget: 50 });
});

it("forgets the mission of a closed fleet until an undo brings it back", () => {
  const member = { nodeId: "batman", name: "Batman", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 0 };
  nodesStore.setState({
    nodes: { chef: { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", mission: { ...NEW_MISSION, state: "en_cours", members: [member] } } } },
  });
  expect(memberOf("batman")?.fleetId).toBe("chef");
  setFleetClosed("chef", true);
  expect(memberOf("batman")).toBeNull();
  expect(memberOf("batman", { evenClosed: true })?.fleetId).toBe("chef");
  setFleetClosed("chef", false);
  expect(memberOf("batman")?.fleetId).toBe("chef");
});

describe("what the fleet reads of the groups", () => {
  const frame = (id: string, name: string, memberIds: string[], speciality?: string) => ({
    id, name, x: 0, y: 0, width: 10, height: 10, memberIds, group: { role: "general" as const, pantheon: "egyptian", ...(speciality ? { speciality } : {}) },
  });

  beforeEach(() => {
    nodesStore.setState({ nodes: {} });
    canvasStore.setState({
      frames: [frame("g1", "Interface", ["batman"], "Frontend"), frame("g2", "Serveur", ["aquaman"]), frame("g3", "Loin", ["shazam"], "Tests")],
      links: { chef: { groupIds: ["g1", "g2"], nodeIds: [] } },
    });
  });

  it("lists the groups wired to it, with or without a speciality", () => {
    expect(linkedGroups("chef")).toEqual([
      { id: "g1", name: "Interface", speciality: "Frontend" },
      { id: "g2", name: "Serveur", speciality: null },
    ]);
    expect(linkedGroups("autre")).toEqual([]);
  });

  it("tells an agent's group and speciality; outside a group, nothing", () => {
    expect(agentGroup("batman")).toEqual({ group: "Interface", speciality: "Frontend" });
    expect(agentGroup("aquaman")).toEqual({ group: "Serveur", speciality: null });
    expect(agentGroup("seul")).toEqual({ group: null, speciality: null });
  });
});

it("draws no budget bar for a closed fleet's mission (final review R3)", () => {
  const member = { nodeId: "batman", name: "Batman", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 0 };
  const nodes: Record<string, NodeRecord> = {
    chef: { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", mission: { ...NEW_MISSION, state: "en_cours", members: [member] } } },
  };
  setFleetClosed("chef", true);
  expect(memberBudgets(nodes, 60 * 60_000)).toEqual({});
  setFleetClosed("chef", false);
  expect(memberBudgets(nodes, 60 * 60_000)).toEqual({ batman: { spent: 60, budget: 10 } });
});

describe("a workspace not on screen", () => {
  const terminal = { title: "", name: "Batman", agent: "claude" as const, cwd: "C:/", shell: "default" as const, command: "" };
  const frame = { id: "g1", type: "frame", name: "Interface", x: 0, y: 0, width: 10, height: 10, isDeleted: false, frameId: null, customData: { dummyplane: { kind: "group", role: "frontend", pantheon: "norse", speciality: "Frontend" } } };
  const batman = { id: "batman", type: "embeddable", isDeleted: false, frameId: "g1", x: 0, y: 0, width: 1, height: 1, customData: { kind: "terminal" } };
  const chef = { id: "chef", type: "embeddable", isDeleted: false, frameId: null, x: 0, y: 0, width: 1, height: 1, customData: { kind: STORED_FLEET_KIND } };
  const wire = { id: "w", type: "arrow", isDeleted: false, frameId: null, startBinding: { elementId: "chef" }, endBinding: { elementId: "g1" } };

  beforeEach(() => {
    nodesStore.setState({ nodes: { chef: { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } }, batman: { workspaceId: "w1", kind: "terminal", payload: terminal } } });
    workspacesStore.setState({ activeId: "w2" });
    canvasStore.setState({ frames: [], links: {} });
    rememberScene("w1", [frame, batman, chef, wire] as never, {} as never, {}, []);
  });

  it("reads wires and groups from its stored scene, not from the canvas on screen", () => {
    expect(linkedTeamAgents("chef")).toEqual([{ nodeId: "batman", name: "Batman" }]);
    expect(linkedGroups("chef")).toEqual([{ id: "g1", name: "Interface", speciality: "Frontend" }]);
    expect(agentGroup("batman")).toEqual({ group: "Interface", speciality: "Frontend" });
    expect(workspaceCanvas("w1").frames.map((f) => f.id)).toEqual(["g1"]);
    expect(canvasKnown("chef")).toBe(true);
  });

  it("counts a Codex agent in, which has dummyPlane's tools too, and leaves a plain shell out", () => {
    nodesStore.getState().update("batman", { agent: "codex" });
    expect(linkedTeamAgents("chef")).toEqual([{ nodeId: "batman", name: "Batman" }]);
    nodesStore.getState().update("batman", { agent: "shell" });
    expect(linkedTeamAgents("chef")).toEqual([]);
  });

  it("is unknown only when its scene was never read", () => {
    forgetScene("w1");
    expect(canvasKnown("chef")).toBe(false);
    expect(linkedTeamAgents("chef")).toEqual([]);
  });

  it("reads the live canvas when it is the one on screen", () => {
    workspacesStore.setState({ activeId: "w1" });
    canvasStore.setState({ api: {} as never });
    expect(linkedTeamAgents("chef")).toEqual([]);
    expect(canvasKnown("chef")).toBe(true);
    canvasStore.setState({ api: null });
    forgetScene("w1");
  });

  it("reads its stored scene from the home screen: the workspace is still the active one, no canvas is mounted (review)", () => {
    workspacesStore.setState({ activeId: "w1" });
    expect(fleetShown("chef")).toBe(false);
    expect(linkedTeamAgents("chef")).toEqual([{ nodeId: "batman", name: "Batman" }]);
    forgetScene("w1");
  });
});

it("does not offer an agent already in another running mission (backlog H2)", () => {
  const member = { name: "Batman", task: "Login", budgetMin: 10, linked: true, branch: "b", worktree: "w", sentAt: 0 };
  const terminal = { title: "", name: "Batman", agent: "claude" as const, cwd: "C:/", shell: "default" as const, command: "" };
  nodesStore.setState({
    nodes: {
      batman: { workspaceId: "w1", kind: "terminal", payload: terminal },
      busy: { workspaceId: "w1", kind: "fleet", payload: { name: "Busy", mission: { ...NEW_MISSION, state: "en_cours", members: [{ ...member, nodeId: "batman" }] } } },
      free: { workspaceId: "w1", kind: "fleet", payload: { name: "Free" } },
    },
  });
  canvasStore.setState({ api: {} as never, links: { busy: { nodeIds: ["batman"], groupIds: [] }, free: { nodeIds: ["batman"], groupIds: [] } }, frames: [] });
  expect(linkedTeamAgents("free")).toEqual([]);
  expect(linkedTeamAgents("busy").map((a) => a.nodeId)).toEqual(["batman"]);
});
