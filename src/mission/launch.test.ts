// @vitest-environment happy-dom
import { STORED_FLEET_KIND } from "@/canvas/nodeElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { userIsTyping } from "@/canvas/typing";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import { pauseAgents } from "@/agents/broadcast";
import { forgetScene, rememberScene } from "@/canvas/sceneCache";
import { closeGroup, closeStoredGroup, launchGroup, showGroups } from "@/agents/groups";
import { nextName } from "@/agents/names";
import { linkFleet } from "@/fleet/fleets";
import { addTerminal, removeFromStoredScene, removeNodes } from "@/agents/terminals";
import { missionAddAgent, missionCleanup, missionDiscard, missionMerge, missionPrepare, missionProbe, missionRemoveAgent, type Worktree } from "@/ipc/mission";
import { ptySendText } from "@/ipc/pty";
import { relaunchTerminal, stopTerminal } from "@/nodes/terminal/registry";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, sessionOf, terminalOf } from "@/store/nodes";
import { projectsStore, type Project } from "@/store/projects";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { notify } from "./events";
import { whenReady } from "./ready";
import { onFinish, type FinishSignal } from "@/agents/finishes";
import { assign, cleanMission, deliveryPending, endMission, handoverText, launchMission, mergeMission, reassignTask, subTaskText, withTicketNote } from "./launch";
import { installRedelivery } from "./redeliver";
import { stopMission } from "./stop";
import { activeCount } from "./active";
import { conflictPending, NEW_MISSION, type Member, type Mission } from "./mission";
import { memberOf, missionOf, releaseTeamPermission, setMission, updateMember } from "./store";
import { addTeamMember, setUpBoard, undoSetup } from "./manager";
import { isLaunching, markLaunching } from "@/agents/spawnFamily";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { subagentSettingsStore } from "@/app/subagentSettings";
import { takenOver } from "@/agents/finishedStop";
import { agentActivityStore } from "@/store/agentActivity";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/ipc/mission", () => ({
  missionPrepare: vi.fn(),
  missionAddAgent: vi.fn(),
  missionMerge: vi.fn(),
  missionProbe: vi.fn(() => Promise.reject(new Error("no probe"))),
  missionCleanup: vi.fn(),
  missionDiscard: vi.fn(() => Promise.resolve({ removed: [], kept: [] })),
  missionRemoveAgent: vi.fn(() => Promise.resolve({ removed: [], kept: [] })),
}));
// Whether the user took a terminal over reads the canvas's focus: told here.
vi.mock("@/agents/finishedStop", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/agents/finishedStop")>()), takenOver: vi.fn(() => false) }));
vi.mock("@/ipc/pty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/pty")>()),
  ptySendText: vi.fn(() => Promise.resolve()),
  ptyWrite: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/nodes/terminal/registry", () => ({
  relaunchTerminal: vi.fn(),
  stopTerminal: vi.fn(),
  quietFor: vi.fn(() => 0),
  typedAgo: vi.fn(() => Infinity),
  freshText: vi.fn(() => ""),
  markForAutostart: vi.fn(),
  isLiveInRust: vi.fn(() => false),
  xtermOf: vi.fn(),
}));
vi.mock("@/agents/groups", () => ({ launchGroup: vi.fn(), closeGroup: vi.fn(), closeStoredGroup: vi.fn(), showGroups: vi.fn() }));
vi.mock("@/fleet/fleets", () => ({ linkFleet: vi.fn() }));
vi.mock("@/agents/terminals", () => ({ addTerminal: vi.fn(() => Promise.resolve("n9")), removeNodes: vi.fn(), removeFromStoredScene: vi.fn() }));
vi.mock("@/agents/broadcast", () => ({ pauseAgents: vi.fn(() => Promise.resolve(1)) }));
vi.mock("@/canvas/arrive", () => ({ showNode: vi.fn() }));
vi.mock("@/canvas/typing", () => ({ userIsTyping: vi.fn(() => false) }));
vi.mock("./ready", () => ({ whenReady: vi.fn(() => Promise.resolve(true)) }));
vi.mock("./events", () => ({ notify: vi.fn() }));
vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  linkedTeamAgents: vi.fn(() => [{ nodeId: "batman", name: "Batman" }]),
}));
// The board and its Manager are scene work (`./manager.test.ts`): here the go-ahead gets board b1 and Manager m1.
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
    undoSetup: vi.fn((fleetId: string) => store.setMission(fleetId, { board: undefined, manager: undefined, boardMade: undefined })),
    removeManager: vi.fn(),
  };
});

// How agents arrive: the go-ahead's team comes into view (the user just asked for it), a replacement's agent never does.
const inView = { reveal: true };
const quiet = { reveal: false, source: "mission" };

const session: TerminalPayload = { title: "Chef", name: "Chef", agent: "claude", cwd: "C:/code/proj", shell: "default", command: "", claudeSessionId: "s0", role: "orchestrator" };
const plan = [
  { title: "Login", brief: "Fais le login.", agent: "Batman", budgetMin: 20 },
  { title: "API", brief: "Fais l'API\npuis teste", agent: "nouveau", budgetMin: 30 },
];
const tree = (slug: string): Worktree => ({ slug, branch: `dummyplane/${slug}`, path: `C:/code/proj.worktrees/${slug}` });
const member = (nodeId: string, name: string, linked: boolean, extra: Partial<Member> = {}): Member => ({
  nodeId, name, task: "t", budgetMin: 5, linked, branch: `dummyplane/auth-${nodeId}`, worktree: `C:/w/${nodeId}`, sentAt: 1, ...extra,
});
const missionNow = () => missionOf(nodesStore.getState().nodes.chef)!;

async function setup(mission: Partial<Mission> = {}) {
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", session, mission: { state: "plan", maxAgents: 4, members: [], name: "Auth", plan, ...mission } },
  });
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { ...session, role: undefined, name: "Batman", claudeSessionId: "old", steps: [{ title: "Plan", state: "fait" }] },
  });
}

beforeEach(() => {
  // The router as before Settings had one: only a switch set on routes. The global setting has its own tests.
  modelRouterStore.setState({ on: false, levels: {} });
  // "Stop finished agents" off: no merge closes its agent, as before; the tests of the cleanup after a merge turn it on.
  subagentSettingsStore.setState({ stopFinished: false });
  mockIPC(() => undefined);
  vi.clearAllMocks();
  vi.mocked(userIsTyping).mockReturnValue(false);
  vi.mocked(missionPrepare).mockResolvedValue(tree("auth"));
  vi.mocked(missionAddAgent).mockImplementation(async (_project, mission, agent) => tree(`${mission}-${agent.toLowerCase()}`));
  vi.mocked(launchGroup).mockResolvedValue({ frameId: "f1", nodeIds: ["n1"] });
  for (const id of ["chef", "batman", "n1"]) terminalStatusStore.getState().set(id, { state: "running" });
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({ api: { getSceneElementsIncludingDeleted: () => [] } as never, frames: [], links: {} });
});

it("tells the agent of a new worktree what to install, and says nothing of it for the others", () => {
  const line = "This worktree is new: its dependencies are not installed yet. Install them first, as the project's lockfiles say: pnpm install --frozen-lockfile.";
  expect(subTaskText("Auth", plan[1], "dummyplane/auth-aquaman", undefined, line)).toBe(
    `[dummyPlane · mission Auth] API — Fais l'API puis teste. Budget: 30 min. Branch: dummyplane/auth-aquaman. Work in this worktree only, never in the user's own checkout of the project: the mission reaches their branch when they click Land in dummyPlane. ${line} Declare your steps, delegate to your sub-agents, commit on your branch, then report with report.`,
  );
  // The handover goes after it all, as before; an agent given a sub-task in a worktree it already has gets no line.
  expect(subTaskText("Auth", plan[1], "dummyplane/auth-aquaman", "Taking over.", "")).not.toContain("dependencies");
});

it("writes an agent's sub-task on one line, with its budget, branch and duties", () => {
  expect(subTaskText("Auth", plan[1], "dummyplane/auth-aquaman")).toBe(
    "[dummyPlane · mission Auth] API — Fais l'API puis teste. Budget: 30 min. Branch: dummyplane/auth-aquaman. Work in this worktree only, never in the user's own checkout of the project: the mission reaches their branch when they click Land in dummyPlane. Declare your steps, delegate to your sub-agents, commit on your branch, then report with report.",
  );
});

describe("what dummyPlane types to agents, in English", () => {
  const english = async (check: () => Promise<void> | void) => {
    try {
      await check();
    } finally {
    }
  };

  it("writes the sub-task and the handover in the interface's language", () =>
    english(() => {
      expect(subTaskText("Auth", plan[1], "dummyplane/auth-aquaman")).toBe(
        "[dummyPlane · mission Auth] API — Fais l'API puis teste. Budget: 30 min. Branch: dummyplane/auth-aquaman. Work in this worktree only, never in the user's own checkout of the project: the mission reaches their branch when they click Land in dummyPlane. Declare your steps, delegate to your sub-agents, commit on your branch, then report with report.",
      );
      expect(handoverText(member("n1", "Aquaman", false, { report: { summary: "API done", status: "termine", at: 1 } }))).toBe(
        'Taking over Aquaman\'s work: its report (done): "API done". Its branch dummyplane/auth-n1: merge it into yours to start from its work.',
      );
      expect(handoverText(member("n1", "Aquaman", false))).toContain("it did not report");
    }));

  it("tells the fleet in English that the mission could not start", () =>
    english(async () => {
      await setup();
      vi.mocked(missionPrepare).mockRejectedValueOnce(new Error("boom"));
      await launchMission("chef");
      expect(notify).toHaveBeenCalledWith("chef", "The mission could not start: boom");
    }));

  it("says what was merged in English", () =>
    english(async () => {
      const done = { summary: "ok", status: "termine" as const, at: 1 };
      await setup({ state: "en_cours", worktree: "C:/w/auth", branch: "dummyplane/auth", members: [member("batman", "Batman", true, { report: done }), member("n1", "Aquaman", false, { report: done })] });
      vi.mocked(missionMerge).mockImplementation(async (_mission, _agent, branch) =>
        branch.endsWith("batman") ? { merge: { kind: "merged" }, uncommitted: true, head: "c0ffee" } : { merge: { kind: "conflict", files: ["a.ts"] }, uncommitted: false, head: "c0ffee" },
      );
      expect(await mergeMission("chef")).toBe(`Branch dummyplane/auth:\nBatman: merged (uncommitted changes in its worktree are not merged: ask it to commit them, then merge again)\nAquaman: conflict, merge undone — a.ts. Not retried by itself: ask Aquaman to merge the mission's branch into its own, resolve and commit; its branch is merged again when it reports, or with merge and agent set to Aquaman.`);
    }));

  it("tells the Manager a merge went unsigned when the repository alone names its signing program", () =>
    english(async () => {
      const done = { summary: "ok", status: "termine" as const, at: 1 };
      await setup({ state: "en_cours", worktree: "C:/w/auth", branch: "dummyplane/auth", members: [member("batman", "Batman", true, { report: done })] });
      vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "merged" }, uncommitted: false, unsigned: true, head: "c0ffee" });
      expect(await mergeMission("chef")).toBe("Branch dummyplane/auth:\nBatman: merged (not signed: the signing program is set in this repository only)");
    }));

  it("refuses a reassignment in English, and tells the previous agent in English", () =>
    english(async () => {
      const report = { summary: "API done", status: "termine" as const, at: 1 };
      await setup({ state: "en_cours", project: "C:/code/proj", slug: "auth", frameId: "f1", members: [member("batman", "Batman", true, { task: "Login" }), member("n1", "Aquaman", false, { task: "API", report, merged: true })] });
      expect(await reassignTask("chef", "n1", "Batman")).toBe('Batman has not finished its sub-task: choose an agent that has reported, or "new".');
      expect(await reassignTask("chef", "batman", "Aquaman")).toEqual({ name: "Aquaman" });
      expect(ptySendText).toHaveBeenCalledWith("batman", '[dummyPlane] Your sub-task "Login" goes to Aquaman: stop it and commit nothing more on it.');
    }));
});

describe("the model router", () => {
  it("starts each agent on the model of its sub-task's level, and gives the linked ones theirs back at the end", async () => {
    await setup({ router: true, plan: [{ ...plan[0], level: "eleve" }, { ...plan[1], level: "faible" }] });
    await launchMission("chef");
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.objectContaining({ model: "claude-haiku-5-5", spawnedBy: "m1" }), expect.anything(), null, quiet);
    expect(terminalOf(nodesStore.getState().nodes.batman)?.model).toBe("claude-opus-5-5");
    expect(relaunchTerminal).toHaveBeenCalledWith("batman", expect.objectContaining({ model: "claude-opus-5-5" }), "new");
    expect(missionNow().members.map((m) => m.model)).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
    endMission("chef", "Fini.");
    expect(terminalOf(nodesStore.getState().nodes.batman)?.model).toBeUndefined();
    expect(relaunchTerminal).toHaveBeenLastCalledWith("batman", expect.objectContaining({ cwd: "C:/code/proj", model: undefined }), "new");
  });

  it("does not launch with the router on and a sub-task without a level: it would run on the default model", async () => {
    await setup({ router: true });
    await launchMission("chef");
    expect(missionPrepare).not.toHaveBeenCalled();
    expect(missionNow()).toMatchObject({ state: "plan", error: expect.stringContaining("level") });
    expect(notify).toHaveBeenCalledWith("chef", expect.stringContaining("level"));
  });

  it("starts a linked agent whose own router is on on its sub-task's level while the Fleet's router is off; a new agent keeps Claude's own", async () => {
    await setup({ plan: [{ ...plan[0], level: "eleve" }, { ...plan[1], level: "faible" }] });
    nodesStore.getState().update("batman", { router: true });
    await launchMission("chef");
    expect(terminalOf(nodesStore.getState().nodes.batman)?.model).toBe("claude-opus-5-5");
    expect(relaunchTerminal).toHaveBeenCalledWith("batman", expect.objectContaining({ model: "claude-opus-5-5" }), "new");
    expect(vi.mocked(addTerminal).mock.calls[0][1].model).toBeUndefined();
    expect(missionNow().members.map((m) => m.model)).toEqual(["claude-opus-5-5", undefined]);
    // The switch is the agent's own: the mission leaves it on, and only the router's model goes back.
    endMission("chef", "Fini.");
    expect(terminalOf(nodesStore.getState().nodes.batman)).toMatchObject({ model: undefined, router: true });
  });

  it("keeps the model of a linked agent whose router is on when its sub-task names no level, and of one the router does not route", async () => {
    await setup();
    nodesStore.getState().update("batman", { router: true, model: "claude-sonnet-5-5" });
    await launchMission("chef");
    expect(terminalOf(nodesStore.getState().nodes.batman)?.model).toBe("claude-sonnet-5-5");
    expect(missionNow().members[0].model).toBe("claude-sonnet-5-5");
    expect(missionNow().members[0].keptModel).toBeUndefined();
    vi.mocked(relaunchTerminal).mockClear();
    nodesStore.getState().update("chef", { mission: { ...missionNow(), state: "plan", members: [] } });
    // Its switch unset, with Settings and the Fleet's off: not routed, so dummyPlane wipes nothing either.
    nodesStore.getState().update("batman", { router: undefined });
    await launchMission("chef");
    expect(terminalOf(nodesStore.getState().nodes.batman)?.model).toBe("claude-sonnet-5-5");
    expect(missionNow().members[0]).toMatchObject({ model: "claude-sonnet-5-5", keptModel: true });
  });

  it("gives a linked agent the router does not route its own model back after the mission, a new agent none", async () => {
    // Settings' router off, the switches unset: nobody is routed.
    await setup({ plan: [{ ...plan[0], level: "eleve" }, { ...plan[1], level: "faible" }] });
    nodesStore.getState().update("batman", { model: "claude-opus-5-5" });
    await launchMission("chef");
    expect(relaunchTerminal).toHaveBeenCalledWith("batman", expect.objectContaining({ model: "claude-opus-5-5" }), "new");
    expect(vi.mocked(addTerminal).mock.calls[0][1].model).toBeUndefined();
    endMission("chef", "Fini.");
    expect(terminalOf(nodesStore.getState().nodes.batman)?.model).toBe("claude-opus-5-5");
    expect(relaunchTerminal).toHaveBeenLastCalledWith("batman", expect.objectContaining({ cwd: "C:/code/proj", model: "claude-opus-5-5" }), "new");
  });

  it("never lets an agent whose own router is off veto the Fleet's: the mission's router still starts it on its level", async () => {
    await setup({ router: true, plan: [{ ...plan[0], level: "moyen" }, { ...plan[1], level: "faible" }] });
    nodesStore.getState().update("batman", { router: undefined, model: "claude-opus-5-5" });
    await launchMission("chef");
    expect(terminalOf(nodesStore.getState().nodes.batman)?.model).toBe("claude-sonnet-5-5");
  });

  it("leaves the models alone without the router", async () => {
    await setup({ plan: [{ ...plan[0], level: "eleve" }, { ...plan[1], level: "faible" }] });
    await launchMission("chef");
    expect(vi.mocked(addTerminal).mock.calls[0][1].model).toBeUndefined();
    expect(terminalOf(nodesStore.getState().nodes.batman)?.model).toBeUndefined();
    expect(missionNow().members.map((m) => m.model)).toEqual([undefined, undefined]);
  });

  it("keeps a linked agent's own model through its sub-task and after it when its own switch is off, the mission's on", async () => {
    await setup({ router: true, plan: [{ ...plan[0], level: "faible" }, { ...plan[1], level: "faible" }] });
    nodesStore.getState().update("batman", { router: false, model: "claude-opus-5-5" });
    await launchMission("chef");
    expect(relaunchTerminal).toHaveBeenCalledWith("batman", expect.objectContaining({ model: "claude-opus-5-5" }), "new");
    expect(missionNow().members.map((m) => m.model)).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
    endMission("chef", "Fini.");
    expect(terminalOf(nodesStore.getState().nodes.batman)).toMatchObject({ model: "claude-opus-5-5", router: false });
    expect(relaunchTerminal).toHaveBeenLastCalledWith("batman", expect.objectContaining({ cwd: "C:/code/proj", model: "claude-opus-5-5" }), "new");
  });

  it("follows Settings' router while the Fleet's switch is unset: levels are needed, and the team takes their models", async () => {
    modelRouterStore.setState({ on: true });
    await setup({});
    await launchMission("chef");
    expect(missionPrepare).not.toHaveBeenCalled();
    expect(missionNow()).toMatchObject({ state: "plan", error: expect.stringContaining("level") });
    await setup({ plan: [{ ...plan[0], level: "eleve" }, { ...plan[1], level: "faible" }] });
    await launchMission("chef");
    expect(missionNow().members.map((m) => m.model)).toEqual(["claude-opus-5-5", "claude-haiku-5-5"]);
  });

  it("starts no agent on a level's model once the Fleet's switch is set off, Settings' router on", async () => {
    modelRouterStore.setState({ on: true });
    await setup({ router: false, plan: [{ ...plan[0], level: "eleve" }, { ...plan[1], level: "faible" }] });
    await launchMission("chef");
    expect(missionNow().members.map((m) => m.model)).toEqual([undefined, undefined]);
    expect(vi.mocked(addTerminal).mock.calls[0][1].model).toBeUndefined();
  });
});

describe("launchMission", () => {
  it("forms the team: a worktree each, linked agents relaunched there anew, new ones under the board's Manager", async () => {
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    await launchMission("chef");
    const mission = missionNow();
    const fresh = mission.members[1].name;
    expect(missionPrepare).toHaveBeenCalledWith("C:/code/proj", "Auth");
    expect(vi.mocked(missionAddAgent).mock.calls).toEqual([
      ["C:/code/proj", "auth", "Batman"],
      ["C:/code/proj", "auth", fresh],
    ]);
    const batman = terminalOf(nodesStore.getState().nodes.batman)!;
    expect(batman.cwd).toBe("C:/code/proj.worktrees/auth-batman");
    expect(batman.claudeSessionId).not.toBe("old");
    expect(batman.steps).toBeUndefined();
    expect(relaunchTerminal).toHaveBeenCalledWith("batman", expect.objectContaining({ cwd: batman.cwd, claudeSessionId: batman.claudeSessionId }), "new");
    // The board and its Manager come into view (the user just asked for them); the new agents are the Manager's sub-agents.
    expect(setUpBoard).toHaveBeenCalledWith("chef", "w1", expect.objectContaining({ name: "Auth" }), "claude", inView, expect.any(String));
    expect(addTerminal).toHaveBeenCalledWith(
      "w1",
      expect.objectContaining({ name: fresh, cwd: tree(`auth-${fresh.toLowerCase()}`).path, spawnedBy: "m1", task: "API" }),
      expect.anything(),
      null,
      quiet,
    );
    expect(launchGroup).not.toHaveBeenCalled();
    expect(linkFleet).not.toHaveBeenCalled();
    expect(mission).toMatchObject({ state: "en_cours", project: "C:/code/proj", slug: "auth", branch: "dummyplane/auth", manager: "m1", board: "b1" });
    expect(mission.frameId).toBeUndefined();
    expect(mission.startedAt).toEqual(expect.any(Number));
    expect(mission.members.map((m) => [m.nodeId, m.linked, m.branch])).toEqual([
      ["batman", true, "dummyplane/auth-batman"],
      ["n1", false, tree(`auth-${fresh.toLowerCase()}`).branch],
    ]);
    // The Manager gets its orders; the Fleet hears nothing of the team.
    expect(vi.mocked(notify).mock.calls[0]).toEqual(["m1", expect.stringContaining('You run the mission "Auth" for Chef')]);
    expect(vi.mocked(notify).mock.calls.some(([id]) => id === "chef")).toBe(false);
    await vi.waitFor(() => expect(missionNow().members.every((m) => m.sentAt !== undefined)).toBe(true));
    expect(ptySendText).toHaveBeenCalledWith("batman", subTaskText("Auth", plan[0], "dummyplane/auth-batman"));
    expect(ptySendText).toHaveBeenCalledWith("n1", subTaskText("Auth", plan[1], tree(`auth-${fresh.toLowerCase()}`).branch));
  });

  it("starts Max agents at the go-ahead, the plan's other sub-tasks first in the queue for a seat", async () => {
    const three = ["A", "B", "C"].map((title) => ({ ...plan[1], title }));
    const lint = { title: "Lint", brief: "Lance le lint", budgetMin: 5 };
    await setup({ maxAgents: 2, plan: three, queue: [lint] });
    vi.mocked(addTerminal).mockResolvedValueOnce("n1").mockResolvedValueOnce("n2");
    terminalStatusStore.getState().set("n2", { state: "running" });
    await launchMission("chef");
    const mission = missionNow();
    expect(missionAddAgent).toHaveBeenCalledTimes(2);
    expect(vi.mocked(addTerminal).mock.calls.map(([, payload]) => payload.name)).toEqual(mission.members.map((m) => m.name));
    expect(mission.members.map((m) => [m.nodeId, m.task])).toEqual([
      ["n1", "A"],
      ["n2", "B"],
    ]);
    expect(mission.plan).toEqual(three.slice(0, 2));
    // The queue names no agent; the plan's rest goes before what was already waiting.
    expect(mission.queue).toEqual([{ title: "C", brief: plan[1].brief, budgetMin: 30 }, lint]);
    expect(mission.queue?.[0]).not.toHaveProperty("agent");
    await vi.waitFor(() => expect(missionNow().members.every((m) => m.sentAt !== undefined)).toBe(true));
    expect(ptySendText).toHaveBeenCalledWith("n1", subTaskText("Auth", three[0], mission.members[0].branch));
    expect(ptySendText).toHaveBeenCalledWith("n2", subTaskText("Auth", three[1], mission.members[1].branch));
    expect(ptySendText).toHaveBeenCalledTimes(2);
    // Every seat taken: no new agent for the queue.
    expect(missionAddAgent).toHaveBeenCalledTimes(2);
  });

  it("keeps a sub-task that waits for others in the queue at the go-ahead, whatever its place in the plan: the seats go to the others", async () => {
    // B waits for A: it would take the second seat by its place, but starts from the queue once A is done and merged.
    const waits = [{ ...plan[1], title: "A" }, { ...plan[1], title: "B", waitsFor: ["A"] }, { ...plan[1], title: "C" }];
    await setup({ maxAgents: 2, plan: waits });
    vi.mocked(addTerminal).mockResolvedValueOnce("n1").mockResolvedValueOnce("n2");
    terminalStatusStore.getState().set("n2", { state: "running" });
    await launchMission("chef");
    const mission = missionNow();
    expect(mission.members.map((m) => m.task)).toEqual(["A", "C"]);
    expect(mission.plan?.map((task) => task.title)).toEqual(["A", "C"]);
    expect(mission.queue).toEqual([{ title: "B", brief: plan[1].brief, budgetMin: 30, waitsFor: ["A"] }]);
  });

  it("judges a linked agent ready only once it is relaunched in its worktree (final review H2)", async () => {
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    let relaunched!: () => void;
    vi.mocked(relaunchTerminal).mockReturnValueOnce(new Promise<void>((resolve) => (relaunched = resolve)));
    await launchMission("chef");
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n1", expect.any(String)));
    expect(whenReady).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ptySendText).mock.calls.some(([id]) => id === "batman")).toBe(false);
    relaunched();
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("batman", expect.any(String)));
    expect(whenReady).toHaveBeenCalledTimes(2);
  });

  it("lights the wire down from the Manager to an agent once its sub-task is typed (wire activity)", async () => {
    clearWirePulses();
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    await launchMission("chef");
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n1", expect.any(String)));
    await vi.waitFor(() => expect(wireActivityStore.getState().pulses.n1).toMatchObject({ direction: "toAgent", fleetId: "m1" }));
    clearWirePulses();
  });

  it("does not launch once Max agents was lowered under a linked agent's sub-task: it would go to the queue, to a new agent, unsaid", async () => {
    // Proposed with Max agents at 4: Batman's sub-task, second, started at the go-ahead. The user then set 1.
    await setup({ maxAgents: 1, plan: [plan[1], plan[0]] });
    await launchMission("chef");
    const error = 'Sub-task 2: only the first 1 sub-tasks start at the go-ahead (Max active agents), the rest wait in the queue for a new agent: give it agent "new".';
    expect(missionNow()).toMatchObject({ state: "plan", error, members: [] });
    expect(missionNow()).not.toHaveProperty("queue");
    expect(notify).toHaveBeenCalledWith("chef", `The mission could not start: ${error}`);
    expect(missionPrepare).not.toHaveBeenCalled();
  });

  it("takes a mission whose git fails back to its plan, with the error, and launches no one", async () => {
    await setup();
    vi.mocked(missionPrepare).mockRejectedValueOnce(new Error("The project folder is not a git repository."));
    await launchMission("chef");
    expect(missionNow()).toMatchObject({ state: "plan", error: "The project folder is not a git repository.", members: [] });
    expect(notify).toHaveBeenCalledWith("chef", "The mission could not start: The project folder is not a git repository.");
    vi.mocked(missionAddAgent).mockResolvedValueOnce(tree("auth-batman")).mockRejectedValueOnce(new Error("La branche dummyplane/auth-x existe déjà."));
    await launchMission("chef");
    expect(missionNow()).toMatchObject({ state: "plan", error: "La branche dummyplane/auth-x existe déjà." });
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(launchGroup).not.toHaveBeenCalled();
  });

  it("forms one team for two go-aheads in a row", async () => {
    await setup();
    let release!: (tree: Worktree) => void;
    vi.mocked(missionPrepare).mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const first = launchMission("chef");
    await launchMission("chef");
    expect(missionNow().state).toBe("lancement");
    release(tree("auth"));
    await first;
    expect(missionPrepare).toHaveBeenCalledTimes(1);
    expect(setUpBoard).toHaveBeenCalledTimes(1);
  });

  it("types no sub-task into the shell of an agent whose Claude never got ready (README mission)", async () => {
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    // Its terminal still runs: the shell outlived a Claude that exited at its trust prompt.
    vi.mocked(whenReady).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await launchMission("chef");
    await vi.waitFor(() => expect(vi.mocked(notify).mock.calls.filter(([, text]) => text.includes("is not ready"))).toHaveLength(2));
    expect(ptySendText).not.toHaveBeenCalled();
  });

  it("still types the sub-task of an agent whose Claude opens past the minute, once, and its report is then the mission's", async () => {
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    // A question only the user answers (a project's new MCP server) holds both Claudes past the minute.
    const late: typeof whenReady = async (probe) => {
      expect(probe.waitLonger?.()).toBe(true);
      probe.slow?.();
      await opened;
      return true;
    };
    vi.mocked(whenReady).mockImplementationOnce(late).mockImplementationOnce(late);
    await launchMission("chef");
    await vi.waitFor(() => expect(vi.mocked(notify).mock.calls.filter(([id, text]) => id === "m1" && text.includes("has not opened after a minute"))).toHaveLength(2));
    // Meanwhile: nothing typed, its report would not be the mission's, and the Manager's write would cross it.
    expect(ptySendText).not.toHaveBeenCalled();
    expect(memberOf("n1")).toBeNull();
    expect(deliveryPending("n1")).toBe(true);
    open();
    await vi.waitFor(() => expect(missionNow().members.every((m) => m.sentAt !== undefined)).toBe(true));
    expect(vi.mocked(ptySendText).mock.calls.map(([id]) => id).sort()).toEqual(["batman", "n1"]);
    expect(memberOf("n1")?.member.nodeId).toBe("n1");
    expect(deliveryPending("n1")).toBe(false);
    expect(notify).toHaveBeenCalledWith("m1", expect.stringContaining("its sub-task is sent now"));
  });

  it("shows a member a dialog holds as waiting, its Manager not told at the minute, and types its sub-task once when it opens (issues #3, #14)", async () => {
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    const held: typeof whenReady = async (probe) => {
      probe.held?.({ kind: "mcp", title: "8 new MCP servers found in this project", options: ["Enable selected"] });
      probe.slow?.();
      await opened;
      probe.held?.(null);
      return true;
    };
    vi.mocked(whenReady).mockImplementationOnce(held).mockImplementationOnce(held);
    await launchMission("chef");
    await vi.waitFor(() => expect(agentActivityStore.getState().activities.n1?.activity).toBe("waiting"));
    expect(ptySendText).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith("m1", expect.stringContaining("has not opened after a minute"));
    open();
    await vi.waitFor(() => expect(missionNow().members.every((m) => m.sentAt !== undefined)).toBe(true));
    expect(vi.mocked(ptySendText).mock.calls.map(([id]) => id).sort()).toEqual(["batman", "n1"]);
    expect(agentActivityStore.getState().activities.n1?.activity).not.toBe("waiting");
    expect(vi.mocked(notify).mock.calls.filter(([id, text]) => id === "m1" && text.includes("its sub-task is sent now"))).toHaveLength(2);
  });

  it("types nothing past the minute once the Manager gave the sub-task by hand, nor to an agent handed away", async () => {
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    const late: typeof whenReady = async () => {
      await opened;
      return true;
    };
    vi.mocked(whenReady).mockImplementationOnce(late).mockImplementationOnce(late);
    await launchMission("chef");
    // Batman got it by hand (dummyPlane restarted since, say); n1's sub-task went to another agent.
    updateMember("chef", "batman", { sentAt: 5 });
    updateMember("chef", "n1", { handedTo: "Shazam" });
    open();
    await vi.waitFor(() => expect(deliveryPending("batman") || deliveryPending("n1")).toBe(false));
    expect(ptySendText).not.toHaveBeenCalled();
    expect(missionNow().members.find((m) => m.nodeId === "batman")?.sentAt).toBe(5);
  });

  it("tells the Manager when an agent did not start, instead of typing into nothing", async () => {
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    terminalStatusStore.getState().set("n1", { state: "stopped" });
    await launchMission("chef");
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("m1", expect.stringContaining("did not start")));
    expect(vi.mocked(ptySendText).mock.calls.some(([id]) => id === "n1")).toBe(false);
  });
});

describe("a new agent in a chosen group", () => {
  const front = { id: "g1", name: "Interface", x: 100, y: 100, width: 200, height: 100, memberIds: [], group: { role: "frontend" as const, pantheon: "norse", speciality: "Frontend" } };
  const inFront = { ...plan[1], group: { id: "g1", name: "Interface" } };

  beforeEach(() => {
    canvasStore.setState({ frames: [front], links: { chef: { groupIds: ["g1"], nodeIds: [] } } });
    terminalStatusStore.getState().set("n9", { state: "running" });
  });

  it("joins the group with a name of its pantheon, in its worktree, and gets its sub-task", async () => {
    await setup({ router: true, plan: [{ ...inFront, level: "faible" }] });
    await launchMission("chef");
    const mission = missionNow();
    const joined = mission.members[0];
    expect(launchGroup).not.toHaveBeenCalled();
    expect(joined).toMatchObject({ nodeId: "n9", name: nextName("norse", ["Batman"]), linked: false, group: "g1" });
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.objectContaining({ name: joined.name, cwd: joined.worktree, agent: "claude", model: "claude-haiku-5-5" }), { x: 200, y: 150 }, "g1", inView);
    expect(mission.frameId).toBeUndefined();
    expect(showGroups).toHaveBeenCalledWith(["g1"]);
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n9", expect.stringContaining("API")));
  });

  it("puts the others under the Manager and shows the group, each name unique", async () => {
    await setup({ plan: [plan[0], plan[1], inFront, { ...inFront, title: "Style" }] });
    vi.mocked(addTerminal).mockResolvedValueOnce("n1").mockResolvedValueOnce("n9").mockResolvedValueOnce("n8");
    terminalStatusStore.getState().set("n8", { state: "running" });
    await launchMission("chef");
    expect(launchGroup).not.toHaveBeenCalled();
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.objectContaining({ spawnedBy: "m1", task: "API" }), expect.anything(), null, quiet);
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.not.objectContaining({ spawnedBy: "m1" }), { x: 200, y: 150 }, "g1", inView);
    expect(missionNow().members.map((m) => m.nodeId)).toEqual(["batman", "n1", "n9", "n8"]);
    expect(new Set(missionNow().members.map((m) => m.name)).size).toBe(4);
    expect(showGroups).toHaveBeenCalledWith(["g1"]);
    expect(missionNow().frameId).toBeUndefined();
  });

  it("forms the team quietly when the user is typing by then: nothing framed, the agents arrive where they are", async () => {
    await setup({ plan: [plan[0], plan[1], inFront, { ...inFront, title: "Style" }] });
    vi.mocked(addTerminal).mockResolvedValueOnce("n1").mockResolvedValueOnce("n9").mockResolvedValueOnce("n8");
    terminalStatusStore.getState().set("n8", { state: "running" });
    vi.mocked(userIsTyping).mockReturnValue(true);
    await launchMission("chef");
    expect(setUpBoard).toHaveBeenCalledWith("chef", "w1", expect.anything(), "claude", quiet, expect.any(String));
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.anything(), { x: 200, y: 150 }, "g1", quiet);
    expect(addTerminal).toHaveBeenCalledTimes(3);
    expect(showGroups).not.toHaveBeenCalled();
    // The mission still runs: the team is there, and its sub-tasks are sent.
    expect(missionNow().state).toBe("en_cours");
    expect(missionNow().members.map((m) => m.nodeId)).toEqual(["batman", "n1", "n9", "n8"]);
  });

  it("frames nothing more when nobody joins a group, as before", async () => {
    await setup();
    await launchMission("chef");
    expect(addTerminal).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), "g1", expect.anything());
    expect(showGroups).not.toHaveBeenCalled();
  });

  it("does not start when the group is no longer linked, before any git work", async () => {
    await setup({ plan: [inFront] });
    canvasStore.setState({ links: {} });
    await launchMission("chef");
    expect(missionNow()).toMatchObject({ state: "plan", error: "The group Interface is no longer linked to the fleet." });
    expect(missionPrepare).not.toHaveBeenCalled();
  });

  it("does not start when the group goes during the git work, and takes the worktrees back", async () => {
    await setup({ plan: [inFront] });
    vi.mocked(missionPrepare).mockImplementationOnce(async () => {
      canvasStore.setState({ frames: [] });
      return tree("auth");
    });
    await launchMission("chef");
    expect(missionNow()).toMatchObject({ state: "plan", error: "The group Interface is no longer linked to the fleet." });
    expect(addTerminal).not.toHaveBeenCalled();
    expect(missionDiscard).toHaveBeenCalled();
  });

  it("does not start when the group goes while the board is set up: no member without a terminal (final review)", async () => {
    await setup({ plan: [plan[1], inFront] });
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    vi.mocked(setUpBoard).mockImplementationOnce(async () => {
      canvasStore.setState({ frames: [] });
      return { boardId: "b1", boardMade: true, managerId: "m1", managerMade: true };
    });
    await launchMission("chef");
    expect(missionNow()).toMatchObject({ state: "plan", error: "The group Interface is no longer linked to the fleet.", members: [] });
    expect(removeNodes).toHaveBeenCalledWith(["n1"]);
    expect(undoSetup).toHaveBeenCalledWith("chef", "w1", { boardId: "b1", boardMade: true, managerId: "m1", managerMade: true });
    expect(missionDiscard).toHaveBeenCalled();
  });

  it("takes back what it created when an agent cannot join, so no terminal sits in a removed worktree", async () => {
    await setup({ plan: [plan[1], inFront, { ...inFront, title: "Style" }] });
    vi.mocked(addTerminal).mockResolvedValueOnce("n1").mockResolvedValueOnce("n9").mockResolvedValueOnce(null);
    await launchMission("chef");
    expect(missionNow().state).toBe("plan");
    expect(missionNow().manager).toBeUndefined();
    expect(undoSetup).toHaveBeenCalled();
    expect(removeNodes).toHaveBeenCalledWith(["n1", "n9"]);
    expect(missionDiscard).toHaveBeenCalled();
    expect(relaunchTerminal).not.toHaveBeenCalled();
  });

  it("closes it at the end, the group and its own agents staying", async () => {
    await setup({ state: "en_cours", project: "C:/code/proj", members: [member("n9", "Thor", false, { group: "g1" })] });
    endMission("chef", "Fini.");
    expect(removeNodes).toHaveBeenCalledWith(["n9"]);
    expect(closeGroup).not.toHaveBeenCalled();
  });

  it("closes both kinds at the end of a mixed team", async () => {
    await setup({ state: "en_cours", project: "C:/code/proj", frameId: "f1", members: [member("n1", "Aquaman", false), member("n9", "Thor", false, { group: "g1" })] });
    endMission("chef", "Fini.");
    expect(closeGroup).toHaveBeenCalledWith("f1");
    expect(removeNodes).toHaveBeenCalledWith(["n9"]);
  });

  it("only stops it when the mission ends away from its workspace", async () => {
    await setup({ state: "en_cours", project: "C:/code/proj", members: [member("n9", "Thor", false, { group: "g1" })] });
    workspacesStore.setState({ activeId: "w2" });
    endMission("chef", "Fini.");
    expect(removeNodes).not.toHaveBeenCalled();
    expect(stopTerminal).toHaveBeenCalledWith("n9");
  });

  it("does not give a new agent the name of a member gone from the canvas: its branch is still there (review)", async () => {
    const gone = nextName("norse", []);
    const running = { state: "en_cours" as const, project: "C:/code/proj", slug: "auth", plan: [{ ...inFront, title: "t" }], members: [member("n7", gone, false, { group: "g1" })] };
    await setup(running);
    // At work: its successor gets a worktree and branch of its own (a stopped one's would take over its own).
    terminalStatusStore.getState().set("n7", { state: "running" });
    canvasStore.setState({ api: { getSceneElementsIncludingDeleted: () => [] } as never, frames: [front] });
    const first = await reassignTask("chef", "n7", "nouveau");
    const asked = vi.mocked(missionAddAgent).mock.calls.map(([, , name]) => name);
    expect(asked).toHaveLength(1);
    expect(asked).not.toContain(gone);
    expect(first).toEqual({ name: asked[0] });
    canvasStore.setState({ api: null });
  });

  it("sends a new agent taking over its sub-task to the same group, else the mission's", async () => {
    const running = { state: "en_cours" as const, project: "C:/code/proj", slug: "auth", plan: [{ ...inFront, title: "t" }], members: [member("n7", "Thor", false, { group: "g1" })] };
    await setup(running);
    await reassignTask("chef", "n7", "nouveau");
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.anything(), { x: 200, y: 150 }, "g1", quiet);
    expect(missionNow().members.find((m) => m.nodeId === "n9")).toMatchObject({ group: "g1" });

    nodesStore.setState({ nodes: {} });
    await setup({ ...running, frameId: "m1" });
    canvasStore.setState({ frames: [{ ...front, id: "m1" }] });
    vi.mocked(addTerminal).mockClear();
    await reassignTask("chef", "n7", "nouveau");
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.anything(), { x: 200, y: 150 }, "m1", quiet);
    expect(missionNow().members.find((m) => m.nodeId === "n9")?.group).toBeUndefined();
  });
});

describe("a mission whose workspace is not on screen", () => {
  const wired = [
    { id: "chef", type: "embeddable", isDeleted: false, frameId: null, x: 0, y: 0, width: 640, height: 760, customData: { kind: STORED_FLEET_KIND } },
    { id: "batman", type: "embeddable", isDeleted: false, frameId: null, x: 0, y: 0, width: 10, height: 10, customData: { kind: "terminal" } },
  ];

  beforeEach(() => {
    workspacesStore.setState({ activeId: "w2" });
    rememberScene("w1", wired as never, {} as never, {}, []);
  });
  afterEach(() => forgetScene("w1"));

  it("forms the team in the stored scene, the view left alone", async () => {
    await setup({ plan: [plan[1], { ...plan[1], title: "Style", group: { id: "g1", name: "Interface" } }] });
    rememberScene("w1", [...wired, { id: "g1", type: "frame", name: "Interface", x: 0, y: 0, width: 800, height: 500, isDeleted: false, frameId: null, customData: { dummyplane: { kind: "group", role: "frontend", pantheon: "norse" } } }, { id: "w", type: "arrow", isDeleted: false, frameId: null, startBinding: { elementId: "chef" }, endBinding: { elementId: "g1" } }] as never, {} as never, {}, []);
    await launchMission("chef");
    expect(missionNow().state).toBe("en_cours");
    expect(setUpBoard).toHaveBeenCalledWith("chef", "w1", expect.anything(), "claude", inView, expect.any(String));
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.objectContaining({ spawnedBy: "m1" }), expect.anything(), null, quiet);
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.anything(), { x: 400, y: 250 }, "g1", inView);
    expect(showGroups).not.toHaveBeenCalled();
    expect(linkFleet).not.toHaveBeenCalled();
  });

  it("closes the created agents in the stored scene at the end, the group that a member joined staying", async () => {
    await setup({ state: "en_cours", project: "C:/code/proj", frameId: "f1", members: [member("batman", "Batman", true), member("n1", "Aquaman", false), member("n9", "Thor", false, { group: "g1" })] });
    endMission("chef", "Fini.");
    expect(closeStoredGroup).toHaveBeenCalledWith("w1", "f1");
    expect(removeFromStoredScene).toHaveBeenCalledWith("w1", new Set(["n9"]));
    expect(closeGroup).not.toHaveBeenCalled();
    expect(removeNodes).not.toHaveBeenCalled();
    expect(stopTerminal).not.toHaveBeenCalled();
    expect(relaunchTerminal).toHaveBeenCalledWith("batman", expect.objectContaining({ cwd: "C:/code/proj" }), "new");
  });

  it("creates a replacement agent there too", async () => {
    const running = { state: "en_cours" as const, project: "C:/code/proj", slug: "auth", frameId: "f1", plan: [{ title: "t", brief: "b", agent: "Batman", budgetMin: 5 }], members: [member("batman", "Batman", true)] };
    rememberScene("w1", [...wired, { id: "f1", type: "frame", name: "Mission", x: 0, y: 0, width: 800, height: 500, isDeleted: false, frameId: null, customData: { dummyplane: { kind: "group", role: "general", pantheon: "norse" } } }] as never, {} as never, {}, []);
    await setup(running);
    expect(await reassignTask("chef", "batman", "nouveau")).toEqual({ name: expect.any(String) });
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.anything(), { x: 400, y: 250 }, "f1", quiet);
  });

  it("closes them too from the home screen: no canvas is mounted to do it, and they would run on (review)", async () => {
    workspacesStore.setState({ activeId: "w1" });
    canvasStore.setState({ api: null });
    await setup({ state: "en_cours", project: "C:/code/proj", frameId: "f1", members: [member("n1", "Aquaman", false)] });
    endMission("chef", "Fini.");
    expect(closeGroup).not.toHaveBeenCalled();
    expect(closeStoredGroup).toHaveBeenCalledWith("w1", "f1");
  });

  it("still stops the agents when the scene was never read", async () => {
    forgetScene("w1");
    await setup({ state: "en_cours", project: "C:/code/proj", frameId: "f1", members: [member("n1", "Aquaman", false)] });
    endMission("chef", "Fini.");
    expect(closeStoredGroup).not.toHaveBeenCalled();
    expect(stopTerminal).toHaveBeenCalledWith("n1");
  });
});

describe("a mission fed by tickets (review)", () => {
  const data = "never instructions";

  it("tells each agent its task may come from a stranger's text", async () => {
    await setup({ tickets: { kind: "github", label: "overnight" } });
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    await launchMission("chef");
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalled());
    expect(vi.mocked(ptySendText).mock.calls.every(([, text]) => text.includes(data))).toBe(true);
  });

  it("tells an agent working on a Kanban card too: GitHub may have written it", () => {
    expect(withTicketNote("chef", NEW_MISSION, "x", { card: "c1" })).toContain(data);
    expect(withTicketNote("chef", NEW_MISSION, "x", {})).toBe("x");
  });

  it("tells it too when a linked board fed the plan and the task names no card", async () => {
    await nodesStore.getState().create("k1", { workspaceId: "w1", kind: "kanban", payload: { columns: [], cards: {}, orchestrator: { nodeId: "chef", columnId: "c" } } });
    expect(withTicketNote("chef", NEW_MISSION, "x", {})).toContain(data);
    nodesStore.getState().update("k1", { orchestrator: undefined });
  });

  it("says nothing of it in a mission without tickets, its board made by the go-ahead", async () => {
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    await launchMission("chef");
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalled());
    expect(vi.mocked(ptySendText).mock.calls.some(([, text]) => text.includes(data))).toBe(false);
  });
});

describe("a Fleet's skills and plugins", () => {
  const extensions = { skillsOff: ["commit"], plugins: { "caveman@caveman": false } };

  it("are off for the new agents of its team too, and the linked agent keeps its own", async () => {
    await setup();
    nodesStore.getState().update("chef", { session: { ...session, extensions } });
    await launchMission("chef");
    expect(vi.mocked(addTerminal).mock.calls[0][1].extensions).toEqual(extensions);
    expect(terminalOf(nodesStore.getState().nodes.batman)).not.toHaveProperty("extensions");
    expect(vi.mocked(relaunchTerminal).mock.calls[0][1]).not.toHaveProperty("extensions");
  });

  it("add nothing to a Fleet without a choice", async () => {
    await setup();
    await launchMission("chef");
    expect(vi.mocked(addTerminal).mock.calls[0][1]).not.toHaveProperty("extensions");
  });
});

describe("a mission's permissions", () => {
  it("reach every agent of the team, and leave the linked ones at the end", async () => {
    await setup({ permission: "work" });
    await launchMission("chef");
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.objectContaining({ permission: "work", spawnedBy: "m1" }), expect.anything(), null, quiet);
    expect(terminalOf(nodesStore.getState().nodes.batman)?.permission).toBe("work");
    expect(relaunchTerminal).toHaveBeenCalledWith("batman", expect.objectContaining({ permission: "work" }), "new");
    endMission("chef", "Fini.");
    expect(terminalOf(nodesStore.getState().nodes.batman)?.permission).toBeUndefined();
    expect(relaunchTerminal).toHaveBeenLastCalledWith("batman", expect.objectContaining({ permission: undefined }), "new");
  });

  it("add nothing to a mission without a choice", async () => {
    await setup();
    await launchMission("chef");
    expect(terminalOf(nodesStore.getState().nodes.batman)?.permission).toBeUndefined();
    expect(vi.mocked(addTerminal).mock.calls[0][1].permission).toBeUndefined();
  });
});

it("ends the mission: created agents closed, linked ones back in the project in a new conversation", async () => {
  await setup({ state: "en_cours", project: "C:/code/proj", frameId: "f1", members: [member("batman", "Batman", true), member("n1", "Aquaman", false)] });
  vi.spyOn(Date, "now").mockReturnValue(1_234_567);
  const heard: FinishSignal[] = [];
  const unlisten = onFinish((signal) => heard.push(signal));
  endMission("chef", "Tout est fait.");
  endMission("chef", "Encore.");
  unlisten();
  vi.mocked(Date.now).mockRestore();
  // The user hears it once, if away (`@/shell/finishAlert`).
  expect(heard).toEqual([{ nodeId: "chef", state: "done", summary: "Tout est fait." }]);
  expect(missionNow()).toMatchObject({ state: "terminee", summary: "Tout est fait.", endedAt: 1_234_567 });
  expect(relaunchTerminal).toHaveBeenCalledWith("batman", expect.objectContaining({ cwd: "C:/code/proj" }), "new");
  expect(closeGroup).toHaveBeenCalledWith("f1");
});

it("merges the branches of the agents done, and says what happened to each", async () => {
  const done = { summary: "ok", status: "termine" as const, at: 1 };
  await setup({
    state: "en_cours",
    worktree: "C:/w/auth",
    branch: "dummyplane/auth",
    members: [member("batman", "Batman", true, { report: done }), member("n1", "Aquaman", false, { report: done }), member("n2", "Flash", false, { report: { ...done, status: "bloque" } })],
  });
  vi.mocked(missionMerge).mockImplementation(async (_mission, _agent, branch) =>
    branch.endsWith("batman") ? { merge: { kind: "merged" }, uncommitted: true, head: "c0ffee" } : { merge: { kind: "conflict", files: ["a.ts"] }, uncommitted: false, head: "c0ffee" },
  );
  // Flash reported "blocked": left out, and named with why, never silently (#12).
  expect(await mergeMission("chef")).toBe(`Branch dummyplane/auth:\nBatman: merged (uncommitted changes in its worktree are not merged: ask it to commit them, then merge again)\nAquaman: conflict, merge undone — a.ts. Not retried by itself: ask Aquaman to merge the mission's branch into its own, resolve and commit; its branch is merged again when it reports, or with merge and agent set to Aquaman.\nNot merged: Flash (blocked).`);
  expect(vi.mocked(missionMerge).mock.calls.map(([mission, agent, branch]) => [mission, agent, branch])).toEqual([
    ["C:/w/auth", "C:/w/batman", "dummyplane/auth-batman"],
    ["C:/w/auth", "C:/w/n1", "dummyplane/auth-n1"],
  ]);
  expect(missionNow().members.map((m) => m.merged === true)).toEqual([true, false, false]);
});

it("leaves out an agent fixing its own merge conflict, says so, and merges it once it reports again or merge names it (#12)", async () => {
  const done = { summary: "ok", status: "termine" as const, at: 1 };
  await setup({
    state: "en_cours",
    worktree: "C:/w/auth",
    branch: "dummyplane/auth",
    members: [member("n1", "Aquaman", false, { report: done, conflictAt: 1 }), member("n2", "Flash", false, { report: done })],
  });
  vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "merged" }, uncommitted: false, head: "c0ffee" });
  // A retry now would undo its resolution mid-way: it is left out, and named with why.
  expect(await mergeMission("chef")).toBe(
    "Branch dummyplane/auth:\nFlash: merged\nNot merged: Aquaman (fixing its merge conflict: merged when it reports again, or with merge and agent set to its name).",
  );
  expect(vi.mocked(missionMerge).mock.calls.map(([, agent]) => agent)).toEqual(["C:/w/n2"]);
  // Nothing else done: the same line, never a silent "nothing to merge".
  setMission("chef", { members: [member("n1", "Aquaman", false, { report: done, conflictAt: 1 })] });
  expect(await mergeMission("chef")).toBe("Not merged: Aquaman (fixing its merge conflict: merged when it reports again, or with merge and agent set to its name).");
  // The Manager names it once it says it is fixed: merged, its conflict forgotten.
  await mergeMission("chef", "n1");
  expect(vi.mocked(missionMerge).mock.calls.map(([, agent]) => agent)).toEqual(["C:/w/n2", "C:/w/n1"]);
  expect(missionNow().members[0]).toMatchObject({ merged: true });
  expect(missionNow().members[0].conflictAt).toBeUndefined();
});

it("remembers which report's merge conflicted: its next report clears the hold", async () => {
  const done = { summary: "ok", status: "termine" as const, at: 7 };
  await setup({ state: "en_cours", worktree: "C:/w/auth", branch: "dummyplane/auth", members: [member("n1", "Aquaman", false, { report: done })] });
  vi.mocked(missionMerge).mockResolvedValueOnce({ merge: { kind: "conflict", files: ["CHANGELOG.md"] }, uncommitted: false, head: "c0ffee" });
  await mergeMission("chef");
  expect(missionNow().members[0].conflictAt).toBe(7);
  expect(conflictPending(missionNow().members[0])).toBe(true);
  updateMember("chef", "n1", { report: { ...done, at: 8 } });
  expect(conflictPending(missionNow().members[0])).toBe(false);
});

it("squashes an agent's work under its sub-task and report, keeps the head taken in, and takes only what came after next time", async () => {
  const done = { summary: "Login form done.", status: "termine" as const, at: 1, check: "Try a wrong password" };
  await setup({ state: "en_cours", worktree: "C:/w/auth", branch: "dummyplane/auth", members: [member("n1", "Aquaman", false, { task: "Login", report: done })] });
  vi.mocked(missionMerge).mockResolvedValueOnce({ merge: { kind: "merged" }, uncommitted: false, head: "h1" });
  await mergeMission("chef");
  // One commit named after its sub-task, its report as the body: never a branch's name.
  expect(missionMerge).toHaveBeenLastCalledWith("C:/w/auth", "C:/w/n1", "dummyplane/auth-n1", "Login\n\nLogin form done.\n\nTo check by hand: Try a wrong password", undefined);
  expect(missionNow().members[0]).toMatchObject({ merged: true, squashed: "h1" });
  // New commits since: the next merge starts from the head the last one took in.
  vi.mocked(missionMerge).mockResolvedValueOnce({ merge: { kind: "merged" }, uncommitted: false, head: "h2" });
  await mergeMission("chef");
  expect(vi.mocked(missionMerge).mock.lastCall?.[4]).toBe("h1");
  expect(missionNow().members[0].squashed).toBe("h2");
});

it("cleans a finished mission and frees the fleet for the next, its settings kept", async () => {
  await setup({ state: "terminee", budgetMin: 90, maxAgents: 3, project: "C:/code/proj", slug: "auth", summary: "ok", members: [member("batman", "Batman", true)] });
  // An old global budget is no setting any more: the next mission does without it.
  vi.mocked(missionCleanup).mockResolvedValue({ removed: ["auth-batman", "auth"], kept: [] });
  expect(await cleanMission("chef")).toEqual({ removed: ["auth-batman", "auth"], kept: [], open: [] });
  expect(missionCleanup).toHaveBeenCalledWith("C:/code/proj", "auth", [{ name: "Batman" }], undefined, []);
  expect(missionNow()).toEqual({ state: "redaction", maxAgents: 3, members: [] });
});

it("joins a second cleanup to the one under way: one run of git, and no reset behind a plan drafted since", async () => {
  await setup({ state: "terminee", maxAgents: 3, project: "C:/code/proj", slug: "auth", summary: "ok", members: [member("batman", "Batman", true)] });
  let release: (done: { removed: string[]; kept: string[] }) => void = () => undefined;
  vi.mocked(missionCleanup).mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
  // The panel's click and the Fleet's own cleanup, while git works: the mission is still finished.
  const first = cleanMission("chef");
  const second = cleanMission("chef");
  expect(missionNow().state).toBe("terminee");
  release({ removed: ["auth-batman", "auth"], kept: [] });
  expect(await first).toEqual({ removed: ["auth-batman", "auth"], kept: [], open: [] });
  expect(await second).toEqual({ removed: ["auth-batman", "auth"], kept: [], open: [] });
  expect(missionCleanup).toHaveBeenCalledOnce();
  expect(missionNow()).toEqual({ state: "redaction", maxAgents: 3, members: [] });
  // A plan drafted now stands: nothing is left of the first run to reset it.
  setMission("chef", { state: "plan", name: "Next" });
  await Promise.resolve();
  expect(missionNow()).toMatchObject({ state: "plan", name: "Next" });
  // Once it is done a new call is a new one: this mission is no longer finished.
  expect(await cleanMission("chef")).toBe("The mission is not finished.");
  expect(missionCleanup).toHaveBeenCalledOnce();
});

it("takes the mission's permission back from its agents when its fleet closes: a later restart asks as usual (backlog)", async () => {
  const terminal = (name: string, permission?: "work") => ({ title: name, name, agent: "claude" as const, cwd: "C:/w", shell: "default" as const, command: "", ...(permission ? { permission } : {}) });
  const member = (nodeId: string, name: string) => ({ nodeId, name, task: "T", budgetMin: 10, linked: false, branch: "b", worktree: "w" });
  await nodesStore.getState().create("night", { workspaceId: "w1", kind: "fleet", payload: { name: "Night", mission: { ...NEW_MISSION, state: "en_cours", overnight: true, permission: "work", members: [member("a1", "Ra"), member("a2", "Nut")] } } });
  await nodesStore.getState().create("a1", { workspaceId: "w1", kind: "terminal", payload: terminal("Ra", "work") });
  await nodesStore.getState().create("a2", { workspaceId: "w1", kind: "terminal", payload: terminal("Nut") });
  await nodesStore.getState().create("other", { workspaceId: "w1", kind: "terminal", payload: terminal("Other", "work") });
  releaseTeamPermission("night");
  const permission = (id: string) => (nodesStore.getState().nodes[id]?.payload as { permission?: string }).permission;
  expect(permission("a1")).toBeUndefined();
  expect(permission("a2")).toBeUndefined();
  // Only the mission's agents: another terminal keeps what it was given.
  expect(permission("other")).toBe("work");
});

describe("the sub-agents a fleet opened with spawn_agent, which got its night's permission like its team", () => {
  const terminal = (name: string, spawnedBy?: string, permission?: "work") => ({ title: name, name, agent: "claude" as const, cwd: "C:/w", shell: "default" as const, command: "", ...(spawnedBy ? { spawnedBy } : {}), ...(permission ? { permission } : {}) });
  const permission = (id: string) => (nodesStore.getState().nodes[id]?.payload as { permission?: string }).permission;

  beforeEach(async () => {
    await setup({ state: "en_cours", overnight: true, permission: "work", project: "C:/code/proj", members: [] });
    // Cyborg was opened by the fleet, Raven by Cyborg; Zatanna by an agent outside the fleet.
    await nodesStore.getState().create("cyborg", { workspaceId: "w1", kind: "terminal", payload: terminal("Cyborg", "chef", "work") });
    await nodesStore.getState().create("raven", { workspaceId: "w1", kind: "terminal", payload: terminal("Raven", "cyborg", "work") });
    await nodesStore.getState().create("zatanna", { workspaceId: "w1", kind: "terminal", payload: terminal("Zatanna", "batman", "work") });
  });

  it("lose it when the fleet closes mid-mission: a later restart asks as usual", () => {
    releaseTeamPermission("chef");
    expect(permission("cyborg")).toBeUndefined();
    expect(permission("raven")).toBeUndefined();
    expect(permission("zatanna")).toBe("work");
  });

  it("lose it when the night ends, and stay open: they are not on the team", () => {
    endMission("chef", "Done.");
    expect(permission("cyborg")).toBeUndefined();
    expect(permission("raven")).toBeUndefined();
    expect(permission("zatanna")).toBe("work");
    expect(removeNodes).not.toHaveBeenCalledWith(expect.arrayContaining(["cyborg"]));
    expect(stopTerminal).not.toHaveBeenCalledWith("cyborg");
  });
});

it("puts the fleet back on its day session once a night is cleaned up: it asks again, without Linear", async () => {
  await setup({ state: "terminee", overnight: true, budgetMin: 480, project: "C:/code/proj", slug: "auth", members: [] });
  nodesStore.getState().update("chef", { session: { ...session, permission: "edits", linear: true } });
  vi.mocked(missionCleanup).mockResolvedValue({ removed: [], kept: [] });
  await cleanMission("chef");
  const fleet = sessionOf(nodesStore.getState().nodes.chef);
  expect(fleet?.permission).toBeUndefined();
  expect(fleet?.linear).toBeUndefined();
});

it("cleans the worktree of every agent of the mission, those the queue started in new terminals included", async () => {
  const members = [
    member("batman", "Batman", true, { report: { summary: "ok", status: "termine", at: 1 }, merged: true }),
    member("n1", "Aquaman", false, { report: { summary: "ko", status: "bloque", at: 2 }, abandoned: true }),
    member("n2", "Cyborg", false, { group: "g1" }),
  ];
  await setup({ state: "terminee", project: "C:/code/proj", slug: "auth", summary: "ok", members });
  // Aquaman's terminal stopped: it closes at once, nothing to wait for.
  terminalStatusStore.getState().set("n1", { state: "stopped" });
  vi.mocked(missionCleanup).mockResolvedValue({ removed: [], kept: [] });
  await cleanMission("chef");
  expect(missionCleanup).toHaveBeenCalledWith("C:/code/proj", "auth", [{ name: "Batman" }, { name: "Aquaman" }, { name: "Cyborg" }], undefined, []);
});

describe("the team's terminals at the mission's cleanup (#13)", () => {
  const terminal = (name: string, cwd: string, spawnedBy?: string) => ({ title: name, name, agent: "claude" as const, cwd, shell: "default" as const, command: "", ...(spawnedBy ? { spawnedBy } : {}) });
  const make = (id: string, name: string, cwd: string, spawnedBy?: string) => nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: terminal(name, cwd, spawnedBy) });
  afterEach(() => {
    vi.mocked(stopTerminal).mockReset();
    markLaunching("fresh", false);
    agentActivityStore.setState({ activities: {}, under: {} });
    // Their nodes leave the store: another test's agent named n1 would find them its sub-agents.
    const made = ["n1", "n2", "loki", "thoth", "fresh", "m1", "kid"];
    nodesStore.setState((state) => ({ nodes: Object.fromEntries(Object.entries(state.nodes).filter(([id]) => !made.includes(id))) }));
    for (const id of made) terminalStatusStore.getState().remove(id);
  });

  it("closes those that are done, leaves one at work, held by a dialog or launching open with its worktree, and says why", async () => {
    // A stop ends the process: the cleanup waits for it before git removes the folder it held.
    vi.mocked(stopTerminal).mockImplementation((id: string) => terminalStatusStore.getState().set(id, { state: "stopped" }));
    await setup({
      state: "terminee",
      project: "C:/code/proj",
      slug: "auth",
      summary: "ok",
      members: [member("n1", "Aquaman", false, { worktree: "C:/w/n1" }), member("n2", "Cyborg", false, { worktree: "C:/w/n2" })],
    });
    await make("n1", "Aquaman", "C:/w/n1");
    await make("n2", "Cyborg", "C:/w/n2");
    // Aquaman's sub-agents: Loki finished (idle), Thoth waits on a permission dialog only the user answers.
    await make("loki", "Loki", "C:/w/n1", "n1");
    await make("thoth", "Thoth", "C:/w/n1", "n1");
    // Under Cyborg: Fresh is still launching.
    await make("fresh", "Fresh", "C:/w/n2", "n2");
    for (const id of ["n1", "n2", "loki", "thoth", "fresh"]) terminalStatusStore.getState().set(id, { state: "running" });
    agentActivityStore.getState().apply({ nodeId: "n2", activity: "working", since: 0 });
    agentActivityStore.getState().hold("thoth", { activity: "waiting", since: 0, message: "Allow Bash?" });
    markLaunching("fresh", true);
    vi.mocked(missionCleanup).mockResolvedValue({ removed: ["auth"], kept: ["auth-aquaman (Thoth left open: waiting on a dialog only the user answers)"] });
    const result = await cleanMission("chef");
    expect(vi.mocked(stopTerminal).mock.calls.map(([id]) => id).sort()).toEqual(["loki"]);
    // Aquaman stays: its own sub-agent Thoth is held by a dialog, and its reports would be typed into it.
    expect(result).toEqual({
      removed: ["auth"],
      kept: ["auth-aquaman (Thoth left open: waiting on a dialog only the user answers)"],
      open: [
        { name: "Aquaman", why: "subAgents" },
        { name: "Cyborg", why: "atWork" },
        { name: "Thoth", why: "dialog" },
        { name: "Fresh", why: "launching" },
      ],
    });
    // The worktrees their folders are in stay, with why.
    expect(vi.mocked(missionCleanup).mock.calls[0][4]).toEqual([
      { path: "C:/w/n1", why: "Aquaman left open: its own sub-agents are at work" },
      { path: "C:/w/n2", why: "Cyborg left open: at work" },
      { path: "C:/w/n1", why: "Thoth left open: waiting on a dialog only the user answers" },
      { path: "C:/w/n2", why: "Fresh left open: still starting" },
    ]);
  });

  it("closes a stopped or finished agent and its finished sub-agents, waiting for their processes before git runs", async () => {
    let exited = false;
    vi.mocked(stopTerminal).mockImplementation((id: string) => {
      // Its process exits a moment after the stop.
      setTimeout(() => {
        terminalStatusStore.getState().set(id, { state: "stopped" });
        exited = true;
      }, 20);
    });
    await setup({ state: "terminee", project: "C:/code/proj", slug: "auth", base: "main", summary: "ok", members: [member("m1", "Aquaman", false, { worktree: "C:/w/m1" })] });
    await make("m1", "Aquaman", "C:/w/m1");
    await make("kid", "Kid", "C:/w/m1", "m1");
    terminalStatusStore.getState().set("m1", { state: "stopped" });
    terminalStatusStore.getState().set("kid", { state: "running" });
    vi.mocked(missionCleanup).mockImplementation(async () => {
      expect(exited).toBe(true);
      return { removed: ["auth-aquaman", "auth"], kept: [] };
    });
    expect(await cleanMission("chef")).toEqual({ removed: ["auth-aquaman", "auth"], kept: [], open: [] });
    expect(vi.mocked(stopTerminal).mock.calls.map(([id]) => id).sort()).toEqual(["kid", "m1"]);
    expect(missionCleanup).toHaveBeenCalledWith("C:/code/proj", "auth", [{ name: "Aquaman" }], "main", []);
  });
});

it("keeps the router setting when the mission is cleaned (backlog 27 oct)", async () => {
  await setup({ state: "terminee", budgetMin: 90, maxAgents: 3, router: true, project: "C:/code/proj", slug: "auth", summary: "ok", members: [member("batman", "Batman", true)] });
  vi.mocked(missionCleanup).mockResolvedValue({ removed: [], kept: [] });
  await cleanMission("chef");
  expect(missionNow()).toMatchObject({ state: "redaction", router: true });
});

it("keeps a Fleet's switch set off when the mission is cleaned: the veto holds for the next mission", async () => {
  await setup({ state: "terminee", maxAgents: 3, router: false, project: "C:/code/proj", slug: "auth", summary: "ok", members: [member("batman", "Batman", true)] });
  vi.mocked(missionCleanup).mockResolvedValue({ removed: [], kept: [] });
  await cleanMission("chef");
  expect(missionNow()).toMatchObject({ state: "redaction", router: false });
});

describe("what the final review of H2 found", () => {
  it("undoes the worktrees of a launch that fails, and moves no linked agent before the team exists", async () => {
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce(null);
    await launchMission("chef");
    expect(missionNow()).toMatchObject({ state: "plan", error: "The new agents' group could not be created." });
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(terminalOf(nodesStore.getState().nodes.batman)?.cwd).toBe("C:/code/proj");
    const fresh = vi.mocked(missionAddAgent).mock.calls[1][2];
    expect(missionDiscard).toHaveBeenCalledWith("C:/code/proj", [tree("auth"), tree("auth-batman"), tree(`auth-${fresh.toLowerCase()}`)]);
  });

  it("forms no team once the user left the fleet's workspace", async () => {
    await setup();
    vi.mocked(missionPrepare).mockImplementationOnce(async () => {
      workspacesStore.setState({ activeId: "w2" });
      return tree("auth");
    });
    await launchMission("chef");
    expect(missionNow()).toMatchObject({ state: "plan", error: expect.stringContaining("no longer on screen") });
    expect(launchGroup).not.toHaveBeenCalled();
    expect(setUpBoard).not.toHaveBeenCalled();
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(missionDiscard).toHaveBeenCalled();
  });

  it("stops the created agents when the mission ends away from its workspace", async () => {
    await setup({ state: "en_cours", project: "C:/code/proj", frameId: "f1", members: [member("batman", "Batman", true), member("n1", "Aquaman", false)] });
    workspacesStore.setState({ activeId: "w2" });
    endMission("chef", "Fini.");
    expect(closeGroup).not.toHaveBeenCalled();
    expect(stopTerminal).toHaveBeenCalledWith("n1");
    expect(relaunchTerminal).toHaveBeenCalledWith("batman", expect.objectContaining({ cwd: "C:/code/proj" }), "new");
  });

  it("frees the fleet even when the cleanup fails", async () => {
    await setup({ state: "terminee", project: "C:/gone", slug: "auth", members: [member("batman", "Batman", true)] });
    vi.mocked(missionCleanup).mockRejectedValueOnce(new Error("The project folder is not a git repository."));
    expect(await cleanMission("chef")).toBe("The project folder is not a git repository.");
    expect(missionNow().state).toBe("redaction");
  });

  it("keeps a merged branch merged when nothing new came since", async () => {
    const done = { summary: "ok", status: "termine" as const, at: 1 };
    await setup({ state: "en_cours", worktree: "C:/w/auth", branch: "dummyplane/auth", members: [member("batman", "Batman", true, { report: done, merged: true })] });
    vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "empty" }, uncommitted: false, head: "c0ffee" });
    expect(await mergeMission("chef")).toBe("Branch dummyplane/auth:\n1 agent already merged, nothing new.");
    expect(missionNow().members[0].merged).toBe(true);
  });
});

describe("merge with a big roster (2 to 5.7 s a call, and the whole roster said again each time)", () => {
  const done = { summary: "ok", status: "termine" as const, at: 1 };
  /** `count` agents merged before, at the head `h0`; a few more with new work. */
  const roster = (count: number, extra: Member[] = []) => [
    ...Array.from({ length: count }, (_, i) => member(`old${i}`, `Old ${i}`, false, { report: done, merged: true, squashed: "h0" })),
    ...extra,
  ];
  const mergeWith = (fresh: Member[], count = 12) => setup({ state: "en_cours", worktree: "C:/w/auth", branch: "dummyplane/auth", members: roster(count, fresh) });
  const newWork = (name: string) => member(`new-${name}`, name, false, { report: done });

  it("says what changed line by line, and the agents already in once, as a count: the answer does not grow with the roster", async () => {
    await mergeWith([newWork("Batman"), newWork("Robin")]);
    vi.mocked(missionProbe).mockImplementation(async (_mission, agents) => agents.map((agent) => ({ uncommitted: false, head: "h0", ...(agent.branch.includes("new-") ? { head: "h9" } : {}) })));
    vi.mocked(missionMerge).mockImplementation(async (_mission, _agent, branch) =>
      branch.endsWith("new-Batman")
        ? { merge: { kind: "merged" }, uncommitted: false, head: "h1" }
        : branch.endsWith("new-Robin")
          ? { merge: { kind: "conflict", files: Array.from({ length: 30 }, (_, i) => `src/file${i}.ts`) }, uncommitted: false, head: "h2" }
          : { merge: { kind: "empty" }, uncommitted: false, head: "h0" },
    );
    const said = (await mergeMission("chef")).split("\n");
    expect(said).toHaveLength(4);
    expect(said[0]).toBe("Branch dummyplane/auth:");
    expect(said[1]).toMatch(/^Batman: merged/);
    // A conflict names its first files, then how many more: a big branch may conflict in hundreds.
    expect(said[2]).toBe(
      "Robin: conflict, merge undone — src/file0.ts, src/file1.ts, src/file2.ts, src/file3.ts, src/file4.ts, src/file5.ts, src/file6.ts, src/file7.ts, +22 more. Not retried by itself: ask Robin to merge the mission's branch into its own, resolve and commit; its branch is merged again when it reports, or with merge and agent set to Robin.",
    );
    expect(said[3]).toBe("12 agents already merged, nothing new.");
  });

  it("names an agent already merged only when something is to be said of it", async () => {
    await mergeWith([], 3);
    vi.mocked(missionProbe).mockResolvedValue([{ uncommitted: false, head: "h0" }, { uncommitted: true, head: "h0" }, { uncommitted: false, head: "h0" }]);
    expect(await mergeMission("chef")).toBe(
      "Branch dummyplane/auth:\nOld 1: already merged, nothing new (uncommitted changes in its worktree are not merged: ask it to commit them, then merge again)\n2 agents already merged, nothing new.",
    );
  });

  it("reads every agent already merged at once, and makes no call of its own for the ones whose branch has not moved", async () => {
    await mergeWith([newWork("Batman")]);
    const reads: string[][] = [];
    vi.mocked(missionProbe).mockImplementation(async (_mission, agents) => {
      reads.push(agents.map((agent) => agent.path));
      return agents.map(() => ({ uncommitted: false, head: "h0" }));
    });
    vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "merged" }, uncommitted: false, head: "h1" });
    await mergeMission("chef");
    // One call for the twelve agents merged before, not twelve statuses one after another.
    expect(reads).toHaveLength(1);
    expect(reads[0]).toHaveLength(12);
    // Only the agent with new work goes through the merge; the others are answered from their read.
    expect(vi.mocked(missionMerge).mock.calls.map(([, agent]) => agent)).toEqual(["C:/w/new-Batman"]);
  });

  it("starts the reads before any merge, and merges one after another", async () => {
    await mergeWith([newWork("Batman"), newWork("Robin"), newWork("Thor")]);
    const order: string[] = [];
    let readsOver!: () => void;
    const gate = new Promise<void>((resolve) => (readsOver = resolve));
    vi.mocked(missionProbe).mockImplementation(async (_mission, agents) => {
      order.push("probe starts");
      await gate;
      order.push("probe ends");
      return agents.map(() => ({ uncommitted: false, head: "h0" }));
    });
    let merging = 0;
    let most = 0;
    vi.mocked(missionMerge).mockImplementation(async () => {
      order.push("merge starts");
      most = Math.max(most, ++merging);
      await new Promise((resolve) => setTimeout(resolve, 5));
      merging--;
      return { merge: { kind: "merged" }, uncommitted: false, head: "h1" };
    });
    const merged = mergeMission("chef");
    await vi.waitFor(() => expect(order).toEqual(["probe starts"]));
    readsOver();
    await merged;
    expect(order).toEqual(["probe starts", "probe ends", "merge starts", "merge starts", "merge starts"]);
    // The mission's worktree takes one squash at a time.
    expect(most).toBe(1);
  });

  it("merges each agent itself when the read fails, or when a branch moved since: the answer is the same", async () => {
    await mergeWith([], 3);
    vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "empty" }, uncommitted: false, head: "h0" });
    vi.mocked(missionProbe).mockRejectedValueOnce(new Error("git is gone"));
    expect(await mergeMission("chef")).toBe("Branch dummyplane/auth:\n3 agents already merged, nothing new.");
    expect(missionMerge).toHaveBeenCalledTimes(3);
    vi.mocked(missionMerge).mockClear();
    // One branch came on since: only that one is merged.
    vi.mocked(missionProbe).mockResolvedValueOnce([{ uncommitted: false, head: "h0" }, { uncommitted: false, head: "h5" }, null]);
    vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "merged" }, uncommitted: false, head: "h5" });
    await mergeMission("chef");
    expect(vi.mocked(missionMerge).mock.calls.map(([, agent]) => agent)).toEqual(["C:/w/old1", "C:/w/old2"]);
  });
});

describe("reassignTask", () => {
  const report = { summary: "API faite", status: "termine" as const, at: 1 };
  const team = () =>
    setup({ state: "en_cours", project: "C:/code/proj", slug: "auth", frameId: "f1", members: [member("batman", "Batman", true, { task: "Login" }), member("n1", "Aquaman", false, { task: "API", report, merged: true })] });

  it("gives a sub-task to an agent who is done, with the previous one's report and branch", async () => {
    await team();
    expect(await reassignTask("chef", "batman", "aquaman")).toEqual({ name: "Aquaman" });
    const [batman, aquaman] = missionNow().members;
    expect(batman.handedTo).toBe("Aquaman");
    expect(aquaman).toMatchObject({ task: "Login", budgetMin: 20, report: undefined, overdue: undefined, extraMin: undefined, merged: undefined, done: ["API"] });
    // The previous agent stops: its sub-task is another's now (final review H3).
    expect(pauseAgents).toHaveBeenCalledWith(["batman"]);
    expect(ptySendText).toHaveBeenCalledWith("batman", "[dummyPlane] Your sub-task \"Login\" goes to Aquaman: stop it and commit nothing more on it.");
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n1", expect.stringContaining("Taking over Batman's work")));
    const text = vi.mocked(ptySendText).mock.calls.find(([id]) => id === "n1")![1];
    expect(text.startsWith(subTaskText("Auth", plan[0], "dummyplane/auth-n1"))).toBe(true);
    expect(text).toContain("dummyplane/auth-batman");
    expect(handoverText(member("n1", "Aquaman", false, { report }))).toContain("\"API faite\"");
  });

  it("refuses an agent who is not done, the same agent, or a stranger; nothing changes", async () => {
    await team();
    const before = missionNow();
    expect(await reassignTask("chef", "n1", "Batman")).toContain("has not finished");
    expect(await reassignTask("chef", "batman", "Batman")).toContain("is not another agent of the mission");
    expect(await reassignTask("chef", "batman", "Deadpool")).toContain("is not another agent of the mission");
    // The refusal names who could take it, so that the next call goes right (#24): Aquaman has reported; Batman is the holder.
    expect(await reassignTask("chef", "batman", "Deadpool")).toBe('"Deadpool" is not another agent of the mission. It takes an agent that has reported (Aquaman), or "new".');
    expect(await reassignTask("chef", "n1", "Deadpool")).toBe('"Deadpool" is not another agent of the mission. It takes a "new" agent: none has reported.');
    expect(missionNow()).toEqual(before);
    // Its finished work must reach the mission's branch before its entry takes another sub-task (final review H3).
    updateMember("chef", "n1", { merged: false });
    const unmerged = missionNow();
    expect(await reassignTask("chef", "batman", "Aquaman")).toContain("Aquaman finished \"API\" but its branch is not merged: call merge first.");
    expect(missionNow()).toEqual(unmerged);
    expect(pauseAgents).not.toHaveBeenCalled();
  });

  it("refuses at once an agent that is stopped, instead of failing a minute later", async () => {
    await team();
    terminalStatusStore.getState().set("n1", { state: "stopped" });
    expect(await reassignTask("chef", "batman", "Aquaman")).toContain("is stopped");
    expect(missionNow().members[0].handedTo).toBeUndefined();
    expect(pauseAgents).not.toHaveBeenCalled();
  });

  it("starts again on its own conversation a finished agent dummyPlane stopped to free its memory, then types the sub-task", async () => {
    await team();
    await nodesStore.getState().create("n1", {
      workspaceId: "w1",
      kind: "terminal",
      payload: { ...session, role: undefined, name: "Aquaman", claudeSessionId: "s-aquaman", spawnedBy: "m1", lastReport: { status: "done", summary: "API faite" }, minimized: true, stoppedFinished: true },
    });
    terminalStatusStore.getState().set("n1", { state: "exited", code: 1 });
    vi.mocked(relaunchTerminal).mockImplementationOnce(async (id) => terminalStatusStore.getState().set(id, { state: "running" }));
    // Closed by the user, its record kept for Ctrl+Z: it stays stopped.
    canvasStore.setState({ api: { getSceneElementsIncludingDeleted: () => [{ id: "n1", isDeleted: true }] } as never });
    expect(await reassignTask("chef", "batman", "Aquaman")).toContain("is stopped");
    expect(relaunchTerminal).not.toHaveBeenCalled();
    canvasStore.setState({ api: { getSceneElementsIncludingDeleted: () => [{ id: "n1", isDeleted: false }] } as never });
    expect(await reassignTask("chef", "batman", "Aquaman")).toEqual({ name: "Aquaman" });
    expect(relaunchTerminal).toHaveBeenCalledExactlyOnceWith("n1", expect.objectContaining({ claudeSessionId: "s-aquaman" }), "resume");
    expect(missionNow().members[1]).toMatchObject({ task: "Login", report: undefined });
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n1", expect.stringContaining("Taking over Batman's work")));
    // Typed once its session runs, never into its shell before.
    const typed = vi.mocked(ptySendText).mock.calls.findIndex(([id]) => id === "n1");
    expect(vi.mocked(relaunchTerminal).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(ptySendText).mock.invocationCallOrder[typed]);
  });

  it("opens a new agent in the place of one at work on a full team: its seat goes with the sub-task (review 12 Nov)", async () => {
    await setup({ state: "en_cours", maxAgents: 2, project: "C:/code/proj", slug: "auth", frameId: "f1", members: [member("batman", "Batman", true, { task: "Login" }), member("n1", "Aquaman", false, { task: "API" })] });
    vi.mocked(launchGroup).mockResolvedValueOnce({ frameId: "f1", nodeIds: ["n7"] });
    const result = await reassignTask("chef", "batman", "nouveau");
    expect(result).toEqual({ name: expect.any(String) });
    expect(missionAddAgent).toHaveBeenCalledTimes(1);
    expect(missionNow().members[0].handedTo).toBe((result as { name: string }).name);
    // Aquaman and the new agent: still two at work.
    expect(activeCount("chef", missionNow())).toBe(2);
  });

  it("opens the new agent of a holder that stopped before finishing in its worktree, on its branch, with its steps (13 Nov)", async () => {
    // Merged once already, then given another sub-task: its branch's earlier work is in the mission's.
    await setup({ state: "en_cours", project: "C:/code/proj", slug: "auth", frameId: "f1", members: [member("batman", "Batman", true, { task: "Login", squashed: "h0" }), member("n1", "Aquaman", false, { task: "API" })] });
    // dummyPlane restarted, or its terminal died: its work, committed or not, is in its worktree.
    terminalStatusStore.getState().set("batman", { state: "exited", code: 1 });
    vi.mocked(launchGroup).mockResolvedValueOnce({ frameId: "f1", nodeIds: ["n7"] });
    terminalStatusStore.getState().set("n7", { state: "running" });
    const result = await reassignTask("chef", "batman", "nouveau");
    expect(result).toEqual({ name: expect.any(String) });
    const name = (result as { name: string }).name;
    // No worktree cut from the mission's branch: the new agent opens in Batman's.
    expect(missionAddAgent).not.toHaveBeenCalled();
    expect(vi.mocked(launchGroup).mock.calls[0][3]).toMatchObject({ cwds: ["C:/w/batman"] });
    expect(missionNow().members.find((m) => m.name === name)).toMatchObject({ nodeId: "n7", branch: "dummyplane/auth-batman", worktree: "C:/w/batman", worktreeOf: "Batman", task: "Login", squashed: "h0" });
    expect(missionNow().members[0].handedTo).toBe(name);
    // Its folder is the new agent's: Batman stays stopped, "Resume all" included, and nothing is typed into its shell.
    expect(stopTerminal).toHaveBeenCalledWith("batman");
    expect(terminalOf(nodesStore.getState().nodes.batman)?.stoppedFinished).toBe(true);
    expect(ptySendText).not.toHaveBeenCalledWith("batman", expect.anything());
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n7", expect.stringContaining("Taking over Batman's work")));
    const text = vi.mocked(ptySendText).mock.calls.find(([id]) => id === "n7")![1];
    expect(text).toContain("you work in its worktree, on its branch dummyplane/auth-batman, where its commits and its uncommitted changes are");
    expect(text).toContain("Its steps: Plan: done.");
    expect(text).not.toContain("This worktree is new");
  });

  it("never discards the worktree of a stopped holder when its new agent cannot be created", async () => {
    await setup({ state: "en_cours", project: "C:/code/proj", slug: "auth", frameId: "f1", members: [member("batman", "Batman", true, { task: "Login" })] });
    terminalStatusStore.getState().set("batman", { state: "exited", code: 1 });
    vi.mocked(launchGroup).mockResolvedValueOnce(null as never);
    expect(await reassignTask("chef", "batman", "nouveau")).toBe("The new agent could not be created.");
    expect(missionDiscard).not.toHaveBeenCalled();
    expect(missionNow().members[0].handedTo).toBeUndefined();
  });

  it("gives a holder at work's successor a worktree of its own, the previous one's branch to merge", async () => {
    await team();
    vi.mocked(launchGroup).mockResolvedValueOnce({ frameId: "f1", nodeIds: ["n7"] });
    terminalStatusStore.getState().set("n7", { state: "running" });
    await reassignTask("chef", "batman", "nouveau");
    expect(missionAddAgent).toHaveBeenCalledTimes(1);
    expect(missionNow().members.find((m) => m.nodeId === "n7")?.worktreeOf).toBeUndefined();
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n7", expect.stringContaining("merge it into yours")));
  });

  it("tells the successor in a worktree of its own how to install its dependencies, and one that took over a worktree nothing (#29)", async () => {
    workspacesStore.setState({ workspaces: [{ id: "w1", projectId: "p1", name: "A", position: 0, pantheon: null, kind: "canvas", folder: null }] });
    mockIPC((cmd, args) => (cmd === "studio_version" && (args as { path: string }).path === "uv.lock" ? "v1" : cmd === "notes_agent_list" ? [] : undefined));
    try {
      await team();
      vi.mocked(launchGroup).mockResolvedValueOnce({ frameId: "f1", nodeIds: ["n7"] });
      terminalStatusStore.getState().set("n7", { state: "running" });
      await reassignTask("chef", "batman", "nouveau");
      await vi.waitFor(() => expect(ptySendText).toHaveBeenCalledWith("n7", expect.stringContaining("merge it into yours")));
      const text = vi.mocked(ptySendText).mock.calls.find(([id]) => id === "n7")![1];
      expect(text).toContain("This worktree is new: its dependencies are not installed yet. Install them first, as the project's lockfiles say: uv sync. Declare your steps");
    } finally {
      workspacesStore.setState({ workspaces: [] });
      mockIPC(() => undefined);
    }
  });

  it("does not open one on a full team once that agent's terminal has stopped: it holds no seat to give", async () => {
    await setup({ state: "en_cours", maxAgents: 2, project: "C:/code/proj", slug: "auth", frameId: "f1", members: [member("batman", "Batman", true, { task: "Login" }), member("n1", "Aquaman", false, { task: "API" }), member("n2", "Shazam", false, { task: "Docs", sentAt: undefined })] });
    terminalStatusStore.getState().set("batman", { state: "exited", code: 0 });
    expect(await reassignTask("chef", "batman", "nouveau")).toContain("No seat is free: 2 of 2 agents at work (Max active agents, this mission's own limit");
    expect(missionAddAgent).not.toHaveBeenCalled();
    expect(pauseAgents).not.toHaveBeenCalled();
  });

  it("still refuses one when two others are at work, the one handing over having reported", async () => {
    const blocked = { summary: "bloqué", status: "bloque" as const, at: 1 };
    // Its sub-task not typed yet, Shazam's terminal is still starting: it holds its seat.
    const members = [member("batman", "Batman", true, { task: "Login", report: blocked }), member("n1", "Aquaman", false, { task: "API" }), member("n2", "Shazam", false, { task: "Docs", sentAt: undefined })];
    await setup({ state: "en_cours", maxAgents: 2, project: "C:/code/proj", slug: "auth", frameId: "f1", members });
    // Batman holds no seat: reassigning to an agent that reported would be one more too, so the refusal does not point there (review 12 Nov).
    expect(await reassignTask("chef", "batman", "nouveau")).toBe(
      "No seat is free: 2 of 2 agents at work (Max active agents, this mission's own limit, not the sub-agents' limit of Settings): Aquaman, Shazam. " +
        '"Login" would put a new agent to work as one more, and the agent it takes it from holds no seat now. ' +
        "Reassign it once a report frees a seat (queue: active_agents below max_agents), or queue it with add_tasks; a seat a report frees goes to the queue's next task first.",
    );
    expect(missionAddAgent).not.toHaveBeenCalled();
  });

  it("opens a new agent past the team's size: those who reported or handed over count no more against Max agents", async () => {
    const done = { summary: "ok", status: "termine" as const, at: 1 };
    const blocked = { summary: "bloqué", status: "bloque" as const, at: 1 };
    await setup({
      state: "en_cours",
      maxAgents: 2,
      project: "C:/code/proj",
      slug: "auth",
      frameId: "f1",
      members: [
        member("batman", "Batman", true, { task: "Login" }),
        member("n1", "Aquaman", false, { task: "API", report: done, merged: true }),
        member("n2", "Shazam", false, { task: "Docs", report: blocked }),
        member("n3", "Cyborg", false, { task: "Tests", handedTo: "Aquaman" }),
      ],
    });
    // Still running: a report, not a stopped terminal, frees the seat.
    for (const id of ["n2", "n3"]) terminalStatusStore.getState().set(id, { state: "running" });
    canvasStore.setState({ frames: [{ id: "f1", x: 0, y: 0, width: 800, height: 500, name: "Mission Auth", group: { role: "general", pantheon: "egyptian" }, memberIds: ["n1", "n2", "n3"] }] });
    const result = await reassignTask("chef", "batman", "nouveau");
    expect(typeof result).toBe("object");
    const name = (result as { name: string }).name;
    expect(missionAddAgent).toHaveBeenCalledWith("C:/code/proj", "auth", name);
    expect(missionNow().members.map((m) => [m.nodeId, m.task, m.handedTo])).toEqual([
      ["batman", "Login", name],
      ["n1", "API", undefined],
      ["n2", "Docs", undefined],
      ["n3", "Tests", "Aquaman"],
      ["n9", "Login", undefined],
    ]);
    for (const id of ["n2", "n3"]) terminalStatusStore.getState().set(id, { state: "stopped" });
  });

  it("leaves no new agent at work for a mission stopped while it was created: it stops, and the stopped mission takes nobody", async () => {
    await team();
    setMission("chef", { manager: "m1" });
    // The user stops the mission while git makes the new agent's worktree.
    vi.mocked(missionAddAgent).mockImplementationOnce(async (_project, mission, agent) => {
      stopMission("chef", { by: "user" });
      return tree(`${mission}-${agent.toLowerCase()}`);
    });
    // As the real one: the Manager's new sub-agent is launching until its sub-task is typed.
    vi.mocked(addTeamMember).mockImplementationOnce(async () => {
      markLaunching("n9", true);
      return "n9";
    });
    expect(typeof (await reassignTask("chef", "batman", "nouveau"))).toBe("string");
    expect(stopTerminal).toHaveBeenCalledWith("n9");
    // Off the canvas, as the end took the agents made for the mission: no terminal outlives its worktree, nor resumes in it.
    expect(removeNodes).toHaveBeenCalledWith(["n9"]);
    // Its sub-task never comes: it is not left "launching", counted at work by the spawn caps and the duplicate guard.
    expect(isLaunching("n9")).toBe(false);
    expect(missionNow()).toMatchObject({ state: "terminee" });
    expect(missionNow().members.map((m) => [m.nodeId, m.handedTo])).toEqual([
      ["batman", undefined],
      ["n1", undefined],
    ]);
    // Batman, linked, went back to the project: nothing of the stopped mission reaches it.
    expect(pauseAgents).not.toHaveBeenCalled();
    expect(vi.mocked(ptySendText).mock.calls.filter(([id]) => id === "batman")).toEqual([]);
  });

  it("cleans the worktree of the new agent a stop left behind with the mission, as a member's: it is no member", async () => {
    await team();
    vi.mocked(missionAddAgent).mockImplementationOnce(async (_project, mission, agent) => {
      stopMission("chef", { by: "user" });
      return tree(`${mission}-${agent.toLowerCase()}`);
    });
    await reassignTask("chef", "batman", "nouveau");
    const name = vi.mocked(missionAddAgent).mock.calls[0][2];
    expect(missionNow().members.map((m) => m.name)).not.toContain(name);
    vi.mocked(missionCleanup).mockResolvedValueOnce({ removed: [], kept: [] });
    // Ended, its finished agent is stopped: the cleanup closes it at once.
    terminalStatusStore.getState().set("n1", { state: "stopped" });
    await cleanMission("chef");
    expect(missionCleanup).toHaveBeenCalledWith("C:/code/proj", "auth", [{ name: "Batman" }, { name: "Aquaman" }, { name }], undefined, []);
  });

  it("takes the left-behind agent's worktree back itself while the cleanup runs: that cleanup's list is made, and its end blanks the mission", async () => {
    await team();
    // Its terminal never ran: nothing holds its worktree, the discard goes at once.
    terminalStatusStore.getState().remove("n9");
    canvasStore.setState({ frames: [{ id: "f1", x: 0, y: 0, width: 800, height: 500, name: "Mission Auth", group: { role: "general", pantheon: "egyptian" }, memberIds: ["n1"] }] });
    let release: (value: { removed: string[]; kept: string[] }) => void = () => undefined;
    vi.mocked(missionCleanup).mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    let cleaning: Promise<unknown> = Promise.resolve();
    vi.mocked(missionAddAgent).mockImplementationOnce(async (_project, mission, agent) => {
      stopMission("chef", { by: "user" });
      // Ended, its finished agent is stopped: the cleanup closes it at once.
      terminalStatusStore.getState().set("n1", { state: "stopped" });
      cleaning = cleanMission("chef");
      return tree(`${mission}-${agent.toLowerCase()}`);
    });
    try {
      await reassignTask("chef", "batman", "nouveau");
      const name = vi.mocked(missionAddAgent).mock.calls[0][2];
      const made = tree(`auth-${name.toLowerCase()}`);
      await vi.waitFor(() => expect(missionDiscard).toHaveBeenCalledWith("C:/code/proj", [{ slug: name, branch: made.branch, path: made.path }]));
    } finally {
      // Never left under way: the next cleanups would join it.
      release({ removed: [], kept: [] });
      await cleaning;
    }
  });

  it("takes the left-behind agent's worktree back at once when the mission was cleaned up meanwhile: no cleanup is left to do it", async () => {
    await team();
    vi.mocked(missionCleanup).mockResolvedValueOnce({ removed: [], kept: [] });
    vi.mocked(missionAddAgent).mockImplementationOnce(async (_project, mission, agent) => {
      stopMission("chef", { by: "user" });
      // Ended, its finished agent is stopped: the cleanup closes it at once.
      terminalStatusStore.getState().set("n1", { state: "stopped" });
      await cleanMission("chef");
      return tree(`${mission}-${agent.toLowerCase()}`);
    });
    canvasStore.setState({ frames: [{ id: "f1", x: 0, y: 0, width: 800, height: 500, name: "Mission Auth", group: { role: "general", pantheon: "egyptian" }, memberIds: ["n1"] }] });
    // Its terminal still runs when it is stopped: its process tree holds the worktree as its folder until it exits.
    vi.mocked(addTerminal).mockImplementationOnce(async () => {
      terminalStatusStore.getState().set("n9", { state: "running" });
      return "n9";
    });
    await reassignTask("chef", "batman", "nouveau");
    const name = vi.mocked(missionAddAgent).mock.calls[0][2];
    const made = tree(`auth-${name.toLowerCase()}`);
    expect(stopTerminal).toHaveBeenCalledWith("n9");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(missionDiscard).not.toHaveBeenCalled();
    // Its exit comes late: the discard goes then, git no longer finding the folder held.
    terminalStatusStore.getState().set("n9", { state: "exited", code: 0 });
    await vi.waitFor(() => expect(missionDiscard).toHaveBeenCalledWith("C:/code/proj", [{ slug: name, branch: made.branch, path: made.path }]));
    expect(missionNow()).not.toHaveProperty("strays");
  });

  it("says what a left-behind agent's discard left in place, or why it failed, instead of dropping it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const outcome of [{ removed: [], kept: ["auth-x (Permission denied)"] }, new Error("git is gone")]) {
        warn.mockClear();
        await team();
        terminalStatusStore.getState().remove("n9");
        canvasStore.setState({ frames: [{ id: "f1", x: 0, y: 0, width: 800, height: 500, name: "Mission Auth", group: { role: "general", pantheon: "egyptian" }, memberIds: ["n1"] }] });
        vi.mocked(missionCleanup).mockResolvedValueOnce({ removed: [], kept: [] });
        if (outcome instanceof Error) vi.mocked(missionDiscard).mockRejectedValueOnce(outcome);
        else vi.mocked(missionDiscard).mockResolvedValueOnce(outcome);
        vi.mocked(missionAddAgent).mockImplementationOnce(async (_project, mission, agent) => {
          stopMission("chef", { by: "user" });
          terminalStatusStore.getState().set("n1", { state: "stopped" });
          await cleanMission("chef");
          return tree(`${mission}-${agent.toLowerCase()}`);
        });
        await reassignTask("chef", "batman", "nouveau");
        await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("not discarded"), outcome instanceof Error ? outcome : outcome.kept));
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("gives a sub-task to a new agent in the mission's group, started at once", async () => {
    await team();
    canvasStore.setState({ frames: [{ id: "f1", x: 0, y: 0, width: 800, height: 500, name: "Mission Auth", group: { role: "general", pantheon: "egyptian" }, memberIds: ["n1"] }] });
    const result = await reassignTask("chef", "batman", "nouveau");
    expect(typeof result === "object" && result.name).toBeTruthy();
    const name = (result as { name: string }).name;
    expect(missionAddAgent).toHaveBeenCalledWith("C:/code/proj", "auth", name);
    expect(addTerminal).toHaveBeenCalledWith("w1", expect.objectContaining({ name, cwd: tree(`auth-${name.toLowerCase()}`).path, agent: "claude" }), { x: 400, y: 250 }, "f1", quiet);
    expect(relaunchTerminal).not.toHaveBeenCalled();
    expect(missionNow().members.map((m) => [m.nodeId, m.task, m.handedTo])).toEqual([
      ["batman", "Login", name],
      ["n1", "API", undefined],
      ["n9", "Login", undefined],
    ]);
  });
});

describe("a sub-task dummyPlane has not typed yet, after a restart or a relaunch (12 Nov)", () => {
  const pending = "[dummyPlane · mission Auth] Login — Fais le login.";
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const typedTo = (nodeId: string) => vi.mocked(ptySendText).mock.calls.filter(([id]) => id === nodeId);
  const held = (nodeId: string) => missionNow().members.find((m) => m.nodeId === nodeId)!;
  const status = (nodeId: string, state: "running" | "stopped" | "exited") =>
    terminalStatusStore.getState().set(nodeId, state === "exited" ? { state, code: 0 } : { state });
  let uninstall: (() => void) | undefined;
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
  });

  it("keeps the text with the member until it is typed, then drops it", async () => {
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    vi.mocked(whenReady).mockImplementation(async () => {
      await opened;
      return true;
    });
    try {
      await launchMission("chef");
      // Recorded before any wait: dummyPlane restarting now still knows what to type.
      expect(held("batman").brief).toContain("Login");
      expect(held("n1").brief).toContain("API");
      open();
      await vi.waitFor(() => expect(missionNow().members.every((m) => m.sentAt !== undefined)).toBe(true));
      expect(missionNow().members.map((m) => m.brief)).toEqual([undefined, undefined]);
    } finally {
      vi.mocked(whenReady).mockImplementation(() => Promise.resolve(true));
    }
  });

  it("types it once its terminal runs again after dummyPlane restarted, and only once", async () => {
    await setup({ state: "en_cours", members: [member("n1", "Aquaman", false, { task: "Login", sentAt: undefined, brief: pending })] });
    status("n1", "stopped");
    uninstall = installRedelivery();
    await tick();
    expect(ptySendText).not.toHaveBeenCalled();
    status("n1", "running");
    await vi.waitFor(() => expect(held("n1").sentAt).toEqual(expect.any(Number)));
    expect(typedTo("n1")).toEqual([["n1", pending]]);
    expect(held("n1").brief).toBeUndefined();
    // Its report is the mission's from now on.
    expect(memberOf("n1")?.member.nodeId).toBe("n1");
    // Stopped and started again: it has its sub-task, nothing more is typed.
    status("n1", "exited");
    status("n1", "running");
    await tick();
    expect(typedTo("n1")).toHaveLength(1);
  });

  it("types it to a member already running when the watcher installs (a reload of the window)", async () => {
    await setup({ state: "en_cours", members: [member("n1", "Aquaman", false, { task: "Login", sentAt: undefined, brief: pending })] });
    uninstall = installRedelivery();
    await vi.waitFor(() => expect(typedTo("n1")).toEqual([["n1", pending]]));
  });

  it("types it to an agent that did not start once its terminal runs: the Manager types nothing", async () => {
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    status("n1", "stopped");
    uninstall = installRedelivery();
    await launchMission("chef");
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith("m1", `${held("n1").name} did not start: its sub-task is not sent yet. dummyPlane types it as soon as its terminal runs again: relaunch it, do not type it yourself.`),
    );
    const brief = held("n1").brief;
    expect(brief).toContain("API");
    expect(typedTo("n1")).toEqual([]);
    status("n1", "running");
    await vi.waitFor(() => expect(held("n1").sentAt).toEqual(expect.any(Number)));
    expect(typedTo("n1")).toEqual([["n1", brief]]);
  });

  it("never types it twice while its session is awaited: a restart meanwhile, or a second assign, changes nothing", async () => {
    await setup({ state: "en_cours", members: [member("n1", "Aquaman", false, { task: "Login", sentAt: undefined, brief: pending })] });
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    vi.mocked(whenReady).mockImplementationOnce(async () => {
      await opened;
      return true;
    });
    status("n1", "stopped");
    uninstall = installRedelivery();
    status("n1", "running");
    expect(deliveryPending("n1")).toBe(true);
    status("n1", "exited");
    status("n1", "running");
    await assign("chef", held("n1"), "another text");
    open();
    await vi.waitFor(() => expect(deliveryPending("n1")).toBe(false));
    expect(whenReady).toHaveBeenCalledTimes(1);
    expect(typedTo("n1")).toEqual([["n1", pending]]);
  });

  it("leaves alone a member that handed its task over, one that reported, one that has its sub-task, and a mission no longer running", async () => {
    const report = { summary: "x", status: "bloque" as const, at: 1 };
    await setup({
      state: "en_cours",
      members: [
        member("n1", "Aquaman", false, { sentAt: undefined, brief: pending, handedTo: "Shazam" }),
        member("n2", "Shazam", false, { sentAt: undefined, brief: pending, report }),
        member("n3", "Hulk", false, { brief: pending }),
      ],
    });
    for (const id of ["n1", "n2", "n3"]) status(id, "stopped");
    uninstall = installRedelivery();
    for (const id of ["n1", "n2", "n3"]) status(id, "running");
    await tick();
    expect(ptySendText).not.toHaveBeenCalled();
    setMission("chef", { state: "terminee", members: [member("n4", "Thor", false, { sentAt: undefined, brief: pending })] });
    status("n4", "stopped");
    status("n4", "running");
    await tick();
    expect(ptySendText).not.toHaveBeenCalled();
  });

  it("never types a new agent's or a reported agent's sub-task while the previous one is paused: reassign records it first", async () => {
    const report = { summary: "API faite", status: "termine" as const, at: 1 };
    await setup({
      state: "en_cours",
      project: "C:/code/proj",
      slug: "auth",
      frameId: "f1",
      // Aquaman reported long ago; the text of an older sub-task is still on it.
      members: [member("batman", "Batman", true, { task: "Login" }), member("n1", "Aquaman", false, { task: "API", report, merged: true, brief: "an older sub-task" })],
    });
    let release!: () => void;
    vi.mocked(pauseAgents).mockImplementationOnce(() => new Promise<number>((resolve) => (release = () => resolve(1))));
    uninstall = installRedelivery();
    const handing = reassignTask("chef", "batman", "Aquaman");
    await vi.waitFor(() => expect(held("n1").task).toBe("Login"));
    // Its terminal restarts while Batman is paused: nothing of an older sub-task is typed, nor yet the new one.
    status("n1", "exited");
    status("n1", "running");
    await tick();
    expect(typedTo("n1")).toEqual([]);
    release();
    await handing;
    await vi.waitFor(() => expect(held("n1").sentAt).toEqual(expect.any(Number)));
    expect(typedTo("n1")).toHaveLength(1);
    expect(typedTo("n1")[0][1]).toContain("Taking over Batman's work");
  });

  it("types a new agent's sub-task once, its terminal starting while the previous one is paused", async () => {
    const report = { summary: "API faite", status: "termine" as const, at: 1 };
    await setup({ state: "en_cours", project: "C:/code/proj", slug: "auth", frameId: "f1", members: [member("batman", "Batman", true, { task: "Login" }), member("n1", "Aquaman", false, { task: "API", report, merged: true })] });
    canvasStore.setState({ frames: [{ id: "f1", x: 0, y: 0, width: 800, height: 500, name: "Mission Auth", group: { role: "general", pantheon: "egyptian" }, memberIds: ["n1"] }] });
    let release!: () => void;
    vi.mocked(pauseAgents).mockImplementationOnce(() => new Promise<number>((resolve) => (release = () => resolve(1))));
    status("n9", "stopped");
    uninstall = installRedelivery();
    const handing = reassignTask("chef", "batman", "nouveau");
    await vi.waitFor(() => expect(missionNow().members.some((m) => m.nodeId === "n9")).toBe(true));
    status("n9", "running");
    await tick();
    expect(typedTo("n9")).toEqual([]);
    release();
    await handing;
    await vi.waitFor(() => expect(held("n9").sentAt).toEqual(expect.any(Number)));
    status("n9", "exited");
    status("n9", "running");
    await tick();
    expect(typedTo("n9")).toHaveLength(1);
  });
});

it("leaves a handed-over agent's branch to its successor when merging (final review H3)", async () => {
  const done = { summary: "ok", status: "termine" as const, at: 1 };
  await setup({ state: "en_cours", worktree: "C:/w/auth", branch: "dummyplane/auth", members: [member("batman", "Batman", true, { report: done, handedTo: "Aquaman" }), member("n1", "Aquaman", false, { report: done })] });
  vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "merged" }, uncommitted: false, head: "c0ffee" });
  await mergeMission("chef");
  expect(vi.mocked(missionMerge).mock.calls.map(([, , branch]) => branch)).toEqual(["dummyplane/auth-n1"]);
});


it("gives a reassigned new agent the model of the sub-task's level when the router is on (backlog Routeur)", async () => {
  await setup({
    state: "en_cours",
    router: true,
    plan: [{ title: "Login", brief: "b", agent: "Batman", budgetMin: 20, level: "eleve" }],
    project: "C:/code/proj",
    slug: "auth",
    frameId: "f1",
    members: [member("batman", "Batman", true, { task: "Login" })],
  });
  canvasStore.setState({ frames: [{ id: "f1", x: 0, y: 0, width: 800, height: 500, name: "Mission Auth", group: { role: "general", pantheon: "egyptian" }, memberIds: ["batman"] }] });
  const result = await reassignTask("chef", "batman", "nouveau");
  expect(typeof result).toBe("object");
  expect(addTerminal).toHaveBeenCalledWith("w1", expect.objectContaining({ model: "claude-opus-5-5" }), expect.anything(), "f1", quiet);
  expect(missionNow().members[missionNow().members.length - 1]?.model).toBe("claude-opus-5-5");
});

describe("the repository a mission branches from", () => {
  const inWorkspace = (folder: string | null) => {
    projectsStore.setState({ projects: [{ id: "p1", name: "proj", path: "C:/code/proj", lastOpenedAt: 0, missing: false } as Project], activeId: "p1" });
    workspacesStore.setState({
      projectId: "p1",
      workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder }],
      activeId: "w1",
      status: "ready",
    });
  };
  afterEach(() => {
    projectsStore.setState({ projects: [], activeId: null });
    workspacesStore.setState({ workspaces: [] });
  });

  it("is the folder of the fleet's workspace, even though the fleet's own session started in the project's", async () => {
    inWorkspace("D:/work/repo");
    await setup();
    await launchMission("chef");
    expect(missionPrepare).toHaveBeenCalledWith("D:/work/repo", "Auth");
    expect(vi.mocked(missionAddAgent).mock.calls.map(([project]) => project)).toEqual(["D:/work/repo", "D:/work/repo"]);
    // Recorded on the mission: the merge, the cleanup and the later agents use it.
    expect(missionNow().project).toBe("D:/work/repo");
  });

  it("stays where the mission started when the workspace's folder changes afterwards", async () => {
    inWorkspace("D:/work/repo");
    await setup();
    await launchMission("chef");
    workspacesStore.setState({ workspaces: [{ ...workspacesStore.getState().workspaces[0], folder: "E:/elsewhere" }] });
    expect(missionNow().project).toBe("D:/work/repo");
  });

  it("is the project's folder for a workspace that picked none", async () => {
    inWorkspace(null);
    await setup();
    await launchMission("chef");
    expect(missionPrepare).toHaveBeenCalledWith("C:/code/proj", "Auth");
  });

  it("is the fleet's own folder when its workspace is not among the open project's", async () => {
    inWorkspace("D:/work/repo");
    workspacesStore.setState({ workspaces: [] });
    await setup();
    await launchMission("chef");
    expect(missionPrepare).toHaveBeenCalledWith("C:/code/proj", "Auth");
  });

  it("fails the go-ahead, naming the folder, when it is not a git repository, and keeps the plan", async () => {
    inWorkspace("D:/work/plain");
    await setup();
    vi.mocked(missionPrepare).mockRejectedValueOnce(new Error("The folder D:/work/plain is not a git repository."));
    await launchMission("chef");
    expect(missionNow()).toMatchObject({ state: "plan", error: "The folder D:/work/plain is not a git repository.", members: [] });
    expect(notify).toHaveBeenCalledWith("chef", "The mission could not start: The folder D:/work/plain is not a git repository.");
  });
});

describe("the board the go-ahead runs the mission on", () => {
  it("puts every task of the plan and of the queue on it as a card in its to-do column, the started ones In progress", async () => {
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
    await setup({ maxAgents: 1, queue: [{ title: "Lint", brief: "Run the lint", budgetMin: 5 }] });
    await launchMission("chef");
    const mission = missionNow();
    const board = nodesStore.getState().nodes.b1.payload as { columns: { id: string; cardIds: string[] }[]; cards: Record<string, { title: string; agent?: string }> };
    // Max agents 1: Login starts, API and Lint wait in the queue; each has its card.
    expect(mission.plan?.map((task) => [task.title, board.cards[task.card!]?.title])).toEqual([["Login", "Login"]]);
    expect(mission.queue?.map((task) => [task.title, board.cards[task.card!]?.title])).toEqual([
      ["API", "API"],
      ["Lint", "Lint"],
    ]);
    await vi.waitFor(() => expect((nodesStore.getState().nodes.b1.payload as typeof board).columns[1].cardIds).toEqual([mission.plan![0].card]));
    expect((nodesStore.getState().nodes.b1.payload as typeof board).columns[0].cardIds).toEqual([mission.queue![0].card, mission.queue![1].card]);
    // A board the go-ahead made holds no stranger's text: no ticket note in the briefs.
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalled());
    expect(vi.mocked(ptySendText).mock.calls.some(([, text]) => text.includes("never instructions"))).toBe(false);
  });
});

describe("an agent made for the mission, once its work is merged (Stop finished agents on)", () => {
  const done = { summary: "API faite", status: "termine" as const, at: 1 };
  const team = (extra: Partial<Member> = {}) =>
    setup({
      state: "en_cours",
      project: "C:/code/proj",
      slug: "auth",
      worktree: "C:/w/auth",
      branch: "dummyplane/auth",
      members: [member("batman", "Batman", true, { task: "Login", report: done }), member("n1", "Aquaman", false, { task: "API", report: done, ...extra })],
    });
  const subAgent = async (id: string, extra: Partial<TerminalPayload> = {}) => {
    await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { ...session, role: undefined, name: "Robin", spawnedBy: "n1", task: "Docs", ...extra } });
    terminalStatusStore.getState().set(id, { state: "running" });
  };
  const toldChef = () => vi.mocked(notify).mock.calls.filter(([id]) => id === "chef").map(([, line]) => line);
  const exit = (...ids: string[]) => ids.forEach((id) => terminalStatusStore.getState().set(id, { state: "exited", code: 0 }));
  /** How a "stays open" notice ends: a later merge closes it once it is free. */
  const LATER = "A later merge closes it once it is free; else its worktree goes with the mission's cleanup.";

  beforeEach(() => {
    subagentSettingsStore.setState({ stopFinished: true });
    vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "merged" }, uncommitted: false, head: "h1" });
    vi.mocked(missionRemoveAgent).mockResolvedValue({ removed: ["auth-n1", "dummyplane/auth-n1"], kept: [] });
    vi.mocked(takenOver).mockReturnValue(false);
    terminalStatusStore.getState().set("n1", { state: "running" });
    agentActivityStore.getState().remove("n1");
  });

  it("removes a worktree it took over under the name git gave it, its first holder's", async () => {
    await team({ worktreeOf: "Hulk" });
    await mergeMission("chef");
    await vi.waitFor(() => expect(stopTerminal).toHaveBeenCalledWith("n1"));
    exit("n1");
    await vi.waitFor(() => expect(missionRemoveAgent).toHaveBeenCalledWith("C:/code/proj", "auth", { name: "Hulk", squashed: "h1" }));
  });

  it("closes it with its own sub-agents, removes its worktree and branch once they exited, then takes their nodes off the canvas", async () => {
    await team();
    await subAgent("n1-sub", { lastReport: { status: "done", summary: "ok" } });
    const said = (await mergeMission("chef")).split("\n");
    expect(said).toContain("Aquaman: merged — it closes now, its worktree and branch removed");
    // A linked agent goes back to the user's project at the mission's end: never closed by its merge.
    expect(said).toContain("Batman: merged");
    await vi.waitFor(() => expect(stopTerminal).toHaveBeenCalledWith("n1"));
    expect(stopTerminal).toHaveBeenCalledWith("n1-sub");
    expect(stopTerminal).not.toHaveBeenCalledWith("batman");
    // Their processes still hold its worktree as their folder: nothing goes before they exit.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(missionRemoveAgent).not.toHaveBeenCalled();
    exit("n1", "n1-sub");
    await vi.waitFor(() => expect(missionRemoveAgent).toHaveBeenCalledWith("C:/code/proj", "auth", { name: "Aquaman", squashed: "h1" }));
    await vi.waitFor(() => expect(removeNodes).toHaveBeenCalledWith(["n1", "n1-sub"]));
    expect(missionNow().members[1]).toMatchObject({ merged: true, squashed: "h1", cleanedUp: true });
    expect(toldChef()).toEqual([]);
    // Its work is in and its branch gone: the next merges leave it alone.
    vi.mocked(missionMerge).mockClear();
    await mergeMission("chef");
    expect(vi.mocked(missionMerge).mock.calls.map(([, , branch]) => branch)).toEqual(["dummyplane/auth-batman"]);
  });

  it("keeps what git refuses, untouched, and its node while its worktree stays; its Manager hears which and why", async () => {
    await team();
    vi.mocked(missionRemoveAgent).mockResolvedValueOnce({ removed: [], kept: ["auth-n1 (Permission denied)"] });
    await mergeMission("chef");
    await vi.waitFor(() => expect(stopTerminal).toHaveBeenCalledWith("n1"));
    exit("n1");
    await vi.waitFor(() => expect(toldChef()).toEqual(["Aquaman is closed after its merge, but git kept auth-n1 (Permission denied): nothing was forced. It goes with the mission's cleanup, or by hand."]));
    expect(removeNodes).not.toHaveBeenCalled();
    // Its worktree gone, a branch with commits since the merge kept: its node goes, its Manager hears of the branch.
    vi.mocked(notify).mockClear();
    await nodesStore.getState().update("chef", { mission: { ...missionNow(), members: missionNow().members.map((m) => (m.nodeId === "n1" ? { ...m, cleanedUp: undefined } : m)) } });
    vi.mocked(missionRemoveAgent).mockResolvedValueOnce({ removed: ["auth-n1"], kept: ["dummyplane/auth-n1 (commits after its merge)"] });
    await mergeMission("chef");
    // With its own sub-agents, if an earlier test left one under it.
    await vi.waitFor(() => expect(removeNodes).toHaveBeenCalledWith(expect.arrayContaining(["n1"])));
    expect(toldChef()).toEqual([expect.stringContaining("git kept dummyplane/auth-n1 (commits after its merge)")]);
  });

  it("tells its Manager, in one line, what it left uncommitted (saved on its branch) and what was moved aside from its worktree", async () => {
    await team();
    vi.mocked(missionRemoveAgent).mockResolvedValueOnce({
      removed: ["auth-n1"],
      kept: ["dummyplane/auth-n1 (WIP saved at clean-up)"],
      saved: ["dummyplane/auth-n1 (abc1234)"],
      moved: [{ worktree: "auth-n1", folder: "C:/code/proj.worktrees/.kept/auth-n1", files: [".env", "notes.md"], count: 3 }],
    });
    await mergeMission("chef");
    await vi.waitFor(() => expect(stopTerminal).toHaveBeenCalledWith("n1"));
    exit("n1");
    await vi.waitFor(() => expect(toldChef()).toHaveLength(1));
    const [line] = toldChef();
    expect(line).toContain("git kept dummyplane/auth-n1 (WIP saved at clean-up)");
    expect(line).toContain('committed as "WIP saved at clean-up" on dummyplane/auth-n1 (abc1234)');
    expect(line).toContain(".env, notes.md, +1 more → C:/code/proj.worktrees/.kept/auth-n1");
    expect(line).not.toContain("\n");
    // Only its branch is kept: its node goes.
    await vi.waitFor(() => expect(removeNodes).toHaveBeenCalledWith(expect.arrayContaining(["n1"])));
  });

  it("stays open, and says why, while one of its sub-agents works, the user is at it, or a sub-task is handed to it", async () => {
    for (const [why, arrange] of [
      ["one of its own sub-agents is still at work", () => subAgent("n1-busy")],
      ["the user is at its terminal", async () => void vi.mocked(takenOver).mockReturnValue(true)],
      ["a sub-task was handed to it", () => team({ brief: "Write the docs." })],
    ] as const) {
      vi.mocked(notify).mockClear();
      vi.mocked(stopTerminal).mockClear();
      await team();
      await arrange();
      await mergeMission("chef");
      await vi.waitFor(() => expect(toldChef()).toEqual([`Aquaman stays open after its merge: ${why}. ${LATER}`]));
      expect(stopTerminal).not.toHaveBeenCalled();
      expect(missionRemoveAgent).not.toHaveBeenCalled();
      expect(missionNow().members[1].cleanedUp).toBeUndefined();
      // Done with: the sub-agent reported and exited.
      if (nodesStore.getState().nodes["n1-busy"]) void nodesStore.getState().update("n1-busy", { lastReport: { status: "done", summary: "ok" } });
      terminalStatusStore.getState().set("n1-busy", { state: "exited", code: 0 });
      vi.mocked(takenOver).mockReturnValue(false);
    }
  });

  it("stays open while it is itself at work again, or waiting for an answer, a minute on: stopped, it would lose what it is doing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      for (const activity of ["working", "waiting"] as const) {
        vi.mocked(notify).mockClear();
        vi.mocked(stopTerminal).mockClear();
        await team();
        agentActivityStore.getState().apply({ nodeId: "n1", activity, since: Date.now() });
        await mergeMission("chef");
        // The turn it reported in may still be ending: it is waited for, and says nothing meanwhile.
        await vi.advanceTimersByTimeAsync(30_000);
        expect(toldChef()).toEqual([]);
        await vi.advanceTimersByTimeAsync(31_000);
        await vi.waitFor(() => expect(toldChef()).toEqual([`Aquaman stays open after its merge: it is at work again. ${LATER}`]));
        expect(stopTerminal).not.toHaveBeenCalled();
        expect(missionRemoveAgent).not.toHaveBeenCalled();
        expect(missionNow().members[1].cleanedUp).toBeUndefined();
        agentActivityStore.getState().remove("n1");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  // The Manager merges as soon as an agent reports, while the agent is still writing the last words of the turn it
  // reported in: it was told "it is at work again", wrote to it, and so set it to work for real (19 November's log).
  it("waits for the turn it reported in to end, then closes: its Manager is told nothing", async () => {
    await team();
    agentActivityStore.getState().apply({ nodeId: "n1", activity: "working", since: Date.now() });
    expect(await mergeMission("chef")).toContain("Aquaman: merged — it closes now");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stopTerminal).not.toHaveBeenCalled();
    agentActivityStore.getState().apply({ nodeId: "n1", activity: "idle", since: Date.now() });
    await vi.waitFor(() => expect(stopTerminal).toHaveBeenCalledWith("n1"));
    exit("n1");
    await vi.waitFor(() => expect(missionRemoveAgent).toHaveBeenCalledWith("C:/code/proj", "auth", { name: "Aquaman", squashed: "h1" }));
    expect(toldChef()).toEqual([]);
    agentActivityStore.getState().remove("n1");
  });

  // Two merges in a row (Deadpool, 19 November, merged at 04:26:17 and taken again at 04:26:24): one cleanup, said once.
  it("starts no second cleanup for a merge made while the first waits for its turn to end, and names it once", async () => {
    await team();
    agentActivityStore.getState().apply({ nodeId: "n1", activity: "working", since: Date.now() });
    expect(await mergeMission("chef")).toContain("Aquaman: merged — it closes now");
    vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "empty" }, uncommitted: false, head: "h1" });
    expect(await mergeMission("chef")).not.toContain("Aquaman");
    agentActivityStore.getState().apply({ nodeId: "n1", activity: "idle", since: Date.now() });
    await vi.waitFor(() => expect(stopTerminal).toHaveBeenCalledWith("n1"));
    exit("n1");
    await vi.waitFor(() => expect(missionRemoveAgent).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(vi.mocked(stopTerminal).mock.calls.filter(([id]) => id === "n1")).toHaveLength(1);
    expect(missionRemoveAgent).toHaveBeenCalledOnce();
    expect(toldChef()).toEqual([]);
  });

  // Every merge takes the agents merged before: one left open had its cleanup run again at each, "it closes now" said
  // again and its Manager told again that it stays open, in a loop as long as the mission's merges went on.
  it("is told to its Manager once while it stays open; later merges try again without a word, and close it once it is free", async () => {
    await team();
    vi.mocked(takenOver).mockReturnValue(true);
    expect(await mergeMission("chef")).toContain("Aquaman: merged — it closes now");
    const once = [`Aquaman stays open after its merge: the user is at its terminal. ${LATER}`];
    await vi.waitFor(() => expect(toldChef()).toEqual(once));
    // Other agents' merges: nothing new of Aquaman's, the user still at it.
    vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "empty" }, uncommitted: false, head: "h1" });
    for (let merge = 0; merge < 3; merge++) expect(await mergeMission("chef")).not.toContain("Aquaman");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(toldChef()).toEqual(once);
    expect(stopTerminal).not.toHaveBeenCalled();
    // The user left it: the next merge closes it, quietly.
    vi.mocked(takenOver).mockReturnValue(false);
    expect(await mergeMission("chef")).not.toContain("Aquaman");
    await vi.waitFor(() => expect(stopTerminal).toHaveBeenCalledWith("n1"));
    exit("n1");
    await vi.waitFor(() => expect(missionRemoveAgent).toHaveBeenCalledOnce());
    expect(toldChef()).toEqual(once);
  });

  // The wait for its processes to exit may be long: the mission it was read from may be another by then, and its project's
  // worktrees and branches, by the same names, another mission's.
  for (const [what, change] of [
    ["the mission ended", () => endMission("chef", "Done.")],
    // The cleanup closes the agent too, and waits for the same exit.
    [
      "the mission was cleaned up",
      async () => {
        endMission("chef", "Done.");
        const cleaning = cleanMission("chef");
        terminalStatusStore.getState().set("n1", { state: "exited", code: 0 });
        await cleaning;
        // The cleanup's own close took the team off the canvas (#13); what follows is the merge's, which takes nothing.
        expect(removeNodes).toHaveBeenCalledWith(expect.arrayContaining(["n1"]));
        vi.mocked(removeNodes).mockClear();
      },
    ],
    ["the mission's slug is another", () => setMission("chef", { slug: "auth-2" })],
    ["the mission's project is another", () => setMission("chef", { project: "C:/code/other" })],
  ] as const) {
    it(`removes no worktree nor branch when ${what} while it waited for its processes to exit`, async () => {
      await team();
      await mergeMission("chef");
      await vi.waitFor(() => expect(stopTerminal).toHaveBeenCalledWith("n1"));
      await change();
      exit("n1");
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(missionRemoveAgent).not.toHaveBeenCalled();
      expect(removeNodes).not.toHaveBeenCalled();
    });
  }

  it("closes nothing when its merge left changes uncommitted, nor with Stop finished agents off", async () => {
    await team();
    vi.mocked(missionMerge).mockResolvedValueOnce({ merge: { kind: "merged" }, uncommitted: false, head: "h1" }).mockResolvedValueOnce({ merge: { kind: "merged" }, uncommitted: true, head: "h1" });
    expect(await mergeMission("chef")).not.toContain("it closes now");
    subagentSettingsStore.setState({ stopFinished: false });
    await team();
    vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "merged" }, uncommitted: false, head: "h1" });
    expect(await mergeMission("chef")).not.toContain("it closes now");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopTerminal).not.toHaveBeenCalled();
    expect(missionRemoveAgent).not.toHaveBeenCalled();
  });

  it("gives no other sub-task to an agent its merge closed, and asks for a new one while it is not merged yet", async () => {
    await team({ merged: true, squashed: "h1", cleanedUp: true });
    expect(await reassignTask("chef", "batman", "Aquaman")).toBe("Aquaman is merged and cleaned up: give the sub-task to new.");
    await team();
    expect(await reassignTask("chef", "batman", "Aquaman")).toBe('Aquaman finished "API" but its branch is not merged: merge it, then give the sub-task to new.');
    // With the setting off it would still take it once merged: the old advice stands.
    subagentSettingsStore.setState({ stopFinished: false });
    expect(await reassignTask("chef", "batman", "Aquaman")).toBe('Aquaman finished "API" but its branch is not merged: call merge first.');
  });
});
