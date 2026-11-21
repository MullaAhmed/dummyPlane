// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentWaitingAgents, waitingAgents } from "@/agents/waitingAgents";
import { agentActivityStore, personActivities, withDecision } from "@/store/agentActivity";
import { fleetDecisionsStore } from "@/store/fleetDecisions";
import { nodesStore, type NodeRecord } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { decisionOf, installFleetDecisions } from "./decisions";
import { leftoversStore, type LeftoversRequest } from "./leftovers";
import { NEW_MISSION, type LandRequest, type Mission } from "./mission";

// Excalidraw does not load under Vitest (roughjs): the leftovers' question reaches it through the toasts' canvas check.
vi.mock("@excalidraw/excalidraw", () => ({}));

const plan: Mission = { ...NEW_MISSION, state: "plan", name: "Checkout coupons", plan: [1, 2, 3, 4].map((n) => ({ title: `Task ${n}`, brief: "", agent: "nouveau", budgetMin: 20 })) };
const landing: LandRequest = { target: "main", branch: "dummyplane/coupons", tip: "abc1234", commits: [], count: 2, fastForward: true, at: 500 };
const finished: Mission = { ...NEW_MISSION, state: "terminee", name: "Checkout coupons", project: "C:/code", worktree: "C:/code/.wt", landing };
const leftovers: LeftoversRequest = { at: 700, project: "C:/code", leftovers: { worktrees: [], branches: [], trash: [], strays: [] } as never };

/** A Fleet of workspace w1, its mission `mission`, its last report `report`. */
const fleet = (mission?: Mission, report?: "done"): NodeRecord =>
  ({
    workspaceId: "w1",
    kind: "fleet",
    payload: {
      name: "Atlas",
      ...(mission ? { mission } : {}),
      session: { title: "Atlas", name: "Atlas", agent: "claude", cwd: "C:/code", shell: "default", command: "", ...(report ? { lastReport: { status: report, summary: "Planned" } } : {}) },
    },
  }) as NodeRecord;

describe("decisionOf", () => {
  it("reads a plan waiting for the go-ahead, changes to the waiting tasks, Land and Clean up as the panel asks them", () => {
    expect(decisionOf(plan)).toEqual({ kind: "plan" });
    expect(decisionOf({ ...plan, state: "en_cours", amendment: { task: "More", tasks: [], drop: [] } })).toEqual({ kind: "changes" });
    expect(decisionOf(finished)).toEqual({ kind: "land", at: 500 });
    expect(decisionOf({ ...finished, state: "en_cours" })).toEqual({ kind: "land", at: 500 });
    expect(decisionOf(undefined, leftovers)).toEqual({ kind: "leftovers", at: 700 });
    expect(decisionOf(plan, leftovers)).toEqual({ kind: "leftovers", at: 700 });
  });

  it("waits on nothing while nothing is asked: a task to write, a team at work, a launch that failed, an overnight run that launches itself", () => {
    expect(decisionOf(undefined)).toBeNull();
    expect(decisionOf(NEW_MISSION)).toBeNull();
    expect(decisionOf({ ...plan, state: "lancement" })).toBeNull();
    expect(decisionOf({ ...plan, state: "en_cours" })).toBeNull();
    expect(decisionOf({ ...finished, landing: undefined })).toBeNull();
    // The panel shows the error instead, beside the red dot.
    expect(decisionOf({ ...plan, error: "git failed" })).toBeNull();
    expect(decisionOf({ ...plan, overnight: true, autoLaunch: true })).toBeNull();
    // A Land question of a mission that cannot land any more (cleaned up to a new draft) is no question.
    expect(decisionOf({ ...NEW_MISSION, landing })).toBeNull();
  });
});

describe("installFleetDecisions", () => {
  let uninstall: () => void = () => undefined;
  let now = 1000;

  beforeEach(() => {
    now = 1000;
    nodesStore.setState({ nodes: {} });
    leftoversStore.setState({ asks: {} });
    fleetDecisionsStore.setState({ decisions: {} });
    agentActivityStore.setState({ activities: {}, under: {} });
    terminalStatusStore.setState({ statuses: { atlas: { state: "running" } } });
    workspacesStore.setState({ workspaces: [{ id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder: null }] });
    uninstall = installFleetDecisions(() => now);
  });

  afterEach(() => uninstall());

  const decision = () => fleetDecisionsStore.getState().decisions.atlas;
  const setMission = (mission: Mission) => nodesStore.setState((s) => ({ nodes: { ...s.nodes, atlas: fleet(mission) } }));

  it("makes a plan proposed a wait from then on, kept at its first date while it stands, and lets go at the go-ahead", () => {
    nodesStore.setState({ nodes: { atlas: fleet(NEW_MISSION) } });
    expect(decision()).toBeUndefined();
    setMission(plan);
    expect(decision()).toEqual({ kind: "plan", since: 1000, message: "Checkout coupons · 4 sub-tasks" });
    now = 2000;
    setMission({ ...plan, name: "Coupons" });
    expect(decision()).toEqual({ kind: "plan", since: 1000, message: "Coupons · 4 sub-tasks" });
    setMission({ ...plan, state: "lancement" });
    expect(decision()).toBeUndefined();
  });

  it("dates Land and Clean up by their question, and says what they ask in the panel's words", () => {
    nodesStore.setState({ nodes: { atlas: fleet({ ...finished, landing: undefined }) } });
    setMission(finished);
    expect(decision()).toEqual({ kind: "land", since: 500, message: "Land the mission on main?" });
    setMission({ ...finished, landing: undefined });
    expect(decision()).toBeUndefined();
    leftoversStore.setState({ asks: { atlas: leftovers } });
    expect(decision()).toEqual({ kind: "leftovers", since: 700, message: "Clean up the leftovers of past missions?" });
    leftoversStore.setState({ asks: {} });
    expect(decision()).toBeUndefined();
  });

  it("marks a decision found as its Fleet is first read as standing (no new alert), and a later one as news", () => {
    // Its project opens: the Fleet is read with its plan pending.
    nodesStore.setState({ nodes: { atlas: fleet(plan) } });
    expect(decision()).toMatchObject({ kind: "plan", standing: true });
    // The user lands the plan; the mission finishes, and the Fleet asks to land it: that one is news.
    setMission({ ...plan, state: "en_cours" });
    setMission(finished);
    expect(decision()).toEqual({ kind: "land", since: 500, message: "Land the mission on main?" });
  });

  it("leaves the Fleet's agent as it is: a line still reaches its terminal, while the person reads Waiting", () => {
    nodesStore.setState({ nodes: { atlas: fleet(NEW_MISSION, "done") } });
    agentActivityStore.getState().apply({ nodeId: "atlas", activity: "idle", since: 10 });
    setMission(plan);
    expect(agentActivityStore.getState().activities.atlas.activity).toBe("idle");
    expect(personActivities().atlas).toEqual({ activity: "waiting", since: 1000, message: "Checkout coupons · 4 sub-tasks", decision: "plan" });
    expect(currentWaitingAgents()).toEqual([
      { id: "atlas", kind: "fleet", name: "Atlas", workspaceId: "w1", since: 1000, message: "Checkout coupons · 4 sub-tasks", decision: "plan" },
    ]);
    // A Fleet that is not running waits on nothing, as an agent's question.
    const stopped = { atlas: { state: "stopped" as const } };
    expect(waitingAgents(["w1"], nodesStore.getState().nodes, stopped, personActivities())).toEqual([]);
  });

  it("keeps the same reading object while nothing changes: a hook re-renders only on news", () => {
    setMission(plan);
    expect(personActivities()).toBe(personActivities());
  });
});

describe("withDecision", () => {
  const asked = { kind: "plan" as const, since: 5, message: "Coupons · 4 sub-tasks" };

  it("reads a Fleet that waits on a decision as waiting, whatever its terminal does", () => {
    expect(withDecision(undefined, asked)).toEqual({ activity: "waiting", since: 5, message: "Coupons · 4 sub-tasks", decision: "plan" });
    expect(withDecision({ activity: "working", since: 1 }, asked)).toMatchObject({ activity: "waiting", decision: "plan" });
  });

  it("keeps a question on its screen as what it waits on, and a Fleet whose Claude exited waits on nothing", () => {
    const question = { activity: "waiting" as const, since: 3, message: "May I run the tests?" };
    expect(withDecision(question, asked)).toBe(question);
    const left = { activity: "idle" as const, since: 3, left: true };
    expect(withDecision(left, asked)).toBe(left);
    expect(withDecision(question, undefined)).toBe(question);
  });
});
