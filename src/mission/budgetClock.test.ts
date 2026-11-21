// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { CLOCK_MS, MAX_LOOK_GAP_MS, checkBudgets, forgetLooks } from "./clock";
import { notify } from "./events";

import { memberBudgets, missionOf, setMission, updateMember } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
vi.mock("./events", () => ({ notify: vi.fn((_fleet: string, _line: string, typed?: () => void) => typed?.()) }));

const min = 60_000;
const batman = { nodeId: "batman", name: "Batman", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 0 };
const act = (nodeId: string, activity: "idle" | "working" | "waiting", since = 0) => {
  agentActivityStore.getState().remove(nodeId);
  agentActivityStore.getState().apply({ nodeId, activity, since });
};
const lines = () => vi.mocked(notify).mock.calls.map(([, line]) => line);
const member = () => missionOf(nodesStore.getState().nodes.chef)!.members[0];

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", mission: { state: "en_cours", name: "Auth", maxAgents: 4, startedAt: 0, members: [batman] } },
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  forgetLooks();
  setMission("chef", { state: "en_cours", overnight: undefined, budgetMin: undefined, startedAt: 0, members: [{ ...batman }] });
  terminalStatusStore.getState().set("batman", { state: "running" });
  terminalStatusStore.getState().set("chef", { state: "running" });
  act("batman", "working");
  act("chef", "idle");
});

describe("the warning ahead of a budget's end", () => {
  it("tells the runner at 80 % of the budget, once, and the overrun still comes at 100 %", () => {
    checkBudgets(7 * min);
    expect(notify).not.toHaveBeenCalled();
    checkBudgets(8 * min);
    checkBudgets(9 * min);
    expect(lines()).toEqual([
      "Budget nearly used: Batman (Login) has used 80 % of its 10 min (2 min left) and has not reported. See where it stands with read_output: extend now if it is moving, or write it to wrap up and report.",
    ]);
    expect(member().nearTold).toBe(true);
    checkBudgets(10 * min);
    expect(lines()[1]).toBe("Budget used up: Batman (Login) went past its 10 min without reporting. Decide: write, extend, interrupt or reassign.");
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("does not warn a night's agent: its budget is a target and nobody is there", () => {
    setMission("chef", { overnight: true, budgetMin: 100 });
    checkBudgets(9 * min);
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not warn an agent that reported, nor one whose clock jumped past its budget", () => {
    updateMember("chef", "batman", { report: { summary: "ok", status: "termine", at: 8 * min } });
    checkBudgets(9 * min);
    updateMember("chef", "batman", { report: undefined });
    checkBudgets(11 * min);
    expect(lines().map((l) => l.split(":")[0])).toEqual(["Budget used up"]);
  });

  it("warns again once an extension takes the agent below 80 % again", () => {
    checkBudgets(8 * min);
    expect(member().nearTold).toBe(true);
    // extend: 10 more minutes (the tool's own bookkeeping, as `prolong` does it).
    updateMember("chef", "batman", { extraMin: 10, nearTold: undefined });
    checkBudgets(9 * min);
    expect(notify).toHaveBeenCalledTimes(1);
    checkBudgets(16 * min);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(lines()[1]).toContain("80 % of its 20 min (4 min left)");
  });
});

describe("time spent waiting on the user", () => {
  /** Looks every `CLOCK_MS` from `from` to `to`, as the clock does. */
  const look = (from: number, to: number) => {
    for (let at = from; at <= to; at += CLOCK_MS) checkBudgets(at);
  };

  it("does not count against the budget while the whole mission waits on a dialog", () => {
    // An hour of nobody at work, Batman at an expired login's dialog, its Manager resting.
    act("batman", "waiting");
    look(0, 60 * min);
    expect(member().pausedMs).toBe(60 * min);
    expect(memberBudgets(nodesStore.getState().nodes, 60 * min).batman.spent).toBe(0);
    // No overrun and no warning for time nobody could use.
    expect(notify).not.toHaveBeenCalled();
    // At work again, its time runs.
    act("batman", "working", 60 * min + 1);
    look(60 * min + CLOCK_MS, 66 * min);
    expect(memberBudgets(nodesStore.getState().nodes, 66 * min).batman.spent).toBeCloseTo(6, 1);
  });

  it("counts the time of an idle agent and of a mission where someone still works", () => {
    act("batman", "idle");
    look(0, 5 * min);
    expect(member().pausedMs).toBeUndefined();
    act("batman", "waiting");
    act("chef", "working", 1);
    look(5 * min + CLOCK_MS, 8 * min);
    expect(member().pausedMs).toBeUndefined();
  });

  it("counts the pause of a window whose timers run once a minute, not of a machine that slept", () => {
    act("batman", "waiting");
    // A hidden window: one look a minute, for ten minutes.
    for (let at = 0; at <= 10 * min; at += min) checkBudgets(at);
    expect(member().pausedMs).toBe(10 * min);
    // The next look comes three hours later: no more than the cap of a look is counted.
    checkBudgets(10 * min + 3 * 60 * min);
    expect(member().pausedMs).toBe(10 * min + MAX_LOOK_GAP_MS);
  });
});
