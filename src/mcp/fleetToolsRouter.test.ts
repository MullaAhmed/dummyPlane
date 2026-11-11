// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { fleetTool } from "./fleetTools";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/mission/launch", () => ({ endMission: vi.fn(), mergeMission: vi.fn(), reassignTask: vi.fn() }));
vi.mock("@/agents/broadcast", () => ({ pauseAgents: vi.fn(() => Promise.resolve(1)) }));
vi.mock("@/agents/remoteControl", () => ({ setRemoteControl: vi.fn() }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(() => ""), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity), freshText: vi.fn(() => "") }));
// Two agents wired to the Fleet: what the wires hold is scene work, tested elsewhere.
vi.mock("@/mission/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mission/store")>()),
  canvasKnown: vi.fn(() => true),
  linkedTeamAgents: vi.fn(() => [
    { nodeId: "b1", name: "Batgirl" },
    { nodeId: "b2", name: "Robin" },
  ]),
  linkedGroups: vi.fn(() => []),
}));

const claude = { title: "Batgirl", name: "Batgirl", agent: "claude" as const, cwd: "C:/p", shell: "default" as const, command: "" };

beforeEach(async () => {
  mockIPC(() => undefined);
  terminalStatusStore.getState().set("chef", { state: "running" });
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", session: { ...claude, name: "Chef", role: "orchestrator" }, mission: { state: "plan", maxAgents: 4, members: [] } },
  });
  await nodesStore.getState().create("b1", { workspaceId: "w1", kind: "terminal", payload: { ...claude, router: true } });
  await nodesStore.getState().create("b2", { workspaceId: "w1", kind: "terminal", payload: { ...claude, name: "Robin", title: "Robin" } });
});

it("mission() tells the Fleet which linked agents have their own model router on, so it gives their sub-tasks a level", async () => {
  const result = await fleetTool("chef", "mission", {});
  const linked = JSON.parse(result.content[0].text).linked_agents as { name: string; router?: true }[];
  expect(linked.find((a) => a.name === "Batgirl")?.router).toBe(true);
  // Off, the field is not there at all: nothing is said of an agent that keeps its model.
  expect(linked.find((a) => a.name === "Robin")).not.toHaveProperty("router");
});
