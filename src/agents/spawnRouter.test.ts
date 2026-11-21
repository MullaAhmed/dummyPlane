// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { subagentSettingsStore } from "@/app/subagentSettings";
import { createNodeElement } from "@/canvas/nodeElement";
import { answer } from "@/mcp/router";
import { NEW_MISSION } from "@/mission/mission";
import { fleetSession } from "@/nodes/terminal/launch";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { ptySendText } from "@/ipc/pty";
import { spawnAgent } from "./spawn";
import { readWorkKind, routineLevel } from "./spawnModel";
import { addTerminal } from "./terminals";
import { modelRouterStore } from "@/app/modelRouterSetting";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/ipc/pty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/pty")>()),
  ptySendText: vi.fn(() => Promise.resolve()),
  ptyWrite: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/nodes/terminal/registry", () => ({ freshText: vi.fn(() => ""), quietFor: vi.fn(() => 0) }));
vi.mock("@/mission/ready", () => ({ whenReady: vi.fn(() => Promise.resolve(true)) }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));
vi.mock("@/mission/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mission/store")>()),
  workspaceCanvas: vi.fn(() => ({ frames: [], links: {} })),
}));
vi.mock("@/mission/folder", () => ({ missionFolder: vi.fn(() => "C:/code/project") }));
vi.mock("./naming", () => ({ nameForNewAgent: vi.fn(() => Promise.resolve("Robin")), pantheonForNewGroup: vi.fn(() => "norse") }));
vi.mock("./terminals", () => ({ addTerminal: vi.fn() }));
vi.mock("./spawnTree", async (importOriginal) => ({ ...(await importOriginal<typeof import("./spawnTree")>()), reflowSpawnTree: vi.fn(() => true) }));

let scene: ExcalidrawElement[] = [];
vi.mock("./sceneAccess", () => ({ sceneAccess: vi.fn(() => ({ shown: true, elements: () => scene, write: (next: readonly ExcalidrawElement[]) => (scene = [...next]) })) }));

const running = (id: string) => terminalStatusStore.getState().set(id, { state: "running" });

/** A Fleet on the canvas, its model router on or off, on Claude or Codex. */
async function addFleet(router: boolean, agent: "claude" | "codex" = "claude") {
  const session = fleetSession("Fleet", { cwd: "C:/code/elsewhere", shell: "pwsh" }, agent);
  await nodesStore.getState().create("fleet", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", session, mission: { ...NEW_MISSION, router: router || undefined } } });
  scene.push({ ...createNodeElement("fleet", { x: 0, y: 0 }), id: "fleet" } as unknown as ExcalidrawElement);
  running("fleet");
}

/** A Claude terminal, its own router switch as given. */
async function addAgent(router?: boolean) {
  const payload: TerminalPayload = { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code/wt", shell: "pwsh", command: "", claudeSessionId: "s", ...(router ? { router } : {}) };
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload });
  scene.push({ ...createNodeElement("terminal", { x: 0, y: 0 }), id: "batman" } as unknown as ExcalidrawElement);
  running("batman");
}

/** What the spawn_agent tool requires besides a task (`REQUIRED_EXTRA_KINDS`): a pick of none of each kind. */
const NO_EXTRAS = { skills: [], mcp_servers: [], plugins: [] };

/** The model the last sub-agent was opened with: what its `claude --model` gets. */
const lastPayload = () => vi.mocked(addTerminal).mock.lastCall![1];
const lastModel = () => lastPayload().model;

let created = 0;

beforeEach(() => {
  // The router as before Settings had one: only a switch set on routes. The global setting has its own tests.
  modelRouterStore.setState({ on: false, levels: {} });
  mockIPC(() => undefined);
  vi.clearAllMocks();
  scene = [];
  created = 0;
  subagentSettingsStore.setState({ terminals: true, maxSpawned: 50 });
  nodesStore.setState({ nodes: {} });
  for (const id of Object.keys(terminalStatusStore.getState().statuses)) terminalStatusStore.getState().remove(id);
  vi.mocked(addTerminal).mockImplementation(async (_workspaceId, payload, center) => {
    const id = `child${++created}`;
    await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload });
    scene.push({ ...createNodeElement("terminal", center), id } as unknown as ExcalidrawElement);
    return id;
  });
});

describe("spawn_agent with the model router", () => {
  it("starts a Fleet's sub-agent on its level's model while the Fleet's router is on, medium by default", async () => {
    await addFleet(true);
    const result = await spawnAgent("fleet", { task: "Fix the bug" });
    expect(result.error).toBeUndefined();
    // No model named, no level: medium, not the user's own default (Opus for this user).
    expect(lastModel()).toBe("claude-sonnet-5-5");
    // The Fleet hears which model its sub-agent got.
    expect(result.text).toContain("Sonnet 5.5");

    await spawnAgent("fleet", { task: "Rename a label", niveau: "faible" });
    expect(lastModel()).toBe("claude-haiku-5-5");
    await spawnAgent("fleet", { task: "Design the board", niveau: "extreme" });
    expect(lastModel()).toBe("claude-fable-5-2");
  });

  it("lets a level win over a model named, and refuses a model named with no level (`./spawnInherit.test.ts`)", async () => {
    await addFleet(true);
    await spawnAgent("fleet", { task: "Review the diff", niveau: "eleve", model: "haiku" });
    expect(lastModel()).toBe("claude-opus-5-5");
    expect((await spawnAgent("fleet", { task: "Check the logs", model: "haiku" })).error).toBe(true);
    expect(addTerminal).toHaveBeenCalledTimes(1);
  });

  it("routes a terminal's sub-agent by the terminal's own router", async () => {
    await addAgent(true);
    await spawnAgent("batman", { task: "Write the tests" });
    expect(lastModel()).toBe("claude-sonnet-5-5");
    await spawnAgent("batman", { task: "Write the docs", niveau: "faible" });
    expect(lastModel()).toBe("claude-haiku-5-5");
  });

  it("leaves the model as asked with the router off: a level does nothing, no model is Claude's own", async () => {
    await addFleet(false);
    await spawnAgent("fleet", { task: "Fix the bug", niveau: "eleve" });
    expect(lastModel()).toBeUndefined();
    await spawnAgent("fleet", { task: "Fix it again", model: "sonnet" });
    expect(lastModel()).toBe("sonnet");
    nodesStore.setState({ nodes: {} });
    scene = [];
    await addAgent();
    await spawnAgent("batman", { task: "Write the tests" });
    expect(lastModel()).toBeUndefined();
  });

  it("never gives a Codex sub-agent a Claude model", async () => {
    await addFleet(true, "codex");
    await spawnAgent("fleet", { task: "Fix the bug", niveau: "eleve" });
    expect(lastPayload().agent).toBe("codex");
    expect(lastModel()).toBeUndefined();
  });

  it("takes the level as the Fleet's and an agent's MCP calls write it, in English", async () => {
    // The three kinds the tool requires are checked by Rust, which answers with the pick (here, none of each).
    mockIPC((cmd, args) => (cmd === "check_subagent_extras" ? (args as { pick: unknown }).pick : undefined));
    await addFleet(true);
    await answer({ callId: 1, nodeId: "fleet", method: "tools/call", params: { name: "spawn_agent", arguments: { task: "Rename a label", level: "low", ...NO_EXTRAS } } });
    expect(lastModel()).toBe("claude-haiku-5-5");
    await addAgent(true);
    await answer({ callId: 2, nodeId: "batman", method: "tools/call", params: { name: "spawn_agent", arguments: { task: "Review the diff", level: "high", ...NO_EXTRAS } } });
    expect(lastModel()).toBe("claude-opus-5-5");
  });

  it("refuses a level it does not know", async () => {
    await addFleet(true);
    const result = await spawnAgent("fleet", { task: "Fix the bug", niveau: "huge" });
    expect(result.error).toBe(true);
    expect(result.text).toContain("low, medium, high or extreme");
    expect(addTerminal).not.toHaveBeenCalled();
  });
});

/**
 * The router put a costly model on a whole task, and that model wrote the files and verified them too. Routine work
 * (kind write or verify) opens at medium at most; a sub-agent the router put on a costly model is told to plan and
 * decide, and to hand that routine work down.
 */
describe("routine work and the costly levels", () => {
  /** The text typed into the last sub-agent opened. */
  const typed = async () => {
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalled());
    return vi.mocked(ptySendText).mock.lastCall![1];
  };
  const REPORT_LINE = "\n\nWhen you are done, commit if you changed files, then call report (summary, status): Batman reads it.";

  beforeEach(() => {
    // Its task is typed only into a sub-agent whose terminal runs.
    const open = vi.mocked(addTerminal).getMockImplementation()!;
    vi.mocked(addTerminal).mockImplementation(async (...args) => {
      const id = await open(...args);
      if (id) running(id);
      return id;
    });
  });

  it("lowers write and verify from high or extreme to medium, keeps every other level, and leaves no level to the router", () => {
    expect(routineLevel("eleve", "write")).toEqual({ level: "moyen", lowered: "eleve" });
    expect(routineLevel("extreme", "verify")).toEqual({ level: "moyen", lowered: "extreme" });
    for (const kind of ["write", "verify"] as const) {
      expect(routineLevel("faible", kind)).toEqual({ level: "faible" });
      expect(routineLevel("moyen", kind)).toEqual({ level: "moyen" });
      expect(routineLevel(undefined, kind)).toEqual({ level: undefined });
    }
    expect(routineLevel("extreme", "plan")).toEqual({ level: "extreme" });
    expect(routineLevel("eleve", undefined)).toEqual({ level: "eleve" });
    expect(readWorkKind(" Write ")).toBe("write");
    expect(readWorkKind("code")).toBeUndefined();
    expect(readWorkKind(3)).toBeUndefined();
  });

  it("opens write and verify rated high or extreme on medium's model, and the answer says the level was lowered", async () => {
    await addAgent(true);
    const write = await spawnAgent("batman", { task: "Write the parser from the plan", niveau: "eleve", kind: "write" });
    expect(write.error).toBeUndefined();
    expect(lastModel()).toBe("claude-sonnet-5-5");
    expect(write.text).toContain("on Sonnet 5.5 (the model router's medium level)");
    expect(write.text).toContain("Its level was lowered from high to medium: write work is routine and opens at medium at most");
    await spawnAgent("batman", { task: "Run the suite and read it", niveau: "extreme", kind: "verify" });
    expect(lastModel()).toBe("claude-sonnet-5-5");
  });

  it("keeps a lower level for routine work, the level of plan or of no kind, and medium for want of a level", async () => {
    await addAgent(true);
    const low = await spawnAgent("batman", { task: "Run the linter", niveau: "faible", kind: "verify" });
    expect(lastModel()).toBe("claude-haiku-5-5");
    expect(low.text).not.toContain("lowered");
    await spawnAgent("batman", { task: "Design the cache", niveau: "extreme", kind: "plan" });
    expect(lastModel()).toBe("claude-fable-5-2");
    await spawnAgent("batman", { task: "Debug the deadlock", niveau: "eleve" });
    expect(lastModel()).toBe("claude-opus-5-5");
    const none = await spawnAgent("batman", { task: "Write the docs", kind: "write" });
    expect(lastModel()).toBe("claude-sonnet-5-5");
    expect(none.text).not.toContain("lowered");
    // An empty kind is none, as for the level and the role.
    await spawnAgent("batman", { task: "Hard review", niveau: "eleve", kind: "" });
    expect(lastModel()).toBe("claude-opus-5-5");
  });

  it("refuses a kind it does not know, and opens nothing", async () => {
    await addAgent(true);
    const result = await spawnAgent("batman", { task: "Do it", niveau: "eleve", kind: "code" });
    expect(result).toEqual({ text: expect.stringContaining('Unknown kind "code": plan, write or verify'), error: true });
    expect(addTerminal).not.toHaveBeenCalled();
  });

  it("leaves a model named by hand as it is with the router off: the user's own choice", async () => {
    await addAgent();
    await spawnAgent("batman", { task: "Write the parser", model: "opus", kind: "write" });
    expect(lastModel()).toBe("opus");
  });

  it("takes the kind as an agent's MCP call writes it", async () => {
    mockIPC((cmd, args) => (cmd === "check_subagent_extras" ? (args as { pick: unknown }).pick : undefined));
    await addAgent(true);
    await answer({ callId: 1, nodeId: "batman", method: "tools/call", params: { name: "spawn_agent", arguments: { task: "Write it", level: "high", kind: "write", ...NO_EXTRAS } } });
    expect(lastModel()).toBe("claude-sonnet-5-5");
  });

  it("tells a sub-agent the router put on a costly model to plan and decide, and to hand its routine work down", async () => {
    await addAgent(true);
    const task = "Redesign the session store";
    await spawnAgent("batman", { task, niveau: "eleve" });
    const text = await typed();
    expect(text.startsWith("[dummyPlane · sub-agent of Batman] You run on Opus 5.5, the model router's high level: a costly model, kept for planning and the hard decisions.")).toBe(true);
    expect(text).toContain("at level low or medium, with kind write or verify");
    expect(text).toContain("do the work yourself when spawn_agent refuses for want of a seat");
    expect(text.endsWith(`Your task: ${task}${REPORT_LINE}`)).toBe(true);
    // In the text typed only: its terminal keeps the task alone, which names it and finds a duplicate.
    expect(lastPayload().task).toBe(task);

    vi.mocked(ptySendText).mockClear();
    await spawnAgent("batman", { task: "Hardest", niveau: "extreme" });
    expect(await typed()).toContain("You run on Fable 5.2, the model router's extreme level");
  });

  it("tells nothing of the kind to a sub-agent at medium or below, one the router did not route, or a manager", async () => {
    await addAgent(true);
    for (const [task, niveau] of [["Fix the typo", "faible"], ["Fix the bug", "moyen"], ["Write the parser", "eleve"]] as const) {
      vi.mocked(ptySendText).mockClear();
      await spawnAgent("batman", { task, niveau, kind: task === "Write the parser" ? "write" : undefined });
      expect(await typed()).toBe(`[dummyPlane · sub-agent of Batman] ${task}${REPORT_LINE}`);
    }
    // A manager's own brief already hands everything down.
    vi.mocked(ptySendText).mockClear();
    await spawnAgent("batman", { task: "Fix the five bugs", niveau: "eleve", role: "manager" });
    const manager = await typed();
    expect(manager).toContain("You are a manager");
    expect(manager).not.toContain("You run on");

    // The router off: the level picked no model, so none is costly.
    nodesStore.setState({ nodes: {} });
    scene = [];
    await addAgent();
    vi.mocked(ptySendText).mockClear();
    await spawnAgent("batman", { task: "Redesign it", niveau: "eleve" });
    expect(await typed()).toBe(`[dummyPlane · sub-agent of Batman] Redesign it${REPORT_LINE}`);
  });

  it("tells nothing of it to a sub-agent that could open none of its own (the depth limit): it would delegate into a refusal", async () => {
    await addAgent(true);
    // Batman is a top agent: its sub-agents go 3 levels below it, and only the third can open none.
    for (const [parent, level] of [["batman", 1], ["child1", 2], ["child2", 3]] as const) {
      vi.mocked(ptySendText).mockClear();
      expect((await spawnAgent(parent, { task: `Level ${level}`, niveau: "eleve" })).error).toBeUndefined();
      const text = await typed();
      if (level < 3) expect(text).toContain("You run on Opus 5.5");
      else expect(text).not.toContain("You run on");
    }
  });
});
