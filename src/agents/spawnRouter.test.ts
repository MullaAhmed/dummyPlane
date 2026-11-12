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
import { spawnAgent } from "./spawn";
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
vi.mock("./naming", () => ({ nameForNewAgent: vi.fn(() => Promise.resolve("Robin")) }));
vi.mock("./terminals", () => ({ addTerminal: vi.fn() }));
vi.mock("./spawnTree", () => ({ reflowSpawnTree: vi.fn(() => true) }));

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
    await addFleet(true);
    await answer({ callId: 1, nodeId: "fleet", method: "tools/call", params: { name: "spawn_agent", arguments: { task: "Rename a label", level: "low" } } });
    expect(lastModel()).toBe("claude-haiku-5-5");
    await addAgent(true);
    await answer({ callId: 2, nodeId: "batman", method: "tools/call", params: { name: "spawn_agent", arguments: { task: "Review the diff", level: "high" } } });
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
