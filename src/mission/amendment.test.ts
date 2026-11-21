// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { canvasStore } from "@/canvas/canvasStore";
import { addTerminal } from "@/agents/terminals";
import { missionAddAgent, missionMerge } from "@/ipc/mission";
import { fleetTool } from "@/mcp/fleetTools";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { subagentSettingsStore } from "@/app/subagentSettings";
import type { TerminalPayload } from "@/nodes/types";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { holdSeat, freeSeat } from "./active";
import { approveAmendment, declineAmendment } from "./amendment";
import { notify } from "./events";
import { proposedPlan, readMission, type Member, type Mission, type QueuedTask } from "./mission";
import { afterReport, pumpQueue } from "./queue";
import { missionOf, updateMember } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/ipc/mission", () => ({ missionPrepare: vi.fn(), missionAddAgent: vi.fn(), missionMerge: vi.fn(), missionCleanup: vi.fn(), missionDiscard: vi.fn(), missionRemoveAgent: vi.fn() }));
vi.mock("@/ipc/pty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/pty")>()),
  ptySendText: vi.fn(() => Promise.resolve()),
  ptyWrite: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/nodes/terminal/registry", () => ({ relaunchTerminal: vi.fn(() => Promise.resolve()), stopTerminal: vi.fn(), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity), freshText: vi.fn(() => ""), markForAutostart: vi.fn() }));
vi.mock("@/agents/groups", () => ({ launchGroup: vi.fn(), closeGroup: vi.fn(), showGroups: vi.fn() }));
vi.mock("@/fleet/fleets", () => ({ linkFleet: vi.fn() }));
vi.mock("@/agents/terminals", () => ({ addTerminal: vi.fn(), removeNodes: vi.fn() }));
vi.mock("@/agents/broadcast", () => ({ pauseAgents: vi.fn(() => Promise.resolve(1)) }));
vi.mock("@/canvas/arrive", () => ({ showNode: vi.fn() }));
vi.mock("./ready", () => ({ whenReady: vi.fn(() => Promise.resolve(true)) }));
vi.mock("./events", () => ({ notify: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock("./manager", async (importOriginal) => {
  const original = await importOriginal<typeof import("./manager")>();
  const terminals = await import("@/agents/terminals");
  return {
    ...original,
    addTeamMember: vi.fn((workspaceId: string, managerId: string, payload: TerminalPayload, task: string, arrival: never) =>
      terminals.addTerminal(workspaceId, { ...payload, spawnedBy: managerId, task }, { x: 0, y: 0 }, null, arrival),
    ),
    reflowTeam: vi.fn(),
  };
});

const session: TerminalPayload = { title: "Chef", name: "Chef", agent: "claude", cwd: "C:/code/proj", shell: "default", command: "", claudeSessionId: "s0", role: "orchestrator" };
const done = { summary: "Login fait", status: "termine" as const, at: 600_000 };
const member = (nodeId: string, name: string, extra: Partial<Member> = {}): Member => ({
  nodeId, name, task: "Login", budgetMin: 20, linked: true, branch: `dummyplane/auth-${nodeId}`, worktree: `C:/w/${nodeId}`, sentAt: 0, ...extra,
});
const task = (title: string, extra: Partial<QueuedTask> = {}): QueuedTask => ({ title, brief: `Do ${title}`, budgetMin: 30, ...extra });
const missionNow = () => missionOf(nodesStore.getState().nodes.chef)!;
const lines = (to: string) => vi.mocked(notify).mock.calls.filter(([id]) => id === to).map(([, line]) => line);
const created = () => missionNow().members.filter((m) => !m.linked);
const textOf = (result: { content: { text: string }[] }) => result.content[0].text;
const titles = () => missionNow().queue?.map((q) => q.title);
const sub = (titre: string, extra: Record<string, unknown> = {}) => ({ titre, consigne: `Do ${titre} again`, agent: "nouveau", budget_min: 15, ...extra });
const amend = (args: Record<string, unknown>) => fleetTool("chef", "proposer_plan", { tache: "The user wants the waves fixed", ...args });
const frame = { id: "f1", name: "Mission Auth", x: 0, y: 0, width: 800, height: 500, memberIds: [] as string[], group: { role: "general" as const, pantheon: "egyptian" } };
let made = 0;

/** A running mission whose only agent, Batman, is at work on Login, with every seat taken: the queue stays as it is. */
async function setup(mission: Partial<Mission> = {}) {
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: {
      name: "Chef",
      session,
      mission: {
        state: "en_cours", maxAgents: 1, name: "Auth", project: "C:/code/proj", slug: "auth", branch: "dummyplane/auth", worktree: "C:/w/auth", startedAt: 0, frameId: "f1",
        plan: [{ title: "Login", brief: "Fais le login", agent: "Batman", budgetMin: 20 }],
        members: [member("batman", "Batman")],
        queue: [task("API"), task("Docs")],
        ...mission,
      },
    },
  });
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { ...session, role: undefined, name: "Batman", claudeSessionId: "old", steps: [{ title: "Plan", state: "fait" }] } });
}

/** The board a Manager runs the mission on, made for it: one card per waiting task. */
async function setupBoard() {
  await nodesStore.getState().create("b1", {
    workspaceId: "w1",
    kind: "kanban",
    payload: {
      columns: [
        { id: "todo", title: "To do", cardIds: ["c-api", "c-docs"] },
        { id: "done", title: "Done", cardIds: [] },
      ],
      cards: { "c-api": { id: "c-api", title: "API", notes: "Do API", priority: "none" }, "c-docs": { id: "c-docs", title: "Docs", notes: "Do Docs", priority: "none" } },
      orchestrator: { nodeId: "chef", columnId: "todo" },
    },
  });
  nodesStore.getState().update("chef", { mission: { ...missionNow(), board: "b1", manager: "m1", boardMade: true, queue: [task("API", { card: "c-api" }), task("Docs", { card: "c-docs" })] } });
}
const board = () => {
  const node = nodesStore.getState().nodes.b1;
  if (node.kind !== "kanban") throw new Error("no board");
  return node.payload;
};

beforeEach(() => {
  modelRouterStore.setState({ on: false, levels: {} });
  subagentSettingsStore.setState({ stopFinished: false });
  mockIPC(() => undefined);
  vi.clearAllMocks();
  terminalStatusStore.setState({ restarts: {} });
  vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "merged" }, uncommitted: false, head: "c0ffee" });
  for (const id of ["chef", "batman", "aquaman", "m1"]) terminalStatusStore.getState().set(id, { state: "running" });
  agentActivityStore.setState({ activities: {} });
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({ api: { getSceneElements: () => [], getSceneElementsIncludingDeleted: () => [] } as never, frames: [frame], links: {} });
  made = 0;
  vi.mocked(missionAddAgent).mockImplementation(async (_project, slug, agent) => ({ slug, branch: `dummyplane/${slug}-${agent.toLowerCase()}`, path: `C:/w/${agent.toLowerCase()}` }));
  vi.mocked(addTerminal).mockImplementation(async () => {
    const id = `n${++made}`;
    terminalStatusStore.getState().set(id, { state: "running" });
    return id;
  });
});

describe("propose_plan while the mission runs", () => {
  it("proposes an amendment, and changes nothing before the user approves it", async () => {
    await setup();
    const before = missionNow().queue;
    const result = await amend({ sous_taches: [sub("Tests"), sub("API")], drop: ["docs"] });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("Amendment proposed: 1 task added, 1 task edited, 1 task dropped.");
    expect(textOf(result)).toContain("Nothing changes until the user approves it");
    // Neither the queue, nor the plan, nor the state moved.
    expect(missionNow().queue).toEqual(before);
    expect(missionNow().state).toBe("en_cours");
    expect(missionNow().plan).toHaveLength(1);
    expect(missionNow().amendment).toMatchObject({ task: "The user wants the waves fixed", drop: ["Docs"] });
    expect(missionNow().amendment?.tasks.map((t) => t.title)).toEqual(["API", "Tests"]);
    expect(created()).toHaveLength(0);
    // The Fleet reads it back with mission.
    expect(JSON.parse(textOf(await fleetTool("chef", "mission", {}))).amendment).toEqual({ task: "The user wants the waves fixed", add: ["Tests"], edit: ["API"], drop: ["Docs"] });
  });

  it("is still refused while the team forms, saying why", async () => {
    await setup({ state: "lancement" });
    const result = await amend({ sous_taches: [sub("Tests")] });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("The team is forming");
    expect(missionNow().amendment).toBeUndefined();
  });

  it("replaces the amendment still waiting for the user, and says so", async () => {
    await setup();
    await amend({ sous_taches: [sub("Tests")] });
    const result = await amend({ sous_taches: [sub("Lint")] });
    expect(textOf(result)).toContain("replaces the one you proposed before");
    expect(missionNow().amendment?.tasks.map((t) => t.title)).toEqual(["Lint"]);
  });

  it("refuses to change a task an agent holds, naming it, and proposes nothing", async () => {
    await setup({ members: [member("batman", "Batman"), member("robin", "Robin", { task: "Schema", report: done, merged: true })], plan: [{ title: "Login", brief: "b", agent: "Batman", budgetMin: 20 }, { title: "Schema", brief: "b", agent: "new", budgetMin: 20 }] });
    const result = await amend({ sous_taches: [sub("Login"), sub("Tests")], drop: ["schema"] });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('"Login" (at work)');
    expect(textOf(result)).toContain('"Schema" (done and merged)');
    expect(textOf(result)).toContain("adds, edits or drops only the tasks no agent holds yet");
    expect(missionNow().amendment).toBeUndefined();
    expect(titles()).toEqual(["API", "Docs"]);
  });

  it("treats a task a new agent is being created for as started", async () => {
    await setup();
    holdSeat("chef", "API");
    try {
      const result = await amend({ drop: ["API"] });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('"API" (being started by a new agent)');
    } finally {
      freeSeat("chef", "API");
    }
    expect(missionNow().amendment).toBeUndefined();
  });

  it("refuses a drop that is no waiting task, a linked agent for a waiting task, and an empty amendment", async () => {
    await setup();
    expect(textOf(await amend({ drop: ["Nope"] }))).toContain('"Nope" is no task waiting in the queue');
    expect(textOf(await amend({ sous_taches: [sub("Tests", { agent: "Robin" })] }))).toContain("a waiting task goes to a new agent");
    expect(textOf(await amend({}))).toContain("Nothing to change");
    expect(textOf(await amend({ sous_taches: [sub("API")], drop: ["API"] }))).toContain('"API" is both given and dropped');
    expect(missionNow().amendment).toBeUndefined();
  });

  it("is refused when its restated task is missing", async () => {
    await setup();
    const result = await fleetTool("chef", "proposer_plan", { sous_taches: [sub("Tests")] });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Restate");
  });
});

describe("approving the amendment", () => {
  it("adds, edits and drops the waiting tasks, the board following, and tells the Manager and the Fleet", async () => {
    await setup();
    await setupBoard();
    await amend({ sous_taches: [sub("Tests", { waits_for: ["API"] }), sub("API", { consigne: "Do the API v2", budget_min: 45 })], drop: ["Docs"] });
    approveAmendment("chef");
    expect(missionNow().amendment).toBeUndefined();
    // The waiting task is edited in place, keeping its card; the new one is last, with a card of its own; the dropped one is gone.
    expect(missionNow().queue).toEqual([
      { title: "API", brief: "Do the API v2", budgetMin: 45, card: "c-api" },
      { title: "Tests", brief: "Do Tests again", budgetMin: 15, card: expect.any(String), waitsFor: ["API"] },
    ]);
    const cards = board();
    expect(cards.cards["c-api"].notes).toBe("Do the API v2");
    expect(cards.cards["c-docs"]).toBeUndefined();
    const added = missionNow().queue![1].card!;
    expect(cards.columns[0].cardIds).toEqual(["c-api", added]);
    expect(lines("m1")).toEqual([expect.stringContaining('added "Tests"; edited "API"; dropped "Docs"')]);
    expect(lines("chef")).toEqual([expect.stringContaining("The user approved your amendment")]);
    expect(created()).toHaveLength(0);
  });

  it("keeps the card of a dropped task on a board the user handed over, and says so to the Manager", async () => {
    await setup();
    await setupBoard();
    nodesStore.getState().update("chef", { mission: { ...missionNow(), boardMade: false } });
    await amend({ drop: ["Docs"] });
    approveAmendment("chef");
    expect(titles()).toEqual(["API"]);
    expect(board().cards["c-docs"]).toBeDefined();
    expect(lines("m1")[0]).toContain('The cards of "Docs" stay on the board');
  });

  it("goes on with the queue: a new agent takes an added task as soon as a seat is free", async () => {
    await setup({ maxAgents: 2, queue: [] });
    await amend({ sous_taches: [sub("Tests")] });
    approveAmendment("chef");
    await vi.waitFor(() => expect(created().map((m) => m.task)).toEqual(["Tests"]));
    expect(titles()).toEqual([]);
  });

  it("applies none of it when a task it names started meanwhile, naming it, and tells the Fleet", async () => {
    await setup();
    await amend({ sous_taches: [sub("Tests"), sub("API", { consigne: "Do the API v2" })], drop: ["Docs"] });
    // The Manager's queue gave API to a new agent while the user read the proposal.
    nodesStore.getState().update("chef", {
      mission: { ...missionNow(), queue: [task("Docs")], plan: [...missionNow().plan!, { ...task("API"), agent: "Robin" }], members: [...missionNow().members, member("robin", "Robin", { task: "API", linked: false })] },
    });
    approveAmendment("chef");
    expect(titles()).toEqual(["Docs"]);
    expect(missionNow().amendment).toBeUndefined();
    expect(lines("chef")).toEqual([expect.stringContaining('"API" (at work)')]);
    expect(lines("chef")[0]).toContain("nothing changed");
    expect(toast.error).toHaveBeenCalled();
  });

  it("is declined without touching the queue, and the Fleet is told", async () => {
    await setup();
    await amend({ sous_taches: [sub("Tests")], drop: ["API"] });
    declineAmendment("chef");
    expect(missionNow().amendment).toBeUndefined();
    expect(titles()).toEqual(["API", "Docs"]);
    expect(lines("chef")).toEqual([expect.stringContaining("The user declined your amendment")]);
  });

  it("is not applied when a task it replaces left the queue meanwhile: its card went Done, that work is over", async () => {
    await setup({ maxAgents: 1, queue: [task("API", { card: "c-gone" }), task("Docs")] });
    await amend({ sous_taches: [sub("API", { consigne: "Do the API v2" })] });
    expect(missionNow().amendment?.replaces).toEqual(["API"]);
    nodesStore.getState().update("chef", { mission: { ...missionNow(), queue: [task("Docs")] } });
    approveAmendment("chef");
    expect(titles()).toEqual(["Docs"]);
    expect(lines("chef")).toEqual([expect.stringContaining('"API" no longer waits in the queue')]);
  });

  it("goes with the mission when it ends", async () => {
    await setup();
    await amend({ sous_taches: [sub("Tests")] });
    const { endMission } = await import("./launch");
    endMission("chef", "Stopped.");
    expect(missionNow().state).toBe("terminee");
    expect(missionNow().amendment).toBeUndefined();
  });
});

describe("a waiting task that waits for others", () => {
  it("is handed to no agent before each task it waits for is done and merged", async () => {
    await setup({ maxAgents: 4, queue: [task("Wave 2", { waitsFor: ["Login"] }), task("Docs")] });
    await pumpQueue("chef");
    // Docs takes a seat now, Wave 2 does not: Login is still at work.
    await vi.waitFor(() => expect(created().map((m) => m.task)).toEqual(["Docs"]));
    expect(titles()).toEqual(["Wave 2"]);
    // Login is done: its branch is merged first, then Wave 2 starts from its work.
    updateMember("chef", "batman", { report: done });
    await afterReport("chef", "batman");
    await vi.waitFor(() => expect(created().map((m) => m.task)).toEqual(["Docs", "Wave 2"]));
    expect(missionMerge).toHaveBeenCalled();
    expect(titles()).toEqual([]);
  });

  it("is not handed out while what it waits for is done but its branch is not merged", async () => {
    await setup({ maxAgents: 4, queue: [task("Wave 2", { waitsFor: ["Login"] })], members: [member("batman", "Batman", { report: done })] });
    vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "conflict", files: ["a.ts"] }, uncommitted: false, head: "c0ffee" });
    await afterReport("chef", "batman");
    expect(created()).toHaveLength(0);
    expect(titles()).toEqual(["Wave 2"]);
  });

  it("no longer waits for a task the queue settled because its card is Done: that work is over", async () => {
    await setup({ maxAgents: 4, queue: [task("API", { card: "c-settled" }), task("Wave 2", { waitsFor: ["API"] })] });
    await nodesStore.getState().create("b2", {
      workspaceId: "w1",
      kind: "kanban",
      payload: {
        columns: [
          { id: "todo", title: "To do", cardIds: [] },
          { id: "done", title: "Done", cardIds: ["c-settled"] },
        ],
        cards: { "c-settled": { id: "c-settled", title: "API", notes: "", priority: "none" } },
        orchestrator: { nodeId: "chef", columnId: "todo" },
      },
    });
    await pumpQueue("chef");
    await vi.waitFor(() => expect(created().map((m) => m.task)).toEqual(["Wave 2"]));
    expect(titles()).toEqual([]);
  });

  it("leaves a task waiting for a settled one alone: later calls are not refused for it, and queue reads that wait as done", async () => {
    await setup({ maxAgents: 1, queue: [task("API", { card: "c-settled-2" }), task("Wave 2", { waitsFor: ["API"] })] });
    await nodesStore.getState().create("b3", {
      workspaceId: "w1",
      kind: "kanban",
      payload: {
        columns: [
          { id: "todo", title: "To do", cardIds: [] },
          { id: "done", title: "Done", cardIds: ["c-settled-2"] },
        ],
        cards: { "c-settled-2": { id: "c-settled-2", title: "API", notes: "", priority: "none" } },
        orchestrator: { nodeId: "chef", columnId: "todo" },
      },
    });
    // Every seat is taken: the queue settles (API leaves it) and starts nobody.
    await pumpQueue("chef");
    expect(titles()).toEqual(["Wave 2"]);
    expect(JSON.parse(textOf(await fleetTool("chef", "queue", {}))).waiting[0].waits_for).toEqual([{ task: "API", state: "done" }]);
    const added = await fleetTool("chef", "add_tasks", { tasks: [{ titre: "Lint", consigne: "b", budget_min: 5 }] });
    expect(added.isError).toBeUndefined();
    const amended = await amend({ sous_taches: [sub("Tests")] });
    expect(amended.isError).toBeUndefined();
    expect(missionNow().amendment?.tasks.map((t) => t.title)).toEqual(["Tests"]);
  });

  it("tells the runner what it waits for when nobody works and what it waits for is blocked", async () => {
    await setup({ maxAgents: 4, queue: [task("Wave 2", { waitsFor: ["Login"] })], members: [member("batman", "Batman", { report: { ...done, status: "bloque" } })] });
    await afterReport("chef", "batman");
    expect(created()).toHaveLength(0);
    expect(lines("chef")).toEqual([expect.stringContaining('"Wave 2" waits for "Login" (reported blocked)')]);
  });

  it("is read back by queue with what each wait stands at", async () => {
    await setup({ queue: [task("Wave 2", { waitsFor: ["Login", "API"] }), task("API")] });
    const { waiting } = JSON.parse(textOf(await fleetTool("chef", "queue", {})));
    expect(waiting[0].waits_for).toEqual([
      { task: "Login", state: "working" },
      { task: "API", state: "queued" },
    ]);
  });

  it("is queued by add_tasks and by an amendment only with names that stand for tasks of the mission, and no circle", async () => {
    await setup();
    const unknown = await fleetTool("chef", "add_tasks", { tasks: [{ titre: "Wave 2", consigne: "b", budget_min: 5, waits_for: ["Nowhere"] }] });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain('waits_for "Nowhere"');
    const self = await fleetTool("chef", "add_tasks", { tasks: [{ titre: "Wave 2", consigne: "b", budget_min: 5, waits_for: ["wave 2"] }] });
    expect(textOf(self)).toContain("cannot wait for itself");
    const circle = await fleetTool("chef", "add_tasks", {
      tasks: [
        { titre: "A", consigne: "b", budget_min: 5, waits_for: ["B"] },
        { titre: "B", consigne: "b", budget_min: 5, waits_for: ["A"] },
      ],
    });
    expect(textOf(circle)).toContain("waits, through the tasks it waits for, for itself");
    expect(titles()).toEqual(["API", "Docs"]);
    // Each is a task of the mission: the queue's, the plan's, the running one's.
    const ok = await fleetTool("chef", "add_tasks", { tasks: [{ titre: "Wave 2", consigne: "b", budget_min: 5, waits_for: ["login", "API"] }] });
    expect(ok.isError).toBeUndefined();
    expect(missionNow().queue?.[2].waitsFor).toEqual(["Login", "API"]);
    // An amendment cannot drop a task another waits for, nor make a circle through the queue.
    expect(textOf(await amend({ drop: ["API"] }))).toContain('"Wave 2" waits for "API"');
    expect(textOf(await amend({ sous_taches: [sub("API", { waits_for: ["Wave 2"] })] }))).toContain("for itself");
  });

  it("keeps what an edit does not say: the tasks it waits for stay, an empty list clears them", async () => {
    await setup({ queue: [task("API"), task("Wave 2", { waitsFor: ["API"] })] });
    await amend({ sous_taches: [sub("Wave 2", { consigne: "Do wave 2 v2" })] });
    approveAmendment("chef");
    expect(missionNow().queue?.[1]).toMatchObject({ title: "Wave 2", brief: "Do wave 2 v2", waitsFor: ["API"] });
    await amend({ sous_taches: [sub("Wave 2", { waits_for: [] })] });
    approveAmendment("chef");
    expect(missionNow().queue?.[1].waitsFor).toBeUndefined();
  });
});

describe("the first plan", () => {
  const first = (...subtasks: Record<string, unknown>[]) => fleetTool("chef", "proposer_plan", { nom: "Auth", tache: "Add the login", sous_taches: subtasks });

  it("may plan later waves ahead: a sub-task that waits for others of the plan, for a new agent", async () => {
    await setup({ state: "redaction", members: [], plan: undefined, queue: undefined });
    const result = await first(sub("Wave 1"), sub("Wave 2", { waits_for: ["wave 1"] }));
    expect(result.isError).toBeUndefined();
    expect(missionNow().plan?.map((s) => [s.title, s.waitsFor])).toEqual([["Wave 1", undefined], ["Wave 2", ["Wave 1"]]]);
    expect(missionNow().state).toBe("plan");
  });

  it("refuses a wait for a task that is not in the plan or the queue, and a linked agent's sub-task that waits", async () => {
    await setup({ state: "redaction", members: [], plan: undefined, queue: undefined });
    expect(textOf(await first(sub("Wave 2", { waits_for: ["Wave 1"] })))).toContain('waits_for "Wave 1"');
    expect(missionNow().state).toBe("redaction");
    // A linked agent starts at the go-ahead, not from the queue: only a new agent waits.
    const args = { nom: "Auth", tache: "T", sous_taches: [sub("Wave 1"), sub("Wave 2", { agent: "Batman", waits_for: ["Wave 1"] })] };
    expect(proposedPlan(args, { ...missionNow(), maxAgents: 4 }, ["Batman"])).toBe('Sub-task 2: a sub-task that waits for others starts from the queue, for a new agent: give it agent "new".');
  });

  it("refuses a plan in which every sub-task waits: some sub-task has to start at the go-ahead", async () => {
    await setup({ state: "redaction", members: [], plan: undefined, queue: [task("Wave 1")] });
    expect(textOf(await first(sub("Wave 2", { waits_for: ["Wave 1"] })))).toContain("At least one sub-task starts at the go-ahead");
    expect(missionNow().state).toBe("redaction");
  });

  it("refuses a plan that leaves a queued task waiting for a task it no longer has", async () => {
    // The pending plan has Wave 2, and Wave 3, queued, waits for it: a plan without it would leave Wave 3 waiting for nothing.
    await setup({ state: "plan", members: [], plan: [{ ...task("Wave 2"), agent: "nouveau" }], queue: [task("Wave 3", { waitsFor: ["Wave 2"] })] });
    expect(textOf(await first(sub("Wave 1")))).toContain('"Wave 3" waits for "Wave 2"');
    expect(textOf(await first(sub("Wave 2"), sub("Wave 1")))).toContain("Plan proposed");
  });
});

describe("what a mission saves", () => {
  it("keeps the tasks' waits and the amendment waiting for the user through a restart", async () => {
    await setup({ queue: [task("Wave 2", { waitsFor: ["Login"] })] });
    await amend({ sous_taches: [sub("Wave 3", { waits_for: ["Wave 2"] })], drop: [] });
    const saved = JSON.parse(JSON.stringify(missionNow())) as unknown;
    const read = readMission(saved)!;
    expect(read.queue).toEqual([task("Wave 2", { waitsFor: ["Login"] })]);
    expect(read.amendment).toEqual({ task: "The user wants the waves fixed", tasks: [expect.objectContaining({ title: "Wave 3", waitsFor: ["Wave 2"] })], drop: [] });
  });

  it("drops an amendment the mission outlived", () => {
    expect(readMission({ state: "terminee", maxAgents: 2, members: [], amendment: { task: "t", tasks: [task("A")], drop: [] } })?.amendment).toBeUndefined();
  });
});
