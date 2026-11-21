// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { clearWirePulses, wireActivityStore } from "@/canvas/wireActivity";
import type { Member } from "@/mission/mission";
import { notify } from "@/mission/events";
import { deliveryPending } from "@/mission/launch";
import { afterReport } from "@/mission/queue";
import { missionOf } from "@/mission/store";
import { checkStalls, UNHEARD_MS } from "@/mission/stalls";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { fleetSession } from "@/nodes/terminal/launch";
import { missionRunsBoard, wiredBoardsOf } from "@/agents/boardLinks";
import { agentTools, declareSteps, markStep, report, spawnAgentSpec } from "./agentTools";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/kanban/fleetBoards", () => ({ reportedMissionCard: vi.fn(() => Promise.resolve()), flagMissionCard: vi.fn() }));
vi.mock("@/mission/queue", () => ({ afterReport: vi.fn(() => Promise.resolve()) }));
vi.mock("@/mission/launch", () => ({ deliveryPending: vi.fn(() => false) }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));
vi.mock("@/agents/boardLinks", () => ({ wiredBoardsOf: vi.fn(() => null), missionRunsBoard: vi.fn(() => false) }));

const member: Member = { nodeId: "batman", name: "Batman", task: "t", budgetMin: 10, linked: false, branch: "b", worktree: "w", sentAt: 1 };
const terminal = (name: string, spawnedBy?: string) => ({
  title: "",
  name,
  agent: "claude" as const,
  cwd: "C:/p",
  shell: "default" as const,
  command: "",
  ...(spawnedBy ? { spawnedBy } : {}),
});

beforeEach(async () => {
  mockIPC(() => undefined);
  clearWirePulses();
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", mission: { state: "en_cours", maxAgents: 4, budgetMin: 60, startedAt: Date.now(), members: [member] } },
  });
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: terminal("Batman") });
  await nodesStore.getState().create("shazam", { workspaceId: "w1", kind: "terminal", payload: terminal("Shazam") });
  // Robin was opened by Shazam with spawn_agent.
  await nodesStore.getState().create("robin", { workspaceId: "w1", kind: "terminal", payload: terminal("Robin", "shazam") });
  terminalStatusStore.getState().set("shazam", { state: "running" });
  vi.mocked(notify).mockClear();
  vi.mocked(afterReport).mockClear();
  vi.mocked(deliveryPending).mockReturnValue(false);
});
afterEach(() => clearWirePulses());

const pulses = () => wireActivityStore.getState().pulses;

it("lights the wire up to the fleet when a member declares or marks a step, and reports", () => {
  declareSteps("batman", { etapes: ["Plan", "Code"] });
  expect(pulses().batman).toMatchObject({ direction: "toFleet", fleetId: "chef" });
  clearWirePulses();
  expect(markStep("batman", { titre: "Plan", etat: "en_cours" }).isError).not.toBe(true);
  expect(pulses().batman).toMatchObject({ direction: "toFleet", fleetId: "chef" });
  clearWirePulses();
  expect(report("batman", { resume: "Done", statut: "termine" }).isError).not.toBe(true);
  expect(pulses().batman).toMatchObject({ direction: "toFleet", fleetId: "chef" });
});

it("lights every wire reaching an agent outside a mission when it marks a step, and none for a refused call", () => {
  expect(markStep("shazam", { titre: "Plan", etat: "nope" }).isError).toBe(true);
  expect(declareSteps("shazam", { etapes: [] }).isError).toBe(true);
  expect(pulses()).toEqual({});
  markStep("shazam", { titre: "Plan", etat: "en_cours" });
  expect(pulses().shazam).toEqual({ direction: "toFleet", at: expect.any(Number) });
});

// Nobody hears it, yet its work is done: its terminal minimizes all the same.
it("minimizes a terminal outside any mission that reports its work done, its report kept for its card", () => {
  expect(report("shazam", { resume: "Done", statut: "termine" }).isError).not.toBe(true);
  expect(terminalOf(nodesStore.getState().nodes.shazam)).toMatchObject({ minimized: true, lastReport: { status: "done", summary: "Done" } });
});

it("settles the steps of a member that reports without having marked its last one", () => {
  const states = (id: string) => terminalOf(nodesStore.getState().nodes[id])?.steps?.map((s) => s.state);
  declareSteps("batman", { etapes: ["Plan", "Code", "Commit and report"] });
  markStep("batman", { titre: "Plan", etat: "fait" });
  markStep("batman", { titre: "Code", etat: "fait" });
  markStep("batman", { titre: "Commit and report", etat: "en_cours" });
  report("batman", { resume: "Done", statut: "termine" });
  expect(states("batman")).toEqual(["fait", "fait", "fait"]);
  // Blocked: the step under way fails, the ones to come wait.
  declareSteps("shazam", { etapes: ["Plan", "Code", "Ship"] });
  markStep("shazam", { titre: "Plan", etat: "fait" });
  markStep("shazam", { titre: "Code", etat: "en_cours" });
  report("shazam", { resume: "Needs a key", statut: "bloque" });
  expect(states("shazam")).toEqual(["fait", "echec", "a_venir"]);
});

it("keeps a terminal outside any mission that reports itself blocked open: someone has to look", () => {
  expect(report("shazam", { resume: "Needs a key", statut: "bloque" }).isError).not.toBe(true);
  const payload = terminalOf(nodesStore.getState().nodes.shazam);
  expect(payload?.minimized).toBeUndefined();
  expect(payload?.lastReport).toEqual({ status: "blocked", summary: "Needs a key" });
});

it("leaves a terminal as it was when its report is refused: no summary, or a status `report` does not know", () => {
  const before = nodesStore.getState().nodes.shazam;
  report("shazam", { statut: "termine" });
  report("shazam", { resume: "Done", statut: "done" });
  expect(nodesStore.getState().nodes.shazam).toBe(before);
});

it("offers spawn_agent to every Claude session, its task, skills, MCP servers and plugins required", () => {
  const spawn = agentTools().find((tool) => tool.name === "spawn_agent")!;
  expect(spawn.inputSchema.required).toEqual(["task", "skills", "mcp_servers", "plugins"]);
  expect(Object.keys(spawn.inputSchema.properties)).toEqual(["task", "title", "model", "level", "skills", "mcp_servers", "plugins", "role", "step", "kind"]);
  // The router's levels, as the agent writes them: low… extreme, read from the router's own table.
  expect((spawn.inputSchema.properties as Record<string, { enum?: string[]; description: string }>).level).toMatchObject({ enum: ["low", "medium", "high", "extreme"] });
  expect((spawn.inputSchema.properties as Record<string, { description: string }>).level.description).toContain("extreme Fable 5.2");
  expect(spawn.description).toContain("3 levels");
});

it("makes spawn_agent's skills, MCP servers and plugins required, each a list chosen for the task, [] for none, which installed_extras lists", () => {
  const spawn = agentTools().find((tool) => tool.name === "spawn_agent")!;
  const props = spawn.inputSchema.properties as Record<string, { type: string; items?: { type: string }; description: string }>;
  for (const arg of ["skills", "mcp_servers", "plugins"]) {
    expect(props[arg]).toMatchObject({ type: "array", items: { type: "string" } });
    // Required, only what the task needs, [] for none: none is left to the CLI's defaults.
    expect(props[arg].description).toMatch(/^Required: /);
    expect(props[arg].description).toContain("only the ones its task needs");
    expect(props[arg].description).toContain("[] for none");
    expect(props[arg].description).toContain("never left to the CLI's defaults");
    expect(props[arg].description).toContain("installed_extras");
    expect(props[arg].description).not.toContain("Optional");
    expect(spawn.inputSchema.required).toContain(arg);
  }
  expect(props.mcp_servers.description).toContain("the dummyplane server, which it always keeps");
  expect(spawn.description).toContain("skills, mcp_servers and plugins are all required");
  expect(spawn.description).toContain("[] for a kind it needs none of");
  expect(spawn.description).toContain("Call installed_extras before your first spawn_agent");
  expect(spawn.description).not.toContain("leave one out");
  const list = agentTools().find((tool) => tool.name === "installed_extras")!;
  expect(list.inputSchema.properties).toEqual({});
  expect(list.description).toContain("whether it is on by default");
  expect(list.description).toContain("Call it before your first spawn_agent");
});

it("requires the same three kinds of a Fleet's spawn_agent, worded the same way", () => {
  const fleet = spawnAgentSpec(true);
  expect(fleet.inputSchema.required).toEqual(["task", "skills", "mcp_servers", "plugins"]);
  const props = fleet.inputSchema.properties as Record<string, { description: string }>;
  for (const arg of ["skills", "mcp_servers", "plugins"]) expect(props[arg].description).toMatch(/^Required: /);
  expect(fleet.description).toContain("skills, mcp_servers and plugins are all required");
  expect(fleet.description).toContain("Call installed_extras before your first spawn_agent");
  expect(fleet.description).not.toContain("leave one out");
});

it("lets an agent's spawn_agent open a manager (role), optional, its one value manager; a Fleet's has none", () => {
  const spawn = agentTools().find((tool) => tool.name === "spawn_agent")!;
  const role = (spawn.inputSchema.properties as Record<string, { type: string; enum?: string[]; description: string }>).role;
  expect(role).toMatchObject({ type: "string", enum: ["manager"] });
  expect(role.description).toContain("open_board");
  expect(role.description).toContain("a manager cannot open another");
  // Its lists are the ceiling of its own sub-agents: a spawner told to pick only what a manager needs would starve them.
  expect(role.description).toContain("the most its own sub-agents can get, so choose them for what those will need, not only for what a manager needs");
  expect(spawn.inputSchema.required).not.toContain("role");
  expect(spawn.description).toContain('role "manager"');
  // A Fleet splits work through its mission; its spawn_agent opens a sub-agent that does the work.
  expect(Object.keys(spawnAgentSpec(true).inputSchema.properties)).toEqual(["task", "title", "model", "level", "skills", "mcp_servers", "plugins"]);
  expect(spawnAgentSpec(true).description).not.toContain("role");
});

it("lets an agent's spawn_agent say what the work is (kind), optional, write and verify routine and held to medium; a Fleet's has none", () => {
  const spawn = agentTools().find((tool) => tool.name === "spawn_agent")!;
  const properties = spawn.inputSchema.properties as Record<string, { type: string; enum?: string[]; description: string }>;
  expect(properties.kind).toMatchObject({ type: "string", enum: ["plan", "write", "verify"] });
  expect(properties.kind.description).toContain("open at level medium at most, a high or extreme level lowered to medium");
  expect(properties.kind.description).toContain("plan (planning, design, hard debugging, a decision), or no kind, keeps the level as given");
  expect(spawn.inputSchema.required).not.toContain("kind");
  // The rule: costly levels for thinking, routine work at low or medium, rated as the part handed over.
  expect(spawn.description).toContain("Spend high and extreme on thinking, not typing");
  expect(spawn.description).toContain("go at low or medium, with kind write or verify");
  expect(properties.level.description).toContain("Rate the part you hand over, not the project it belongs to");
  // A Fleet's ad-hoc sub-agents are lookups and checks, held to low or medium while its mission runs.
  expect(spawnAgentSpec(true).inputSchema.properties).not.toHaveProperty("kind");
  expect(spawnAgentSpec(true).description).not.toContain("kind write");
});

it("sends an agent to spawn_agent rather than a Workflow, which dummyPlane refuses like the Agent/Task tool", () => {
  const agent = agentTools().find((tool) => tool.name === "spawn_agent")!;
  expect(agent.description).toContain("instead of the built-in Agent/Task tool or a Workflow: one call per sub-agent");
  // The Fleet's stays worded for any CLI (a Codex fleet reads it too): a Claude fleet's prompt names the Workflow.
  expect(spawnAgentSpec(true).description).not.toContain("Workflow");
});

it("minimizes a spawned agent that reports its work done, its parent told all the same", () => {
  report("robin", { resume: "Tests written", statut: "termine" });
  expect(terminalOf(nodesStore.getState().nodes.robin)).toMatchObject({ minimized: true, lastReport: { status: "done", summary: "Tests written" } });
  expect(notify).toHaveBeenCalledWith("shazam", expect.stringContaining("Robin reported"), expect.any(Function));
});

it("types a spawned agent's report into its parent and lights the wire toward it", () => {
  const result = report("robin", { resume: "Tests written\nall green", statut: "termine" });
  expect(result).toEqual({ content: [{ type: "text", text: "Report passed on to Shazam." }] });
  expect(notify).toHaveBeenCalledWith("shazam", "Robin reported (done): Tests written all green", expect.any(Function));
  expect(pulses().robin).toMatchObject({ direction: "toFleet", fleetId: "shazam" });
});

it("settles the step of its parent's frieze that a spawned agent carried, by its report", () => {
  nodesStore.getState().update("shazam", { steps: [{ title: "Tests", state: "en_cours" }, { title: "Docs", state: "a_venir" }] });
  nodesStore.getState().update("robin", { forStep: "Tests" });
  report("robin", { resume: "Blocked on a login", statut: "bloque" });
  expect(terminalOf(nodesStore.getState().nodes.shazam)?.steps?.map((s) => s.state)).toEqual(["en_cours", "a_venir"]);
  report("robin", { resume: "Tests written", statut: "termine" });
  expect(terminalOf(nodesStore.getState().nodes.shazam)?.steps?.map((s) => s.state)).toEqual(["fait", "a_venir"]);
});

it("watches a report typed into its parent: typed again once if the parent never took it up", () => {
  report("robin", { resume: "Tests written", statut: "termine" });
  const typedAt = Date.now();
  // The parent was idle, dummyPlane typed the line, its terminal then compacted: the callback of `notify` ran.
  agentActivityStore.getState().apply({ nodeId: "shazam", activity: "idle", since: typedAt - 60_000 });
  vi.mocked(notify).mock.calls.find(([to]) => to === "shazam")![2]!();
  vi.mocked(notify).mockClear();
  checkStalls(typedAt + UNHEARD_MS - 1000);
  expect(notify).not.toHaveBeenCalled();
  checkStalls(typedAt + UNHEARD_MS + 1000);
  checkStalls(typedAt + 3 * UNHEARD_MS);
  expect(vi.mocked(notify).mock.calls.map(([to, line]) => [to, line])).toEqual([["shazam", "Reminder, the line below went unanswered: Robin reported (done): Tests written"]]);
});

it("lights only the parent's wire when a spawned agent declares or marks a step", () => {
  declareSteps("robin", { etapes: ["Plan"] });
  expect(pulses().robin).toMatchObject({ direction: "toFleet", fleetId: "shazam" });
  clearWirePulses();
  markStep("robin", { titre: "Plan", etat: "fait" });
  expect(pulses().robin).toMatchObject({ direction: "toFleet", fleetId: "shazam" });
});

it("checks a spawned agent's report like a mission's, and says so when its parent is gone", () => {
  expect(report("robin", { resume: " ", statut: "termine" }).isError).toBe(true);
  expect(report("robin", { resume: "x", statut: "nope" }).isError).toBe(true);
  terminalStatusStore.getState().set("shazam", { state: "exited", code: 0 });
  expect(report("robin", { resume: "Done", statut: "bloque" }).content[0].text).toContain("is closed");
  expect(notify).not.toHaveBeenCalled();
});

it("tells both the fleet and the parent when a spawned agent is also a mission member", async () => {
  await nodesStore.getState().create("batman", { workspaceId: "w1", kind: "terminal", payload: terminal("Batman", "shazam") });
  const result = report("batman", { resume: "Done", statut: "termine" });
  expect(vi.mocked(notify).mock.calls.map(([to]) => to).sort()).toEqual(["chef", "shazam"]);
  expect(result.content[0].text).toContain("Report passed on to Shazam.");
});

it("still has nobody to tell for an agent neither in a mission nor spawned", () => {
  expect(report("shazam", { resume: "Done", statut: "termine" }).content[0].text).toBe("No mission under way: nothing to pass on.");
  expect(notify).not.toHaveBeenCalled();
});

describe("a Fleet's sub-agent (spawn_agent)", () => {
  beforeEach(async () => {
    // A Fleet outside any mission, its session running, that opened Cyborg with spawn_agent.
    await nodesStore.getState().create("fleet", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", session: fleetSession("Fleet", { cwd: "C:/p", shell: "default" }) } });
    await nodesStore.getState().create("cyborg", { workspaceId: "w1", kind: "terminal", payload: terminal("Cyborg", "fleet") });
    terminalStatusStore.getState().set("fleet", { state: "running" });
  });

  it("types its report into the Fleet's terminal and lights the wire toward it", () => {
    const result = report("cyborg", { resume: "Found it in src/mcp", statut: "termine" });
    expect(result).toEqual({ content: [{ type: "text", text: "Report passed on to Fleet." }] });
    expect(notify).toHaveBeenCalledWith("fleet", "Cyborg reported (done): Found it in src/mcp", expect.any(Function));
    expect(pulses().cyborg).toMatchObject({ direction: "toFleet", fleetId: "fleet" });
    expect(terminalOf(nodesStore.getState().nodes.cyborg)).toMatchObject({ lastReport: { status: "done", summary: "Found it in src/mcp" } });
  });

  describe("with a Kanban board wired to the Fleet", () => {
    const wired = [{ nodeId: "board", board: { columns: [], cards: {} } }];
    afterEach(() => {
      vi.mocked(wiredBoardsOf).mockReturnValue(null);
      vi.mocked(missionRunsBoard).mockReturnValue(false);
    });

    it("reminds the manager that its sub-agent's card is its to move, to Done on done and to Blocked otherwise", () => {
      vi.mocked(wiredBoardsOf).mockReturnValue(wired);
      report("cyborg", { resume: "Found it", statut: "termine" });
      expect(notify).toHaveBeenLastCalledWith("fleet", "Cyborg reported (done): Found it — its card on your board is yours to move: move_board_card to Done.", expect.any(Function));
      for (const [statut, word] of [["bloque", "blocked"], ["echec", "failed"]] as const) {
        report("cyborg", { resume: "Not proven", statut });
        expect(notify).toHaveBeenLastCalledWith("fleet", `Cyborg reported (${word}): Not proven — its card on your board is yours to move: move_board_card to Blocked, not Done.`, expect.any(Function));
      }
    });

    it("says nothing for a board a mission runs (its cards follow the reports), nor for a Fleet with none", () => {
      vi.mocked(wiredBoardsOf).mockReturnValue(wired);
      vi.mocked(missionRunsBoard).mockReturnValue(true);
      report("cyborg", { resume: "Found it", statut: "termine" });
      expect(notify).toHaveBeenLastCalledWith("fleet", "Cyborg reported (done): Found it", expect.any(Function));
      vi.mocked(wiredBoardsOf).mockReturnValue([]);
      vi.mocked(missionRunsBoard).mockReturnValue(false);
      report("cyborg", { resume: "Found it again", statut: "termine" });
      expect(notify).toHaveBeenLastCalledWith("fleet", "Cyborg reported (done): Found it again", expect.any(Function));
    });
  });

  it("lights the Fleet's wire when it declares or marks a step", () => {
    declareSteps("cyborg", { etapes: ["Look"] });
    expect(pulses().cyborg).toMatchObject({ direction: "toFleet", fleetId: "fleet" });
  });

  it("says so when the Fleet's session no longer runs", () => {
    terminalStatusStore.getState().set("fleet", { state: "exited", code: 0 });
    expect(report("cyborg", { resume: "Done", statut: "termine" }).content[0].text).toContain("is closed");
    expect(notify).not.toHaveBeenCalled();
  });

  it("is described to the Fleet as ad-hoc work beside its mission's queue, in its workspace's folder", () => {
    const spawn = spawnAgentSpec(true);
    expect(spawn.name).toBe("spawn_agent");
    // An agent's arguments, but role: a Fleet's work splits through its mission, not a manager of its own.
    const { role, step, kind, ...agentArgs } = agentTools().find((tool) => tool.name === "spawn_agent")!.inputSchema.properties as Record<string, unknown>;
    expect(role).toBeDefined();
    expect(step).toBeDefined();
    expect(kind).toBeDefined();
    expect(spawn.inputSchema).toEqual({ ...agentTools().find((tool) => tool.name === "spawn_agent")!.inputSchema, properties: agentArgs });
    expect(spawn.description).toContain("outside your mission's queue");
    expect(spawn.description).toContain("in your workspace's folder");
    expect(spawn.description).toContain("not on your team");
    expect(spawn.description).toContain("3 levels below you");
  });
});

// 12 Nov, wt-be-upload-land: dummyPlane gave up typing four sub-tasks ("is not sent"), the Manager's text reached the
// agents another way, and every report came back "passed on to Manager" with nothing on the mission's record:
// `merge` said nobody was done, the seats stayed busy, the queue stalled.
describe("the report of a member whose sub-task dummyPlane never typed", () => {
  const chef = () => nodesStore.getState().nodes.chef;
  const memberNow = () => missionOf(chef())!.members.find((m) => m.nodeId === "batman")!;
  const hold = (extra: Partial<Member>) => {
    const mission = missionOf(chef())!;
    nodesStore.getState().update("chef", { mission: { ...mission, members: [{ ...member, sentAt: undefined, brief: "[dummyPlane] Login: do it.", ...extra }] } });
  };

  it("is the mission's: recorded, its sub-task counted as sent, nothing left to type on top of its work, the queue told", () => {
    hold({});
    const result = report("batman", { resume: "Done: 3 commits", statut: "termine" });
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).not.toContain("No mission");
    expect(memberNow()).toMatchObject({ report: { status: "termine", summary: "Done: 3 commits" }, sentAt: expect.any(Number) });
    expect(memberNow().brief).toBeUndefined();
    expect(afterReport).toHaveBeenCalledWith("chef", "batman");
  });

  it("waits while dummyPlane still means to type the sub-task: a word from the agent's last one is no report of this", () => {
    hold({});
    vi.mocked(deliveryPending).mockReturnValue(true);
    report("batman", { resume: "Done", statut: "termine" });
    expect(memberNow().report).toBeUndefined();
    expect(memberNow().sentAt).toBeUndefined();
    expect(afterReport).not.toHaveBeenCalled();
  });

  it("waits for a member that was given no sub-task yet (no text kept): it is still being made", () => {
    hold({ brief: undefined });
    report("batman", { resume: "Done", statut: "termine" });
    expect(memberNow().report).toBeUndefined();
  });

  it("is not taken for a member handed over to another agent", () => {
    hold({ handedTo: "Robin" });
    report("batman", { resume: "Done", statut: "termine" });
    expect(memberNow().report).toBeUndefined();
  });
});
