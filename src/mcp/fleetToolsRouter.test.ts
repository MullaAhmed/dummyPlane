// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { fleetTool } from "./fleetTools";
import { modelRouterStore } from "@/app/modelRouterSetting";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/mission/launch", () => ({ endMission: vi.fn(), mergeMission: vi.fn(), reassignTask: vi.fn(), deliveryPending: vi.fn(() => false) }));
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
  // The router as before Settings had one: only a switch set on routes. The global setting has its own tests.
  modelRouterStore.setState({ on: false, levels: {} });
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

describe("with Settings' model router on", () => {
  const view = async () => JSON.parse((await fleetTool("chef", "mission", {})).content[0].text) as { router: boolean; linked_agents: { name: string; router?: boolean }[]; plan: { model: string | null }[] | null };
  const sub = (titre: string, extra: Record<string, unknown> = {}) => ({ titre, consigne: "Do it", agent: "nouveau", budget_min: 20, ...extra });
  const plan = (...sous_taches: ReturnType<typeof sub>[]) => ({ nom: "Auth", tache: "Add the login", sous_taches });

  beforeEach(() => modelRouterStore.setState({ on: true }));

  it("tells the Fleet its router is on while its switch is unset, and off once it is set off", async () => {
    expect((await view()).router).toBe(true);
    nodesStore.getState().update("chef", { mission: { state: "plan", maxAgents: 4, members: [], router: false } });
    expect((await view()).router).toBe(false);
  });

  it("names a linked agent's own switch only when it is set, off included", async () => {
    nodesStore.getState().update("b2", { router: false });
    const linked = (await view()).linked_agents;
    expect(linked.find((a) => a.name === "Batgirl")?.router).toBe(true);
    expect(linked.find((a) => a.name === "Robin")?.router).toBe(false);
  });

  it("needs a level for each sub-task of a Claude team, and says the model each picks", async () => {
    const refused = await fleetTool("chef", "proposer_plan", plan(sub("Login")));
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("a level (low, medium, high or extreme)");
    expect((await fleetTool("chef", "proposer_plan", plan(sub("Login", { niveau: "faible" })))).isError).toBeUndefined();
    expect((await view()).plan?.[0].model).toBe("Haiku 5.5");
  });

  it("plans a Codex team with nothing mapped as before, levels optional, and maps them once Settings has models", async () => {
    nodesStore.getState().update("chef", { session: { ...claude, name: "Chef", role: "orchestrator", agent: "codex" } });
    expect((await fleetTool("chef", "proposer_plan", plan(sub("Login")))).isError).toBeUndefined();
    modelRouterStore.setState({ levels: { codex: { eleve: "gpt-big" } } });
    expect((await fleetTool("chef", "proposer_plan", plan(sub("Login")))).isError).toBe(true);
    expect((await fleetTool("chef", "proposer_plan", plan(sub("Login", { niveau: "eleve" })))).isError).toBeUndefined();
    expect((await view()).plan?.[0].model).toBe("gpt-big");
  });
});
