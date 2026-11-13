// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { subagentSettingsStore } from "@/app/subagentSettings";
import { MANAGER_ROLE } from "@/ipc/pty";
import { activeMembers, moving } from "@/mission/active";
import { pendingEvents } from "@/mission/events";
import type { Member, Mission } from "@/mission/mission";
import { hasFocus, isLiveInRust, relaunchTerminal, stopTerminal, touchedAgo, freshText } from "@/nodes/terminal/registry";
import type { TerminalPayload, TerminalReportStatus } from "@/nodes/types";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { FINISHED_STOP_DELAY_MS, installFinishedStops, wakeable, wakeFinished, wakingUp } from "./finishedStop";
import { atWork, spawnedAtWork } from "./spawnFamily";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/nodes/terminal/registry", () => ({
  stopTerminal: vi.fn(),
  relaunchTerminal: vi.fn(() => Promise.resolve()),
  touchedAgo: vi.fn(() => Infinity),
  hasFocus: vi.fn(() => false),
  isLiveInRust: vi.fn(() => false),
  freshText: vi.fn(() => PROMPT),
  quietFor: vi.fn(() => 5000),
}));
vi.mock("@/mission/events", () => ({ pendingEvents: vi.fn(() => []) }));
vi.mock("@/ipc/pty", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/ipc/pty")>()), ptyWrite: vi.fn(() => Promise.resolve()) }));

/** Claude's prompt is up: its input box under a rule (`@/mission/ready`). */
const PROMPT = "─────────\n❯ ";

const agent: TerminalPayload = { title: "", name: "Cyborg", agent: "claude", cwd: "C:/p", shell: "default", command: "", claudeSessionId: "s-cyborg", spawnedBy: "batman" };
const payloadOf = (id: string) => terminalOf(nodesStore.getState().nodes[id])!;

async function terminal(id: string, extra: Partial<TerminalPayload> = {}, running = true) {
  await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { ...agent, ...extra } });
  if (running) terminalStatusStore.getState().set(id, { state: "running" });
}

/** Its `report`, as `onAgentReported` keeps it: the card shows it, and a done one minimizes. */
const reports = (id: string, status: TerminalReportStatus = "done", minimized = status === "done") =>
  nodesStore.getState().update(id, { lastReport: { status, summary: `${status} work` }, ...(minimized ? { minimized: true } : {}) });

/** Its process's exit, as boot's pty-exit listener records it. */
const exits = (id: string) => terminalStatusStore.getState().set(id, { state: "exited", code: 1 });

const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

let uninstall: () => void;

beforeEach(async () => {
  vi.useFakeTimers();
  mockIPC(() => undefined);
  vi.clearAllMocks();
  // Its relaunch spawns nothing unless a test says so (`starts`).
  vi.mocked(relaunchTerminal).mockImplementation(() => Promise.resolve());
  vi.mocked(touchedAgo).mockReturnValue(Infinity);
  vi.mocked(hasFocus).mockReturnValue(false);
  vi.mocked(isLiveInRust).mockReturnValue(false);
  vi.mocked(freshText).mockReturnValue(PROMPT);
  vi.mocked(pendingEvents).mockReturnValue([]);
  nodesStore.setState({ nodes: {} });
  terminalStatusStore.setState({ statuses: {}, restarts: {} });
  agentActivityStore.setState({ activities: {} });
  subagentSettingsStore.setState({ stopFinished: true });
  moving.clear();
  await terminal("batman", { name: "Batman", spawnedBy: undefined, claudeSessionId: "s-batman" });
  await terminal("cyborg");
  uninstall = installFinishedStops();
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

describe("a finished sub-agent shrunk to its card", () => {
  it("stops its process a minute after its done report, its saved screen and conversation kept", async () => {
    reports("cyborg");
    await wait(FINISHED_STOP_DELAY_MS - 1);
    expect(stopTerminal).not.toHaveBeenCalled();
    await wait(1);
    expect(stopTerminal).toHaveBeenCalledExactlyOnceWith("cyborg");
    // Its card reads its report, it resumes its own conversation.
    expect(payloadOf("cyborg")).toMatchObject({ stoppedFinished: true, minimized: true, lastReport: { status: "done" }, claudeSessionId: "s-cyborg" });
    exits("cyborg");
    await wait(10 * FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).toHaveBeenCalledTimes(1);
  });

  it("stops one the user minimizes once it has reported done", async () => {
    reports("cyborg", "done", false);
    await wait(2 * FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).not.toHaveBeenCalled();
    nodesStore.getState().update("cyborg", { minimized: true });
    await wait(FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).toHaveBeenCalledWith("cyborg");
  });

  it("leaves blocked and failed agents running: someone has to look at them", async () => {
    reports("cyborg", "blocked", true);
    await terminal("flash", { name: "Flash" });
    reports("flash", "failed", true);
    await wait(5 * FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).not.toHaveBeenCalled();
  });

  it("gives the stop up when new work clears its report during the minute", async () => {
    reports("cyborg");
    await wait(FINISHED_STOP_DELAY_MS / 2);
    // `onNewWork`: a task, a message or a key typed into it.
    nodesStore.getState().update("cyborg", { lastReport: undefined, minimized: undefined });
    await wait(5 * FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).not.toHaveBeenCalled();
  });

  it("gives the stop up when its card is expanded, and waits a whole new minute once minimized again", async () => {
    reports("cyborg");
    await wait(40_000);
    nodesStore.getState().update("cyborg", { minimized: undefined });
    await wait(30_000);
    expect(stopTerminal).not.toHaveBeenCalled();
    nodesStore.getState().update("cyborg", { minimized: true });
    await wait(FINISHED_STOP_DELAY_MS - 1);
    expect(stopTerminal).not.toHaveBeenCalled();
    await wait(1);
    expect(stopTerminal).toHaveBeenCalledWith("cyborg");
  });

  it("stays running, until its next report, when the user typed into it or focused it during the minute", async () => {
    reports("cyborg");
    vi.mocked(touchedAgo).mockReturnValue(20_000);
    await wait(FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).not.toHaveBeenCalled();
    // Theirs now: not stopped later for that same report.
    vi.mocked(touchedAgo).mockReturnValue(Infinity);
    await wait(5 * FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).not.toHaveBeenCalled();
    // Its next report is another finish.
    reports("cyborg");
    await wait(FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).toHaveBeenCalledWith("cyborg");

    await terminal("flash", { name: "Flash" });
    reports("flash");
    vi.mocked(hasFocus).mockImplementation((id) => id === "flash");
    await wait(FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).not.toHaveBeenCalledWith("flash");
  });

  it("waits while it still works, a dialog waits, a line waits to be typed into it, or its own sub-agents work", async () => {
    reports("cyborg");
    agentActivityStore.setState({ activities: { cyborg: { activity: "working", since: 0 } } });
    await wait(FINISHED_STOP_DELAY_MS);
    agentActivityStore.setState({ activities: { cyborg: { activity: "waiting", since: 0 } } });
    await wait(FINISHED_STOP_DELAY_MS);
    agentActivityStore.setState({ activities: { cyborg: { activity: "idle", since: 0 } } });
    vi.mocked(pendingEvents).mockImplementation((id) => (id === "cyborg" ? ["Message from Batman: one more thing"] : []));
    await wait(FINISHED_STOP_DELAY_MS);
    vi.mocked(pendingEvents).mockReturnValue([]);
    // Its sub-agent's report is typed into it: stopped, it would never hear it.
    await terminal("raven", { name: "Raven", spawnedBy: "cyborg" });
    await wait(FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).not.toHaveBeenCalled();
    nodesStore.getState().update("raven", { lastReport: { status: "done", summary: "ok" } });
    await wait(FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).toHaveBeenCalledWith("cyborg");
  });

  it("runs on with Stop finished agents off, and turning it off during the minute gives the stop up", async () => {
    subagentSettingsStore.setState({ stopFinished: false });
    reports("cyborg");
    await wait(5 * FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).not.toHaveBeenCalled();
    subagentSettingsStore.setState({ stopFinished: true });
    await wait(FINISHED_STOP_DELAY_MS / 2);
    subagentSettingsStore.setState({ stopFinished: false });
    await wait(5 * FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).not.toHaveBeenCalled();
  });

  it("never stops a top-level agent, a Manager, a shell, a Remote Control session, nor a CLI that would lose its conversation", async () => {
    await terminal("top", { spawnedBy: undefined });
    await terminal("manager", { role: MANAGER_ROLE, fleet: "fleet" });
    await terminal("shell", { agent: "shell" });
    await terminal("remote", { remoteControl: true });
    await terminal("gemini", { agent: "gemini" });
    await terminal("codex", { agent: "codex" });
    await terminal("unnamed", { claudeSessionId: undefined });
    await terminal("install", { oneShot: true });
    for (const id of ["top", "manager", "shell", "remote", "gemini", "codex", "unnamed", "install"]) reports(id);
    await wait(5 * FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).not.toHaveBeenCalled();
    // Codex once it saved its thread resumes it.
    nodesStore.getState().update("codex", { codexSessionId: "thread-1", lastReport: { status: "done", summary: "again" } });
    await wait(FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).toHaveBeenCalledExactlyOnceWith("codex");
  });

  it("stops one still alive in Rust after a webview reload, not attached again", async () => {
    uninstall();
    await terminal("ghost", { lastReport: { status: "done", summary: "ok" }, minimized: true }, false);
    vi.mocked(isLiveInRust).mockImplementation((id) => id === "ghost");
    uninstall = installFinishedStops();
    await wait(FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).toHaveBeenCalledWith("ghost");
  });

  it("stays finished for the spawn cap once stopped", async () => {
    reports("cyborg");
    await wait(FINISHED_STOP_DELAY_MS);
    exits("cyborg");
    expect(atWork("cyborg")).toBe(false);
    expect(spawnedAtWork()).not.toContain("cyborg");
  });
});

describe("a mission's team agent that reported done", () => {
  const member = (extra: Partial<Member> = {}): Member => ({
    nodeId: "cyborg", name: "Cyborg", task: "Login", budgetMin: 20, linked: false, branch: "b", worktree: "w", sentAt: 1,
    report: { summary: "Login done", status: "termine", at: 2 }, ...extra,
  });
  const mission = (members: Member[]): Mission => ({ state: "en_cours", maxAgents: 2, members, manager: "zeus" });

  beforeEach(async () => {
    await terminal("zeus", { name: "Zeus", role: MANAGER_ROLE, fleet: "chef", spawnedBy: undefined });
    nodesStore.getState().update("cyborg", { spawnedBy: "zeus" });
    await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", mission: mission([member()]) } });
  });

  it("is stopped like any other, and holds no seat once stopped", async () => {
    reports("cyborg");
    await wait(FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).toHaveBeenCalledWith("cyborg");
    exits("cyborg");
    const now = nodesStore.getState().nodes.chef;
    expect(now.kind === "fleet" && activeMembers(now.payload.mission!)).toEqual([]);
  });

  it("is not stopped while its Manager moves it on with next_task (its branch merging), only after", async () => {
    moving.add("cyborg");
    reports("cyborg");
    await wait(3 * FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).not.toHaveBeenCalled();
    moving.delete("cyborg");
    await wait(FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).toHaveBeenCalledWith("cyborg");
  });

  it("is not stopped once a sub-task is handed to it, before it is typed", async () => {
    reports("cyborg");
    // `reassign` to it: its entry holds the new sub-task, its text waits for its session.
    nodesStore.getState().update("chef", { mission: mission([member({ task: "API", report: undefined, sentAt: undefined, brief: "Do the API" })]) });
    await wait(3 * FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).not.toHaveBeenCalled();
  });
});

describe("a stopped finished agent", () => {
  async function stopped(id = "cyborg") {
    reports(id);
    await wait(FINISHED_STOP_DELAY_MS);
    exits(id);
  }
  /** Its relaunch, as the registry's: its new process runs. */
  const starts = () =>
    vi.mocked(relaunchTerminal).mockImplementation(async (id) => {
      terminalStatusStore.getState().set(id, { state: "running" });
    });

  it("starts again on its own conversation when its card is expanded, and is no longer marked stopped once it runs", async () => {
    await stopped();
    starts();
    nodesStore.getState().update("cyborg", { minimized: undefined });
    expect(relaunchTerminal).toHaveBeenCalledExactlyOnceWith("cyborg", expect.objectContaining({ claudeSessionId: "s-cyborg" }), "resume");
    await wait(0);
    expect(payloadOf("cyborg").stoppedFinished).toBeUndefined();
    // Running, expanded, its report standing: nothing stops it again.
    await wait(5 * FINISHED_STOP_DELAY_MS);
    expect(stopTerminal).toHaveBeenCalledTimes(1);
  });

  it("is woken once by new work, and the wake resolves once its prompt is up", async () => {
    await stopped();
    starts();
    vi.mocked(freshText).mockReturnValue("");
    expect(wakeable("cyborg")).toBe(true);
    const first = wakeFinished("cyborg");
    expect(wakeFinished("cyborg")).toBe(first);
    expect(wakingUp("cyborg")).toBe(first);
    expect(relaunchTerminal).toHaveBeenCalledExactlyOnceWith("cyborg", expect.anything(), "resume");
    let ready: boolean | undefined;
    void first.then((value) => (ready = value));
    await wait(5000);
    expect(ready).toBeUndefined();
    vi.mocked(freshText).mockReturnValue(PROMPT);
    await wait(500);
    expect(ready).toBe(true);
    expect(wakingUp("cyborg")).toBeUndefined();
  });

  it("says so when it does not start again", async () => {
    await stopped();
    await expect(wakeFinished("cyborg")).resolves.toBe(false);
  });

  it("can be woken by new work: one this feature stopped by anyone, a sub-agent that reported and stopped since by its parent only", async () => {
    await stopped();
    expect(wakeable("cyborg")).toBe(true);
    // An app restart leaves a finished sub-agent stopped, unmarked.
    await terminal("flash", { name: "Flash", lastReport: { status: "done", summary: "ok" } }, false);
    expect(wakeable("flash", "batman")).toBe(true);
    expect(wakeable("flash", "cyborg")).toBe(false);
    expect(wakeable("flash")).toBe(false);
    // Running, or with no conversation to take up: never.
    expect(wakeable("batman", "batman")).toBe(false);
    await terminal("unnamed", { claudeSessionId: undefined, stoppedFinished: true }, false);
    expect(wakeable("unnamed")).toBe(false);
  });
});
