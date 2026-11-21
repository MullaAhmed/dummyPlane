// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { recordNotification } from "@/notifications/capture";
import { freshText } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { installMissionClock } from "./clock";
import { notify } from "./events";
import type { Member } from "./mission";
import { HELD_MS, LOGIN_MS, MEMBER_IDLE_MS, RUNNER_IDLE_MS, UNHEARD_MS, checkStalls, forgetStalls, trackChildReport } from "./stalls";
import { setMission, updateMember } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
vi.mock("./events", () => ({ notify: vi.fn() }));
vi.mock("@/agents/talkWires", () => ({ talk: vi.fn() }));
vi.mock("@/nodes/terminal/registry", () => ({ freshText: vi.fn(() => "") }));
vi.mock("@/notifications/capture", () => ({ recordNotification: vi.fn() }));
vi.mock("@/shell/waitingAlert", () => ({ alertStuck: vi.fn() }));

const min = 60_000;
const member = (nodeId: string, name: string): Member => ({ nodeId, name, task: `${name}'s task`, budgetMin: 600, linked: false, branch: `b-${nodeId}`, worktree: "w", sentAt: 0 });
const act = (nodeId: string, activity: "idle" | "working" | "waiting", since: number, message?: string) =>
  agentActivityStore.getState().apply({ nodeId, activity, since, ...(message ? { message } : {}) });
const lines = () => vi.mocked(notify).mock.calls.map(([to, line]) => [to, line]);

beforeAll(async () => {
  mockIPC(() => undefined);
  for (const [id, name] of [["batman", "Batman"], ["aquaman", "Aquaman"], ["boss", "Boss"], ["parent", "Parent"]]) {
    await nodesStore.getState().create(id, {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: name, name, agent: "claude", cwd: "C:/w", shell: "default", command: "" },
    });
  }
  // The old way: the Fleet runs the mission itself. The other fleet has a Manager.
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", mission: { state: "en_cours", maxAgents: 4, members: [member("batman", "Batman")] } } });
  await nodesStore.getState().create("sitter", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Sitter", mission: { state: "en_cours", maxAgents: 4, manager: "boss", members: [member("aquaman", "Aquaman")] } },
  });
});

beforeEach(() => {
  forgetStalls();
  vi.clearAllMocks();
  vi.mocked(freshText).mockReturnValue("");
  for (const id of ["batman", "aquaman", "boss", "chef", "sitter", "parent"]) terminalStatusStore.getState().set(id, { state: "running" });
  for (const id of ["batman", "aquaman", "boss", "chef", "sitter", "parent"]) {
    agentActivityStore.getState().remove(id);
    act(id, "working", 0);
  }
  setMission("chef", { members: [member("batman", "Batman")], queue: undefined });
  setMission("sitter", { members: [member("aquaman", "Aquaman")], queue: undefined });
});

describe("a team agent idle without having reported", () => {
  it("tells its runner once, with what to do, after the threshold and not before", () => {
    act("batman", "idle", 0);
    checkStalls(MEMBER_IDLE_MS - 1);
    expect(notify).not.toHaveBeenCalled();
    checkStalls(MEMBER_IDLE_MS);
    expect(lines()).toEqual([
      ["chef", expect.stringContaining("Batman (Batman's task) has been idle for 10 min without reporting, and no dialog waits for the user.")],
    ]);
    expect(lines()[0][1]).toContain("read_output");
    // The same stall is not told again, however long it lasts.
    checkStalls(MEMBER_IDLE_MS + 30 * min);
    checkStalls(MEMBER_IDLE_MS + 60 * min);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("tells a Manager's team agent's stall to the Manager, not to the Fleet", () => {
    act("aquaman", "idle", 0);
    checkStalls(MEMBER_IDLE_MS);
    expect(lines().map(([to]) => to)).toEqual(["boss"]);
  });

  it("tells again when the agent worked in between: a new stall", () => {
    act("batman", "idle", 0);
    checkStalls(MEMBER_IDLE_MS);
    act("batman", "working", MEMBER_IDLE_MS + 1000);
    checkStalls(MEMBER_IDLE_MS + 2000);
    act("batman", "idle", MEMBER_IDLE_MS + 3000);
    checkStalls(2 * MEMBER_IDLE_MS + 3000);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("leaves alone an agent at work, one that reported, one waiting on its own sub-agents and one that is stopped", async () => {
    act("batman", "working", 0);
    checkStalls(5 * MEMBER_IDLE_MS);
    act("batman", "idle", 0);
    updateMember("chef", "batman", { report: { summary: "ok", status: "termine", at: 1 } });
    checkStalls(5 * MEMBER_IDLE_MS);
    updateMember("chef", "batman", { report: undefined });
    terminalStatusStore.getState().set("batman", { state: "stopped" });
    checkStalls(5 * MEMBER_IDLE_MS);
    terminalStatusStore.getState().set("batman", { state: "running" });
    await nodesStore.getState().create("kid", {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: "Kid", name: "Kid", agent: "claude", cwd: "C:/w", shell: "default", command: "", spawnedBy: "batman" },
    });
    terminalStatusStore.getState().set("kid", { state: "running" });
    checkStalls(5 * MEMBER_IDLE_MS);
    expect(notify).not.toHaveBeenCalled();
    // Its sub-agent reported: nothing keeps Batman's turn open now, and it is stalled.
    nodesStore.getState().update("kid", { lastReport: { status: "done", summary: "ok" } });
    checkStalls(5 * MEMBER_IDLE_MS);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("is checked by the clock itself, once however many looks", () => {
    vi.useFakeTimers();
    try {
      updateMember("chef", "batman", { sentAt: Date.now() });
      act("batman", "idle", Date.now());
      const stop = installMissionClock();
      vi.advanceTimersByTime(MEMBER_IDLE_MS + 5 * min);
      stop();
      expect(vi.mocked(notify).mock.calls.filter(([to]) => to === "chef").map(([, l]) => l)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("an agent held by a dialog or an expired login", () => {
  it("tells the runner and the user once, when a dialog has waited long, and names the dialog", () => {
    act("batman", "waiting", 0, "Claude needs your permission to use Bash");
    checkStalls(HELD_MS - 1);
    expect(notify).not.toHaveBeenCalled();
    checkStalls(HELD_MS);
    checkStalls(HELD_MS + 5 * min);
    expect(lines()).toEqual([["chef", expect.stringContaining("Batman has waited for the user for 10 min")]]);
    expect(lines()[0][1]).toContain("need_user");
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(recordNotification).toHaveBeenCalledWith(expect.objectContaining({ type: "question", kind: "warning", context: { nodeId: "batman", workspaceId: "w1" } }));
  });

  it("tells an idle agent whose screen says its login expired, long before an ordinary stall", () => {
    act("batman", "idle", 0);
    vi.mocked(freshText).mockReturnValue("> work\n  Login expired · Please run /login");
    checkStalls(LOGIN_MS - 1);
    expect(notify).not.toHaveBeenCalled();
    checkStalls(LOGIN_MS);
    checkStalls(LOGIN_MS + 30 * min);
    expect(lines()).toEqual([["chef", expect.stringContaining("Batman has been held for 3 min by an expired login")]]);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordNotification).mock.calls[0][0].description).toContain("run /login");
  });

  it("tells the user, and the Fleet, that a Manager's login expired", () => {
    act("boss", "idle", 0);
    vi.mocked(freshText).mockImplementation((id) => (id === "boss" ? "Login expired · Please run /login" : ""));
    checkStalls(LOGIN_MS);
    expect(lines()).toEqual([["sitter", expect.stringContaining("Boss (the Manager) has been held for 3 min by an expired login")]]);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
});

describe("a runner idle while its mission has open work", () => {
  it("tells a Fleet that runs the mission itself, once, until the work changes", () => {
    updateMember("chef", "batman", { report: { summary: "ok", status: "termine", at: 1 } });
    act("chef", "idle", 0);
    checkStalls(RUNNER_IDLE_MS - 1);
    expect(notify).not.toHaveBeenCalled();
    checkStalls(RUNNER_IDLE_MS);
    expect(lines()).toEqual([["chef", "You have been idle for 5 min while the mission has open work: done, not merged: Batman. Look at team, then act on it: merge, write, reassign or finish."]]);
    // The notice made it work; it idles again with the same left: not told twice.
    act("chef", "working", RUNNER_IDLE_MS + 1000);
    checkStalls(RUNNER_IDLE_MS + 2000);
    act("chef", "idle", RUNNER_IDLE_MS + 3000);
    checkStalls(3 * RUNNER_IDLE_MS);
    expect(notify).toHaveBeenCalledTimes(1);
    // New work left (a second agent blocked): told again.
    setMission("chef", { members: [member("batman", "Batman"), { ...member("aquaman", "Aquaman"), report: { summary: "?", status: "bloque", at: 2 } }] });
    updateMember("chef", "batman", { report: { summary: "ok", status: "termine", at: 1 } });
    checkStalls(4 * RUNNER_IDLE_MS);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(lines()[1][1]).toContain("blocked or failed, waiting for a decision: Aquaman");
  });

  it("tells the Fleet when its Manager is the one idle", () => {
    updateMember("sitter", "aquaman", { report: { summary: "ok", status: "termine", at: 1 } });
    act("boss", "idle", 0);
    checkStalls(RUNNER_IDLE_MS);
    expect(lines()).toEqual([["sitter", expect.stringContaining("Boss (the Manager) has been idle for 5 min while the mission has open work: done, not merged: Aquaman.")]]);
    expect(lines()[0][1]).toContain("message_manager");
  });

  it("lets a Manager rest while a teammate works, though a report waits to be merged; not once nobody works, nor with a task queued", () => {
    updateMember("sitter", "aquaman", { report: { summary: "ok", status: "termine", at: 1 } });
    setMission("sitter", { members: [{ ...member("aquaman", "Aquaman"), report: { summary: "ok", status: "termine", at: 1 } }, member("robin", "Robin")] });
    act("boss", "idle", 0);
    // Aquaman done, Robin at work: the Manager is where it should be.
    checkStalls(10 * RUNNER_IDLE_MS);
    expect(notify).not.toHaveBeenCalled();
    // A task waits in the queue behind the merge: it is the Manager's to move.
    setMission("sitter", { queue: [{ title: "Next", brief: "b", budgetMin: 10 }] });
    checkStalls(10 * RUNNER_IDLE_MS);
    expect(lines()).toEqual([["sitter", expect.stringContaining("done, not merged: Aquaman")]]);
    // Nobody left at work, the queue empty: it is its to merge too.
    vi.mocked(notify).mockClear();
    forgetStalls();
    setMission("sitter", { queue: undefined, members: [{ ...member("aquaman", "Aquaman"), report: { summary: "ok", status: "termine", at: 1 } }, { ...member("robin", "Robin"), report: { summary: "ok", status: "termine", at: 2 } }] });
    checkStalls(10 * RUNNER_IDLE_MS);
    expect(lines()).toEqual([["sitter", expect.stringContaining("done, not merged: Aquaman, Robin")]]);
  });

  it("says nothing while the team's own work is under way, or the runner works", () => {
    act("chef", "idle", 0);
    // Batman is at work: nothing for the runner to act on.
    checkStalls(10 * RUNNER_IDLE_MS);
    expect(notify).not.toHaveBeenCalled();
    updateMember("chef", "batman", { report: { summary: "ok", status: "termine", at: 1 }, merged: true });
    // Everyone reported and merged, the mission still open: the finish is left.
    checkStalls(10 * RUNNER_IDLE_MS);
    expect(lines()[0][1]).toContain("every agent reported and the queue is empty, the mission is not finished");
    vi.mocked(notify).mockClear();
    forgetStalls();
    act("chef", "working", 0);
    checkStalls(10 * RUNNER_IDLE_MS);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("a report typed into a parent that never took it up", () => {
  const typedAt = 1000;
  afterEach(() => forgetStalls());

  it("is typed again once, after the wait, while the parent stays idle", () => {
    act("parent", "idle", 0);
    trackChildReport("parent", "Kid", "done", "T6 done", typedAt);
    checkStalls(typedAt + UNHEARD_MS - 1);
    expect(notify).not.toHaveBeenCalled();
    checkStalls(typedAt + UNHEARD_MS);
    checkStalls(typedAt + 2 * UNHEARD_MS);
    expect(lines()).toEqual([["parent", "Reminder, the line below went unanswered: Kid reported (done): T6 done"]]);
  });

  it("is let go when the parent works on it", () => {
    act("parent", "idle", 0);
    trackChildReport("parent", "Kid", "done", "T6 done", typedAt);
    act("parent", "working", typedAt + 800);
    checkStalls(typedAt + 5 * UNHEARD_MS);
    expect(notify).not.toHaveBeenCalled();
  });

  it("is let go when the parent took it up and was idle again at the next look: it moved, however briefly", () => {
    act("parent", "idle", 0);
    trackChildReport("parent", "Kid", "done", "T6 done", typedAt);
    // Its turn on the report was over in seconds.
    act("parent", "working", typedAt + 300);
    act("parent", "idle", typedAt + 2000);
    checkStalls(typedAt + 5 * UNHEARD_MS);
    expect(notify).not.toHaveBeenCalled();
  });
});
