// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import { relaunchTerminal } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import type { Member, Mission } from "@/mission/mission";
import { deliveryPending } from "@/mission/launch";
import { activeCount, seatsHeld } from "@/mission/active";
import { missionOf, setMission, updateMember } from "@/mission/store";
import { fleetTool } from "./fleetTools";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/mission/launch", () => ({ endMission: vi.fn(), mergeMission: vi.fn(), reassignTask: vi.fn(), deliveryPending: vi.fn(() => false) }));
vi.mock("@/agents/broadcast", () => ({ pauseAgents: vi.fn(() => Promise.resolve(1)) }));
vi.mock("@/agents/remoteControl", () => ({ setRemoteControl: vi.fn() }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(() => ""), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity), freshText: vi.fn(() => ""), relaunchTerminal: vi.fn(() => Promise.resolve()) }));

const session ={ title: "Chef", name: "Chef", agent: "claude" as const, cwd: "C:/p", shell: "default" as const, command: "", role: "orchestrator" as const };
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

it("ecrire types nothing while dummyPlane still waits to type an agent's sub-task; once nobody does, what it writes is that sub-task", async () => {
  await setup([member("a", "Batman", { sentAt: undefined }), member("b", "Aquaman")]);
  terminalStatusStore.getState().set("a", { state: "running" });
  terminalStatusStore.getState().set("b", { state: "running" });
  const sentAt = (nodeId: string) => missionOf(nodesStore.getState().nodes.chef)?.members.find((m) => m.nodeId === nodeId)?.sentAt;
  // Its Claude has not opened (a question waits for the user): a line now would cross the sub-task dummyPlane types.
  vi.mocked(deliveryPending).mockReturnValueOnce(true);
  const crossing = await fleetTool("chef", "ecrire", { agent: "Batman", texte: "Your sub-task: the login" });
  expect(crossing.isError).toBe(true);
  expect(crossing.content[0].text).toContain("dummyPlane types its sub-task as soon as it does");
  expect(sentAt("a")).toBeUndefined();
  // dummyPlane gave up on it: the Manager's line is its sub-task, and its report will be the mission's.
  const delivered = await fleetTool("chef", "ecrire", { agent: "Batman", texte: "Your sub-task: the login" });
  expect(delivered.isError).not.toBe(true);
  expect(sentAt("a")).toEqual(expect.any(Number));
  // A nudge to an agent that has its sub-task changes nothing of it.
  await fleetTool("chef", "ecrire", { agent: "Aquaman", texte: "go on" });
  expect(sentAt("b")).toBe(1);
});

it("ecrire that gives an agent its sub-task drops dummyPlane's own text of it: a restart would type it on top", async () => {
  await setup([member("w1a", "Batman", { sentAt: undefined, brief: "[dummyPlane · mission Auth] Login — Do the login." })]);
  terminalStatusStore.getState().set("w1a", { state: "running" });
  const written = await fleetTool("chef", "ecrire", { agent: "Batman", texte: "Your sub-task: the login" });
  expect(written.isError).not.toBe(true);
  const held = missionOf(nodesStore.getState().nodes.chef)?.members[0];
  expect(held?.sentAt).toEqual(expect.any(Number));
  expect(held?.brief).toBeUndefined();
});

it("reassign names the sub-tasks it takes when the call passed something else, a whole brief cut short (12 Nov)", async () => {
  await setup([
    member("ra", "Batman", { task: "Login" }),
    member("rb", "Aquaman", { task: "API" }),
    member("rc", "Shazam", { task: "Docs", handedTo: "Aquaman" }),
    member("rd", "Hulk", { task: "Lint", abandoned: true }),
  ]);
  const brief = `Finish the login\nform: ${"validate every field, ".repeat(10)}then commit.`;
  const result = await fleetTool("chef", "reattribuer", { sous_tache: brief, agent: "nouveau" });
  expect(result.isError).toBe(true);
  const text = result.content[0].text;
  expect(text).toContain('Give its title as team gives it (subtask), one of: "Login", "API".');
  // Said back on one line, and short: not the whole brief again.
  expect(text).toContain('No sub-task "Finish the login form: validate every field,');
  expect(text).not.toContain("then commit");
  expect(text).not.toContain("\n");
});

describe("relaunch", () => {
  const terminal = (name: string, extra: Record<string, unknown> = {}) => ({ title: name, name, agent: "claude" as const, cwd: `C:/w/${name}`, shell: "default" as const, command: "", ...extra });
  const scene = (deleted: string[] = []) =>
    canvasStore.setState({ api: { getSceneElementsIncludingDeleted: () => ["h1", "t1", "l1", "o1", "f1", "s1"].map((id) => ({ id, isDeleted: deleted.includes(id) })) } as never });
  const named = (name: string) => missionOf(nodesStore.getState().nodes.chef)!.members.find((m) => m.name === name)!;

  beforeEach(async () => {
    vi.mocked(relaunchTerminal).mockClear();
    workspacesStore.setState({ activeId: "w1" });
    await setup([
      member("h1", "Hulk"),
      member("t1", "Thor"),
      member("l1", "Loki", { handedTo: "Thor" }),
      member("o1", "Odin"),
      member("f1", "Freya", { sentAt: undefined, brief: "[dummyPlane · mission Auth] Login — Do the login." }),
      member("s1", "Sif"),
    ]);
    for (const [id, name] of [["h1", "Hulk"], ["t1", "Thor"], ["l1", "Loki"], ["o1", "Odin"], ["f1", "Freya"], ["s1", "Sif"]]) {
      await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: terminal(name, { claudeSessionId: `session-${id}` }) });
    }
    for (const id of ["h1", "l1", "o1", "f1"]) terminalStatusStore.getState().set(id, { state: "exited", code: 0 });
    for (const id of ["t1", "s1"]) terminalStatusStore.getState().set(id, { state: "running" });
    agentActivityStore.getState().apply({ nodeId: "t1", activity: "working", since: 1 });
    // Sif's agent exited: its shell runs on, and write calls it stopped.
    agentActivityStore.getState().apply({ nodeId: "s1", activity: "idle", since: 1, left: true });
    scene(["o1"]);
  });
  afterEach(() => canvasStore.setState({ api: null }));

  it("starts a stopped agent again on its own conversation, and says write tells it what is left (12 Nov: Hulk stopped after its tests)", async () => {
    const result = await fleetTool("chef", "relaunch", { agent: "Hulk" });
    expect(result.isError).not.toBe(true);
    expect(relaunchTerminal).toHaveBeenCalledWith("h1", expect.objectContaining({ name: "Hulk", claudeSessionId: "session-h1" }), "resume");
    expect(result.content[0].text).toBe("Hulk is starting again on its own conversation. Once it is up (team, read_output), write tells it what is left.");
  });

  it("starts an agent back at its shell too: its terminal runs, its agent does not", async () => {
    const result = await fleetTool("chef", "relaunch", { agent: "Sif" });
    expect(result.isError).not.toBe(true);
    expect(relaunchTerminal).toHaveBeenCalledWith("s1", expect.objectContaining({ name: "Sif" }), "resume");
  });

  it("says dummyPlane types the sub-task of an agent that never got it, not the caller", async () => {
    const result = await fleetTool("chef", "relaunch", { agent: "Freya" });
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("dummyPlane types it as soon as its session opens, do not type it yourself.");
    expect(named("Freya").brief).toBeDefined();
  });

  it("refuses an agent at work, one that handed its sub-task over, and one whose terminal the user closed", async () => {
    const running = await fleetTool("chef", "relaunch", { agent: "Thor" });
    const handed = await fleetTool("chef", "relaunch", { agent: "Loki" });
    const closed = await fleetTool("chef", "relaunch", { agent: "Odin" });
    expect([running, handed, closed].every((r) => r.isError)).toBe(true);
    expect(running.content[0].text).toBe("Thor is running: nothing to relaunch.");
    expect(handed.content[0].text).toBe("Loki handed its sub-task to Thor: nothing to relaunch.");
    expect(closed.content[0].text).toContain("Odin's terminal is no longer on the canvas: the user closed it. Reassign its sub-task");
    expect(relaunchTerminal).not.toHaveBeenCalled();
  });

  it("takes a terminal whose scene was never read at its record's word: nothing says it was closed", async () => {
    canvasStore.setState({ api: null });
    workspacesStore.setState({ activeId: "w2" });
    const result = await fleetTool("chef", "relaunch", { agent: "Hulk" });
    expect(result.isError).not.toBe(true);
    expect(relaunchTerminal).toHaveBeenCalledTimes(1);
  });

  it("refuses a stopped agent that got its sub-task while Max agents are at work: the queue took its seat (12 Nov)", async () => {
    // Thor and Sif run, Freya waits for her sub-task: three seats. Hulk, stopped after its sub-task, holds none.
    setMission("chef", { maxAgents: 3 });
    const full = await fleetTool("chef", "relaunch", { agent: "Hulk" });
    expect(full.isError).toBe(true);
    expect(full.content[0].text).toBe("Hulk cannot start again yet: 3 agents are already at work (Max active agents), and a stopped agent holds no seat. Relaunch it once one of them reports.");
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(seatsHeld("chef")).toBe(0);
    // Those that hold their seat start again all the same: one never sent its sub-task, one back at its shell.
    expect((await fleetTool("chef", "relaunch", { agent: "Freya" })).isError).not.toBe(true);
    expect((await fleetTool("chef", "relaunch", { agent: "Sif" })).isError).not.toBe(true);
    // Once one reports, its seat is free: Hulk takes it.
    updateMember("chef", "t1", { report: { summary: "ok", status: "termine", at: 1 } });
    expect((await fleetTool("chef", "relaunch", { agent: "Hulk" })).isError).not.toBe(true);
    expect(vi.mocked(relaunchTerminal).mock.calls.map(([id]) => id)).toEqual(["f1", "s1", "h1"]);
  });

  it("starts an agent that has reported whatever Max agents says: it takes no seat", async () => {
    setMission("chef", { maxAgents: 3 });
    updateMember("chef", "h1", { report: { summary: "blocked on the API", status: "bloque", at: 1 } });
    const result = await fleetTool("chef", "relaunch", { agent: "Hulk" });
    expect(result.isError).not.toBe(true);
    expect(relaunchTerminal).toHaveBeenCalledWith("h1", expect.anything(), "resume");
  });

  it("holds the seat it takes while its terminal starts, and frees it once started or failed", async () => {
    const seatsWhileStarting: number[] = [];
    vi.mocked(relaunchTerminal).mockImplementationOnce(async () => {
      seatsWhileStarting.push(activeCount("chef", missionOf(nodesStore.getState().nodes.chef)!));
    });
    expect((await fleetTool("chef", "relaunch", { agent: "Hulk" })).isError).not.toBe(true);
    // Thor, Freya, Sif, and Hulk on its way: a report meanwhile cannot give Hulk's seat to the queue.
    expect(seatsWhileStarting).toEqual([4]);
    expect(seatsHeld("chef")).toBe(0);
    vi.mocked(relaunchTerminal).mockRejectedValueOnce(new Error("spawn refused"));
    const failed = await fleetTool("chef", "relaunch", { agent: "Hulk" });
    expect(failed.content[0].text).toBe("Hulk could not start again: spawn refused");
    expect(seatsHeld("chef")).toBe(0);
  });

  it("says why when its terminal could not start, and refuses an agent outside the mission", async () => {
    vi.mocked(relaunchTerminal).mockImplementationOnce(async (nodeId) => terminalStatusStore.getState().set(nodeId, { state: "error", message: "claude not found" }));
    const failed = await fleetTool("chef", "relaunch", { agent: "Hulk" });
    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toBe("Hulk could not start again: claude not found");
    const stranger = await fleetTool("chef", "relaunch", { agent: "Deadpool" });
    expect(stranger.isError).toBe(true);
    expect(stranger.content[0].text).toContain("is not an agent of the mission");
  });
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
