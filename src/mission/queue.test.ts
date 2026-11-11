// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { launchGroup } from "@/agents/groups";
import { addTerminal } from "@/agents/terminals";
import { missionAddAgent, missionMerge, missionPrepare } from "@/ipc/mission";
import { ptySendText } from "@/ipc/pty";
import { buildSpawnSpec } from "@/nodes/terminal/launch";
import { relaunchTerminal } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { notify } from "./events";
import { launchMission, mergeMember, reassignTask } from "./launch";
import type { Member, Mission, QueuedTask } from "./mission";
import { morningReport } from "./morning";
import { afterReport, giveNext, pumpQueue } from "./queue";
import { missionOf } from "./store";
import { fleetTool } from "@/mcp/fleetTools";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/ipc/mission", () => ({ missionPrepare: vi.fn(), missionAddAgent: vi.fn(), missionMerge: vi.fn(), missionCleanup: vi.fn(), missionDiscard: vi.fn() }));
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
// The board and its Manager are scene work (`./manager.test.ts`): a go-ahead here gets board b1 and Manager m1.
vi.mock("./manager", async (importOriginal) => {
  const original = await importOriginal<typeof import("./manager")>();
  const terminals = await import("@/agents/terminals");
  const store = await import("./store");
  return {
    ...original,
    setUpBoard: vi.fn(async (fleetId: string) => {
      store.setMission(fleetId, { board: "b1", manager: "m1", boardMade: true });
      return { boardId: "b1", boardMade: true, managerId: "m1", managerMade: true };
    }),
    addTeamMember: vi.fn((workspaceId: string, managerId: string, payload: TerminalPayload, task: string, arrival: never) =>
      terminals.addTerminal(workspaceId, { ...payload, spawnedBy: managerId, task }, { x: 0, y: 0 }, null, arrival),
    ),
    reflowTeam: vi.fn(),
    undoSetup: vi.fn(),
    removeManager: vi.fn(),
  };
});

const session: TerminalPayload = { title: "Chef", name: "Chef", agent: "claude", cwd: "C:/code/proj", shell: "default", command: "", claudeSessionId: "s0", role: "orchestrator" };
const done = { summary: "Login fait", status: "termine" as const, at: 600_000 };
const member = (nodeId: string, name: string, extra: Partial<Member> = {}): Member => ({
  nodeId, name, task: "Login", budgetMin: 20, linked: true, branch: `dummyplane/auth-${nodeId}`, worktree: `C:/w/${nodeId}`, sentAt: 0, ...extra,
});
const next: QueuedTask = { title: "API", brief: "Fais l'API", budgetMin: 30 };
const missionNow = () => missionOf(nodesStore.getState().nodes.chef)!;
const lines = () => vi.mocked(notify).mock.calls.map(([, line]) => line);
/** The agents dummyPlane created for the queue, each in a new terminal. */
const created = () => missionNow().members.filter((m) => !m.linked);
const missionFrame = { id: "f1", name: "Mission Auth", x: 0, y: 0, width: 800, height: 500, memberIds: [] as string[], group: { role: "general" as const, pantheon: "egyptian" } };
const queued = (...titles: string[]) => titles.map((title) => ({ ...next, title }));
let made = 0;

async function setup(mission: Partial<Mission>) {
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: {
      name: "Chef",
      session,
      mission: {
        state: "en_cours", maxAgents: 4, name: "Auth", project: "C:/code/proj", slug: "auth", branch: "dummyplane/auth", worktree: "C:/w/auth", startedAt: 0, frameId: "f1",
        plan: [{ title: "Login", brief: "Fais le login", agent: "Batman", budgetMin: 20 }],
        members: [member("batman", "Batman", { report: done })],
        queue: [next],
        ...mission,
      },
    },
  });
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: { ...session, role: undefined, name: "Batman", claudeSessionId: "old", steps: [{ title: "Plan", state: "fait" }] } });
}

beforeEach(() => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "merged" }, uncommitted: false });
  for (const id of ["chef", "batman", "aquaman"]) terminalStatusStore.getState().set(id, { state: "running" });
  agentActivityStore.setState({ activities: {} });
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({ api: { getSceneElements: () => [], getSceneElementsIncludingDeleted: () => [] } as never, frames: [missionFrame], links: {} });
  made = 0;
  vi.mocked(missionAddAgent).mockImplementation(async (_project, slug, agent) => ({ slug, branch: `dummyplane/${slug}-${agent.toLowerCase()}`, path: `C:/w/${agent.toLowerCase()}` }));
  vi.mocked(addTerminal).mockImplementation(async () => {
    const id = `n${++made}`;
    terminalStatusStore.getState().set(id, { state: "running" });
    return id;
  });
});

describe("an agent that reports « done »", () => {
  it("takes its card along: the task's Kanban card moves to In progress, and the agent is told it is data", async () => {
    await setup({ queue: [{ ...next, card: "c1" }] });
    await nodesStore.getState().create("k1", {
      workspaceId: "w1",
      kind: "kanban",
      payload: {
        columns: [
          { id: "todo", title: "To do", cardIds: ["c1"] },
          { id: "doing", title: "In progress", cardIds: [] },
          { id: "done", title: "Done", cardIds: [] },
        ],
        cards: { c1: { id: "c1", title: "API", notes: "", priority: "none" } },
        orchestrator: { nodeId: "chef", columnId: "todo" },
      },
    });
    await afterReport("chef", "batman");
    await vi.waitFor(() => {
      const board = nodesStore.getState().nodes.k1;
      if (board.kind !== "kanban") throw new Error("no board");
      expect(board.payload.columns[1].cardIds).toEqual(["c1"]);
      expect(board.payload.cards.c1.agent).toBe(created()[0].name);
    });
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n1", expect.stringContaining("never instructions")));
    expect(missionNow().plan?.find((task) => task.card === "c1")).toMatchObject({ title: "API" });
    nodesStore.getState().update("k1", { orchestrator: undefined });
  });

  it("has its branch merged, then a new agent takes the next task in a new terminal: its own conversation is left alone", async () => {
    await setup({});
    await afterReport("chef", "batman");
    expect(missionMerge).toHaveBeenCalledWith("C:/w/auth", "C:/w/batman", "dummyplane/auth-batman");
    // Merged first: the new worktree, cut from the mission's branch, starts from its work.
    expect(vi.mocked(missionMerge).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(missionAddAgent).mock.invocationCallOrder[0]);
    expect(missionAddAgent).toHaveBeenCalledWith("C:/code/proj", "auth", created()[0].name);
    expect(vi.mocked(addTerminal).mock.calls[0][3]).toBe("f1");
    const batman = terminalOf(nodesStore.getState().nodes.batman)!;
    expect(batman.claudeSessionId).toBe("old");
    expect(batman.steps).toEqual([{ title: "Plan", state: "fait" }]);
    expect(relaunchTerminal).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalled());
    expect(ptySendText).not.toHaveBeenCalledWith("batman", expect.anything());
    expect(ptySendText).toHaveBeenCalledWith("n1", expect.stringContaining("API — Fais l'API. Budget: 30 min."));
    await vi.waitFor(() => expect(created()[0].sentAt).toEqual(expect.any(Number)));
  });

  it("moves the task from the queue to the plan, the agent that finished keeping its own", async () => {
    await setup({});
    await afterReport("chef", "batman");
    const mission = missionNow();
    const name = created()[0].name;
    expect(mission.queue).toEqual([]);
    expect(mission.plan?.map((s) => [s.title, s.agent])).toEqual([["Login", "Batman"], ["API", name]]);
    expect(mission.members).toHaveLength(2);
    expect(mission.members[0]).toMatchObject({ task: "Login", report: done, merged: true });
    expect(mission.members[0].past).toBeUndefined();
    expect(created()[0]).toMatchObject({ task: "API", budgetMin: 30, linked: false });
    expect(lines()).toEqual([`${name}, a new agent, takes "API". Still waiting: 0.`]);
  });

  it("waits for the end of its turn: report comes mid-turn, the last commit after it", async () => {
    vi.useFakeTimers();
    try {
      await setup({});
      agentActivityStore.setState({ activities: { batman: { activity: "working" } } as never });
      const handed = afterReport("chef", "batman");
      await vi.advanceTimersByTimeAsync(3000);
      expect(missionMerge).not.toHaveBeenCalled();
      agentActivityStore.setState({ activities: {} });
      await vi.advanceTimersByTimeAsync(1100);
      await handed;
      expect(missionMerge).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting after a minute, rather than stall the queue", async () => {
    vi.useFakeTimers();
    try {
      await setup({});
      agentActivityStore.setState({ activities: { batman: { activity: "working" } } as never });
      const handed = afterReport("chef", "batman");
      await vi.advanceTimersByTimeAsync(61_000);
      await handed;
      expect(missionMerge).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the fleet of a conflict and leaves the branch unmerged; merge restarts the queue, merging it first", async () => {
    await setup({});
    // Out of sight: no new agent takes its seat meanwhile.
    workspacesStore.setState({ activeId: "w2" });
    vi.mocked(missionMerge).mockResolvedValueOnce({ merge: { kind: "conflict", files: ["a.ts"] }, uncommitted: false });
    await afterReport("chef", "batman");
    expect(missionNow().members[0]).toMatchObject({ task: "Login", report: done });
    expect(missionNow().members[0].merged).toBeUndefined();
    expect(missionNow().queue).toEqual([next]);
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(lines()[0]).toBe("Batman: conflict, merge undone — a.ts");
    workspacesStore.setState({ activeId: "w1" });
    await pumpQueue("chef");
    expect(missionMerge).toHaveBeenCalledTimes(2);
    expect(vi.mocked(missionMerge).mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(missionAddAgent).mock.invocationCallOrder[0]);
    expect(missionNow().members[0]).toMatchObject({ task: "Login", merged: true });
    expect(created().map((m) => m.task)).toEqual(["API"]);
  });

  it("goes on with the queue after a conflict, as before: the seat goes to a new agent", async () => {
    await setup({});
    vi.mocked(missionMerge).mockResolvedValueOnce({ merge: { kind: "conflict", files: ["a.ts"] }, uncommitted: false });
    await afterReport("chef", "batman");
    expect(lines()[0]).toBe("Batman: conflict, merge undone — a.ts");
    expect(missionNow().members[0].task).toBe("Login");
    expect(created().map((m) => m.task)).toEqual(["API"]);
  });

  it("passes on that uncommitted changes were left out of the merge", async () => {
    await setup({});
    vi.mocked(missionMerge).mockResolvedValueOnce({ merge: { kind: "merged" }, uncommitted: true });
    await afterReport("chef", "batman");
    expect(lines()[0]).toContain("uncommitted");
    expect(created().map((m) => m.task)).toEqual(["API"]);
  });

  it("gives the new agent the model of the task with the router on, the finished one keeping its own", async () => {
    await setup({ router: true, queue: [{ ...next, level: "eleve" }] });
    await afterReport("chef", "batman");
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.objectContaining({ model: "claude-opus-5-5" }), expect.anything(), "f1", { reveal: false, source: "mission" });
    expect(created()[0].model).toBe("claude-opus-5-5");
    expect(missionNow().members[0].model).toBeUndefined();
  });

  it("merges nothing and restarts no one without a task waiting: the fleet merges as before", async () => {
    await setup({ queue: undefined });
    await afterReport("chef", "batman");
    expect(missionMerge).not.toHaveBeenCalled();
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(lines()).toEqual([]);
  });

  it("still merges the branch of an agent whose terminal stopped: the new agent does not need it", async () => {
    await setup({});
    terminalStatusStore.getState().set("batman", { state: "stopped" });
    await afterReport("chef", "batman");
    expect(missionMerge).toHaveBeenCalledWith("C:/w/auth", "C:/w/batman", "dummyplane/auth-batman");
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(created().map((m) => m.task)).toEqual(["API"]);
  });

  it("does not start two agents nor merge twice for two reports in a row", async () => {
    await setup({ maxAgents: 1, queue: [next, { ...next, title: "Docs" }] });
    await Promise.all([afterReport("chef", "batman"), afterReport("chef", "batman")]);
    expect(missionMerge).toHaveBeenCalledTimes(1);
    expect(created().map((m) => m.task)).toEqual(["API"]);
    expect(missionNow().queue?.map((t) => t.title)).toEqual(["Docs"]);
  });

  it("stops handing out at the end of the night; the tasks stay for the report", async () => {
    await setup({ overnight: true, budgetMin: 100, startedAt: Date.now() - 95 * 60_000 });
    await afterReport("chef", "batman");
    expect(missionNow().queue).toEqual([next]);
    expect(missionMerge).not.toHaveBeenCalled();
    expect(missionAddAgent).not.toHaveBeenCalled();
  });
});

describe("an agent that reports « blocked » or « failed »", () => {
  const stuck = { summary: "Bloqué", status: "bloque" as const, at: 60_000 };

  it("keeps its task: the fleet decides", async () => {
    await setup({ members: [member("batman", "Batman", { report: stuck })] });
    workspacesStore.setState({ activeId: "w2" });
    await afterReport("chef", "batman");
    expect(missionNow().members[0].task).toBe("Login");
    expect(missionNow().queue).toEqual([next]);
  });

  it("can still be reassigned from", async () => {
    await setup({ members: [member("batman", "Batman", { report: stuck }), member("aquaman", "Aquaman", { task: "Docs", report: done, merged: true })], plan: [{ title: "Login", brief: "b", agent: "Batman", budgetMin: 20 }, { title: "Docs", brief: "b", agent: "Aquaman", budgetMin: 20 }] });
    expect(await reassignTask("chef", "batman", "Aquaman")).toEqual({ name: "Aquaman" });
  });

  it("starts a new agent in a new terminal when next_task asks for it, nothing merged, the old task abandoned", async () => {
    await setup({ members: [member("batman", "Batman", { report: stuck })] });
    const result = await giveNext("chef", missionNow().members[0]);
    const name = created()[0].name;
    expect(result).toEqual({ given: `${name}, a new agent, takes "API". Still waiting: 0.` });
    // The tool answers it: the fleet does not hear it twice.
    expect(lines()).toEqual([]);
    expect(missionMerge).not.toHaveBeenCalled();
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(created()[0]).toMatchObject({ task: "API", nodeId: "n1" });
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n1", expect.stringContaining("API — Fais l'API.")));
    expect(ptySendText).not.toHaveBeenCalledWith("batman", expect.anything());
    // Its terminal stays for the user; its task, with its report, is dropped.
    const batman = missionNow().members[0];
    expect(batman).toMatchObject({ task: "Login", report: stuck, abandoned: true });
    expect(batman.past).toBeUndefined();
    expect(terminalOf(nodesStore.getState().nodes.batman)!.claudeSessionId).toBe("old");
    expect(morningReport(missionNow(), Date.now()).failed).toEqual([expect.objectContaining({ agent: "Batman", task: "Login", status: "bloque" })]);
  });

  it("no longer lets reassign find an abandoned task, nor next_task leave it twice", async () => {
    await setup({ queue: queued("API", "Docs"), members: [member("batman", "Batman", { report: stuck })] });
    await giveNext("chef", missionNow().members[0]);
    expect(await reassignTask("chef", "batman", "new")).toBe("Sub-task not found.");
    expect(await giveNext("chef", missionNow().members[0])).toEqual({ refused: "Batman already left its task to a new agent." });
    expect(created().map((m) => m.task)).toEqual(["API"]);
  });

  it("starts nothing past Max agents with next_task", async () => {
    await setup({ maxAgents: 1, members: [member("batman", "Batman", { report: stuck }), member("aquaman", "Aquaman", { task: "Docs0" })] });
    expect(await giveNext("chef", missionNow().members[0])).toEqual({ refused: "1 agent is already at work (Max active agents): the next task starts as soon as one reports." });
    expect(missionAddAgent).not.toHaveBeenCalled();
    expect(missionNow().members[0].abandoned).toBeUndefined();
  });

  it("leaves the task to its agent when next_task cannot create the new one", async () => {
    vi.mocked(missionAddAgent).mockRejectedValueOnce(new Error("branch exists"));
    await setup({ members: [member("batman", "Batman", { report: stuck })] });
    expect(await giveNext("chef", missionNow().members[0])).toEqual({ refused: 'No new agent could take "API", it stays in the queue — branch exists' });
    expect(missionNow().members[0].abandoned).toBeUndefined();
    expect(missionNow().queue).toEqual([next]);
  });

  it("explains why next_task gives nothing", async () => {
    await setup({ queue: [], members: [member("batman", "Batman", { report: stuck })] });
    expect(await giveNext("chef", missionNow().members[0])).toEqual({ refused: "No task waiting for Batman." });
  });

  it("refuses next_task for an agent still at work", async () => {
    await setup({ members: [member("batman", "Batman")] });
    expect(await giveNext("chef", missionNow().members[0])).toEqual({ refused: "Batman has not finished its sub-task: choose an agent that has reported, or \"new\"." });
  });
});

describe("who takes what", () => {
  const front = { id: "g1", name: "Interface", x: 0, y: 0, width: 10, height: 10, memberIds: ["batman"], group: { role: "frontend" as const, pantheon: "egyptian" } };

  it("merges whatever group finished, and starts the next task's agent in that task's group", async () => {
    const back = { ...missionFrame, id: "g2", name: "Serveur", group: { role: "backend" as const, pantheon: "norse" } };
    canvasStore.setState({ frames: [missionFrame, front, back] });
    const theirs = { ...next, title: "Serveur", group: { id: "g2", name: "Serveur" } };
    const ours = { ...next, title: "Style", group: { id: "g1", name: "Interface" } };
    await setup({ maxAgents: 1, queue: [theirs, ours, next] });
    await afterReport("chef", "batman");
    expect(missionMerge).toHaveBeenCalledTimes(1);
    expect(missionNow().members[0].task).toBe("Login");
    expect(created()).toEqual([expect.objectContaining({ task: "Serveur", group: "g2" })]);
    expect(vi.mocked(addTerminal).mock.calls[0][3]).toBe("g2");
    expect(missionNow().queue?.map((t) => t.title)).toEqual(["Style", "API"]);
  });

  it("says it in the plural too", async () => {
    await setup({ queue: [next, { ...next, title: "Docs" }], members: [member("batman", "Batman", { report: { ...done, status: "echec" } })] });
    // Out of sight, no new agent can be created there.
    workspacesStore.setState({ activeId: "w2" });
    await afterReport("chef", "batman");
    expect(lines()).toEqual(["2 tasks wait that no new agent could take: next_task, reassign, or finish."]);
  });

  it("creates no agent past Max agents: one new agent for the finished one's seat, the rest waits", async () => {
    await setup({ maxAgents: 1, queue: [next, { ...next, title: "Docs" }, { ...next, title: "Tests" }] });
    await afterReport("chef", "batman");
    expect(missionNow().members).toHaveLength(2);
    expect(created().map((m) => m.task)).toEqual(["API"]);
    expect(missionNow().queue).toHaveLength(2);
  });

  it("merges the branch of an agent done before a task arrives, then starts a new agent from it", async () => {
    await setup({ queue: [], members: [member("batman", "Batman", { report: done })] });
    await afterReport("chef", "batman");
    expect(missionMerge).not.toHaveBeenCalled();
    nodesStore.getState().update("chef", { mission: { ...missionNow(), queue: [next] } });
    await pumpQueue("chef");
    expect(missionMerge).toHaveBeenCalledTimes(1);
    expect(vi.mocked(missionMerge).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(missionAddAgent).mock.invocationCallOrder[0]);
    expect(missionNow().members[0]).toMatchObject({ task: "Login", merged: true });
    expect(created().map((m) => m.task)).toEqual(["API"]);
  });

  it("does not merge again a branch already merged when a task arrives", async () => {
    await setup({ queue: [], members: [member("batman", "Batman", { report: done, merged: true })] });
    nodesStore.getState().update("chef", { mission: { ...missionNow(), queue: [next] } });
    await pumpQueue("chef");
    expect(missionMerge).not.toHaveBeenCalled();
    expect(created().map((m) => m.task)).toEqual(["API"]);
  });
});

describe("what the review of the queue found", () => {
  const stuck = { summary: "Bloqué", status: "bloque" as const, at: 60_000 };

  it("merges one branch at a time: two git merges in one worktree break each other", async () => {
    await setup({ queue: [next, { ...next, title: "Docs" }], members: [member("batman", "Batman", { report: done }), member("aquaman", "Aquaman", { task: "Docs0", report: done })] });
    let running = 0;
    let most = 0;
    vi.mocked(missionMerge).mockImplementation(async () => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return { merge: { kind: "merged" }, uncommitted: false };
    });
    await pumpQueue("chef");
    expect(vi.mocked(missionMerge)).toHaveBeenCalledTimes(2);
    expect(most).toBe(1);
  });

  it("goes on merging after a merge that failed", async () => {
    await setup({ queue: [next, { ...next, title: "Docs" }], members: [member("batman", "Batman", { report: done }), member("aquaman", "Aquaman", { task: "Docs0", report: done })] });
    workspacesStore.setState({ activeId: "w2" });
    vi.mocked(missionMerge).mockRejectedValueOnce(new Error("boom"));
    await pumpQueue("chef");
    expect(missionMerge).toHaveBeenCalledTimes(2);
    expect(lines()).toContain("Batman: failed — boom");
    expect(missionNow().members.map((m) => [m.task, m.merged === true])).toEqual([["Login", false], ["Docs0", true]]);
  });

  describe("while it waits for the end of a turn", () => {
    const waitingTurn = async (mission: Partial<Mission>, meanwhile: () => void) => {
      vi.useFakeTimers();
      try {
        await setup(mission);
        agentActivityStore.setState({ activities: { batman: { activity: "working" } } as never });
        const handed = afterReport("chef", "batman");
        await vi.advanceTimersByTimeAsync(1000);
        meanwhile();
        agentActivityStore.setState({ activities: {} });
        await vi.advanceTimersByTimeAsync(1100);
        await handed;
      } finally {
        vi.useRealTimers();
      }
    };

    it("merges nothing once the mission is finished", async () => {
      await waitingTurn({}, () => nodesStore.getState().update("chef", { mission: { ...missionNow(), state: "terminee" } }));
      expect(missionMerge).not.toHaveBeenCalled();
      expect(lines()).toEqual([]);
    });

    it("does not move on an agent that reports « blocked » after all", async () => {
      await waitingTurn({}, () => {
        nodesStore.getState().update("chef", { mission: { ...missionNow(), members: [member("batman", "Batman", { report: { ...stuck, at: 700_000 } })] } });
        workspacesStore.setState({ activeId: "w2" });
      });
      expect(missionMerge).not.toHaveBeenCalled();
      expect(missionNow().members[0].task).toBe("Login");
    });

    it("revives no terminal stopped meanwhile, and still merges its branch", async () => {
      await waitingTurn({}, () => {
        terminalStatusStore.getState().set("batman", { state: "stopped" });
        workspacesStore.setState({ activeId: "w2" });
      });
      expect(missionMerge).toHaveBeenCalledTimes(1);
      expect(relaunchTerminal).not.toHaveBeenCalled();
    });

    it("gives nothing once the night is winding down", async () => {
      await waitingTurn({ overnight: true, budgetMin: 100, startedAt: Date.now() - 89 * 60_000 }, () => {
        nodesStore.getState().update("chef", { mission: { ...missionNow(), startedAt: Date.now() - 95 * 60_000 } });
      });
      expect(relaunchTerminal).not.toHaveBeenCalled();
      expect(missionAddAgent).not.toHaveBeenCalled();
    });
  });

  it("does not mark the new task merged when a merge ends after the agent moved on", async () => {
    await setup({});
    let release!: (report: { merge: { kind: "merged" }; uncommitted: boolean }) => void;
    vi.mocked(missionMerge).mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const merging = mergeMember("chef", "C:/w/auth", missionNow().members[0]);
    const moved = { ...missionNow().members[0], task: "API", report: undefined };
    nodesStore.getState().update("chef", { mission: { ...missionNow(), members: [moved] } });
    release({ merge: { kind: "merged" }, uncommitted: false });
    await merging;
    expect(missionNow().members[0].merged).toBeUndefined();
  });

  it("does not say the queue is stuck while an agent is still on its way to a task", async () => {
    vi.useFakeTimers();
    try {
      await setup({ members: [member("batman", "Batman", { report: done }), member("aquaman", "Aquaman", { task: "Docs0", report: stuck })] });
      agentActivityStore.setState({ activities: { batman: { activity: "working" } } as never });
      const handed = afterReport("chef", "batman");
      await afterReport("chef", "aquaman");
      expect(lines()).toEqual([]);
      agentActivityStore.setState({ activities: {} });
      await vi.advanceTimersByTimeAsync(1100);
      await handed;
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells once that the queue is stuck, and says nothing after the mission's end", async () => {
    await setup({ startedAt: 1, members: [member("batman", "Batman", { report: stuck })] });
    workspacesStore.setState({ activeId: "w2" });
    await afterReport("chef", "batman");
    await afterReport("chef", "batman");
    expect(lines()).toHaveLength(1);
    vi.mocked(notify).mockClear();
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", session, mission: { ...missionNow(), startedAt: 2, state: "terminee" } } });
    await afterReport("chef", "batman");
    expect(lines()).toEqual([]);
  });

  it("says why next_task gave nothing", async () => {
    await setup({ members: [member("batman", "Batman", { report: stuck })] });
    nodesStore.getState().update("chef", { mission: { ...missionNow(), overnight: true, budgetMin: 100, startedAt: Date.now() - 95 * 60_000 } });
    expect(await giveNext("chef", missionNow().members[0])).toEqual({ refused: "The end of the night is near: the queue gives out no more tasks." });
    nodesStore.getState().update("chef", { mission: { ...missionNow(), overnight: undefined } });
    workspacesStore.setState({ activeId: "w2" });
    expect(await giveNext("chef", missionNow().members[0])).toEqual({ refused: "The fleet's workspace is not on screen: no agent can be created there." });
    workspacesStore.setState({ activeId: "w1" });
    // Done, its branch goes in first: on a conflict, no new agent starts from a branch without its work.
    nodesStore.getState().update("chef", { mission: { ...missionNow(), members: [member("batman", "Batman", { report: done })] } });
    vi.mocked(missionMerge).mockResolvedValueOnce({ merge: { kind: "conflict", files: ["a.ts"] }, uncommitted: false });
    expect(await giveNext("chef", missionNow().members[0])).toEqual({ refused: "Nothing starts for now: Batman's branch is not merged." });
    expect(missionAddAgent).not.toHaveBeenCalled();
    expect(missionNow().members[0].abandoned).toBeUndefined();
  });

  it("merges a done agent's branch before next_task starts the new agent, and abandons nothing", async () => {
    await setup({});
    const result = await giveNext("chef", missionNow().members[0]);
    expect(result).toEqual({ given: `${created()[0].name}, a new agent, takes "API". Still waiting: 0.` });
    expect(vi.mocked(missionMerge).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(missionAddAgent).mock.invocationCallOrder[0]);
    expect(missionNow().members[0]).toMatchObject({ task: "Login", merged: true });
    expect(missionNow().members[0].abandoned).toBeUndefined();
  });
});

describe("a task taken from the queue keeps every tool working", () => {
  it("can be reassigned like a sub-task of the plan", async () => {
    await setup({ members: [member("batman", "Batman", { report: done }), member("aquaman", "Aquaman", { task: "Docs", report: done, merged: true })], plan: [{ title: "Login", brief: "b", agent: "Batman", budgetMin: 20 }, { title: "Docs", brief: "b", agent: "Aquaman", budgetMin: 20 }], queue: [next] });
    await afterReport("chef", "batman");
    const fresh = created()[0];
    expect(fresh.task).toBe("API");
    expect(await reassignTask("chef", fresh.nodeId, "Aquaman")).toEqual({ name: "Aquaman" });
    expect(missionNow().members.find((m) => m.name === "Aquaman")?.task).toBe("API");
  });
});

describe("what the fleet hears when nobody is left working", () => {
  it("is told once all have reported and the queue is empty", async () => {
    await setup({ queue: [] });
    await afterReport("chef", "batman");
    expect(lines()).toEqual(["The queue is empty and everyone has reported: merge, have it checked, then finish."]);
  });

  it("is told when tasks wait that no new agent can take", async () => {
    await setup({ members: [member("batman", "Batman", { report: { ...done, status: "echec" } })] });
    workspacesStore.setState({ activeId: "w2" });
    await afterReport("chef", "batman");
    expect(lines()).toEqual(["1 task waits that no new agent could take: next_task, reassign, or finish."]);
  });

  it("says nothing while someone still works", async () => {
    await setup({ queue: [], members: [member("batman", "Batman", { report: done }), member("aquaman", "Aquaman", { task: "Docs" })] });
    await afterReport("chef", "batman");
    expect(lines()).toEqual([]);
  });
});

it("does not launch a queued task without a level with the router on: it would run on the default model", async () => {
  await setup({ state: "plan", router: true, plan: [{ title: "Login", brief: "b", agent: "Batman", budgetMin: 20, level: "faible" }], queue: [next], members: [] });
  await launchMission("chef");
  expect(missionNow()).toMatchObject({ state: "plan", error: expect.stringContaining("level") });
});

it("keeps the task an agent finished when reassign gives it another one", async () => {
  await setup({ members: [member("batman", "Batman", { task: "API" }), member("aquaman", "Aquaman", { task: "Login", report: done, merged: true })], plan: [{ title: "Login", brief: "b", agent: "Aquaman", budgetMin: 20 }, { title: "API", brief: "b", agent: "Batman", budgetMin: 30 }], queue: [] });
  await reassignTask("chef", "batman", "Aquaman");
  expect(missionNow().members.find((m) => m.name === "Aquaman")?.past).toEqual([{ task: "Login", status: "termine", summary: "Login fait", merged: true, spentMin: 10, budgetMin: 20, branch: "dummyplane/auth-aquaman" }]);
});

it("keeps what an agent left to check in its own report, for the morning report", async () => {
  await setup({ members: [member("batman", "Batman", { report: { ...done, check: "Le bouton" } })] });
  await afterReport("chef", "batman");
  expect(missionNow().members[0].report?.check).toBe("Le bouton");
  expect(morningReport(missionNow(), Date.now()).check).toEqual(["Batman · Login : Le bouton"]);
});

it("launches the new agent with the mission's permissions", async () => {
  await setup({ permission: "work" });
  await afterReport("chef", "batman");
  const payload = vi.mocked(addTerminal).mock.calls[0][1] as TerminalPayload;
  expect(payload).toMatchObject({ permission: "work" });
  expect(buildSpawnSpec(payload, "new").claude?.permission).toBe("work");
});

it("speaks English when the interface does", async () => {
  await setup({});
  await afterReport("chef", "batman");
  await vi.waitFor(() => expect(ptySendText).toHaveBeenCalled());
  const name = created()[0].name;
  expect(lines()).toEqual([`${name}, a new agent, takes "API". Still waiting: 0.`]);
  expect(vi.mocked(ptySendText).mock.calls[0][1]).toBe(
    `[dummyPlane · mission Auth] API — Fais l'API. Budget: 30 min. Branch: dummyplane/auth-${name.toLowerCase()}. This worktree is new: its dependencies (node_modules…) are not installed. Declare your steps, delegate to your sub-agents, commit on your branch, then report with report.`,
  );
});

describe("the night's time (review)", () => {
  it("starts no new task once it is spent: nobody asked for more usage", async () => {
    await setup({ overnight: true, budgetMin: 30 });
    const clock = vi.spyOn(Date, "now").mockReturnValue(31 * 60_000);
    await afterReport("chef", "batman");
    clock.mockRestore();
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(ptySendText).not.toHaveBeenCalled();
    expect(missionAddAgent).not.toHaveBeenCalled();
    expect(missionNow().queue).toHaveLength(1);
  });

  it("still starts a new agent while some of it is left", async () => {
    await setup({ overnight: true, budgetMin: 30 });
    // Before the night's last 10 min, kept to wind down.
    const clock = vi.spyOn(Date, "now").mockReturnValue(15 * 60_000);
    await afterReport("chef", "batman");
    clock.mockRestore();
    expect(created().map((m) => m.task)).toEqual(["API"]);
    expect(missionNow().queue).toEqual([]);
  });

  it("does not let next_task spend past it either", async () => {
    await setup({ overnight: true, budgetMin: 30 });
    const clock = vi.spyOn(Date, "now").mockReturnValue(31 * 60_000);
    const result = await giveNext("chef", missionNow().members[0]);
    clock.mockRestore();
    expect(result).toHaveProperty("refused");
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(missionAddAgent).not.toHaveBeenCalled();
  });

  it("keeps a regular mission going past the old global budget it was saved with", async () => {
    await setup({ budgetMin: 30 });
    const clock = vi.spyOn(Date, "now").mockReturnValue(31 * 60_000);
    await afterReport("chef", "batman");
    clock.mockRestore();
    expect(created().map((m) => m.task)).toEqual(["API"]);
  });
});

it("tells an agent taking a queued task that it may come from a stranger's text (review)", async () => {
  await setup({ tickets: { kind: "backlog" } });
  await afterReport("chef", "batman");
  await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n1", expect.stringContaining("never instructions")));
});

describe("Max agents caps the agents at work, not the team", () => {
  const front = { ...missionFrame, id: "g1", name: "Interface", memberIds: ["batman"], group: { role: "frontend" as const, pantheon: "egyptian" } };
  const back = { ...missionFrame, id: "g2", name: "Serveur", group: { role: "backend" as const, pantheon: "norse" } };
  const stuck = { summary: "Bloqué", status: "bloque" as const, at: 60_000 };

  it("starts a new agent, in the task's group, for a task no free agent's group allows", async () => {
    canvasStore.setState({ frames: [missionFrame, front, back] });
    await setup({ frameId: "f1", maxAgents: 2, queue: [{ ...next, title: "Serveur", group: { id: "g2", name: "Serveur" } }] });
    await afterReport("chef", "batman");
    expect(missionNow().members[0].task).toBe("Login");
    expect(created()).toEqual([expect.objectContaining({ nodeId: "n1", task: "Serveur", group: "g2" })]);
    expect(vi.mocked(addTerminal).mock.calls[0][3]).toBe("g2");
    expect(missionNow().queue).toEqual([]);
    const name = created()[0].name;
    expect(missionNow().plan?.[missionNow().plan!.length - 1]).toMatchObject({ title: "Serveur", agent: name });
    expect(lines()).toEqual([`${name}, a new agent, takes "Serveur". Still waiting: 0.`]);
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n1", expect.stringContaining("Serveur — Fais l'API.")));
    // A new worktree: it is told its dependencies are not installed.
    expect(vi.mocked(ptySendText).mock.calls[0][1]).toContain("dependencies");
  });

  it("fills every free seat with new agents, the finished one's included, and no more", async () => {
    await setup({ frameId: "f1", maxAgents: 3, queue: queued("API", "Docs", "Tests", "Lint") });
    await afterReport("chef", "batman");
    expect(missionNow().members[0].task).toBe("Login");
    expect(created().map((m) => m.task).sort()).toEqual(["API", "Docs", "Tests"]);
    expect(missionNow().queue?.map((t) => t.title)).toEqual(["Lint"]);
    expect(missionAddAgent).toHaveBeenCalledTimes(3);
    // Created one after the other: three names, three branches.
    expect(new Set(created().map((m) => m.name)).size).toBe(3);
  });

  it("does not count an agent that reported « blocked » or « failed »: its seat goes to a new agent", async () => {
    await setup({
      frameId: "f1",
      maxAgents: 2,
      queue: queued("API", "Docs", "Tests"),
      members: [member("batman", "Batman", { report: stuck }), member("aquaman", "Aquaman", { task: "Docs0", report: { ...stuck, status: "echec" } })],
    });
    await afterReport("chef", "batman");
    expect(missionNow().members.find((m) => m.name === "Batman")?.task).toBe("Login");
    expect(created().map((m) => m.task)).toEqual(["API", "Docs"]);
    expect(missionNow().queue?.map((t) => t.title)).toEqual(["Tests"]);
  });

  it("counts the agents still at work: none is started while they fill the seats", async () => {
    await setup({ frameId: "f1", maxAgents: 2, members: [member("batman", "Batman", { report: stuck }), member("aquaman", "Aquaman", { task: "Docs0" }), member("cyborg", "Cyborg", { task: "Tests0" })] });
    terminalStatusStore.getState().set("cyborg", { state: "running" });
    await afterReport("chef", "batman");
    expect(missionAddAgent).not.toHaveBeenCalled();
    expect(missionNow().queue).toHaveLength(1);
  });

  it("hands each task once and stays within the cap, however many pumps run at once", async () => {
    vi.mocked(addTerminal).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const id = `n${++made}`;
      terminalStatusStore.getState().set(id, { state: "running" });
      return id;
    });
    await setup({ frameId: "f1", maxAgents: 3, queue: queued("A", "B", "C", "D"), members: [member("batman", "Batman")] });
    await Promise.all([pumpQueue("chef"), pumpQueue("chef"), pumpQueue("chef"), afterReport("chef", "batman")]);
    expect(created().map((m) => m.task)).toEqual(["A", "B"]);
    expect(missionNow().queue?.map((t) => t.title)).toEqual(["C", "D"]);
    expect(missionAddAgent).toHaveBeenCalledTimes(2);
  });

  it("counts a new agent whose terminal is still starting: its task is not typed yet", async () => {
    vi.mocked(addTerminal).mockImplementation(async () => {
      const id = `n${++made}`;
      terminalStatusStore.getState().set(id, { state: "starting" });
      return id;
    });
    await setup({ frameId: "f1", maxAgents: 1, queue: queued("A", "B"), members: [member("batman", "Batman", { report: stuck })] });
    await pumpQueue("chef");
    await pumpQueue("chef");
    expect(created().map((m) => m.task)).toEqual(["A"]);
  });

  it("starts no new agent once the night winds down or is over", async () => {
    await setup({ frameId: "f1", overnight: true, budgetMin: 100, startedAt: Date.now() - 95 * 60_000, members: [member("batman", "Batman", { report: stuck })] });
    await afterReport("chef", "batman");
    nodesStore.getState().update("chef", { mission: { ...missionNow(), budgetMin: 30, startedAt: Date.now() - 31 * 60_000 } });
    await pumpQueue("chef");
    expect(missionAddAgent).not.toHaveBeenCalled();
    expect(missionNow().queue).toEqual([next]);
  });

  it("starts none once the mission is finished", async () => {
    await setup({ frameId: "f1", state: "terminee", members: [member("batman", "Batman", { report: stuck })] });
    await pumpQueue("chef");
    expect(missionAddAgent).not.toHaveBeenCalled();
  });

  it("keeps the task in the queue and says why when the new agent cannot be created", async () => {
    vi.mocked(missionAddAgent).mockRejectedValueOnce(new Error("branch exists"));
    // Another mission than the earlier tests': the stuck queue is told once per mission.
    await setup({ frameId: "f1", startedAt: 3, members: [member("batman", "Batman", { report: stuck })] });
    await afterReport("chef", "batman");
    expect(missionNow().queue).toEqual([next]);
    expect(lines()).toEqual(['No new agent could take "API", it stays in the queue — branch exists', "1 task waits that no new agent could take: next_task, reassign, or finish."]);
  });

  it("gives the router's model to a new agent", async () => {
    await setup({ frameId: "f1", router: true, queue: [{ ...next, level: "eleve" }], members: [member("batman", "Batman", { report: stuck })] });
    await afterReport("chef", "batman");
    expect(created()[0].model).toBe("claude-opus-5-5");
  });

  it("fills the seats a short plan leaves at the go-ahead: Max agents 2, one sub-task, three queued", async () => {
    vi.mocked(missionPrepare).mockResolvedValue({ slug: "auth", branch: "dummyplane/auth", path: "C:/w/auth" });
    await setup({ state: "plan", maxAgents: 2, plan: [{ title: "Login", brief: "Fais le login", agent: "nouveau", budgetMin: 20 }], queue: queued("Docs", "Tests", "Lint"), members: [] });
    await launchMission("chef");
    await vi.waitFor(() => expect(missionNow().members.map((m) => m.task)).toEqual(["Login", "Docs"]));
    expect(launchGroup).not.toHaveBeenCalled();
    expect(missionNow().queue?.map((t) => t.title)).toEqual(["Tests", "Lint"]);
    // Both are the Manager's sub-agents, and the Manager hears the queue: the Fleet hears nothing of it.
    expect(vi.mocked(addTerminal).mock.calls.map(([, payload]) => payload.spawnedBy)).toEqual(["m1", "m1"]);
    expect(vi.mocked(notify).mock.calls).toContainEqual(["m1", expect.stringContaining('a new agent, takes "Docs". Still waiting: 2.')]);
    expect(vi.mocked(notify).mock.calls.some(([id]) => id === "chef")).toBe(false);
  });

  it("starts a new agent for the queue when a seat is free and nobody has finished (after a launch)", async () => {
    await setup({ frameId: "f1", maxAgents: 2, queue: queued("Docs", "Tests", "Lint"), members: [member("batman", "Batman")] });
    await pumpQueue("chef");
    expect(created().map((m) => m.task)).toEqual(["Docs"]);
    expect(missionNow().queue?.map((t) => t.title)).toEqual(["Tests", "Lint"]);
  });
});

describe("a card the Fleet adds while its Manager runs the board", () => {
  it("lands in the to-do column, and the Manager's queue starts it under the Manager as soon as a seat is free, without the Fleet", async () => {
    await nodesStore.getState().create("b1", {
      workspaceId: "w1",
      kind: "kanban",
      payload: {
        columns: [
          { id: "todo", title: "To do", cardIds: [] },
          { id: "doing", title: "In progress", cardIds: [] },
          { id: "done", title: "Done", cardIds: [] },
        ],
        cards: {},
        orchestrator: { nodeId: "chef", columnId: "todo" },
      },
    });
    // Three tasks were planned: Batman works, the two others reported; one seat of two is free.
    const reported = { summary: "ok", status: "termine" as const, at: 1 };
    await setup({ frameId: undefined, manager: "m1", board: "b1", boardMade: true, maxAgents: 2, queue: [], members: [member("batman", "Batman"), member("aquaman", "Aquaman", { task: "API", report: reported, merged: true })] });
    const said = await fleetTool("chef", "add_tasks", { tasks: [{ titre: "Tests", consigne: "Write the tests", budget_min: 15 }] });
    expect(said.isError).toBeUndefined();
    await vi.waitFor(() => expect(created().map((m) => m.task)).toEqual(["Tests"]));
    const card = missionNow().plan?.find((task) => task.title === "Tests")?.card;
    const board = nodesStore.getState().nodes.b1.payload as { columns: { cardIds: string[] }[]; cards: Record<string, { title: string; agent?: string }> };
    expect(board.cards[card!]).toMatchObject({ title: "Tests" });
    // Its agent is one of the Manager's sub-agents, and the card follows it.
    expect(vi.mocked(addTerminal).mock.calls[0][1]).toMatchObject({ spawnedBy: "m1", task: "Tests" });
    await vi.waitFor(() => expect((nodesStore.getState().nodes.b1.payload as typeof board).columns[1].cardIds).toEqual([card]));
    // The Manager hears the card and the new agent; the Fleet, nothing.
    const to = (id: string) => vi.mocked(notify).mock.calls.filter(([target]) => target === id).map(([, line]) => line);
    expect(to("m1")).toEqual([
      'Chef added 1 card to the board: "Tests". They wait in the queue: a new agent takes each as a seat frees up.',
      expect.stringContaining('a new agent, takes "Tests". Still waiting: 0.'),
    ]);
    expect(to("chef")).toEqual([]);
  });
});

describe("a waiting task another agent is already at work on", () => {
  const reported = { summary: "ok", status: "termine" as const, at: 1 };
  /** Aquaman works on "Billing", its Kanban card c9, five minutes in; Batman is through. */
  const billing = (extra: Partial<Mission> = {}) =>
    setup({
      maxAgents: 2,
      plan: [
        { title: "Login", brief: "Fais le login", agent: "Batman", budgetMin: 20 },
        { title: "Billing", brief: "Add the billing page with its invoices table and its export", agent: "Aquaman", budgetMin: 20, card: "c9" },
      ],
      members: [member("batman", "Batman", { report: reported, merged: true }), member("aquaman", "Aquaman", { task: "Billing", sentAt: Date.now() - 5 * 60_000 })],
      queue: [],
      ...extra,
    });
  const aquamanWorks = () => agentActivityStore.setState({ activities: { aquaman: { activity: "working", since: 1 } } as never });
  const told = () => lines().filter((line) => line.includes("is already working on"));

  it("skips it, its card untouched, and tells the fleet once; the tasks behind it take the seat", async () => {
    await billing({ queue: [{ ...next, title: "Invoices", card: "c9" }, { title: "Search", brief: "Index the catalogue so that the search box answers in under fifty milliseconds", budgetMin: 30, card: "c10" }] });
    aquamanWorks();
    await pumpQueue("chef");
    await pumpQueue("chef");
    await afterReport("chef", "batman");
    // One seat of two was free: Search took it, Invoices stays in the queue, whole.
    expect(created().map((m) => m.task)).toEqual(["Search"]);
    expect(missionNow().queue).toEqual([{ ...next, title: "Invoices", card: "c9" }]);
    expect(missionNow().plan?.some((task) => task.title === "Invoices")).toBe(false);
    expect(told()).toEqual(['No new agent starts on "Invoices": Aquaman is already working on "Billing" (working, 5 of 20 min). It stays in the queue, its card untouched, and starts only once that agent is no longer on it. Message or read that agent instead.']);
  });

  it("starts it once that agent is no longer on it", async () => {
    await billing({ queue: [{ ...next, title: "Invoices", card: "c9" }] });
    aquamanWorks();
    await pumpQueue("chef");
    expect(created()).toEqual([]);
    // Aquaman reports: its seat is free and the card is no longer one an agent is on.
    nodesStore.getState().update("chef", { mission: { ...missionNow(), members: missionNow().members.map((m) => (m.nodeId === "aquaman" ? { ...m, report: reported, merged: true } : m)) } });
    await pumpQueue("chef");
    await vi.waitFor(() => expect(created().map((m) => m.task)).toEqual(["Invoices"]));
    expect(missionNow().queue).toEqual([]);
  });

  it("does not look at a different task of the same mission", async () => {
    await billing({ queue: [{ title: "Login page", brief: "Add the login page with its form and its error messages", budgetMin: 20, card: "c11" }] });
    aquamanWorks();
    await pumpQueue("chef");
    await vi.waitFor(() => expect(created().map((m) => m.task)).toEqual(["Login page"]));
    expect(told()).toEqual([]);
  });

  it("counts an agent between two turns, its report not given, and not one that stopped", async () => {
    await billing({ queue: [{ ...next, title: "Refunds", card: "c9" }] });
    // Idle: its turn ended, it still holds the task.
    agentActivityStore.setState({ activities: { aquaman: { activity: "idle", since: 1 } } as never });
    await pumpQueue("chef");
    expect(created()).toEqual([]);
    expect(told()).toEqual([expect.stringContaining('Aquaman is already working on "Billing" (between two turns, 5 of 20 min)')]);
    // Stopped: nobody is on it.
    terminalStatusStore.getState().set("aquaman", { state: "exited", code: 0 });
    await pumpQueue("chef");
    await vi.waitFor(() => expect(created().map((m) => m.task)).toEqual(["Refunds"]));
  });

  it("starts one agent for two tasks on one card in a single turn, the second skipped", async () => {
    await setup({ queue: [{ ...next, title: "Tests A", card: "c5" }, { ...next, title: "Tests B", card: "c5" }], members: [member("batman", "Batman", { report: done, merged: true })] });
    await pumpQueue("chef");
    await vi.waitFor(() => expect(created().map((m) => m.task)).toEqual(["Tests A"]));
    expect(missionNow().queue?.map((task) => task.title)).toEqual(["Tests B"]);
    expect(told()).toHaveLength(1);
    expect(told()[0]).toContain('"Tests A"');
  });

  it("next_task names who is on the waiting task, instead of saying nothing waits", async () => {
    await billing({ queue: [{ ...next, title: "Invoices", card: "c9" }] });
    aquamanWorks();
    const batman = missionNow().members[0];
    expect(await giveNext("chef", batman)).toEqual({
      refused: 'The next task, "Invoices", cannot start: Aquaman is already working on "Billing" (working, 5 of 20 min). It starts once that agent is no longer on it.',
    });
    expect(created()).toEqual([]);
    // The caller read it in the answer: the fleet is not told on top.
    expect(told()).toEqual([]);
  });
});
