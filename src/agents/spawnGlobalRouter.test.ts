// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { modelRouterStore } from "@/app/modelRouterSetting";
import { subagentSettingsStore } from "@/app/subagentSettings";
import { createNodeElement } from "@/canvas/nodeElement";
import { NEW_MISSION, type Mission } from "@/mission/mission";
import { followRouter, routerAt, setRouter } from "@/mission/routerState";
import { fleetSession } from "@/nodes/terminal/launch";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { spawnAgent } from "./spawn";
import { addTerminal } from "./terminals";

/**
 * The model router as a global setting, on by default: every agent's sub-agents route by level with no switch turned
 * on; a switch set off vetoes it for its node and all it spawns; a Fleet's switch decides for its mission's team and
 * Manager; a Codex sub-agent takes the models Settings maps for Codex. The switch-only behaviour (Settings off) is
 * `./spawnRouter.test.ts` and `./spawnInherit.test.ts`.
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

/** A Fleet on the canvas, its switch as given (unset: it follows Settings), on Claude or Codex, its mission as given. */
async function addFleet(router: boolean | undefined, agent: "claude" | "codex" = "claude", mission: Partial<Mission> = {}) {
  const session = fleetSession("Fleet", { cwd: "C:/code/elsewhere", shell: "pwsh" }, agent);
  await nodesStore.getState().create("fleet", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", session, mission: { ...NEW_MISSION, router, ...mission } } });
  scene.push({ ...createNodeElement("fleet", { x: 0, y: 0 }), id: "fleet" } as unknown as ExcalidrawElement);
  running("fleet");
}

/** A terminal, its own switch as given. */
async function addAgent(id = "batman", extra: Partial<TerminalPayload> = {}) {
  const payload: TerminalPayload = { title: "Batman", name: id === "batman" ? "Batman" : id, agent: "claude", cwd: "C:/code/wt", shell: "pwsh", command: "", claudeSessionId: "s", ...extra };
  await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload });
  scene.push({ ...createNodeElement("terminal", { x: 0, y: 0 }), id } as unknown as ExcalidrawElement);
  running(id);
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
  mockIPC(() => undefined);
  vi.clearAllMocks();
  scene = [];
  created = 0;
  modelRouterStore.setState({ on: true, levels: {} });
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

describe("Settings' model router, on by default", () => {
  it("routes every agent's sub-agents by level, no switch turned on anywhere, and the answer names the model", async () => {
    await addAgent();
    expect(payloadOf("batman").router).toBeUndefined();
    const low = await spawnAgent("batman", { task: "Rename a label", niveau: "faible" });
    expect(lastModel()).toBe("claude-haiku-5-5");
    expect(low.text).toContain("Robin opened beside you on Haiku 5.5 (the model router's low level)");
    const none = await spawnAgent("batman", { task: "Fix the bug" });
    expect(lastModel()).toBe("claude-sonnet-5-5");
    expect(none.text).toContain("on Sonnet 5.5 (the model router's medium level, as you gave no level");
    // The rule for Claude stands: a model named with no level is refused while the router is on.
    expect((await spawnAgent("batman", { task: "Check the logs", model: "opus" })).error).toBe(true);
  });

  it("routes nothing with Settings off unless a switch is set on, and the answer says why", async () => {
    modelRouterStore.setState({ on: false });
    await addAgent();
    const result = await spawnAgent("batman", { task: "Fix the bug", niveau: "eleve" });
    expect(lastModel()).toBeUndefined();
    expect(result.text).toContain("Its level (high) picked no model: the model router is off in dummyPlane's Settings. It runs Claude's own default model.");
    setRouter("batman", true);
    expect(payloadOf("batman").router).toBe(true);
    await spawnAgent("batman", { task: "Fix it again", niveau: "eleve" });
    expect(lastModel()).toBe("claude-opus-5-5");
  });
});

describe("a switch set off", () => {
  it("vetoes the router for its node and everything it spawns, read at each spawn", async () => {
    await addAgent();
    setRouter("batman", false);
    expect(payloadOf("batman").router).toBe(false);
    const own = await spawnAgent("batman", { task: "Fix the bug", niveau: "eleve" });
    expect(lastModel()).toBeUndefined();
    expect(own.text).toContain("Its level (high) picked no model: the user turned the model router off on your terminal, for you and every agent under you.");
    // Its sub-agent's own switch is unset: it inherits the veto, and says whose it is.
    expect(payloadOf("child1").router).toBeUndefined();
    const below = await spawnAgent("child1", { task: "Find the failing test", niveau: "faible" });
    expect(lastModel()).toBeUndefined();
    expect(below.text).toContain("the user turned the model router off at Batman, for it and every agent under it");
    // Follow Settings unsets it: Batman follows Settings again, and the tree below routes on its next spawn.
    followRouter("batman");
    expect(payloadOf("batman").router).toBeUndefined();
    await spawnAgent("child1", { task: "Read the log", niveau: "faible" });
    expect(lastModel()).toBe("claude-haiku-5-5");
    // Turned on, it is stored as set: it holds with Settings off.
    setRouter("batman", true);
    expect(payloadOf("batman").router).toBe(true);
    modelRouterStore.setState({ on: false });
    await spawnAgent("child1", { task: "Read it again", niveau: "eleve" });
    expect(lastModel()).toBe("claude-opus-5-5");
  });

  it("gives way to a switch set on nearer the spawner: the nearest switch set wins", async () => {
    await addAgent();
    setRouter("batman", false);
    await spawnAgent("batman", { task: "Fix the bug" });
    // Its sub-agent shows the veto it inherits; turned on, it is stored as set, and routes its own tree.
    expect(routerAt(nodesStore.getState().nodes, "child1")).toEqual({ on: false, at: "batman" });
    setRouter("child1", true);
    expect(payloadOf("child1").router).toBe(true);
    await spawnAgent("child1", { task: "Write the docs", niveau: "eleve" });
    expect(lastModel()).toBe("claude-opus-5-5");
  });

  it("on a Fleet, vetoes its mission's team and their sub-agents; unset, the team follows Settings", async () => {
    await addFleet(false, "claude", onTheTeam());
    await addAgent();
    const result = await spawnAgent("batman", { task: "Write the tests", niveau: "eleve" });
    expect(lastModel()).toBeUndefined();
    expect(result.text).toContain("the user turned the model router off at Fleet");
    expect((await spawnAgent("fleet", { task: "Look it up", niveau: "faible" })).text).toContain("on your terminal");
    nodesStore.setState({ nodes: {} });
    scene = [];
    await addFleet(undefined, "claude", onTheTeam());
    await addAgent();
    await spawnAgent("batman", { task: "Write the tests", niveau: "eleve" });
    expect(lastModel()).toBe("claude-opus-5-5");
  });

  it("on a Fleet, vetoes what its Manager spawns too", async () => {
    await addFleet(false, "claude", { state: "en_cours", manager: "manager" });
    await addAgent("manager", { role: "manager", fleet: "fleet" });
    await spawnAgent("manager", { task: "Check the merge", niveau: "faible" });
    expect(lastModel()).toBeUndefined();
    nodesStore.getState().update("fleet", { mission: { ...NEW_MISSION, state: "en_cours", manager: "manager" } });
    await spawnAgent("manager", { task: "Check it again", niveau: "faible" });
    expect(lastModel()).toBe("claude-haiku-5-5");
  });
});

describe("a Codex sub-agent", () => {
  it("takes the model Settings maps for its level, and the answer names it", async () => {
    modelRouterStore.setState({ levels: { codex: { faible: "gpt-mini", eleve: "gpt-big" } } });
    await addFleet(undefined, "codex");
    const result = await spawnAgent("fleet", { task: "Rename a label", niveau: "faible" });
    expect(lastPayload().agent).toBe("codex");
    expect(lastModel()).toBe("gpt-mini");
    expect(result.text).toContain("Robin opened beside you on gpt-mini (the model router's low level)");
    // A level wins over a model named beside it, as for Claude.
    const named = await spawnAgent("fleet", { task: "Review the diff", niveau: "eleve", model: "gpt-other" });
    expect(lastModel()).toBe("gpt-big");
    expect(named.text).toContain("set aside");
  });

  it("keeps its CLI's own model for a level the map leaves empty, and the answer says Codex has none for it", async () => {
    modelRouterStore.setState({ levels: { codex: { faible: "gpt-mini" } } });
    await addFleet(undefined, "codex");
    const result = await spawnAgent("fleet", { task: "Fix the bug", niveau: "moyen" });
    expect(lastModel()).toBeUndefined();
    expect(result.text).toContain("Its level (medium) picked no model: Codex has no model for the medium level (Settings › Models by level…). It runs Codex's own default model.");
    // No level: medium, which the map leaves empty too.
    expect((await spawnAgent("fleet", { task: "Fix another bug" })).text).toContain("Codex has no model for the medium level");
  });

  it("routes nothing with an empty map, and a model named with no level stands: the refusal is Claude's", async () => {
    await addFleet(undefined, "codex");
    await spawnAgent("fleet", { task: "Fix the bug", niveau: "eleve" });
    expect(lastModel()).toBeUndefined();
    const named = await spawnAgent("fleet", { task: "Fix another bug", model: "gpt-5" });
    expect(named.error).toBeUndefined();
    expect(lastModel()).toBe("gpt-5");
    // A level the map leaves empty keeps the model named beside it.
    const both = await spawnAgent("fleet", { task: "Fix a third bug", model: "gpt-5", niveau: "faible" });
    expect(lastModel()).toBe("gpt-5");
    expect(both.text).toContain("It runs the model you named.");
  });
});
