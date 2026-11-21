// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { markLaunching } from "@/agents/spawnFamily";
import { removeFromStoredScene, removeNodes } from "@/agents/terminals";
import { NEW_MISSION, type Member } from "@/mission/mission";
import { missionOf } from "@/mission/store";
import { stopTerminal } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { fleetTool, managerTool, managerTools } from "./fleetTools";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/nodes/terminal/registry", () => ({
  relaunchTerminal: vi.fn(),
  // A stop ends the process: the close waits for it before the terminal leaves the canvas.
  stopTerminal: vi.fn(),
  terminalText: vi.fn(),
  quietFor: vi.fn(() => 0),
  typedAgo: vi.fn(() => Infinity),
  freshText: vi.fn(() => ""),
  markForAutostart: vi.fn(),
  isLiveInRust: vi.fn(() => false),
  xtermOf: vi.fn(),
}));
vi.mock("@/agents/terminals", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/agents/terminals")>()), removeNodes: vi.fn(), removeFromStoredScene: vi.fn() }));
vi.mock("@/agents/finishedStop", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/agents/finishedStop")>()), takenOver: vi.fn(() => false) }));

const textOf = (result: { content: { text: string }[] }) => result.content[0].text;
const terminal = (name: string, extra: Record<string, unknown> = {}) => ({ title: name, name, agent: "claude" as const, cwd: `C:/w/${name.toLowerCase()}`, shell: "default" as const, command: "", ...extra });
const reported = { summary: "ok", status: "termine" as const, at: 2 };
const member = (nodeId: string, name: string, extra: Partial<Member> = {}): Member => ({
  nodeId, name, task: name, budgetMin: 10, linked: false, branch: `dummyplane/auth-${nodeId}`, worktree: `C:/w/${name.toLowerCase()}`, sentAt: 1, ...extra,
});
const team = [
  member("a1", "Batman", { report: reported }),
  member("a2", "Aquaman", { report: reported }),
  member("a3", "Flash", { report: reported }),
  member("a4", "Cyborg"),
  member("a5", "Raven"),
  member("a6", "Robin", { linked: true, report: reported }),
  member("a7", "Fresh", { report: reported }),
];
const stopped = () => vi.mocked(stopTerminal).mock.calls.map(([id]) => id);

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  vi.mocked(stopTerminal).mockImplementation((id: string) => terminalStatusStore.getState().set(id, { state: "stopped" }));
  workspacesStore.setState({ activeId: "w1" });
  agentActivityStore.setState({ activities: {}, under: {} });
  await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: terminal("Manager", { role: "manager", fleet: "chef" }) });
  for (const m of team) await nodesStore.getState().create(m.nodeId, { workspaceId: "w1", kind: "terminal", payload: terminal(m.name, { spawnedBy: "boss" }) });
  // Batman's own sub-agent, done; Raven stopped before reporting.
  await nodesStore.getState().create("loki", { workspaceId: "w1", kind: "terminal", payload: terminal("Loki", { spawnedBy: "a1", cwd: "C:/w/batman" }) });
  for (const id of ["chef", "boss", "a1", "a2", "a3", "a4", "a6", "a7", "loki"]) terminalStatusStore.getState().set(id, { state: "running" });
  terminalStatusStore.getState().set("a5", { state: "stopped" });
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", session: terminal("Chef", { role: "orchestrator" }), mission: { ...NEW_MISSION, state: "en_cours", name: "Auth", manager: "boss", project: "C:/code/proj", slug: "auth", worktree: "C:/w/auth", branch: "dummyplane/auth", members: team } },
  });
});

afterEach(() => {
  vi.mocked(stopTerminal).mockReset();
  markLaunching("a7", false);
});

describe("close_agent, the Manager's (#13)", () => {
  it("is the Manager's tool, with the agent it closes, and no one else's", async () => {
    const tool = managerTools().find((spec) => spec.name === "close_agent");
    expect(tool?.inputSchema).toEqual({ type: "object", properties: { agent: { type: "string" } }, required: ["agent"] });
    expect(tool?.description).toContain("that has reported, or stopped");
    expect((await fleetTool("chef", "close_agent", { agent: "Batman" })).isError).toBe(true);
    expect(stopped()).toEqual([]);
  });

  it("closes an agent that reported, with its own sub-agents that are done, and keeps its record", async () => {
    const result = await managerTool("boss", "close_agent", { agent: "Batman" });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe("Batman's terminal is closed, with 1 of its own sub-agents. Its report, card, branch and worktree stay: the mission's cleanup saves what it left uncommitted.");
    expect(stopped()).toEqual(["a1", "loki"]);
    // Off the canvas, the way the mission's own cleanups take a terminal off.
    expect([...vi.mocked(removeNodes).mock.calls, ...vi.mocked(removeFromStoredScene).mock.calls].length).toBe(1);
    expect(missionOf(nodesStore.getState().nodes.chef)?.members.find((m) => m.name === "Batman")).toMatchObject({ report: reported, branch: "dummyplane/auth-a1" });
  });

  it("closes an agent that stopped before reporting: nothing of it runs any more", async () => {
    expect(textOf(await managerTool("boss", "close_agent", { agent: "Raven" }))).toContain("Raven's terminal is closed.");
    expect(stopped()).toEqual(["a5"]);
  });

  it("never closes one at work, waiting on a dialog, still launching, not reported while it runs, or linked", async () => {
    agentActivityStore.getState().apply({ nodeId: "a2", activity: "working", since: 0 });
    agentActivityStore.getState().hold("a3", { activity: "waiting", since: 0, message: "Allow Bash?" });
    markLaunching("a7", true);
    const refusals: [string, string][] = [
      ["Aquaman", "Aquaman stays open: at work. Nothing was closed."],
      ["Flash", "Flash stays open: waiting on a dialog only the user answers. Nothing was closed."],
      ["Fresh", "Fresh stays open: still starting. Nothing was closed."],
      ["Cyborg", "Cyborg has not reported and is still running: let it report, or interrupt it and reassign its sub-task. Nothing was closed."],
      ["Robin", "Robin is a linked agent, the user's own: it goes back to their project at the mission's end. Nothing was closed."],
    ];
    for (const [agent, text] of refusals) {
      const result = await managerTool("boss", "close_agent", { agent });
      expect(result.isError, agent).toBe(true);
      expect(textOf(result)).toBe(text);
    }
    // Batman's sub-agent at work keeps Batman open: its report would be typed into it.
    agentActivityStore.getState().apply({ nodeId: "loki", activity: "working", since: 0 });
    expect(textOf(await managerTool("boss", "close_agent", { agent: "Batman" }))).toBe("Batman stays open: its own sub-agents are at work. Nothing was closed.");
    expect(stopped()).toEqual([]);
  });

  it("says a terminal the user closed already is gone, and leaves its closed sub-agents alone", async () => {
    try {
      nodesStore.getState().close("a5");
      expect(textOf(await managerTool("boss", "close_agent", { agent: "Raven" }))).toBe("Raven's terminal is gone already: nothing to close.");
      nodesStore.getState().close("loki");
      expect(textOf(await managerTool("boss", "close_agent", { agent: "Batman" }))).toContain("Batman's terminal is closed.");
      expect(stopped()).toEqual(["a1"]);
    } finally {
      // Back on the canvas for the next tests, which make them again.
      await nodesStore.getState().persist("a5");
      await nodesStore.getState().persist("loki");
    }
  });
});

describe("merge naming an agent fixing its own conflict (#12)", () => {
  it("is refused while that agent is at work on it: a merge now would undo its resolution", async () => {
    nodesStore.getState().update("chef", {
      mission: { ...missionOf(nodesStore.getState().nodes.chef)!, members: team.map((m) => (m.name === "Aquaman" ? { ...m, conflictAt: reported.at } : m)) },
    });
    agentActivityStore.getState().apply({ nodeId: "a2", activity: "working", since: 0 });
    const result = await managerTool("boss", "fusionner", { agent: "Aquaman" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Aquaman is at work: let it finish and report, or interrupt it first. Nothing was recorded.");
  });
});
