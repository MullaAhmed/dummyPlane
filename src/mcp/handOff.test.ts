// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { createGroupFrame } from "@/canvas/groups";
import { createNodeElement } from "@/canvas/nodeElement";
import { wireActivityStore } from "@/canvas/wireActivity";
import { withAgentLink, withWire } from "@/agents/wires";
import { notify } from "@/mission/events";
import { pumpQueue } from "@/mission/queue";
import type { Member, Mission } from "@/mission/mission";
import { missionOf, setFleetClosed } from "@/mission/store";
import { terminalText } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { answer } from "./router";

vi.mock("@excalidraw/excalidraw", () => ({ CaptureUpdateAction: { IMMEDIATELY: "immediately" } }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(() => "line 1") }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));
vi.mock("@/mission/queue", () => ({ pumpQueue: vi.fn(() => Promise.resolve()), giveNext: vi.fn(), afterReport: vi.fn() }));
vi.mock("@/mission/launch", () => ({ endMission: vi.fn(), mergeMission: vi.fn(), reassignTask: vi.fn() }));

const call = (nodeId: string, name: string, args: Record<string, unknown> = {}) =>
  answer({ callId: 1, nodeId, method: "tools/call", params: { name, arguments: args } }) as Promise<{ content: { text: string }[]; isError?: boolean }>;
const textOf = (result: { content: { text: string }[] }) => result.content[0].text;
const toolNames = async (nodeId: string) => ((await answer({ callId: 1, nodeId, method: "tools/list", params: {} })) as { tools: { name: string }[] }).tools.map((t) => t.name);

const element = (kind: "terminal" | "fleet", id: string, x: number) => ({ ...createNodeElement(kind, { x, y: 0 }), id }) as unknown as ExcalidrawElement;
const nodes = [
  element("terminal", "batgirl", 0),
  element("terminal", "robin", 1200),
  element("terminal", "cyborg", 2400),
  element("terminal", "boss", 3600),
  element("fleet", "chef", 4800),
  element("fleet", "ops", 6000),
];
let scene: readonly ExcalidrawElement[] = nodes;

const session = { title: "", name: "", agent: "claude" as const, cwd: "C:/p", shell: "default" as const, command: "" };
const terminal = (id: string, name: string, extra: object = {}) =>
  nodesStore.getState().create(id, { workspaceId: "w1", kind: "terminal", payload: { ...session, name, ...extra } });
const fleet = (id: string, name: string) => nodesStore.getState().create(id, { workspaceId: "w1", kind: "fleet", payload: { name, session: { ...session, name, role: "orchestrator" } } });
const member = (nodeId: string, name: string): Member => ({ nodeId, name, task: "t", budgetMin: 10, linked: true, branch: "b", worktree: "w", sentAt: 1 });

/** Chef's mission as a test sets it: a Manager and a board, unless said. */
const setMission = (mission: Partial<Mission>) => nodesStore.getState().update("chef", { mission: { state: "en_cours", maxAgents: 4, members: [], startedAt: Date.now(), manager: "boss", board: "k1", ...mission } });
const queueOf = () => missionOf(nodesStore.getState().nodes.chef)?.queue ?? [];
const board = () => (nodesStore.getState().nodes.k1 as unknown as { payload: { columns: { id: string; cardIds: string[] }[]; cards: Record<string, { title: string; notes: string }> } }).payload;

beforeAll(async () => {
  mockIPC(() => undefined);
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({ api: { getSceneElements: () => scene.filter((e) => !e.isDeleted), getSceneElementsIncludingDeleted: () => scene } as never });
  await terminal("batgirl", "Batgirl");
  await terminal("robin", "Robin");
  await terminal("cyborg", "Cyborg");
  await terminal("boss", "Manager", { role: "manager", fleet: "chef" });
  await fleet("chef", "Chef");
  await fleet("ops", "Ops");
  await nodesStore.getState().create("k1", {
    workspaceId: "w1",
    kind: "kanban",
    payload: { columns: [{ id: "todo", title: "To do", cardIds: [] }, { id: "done", title: "Done", cardIds: [] }], cards: {}, orchestrator: { nodeId: "chef", columnId: "todo" } },
  });
});

beforeEach(() => {
  // Batgirl is wired to the Fleet, as "+ Link" then a click on the Fleet wires her.
  scene = withWire(nodes, "chef", "batgirl");
  setMission({});
  nodesStore.getState().update("k1", { columns: [{ id: "todo", title: "To do", cardIds: [] }, { id: "done", title: "Done", cardIds: [] }], cards: {} });
  for (const id of ["chef", "ops", "batgirl", "robin", "boss"]) terminalStatusStore.getState().set(id, { state: "running" });
  vi.mocked(notify).mockClear();
  vi.mocked(pumpQueue).mockClear();
  vi.mocked(terminalText).mockClear();
});
afterEach(() => wireActivityStore.setState({ pulses: {} }));

describe("hand_off in the router's lists", () => {
  it("is listed to an agent wired to a Fleet, on top of the tools any agent has", async () => {
    const wired = await toolNames("batgirl");
    expect(wired.filter((name) => name !== "hand_off")).toEqual(await toolNames("cyborg"));
    expect(wired).toContain("hand_off");
    expect(wired.filter((name) => name === "hand_off")).toHaveLength(1);
  });

  it("is not listed to an agent no Fleet commands, to a Fleet, nor to a Manager", async () => {
    expect(await toolNames("cyborg")).not.toContain("hand_off");
    expect(await toolNames("chef")).not.toContain("hand_off");
    expect(await toolNames("boss")).not.toContain("hand_off");
  });

  it("is not listed to a mission's team, though the Fleet's wire reaches its agents", async () => {
    scene = withWire(nodes, "chef", "robin");
    expect(await toolNames("robin")).toContain("hand_off");
    setMission({ members: [member("robin", "Robin")] });
    expect(await toolNames("robin")).not.toContain("hand_off");
    // Once the mission is over the agent is the user's linked agent again.
    setMission({ state: "terminee", members: [member("robin", "Robin")] });
    expect(await toolNames("robin")).toContain("hand_off");
  });

  it("is not listed without a wire, and drops with it", async () => {
    scene = nodes;
    expect(await toolNames("batgirl")).not.toContain("hand_off");
    scene = withWire(nodes, "chef", "batgirl").map((e) => (e.type === "arrow" ? ({ ...e, isDeleted: true } as ExcalidrawElement) : e));
    expect(await toolNames("batgirl")).not.toContain("hand_off");
  });

  it("describes its arguments in English, a title and a brief required", async () => {
    const list = (await answer({ callId: 1, nodeId: "batgirl", method: "tools/list", params: {} })) as { tools: { name: string; description: string; inputSchema: { required: string[]; properties: object } }[] };
    const spec = list.tools.find((t) => t.name === "hand_off")!;
    expect(spec.inputSchema.required).toEqual(["title", "brief"]);
    expect(Object.keys(spec.inputSchema.properties)).toEqual(["title", "brief", "budget_min", "level", "fleet"]);
    expect(spec.description).toContain("typed to the Fleet");
  });
});

describe("hand_off for the agents of a group the Fleet is wired to", () => {
  const frame = createGroupFrame({ x: 0, y: 0, width: 100, height: 100 }, "Backend", { role: "backend", pantheon: "greek" }) as ExcalidrawElement;
  const inFrame = (...ids: string[]) => nodes.map((e) => (ids.includes(e.id) ? ({ ...e, frameId: frame.id } as ExcalidrawElement) : e));
  const wiredGroup = (...ids: string[]) => withWire([...inFrame(...ids), frame], "chef", frame.id);
  const spawnedBy = (id: string, parent: string | undefined) => nodesStore.getState().update(id, { spawnedBy: parent });
  afterEach(() => {
    spawnedBy("cyborg", undefined);
    spawnedBy("robin", undefined);
  });

  it("is listed to each agent of the group, which linked_agents names the Fleet to", async () => {
    scene = wiredGroup("robin", "cyborg");
    expect(await toolNames("robin")).toContain("hand_off");
    expect(await toolNames("cyborg")).toContain("hand_off");
    expect(JSON.parse(textOf(await call("robin", "linked_agents")))).toMatchObject([{ name: "Chef", relation: "fleet" }]);
    expect(textOf(await call("robin", "hand_off", { title: "One", brief: "b" }))).toContain("Queued");
  });

  it("is refused to a team agent in that group, and to the sub-agent it spawned into it", async () => {
    scene = wiredGroup("robin", "cyborg");
    spawnedBy("cyborg", "robin");
    setMission({ members: [member("robin", "Robin")] });
    for (const id of ["robin", "cyborg"]) {
      expect(await toolNames(id)).not.toContain("hand_off");
      expect((await call(id, "hand_off", { title: "One", brief: "b" })).isError).toBe(true);
      expect(textOf(await call(id, "linked_agents"))).not.toContain("Chef");
      expect((await call(id, "message_agent", { agent: "Chef", text: "hi" })).isError).toBe(true);
    }
    expect(queueOf()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    // Once the mission is over, they are the user's linked agents again.
    setMission({ state: "terminee", members: [member("robin", "Robin")] });
    expect(await toolNames("cyborg")).toContain("hand_off");
  });

  it("leaves the sub-agent of a plain linked agent the tool, but not the Fleet's own sub-agent: it reports to its Fleet", async () => {
    scene = wiredGroup("robin", "cyborg");
    spawnedBy("cyborg", "robin");
    expect(await toolNames("cyborg")).toContain("hand_off");
    spawnedBy("cyborg", "chef");
    expect(await toolNames("cyborg")).not.toContain("hand_off");
    expect(textOf(await call("cyborg", "hand_off", { title: "One", brief: "b" }))).toContain("No Fleet is linked to you");
  });
});

describe("hand_off while the mission runs", () => {
  it("queues the task as add_tasks does: a card in the to-do column, the agent's name on both, a new agent for it", async () => {
    const result = await call("batgirl", "hand_off", { title: "Fix the login", brief: "The form loses its state.\nSee auth.ts.", budget_min: 20, level: "high" });
    expect(result.isError).toBeUndefined();
    const [task] = queueOf();
    expect(task).toMatchObject({ title: "Fix the login", brief: "The form loses its state.\nSee auth.ts.", budgetMin: 20, level: "eleve", handedBy: "Batgirl" });
    expect(task.card).toBeTruthy();
    expect(textOf(result)).toBe(`Queued as card ${task.card} ("Fix the login"). Waiting: 1. A new agent takes it as a seat frees up; the Fleet is told.`);
    expect(board().columns[0].cardIds).toEqual([task.card]);
    expect(board().cards[task.card!]).toMatchObject({ title: "Fix the login", notes: "The form loses its state. See auth.ts.\n\nHanded off by Batgirl." });
    expect(pumpQueue).toHaveBeenCalledWith("chef");
  });

  it("shows who handed a waiting task over in the Fleet's queue, and nothing for its own", async () => {
    await call("batgirl", "hand_off", { title: "Fix the login", brief: "b" });
    await call("chef", "add_tasks", { tasks: [{ title: "Own", brief: "b", budget_min: 5 }] });
    const { waiting } = JSON.parse(textOf(await call("chef", "queue")));
    expect(waiting.map((w: { title: string; handed_by?: string }) => [w.title, w.handed_by])).toEqual([["Fix the login", "Batgirl"], ["Own", undefined]]);
  });

  it("tells the Fleet once, and the Manager that runs the board once", async () => {
    await call("batgirl", "hand_off", { title: "Fix the login", brief: "b" });
    const [task] = queueOf();
    const told = vi.mocked(notify).mock.calls;
    expect(told.map(([id]) => id)).toEqual(["chef", "boss"]);
    expect(told[0][1]).toBe(`Batgirl (an agent linked to you) handed off "Fix the login": queued as card ${task.card}, 1 waiting. A new agent takes it as a seat frees up; do nothing unless the user wants it changed (prioritize, queue).`);
    expect(told[1][1]).toContain('Batgirl, an agent linked to Chef, handed off "Fix the login"');
    // The light runs along her wire up to the Fleet.
    expect(wireActivityStore.getState().pulses.batgirl).toMatchObject({ direction: "toFleet", fleetId: "chef" });
  });

  it("gives a budget and, with the router on, a level when the agent gives none; keeps a night's limit", async () => {
    await call("batgirl", "hand_off", { title: "One", brief: "b" });
    expect(queueOf()[0]).toMatchObject({ budgetMin: 30 });
    expect(queueOf()[0].level).toBeUndefined();
    setMission({ router: true, overnight: true, budgetMin: 20 });
    expect(textOf(await call("batgirl", "hand_off", { title: "Two", brief: "b" }))).toContain("Queued");
    expect(queueOf().find((task) => task.title === "Two")).toMatchObject({ budgetMin: 20, level: "moyen" });
  });

  it("takes it during the team's formation, on a mission run the old way (no Manager, no card)", async () => {
    setMission({ state: "lancement", manager: undefined, board: undefined });
    expect(textOf(await call("batgirl", "hand_off", { title: "Late", brief: "b" }))).toBe('Queued ("Late"). Waiting: 1. A new agent takes it as a seat frees up; the Fleet is told.');
    expect(queueOf()[0].card).toBeUndefined();
    expect(vi.mocked(notify).mock.calls.map(([id]) => id)).toEqual(["chef"]);
  });

  it("queues behind what waits, and refuses a title the mission already uses", async () => {
    await call("batgirl", "hand_off", { title: "One", brief: "b" });
    expect(textOf(await call("batgirl", "hand_off", { title: "Two", brief: "b" }))).toContain("Waiting: 2.");
    vi.mocked(notify).mockClear();
    const twice = await call("batgirl", "hand_off", { title: "one", brief: "b" });
    expect(twice.isError).toBe(true);
    expect(textOf(twice)).toContain("is taken");
    expect(queueOf().map((task) => task.title)).toEqual(["One", "Two"]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses a task a mission's agent is already at work on, naming it: nothing queued, nobody told", async () => {
    const brief = "Recolour the README banners and badges in the Dark and Expressive palettes, then commit the images.";
    const cyborg: Member = { ...member("cyborg", "Cyborg"), task: "Banners on the new palettes", budgetMin: 40, sentAt: Date.now() - 3 * 60_000 };
    setMission({ plan: [{ title: cyborg.task, brief, agent: "Cyborg", budgetMin: 40 }], members: [cyborg] });
    terminalStatusStore.getState().set("cyborg", { state: "running" });
    agentActivityStore.getState().apply({ nodeId: "cyborg", activity: "working", since: Date.now() });
    vi.mocked(notify).mockClear();
    const again = await call("batgirl", "hand_off", { title: "Banners on the new palettes!", brief: "Recolour the banners and badges in the Dark palette" });
    expect(again.isError).toBe(true);
    expect(textOf(again)).toContain('Cyborg is already working on "Banners on the new palettes" (working, 3 of 40 min). Message or read that agent instead of queueing another');
    expect(queueOf()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    // A different task of the same mission goes through.
    expect((await call("batgirl", "hand_off", { title: "Fix the login", brief: "The login form loses the password on a bad submit" })).isError).toBeUndefined();
  });

  it("queues even when the Fleet's own terminal is stopped, and says it hears of it later", async () => {
    terminalStatusStore.getState().set("chef", { state: "stopped" });
    const result = await call("batgirl", "hand_off", { title: "One", brief: "b" });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("Chef is stopped: it hears of it when it is back.");
    expect(queueOf()).toHaveLength(1);
  });

  it("refuses a finished mission: nothing queued, nobody told", async () => {
    setMission({ state: "terminee" });
    const result = await call("batgirl", "hand_off", { title: "One", brief: "b" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Chef's mission is finished");
    expect(queueOf()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("hand_off with no mission running", () => {
  it("types the task to the Fleet, as a line it can plan from, and leaves the queue alone", async () => {
    setMission({ state: "redaction", manager: undefined, board: undefined, startedAt: undefined });
    const result = await call("batgirl", "hand_off", { title: "Fix the login", brief: "The form\nloses its state.", budget_min: 15, level: "low" });
    expect(textOf(result)).toBe("Sent to Chef: no mission is running, so the Fleet plans the task. It has no tool to answer you: carry on, do not wait for it.");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("chef", 'Batgirl (an agent linked to you) hands off a task: "Fix the login" — The form loses its state. Budget: 15 min. Level: low. No mission is running: plan it (propose_plan, or add_tasks), or ask the user if it does not fit what they asked.');
    expect(queueOf()).toEqual([]);
    expect(pumpQueue).not.toHaveBeenCalled();
  });

  it("does the same while a plan waits for the go-ahead", async () => {
    setMission({ state: "plan", manager: undefined, board: undefined });
    expect(textOf(await call("batgirl", "hand_off", { title: "One", brief: "b" }))).toContain("Sent to Chef");
    expect(queueOf()).toEqual([]);
  });

  it("refuses a Fleet that is stopped: there is nobody to type to", async () => {
    setMission({ state: "redaction", manager: undefined, board: undefined });
    terminalStatusStore.getState().set("chef", { state: "stopped" });
    const result = await call("batgirl", "hand_off", { title: "One", brief: "b" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Chef is stopped: its terminal is not running, nothing is sent.");
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("hand_off, refused", () => {
  it("to an agent no Fleet commands, or whose wire is only a talk or spawn wire", async () => {
    const result = await call("cyborg", "hand_off", { title: "One", brief: "b" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No Fleet is linked to you");
    scene = withWire(nodes, "chef", "cyborg", "calm", true);
    expect(textOf(await call("cyborg", "hand_off", { title: "One", brief: "b" }))).toContain("No Fleet is linked to you");
    expect(queueOf()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("to a mission's team wired to the Fleet, and to a Manager", async () => {
    scene = withWire(nodes, "chef", "robin");
    setMission({ members: [member("robin", "Robin")] });
    const team = await call("robin", "hand_off", { title: "One", brief: "b" });
    expect(team.isError).toBe(true);
    expect(textOf(team)).toContain("You work for a mission");
    expect((await call("boss", "hand_off", { title: "One", brief: "b" })).isError).toBe(true);
    expect(queueOf()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("from a Fleet, as an agent's tool", async () => {
    expect(textOf(await call("chef", "hand_off", { title: "One", brief: "b" }))).toBe("This tool is for agents.");
  });

  it("a task without a title, with a title too long, or without a brief", async () => {
    expect(textOf(await call("batgirl", "hand_off", { brief: "b" }))).toContain("Give the task a short title");
    expect(textOf(await call("batgirl", "hand_off", { title: "x".repeat(61), brief: "b" }))).toContain("60 characters at most");
    expect(textOf(await call("batgirl", "hand_off", { title: "One" }))).toBe("Give the task's brief (brief).");
    expect(textOf(await call("batgirl", "hand_off", { title: "One", brief: "b", budget_min: 0 }))).toContain("a budget in minutes");
    expect(queueOf()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("a Fleet that was deleted from the canvas, its mission waiting for an undo", async () => {
    setFleetClosed("chef", true);
    try {
      const result = await call("batgirl", "hand_off", { title: "One", brief: "b" });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Chef is no longer on the canvas.");
      expect(queueOf()).toEqual([]);
      expect(notify).not.toHaveBeenCalled();
    } finally {
      setFleetClosed("chef", false);
    }
  });
});

describe("two Fleets", () => {
  it("ask which one, take the one named, refuse a Fleet that does not command the agent", async () => {
    scene = withWire(withWire(nodes, "chef", "batgirl"), "ops", "batgirl");
    nodesStore.getState().update("ops", { mission: { state: "redaction", maxAgents: 4, members: [] } });
    const which = await call("batgirl", "hand_off", { title: "One", brief: "b" });
    expect(which.isError).toBe(true);
    expect(textOf(which)).toBe("Several Fleets are linked to you: name one (fleet). Linked: Chef, Ops.");
    expect(textOf(await call("batgirl", "hand_off", { title: "One", brief: "b", fleet: "ops" }))).toContain("Sent to Ops");
    expect(vi.mocked(notify).mock.calls.map(([id]) => id)).toEqual(["ops"]);
    expect(textOf(await call("batgirl", "hand_off", { title: "Two", brief: "b", fleet: "chef" }))).toContain("Queued");
    const elsewhere = await call("batgirl", "hand_off", { title: "Three", brief: "b", fleet: "Nobody" });
    expect(elsewhere.isError).toBe(true);
    expect(textOf(elsewhere)).toBe('"Nobody" is not a Fleet linked to you. Linked: Chef, Ops.');
  });
});

describe("linked_agents and message_agent with a Fleet", () => {
  it("lists the Fleet that commands the agent, relation fleet, beside its linked agents", async () => {
    expect(JSON.parse(textOf(await call("batgirl", "linked_agents")))).toEqual([{ name: "Chef", id: "chef", state: "idle", relation: "fleet" }]);
    scene = withAgentLink(withWire(nodes, "chef", "batgirl"), "batgirl", "cyborg");
    expect(JSON.parse(textOf(await call("batgirl", "linked_agents"))).map((a: { relation: string }) => a.relation)).toEqual(["linked", "fleet"]);
    expect(textOf(await call("cyborg", "linked_agents"))).not.toContain("Chef");
  });

  it("does not list it to an agent the Fleet does not command, nor to a mission's team", async () => {
    expect(textOf(await call("cyborg", "linked_agents"))).toContain("No agent is linked to you");
    scene = withWire(nodes, "chef", "robin");
    setMission({ members: [member("robin", "Robin")] });
    expect(textOf(await call("robin", "linked_agents"))).not.toContain("Chef");
  });

  it("types a message to the Fleet that commands the agent, and tells it no answer comes back by tool", async () => {
    const sent = await call("batgirl", "message_agent", { agent: "chef", text: "The API is ready,\nplan the next step." });
    expect(sent.isError).toBeUndefined();
    expect(textOf(sent)).toBe("Sent to Chef. It has no tool to answer you: carry on, do not wait for it.");
    expect(notify).toHaveBeenCalledWith("chef", "Message from Batgirl (an agent linked to you; you have no tool to answer it: act on it, or tell the user): The API is ready, plan the next step.");
    expect(queueOf()).toEqual([]);
    terminalStatusStore.getState().set("chef", { state: "stopped" });
    expect(textOf(await call("batgirl", "message_agent", { agent: "Chef", text: "hi" }))).toContain("Chef is stopped");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("reaches no Fleet but the one that commands the agent, and never reads its terminal", async () => {
    expect((await call("batgirl", "message_agent", { agent: "Ops", text: "hi" })).isError).toBe(true);
    expect((await call("cyborg", "message_agent", { agent: "Chef", text: "hi" })).isError).toBe(true);
    const read = await call("batgirl", "read_agent", { agent: "Chef" });
    expect(read.isError).toBe(true);
    expect(textOf(read)).toContain("A Fleet's screen is the user's");
    scene = withWire(nodes, "chef", "robin");
    setMission({ members: [member("robin", "Robin")] });
    expect((await call("robin", "message_agent", { agent: "Chef", text: "hi" })).isError).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(terminalText).not.toHaveBeenCalled();
  });
});
