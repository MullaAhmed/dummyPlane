// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { goTo } from "@/commands/goToRun";
import { workspacesStore } from "@/store/workspaces";
import { announceArrival } from "./arrivals";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/commands/goToRun", () => ({ goTo: vi.fn() }));

type Action = { label: string; onClick: () => void };
const lastToast = () => {
  const [text, options] = vi.mocked(toast).mock.calls[vi.mocked(toast).mock.calls.length - 1] as unknown as [string, { action: Action }];
  return { text, action: options.action };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(toast).mockClear();
  vi.mocked(goTo).mockClear();
  workspacesStore.setState({ activeId: "w1", workspaces: [{ id: "w1", name: "Main" }, { id: "w2", name: "Overnight" }] as never });
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

it("tells quietly of an agent that joined a mission, with a way to show it", async () => {
  announceArrival("w1", "mission", [{ nodeId: "n1", name: "Storm" }]);
  expect(toast).not.toHaveBeenCalled();
  vi.advanceTimersByTime(500);
  expect(toast).toHaveBeenCalledTimes(1);
  expect(lastToast().text).toBe("Storm joined the mission");
  expect(lastToast().action.label).toBe("Show");
  lastToast().action.onClick();
  await vi.waitFor(() => expect(goTo).toHaveBeenCalledWith(expect.objectContaining({ kind: "terminal", workspaceId: "w1", targetId: "n1", label: "Storm" })));
});

it("makes one notice of agents arriving together, and Show leads to the first", async () => {
  announceArrival("w1", "mission", [{ nodeId: "n1", name: "Storm" }]);
  announceArrival("w1", "mission", [{ nodeId: "n2", name: "Loki" }]);
  announceArrival("w1", "mission", [{ nodeId: "n3", name: "Rogue" }, { nodeId: "n4", name: "Hulk" }]);
  vi.advanceTimersByTime(500);
  expect(toast).toHaveBeenCalledTimes(1);
  expect(lastToast().text).toBe("Storm, Loki and 2 others joined the mission");
  lastToast().action.onClick();
  await vi.waitFor(() => expect(goTo).toHaveBeenCalledWith(expect.objectContaining({ targetId: "n1" })));
});

it("names two agents without counting, and an agent that comes later has a notice of its own", () => {
  announceArrival("w1", "mission", [{ nodeId: "n1", name: "Storm" }, { nodeId: "n2", name: "Loki" }]);
  vi.advanceTimersByTime(500);
  expect(lastToast().text).toBe("Storm and Loki joined the mission");
  announceArrival("w1", "mission", [{ nodeId: "n3", name: "Rogue" }]);
  vi.advanceTimersByTime(500);
  expect(toast).toHaveBeenCalledTimes(2);
  expect(lastToast().text).toBe("Rogue joined the mission");
});

it("words a sub-agent's arrival, apart from a mission's", () => {
  announceArrival("w1", "spawn", [{ nodeId: "n1", name: "Robin" }]);
  announceArrival("w1", "mission", [{ nodeId: "n2", name: "Storm" }]);
  vi.advanceTimersByTime(500);
  expect(vi.mocked(toast).mock.calls.map(([text]) => text)).toEqual(["Robin joined as a sub-agent", "Storm joined the mission"]);
});

it("says which workspace it is when it is not the one on screen, and Show leads there", async () => {
  announceArrival("w2", "mission", [{ nodeId: "n1", name: "Storm" }]);
  vi.advanceTimersByTime(500);
  expect(lastToast().text).toBe("Storm joined the mission in Overnight");
  lastToast().action.onClick();
  await vi.waitFor(() => expect(goTo).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "w2", targetId: "n1" })));
});

it("says nothing when nobody arrived", () => {
  announceArrival("w1", "mission", []);
  vi.advanceTimersByTime(500);
  expect(toast).not.toHaveBeenCalled();
});
