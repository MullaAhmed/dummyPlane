// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { nodesStore } from "@/store/nodes";
import { checkBudgets } from "./clock";
import { notify } from "./events";
import { terminalStatusStore } from "@/store/terminalStatus";
import { missionOf, setMission, setFleetClosed, updateMember } from "./store";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
vi.mock("./events", () => ({ notify: vi.fn((_fleet: string, _line: string, typed?: () => void) => typed?.()) }));

const min = 60_000;
beforeAll(async () => {
  mockIPC(() => undefined);
  terminalStatusStore.getState().set("batman", { state: "running" });
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: {
      name: "Chef",
      mission: {
        state: "en_cours",
        name: "Auth",
        maxAgents: 4,
        budgetMin: 30,
        startedAt: 0,
        members: [{ nodeId: "batman", name: "Batman", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 0 }],
      },
    },
  });
});

it("tells the fleet once when a budget runs out, warns the user at 200 % and at the end of the global budget (spec §8.2)", () => {
  checkBudgets(5 * min);
  expect(notify).not.toHaveBeenCalled();
  checkBudgets(11 * min);
  checkBudgets(12 * min);
  expect(vi.mocked(notify).mock.calls.map(([to, line]) => [to, line])).toEqual([
    ["chef", "Budget used up: Batman (Login) went past its 10 min without reporting. Decide: write, extend, interrupt or reassign."],
  ]);
  expect(missionOf(nodesStore.getState().nodes.chef)?.members[0].overdue).toBe(1);
  checkBudgets(21 * min);
  checkBudgets(22 * min);
  expect(toast.warning).toHaveBeenCalledTimes(1);
  expect(toast.warning).toHaveBeenCalledWith("Batman has gone over twice its budget (10 min) without reporting");
  checkBudgets(31 * min);
  checkBudgets(40 * min);
  expect(vi.mocked(notify).mock.calls.map(([to, line]) => [to, line])[1]).toEqual(["chef", "Overall budget used up (30 min): finish with what is done."]);
  expect(notify).toHaveBeenCalledTimes(2);
  expect(toast.warning).toHaveBeenLastCalledWith("Mission Auth: overall budget used up (30 min)");
  expect(missionOf(nodesStore.getState().nodes.chef)?.globalOverdue).toBe(true);
});

describe("an overnight mission (spec mission de nuit §3)", () => {
  const fresh = { nodeId: "batman", name: "Batman", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 0 };
  const night = () => setMission("chef", { overnight: true, budgetMin: 100, startedAt: 0, members: [fresh], globalOverdue: undefined, windDownTold: undefined });

  beforeEach(() => {
    vi.clearAllMocks();
    terminalStatusStore.getState().set("batman", { state: "running" });
  });
  afterEach(() => setMission("chef", { overnight: undefined, windDownTold: undefined, globalOverdue: undefined, budgetMin: 30 }));

  it("treats an agent's budget as a target: a line that says so, and no toast for an empty room", () => {
    night();
    checkBudgets(11 * min);
    expect(vi.mocked(notify).mock.calls[0][1]).toBe("Target passed: Batman (Login) went past its 10 min, which is only a target. See where it stands with read_output; let it finish if it is moving.");
    checkBudgets(21 * min);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("tells the fleet once to wind down, and leaves the end of the budget without a toast", () => {
    night();
    updateMember("chef", "batman", { overdue: 2 });
    checkBudgets(89 * min);
    expect(notify).not.toHaveBeenCalled();
    checkBudgets(90 * min);
    checkBudgets(91 * min);
    expect(vi.mocked(notify).mock.calls.map(([, line]) => line)).toEqual(["10 min left: the queue gives out no more tasks. Merge what is done, have it checked, then finish."]);
    expect(missionOf(nodesStore.getState().nodes.chef)?.windDownTold).toBe(true);
    checkBudgets(100 * min);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("does not wind down a night whose budget was already told as over: the app was closed through it", () => {
    night();
    setMission("chef", { globalOverdue: true });
    updateMember("chef", "batman", { overdue: 2 });
    checkBudgets(120 * min);
    expect(notify).not.toHaveBeenCalled();
  });

  it("says it in English", () => {
    try {
      night();
      checkBudgets(11 * min);
      expect(vi.mocked(notify).mock.calls[0][1]).toBe("Target passed: Batman (Login) went past its 10 min, which is only a target. See where it stands with read_output; let it finish if it is moving.");
      updateMember("chef", "batman", { overdue: 2 });
      checkBudgets(90 * min);
      expect(vi.mocked(notify).mock.calls[1][1]).toBe("10 min left: the queue gives out no more tasks. Merge what is done, have it checked, then finish.");
    } finally {
    }
  });
});

it("says nothing about the mission of a closed fleet (spec première version §5.4)", () => {
  const fresh = { nodeId: "batman", name: "Batman", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 0 };
  setMission("chef", { members: [fresh], globalOverdue: undefined });
  vi.mocked(notify).mockClear();
  vi.mocked(toast.warning).mockClear();
  setFleetClosed("chef", true);
  checkBudgets(100 * min);
  expect(notify).not.toHaveBeenCalled();
  expect(toast.warning).not.toHaveBeenCalled();
  setFleetClosed("chef", false);
  checkBudgets(100 * min);
  expect(notify).toHaveBeenCalled();
});

it("tells the fleet and the user in English when the interface is (spec première version §7.1)", () => {
  const fresh = { nodeId: "batman", name: "Batman", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 0 };
  setMission("chef", { members: [fresh], globalOverdue: undefined });
  vi.mocked(notify).mockClear();
  vi.mocked(toast.warning).mockClear();
  try {
    checkBudgets(100 * min);
    expect(vi.mocked(notify).mock.calls.map(([to, line]) => [to, line])).toEqual([
      ["chef", "Budget used up: Batman (Login) went past its 10 min without reporting. Decide: write, extend, interrupt or reassign."],
      ["chef", "Overall budget used up (30 min): finish with what is done."],
    ]);
    expect(vi.mocked(toast.warning).mock.calls).toEqual([
      ["Batman has gone over twice its budget (10 min) without reporting"],
      ["Mission Auth: overall budget used up (30 min)"],
    ]);
  } finally {
  }
});

it("says nothing for a stopped agent, and records an overrun as told only once its line is typed (backlog H3)", () => {
  const fresh = { nodeId: "batman", name: "Batman", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 0 };
  setMission("chef", { state: "en_cours", members: [fresh], globalOverdue: undefined, budgetMin: undefined });
  vi.mocked(notify).mockClear();
  vi.mocked(toast.warning).mockClear();
  terminalStatusStore.getState().set("batman", { state: "stopped" });
  checkBudgets(60 * min);
  expect(notify).not.toHaveBeenCalled();
  expect(toast.warning).not.toHaveBeenCalled();
  terminalStatusStore.getState().set("batman", { state: "running" });
  // The fleet is busy: the line waits, and the overrun is not recorded as told.
  vi.mocked(notify).mockImplementationOnce(() => undefined);
  checkBudgets(60 * min);
  expect(missionOf(nodesStore.getState().nodes.chef)?.members[0].overdue).toBeUndefined();
  checkBudgets(60 * min);
  expect(notify).toHaveBeenCalledTimes(1);
});

it("tells a budget once even while the fleet cannot hear, and records the worst (review)", async () => {
  vi.mocked(notify).mockReset();
  vi.mocked(toast.warning).mockClear();
  const pending: (() => void)[] = [];
  vi.mocked(notify).mockImplementation((_fleet: string, _line: string, typed?: () => void) => void (typed && pending.push(typed)));
  await nodesStore.getState().create("chef2", {
    workspaceId: "w1",
    kind: "fleet",
    payload: {
      name: "Chef",
      mission: {
        state: "en_cours",
        name: "Auth",
        maxAgents: 4,
        members: [{ nodeId: "batman", name: "Batman", task: "Login", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 0 }],
      },
    },
  });
  const lines = () => vi.mocked(notify).mock.calls.filter(([to]) => to === "chef2").length;
  checkBudgets(11 * min);
  expect(lines()).toBe(1);
  checkBudgets(21 * min);
  expect(lines()).toBe(1);
  expect(toast.warning).toHaveBeenCalledTimes(1);
  for (const typed of pending) typed();
  checkBudgets(22 * min);
  expect(lines()).toBe(1);
  expect(toast.warning).toHaveBeenCalledTimes(1);
  expect(missionOf(nodesStore.getState().nodes.chef2)?.members[0].overdue).toBe(2);
});
