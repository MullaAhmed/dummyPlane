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
import { missionAddAgent, missionCleanup, missionDiscard, missionMerge, missionPrepare, type Worktree } from "@/ipc/mission";
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
import { cleanMission, endMission, handoverText, launchMission, mergeMission, reassignTask, subTaskText, withTicketNote } from "./launch";
import { NEW_MISSION, type Member, type Mission } from "./mission";
import { missionOf, releaseTeamPermission, setMission, updateMember } from "./store";
import { setUpBoard, undoSetup } from "./manager";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/ipc/mission", () => ({ missionPrepare: vi.fn(), missionAddAgent: vi.fn(), missionMerge: vi.fn(), missionCleanup: vi.fn(), missionDiscard: vi.fn(() => Promise.resolve({ removed: [], kept: [] })) }));
vi.mock("@/ipc/pty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/pty")>()),
  ptySendText: vi.fn(() => Promise.resolve()),
  ptyWrite: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/nodes/terminal/registry", () => ({ relaunchTerminal: vi.fn(), stopTerminal: vi.fn(), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity), freshText: vi.fn(() => ""), markForAutostart: vi.fn() }));
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

it("writes an agent's sub-task on one line, with its budget, branch and duties (spec §7.3)", () => {
  expect(subTaskText("Auth", plan[1], "dummyplane/auth-aquaman")).toBe(
    "[dummyPlane · mission Auth] API — Fais l'API puis teste. Budget: 30 min. Branch: dummyplane/auth-aquaman. This worktree is new: its dependencies (node_modules…) are not installed. Declare your steps, delegate to your sub-agents, commit on your branch, then report with report.",
  );
});

describe("what dummyPlane types to agents, in English (spec première version §7.1)", () => {
  const english = async (check: () => Promise<void> | void) => {
    try {
      await check();
    } finally {
    }
  };

  it("writes the sub-task and the handover in the interface's language", () =>
    english(() => {
      expect(subTaskText("Auth", plan[1], "dummyplane/auth-aquaman")).toBe(
        "[dummyPlane · mission Auth] API — Fais l'API puis teste. Budget: 30 min. Branch: dummyplane/auth-aquaman. This worktree is new: its dependencies (node_modules…) are not installed. Declare your steps, delegate to your sub-agents, commit on your branch, then report with report.",
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
        branch.endsWith("batman") ? { merge: { kind: "merged" }, uncommitted: true } : { merge: { kind: "conflict", files: ["a.ts"] }, uncommitted: false },
      );
      expect(await mergeMission("chef")).toBe("Branch dummyplane/auth:\nBatman: merged (uncommitted changes in its worktree are not merged)\nAquaman: conflict, merge undone — a.ts");
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

describe("the model router (spec maj §3)", () => {
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

  it("does not launch with the router on and a sub-task without a level: it would run on the default model (final review maj §3)", async () => {
    await setup({ router: true });
    await launchMission("chef");
    expect(missionPrepare).not.toHaveBeenCalled();
    expect(missionNow()).toMatchObject({ state: "plan", error: expect.stringContaining("level") });
    expect(notify).toHaveBeenCalledWith("chef", expect.stringContaining("level"));
  });

  it("leaves the models alone without the router", async () => {
    await setup({ plan: [{ ...plan[0], level: "eleve" }, { ...plan[1], level: "faible" }] });
    await launchMission("chef");
    expect(vi.mocked(addTerminal).mock.calls[0][1].model).toBeUndefined();
    expect(terminalOf(nodesStore.getState().nodes.batman)?.model).toBeUndefined();
    expect(missionNow().members.map((m) => m.model)).toEqual([undefined, undefined]);
  });
});

describe("launchMission (spec §7.3)", () => {
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
    expect(setUpBoard).toHaveBeenCalledWith("chef", "w1", expect.objectContaining({ name: "Auth" }), "claude", inView);
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

  it("tells the Manager when an agent did not start, instead of typing into nothing", async () => {
    await setup();
    vi.mocked(addTerminal).mockResolvedValueOnce("n1");
    terminalStatusStore.getState().set("n1", { state: "stopped" });
    await launchMission("chef");
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("m1", expect.stringContaining("did not start")));
    expect(vi.mocked(ptySendText).mock.calls.some(([id]) => id === "n1")).toBe(false);
  });
});

describe("a new agent in a chosen group (spec groupes spécialisés §4)", () => {
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
    expect(setUpBoard).toHaveBeenCalledWith("chef", "w1", expect.anything(), "claude", quiet);
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

describe("a mission whose workspace is not on screen (spec mission de nuit §6.1)", () => {
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
    expect(setUpBoard).toHaveBeenCalledWith("chef", "w1", expect.anything(), "claude", inView);
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

describe("a mission's permissions (spec mission de nuit §5.3)", () => {
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

it("ends the mission: created agents closed, linked ones back in the project in a new conversation (spec §7.7)", async () => {
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

it("merges the branches of the agents done, and says what happened to each (spec §7.6)", async () => {
  const done = { summary: "ok", status: "termine" as const, at: 1 };
  await setup({
    state: "en_cours",
    worktree: "C:/w/auth",
    branch: "dummyplane/auth",
    members: [member("batman", "Batman", true, { report: done }), member("n1", "Aquaman", false, { report: done }), member("n2", "Flash", false, { report: { ...done, status: "bloque" } })],
  });
  vi.mocked(missionMerge).mockImplementation(async (_mission, _agent, branch) =>
    branch.endsWith("batman") ? { merge: { kind: "merged" }, uncommitted: true } : { merge: { kind: "conflict", files: ["a.ts"] }, uncommitted: false },
  );
  expect(await mergeMission("chef")).toBe(
    "Branch dummyplane/auth:\nBatman: merged (uncommitted changes in its worktree are not merged)\nAquaman: conflict, merge undone — a.ts",
  );
  expect(vi.mocked(missionMerge).mock.calls.map(([mission, agent, branch]) => [mission, agent, branch])).toEqual([
    ["C:/w/auth", "C:/w/batman", "dummyplane/auth-batman"],
    ["C:/w/auth", "C:/w/n1", "dummyplane/auth-n1"],
  ]);
  expect(missionNow().members.map((m) => m.merged === true)).toEqual([true, false, false]);
});

it("cleans a finished mission and frees the fleet for the next, its settings kept", async () => {
  await setup({ state: "terminee", budgetMin: 90, maxAgents: 3, project: "C:/code/proj", slug: "auth", summary: "ok", members: [member("batman", "Batman", true)] });
  // An old global budget is no setting any more: the next mission does without it.
  vi.mocked(missionCleanup).mockResolvedValue({ removed: ["auth-batman", "auth"], kept: [] });
  expect(await cleanMission("chef")).toEqual({ removed: ["auth-batman", "auth"], kept: [] });
  expect(missionCleanup).toHaveBeenCalledWith("C:/code/proj", "auth", ["Batman"]);
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
  expect(await first).toEqual({ removed: ["auth-batman", "auth"], kept: [] });
  expect(await second).toEqual({ removed: ["auth-batman", "auth"], kept: [] });
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
  vi.mocked(missionCleanup).mockResolvedValue({ removed: [], kept: [] });
  await cleanMission("chef");
  expect(missionCleanup).toHaveBeenCalledWith("C:/code/proj", "auth", ["Batman", "Aquaman", "Cyborg"]);
});

it("keeps the router setting when the mission is cleaned (backlog 27 oct)", async () => {
  await setup({ state: "terminee", budgetMin: 90, maxAgents: 3, router: true, project: "C:/code/proj", slug: "auth", summary: "ok", members: [member("batman", "Batman", true)] });
  vi.mocked(missionCleanup).mockResolvedValue({ removed: [], kept: [] });
  await cleanMission("chef");
  expect(missionNow()).toMatchObject({ state: "redaction", router: true });
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
    vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "empty" }, uncommitted: false });
    expect(await mergeMission("chef")).toBe("Branch dummyplane/auth:\nBatman: already merged, nothing new");
    expect(missionNow().members[0].merged).toBe(true);
  });
});

describe("reassignTask (spec §7.2 reattribuer)", () => {
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

  it("does not open a new agent while Max agents are at work", async () => {
    await setup({ state: "en_cours", maxAgents: 2, project: "C:/code/proj", slug: "auth", frameId: "f1", members: [member("batman", "Batman", true, { task: "Login" }), member("n1", "Aquaman", false, { task: "API" })] });
    expect(await reassignTask("chef", "batman", "nouveau")).toBe('2 agents are already at work (Max active agents): reassign to an agent that has reported instead of "new", or wait for one to finish.');
    expect(missionAddAgent).not.toHaveBeenCalled();
    expect(pauseAgents).not.toHaveBeenCalled();
  });

  it("still refuses one when two others are at work, the one handing over having reported", async () => {
    const blocked = { summary: "bloqué", status: "bloque" as const, at: 1 };
    // Its sub-task not typed yet, Shazam's terminal is still starting: it holds its seat.
    const members = [member("batman", "Batman", true, { task: "Login", report: blocked }), member("n1", "Aquaman", false, { task: "API" }), member("n2", "Shazam", false, { task: "Docs", sentAt: undefined })];
    await setup({ state: "en_cours", maxAgents: 2, project: "C:/code/proj", slug: "auth", frameId: "f1", members });
    expect(await reassignTask("chef", "batman", "nouveau")).toContain("Max active agents");
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

it("leaves a handed-over agent's branch to its successor when merging (final review H3)", async () => {
  const done = { summary: "ok", status: "termine" as const, at: 1 };
  await setup({ state: "en_cours", worktree: "C:/w/auth", branch: "dummyplane/auth", members: [member("batman", "Batman", true, { report: done, handedTo: "Aquaman" }), member("n1", "Aquaman", false, { report: done })] });
  vi.mocked(missionMerge).mockResolvedValue({ merge: { kind: "merged" }, uncommitted: false });
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

describe("the board the go-ahead runs the mission on (spec babysitter Fleet)", () => {
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
