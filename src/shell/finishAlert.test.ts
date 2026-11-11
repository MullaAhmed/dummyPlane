// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendNotification, type Options } from "@tauri-apps/plugin-notification";
import { toast } from "sonner";
import { finishAlertsStore } from "@/app/finishAlertsSetting";
import { nativeNotificationsStore } from "@/app/nativeNotifications";
import { signalFinish } from "@/agents/finishes";
import { activeTerminalStore } from "@/canvas/activeTerminal";
import { nodeInSight } from "@/canvas/arrive";
import { goToAgent } from "@/commands/goToRun";
import type { Activity } from "@/ipc/activity";
import type { Mission } from "@/mission/mission";
import type { TerminalPayload } from "@/nodes/types";
import { generatedAsText } from "@/openui/plainText";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { readSource } from "@/theme/cssBlocks";
import { installFinishAlerts, MAX_SUMMARY, MIN_WORK_MS, SETTLE_MS, summaryLine } from "./finishAlert";

const win = vi.hoisted(() => ({ isFocused: vi.fn(() => Promise.resolve(false)) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));
vi.mock("@tauri-apps/plugin-notification", () => ({ sendNotification: vi.fn() }));
// The store saves what changes and says so with toast.error when it cannot: no database here.
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/commands/goToRun", () => ({ goToAgent: vi.fn() }));
vi.mock("@/canvas/arrive", () => ({ nodeInSight: vi.fn(() => false) }));
vi.mock("@excalidraw/excalidraw", () => ({}));

const terminal = (name: string, extra: Partial<TerminalPayload> = {}): TerminalPayload => ({ title: name, name, agent: "claude", cwd: "C:/code", shell: "default", command: "", ...extra });

/** A change of activity at `since` ms. */
const at = (nodeId: string, activity: Activity, since: number) => agentActivityStore.getState().apply({ nodeId, activity, since });

/** A turn of `ms` of work from `start`, then an idle that lasts. */
async function turn(nodeId: string, ms: number, start = 1_000) {
  at(nodeId, "working", start);
  at(nodeId, "idle", start + ms);
  await vi.advanceTimersByTimeAsync(SETTLE_MS);
}

const notified = () => vi.mocked(sendNotification).mock.calls.map(([options]) => options as Options);
const LONG = MIN_WORK_MS + 5_000;
const SHORT = MIN_WORK_MS - 5_000;
let uninstall: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  win.isFocused.mockResolvedValue(false);
  vi.mocked(nodeInSight).mockReturnValue(false);
  finishAlertsStore.setState({ enabled: true });
  nativeNotificationsStore.setState({ enabled: true });
  projectsStore.setState({ view: "project" });
  activeTerminalStore.setState({ id: null });
  workspacesStore.setState({
    activeId: "w1",
    workspaces: [
      { id: "w1", projectId: "p1", name: "Workspace 1", position: 0, pantheon: null, kind: "canvas", folder: null },
      { id: "w2", projectId: "p1", name: "Workspace 2", position: 1, pantheon: null, kind: "canvas", folder: null },
    ],
  });
  nodesStore.setState({
    nodes: {
      batman: { workspaceId: "w1", kind: "terminal", payload: terminal("Batman") },
      robin: { workspaceId: "w1", kind: "terminal", payload: terminal("Robin", { spawnedBy: "batman" }) },
      shell: { workspaceId: "w1", kind: "terminal", payload: terminal("", { agent: "shell" }) },
      chef: { workspaceId: "w2", kind: "fleet", payload: { name: "Chef" } },
    },
  });
  terminalStatusStore.setState({ statuses: { batman: { state: "running" }, robin: { state: "exited", code: 0 }, shell: { state: "running" }, chef: { state: "running" } } });
  agentActivityStore.setState({ activities: {} });
  uninstall = installFinishAlerts();
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

describe("a report", () => {
  it.each([
    ["done", "Batman · Done"],
    ["blocked", "Batman · Blocked"],
    ["failed", "Batman · Failed"],
  ] as const)("of %s alerts with its first line, as plain text", async (state, title) => {
    at("batman", "working", 1_000);
    signalFinish({ nodeId: "batman", state, summary: "\n## Login **fixed**\nTests green" });
    await vi.advanceTimersByTimeAsync(0);
    expect(notified()).toEqual([{ title, body: "Login fixed", extra: { nodeId: "batman", finished: true } }]);
  });

  it("is one alert with the end of its turn, however long it worked", async () => {
    at("batman", "working", 1_000);
    signalFinish({ nodeId: "batman", state: "done", summary: "Login fixed" });
    at("batman", "idle", 1_000 + LONG);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    at("batman", "idle", 2_000 + LONG);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(notified()[0].title).toBe("Batman · Done");
  });

  it("alerts once for the same report made twice, again for a new one", async () => {
    at("batman", "working", 1_000);
    signalFinish({ nodeId: "batman", state: "blocked", summary: "Needs a key" });
    signalFinish({ nodeId: "batman", state: "blocked", summary: "Needs a key" });
    signalFinish({ nodeId: "batman", state: "done", summary: "Found the key" });
    await vi.advanceTimersByTimeAsync(0);
    expect(notified().map((n) => n.title)).toEqual(["Batman · Blocked", "Batman · Done"]);
  });

  it("leaves the next turn its own alert", async () => {
    at("batman", "working", 1_000);
    signalFinish({ nodeId: "batman", state: "done", summary: "Login fixed" });
    at("batman", "idle", 2_000);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await turn("batman", LONG, 10_000);
    expect(notified().map((n) => n.title)).toEqual(["Batman · Done", "Batman · Finished"]);
  });
});

describe("the end of a turn", () => {
  it("alerts after real work, once the idle lasts", async () => {
    at("batman", "working", 1_000);
    at("batman", "idle", 1_000 + LONG);
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(sendNotification).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(notified()).toEqual([{ title: "Batman · Finished", body: "Ready for your next message", extra: { nodeId: "batman", finished: true } }]);
  });

  it("stays silent after a quick answer", async () => {
    await turn("batman", SHORT);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("counts only the time worked: a wait for the user is not work", async () => {
    at("batman", "working", 1_000);
    at("batman", "waiting", 6_000);
    at("batman", "working", 600_000);
    at("batman", "idle", 605_000);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("adds the work before and after a question", async () => {
    at("batman", "working", 1_000);
    at("batman", "waiting", 1_000 + SHORT);
    at("batman", "working", 100_000);
    at("batman", "idle", 100_000 + SHORT);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("goes on through a short pause: one turn, one alert", async () => {
    at("batman", "working", 1_000);
    at("batman", "idle", 1_000 + SHORT);
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1_000);
    at("batman", "working", 2_000 + SHORT);
    at("batman", "idle", 2_000 + 2 * SHORT);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("leaves a question right after to the question alert", async () => {
    at("batman", "working", 1_000);
    at("batman", "idle", 1_000 + LONG);
    at("batman", "waiting", 2_000 + LONG);
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("is no finish when the agent exits back to its shell, nor is the shell's work after", async () => {
    at("batman", "working", 1_000);
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "idle", since: 1_000 + LONG, left: true });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "working", since: 100_000, left: true });
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "idle", since: 100_000 + LONG, left: true });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("is no finish when the agent exits during the idle that would end it", async () => {
    at("batman", "working", 1_000);
    at("batman", "idle", 1_000 + LONG);
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "idle", since: 2_000 + LONG, left: true });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("is forgotten when the agent's process ends", async () => {
    at("batman", "working", 1_000);
    at("batman", "idle", 1_000 + LONG);
    agentActivityStore.getState().remove("batman");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("waits for an agent's sub-agents: the short wrap-up their report wakes it for ends the turn, once", async () => {
    terminalStatusStore.getState().set("robin", { state: "running" });
    at("robin", "working", 500);
    await turn("batman", LONG);
    expect(sendNotification).not.toHaveBeenCalled();
    terminalStatusStore.getState().set("robin", { state: "exited", code: 0 });
    await turn("batman", SHORT, 100_000);
    expect(notified().map((n) => n.title)).toEqual(["Batman · Finished"]);
    await turn("batman", SHORT, 200_000);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("is not held by a sub-agent gone idle without reporting: nothing would wake its parent", async () => {
    terminalStatusStore.getState().set("robin", { state: "running" });
    at("robin", "idle", 500);
    await turn("batman", LONG);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("does not replay the turns already over when the interface reloads", async () => {
    uninstall();
    agentActivityStore.getState().load([{ nodeId: "batman", activity: "idle", since: 50_000 }]);
    uninstall = installFinishAlerts();
    at("batman", "idle", 60_000);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(sendNotification).not.toHaveBeenCalled();
    const boot = readSource("app/boot.ts");
    expect(boot).toContain("await loadFinishAlerts()");
    expect(boot.indexOf("installFinishAlerts()")).toBeGreaterThan(boot.indexOf("agentActivityStore.getState().load"));
  });

  it("ends a turn the reload caught under way", async () => {
    uninstall();
    agentActivityStore.getState().load([{ nodeId: "batman", activity: "working", since: 1_000 }]);
    uninstall = installFinishAlerts();
    at("batman", "idle", 1_000 + LONG);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});

describe("who alerts", () => {
  it("never a sub-agent opened with spawn_agent: its parent hears its report", async () => {
    signalFinish({ nodeId: "robin", state: "done", summary: "Done" });
    await turn("robin", LONG);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("never a plain shell: its output is no agent's work", async () => {
    await turn("shell", LONG);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("never a running mission's team agent: the Fleet hears it, and the mission's end alerts once", async () => {
    const mission = { state: "en_cours", maxAgents: 2, members: [{ nodeId: "alfred", name: "Alfred", task: "Login", budgetMin: 20, linked: false, branch: "b", worktree: "w", sentAt: 1 }] } as Mission;
    nodesStore.setState((s) => ({
      nodes: { ...s.nodes, chef: { workspaceId: "w2", kind: "fleet", payload: { name: "Chef", mission } }, alfred: { workspaceId: "w2", kind: "terminal", payload: terminal("Alfred") } },
    }));
    signalFinish({ nodeId: "alfred", state: "done", summary: "Login fixed" });
    await vi.advanceTimersByTimeAsync(0);
    expect(sendNotification).not.toHaveBeenCalled();
    // Once the mission is over, the same terminal is a main agent again.
    nodesStore.getState().update("chef", { mission: { ...mission, state: "terminee" } });
    signalFinish({ nodeId: "alfred", state: "done", summary: "Docs fixed" });
    await vi.advanceTimersByTimeAsync(0);
    expect(notified().map((n) => n.title)).toEqual(["Alfred · Done"]);
  });

  it("the Fleet: its mission's end with its summary, not each turn while the mission runs", async () => {
    nodesStore.getState().update("chef", { mission: { state: "en_cours", maxAgents: 2, members: [] } });
    await turn("chef", LONG);
    expect(sendNotification).not.toHaveBeenCalled();
    at("chef", "working", 100_000);
    nodesStore.getState().update("chef", { mission: { state: "terminee", maxAgents: 2, members: [], summary: "All merged" } });
    signalFinish({ nodeId: "chef", state: "done", summary: "All merged\nDetails" });
    at("chef", "idle", 100_000 + LONG);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(notified()).toEqual([{ title: "Chef · Done", body: "All merged", extra: { nodeId: "chef", finished: true } }]);
  });

  it("the Fleet: a turn of work outside a mission", async () => {
    await turn("chef", LONG);
    expect(notified().map((n) => n.title)).toEqual(["Chef · Finished"]);
  });

  it("the Fleet: a mission ended without a summary says so", async () => {
    signalFinish({ nodeId: "chef", state: "done", summary: "" });
    await vi.advanceTimersByTimeAsync(0);
    expect(notified()[0].body).toBe("Mission finished");
  });

  it("never an agent outside the open project", async () => {
    signalFinish({ nodeId: "elsewhere", state: "done", summary: "Done" });
    await turn("elsewhere", LONG);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("never replays a report a workspace loads from disk", async () => {
    const payload = terminal("Alfred", { lastReport: { status: "done", summary: "Old news" } });
    nodesStore.getState().hydrate("w1", [{ id: "alfred", kind: "terminal", payloadJson: JSON.stringify(payload) }]);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("where it shows", () => {
  it("in the window while it is focused, with Show, when the agent is not on screen", async () => {
    win.isFocused.mockResolvedValue(true);
    workspacesStore.setState({ activeId: "w2" });
    await turn("batman", LONG);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledExactlyOnceWith("Batman · Finished", { description: "Ready for your next message", action: { label: "Show", onClick: expect.any(Function) } });
    const action = vi.mocked(toast).mock.calls[0][1]!.action as unknown as { onClick: () => void };
    action.onClick();
    expect(goToAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "batman", workspaceId: "w1" }));
  });

  it("nowhere while the user looks at the agent: it shows, or it is the active terminal", async () => {
    win.isFocused.mockResolvedValue(true);
    vi.mocked(nodeInSight).mockReturnValue(true);
    await turn("batman", LONG);
    vi.mocked(nodeInSight).mockReturnValue(false);
    activeTerminalStore.setState({ id: "batman" });
    signalFinish({ nodeId: "batman", state: "done", summary: "Done" });
    await vi.advanceTimersByTimeAsync(0);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("in the window without Show at home: no canvas to arrive on", async () => {
    win.isFocused.mockResolvedValue(true);
    projectsStore.setState({ view: "home" });
    signalFinish({ nodeId: "batman", state: "blocked", summary: "Needs a key" });
    await vi.advanceTimersByTimeAsync(0);
    expect(toast).toHaveBeenCalledExactlyOnceWith("Batman · Blocked", { description: "Needs a key" });
  });

  it("as no Windows notification when those are off", async () => {
    nativeNotificationsStore.setState({ enabled: false });
    await turn("batman", LONG);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("the setting", () => {
  it("turns every finish alert off", async () => {
    finishAlertsStore.setState({ enabled: false });
    signalFinish({ nodeId: "batman", state: "done", summary: "Done" });
    await turn("batman", LONG);
    win.isFocused.mockResolvedValue(true);
    workspacesStore.setState({ activeId: "w2" });
    await turn("batman", LONG, 100_000);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});

it("never lets a failure reach the app", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  win.isFocused.mockRejectedValue(new Error("no window"));
  signalFinish({ nodeId: "batman", state: "done", summary: "Done" });
  await vi.advanceTimersByTimeAsync(0);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

it("stops when uninstalled", async () => {
  uninstall();
  signalFinish({ nodeId: "batman", state: "done", summary: "Done" });
  await turn("batman", LONG);
  expect(sendNotification).not.toHaveBeenCalled();
});

describe("the summary's line", () => {
  it("is its first line with words, without Markdown", () => {
    expect(summaryLine("\n\n### Login **fixed**, see [the PR](https://x.y/1)\nmore")).toBe("Login fixed, see the PR");
    expect(summaryLine("> - `npm test` passes")).toBe("npm test passes");
    expect(summaryLine("---\n```ts\nconst x = 1;\n```\n1. Merged")).toBe("Merged");
    expect(summaryLine("| --- |\n| Test | Result |")).toBe("Test | Result");
  });

  it("is plain text: no escapes, controls or invisible characters", () => {
    expect(summaryLine("\u001b[31mRed\u001b[0m alert\u0007 and\u200b more")).toBe("Red alert and more");
  });

  it("is cut at a word past the question preview's length", () => {
    const line = summaryLine("word ".repeat(60));
    expect(line.length).toBeLessThanOrEqual(MAX_SUMMARY);
    expect(line.endsWith("…")).toBe(true);
  });

  it("is empty when nothing reads", () => {
    expect(summaryLine("```\ncode only\n```\n---")).toBe("");
  });

  it("reads a summary written in OpenUI Lang as its text, never its program", () => {
    const ui = 'root = Stack([h, t])\nh = Heading("Tests")\nt = Table(["Test", "Result"], [["saves", "ok"]])';
    expect(summaryLine(generatedAsText(ui))).toBe("Tests");
  });
});

it("is in the settings menu", () => {
  expect(readSource("shell/SettingsMenu.tsx")).toContain("setFinishAlerts(on === true)");
});
