// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import type { Member, Mission } from "@/mission/mission";
import { missionOf } from "@/mission/store";
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
  await setup([member("a", "Batman", { handedTo: "Aquaman" }), member("b", "Aquaman", { report: { summary: "ok", status: "termine", at: 1 } }), member("c", "Shazam")]);
  const handed = await fleetTool("chef", "prolonger", { agent: "Batman", minutes: 5 });
  const reported = await fleetTool("chef", "prolonger", { agent: "Aquaman", minutes: 5 });
  const fine = await fleetTool("chef", "prolonger", { agent: "Shazam", minutes: 5 });
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
        plan: [{ title: "Login", brief: "b", agent: "Aquaman", budgetMin: 10, level: "faible" }],
        members: [member("a", "Batman", { task: "Login", handedTo: "Aquaman" }), member("b", "Aquaman", { task: "Login", model: "claude-opus-5-5" })],
      },
    },
  });
  const result = await fleetTool("chef2", "mission", {});
  expect(JSON.parse(result.content[0].text).plan[0].model).toBe("Opus 5.5");
});

it("remote_control refuses a first name two agents share instead of taking the first (backlog 27 oct)", async () => {
  await setup([member("a", "Batman"), member("b", "Batman")]);
  const result = await fleetTool("chef", "remote_control", { actif: true, agents: ["Batman"] });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("Several agents");
});

it("ecrire lights the wire from the fleet down to the agent it wrote to", async () => {
  clearWirePulses();
  await setup([member("a", "Batman")]);
  terminalStatusStore.getState().set("a", { state: "running" });
  const result = await fleetTool("chef", "ecrire", { agent: "Batman", texte: "go on" });
  expect(result.isError).not.toBe(true);
  expect(wireActivityStore.getState().pulses).toEqual({ a: { direction: "toAgent", at: expect.any(Number), fleetId: "chef" } });
  clearWirePulses();
});

describe("an agent is already on the task (add_tasks, propose_plan)", () => {
  const BANNERS = "Recolour the README banners and badges in the Dark and Expressive palettes, then commit the images.";
  const THOR = "Banners on the new palettes";
  const working = (nodeId: string) => agentActivityStore.getState().apply({ nodeId, activity: "working", since: Date.now() });
  const queue = () => missionOf(nodesStore.getState().nodes.chef)?.queue;

  /** Thor works on THOR, three minutes into its forty. */
  async function thorWorks(extra: Partial<Mission> = {}) {
    const thor = member("thor", "Thor", { task: THOR, budgetMin: 40, sentAt: Date.now() - 3 * 60_000 });
    await nodesStore.getState().create("chef", {
      workspaceId: "w1",
      kind: "fleet",
      payload: { name: "Chef", session, mission: { state: "en_cours", maxAgents: 4, budgetMin: 120, startedAt: Date.now(), plan: [{ title: THOR, brief: BANNERS, agent: "Thor", budgetMin: 40 }], members: [thor], ...extra } },
    });
    terminalStatusStore.getState().set("thor", { state: "running" });
    working("thor");
  }

  it("add_tasks refuses a task a mission's agent is at work on, naming it, and queues none of the call", async () => {
    await thorWorks();
    const task = (titre: string, consigne: string) => ({ titre, consigne, budget_min: 15 });
    const said = await fleetTool("chef", "add_tasks", { tasks: [task("Link agents to the Kanban board", "Link every agent to its card on the Kanban board"), task(`${THOR.toUpperCase()}!`, "Recolour the banners and badges in the Dark palette")] });
    expect(said).toEqual({
      content: [{ type: "text", text: `Nothing was added: Task 2 ("${THOR.toUpperCase()}!"): Thor is already working on "${THOR}" (working, 3 of 40 min). Message or read that agent instead of queueing another, then add the other tasks.` }],
      isError: true,
    });
    // The same brief under another title.
    const byBrief = await fleetTool("chef", "add_tasks", { tasks: [task("Palettes", "Recolour the README badges and banners in the Expressive and Dark palettes, and the images")] });
    expect(byBrief.isError).toBe(true);
    expect(byBrief.content[0].text).toContain(`Thor is already working on "${THOR}"`);
    expect(queue()).toBeUndefined();
  });

  it("add_tasks queues a different task of the same repo, and any task once its agent has reported", async () => {
    await thorWorks();
    const task = { titre: "Kanban", consigne: "Link every agent to its card on the Kanban board", budget_min: 15 };
    expect((await fleetTool("chef", "add_tasks", { tasks: [task] })).isError).toBeUndefined();
    expect(queue()?.map((t) => t.title)).toEqual(["Kanban"]);
    // Thor reports: nobody is on THOR any more.
    const thor = member("thor", "Thor", { task: THOR, budgetMin: 40, sentAt: 1, report: { summary: "ok", status: "termine", at: 2 } });
    nodesStore.getState().update("chef", { mission: { ...missionOf(nodesStore.getState().nodes.chef)!, members: [thor] } });
    expect((await fleetTool("chef", "add_tasks", { tasks: [{ titre: `${THOR} again`, consigne: BANNERS, budget_min: 15 }] })).isError).toBeUndefined();
  });

  it("add_tasks counts an agent between two turns, not one that stopped", async () => {
    await thorWorks();
    const again = (titre: string) => ({ tasks: [{ titre, consigne: "Recolour the banners and badges in the Dark palette", budget_min: 15 }] });
    // Its turn ended, no report: it is still on the task.
    agentActivityStore.getState().apply({ nodeId: "thor", activity: "idle", since: Date.now() + 1 });
    const idle = await fleetTool("chef", "add_tasks", again(`${THOR}!`));
    expect(idle.isError).toBe(true);
    expect(idle.content[0].text).toContain('(between two turns, 3 of 40 min)');
    terminalStatusStore.getState().set("thor", { state: "exited", code: 0 });
    expect((await fleetTool("chef", "add_tasks", again(`${THOR}?`))).isError).toBeUndefined();
  });

  it("propose_plan refuses a sub-task a sub-agent is at work on, and proposes the rest of a plan without it", async () => {
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", session, mission: { state: "redaction", maxAgents: 4, members: [] } } });
    await nodesStore.getState().create("robin", {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: "Router tests", name: "Robin", agent: "claude", cwd: "C:/p", shell: "default", command: "", spawnedBy: "batman", task: "Write the unit tests for the router: cover the errors and the edge cases" },
    });
    terminalStatusStore.getState().set("robin", { state: "running" });
    working("robin");
    const sub = (titre: string, consigne: string) => ({ titre, consigne, agent: "nouveau", budget_min: 20 });
    const plan = (...sous_taches: ReturnType<typeof sub>[]) => ({ nom: "Tests", tache: "Cover the code", sous_taches });
    const refused = await fleetTool("chef", "proposer_plan", plan(sub("Docs", "Write the user guide for the settings"), sub("router TESTS", "Cover the router")));
    expect(refused).toEqual({
      content: [{ type: "text", text: 'No plan proposed: Task 2 ("router TESTS"): Robin is already working on "Router tests" (working). Message or read that agent instead of planning another, then propose the plan without that sub-task.' }],
      isError: true,
    });
    expect(missionOf(nodesStore.getState().nodes.chef)?.state).toBe("redaction");
    expect((await fleetTool("chef", "proposer_plan", plan(sub("Docs", "Write the user guide for the settings")))).isError).toBeUndefined();
    expect(missionOf(nodesStore.getState().nodes.chef)?.state).toBe("plan");
  });
});
