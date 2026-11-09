// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import type { Member } from "@/mission/mission";
import { notify } from "@/mission/events";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { agentTools, declareSteps, markStep, report } from "./agentTools";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/kanban/orchestrate", () => ({ finishMissionCard: vi.fn(() => Promise.resolve()), flagMissionCard: vi.fn() }));
vi.mock("@/mission/queue", () => ({ afterReport: vi.fn(() => Promise.resolve()) }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));

const member: Member = { nodeId: "isis", name: "Isis", task: "t", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 1 };
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
    kind: "orchestrator",
    payload: { name: "Chef", mission: { state: "en_cours", maxAgents: 4, budgetMin: 60, startedAt: Date.now(), members: [member] } },
  });
  await nodesStore.getState().create("isis", { workspaceId: "w1", kind: "terminal", payload: terminal("Isis") });
  await nodesStore.getState().create("seth", { workspaceId: "w1", kind: "terminal", payload: terminal("Seth") });
  // Ra was opened by Seth with spawn_agent.
  await nodesStore.getState().create("ra", { workspaceId: "w1", kind: "terminal", payload: terminal("Ra", "seth") });
  terminalStatusStore.getState().set("seth", { state: "running" });
  vi.mocked(notify).mockClear();
});
afterEach(() => clearWirePulses());

const pulses = () => wireActivityStore.getState().pulses;

it("lights the wire up to the orchestrator when a member declares or marks a step, and reports", () => {
  declareSteps("isis", { etapes: ["Plan", "Code"] });
  expect(pulses().isis).toMatchObject({ direction: "toOrchestrator", orchestratorId: "chef" });
  clearWirePulses();
  expect(markStep("isis", { titre: "Plan", etat: "en_cours" }).isError).not.toBe(true);
  expect(pulses().isis).toMatchObject({ direction: "toOrchestrator", orchestratorId: "chef" });
  clearWirePulses();
  expect(report("isis", { resume: "Done", statut: "termine" }).isError).not.toBe(true);
  expect(pulses().isis).toMatchObject({ direction: "toOrchestrator", orchestratorId: "chef" });
});

it("lights every wire reaching an agent outside a mission when it marks a step, and none for a refused call", () => {
  expect(markStep("seth", { titre: "Plan", etat: "nope" }).isError).toBe(true);
  expect(declareSteps("seth", { etapes: [] }).isError).toBe(true);
  expect(pulses()).toEqual({});
  markStep("seth", { titre: "Plan", etat: "en_cours" });
  expect(pulses().seth).toEqual({ direction: "toOrchestrator", at: expect.any(Number) });
});

it("offers spawn_agent to every Claude session, its task required", () => {
  const spawn = agentTools().find((tool) => tool.name === "spawn_agent")!;
  expect(spawn.inputSchema.required).toEqual(["task"]);
  expect(Object.keys(spawn.inputSchema.properties)).toEqual(["task", "title", "model"]);
  expect(spawn.description).toContain("3 levels");
});

it("types a spawned agent's report into its parent and lights the wire toward it", () => {
  const result = report("ra", { resume: "Tests written\nall green", statut: "termine" });
  expect(result).toEqual({ content: [{ type: "text", text: "Report passed on to Seth." }] });
  expect(notify).toHaveBeenCalledWith("seth", "Ra reported (done): Tests written all green");
  expect(pulses().ra).toMatchObject({ direction: "toOrchestrator", orchestratorId: "seth" });
});

it("lights only the parent's wire when a spawned agent declares or marks a step", () => {
  declareSteps("ra", { etapes: ["Plan"] });
  expect(pulses().ra).toMatchObject({ direction: "toOrchestrator", orchestratorId: "seth" });
  clearWirePulses();
  markStep("ra", { titre: "Plan", etat: "fait" });
  expect(pulses().ra).toMatchObject({ direction: "toOrchestrator", orchestratorId: "seth" });
});

it("checks a spawned agent's report like a mission's, and says so when its parent is gone", () => {
  expect(report("ra", { resume: " ", statut: "termine" }).isError).toBe(true);
  expect(report("ra", { resume: "x", statut: "nope" }).isError).toBe(true);
  terminalStatusStore.getState().set("seth", { state: "exited", code: 0 });
  expect(report("ra", { resume: "Done", statut: "bloque" }).content[0].text).toContain("is closed");
  expect(notify).not.toHaveBeenCalled();
});

it("tells both the orchestrator and the parent when a spawned agent is also a mission member", async () => {
  await nodesStore.getState().create("isis", { workspaceId: "w1", kind: "terminal", payload: terminal("Isis", "seth") });
  const result = report("isis", { resume: "Done", statut: "termine" });
  expect(vi.mocked(notify).mock.calls.map(([to]) => to).sort()).toEqual(["chef", "seth"]);
  expect(result.content[0].text).toContain("Report passed on to Seth.");
});

it("still has nobody to tell for an agent neither in a mission nor spawned", () => {
  expect(report("seth", { resume: "Done", statut: "termine" }).content[0].text).toBe("No mission under way: nothing to pass on.");
  expect(notify).not.toHaveBeenCalled();
});
