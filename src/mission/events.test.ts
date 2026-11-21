// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { ptySendText } from "@/ipc/pty";
import { clearDraft, DRAFT_IDLE_MS, trackInput } from "@/nodes/terminal/draft";
import { freshText, typedAgo } from "@/nodes/terminal/registry";
import { holdFor, pendingDialog, type ScreenDialog } from "@/agents/dialogs";
import { remoteBusy } from "@/agents/remoteControl";
import { markLaunching } from "@/agents/spawnFamily";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { relaunchSession } from "@/nodes/terminal/session";
import { flagMissionCard, reassignMissionCard } from "@/kanban/fleetBoards";
import { installMissionEvents, notify, pendingEvents, sendCommand } from "./events";
import { whenReady } from "./ready";
import type { Member, Mission } from "./mission";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/ipc/pty", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/ipc/pty")>()), ptySendText: vi.fn(() => Promise.resolve()) }));
vi.mock("@/nodes/terminal/registry", () => ({ freshText: vi.fn(() => ""), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity) }));
vi.mock("@/agents/remoteControl", () => ({ remoteBusy: vi.fn(() => false) }));
vi.mock("./ready", () => ({ whenReady: vi.fn(() => Promise.resolve(true)) }));
vi.mock("@/kanban/fleetBoards", () => ({ flagMissionCard: vi.fn(() => Promise.resolve()), reassignMissionCard: vi.fn(() => Promise.resolve()) }));

/** Lets the started fleet's readiness settle. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const member = (nodeId: string, name: string, sentAt?: number): Member => ({ nodeId, name, task: "t", budgetMin: 5, linked: false, branch: `dummyplane/m-${nodeId}`, worktree: "C:/w", sentAt });
const activity = (nodeId: string, value: "idle" | "working" | "waiting") => agentActivityStore.getState().apply({ nodeId, activity: value, since: 0 });
const status = (nodeId: string, state: "running" | "stopped" | "exited") =>
  terminalStatusStore.getState().set(nodeId, state === "exited" ? { state, code: 0 } : { state });
const sent = () => vi.mocked(ptySendText).mock.calls.map(([id, text]) => `${id}: ${text}`);

let uninstall: () => void;
beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", mission: { state: "en_cours", maxAgents: 4, members: [member("batman", "Batman", 1), member("aquaman", "Aquaman")] } },
  });
  uninstall = installMissionEvents();
});
afterAll(() => uninstall());
beforeEach(async () => {
  status("chef", "running");
  await tick();
  activity("chef", "idle");
  status("batman", "running");
  activity("batman", "working");
  vi.mocked(ptySendText).mockClear();
  clearDraft("chef");
});

describe("events to the fleet", () => {
  it("holds a line while a Remote Control flow is typing in the fleet (backlog 27 oct)", async () => {
    vi.useFakeTimers();
    vi.mocked(remoteBusy).mockReturnValueOnce(true).mockReturnValue(false);
    notify("chef", "Batman a rendu compte");
    expect(sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent()).toEqual(["chef: [dummyPlane] Batman a rendu compte"]);
    vi.useRealTimers();
  });

  it("waits for the user to stop typing before it types a line (backlog H2)", async () => {
    vi.useFakeTimers();
    vi.mocked(typedAgo).mockReturnValueOnce(1000).mockReturnValue(Infinity);
    notify("chef", "Batman a rendu compte");
    expect(sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(4000);
    expect(sent()).toEqual(["chef: [dummyPlane] Batman a rendu compte"]);
    vi.useRealTimers();
  });

  // A Fleet's notice landed in the middle of the user's own sentence: "the main app is always dummypla[dummyPlane] Cyclops…".
  it("holds a line while the user has text written and not sent, however long, never merged into it", async () => {
    vi.useFakeTimers();
    trackInput("chef", "the main app is always dummypla");
    notify("chef", "Cyclops reported (done)");
    // Far past the pause after the last key, with nothing sent: the draft is still there.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent()).toEqual([]);
    expect(pendingEvents("chef")).toEqual(["Cyclops reported (done)"]);
    trackInput("chef", "\r");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent()).toEqual(["chef: [dummyPlane] Cyclops reported (done)"]);
    vi.useRealTimers();
  });

  it("types the line once the user has cleared their draft, or left it for good", async () => {
    vi.useFakeTimers();
    trackInput("chef", "half a sentence");
    notify("chef", "un");
    trackInput("chef", "\x03");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent()).toEqual(["chef: [dummyPlane] un"]);
    trackInput("chef", "another one");
    notify("chef", "deux");
    await vi.advanceTimersByTimeAsync(DRAFT_IDLE_MS - 1000);
    expect(sent()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent()).toEqual(["chef: [dummyPlane] un", "chef: [dummyPlane] deux"]);
    vi.useRealTimers();
  });

  it("types a command as is, in line with the [dummyPlane] lines and held as they are", async () => {
    activity("chef", "waiting");
    notify("chef", "Message from Hulk: write the 007 tests");
    sendCommand("chef", "/rename 007 mint.py tests");
    expect(sent()).toEqual([]);
    activity("chef", "working");
    await tick();
    expect(sent()).toEqual(["chef: [dummyPlane] Message from Hulk: write the 007 tests", "chef: /rename 007 mint.py tests"]);
  });

  it("types a line in a free fleet at once", () => {
    notify("chef", "Batman a rendu compte (termine) : fait");
    expect(sent()).toEqual(["chef: [dummyPlane] Batman a rendu compte (termine) : fait"]);
  });

  it("holds the lines while it waits for the user or is stopped, then sends them in order", async () => {
    activity("chef", "waiting");
    notify("chef", "un");
    notify("chef", "deux");
    expect(sent()).toEqual([]);
    expect(pendingEvents("chef")).toEqual(["un", "deux"]);
    activity("chef", "working");
    status("chef", "stopped");
    notify("chef", "trois");
    status("chef", "running");
    await tick();
    expect(sent()).toEqual(["chef: [dummyPlane] un", "chef: [dummyPlane] deux", "chef: [dummyPlane] trois"]);
    expect(pendingEvents("chef")).toEqual([]);
  });

  it("tells it when a member waits for the user or stops, once its sub-task is sent", () => {
    activity("batman", "waiting");
    status("batman", "exited");
    status("aquaman", "running");
    activity("aquaman", "waiting");
    expect(sent()).toEqual([
      "chef: [dummyPlane] Batman is waiting for the user (a dialog is open in its terminal).",
      "chef: [dummyPlane] Batman stopped: its terminal is no longer running.",
    ]);
  });

  it("tells it in English when the interface is", () => {
    try {
      activity("batman", "waiting");
      status("batman", "exited");
      expect(sent()).toEqual([
        "chef: [dummyPlane] Batman is waiting for the user (a dialog is open in its terminal).",
        "chef: [dummyPlane] Batman stopped: its terminal is no longer running.",
      ]);
    } finally {
    }
  });

  // 11 Nov, dummyPlane: "a bunch of tickets are still in progress but only one agent is working".
  describe("the card of a member that stops before it reported", () => {
    const task = (nodeId: string) => (nodesStore.getState().nodes.chef.payload as { mission: { members: Member[] } }).mission.members.find((m) => m.nodeId === nodeId)!;

    it("goes on alert while its agent is stopped, and back to work when it runs again", async () => {
      vi.mocked(flagMissionCard).mockClear();
      vi.mocked(reassignMissionCard).mockClear();
      status("batman", "exited");
      await vi.waitFor(() => expect(flagMissionCard).toHaveBeenCalledWith("chef", undefined, task("batman").task, "failed"));
      status("batman", "running");
      const term = { cols: 80, rows: 24, write: () => undefined };
      mockIPC((cmd, args) => {
        if (cmd === "pty_kill") status((args as { nodeId: string }).nodeId, "exited");
        return cmd === "pty_spawn" ? 1 : undefined;
      });
      await relaunchSession("batman", term, { title: "Batman", name: "Batman", agent: "shell", cwd: "C:/w", shell: "default", command: "" }, "new");
      await tick();
      await vi.waitFor(() => expect(reassignMissionCard).toHaveBeenCalledWith("chef", undefined, task("batman").task, "Batman"));
      mockIPC(() => undefined);
    });

    it("stays where it is once its agent reported, handed its sub-task over or was left by next_task", async () => {
      vi.mocked(flagMissionCard).mockClear();
      const mission = (nodesStore.getState().nodes.chef.payload as { mission: Mission }).mission;
      const members = (extra: Partial<Member>) => [{ ...member("batman", "Batman", 1), ...extra }];
      for (const extra of [{ report: { summary: "ok", status: "termine" as const, at: 2 } }, { handedTo: "Aquaman" }, { abandoned: true }]) {
        nodesStore.getState().update("chef", { mission: { ...mission, members: members(extra) } });
        status("batman", "running");
        status("batman", "exited");
      }
      await tick();
      await tick();
      expect(flagMissionCard).not.toHaveBeenCalled();
      nodesStore.getState().update("chef", { mission });
    });
  });

  it("counts a member's terminal removed from the canvas as stopped", () => {
    terminalStatusStore.getState().remove("batman");
    expect(sent()).toEqual(["chef: [dummyPlane] Batman stopped: its terminal is no longer running."]);
  });

  describe("a member's restart reads as a restart (review 13 Nov)", () => {
    const term = { cols: 80, rows: 24, write: () => undefined };
    const shell = { title: "Batman", name: "Batman", agent: "shell" as const, cwd: "C:/w", shell: "default" as const, command: "" };
    const restarted = "chef: [dummyPlane] Batman restarted: its terminal runs again, and what it was doing stopped with the old process. See where it stands with read_output, then write it what is left.";
    const stopped = "chef: [dummyPlane] Batman stopped: its terminal is no longer running.";
    /** The pty as the app sees it: a kill answered by the exit boot's pty-exit handler records, a spawn running `spawn`. */
    const pty = (spawn: () => unknown = () => 1) =>
      mockIPC((cmd, args) => {
        if (cmd === "pty_kill") status((args as { nodeId: string }).nodeId, "exited");
        return cmd === "pty_spawn" ? spawn() : undefined;
      });
    afterEach(() => mockIPC(() => undefined));

    it("tells it once that a member restarted, not that it stopped, when its terminal comes back", async () => {
      pty();
      await relaunchSession("batman", term, shell, "new");
      await tick();
      expect(sent()).toEqual([restarted]);
    });

    it("tells it the member stopped, and only that, when its restart fails", async () => {
      pty(() => {
        throw new Error("no shell");
      });
      await relaunchSession("batman", term, shell, "new");
      await tick();
      expect(sent()).toEqual([stopped]);
    });

    it("tells it once that a member stopped when its terminal is closed mid-restart", async () => {
      pty();
      await relaunchSession("batman", term, shell, "new", () => terminalStatusStore.getState().remove("batman"));
      await tick();
      expect(sent()).toEqual([stopped]);
    });

    it("tells it a stopped member is back when its restart brings it up, its stop having been told then", async () => {
      status("batman", "exited");
      expect(sent()).toEqual([stopped]);
      pty();
      await relaunchSession("batman", term, shell, "new");
      await tick();
      expect(sent()).toEqual([stopped, restarted]);
    });
  });

  it("waits for a restarted fleet's Claude to be up, never typing into its trust dialog (final review H2)", async () => {
    let up!: (ready: boolean) => void;
    vi.mocked(whenReady).mockImplementationOnce(() => new Promise((resolve) => (up = resolve)));
    status("chef", "stopped");
    status("chef", "running");
    notify("chef", "Batman a rendu compte");
    await tick();
    expect(sent()).toEqual([]);
    const calls = vi.mocked(whenReady).mock.calls;
    expect(calls[calls.length - 1][2]).toBe(false);
    up(true);
    await vi.waitFor(() => expect(sent()).toEqual(["chef: [dummyPlane] Batman a rendu compte"]));
  });

  it("puts back a line that could not be typed, for the fleet's next start (final review H2)", async () => {
    vi.mocked(ptySendText).mockRejectedValueOnce(new Error("NotFound"));
    notify("chef", "perdu ?");
    await tick();
    expect(pendingEvents("chef")).toEqual(["perdu ?"]);
    status("chef", "stopped");
    status("chef", "running");
    await vi.waitFor(() => expect(sent()).toEqual(["chef: [dummyPlane] perdu ?", "chef: [dummyPlane] perdu ?"]));
    expect(pendingEvents("chef")).toEqual([]);
  });
});

describe("a mission its Manager runs", () => {
  beforeAll(async () => {
    await nodesStore.getState().create("sitter", {
      workspaceId: "w1",
      kind: "fleet",
      payload: { name: "Sitter", mission: { state: "en_cours", maxAgents: 4, manager: "boss", members: [member("robin", "Robin", 1)] } },
    });
    await nodesStore.getState().create("boss", {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: "Manager", name: "Manager", agent: "claude", cwd: "C:/w", shell: "default", command: "", role: "manager", fleet: "sitter" },
    });
  });

  beforeEach(async () => {
    status("sitter", "running");
    status("boss", "running");
    status("robin", "running");
    await tick();
    activity("sitter", "idle");
    activity("boss", "idle");
    activity("robin", "working");
    vi.mocked(ptySendText).mockClear();
  });

  it("types a team agent's question and its stop into the Manager, never into the Fleet", async () => {
    activity("robin", "waiting");
    status("robin", "stopped");
    await vi.waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()).toEqual([
      "boss: [dummyPlane] Robin is waiting for the user (a dialog is open in its terminal).",
      "boss: [dummyPlane] Robin stopped: its terminal is no longer running.",
    ]);
  });

  it("says nothing of a finished team agent dummyPlane stopped to free its memory: its report said it all", async () => {
    await nodesStore.getState().create("robin", {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: "", name: "Robin", agent: "claude", cwd: "C:/w", shell: "default", command: "", spawnedBy: "boss", lastReport: { status: "done", summary: "ok" }, stoppedFinished: true },
    });
    try {
      status("robin", "exited");
      await tick();
      expect(sent()).toEqual([]);
    } finally {
      nodesStore.setState((s) => ({ nodes: Object.fromEntries(Object.entries(s.nodes).filter(([id]) => id !== "robin")) }));
    }
  });

  it("tells the Fleet, in one line each, when its Manager waits for the user or stops", async () => {
    activity("boss", "waiting");
    await vi.waitFor(() => expect(sent()).toEqual(["sitter: [dummyPlane] Manager is waiting for the user (a dialog is open in its terminal)."]));
    activity("boss", "idle");
    status("boss", "stopped");
    await vi.waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()[1]).toBe("sitter: [dummyPlane] Manager stopped: its terminal is no longer running, or it was closed. The board waits. " +
        "If the mission must go on, relaunch brings Manager back on its own conversation: tell the user in one line that you did and why, as they may have closed it on purpose; if they close it again, ask them rather than re-open it. stop_mission ends the mission.");
  });

  it("tells the Fleet its Manager restarted, not that it stopped, when its terminal comes back (review 13 Nov)", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "pty_kill") status((args as { nodeId: string }).nodeId, "exited");
      return cmd === "pty_spawn" ? 1 : undefined;
    });
    try {
      await relaunchSession("boss", { cols: 80, rows: 24, write: () => undefined }, { title: "Manager", name: "Manager", agent: "shell", cwd: "C:/w", shell: "default", command: "" }, "new");
      await vi.waitFor(() => expect(sent()).toHaveLength(1));
      expect(sent()).toEqual(["sitter: [dummyPlane] Manager restarted: its terminal runs again, and it takes the board up from where it stands. Nothing to do."]);
    } finally {
      mockIPC(() => undefined);
    }
  });

  it("holds the Manager's lines until its prompt is up after a start", async () => {
    status("boss", "stopped");
    vi.mocked(ptySendText).mockClear();
    let ready!: (value: boolean) => void;
    vi.mocked(whenReady).mockReturnValueOnce(new Promise((resolve) => (ready = resolve)));
    status("boss", "running");
    notify("boss", "You run the mission");
    await tick();
    expect(sent()).toEqual([]);
    ready(true);
    await vi.waitFor(() => expect(sent()).toEqual(["boss: [dummyPlane] You run the mission"]));
  });
});

describe("what a waiting agent waits on (issues #3, #14)", () => {
  const MCP: ScreenDialog = { kind: "mcp", title: "New MCP server found in this project: supabase", options: ["Use this MCP server", "Continue without using this MCP server"], selected: 1 };
  /** Claude Code's permission request in an unattended session (13 Nov), as its screen shows it. */
  const PERMISSION = [
    "─".repeat(80),
    " Bash command",
    " Stop background run and delete stray T11 artifacts in worktree",
    "╌".repeat(80),
    " │ rm -rf tempT11-bt",
    "╌".repeat(80),
    " ⚠  Claude Code will automatically block this request in 1:50, to avoid holding",
    " up an unattended session",
    "",
    " Do you want to proceed?",
    " ❯ 1. Yes",
    "   2. No",
    "",
    " Esc to cancel · Tab to amend",
  ].join("\n");

  beforeAll(async () => {
    await nodesStore.getState().create("bruce", {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: "", name: "Bruce", agent: "claude", cwd: "C:/w", shell: "default", command: "" },
    });
    await nodesStore.getState().create("dick", {
      workspaceId: "w1",
      kind: "terminal",
      payload: { title: "Tests", name: "Dick", agent: "claude", cwd: "C:/w", shell: "default", command: "", spawnedBy: "bruce" },
    });
  });

  beforeEach(() => {
    status("bruce", "running");
    status("dick", "running");
    status("aquaman", "running");
    activity("bruce", "idle");
    activity("dick", "idle");
    activity("aquaman", "idle");
    vi.mocked(ptySendText).mockClear();
  });

  afterEach(() => {
    holdFor("dick")(null);
    holdFor("aquaman")(null);
    markLaunching("dick", false);
  });

  it("tells a sub-agent's parent what holds its session from opening, and that its task waits for it", async () => {
    markLaunching("dick", true);
    holdFor("dick")(MCP);
    expect(agentActivityStore.getState().activities.dick).toMatchObject({ activity: "waiting", message: MCP.title });
    expect(pendingDialog("dick")).toMatchObject({ kind: "mcp", title: MCP.title, selected: 1 });
    await vi.waitFor(() =>
      expect(sent()).toEqual([
        'bruce: [dummyPlane] Dick is waiting for the user (Claude Code\'s question in its terminal before its session opens: "New MCP server found in this project: supabase"; the project\'s MCP servers are the user\'s to approve). answer_dialog reads it and says what you may answer yourself; what only the user answers, tell them if they may not have seen it. dummyPlane types its task as soon as its session opens: do not send it yourself.',
      ]),
    );
    // Answered: it waits no more, and nothing more is said.
    holdFor("dick")(null);
    expect(agentActivityStore.getState().activities.dick?.activity).not.toBe("waiting");
    expect(pendingDialog("dick")).toBeNull();
    expect(sent()).toHaveLength(1);
  });

  it("tells a mission's runner what holds a member before its sub-task is typed", async () => {
    holdFor("aquaman")(MCP);
    await vi.waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toBe(
      'chef: [dummyPlane] Aquaman is waiting for the user (Claude Code\'s question in its terminal before its session opens: "New MCP server found in this project: supabase"; the project\'s MCP servers are the user\'s to approve). dummyPlane types its sub-task as soon as its session opens: do not type it yourself.',
    );
  });

  it("names a permission request read on the screen when Claude's hook says it waits, and when Claude Code refuses it by itself", async () => {
    vi.mocked(freshText).mockReturnValue(PERMISSION);
    try {
      activity("dick", "waiting");
      await vi.waitFor(() => expect(sent()).toHaveLength(1));
      expect(sent()[0]).toMatch(
        /^bruce: \[dummyPlane\] Dick is waiting for the user \(a permission request in its terminal: "Bash command \(Stop background run and delete stray T11 artifacts in worktree\)", "Do you want to proceed\?"; Claude Code refuses it by itself in 1:(4\d|50) if nobody answers\)\. answer_dialog reads it and says what you may answer yourself/,
      );
      expect(pendingDialog("dick")).toMatchObject({ kind: "permission", options: ["1. Yes", "2. No"], selected: 0 });
    } finally {
      vi.mocked(freshText).mockReturnValue("");
      activity("dick", "idle");
    }
  });

  it("falls back on Claude's own words when its screen shows no dialog it reads", async () => {
    agentActivityStore.getState().apply({ nodeId: "dick", activity: "waiting", since: Date.now(), message: "Claude needs your permission to use Bash" });
    try {
      await vi.waitFor(() => expect(sent()).toHaveLength(1));
      expect(sent()[0]).toContain('Dick is waiting for the user (a permission request in its terminal: "Claude needs your permission to use Bash")');
    } finally {
      agentActivityStore.getState().remove("dick");
    }
  });
});
