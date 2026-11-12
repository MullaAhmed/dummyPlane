// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { subagentSettingsStore } from "@/app/subagentSettings";
import { createNodeElement } from "@/canvas/nodeElement";
import { spawnAgentSpec } from "@/mcp/agentTools";
import { answer } from "@/mcp/router";
import { NEW_MISSION, type Mission } from "@/mission/mission";
import { setMission } from "@/mission/store";
import { fleetSession } from "@/nodes/terminal/launch";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { spawnAgent } from "./spawn";
import { addTerminal } from "./terminals";
import { modelRouterStore } from "@/app/modelRouterSetting";

/**
 * The model router and spawn_agent, past the first hop: who a router governs (a Fleet's whole spawn tree, its
 * mission's team and theirs, a terminal's own tree), and what a call with a model and no level gets while one does.
 * The first hop's table is `./spawnRouter.test.ts`.
 */

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
vi.mock("./naming", () => ({ nameForNewAgent: vi.fn(() => Promise.resolve("Robin")) }));
vi.mock("./terminals", () => ({ addTerminal: vi.fn() }));
vi.mock("./spawnTree", () => ({ reflowSpawnTree: vi.fn(() => true) }));

let scene: ExcalidrawElement[] = [];
vi.mock("./sceneAccess", () => ({ sceneAccess: vi.fn(() => ({ shown: true, elements: () => scene, write: (next: readonly ExcalidrawElement[]) => (scene = [...next]) })) }));

const running = (id: string) => terminalStatusStore.getState().set(id, { state: "running" });

/** A Fleet on the canvas, its model router on or off, on Claude or Codex, its mission as given. */
async function addFleet(router: boolean, agent: "claude" | "codex" = "claude", mission: Partial<Mission> = {}) {
  const session = fleetSession("Fleet", { cwd: "C:/code/elsewhere", shell: "pwsh" }, agent);
  await nodesStore.getState().create("fleet", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", session, mission: { ...NEW_MISSION, router: router || undefined, ...mission } } });
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

/** Batman on the Fleet's running mission, his sub-task sent. */
const onTheTeam = (): Partial<Mission> => ({
  state: "en_cours",
  members: [{ nodeId: "batman", name: "Batman", task: "Login", budgetMin: 10, linked: true, branch: "b", worktree: "w", sentAt: 0 }],
});

const lastPayload = () => vi.mocked(addTerminal).mock.lastCall![1];
const lastModel = () => lastPayload().model;
const payloadOf = (id: string) => terminalOf(nodesStore.getState().nodes[id])!;

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
    running(id);
    return id;
  });
});

describe("a model named with no level, while a model router is on", () => {
  it("is refused before any terminal opens, and the refusal asks for the task's difficulty", async () => {
    await addFleet(true);
    const result = await spawnAgent("fleet", { task: "Fix the bug", model: "opus" });
    expect(result.error).toBe(true);
    expect(addTerminal).not.toHaveBeenCalled();
    expect(result.text).toContain('"opus"');
    expect(result.text).toContain("level");
    expect(result.text).toContain("low Haiku 5.5, medium Sonnet 5.5, high Opus 5.5, extreme Fable 5.2");
    // It steers to the task's difficulty, not to the level that spells the model it wanted.
    expect(result.text).toContain("medium suits most");
    // The same call with a level goes through.
    expect((await spawnAgent("fleet", { task: "Fix the bug", model: "opus", niveau: "moyen" })).error).toBeUndefined();
    expect(lastModel()).toBe("claude-sonnet-5-5");
  });

  it("is refused for a terminal whose own router is on, through its MCP call", async () => {
    await addAgent(true);
    const result = (await answer({ callId: 1, nodeId: "batman", method: "tools/call", params: { name: "spawn_agent", arguments: { task: "Write the tests", model: "opus" } } })) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(addTerminal).not.toHaveBeenCalled();
  });

  it("stands with every router off, and on a Codex sub-agent, which no router routes", async () => {
    await addFleet(false);
    expect((await spawnAgent("fleet", { task: "Fix the bug", model: "opus" })).error).toBeUndefined();
    expect(lastModel()).toBe("opus");
    nodesStore.setState({ nodes: {} });
    scene = [];
    await addFleet(true, "codex");
    expect((await spawnAgent("fleet", { task: "Fix another bug", model: "gpt-5" })).error).toBeUndefined();
    expect(lastPayload().agent).toBe("codex");
    expect(lastModel()).toBe("gpt-5");
  });
});

describe("what spawn_agent answers about the model", () => {
  it("says a model named beside a level was set aside", async () => {
    await addFleet(true);
    const result = await spawnAgent("fleet", { task: "Review the diff", niveau: "faible", model: "opus" });
    expect(lastModel()).toBe("claude-haiku-5-5");
    expect(result.text).toContain("Haiku 5.5");
    expect(result.text).toContain("opus");
    expect(result.text).toContain("set aside");
  });

  it("says medium was taken for want of a level, and asks for one", async () => {
    await addFleet(true);
    const result = await spawnAgent("fleet", { task: "Fix the bug" });
    expect(result.text).toContain("Sonnet 5.5");
    expect(result.text).toContain("no level");
    const rated = await spawnAgent("fleet", { task: "Design the board", niveau: "eleve" });
    expect(rated.text).not.toContain("no level");
    expect(rated.text).not.toContain("set aside");
  });

  it("says a level picked nothing when no router is on, why, and what the sub-agent runs instead", async () => {
    await addFleet(false);
    const result = await spawnAgent("fleet", { task: "Fix the bug", niveau: "eleve" });
    expect(lastModel()).toBeUndefined();
    expect(result.text).toContain("Its level (high) picked no model: the model router is off in dummyPlane's Settings. It runs Claude's own default model.");
    expect((await spawnAgent("fleet", { task: "Fix it twice" })).text).not.toContain("model router");
    expect((await spawnAgent("fleet", { task: "Fix it thrice", niveau: "faible", model: "opus" })).text).toContain("It runs the model you named.");
  });

  it("takes an empty or null level as none, as it does a model", async () => {
    await addFleet(true);
    expect((await spawnAgent("fleet", { task: "Fix the bug", niveau: "" })).error).toBeUndefined();
    expect(lastModel()).toBe("claude-sonnet-5-5");
    expect((await spawnAgent("fleet", { task: "Fix the other bug", niveau: null })).error).toBeUndefined();
    expect(lastModel()).toBe("claude-sonnet-5-5");
  });
});

describe("a model router down the spawn tree", () => {
  it("routes the sub-agents of a Fleet's sub-agent, and theirs, their own switches left off", async () => {
    await addFleet(true);
    await spawnAgent("fleet", { task: "Fix the bug", niveau: "eleve" });
    // The child's own switch is not turned on: the Fleet's router reaches it through who spawned it.
    expect(payloadOf("child1").router).toBeUndefined();
    const result = await spawnAgent("child1", { task: "Find the failing test" });
    expect(lastModel()).toBe("claude-sonnet-5-5");
    expect(result.text).toContain("Sonnet 5.5");
    await spawnAgent("child2", { task: "Read the log", niveau: "faible" });
    expect(lastModel()).toBe("claude-haiku-5-5");
    expect(payloadOf("child3").spawnedBy).toBe("child2");
    // And a model named with no level is refused there as it is for the Fleet.
    expect((await spawnAgent("child1", { task: "Check the types", model: "opus" })).error).toBe(true);
  });

  it("follows the Fleet's switch as it stands at each spawn", async () => {
    await addFleet(true);
    await spawnAgent("fleet", { task: "Fix the bug" });
    setMission("fleet", { router: undefined });
    await spawnAgent("child1", { task: "Find the failing test" });
    expect(lastModel()).toBeUndefined();
    setMission("fleet", { router: true });
    await spawnAgent("child1", { task: "Find the other failing test" });
    expect(lastModel()).toBe("claude-sonnet-5-5");
  });

  it("routes the sub-agents of a terminal's sub-agent by that terminal's own router", async () => {
    await addAgent(true);
    await spawnAgent("batman", { task: "Write the tests" });
    await spawnAgent("child1", { task: "Write the fixtures", niveau: "faible" });
    expect(lastModel()).toBe("claude-haiku-5-5");
  });

  it("routes nothing below a terminal with no router anywhere above it", async () => {
    await addAgent();
    await spawnAgent("batman", { task: "Write the tests" });
    await spawnAgent("child1", { task: "Write the fixtures", model: "opus" });
    expect(lastModel()).toBe("opus");
  });

  it("routes the sub-agents of a mission's team agent while its Fleet's router is on, and theirs", async () => {
    await addFleet(true, "claude", onTheTeam());
    await addAgent();
    await spawnAgent("batman", { task: "Write the tests" });
    expect(lastModel()).toBe("claude-sonnet-5-5");
    await spawnAgent("child1", { task: "Write the fixtures", niveau: "extreme" });
    expect(lastModel()).toBe("claude-fable-5-2");
    expect(payloadOf("batman").router).toBeUndefined();
  });

  it("leaves a team agent's sub-agents alone with the Fleet's router off; on, a Codex Fleet routes its Claude agent's by Claude's levels", async () => {
    await addFleet(false, "claude", onTheTeam());
    await addAgent();
    await spawnAgent("batman", { task: "Write the tests" });
    expect(lastModel()).toBeUndefined();
    nodesStore.setState({ nodes: {} });
    scene = [];
    // The router's state is the Fleet's, whatever its CLI; the model is the one the level names on the sub-agent's.
    await addFleet(true, "codex", onTheTeam());
    await addAgent();
    await spawnAgent("batman", { task: "Write the docs" });
    expect(lastPayload().agent).toBe("claude");
    expect(lastModel()).toBe("claude-sonnet-5-5");
  });
});

describe("spawn_agent's description", () => {
  it("tells an agent and a Fleet to rate each task with level, whoever's router governs them", () => {
    for (const spec of [spawnAgentSpec(), spawnAgentSpec(true)]) {
      expect(spec.description).toContain("level");
      expect(spec.description).toContain("model router");
      const { level, model } = spec.inputSchema.properties;
      // An agent cannot see a switch, least of all one it inherits: the level is asked for on every call.
      expect(level.description).toContain("on every call");
      expect(level.description).toContain("medium suits most");
      expect(model.description).toContain("refused");
    }
  });
});
