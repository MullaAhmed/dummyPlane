// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import type { Member } from "@/mission/mission";
import { fleetTool } from "./fleetTools";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/mission/launch", () => ({ endMission: vi.fn(), mergeMission: vi.fn(), reassignTask: vi.fn() }));
vi.mock("@/agents/broadcast", () => ({ pauseAgents: vi.fn(() => Promise.resolve(1)) }));
vi.mock("@/agents/remoteControl", () => ({ setRemoteControl: vi.fn() }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(() => ""), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity), freshText: vi.fn(() => "") }));

const session = { title: "Chef", name: "Chef", agent: "claude" as const, cwd: "C:/p", shell: "default" as const, command: "", role: "orchestrator" as const };
const member = (nodeId: string, name: string, extra: Partial<Member> = {}): Member => ({ nodeId, name, task: "t", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 1, ...extra });

async function setup(members: Member[]) {
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", session, mission: { state: "en_cours", maxAgents: 4, budgetMin: 120, startedAt: Date.now(), members } },
  });
}

beforeEach(() => {
  mockIPC(() => undefined);
  terminalStatusStore.getState().set("chef", { state: "running" });
});

it("refuses to extend an agent that handed its sub-task over or has already reported (backlog H3)", async () => {
  await setup([member("a", "Isis", { handedTo: "Horus" }), member("b", "Horus", { report: { summary: "ok", status: "termine", at: 1 } }), member("c", "Seth")]);
  const handed = await fleetTool("chef", "prolonger", { agent: "Isis", minutes: 5 });
  const reported = await fleetTool("chef", "prolonger", { agent: "Horus", minutes: 5 });
  const fine = await fleetTool("chef", "prolonger", { agent: "Seth", minutes: 5 });
  expect(handed.isError).toBe(true);
  expect(reported.isError).toBe(true);
  expect(fine.isError).not.toBe(true);
});

it("mission() gives the model of the agent that holds a sub-task, not the planned one, after a reassign (backlog Routeur)", async () => {
  await nodesStore.getState().create("chef2", {
    workspaceId: "w1",
    kind: "fleet",
    payload: {
      name: "Chef",
      mission: {
        state: "en_cours",
        maxAgents: 4,
        router: true,
        plan: [{ title: "Login", brief: "b", agent: "Horus", budgetMin: 10, level: "faible" }],
        members: [member("a", "Isis", { task: "Login", handedTo: "Horus" }), member("b", "Horus", { task: "Login", model: "claude-opus-5-5" })],
      },
    },
  });
  const result = await fleetTool("chef2", "mission", {});
  expect(JSON.parse(result.content[0].text).plan[0].model).toBe("Opus 5.5");
});

it("remote_control refuses a first name two agents share instead of taking the first (backlog 27 oct)", async () => {
  await setup([member("a", "Isis"), member("b", "Isis")]);
  const result = await fleetTool("chef", "remote_control", { actif: true, agents: ["Isis"] });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("Several agents");
});

it("ecrire lights the wire from the fleet down to the agent it wrote to", async () => {
  clearWirePulses();
  await setup([member("a", "Isis")]);
  terminalStatusStore.getState().set("a", { state: "running" });
  const result = await fleetTool("chef", "ecrire", { agent: "Isis", texte: "go on" });
  expect(result.isError).not.toBe(true);
  expect(wireActivityStore.getState().pulses).toEqual({ a: { direction: "toAgent", at: expect.any(Number), fleetId: "chef" } });
  clearWirePulses();
});
