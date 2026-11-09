// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import type { Member } from "@/mission/mission";
import { nodesStore } from "@/store/nodes";
import { declareSteps, markStep, report } from "./agentTools";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/kanban/orchestrate", () => ({ finishMissionCard: vi.fn(() => Promise.resolve()), flagMissionCard: vi.fn() }));
vi.mock("@/mission/queue", () => ({ afterReport: vi.fn(() => Promise.resolve()) }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));

const member: Member = { nodeId: "isis", name: "Isis", task: "t", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 1 };
const terminal = (id: string, name: string) => ({ title: "", name, agent: "claude" as const, cwd: "C:/p", shell: "default" as const, command: "" });

beforeEach(async () => {
  mockIPC(() => undefined);
  clearWirePulses();
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "orchestrator",
    payload: { name: "Chef", mission: { state: "en_cours", maxAgents: 4, budgetMin: 60, startedAt: Date.now(), members: [member] } },
  });
  await nodesStore.getState().create("isis", { workspaceId: "w1", kind: "terminal", payload: terminal("isis", "Isis") });
  await nodesStore.getState().create("seth", { workspaceId: "w1", kind: "terminal", payload: terminal("seth", "Seth") });
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
