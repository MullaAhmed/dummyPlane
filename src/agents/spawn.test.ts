// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { subagentSettingsStore } from "@/app/subagentSettings";
import { createNodeElement } from "@/canvas/nodeElement";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import { ptySendText } from "@/ipc/pty";
import { notify } from "@/mission/events";
import { NEW_MISSION, type Member, type Mission } from "@/mission/mission";
import { whenReady } from "@/mission/ready";
import { workspaceCanvas } from "@/mission/store";
import { fleetSession } from "@/nodes/terminal/launch";
import { MAX_STORED_TASK, type TerminalPayload } from "@/nodes/types";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { nameForNewAgent } from "./naming";
import { spawnAgent } from "./spawn";
import { isLaunching, markLaunching, markReported, runningSpawned } from "./spawnFamily";
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
vi.mock("@/mission/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mission/store")>()),
  workspaceCanvas: vi.fn(() => ({ frames: [], links: {} })),
}));
// The Fleet's workspace folder; its own session started elsewhere.
vi.mock("@/mission/folder", () => ({ missionFolder: vi.fn(() => "C:/code/project") }));
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

describe("spawn_agent from a Fleet", () => {
  /** A Fleet on the canvas, its Claude (or Codex) session started in another folder than its workspace's. */
  async function addFleet(mission?: Mission, agent: "claude" | "codex" = "claude") {
    const session = { ...fleetSession("Fleet", { cwd: "C:/code/elsewhere", shell: "pwsh" }, agent), permission: mission?.permission, linear: true as const, remoteControl: true };
    await nodesStore.getState().create("fleet", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", session, ...(mission ? { mission } : {}) } });
    scene.push({ ...createNodeElement("fleet", { x: 0, y: 600 }), id: "fleet" } as unknown as ExcalidrawElement);
    running("fleet");
  }

  const night = (state: Mission["state"]): Mission => ({ ...NEW_MISSION, state, overnight: true, budgetMin: 480, permission: "work" });

  it("opens a regular agent beside the Fleet, in its workspace's folder, without the manager's rails", async () => {
    await addFleet();
    const result = await spawnAgent("fleet", { task: "Find where the router is tested", title: "Lookup" });
    expect(result.error).toBeUndefined();
    expect(result.text).toContain("Robin opened beside you");
    const [workspaceId, payload, center] = vi.mocked(addTerminal).mock.calls[0];
    expect(workspaceId).toBe("w1");
    expect(payload).toMatchObject({ name: "Robin", title: "Lookup", agent: "claude", cwd: "C:/code/project", shell: "pwsh", spawnedBy: "fleet" });
    // An agent's launch: no fleet role (no edit/command deny, the user's servers on), no Linear, no Remote Control, no night.
    for (const key of ["role", "linear", "remoteControl", "permission", "extensions"]) expect(payload).not.toHaveProperty(key);
    expect(payload.claudeSessionId).toBeTruthy();
    expect(payload.claudeSessionId).not.toBe(sessionOfFleet().claudeSessionId);
    const fleet = scene.find((e) => e.id === "fleet")!;
    expect(center.x).toBeGreaterThan(fleet.x + fleet.width);
    // Its brief names the Fleet, which its report goes back to.
    await vi.waitFor(() => expect(ptySendText).toHaveBeenCalled());
    expect(vi.mocked(ptySendText).mock.calls[0][1]).toContain("[dummyPlane · sub-agent of Fleet] Find where the router is tested");
  });

  it("draws a spawn wire from the Fleet to its sub-agent, then lays the tree out", async () => {
    await addFleet();
    await spawnAgent("fleet", { task: "Do it" });
    const wire = scene.find((e) => e.type === "arrow")!;
    expect(isSpawnWire(wire)).toBe(true);
    expect(wire).toMatchObject({ startBinding: { elementId: "fleet" }, endBinding: { elementId: "child1" } });
    expect(reflowSpawnTree).toHaveBeenCalledWith("w1", "child1");
  });

  it("gives its sub-agent what a team agent of its night gets, and nothing by day or once the mission is finished", async () => {
    await addFleet(night("plan"));
    await spawnAgent("fleet", { task: "Check the tickets' repo" });
    expect(vi.mocked(addTerminal).mock.calls[0][1].permission).toBe("work");

    nodesStore.getState().update("fleet", { mission: night("en_cours") });
    await spawnAgent("fleet", { task: "Run the tests" });
    expect(vi.mocked(addTerminal).mock.calls[1][1].permission).toBe("work");

    // Finished: its session may still hold the night until the mission is cleaned up; the sub-agent does not.
    nodesStore.getState().update("fleet", { mission: night("terminee") });
    await spawnAgent("fleet", { task: "Sum it up" });
    expect(vi.mocked(addTerminal).mock.calls[2][1]).not.toHaveProperty("permission");

    nodesStore.getState().update("fleet", { mission: { ...NEW_MISSION, state: "en_cours" } });
    await spawnAgent("fleet", { task: "Look it up" });
    expect(vi.mocked(addTerminal).mock.calls[3][1]).not.toHaveProperty("permission");
  });

  it("runs a Codex Fleet's sub-agent on Codex, like its team", async () => {
    await addFleet(undefined, "codex");
    await spawnAgent("fleet", { task: "Do it" });
    expect(vi.mocked(addTerminal).mock.calls[0][1]).toMatchObject({ agent: "codex", spawnedBy: "fleet" });
  });

  it("counts a Fleet as a top agent: its sub-agents go 3 levels below it", async () => {
    await addFleet();
    await spawnAgent("fleet", { task: "Level 1" });
    await spawnAgent("child1", { task: "Level 2" });
    expect((await spawnAgent("child2", { task: "Level 3" })).error).toBeUndefined();
    expect((await spawnAgent("child3", { task: "Level 4" })).error).toBe(true);
  });

  it("refuses a Fleet without its session", async () => {
    await nodesStore.getState().create("bare", { workspaceId: "w1", kind: "fleet", payload: { name: "Bare" } });
    scene.push({ ...createNodeElement("fleet", { x: 0, y: 0 }), id: "bare" } as unknown as ExcalidrawElement);
    expect(await spawnAgent("bare", { task: "Do it" })).toEqual({ text: expect.stringContaining("no longer on the canvas"), error: true });
  });
});

describe("spawn_agent: another agent is already on the task", () => {
  const ROUTER = "Write the unit tests for the router: cover the happy paths, the errors and the edge cases, and keep every test small and fast.";
  const working = (nodeId: string) => agentActivityStore.getState().apply({ nodeId, activity: "working", since: Date.now() });
  // The reports of earlier tests live on in `markReported`: each test here has children of its own.
  let base = 0;
  const kid = (n: number) => `child${base + n}`;
  beforeEach(() => {
    created = base = (base || 0) + 100;
  });

  it("refuses a task a sub-agent is at work on, naming it, and opens nothing", async () => {
    expect((await spawnAgent("batman", { task: ROUTER, title: "Router tests" })).error).toBeUndefined();
    working(kid(1));
    // The same title said another way over a shorter brief, then the same brief under another title.
    const byTitle = await spawnAgent("batman", { task: "Write the unit tests for the router", title: "  ROUTER tests! " });
    const byBrief = await spawnAgent("batman", { task: ROUTER.replace("Write", "Please write"), title: "Cover the router" });
    for (const refused of [byTitle, byBrief]) {
      expect(refused.error).toBe(true);
      expect(refused.text).toBe('Robin is already working on "Router tests" (working). Message or read that agent instead of starting another.');
    }
    expect(addTerminal).toHaveBeenCalledTimes(1);
  });

  it("lets one title over two briefs that share nothing through", async () => {
    await spawnAgent("batman", { task: ROUTER, title: "Router tests" });
    working(kid(1));
    expect((await spawnAgent("batman", { task: "Measure how fast the routing table answers under load", title: "Router tests" })).error).toBeUndefined();
  });

  it("lets a different task of the same repo through", async () => {
    await spawnAgent("batman", { task: "Recolour the banners", title: "Banners on the new palettes" });
    working(kid(1));
    const result = await spawnAgent("batman", { task: "Link agents to the Kanban board", title: "Agents and the board" });
    expect(result.error).toBeUndefined();
    expect(addTerminal).toHaveBeenCalledTimes(2);
  });

  it("counts a sub-agent still starting: two identical spawns of one turn open one", async () => {
    vi.mocked(addTerminal).mockImplementation(async (_workspaceId, payload, center) => {
      const id = `child${++created}`;
      await nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload });
      scene.push({ ...createNodeElement("terminal", center), id } as unknown as ExcalidrawElement);
      return id;
    });
    vi.mocked(whenReady).mockReturnValue(new Promise(() => undefined));
    const [first, second] = await Promise.all([spawnAgent("batman", { task: ROUTER, title: "Router tests" }), spawnAgent("batman", { task: ROUTER, title: "Router tests" })]);
    expect(first.error).toBeUndefined();
    expect(second).toEqual({ text: expect.stringContaining("is already working on"), error: true });
    expect(addTerminal).toHaveBeenCalledTimes(1);
    markLaunching(kid(1), false);
    vi.mocked(whenReady).mockResolvedValue(true);
  });

  it("holds the task until its agent reported or stopped, idle between two turns or not", async () => {
    await spawnAgent("batman", { task: ROUTER, title: "Router tests" });
    await vi.waitFor(() => expect(isLaunching(kid(1))).toBe(false));
    // Its turn ended without a report: the task is not given up, as its seat is not.
    const idle = await spawnAgent("batman", { task: ROUTER, title: "Router tests" });
    expect(idle).toEqual({ text: expect.stringContaining('(between two turns). Message or read'), error: true });
    markReported(kid(1));
    expect((await spawnAgent("batman", { task: ROUTER, title: "Router tests" })).error).toBeUndefined();
    working(kid(2));
    terminalStatusStore.getState().set(kid(2), { state: "exited", code: 0 });
    expect((await spawnAgent("batman", { task: ROUTER, title: "Router tests" })).error).toBeUndefined();
  });

  it("never counts the caller itself, a terminal of another workspace, or one the user opened", async () => {
    await spawnAgent("batman", { task: ROUTER, title: "Router tests" });
    working(kid(1));
    // The sub-agent delegates its own task again: it is the one at work on it.
    expect((await spawnAgent(kid(1), { task: ROUTER, title: "Router tests" })).error).toBeUndefined();
    working(kid(2));
    await nodesStore.getState().create("elsewhere", { workspaceId: "w2", kind: "terminal", payload: terminal("Elsewhere", { spawnedBy: "other", task: "Fix the failing build now please", title: "Build fix" }) });
    running("elsewhere");
    working("elsewhere");
    expect((await spawnAgent("batman", { task: "Fix the failing build now please", title: "Build fix" })).error).toBeUndefined();
    // A terminal the user opened has no task dummyPlane knows of, whatever its title says.
    await addNode("batgirl", terminal("Batgirl", { title: "Unit tests for the parser" }));
    running("batgirl");
    working("batgirl");
    expect((await spawnAgent("batman", { task: "Something about parsers and their tests", title: "Unit tests for the parser" })).error).toBeUndefined();
  });

  it("names a mission's agent with its time, and a Fleet's own call is checked like an agent's", async () => {
    const member: Member = { nodeId: "thor", name: "Thor", task: "Banners on the new palettes", budgetMin: 40, linked: false, branch: "b", worktree: "w", sentAt: Date.now() - 3 * 60_000 };
    const brief = "Recolour the README banners and badges in the Dark and Expressive palettes, then commit the images.";
    await addNode("thor", terminal("Thor", { spawnedBy: "manager", task: "Banners on the new palettes" }));
    running("thor");
    working("thor");
    await nodesStore.getState().create("fleet", {
      workspaceId: "w1",
      kind: "fleet",
      payload: {
        name: "Fleet",
        session: fleetSession("Fleet", { cwd: "C:/code/elsewhere", shell: "pwsh" }, "claude"),
        mission: { ...NEW_MISSION, state: "en_cours", plan: [{ title: member.task, brief, agent: "Thor", budgetMin: 40 }], members: [member] },
      },
    });
    scene.push({ ...createNodeElement("fleet", { x: 0, y: 600 }), id: "fleet" } as unknown as ExcalidrawElement);
    running("fleet");
    const refused = await spawnAgent("batman", { task: "Banners and badges in the Dark and Expressive palettes, with the images", title: "Banners on the new palettes" });
    expect(refused).toEqual({ text: 'Thor is already working on "Banners on the new palettes" (working, 3 of 40 min). Message or read that agent instead of starting another.', error: true });
    // The Fleet itself is no agent of its mission's team: it is not the one at work, Thor is.
    expect((await spawnAgent("fleet", { task: brief })).error).toBe(true);
    expect((await spawnAgent("fleet", { task: "Look up where the router is tested", title: "Lookup" })).error).toBeUndefined();
  });
});

function sessionOfFleet(): TerminalPayload {
  const record = nodesStore.getState().nodes.fleet;
  if (record?.kind !== "fleet" || !record.payload.session) throw new Error("no fleet session");
  return record.payload.session;
}
