// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { toast } from "sonner";
import { logInfo } from "@/app/log";
import { API_KEY, CLAUDE, GUARDED, LOGIN, MCP_ONE, PERMISSION, WORKING } from "@/agents/dialogFixtures";
import { ptySendText, ptyWrite } from "@/ipc/pty";
import { clearDraft, trackInput } from "@/nodes/terminal/draft";
import { freshText, touchedAgo, typedAgo } from "@/nodes/terminal/registry";
import { agentActivityStore, type AgentActivity } from "@/store/agentActivity";
import { setMission } from "@/mission/store";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { subAgentsOf, subAgentTool } from "./subAgentTools";

vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/app/log", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/app/log")>()), logInfo: vi.fn() }));
vi.mock("@/ipc/pty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/pty")>()),
  ptySendText: vi.fn(() => Promise.resolve()),
  ptyWrite: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/nodes/terminal/registry", () => ({
  freshText: vi.fn(() => ""),
  terminalText: vi.fn(() => ""),
  typedAgo: vi.fn(() => Infinity),
  touchedAgo: vi.fn(() => Infinity),
  relaunchTerminal: vi.fn(() => Promise.resolve()),
  isLiveInRust: vi.fn(() => false),
}));
vi.mock("@/mission/launch", () => ({ deliveryPending: vi.fn(() => false) }));
vi.mock("@/mission/events", () => ({ pendingEvents: vi.fn(() => []), TYPING_PAUSE_MS: 4000, notify: vi.fn() }));
vi.mock("@/agents/remoteControl", () => ({ remoteBusy: vi.fn(() => false) }));
vi.mock("@/agents/talkWires", () => ({ talk: vi.fn() }));
vi.mock("@excalidraw/excalidraw", () => ({}));

const terminal = (name: string, extra: Record<string, unknown> = {}) => ({ title: name, name, agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "", ...extra });
const member = (nodeId: string, name: string, linked = false) => ({ nodeId, name, task: name, budgetMin: 20, linked, branch: `b-${nodeId}`, worktree: `C:/w/${nodeId}`, sentAt: 1 });
const run = (caller: string, args: Record<string, unknown>) => subAgentTool(caller, "run_command", args)!;
const answer = (caller: string, args: Record<string, unknown>) => subAgentTool(caller, "answer_dialog", args)!;
const textOf = (result: { content: { text: string }[] }) => result.content[0].text;

/** Each terminal's screen, and its agent's activity. */
let screens: Record<string, string> = {};
const activity = (nodeId: string, state: AgentActivity["activity"]) =>
  agentActivityStore.setState((s) => ({ activities: { ...s.activities, [nodeId]: { activity: state, since: 1 } } }));
const NO_AT_PROMPT = PERMISSION.replace(" ❯ 1. Yes", "   1. Yes").replace("   2. No", " ❯ 2. No");

beforeAll(async () => {
  mockIPC(() => undefined);
  workspacesStore.setState({ activeId: "w1" });
  const create = (id: string, payload: object, kind: "terminal" | "fleet" = "terminal") => nodesStore.getState().create(id, { workspaceId: "w1", kind, payload } as never);
  await create("thor", terminal("Thor"));
  await create("loki", terminal("Loki", { spawnedBy: "thor" }));
  await create("sif", terminal("Sif", { spawnedBy: "thor", agent: "codex" }));
  await create("hela", terminal("Hela", { spawnedBy: "loki" }));
  await create("odin", terminal("Odin"));
  await create(
    "chef",
    { name: "Chef", mission: { state: "en_cours", maxAgents: 2, name: "Auth", manager: "boss", plan: [], queue: [], members: [member("robin", "Robin"), member("batman", "Batman", true)] } },
    "fleet",
  );
  await create("boss", terminal("Manager", { role: "manager", fleet: "chef" }));
  await create("robin", terminal("Robin", { spawnedBy: "boss" }));
  await create("batman", terminal("Batman"));
  await create("wanda", terminal("Wanda", { spawnedBy: "chef" }));
});

beforeEach(() => {
  screens = {};
  vi.mocked(freshText).mockImplementation((nodeId) => screens[nodeId] ?? CLAUDE);
  vi.mocked(typedAgo).mockReturnValue(Infinity);
  vi.mocked(touchedAgo).mockReturnValue(Infinity);
  for (const id of ["thor", "loki", "sif", "hela", "odin", "chef", "boss", "robin", "batman", "wanda"]) {
    terminalStatusStore.getState().set(id, { state: "running" });
    activity(id, "idle");
  }
  vi.mocked(ptySendText).mockClear();
  vi.mocked(ptyWrite).mockReset().mockResolvedValue(undefined);
  vi.mocked(toast).mockClear();
  vi.mocked(logInfo).mockClear();
});

afterEach(() => clearDraft("loki"));

describe("who a parent acts on", () => {
  it("is its own sub-agents: an agent the ones it opened, a Manager its team, a Fleet the ones it opened and its Manager", () => {
    const names = (id: string) => subAgentsOf(id).map((a) => a.name);
    expect(names("thor")).toEqual(["Loki", "Sif"]);
    expect(names("loki")).toEqual(["Hela"]);
    expect(names("boss")).toEqual(["Robin", "Batman"]);
    expect(names("chef")).toEqual(["Wanda", "Manager"]);
    expect(names("odin")).toEqual([]);
  });

  it("runs a command in its own sub-agent, by name or id", async () => {
    expect(textOf(await run("thor", { agent: "loki", command: "/compact" }))).toContain("/compact typed in Loki's terminal");
    expect(textOf(await run("loki", { agent: "Hela", command: "/compact" }))).toContain("typed in Hela's terminal");
    expect(textOf(await run("boss", { agent: "Robin", command: "/compact" }))).toContain("typed in Robin's terminal");
    expect(textOf(await run("chef", { agent: "Manager", command: "/compact" }))).toContain("typed in Manager's terminal");
    expect(textOf(await run("chef", { agent: "Wanda", command: "/compact" }))).toContain("typed in Wanda's terminal");
    expect(vi.mocked(ptySendText).mock.calls).toEqual(["loki", "hela", "robin", "boss", "wanda"].map((id) => [id, "/compact"]));
  });

  it("refuses anyone else's: a grandchild, a stranger, its parent, its Manager's team for a Fleet", async () => {
    for (const [caller, agent] of [["thor", "Hela"], ["thor", "Odin"], ["loki", "Thor"], ["chef", "Robin"], ["boss", "Wanda"], ["robin", "Manager"]]) {
      const result = await run(caller, { agent, command: "/compact" });
      expect(result.isError, `${caller} → ${agent}`).toBe(true);
      expect(textOf(result)).toContain(`${agent} is not a sub-agent of yours`);
    }
    expect(textOf(await run("thor", { agent: "Hela", command: "/compact" }))).toContain("Yours: Loki, Sif.");
    expect(textOf(await answer("thor", { agent: "Hela" }))).toContain("Hela is not a sub-agent of yours");
    expect(textOf(await run("odin", { command: "/compact" }))).toContain("You have none");
    expect(ptySendText).not.toHaveBeenCalled();
  });
});

describe("run_command", () => {
  it("types only an allowed command: no text, no other command", async () => {
    expect(textOf(await run("thor", { agent: "Loki", command: "fix the tests" }))).toContain("Only one of Claude Code's commands");
    expect(textOf(await run("thor", { agent: "Loki", command: "/model haiku" }))).toContain("/model is not one a parent may run");
    expect(textOf(await run("thor", { agent: "Loki", command: "/cost" }))).toContain("open a panel that would hold it");
    expect(textOf(await run("thor", { agent: "Loki", command: "/login" }))).toContain("not one a parent may run");
    expect(ptySendText).not.toHaveBeenCalled();
  });

  it("types nothing while the sub-agent works, waits on a dialog, is off its prompt or stopped", async () => {
    activity("loki", "working");
    screens.loki = WORKING;
    expect(textOf(await run("thor", { agent: "Loki", command: "/compact" }))).toContain("Loki is working");
    activity("loki", "waiting");
    screens.loki = PERMISSION;
    expect(textOf(await run("thor", { agent: "Loki", command: "/compact" }))).toContain("Loki waits on a dialog");
    activity("loki", "idle");
    screens.loki = "PS C:\\code> ";
    expect(textOf(await run("thor", { agent: "Loki", command: "/compact" }))).toContain("prompt is not on its screen");
    terminalStatusStore.getState().set("loki", { state: "exited" } as never);
    expect(textOf(await run("thor", { agent: "Loki", command: "/compact" }))).toContain("Loki is not running");
    expect(ptySendText).not.toHaveBeenCalled();
  });

  it("types nothing over the user's unsent text, nor right after their last key", async () => {
    trackInput("loki", "half a sent");
    expect(textOf(await run("thor", { agent: "Loki", command: "/compact" }))).toContain("The user is typing in Loki's terminal");
    trackInput("loki", "\r");
    vi.mocked(typedAgo).mockReturnValue(1000);
    expect(textOf(await run("thor", { agent: "Loki", command: "/compact" }))).toContain("The user is typing");
    expect(ptySendText).not.toHaveBeenCalled();
    vi.mocked(typedAgo).mockReturnValue(60_000);
    expect((await run("thor", { agent: "Loki", command: "/compact" })).isError).toBeUndefined();
  });

  it("is Claude Code's: a Codex sub-agent is refused", async () => {
    expect(textOf(await run("thor", { agent: "Sif", command: "/compact" }))).toContain("Sif does not run Claude Code");
  });

  it("warns that /clear loses the task, and never clears an agent the user lent to the mission", async () => {
    expect(textOf(await run("thor", { agent: "Loki", command: "/clear" }))).toContain("Its conversation is gone: send it its task again");
    expect(textOf(await run("boss", { agent: "Batman", command: "/clear" }))).toContain("Batman is an agent of the user's lent to the mission");
    expect((await run("boss", { agent: "Batman", command: "/compact" })).isError).toBeUndefined();
  });

  it("shows the user every command it ran, and logs it", async () => {
    await run("thor", { agent: "Loki", command: "/clear" });
    await run("thor", { agent: "Loki", command: "/compact keep the API decisions" });
    expect(vi.mocked(toast).mock.calls.map(([line]) => line)).toEqual(["Thor ran /clear in Loki's terminal", "Thor ran /compact keep the API decisions in Loki's terminal"]);
    expect(vi.mocked(logInfo).mock.calls.map(([line]) => line)).toEqual([
      "sub-agent control: Thor ran /clear in Loki's terminal",
      "sub-agent control: Thor ran /compact keep the API decisions in Loki's terminal",
    ]);
  });
});

describe("answer_dialog", () => {
  /** Loki waits on `screen`; the arrows and Enter it is sent move its cursor and close it, as Claude Code does. */
  function waitsOn(screen: string, moved: string) {
    activity("loki", "waiting");
    screens.loki = screen;
    vi.mocked(ptyWrite).mockImplementation(async (_id, keys) => {
      if (keys === "\x1b[B") screens.loki = moved;
      if (keys === "\r") screens.loki = CLAUDE;
    });
  }
  const readId = async () => JSON.parse(textOf(await answer("thor", { agent: "Loki" }))).dialog as string;
  const keys = () => vi.mocked(ptyWrite).mock.calls.map(([, k]) => k);

  it("reads the dialog: its lines, its options, which the parent may pick, and its id", async () => {
    waitsOn(PERMISSION, NO_AT_PROMPT);
    const read = JSON.parse(textOf(await answer("thor", { agent: "Loki" })));
    expect(read).toMatchObject({ agent: "Loki", kind: "permission", options: [{ option: "1. Yes", may_pick: true }, { option: "2. No", may_pick: true }] });
    // The command it would run, not only what the sub-agent says it is for.
    expect(read.lines).toContain("│ rm -rf tempT11-bt tempT11-bt-red tempT11-bt2 tempT11-full && rm -f");
    expect(read.next).toContain(`dialog "${read.dialog}"`);
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("picks an option of the dialog read, with the user shown who answered what, and the log", async () => {
    waitsOn(PERMISSION, NO_AT_PROMPT);
    const id = await readId();
    expect(textOf(await answer("thor", { agent: "Loki", dialog: id, option: "2" }))).toBe('"2. No" picked in Loki\'s dialog; the user is shown it.');
    expect(keys()).toEqual(["\x1b[B", "\r"]);
    expect(toast).toHaveBeenCalledWith('Thor answered Loki\'s dialog "Do you want to proceed?": 2. No');
    expect(logInfo).toHaveBeenCalledWith('sub-agent control: Thor answered Loki\'s dialog "Do you want to proceed?": 2. No');
  });

  it("answers only the dialog it read: one that came after with the same options is refused", async () => {
    waitsOn(PERMISSION, NO_AT_PROMPT);
    const id = await readId();
    screens.loki = PERMISSION.replace(/tempT11/g, "tempT12");
    expect(textOf(await answer("thor", { agent: "Loki", dialog: id, option: "Yes" }))).toContain("not the one you read");
    expect(textOf(await answer("thor", { agent: "Loki", option: "Yes" }))).toContain("Read the dialog first");
    expect(ptyWrite).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("refuses Yes to a prompt dummyPlane's guard raised, and lets No through", async () => {
    waitsOn(GUARDED, GUARDED.replace(" ❯ 1. Yes", "   1. Yes").replace("   2. No", " ❯ 2. No"));
    const read = JSON.parse(textOf(await answer("thor", { agent: "Loki" })));
    expect(read).toMatchObject({ guard: true, options: [{ option: "1. Yes", may_pick: false }, { option: "2. No", may_pick: true }] });
    expect(textOf(await answer("thor", { agent: "Loki", dialog: read.dialog, option: "1" }))).toContain("only No is yours, Yes is the user's");
    expect(ptyWrite).not.toHaveBeenCalled();
    expect((await answer("thor", { agent: "Loki", dialog: read.dialog, option: "No" })).isError).toBeUndefined();
    expect(keys()).toEqual(["\x1b[B", "\r"]);
  });

  it("lets a parent go on without a project's new MCP servers, never approve one", async () => {
    waitsOn(MCP_ONE, MCP_ONE);
    const id = await readId();
    expect(textOf(await answer("thor", { agent: "Loki", dialog: id, option: "Use this MCP server" }))).toContain("Approving a project's own MCP servers is the user's");
    expect(ptyWrite).not.toHaveBeenCalled();
    // Its cursor is on it already: Enter alone.
    expect((await answer("thor", { agent: "Loki", dialog: id, option: "Continue without using this MCP server" })).isError).toBeUndefined();
    expect(keys()).toEqual(["\r"]);
  });

  it("leaves to the user what holds a session from opening, but going on without new MCP servers", async () => {
    waitsOn(API_KEY, API_KEY);
    const dialog = { kind: "permission" as const, title: "Detected a custom API key in your environment", options: ["1. Yes", "2. No (recommended)"], since: 1 };
    agentActivityStore.getState().hold("loki", { activity: "waiting", since: 1, dialog });
    try {
      const read = JSON.parse(textOf(await answer("thor", { agent: "Loki" })));
      expect(read.options.map((o: { may_pick: boolean }) => o.may_pick)).toEqual([false, false]);
      expect(textOf(await answer("thor", { agent: "Loki", dialog: read.dialog, option: "1" }))).toContain("before its session opens");
      screens.loki = MCP_ONE;
      const mcp = JSON.parse(textOf(await answer("thor", { agent: "Loki" })));
      expect((await answer("thor", { agent: "Loki", dialog: mcp.dialog, option: "3" })).isError).toBeUndefined();
      expect(keys()).toEqual(["\r"]);
    } finally {
      agentActivityStore.getState().hold("loki", null);
    }
  });

  it("leaves a login to the user", async () => {
    waitsOn(LOGIN, LOGIN);
    const read = JSON.parse(textOf(await answer("thor", { agent: "Loki" })));
    expect(read.next).toContain("only the user answers it");
    expect(textOf(await answer("thor", { agent: "Loki", dialog: read.dialog, option: "1" }))).toBe("A login is the user's alone: tell them.");
  });

  it("presses nothing while the user is at the terminal, and finds no dialog in an agent that waits on none", async () => {
    waitsOn(PERMISSION, NO_AT_PROMPT);
    const id = await readId();
    vi.mocked(touchedAgo).mockReturnValue(2000);
    expect(textOf(await answer("thor", { agent: "Loki", dialog: id, option: "2" }))).toContain("The user is at Loki's terminal");
    expect(ptyWrite).not.toHaveBeenCalled();
    activity("loki", "idle");
    expect(textOf(await answer("thor", { agent: "Loki" }))).toBe("Loki waits on no dialog.");
  });
});

describe("a mission's Yes once", () => {
  /** `nodeId` waits on a permission request; Down moves its cursor to No, Enter closes it. */
  function waits(nodeId: string) {
    activity(nodeId, "waiting");
    screens[nodeId] = PERMISSION;
    vi.mocked(ptyWrite).mockImplementation(async (id, keys) => {
      if (keys === "\x1b[B") screens[id] = NO_AT_PROMPT;
      if (keys === "\r") screens[id] = CLAUDE;
    });
  }
  const pick = async (caller: string, agent: string, option: string) => {
    const read = JSON.parse(textOf(await answer(caller, { agent })));
    return answer(caller, { agent, dialog: read.dialog, option });
  };

  afterEach(() => setMission("chef", { permission: undefined }));

  it("is refused to a Manager and a Fleet in a mission run in Ask or Edit files, by day as at night; No goes through", async () => {
    for (const mode of [undefined, "ask", "edits"] as const) {
      setMission("chef", { permission: mode });
      waits("robin");
      const refused = await pick("boss", "Robin", "Yes");
      expect(refused.isError, String(mode)).toBe(true);
      expect(textOf(refused)).toContain(`This mission runs in ${mode === "edits" ? "Edit files" : "Ask"}: only the user approves a command there`);
      waits("boss");
      expect(textOf(await pick("chef", "Manager", "Yes"))).toContain("only the user approves a command there");
      expect(ptyWrite).not.toHaveBeenCalled();
      expect((await pick("boss", "Robin", "No")).isError, String(mode)).toBeUndefined();
      vi.mocked(ptyWrite).mockClear();
    }
  });

  it("is allowed to a Manager and a Fleet in a mission run in Work (Edit files and run commands)", async () => {
    setMission("chef", { permission: "work" });
    waits("robin");
    const read = JSON.parse(textOf(await answer("boss", { agent: "Robin" })));
    expect(read.options).toEqual([{ option: "1. Yes", may_pick: true }, { option: "2. No", may_pick: true }]);
    expect((await pick("boss", "Robin", "Yes")).isError).toBeUndefined();
    expect(vi.mocked(ptyWrite).mock.calls).toEqual([["robin", "\r"]]);
    waits("boss");
    expect((await pick("chef", "Manager", "1")).isError).toBeUndefined();
  });

  it("stays with an ordinary parent, whatever a mission's mode", async () => {
    setMission("chef", { permission: "edits" });
    waits("loki");
    expect(textOf(await pick("thor", "Loki", "Yes"))).toBe('"1. Yes" picked in Loki\'s dialog; the user is shown it.');
  });
});
