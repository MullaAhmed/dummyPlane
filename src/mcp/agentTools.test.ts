// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import type { Member } from "@/mission/mission";
import { notify } from "@/mission/events";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { fleetSession } from "@/nodes/terminal/launch";
import { agentTools, declareSteps, markStep, report, spawnAgentSpec } from "./agentTools";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/kanban/fleetBoards", () => ({ finishMissionCard: vi.fn(() => Promise.resolve()), flagMissionCard: vi.fn() }));
vi.mock("@/mission/queue", () => ({ afterReport: vi.fn(() => Promise.resolve()) }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));

const member: Member = { nodeId: "batman", name: "Batman", task: "t", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 1 };
const terminal = (name: string, spawnedBy?: string) => ({
  title: "",
  name,
  agent: "claude" as const,
  cwd: "C:/p",
  shell: "default" as const,
  command: "",
  ...(spawnedBy ? { spawnedBy } : {}),
});

beforeEach(async () => {
  mockIPC(() => undefined);
  clearWirePulses();
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", mission: { state: "en_cours", maxAgents: 4, budgetMin: 60, startedAt: Date.now(), members: [member] } },
  });
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: terminal("Batman") });
  await nodesStore.getState().create("shazam", { workspaceId: "w1", kind: "terminal", payload: terminal("Shazam") });
  // Robin was opened by Shazam with spawn_agent.
  await nodesStore.getState().create("robin", { workspaceId: "w1", kind: "terminal", payload: terminal("Robin", "shazam") });
  terminalStatusStore.getState().set("shazam", { state: "running" });
  vi.mocked(notify).mockClear();
});
afterEach(() => clearWirePulses());

const pulses = () => wireActivityStore.getState().pulses;

it("lights the wire up to the fleet when a member declares or marks a step, and reports", () => {
  declareSteps("batman", { etapes: ["Plan", "Code"] });
  expect(pulses().batman).toMatchObject({ direction: "toFleet", fleetId: "chef" });
  clearWirePulses();
  expect(markStep("batman", { titre: "Plan", etat: "en_cours" }).isError).not.toBe(true);
  expect(pulses().batman).toMatchObject({ direction: "toFleet", fleetId: "chef" });
  clearWirePulses();
  expect(report("batman", { resume: "Done", statut: "termine" }).isError).not.toBe(true);
  expect(pulses().batman).toMatchObject({ direction: "toFleet", fleetId: "chef" });
});

it("lights every wire reaching an agent outside a mission when it marks a step, and none for a refused call", () => {
  expect(markStep("shazam", { titre: "Plan", etat: "nope" }).isError).toBe(true);
  expect(declareSteps("shazam", { etapes: [] }).isError).toBe(true);
  expect(pulses()).toEqual({});
  markStep("shazam", { titre: "Plan", etat: "en_cours" });
  expect(pulses().shazam).toEqual({ direction: "toFleet", at: expect.any(Number) });
});

// Nobody hears it, yet its work is done: its terminal minimizes all the same.
it("minimizes a terminal outside any mission that reports its work done, its report kept for its card", () => {
  expect(report("shazam", { resume: "Done", statut: "termine" }).isError).not.toBe(true);
  expect(terminalOf(nodesStore.getState().nodes.shazam)).toMatchObject({ minimized: true, lastReport: { status: "done", summary: "Done" } });
});

it("settles the steps of a member that reports without having marked its last one", () => {
  const states = (id: string) => terminalOf(nodesStore.getState().nodes[id])?.steps?.map((s) => s.state);
  declareSteps("batman", { etapes: ["Plan", "Code", "Commit and report"] });
  markStep("batman", { titre: "Plan", etat: "fait" });
  markStep("batman", { titre: "Code", etat: "fait" });
  markStep("batman", { titre: "Commit and report", etat: "en_cours" });
  report("batman", { resume: "Done", statut: "termine" });
  expect(states("batman")).toEqual(["fait", "fait", "fait"]);
  // Blocked: the step under way fails, the ones to come wait.
  declareSteps("shazam", { etapes: ["Plan", "Code", "Ship"] });
  markStep("shazam", { titre: "Plan", etat: "fait" });
  markStep("shazam", { titre: "Code", etat: "en_cours" });
  report("shazam", { resume: "Needs a key", statut: "bloque" });
  expect(states("shazam")).toEqual(["fait", "echec", "a_venir"]);
});

it("keeps a terminal outside any mission that reports itself blocked open: someone has to look", () => {
  expect(report("shazam", { resume: "Needs a key", statut: "bloque" }).isError).not.toBe(true);
  const payload = terminalOf(nodesStore.getState().nodes.shazam);
  expect(payload?.minimized).toBeUndefined();
  expect(payload?.lastReport).toEqual({ status: "blocked", summary: "Needs a key" });
});

it("leaves a terminal as it was when its report is refused: no summary, or a status `report` does not know", () => {
  const before = nodesStore.getState().nodes.shazam;
  report("shazam", { statut: "termine" });
  report("shazam", { resume: "Done", statut: "done" });
  expect(nodesStore.getState().nodes.shazam).toBe(before);
});

it("offers spawn_agent to every Claude session, its task required", () => {
  const spawn = agentTools().find((tool) => tool.name === "spawn_agent")!;
  expect(spawn.inputSchema.required).toEqual(["task"]);
  expect(Object.keys(spawn.inputSchema.properties)).toEqual(["task", "title", "model"]);
  expect(spawn.description).toContain("3 levels");
});

it("minimizes a spawned agent that reports its work done, its parent told all the same", () => {
  report("robin", { resume: "Tests written", statut: "termine" });
  expect(terminalOf(nodesStore.getState().nodes.robin)).toMatchObject({ minimized: true, lastReport: { status: "done", summary: "Tests written" } });
  expect(notify).toHaveBeenCalledWith("shazam", expect.stringContaining("Robin reported"));
});

it("types a spawned agent's report into its parent and lights the wire toward it", () => {
  const result = report("robin", { resume: "Tests written\nall green", statut: "termine" });
  expect(result).toEqual({ content: [{ type: "text", text: "Report passed on to Shazam." }] });
  expect(notify).toHaveBeenCalledWith("shazam", "Robin reported (done): Tests written all green");
  expect(pulses().robin).toMatchObject({ direction: "toFleet", fleetId: "shazam" });
});

it("lights only the parent's wire when a spawned agent declares or marks a step", () => {
  declareSteps("robin", { etapes: ["Plan"] });
  expect(pulses().robin).toMatchObject({ direction: "toFleet", fleetId: "shazam" });
  clearWirePulses();
  markStep("robin", { titre: "Plan", etat: "fait" });
  expect(pulses().robin).toMatchObject({ direction: "toFleet", fleetId: "shazam" });
});

it("checks a spawned agent's report like a mission's, and says so when its parent is gone", () => {
  expect(report("robin", { resume: " ", statut: "termine" }).isError).toBe(true);
  expect(report("robin", { resume: "x", statut: "nope" }).isError).toBe(true);
  terminalStatusStore.getState().set("shazam", { state: "exited", code: 0 });
  expect(report("robin", { resume: "Done", statut: "bloque" }).content[0].text).toContain("is closed");
  expect(notify).not.toHaveBeenCalled();
});

it("tells both the fleet and the parent when a spawned agent is also a mission member", async () => {
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: terminal("Batman", "shazam") });
  const result = report("batman", { resume: "Done", statut: "termine" });
  expect(vi.mocked(notify).mock.calls.map(([to]) => to).sort()).toEqual(["chef", "shazam"]);
  expect(result.content[0].text).toContain("Report passed on to Shazam.");
});

it("still has nobody to tell for an agent neither in a mission nor spawned", () => {
  expect(report("shazam", { resume: "Done", statut: "termine" }).content[0].text).toBe("No mission under way: nothing to pass on.");
  expect(notify).not.toHaveBeenCalled();
});

describe("a Fleet's sub-agent (spawn_agent)", () => {
  beforeEach(async () => {
    // A Fleet outside any mission, its session running, that opened Cyborg with spawn_agent.
    await nodesStore.getState().create("fleet", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", session: fleetSession("Fleet", { cwd: "C:/p", shell: "default" }) } });
    await nodesStore.getState().create("cyborg", { workspaceId: "w1", kind: "terminal", payload: terminal("Cyborg", "fleet") });
    terminalStatusStore.getState().set("fleet", { state: "running" });
  });

  it("types its report into the Fleet's terminal and lights the wire toward it", () => {
    const result = report("cyborg", { resume: "Found it in src/mcp", statut: "termine" });
    expect(result).toEqual({ content: [{ type: "text", text: "Report passed on to Fleet." }] });
    expect(notify).toHaveBeenCalledWith("fleet", "Cyborg reported (done): Found it in src/mcp");
    expect(pulses().cyborg).toMatchObject({ direction: "toFleet", fleetId: "fleet" });
    expect(terminalOf(nodesStore.getState().nodes.cyborg)).toMatchObject({ lastReport: { status: "done", summary: "Found it in src/mcp" } });
  });

  it("lights the Fleet's wire when it declares or marks a step", () => {
    declareSteps("cyborg", { etapes: ["Look"] });
    expect(pulses().cyborg).toMatchObject({ direction: "toFleet", fleetId: "fleet" });
  });

  it("says so when the Fleet's session no longer runs", () => {
    terminalStatusStore.getState().set("fleet", { state: "exited", code: 0 });
    expect(report("cyborg", { resume: "Done", statut: "termine" }).content[0].text).toContain("is closed");
    expect(notify).not.toHaveBeenCalled();
  });

  it("is described to the Fleet as ad-hoc work beside its mission's queue, in its workspace's folder", () => {
    const spawn = spawnAgentSpec(true);
    expect(spawn.name).toBe("spawn_agent");
    expect(spawn.inputSchema).toEqual(agentTools().find((tool) => tool.name === "spawn_agent")!.inputSchema);
    expect(spawn.description).toContain("outside your mission's queue");
    expect(spawn.description).toContain("in your workspace's folder");
    expect(spawn.description).toContain("not on your team");
    expect(spawn.description).toContain("3 levels below you");
  });
});
