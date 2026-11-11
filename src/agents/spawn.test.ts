// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { subagentSettingsStore } from "@/app/subagentSettings";
import { createNodeElement } from "@/canvas/nodeElement";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import { ptySendText } from "@/ipc/pty";
import { notify } from "@/mission/events";
import { whenReady } from "@/mission/ready";
import { workspaceCanvas } from "@/mission/store";
import { MAX_STORED_TASK, type TerminalPayload } from "@/nodes/types";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { nameForNewAgent } from "./naming";
import { spawnAgent } from "./spawn";
import { markLaunching, markReported, runningSpawned } from "./spawnFamily";
import { reflowSpawnTree } from "./spawnTree";
import { addTerminal } from "./terminals";
import { isSpawnWire } from "./wires";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/ipc/pty", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/pty")>()),
  ptySendText: vi.fn(() => Promise.resolve()),
  ptyWrite: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/nodes/terminal/registry", () => ({ freshText: vi.fn(() => ""), quietFor: vi.fn(() => 0) }));
vi.mock("@/mission/ready", () => ({ whenReady: vi.fn(() => Promise.resolve(true)) }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));
vi.mock("@/mission/store", () => ({ workspaceCanvas: vi.fn(() => ({ frames: [], links: {} })) }));
vi.mock("./naming", () => ({ nameForNewAgent: vi.fn(() => Promise.resolve("Robin")) }));
vi.mock("./terminals", () => ({ addTerminal: vi.fn() }));
vi.mock("./spawnTree", () => ({ reflowSpawnTree: vi.fn(() => true) }));

/** The workspace's scene, as `sceneAccess` reads and writes it. */
let scene: ExcalidrawElement[] = [];
const write = vi.fn((elements: readonly ExcalidrawElement[]) => (scene = [...elements]));
vi.mock("./sceneAccess", () => ({ sceneAccess: vi.fn(() => ({ shown: true, elements: () => scene, write })) }));

const terminal = (name: string, extra: Partial<TerminalPayload> = {}): TerminalPayload => ({
  title: name,
  name,
  agent: "claude",
  cwd: "C:/code/wt",
  shell: "pwsh",
  command: "",
  claudeSessionId: `${name}-session`,
  ...extra,
});

/** A terminal node on the canvas, its element in the scene under its own id. */
async function addNode(id: string, payload: TerminalPayload, at = { x: 0, y: 0 }) {
  await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload });
  scene.push({ ...createNodeElement("terminal", at), id } as unknown as ExcalidrawElement);
}

const running = (id: string) => terminalStatusStore.getState().set(id, { state: "running" });

let created = 0;

beforeEach(async () => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  clearWirePulses();
  scene = [];
  created = 0;
  subagentSettingsStore.setState({ terminals: true, maxSpawned: 6 });
  nodesStore.setState({ nodes: {} });
  for (const id of Object.keys(terminalStatusStore.getState().statuses)) terminalStatusStore.getState().remove(id);
  vi.mocked(addTerminal).mockImplementation(async (_workspaceId, payload, center) => {
    const id = `child${++created}`;
    await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload });
    scene.push({ ...createNodeElement("terminal", center), id } as unknown as ExcalidrawElement);
    running(id);
    return id;
  });
  await addNode("batman", terminal("Batman", { permission: "work", accountId: "pro" }));
  running("batman");
});
afterEach(() => clearWirePulses());

describe("spawn_agent", () => {
  it("opens a Claude terminal beside its parent, in its folder, marked as spawned by it", async () => {
    const result = await spawnAgent("batman", { task: "Write the tests", title: "Tests", model: "sonnet" });
    expect(result.error).toBeUndefined();
    expect(result.text).toContain("Robin opened beside you");
    const [workspaceId, payload, center, group, arrival] = vi.mocked(addTerminal).mock.calls[0];
    expect(workspaceId).toBe("w1");
    expect(group).toBeNull();
    // Nobody asked for it: the user may be typing, so it neither scrolls the view nor takes the keyboard.
    expect(arrival).toEqual({ reveal: false, source: "spawn" });
    expect(payload).toMatchObject({
      name: "Robin",
      title: "Tests",
      agent: "claude",
      cwd: "C:/code/wt",
      shell: "pwsh",
      model: "sonnet",
      // A mission's rules and the parent's Claude account bind the sub-agent too.
      permission: "work",
      accountId: "pro",
      spawnedBy: "batman",
    });
    expect(payload.claudeSessionId).toBeTruthy();
    expect(payload.claudeSessionId).not.toBe("Batman-session");
    const parent = scene.find((e) => e.id === "batman")!;
    expect(center.x).toBeGreaterThan(parent.x + parent.width);
  });

  it("types the task into the sub-agent once its Claude is ready, and lights the wire toward it", async () => {
    await spawnAgent("batman", { task: "Write the tests\nfor the router" });
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalled());
    const [id, text] = vi.mocked(ptySendText).mock.calls[0];
    expect(id).toBe("child1");
    expect(text).toContain("[dummyPlane · sub-agent of Batman] Write the tests\nfor the router");
    expect(text).toContain("call report");
    expect(wireActivityStore.getState().pulses.child1).toMatchObject({ direction: "toAgent", fleetId: "batman" });
    // Given its task, it counts as running only while its process runs.
    terminalStatusStore.getState().set("child1", { state: "exited", code: 0 });
    expect(runningSpawned()).toBe(0);
  });

  it("draws a spawn wire from the parent to the sub-agent, then lays the tree out", async () => {
    vi.mocked(reflowSpawnTree).mockImplementationOnce(() => {
      // Called once the element, the record and the wire all exist.
      expect(scene.some((e) => e.id === "child1")).toBe(true);
      expect(scene.some((e) => isSpawnWire(e))).toBe(true);
      expect(terminalOf(nodesStore.getState().nodes.child1)?.spawnedBy).toBe("batman");
      return true;
    });
    await spawnAgent("batman", { task: "Do it" });
    expect(reflowSpawnTree).toHaveBeenCalledWith("w1", "child1");
    const wire = scene.find((e) => e.type === "arrow")!;
    expect(isSpawnWire(wire)).toBe(true);
    expect(wire).toMatchObject({ startBinding: { elementId: "batman" }, endBinding: { elementId: "child1" } });
    expect(scene.find((e) => e.id === "batman")!.boundElements).toEqual([{ id: wire.id, type: "arrow" }]);
  });

  it("tells the parent when the sub-agent's Claude never got ready, and types nothing", async () => {
    vi.mocked(whenReady).mockResolvedValueOnce(false);
    await spawnAgent("batman", { task: "Do it" });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("batman", expect.stringContaining("Robin is not ready")));
    expect(ptySendText).not.toHaveBeenCalled();
  });

  it("joins its parent's group, named from the group's pantheon", async () => {
    vi.mocked(workspaceCanvas).mockReturnValue({
      frames: [{ id: "g1", x: 0, y: 0, width: 10, height: 10, name: "Team", memberIds: ["batman"], group: { role: "general", pantheon: "egyptian" } }],
      links: {},
    } as unknown as ReturnType<typeof workspaceCanvas>);
    await spawnAgent("batman", { task: "Do it" });
    expect(nameForNewAgent).toHaveBeenCalledWith("w1", "egyptian");
    expect(vi.mocked(addTerminal).mock.calls[0][3]).toBe("g1");
    vi.mocked(workspaceCanvas).mockReturnValue({ frames: [], links: {} } as unknown as ReturnType<typeof workspaceCanvas>);
  });

  it("lets a sub-agent spawn its own, down to the depth limit", async () => {
    await spawnAgent("batman", { task: "Level 1" });
    await spawnAgent("child1", { task: "Level 2" });
    const third = await spawnAgent("child2", { task: "Level 3" });
    expect(third.error).toBeUndefined();
    expect(terminalOf(nodesStore.getState().nodes.child2)?.spawnedBy).toBe("child1");
    expect(terminalOf(nodesStore.getState().nodes.child3)?.spawnedBy).toBe("child2");
    const fourth = await spawnAgent("child3", { task: "Level 4" });
    expect(fourth).toEqual({ text: expect.stringContaining("Too deep"), error: true });
    expect(addTerminal).toHaveBeenCalledTimes(3);
  });

  it("refuses past the cap on sub-agents running at once", async () => {
    subagentSettingsStore.setState({ maxSpawned: 2 });
    await spawnAgent("batman", { task: "One" });
    await spawnAgent("batman", { task: "Two" });
    const third = await spawnAgent("batman", { task: "Three" });
    expect(third).toEqual({ text: expect.stringContaining("2 sub-agents are already running, the most at once is 2"), error: true });
    // One that reported frees its seat, its terminal still open; so does one that stopped.
    markReported("child1");
    expect((await spawnAgent("batman", { task: "Three" })).error).toBeUndefined();
    terminalStatusStore.getState().set("child2", { state: "exited", code: 0 });
    expect((await spawnAgent("batman", { task: "Four" })).error).toBeUndefined();
  });

  it("counts a sub-agent from its creation: two spawns of one turn cannot both pass a cap of one", async () => {
    subagentSettingsStore.setState({ maxSpawned: 1 });
    // Its process does not run yet and its Claude is not ready.
    vi.mocked(addTerminal).mockImplementation(async (_workspaceId, payload, center) => {
      const id = `child${++created}`;
      await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload });
      scene.push({ ...createNodeElement("terminal", center), id } as unknown as ExcalidrawElement);
      return id;
    });
    vi.mocked(whenReady).mockReturnValue(new Promise(() => undefined));
    const [first, second] = await Promise.all([spawnAgent("batman", { task: "One" }), spawnAgent("batman", { task: "Two" })]);
    expect(first.error).toBeUndefined();
    expect(second.error).toBe(true);
    expect(addTerminal).toHaveBeenCalledTimes(1);
    markLaunching("child1", false);
    vi.mocked(whenReady).mockResolvedValue(true);
  });

  it("refuses a call without a task or with an odd model, and a caller no longer on the canvas", async () => {
    expect(await spawnAgent("batman", { task: "  " })).toEqual({ text: expect.stringContaining("task"), error: true });
    expect(await spawnAgent("batman", { task: "Do it", model: "opus; rm -rf" })).toEqual({ text: expect.stringContaining("Unknown model"), error: true });
    scene = scene.map((e) => (e.id === "batman" ? { ...e, isDeleted: true } : e));
    expect((await spawnAgent("batman", { task: "Do it" })).error).toBe(true);
    expect(await spawnAgent("nobody", { task: "Do it" })).toEqual({ text: expect.stringContaining("no longer on the canvas"), error: true });
    expect(addTerminal).not.toHaveBeenCalled();
  });

  it("titles the terminal after the task when no title is given", async () => {
    await spawnAgent("batman", { task: "Refactor the very long module name that goes on and on past sixty characters\nsecond line" });
    const title = vi.mocked(addTerminal).mock.calls[0][1].title;
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.startsWith("Refactor the very long module")).toBe(true);
    expect(title).not.toContain("\n");
  });

  it("says a brief in a line for its title, and keeps the task's start for the line under its name", async () => {
    const task = `You are fixing a readability problem in dummyPlane (Tauri 2 + React 19).\n\n## Setup\n1. Run \`pnpm i\`.\n\n${"More. ".repeat(500)}`;
    await spawnAgent("batman", { task });
    const payload = vi.mocked(addTerminal).mock.calls[0][1];
    expect(payload.title).toBe("Fixing a readability problem in dummyPlane");
    expect(payload.task).toBe(task.slice(0, MAX_STORED_TASK));
    // Its payload keeps the start only; the whole task still goes to the sub-agent.
    expect(payload.task!.length).toBeLessThan(task.length);
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalled());
    expect(vi.mocked(ptySendText).mock.calls[0][1]).toContain(task.trim());
  });

  it("keeps the spawner's own title over its task", async () => {
    await spawnAgent("batman", { task: "You are a reviewer. Review the login diff.", title: "Login review" });
    expect(vi.mocked(addTerminal).mock.calls[0][1]).toMatchObject({ title: "Login review", task: "You are a reviewer. Review the login diff." });
  });
});
