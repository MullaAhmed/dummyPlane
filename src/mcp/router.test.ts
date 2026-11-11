// @vitest-environment happy-dom
import { STORED_FLEET_KIND } from "@/canvas/nodeElement";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { canvasStore } from "@/canvas/canvasStore";
import { forgetScene, rememberScene } from "@/canvas/sceneCache";
import { nodesStore, terminalOf } from "@/store/nodes";
import { answer, handleCall, replyable } from "./router";
import { fleetSession } from "@/nodes/terminal/launch";
import type { McpCall } from "@/ipc/mcp";
import { pauseAgents } from "@/agents/broadcast";
import { setRemoteControl } from "@/agents/remoteControl";
import { ptySendText } from "@/ipc/pty";
import { terminalText } from "@/nodes/terminal/registry";
import { notify } from "@/mission/events";
import { endMission, reassignTask } from "@/mission/launch";
import { missionOf, setMission, setFleetClosed, updateMember } from "@/mission/store";
import { workspacesStore } from "@/store/workspaces";
import { agentActivityStore } from "@/store/agentActivity";
import { terminalStatusStore } from "@/store/terminalStatus";

vi.mock("@/ipc/pty", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/ipc/pty")>()), ptySendText: vi.fn(() => Promise.resolve()) }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(() => "ligne 1\nligne 2") }));
vi.mock("@/mission/launch", () => ({
  mergeMission: vi.fn(() => Promise.resolve("Branch dummyplane/auth :\nBatman : merged")),
  endMission: vi.fn(),
  reassignTask: vi.fn(() => Promise.resolve({ name: "Aquaman" })),
}));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));
vi.mock("@/agents/broadcast", () => ({ pauseAgents: vi.fn(() => Promise.resolve(1)) }));
vi.mock("@/agents/remoteControl", () => ({ setRemoteControl: vi.fn() }));
vi.mock("@/mission/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/mission/store")>()),
  linkedTeamAgents: vi.fn(() => [{ nodeId: "batman", name: "Batman" }]),
}));

vi.mock("@excalidraw/excalidraw", () => ({}));

const call = (nodeId: string, name: string, args: Record<string, unknown>) =>
  answer({ callId: 1, nodeId, method: "tools/call", params: { name, arguments: args } });
const textOf = (result: unknown) => (result as { content: { text: string }[] }).content[0].text;

beforeAll(async () => {
  mockIPC(() => undefined);
  workspacesStore.setState({ activeId: "w1" });
  canvasStore.setState({ api: { getSceneElements: () => [], getSceneElementsIncludingDeleted: () => [] } as never });
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "chef" } });
});

describe("the notes tool (spec notes §3)", () => {
  const notes = (node: string) => call(node, "notes", {});
  afterEach(() => void mockIPC(() => undefined));

  it("answers agents and fleets alike, with the same tool", async () => {
    mockIPC((command) => (command === "notes_agent_list" ? [{ name: "Auth", attached: true }] : undefined));
    expect(textOf(await notes("batman"))).toContain("Auth (attached to your group)");
    expect(textOf(await notes("chef"))).toContain("Auth");
  });

  it("answers an agent whose project is not on screen", async () => {
    mockIPC((command) => (command === "notes_agent_list" ? [] : undefined));
    expect(await notes("elsewhere")).not.toHaveProperty("isError");
  });
});

describe("the agent's tools (spec orchestrateur §4.4)", () => {
  it("lists them for any Claude session", async () => {
    const list = (await answer({ callId: 1, nodeId: "batman", method: "tools/list", params: {} })) as { tools: { name: string; inputSchema: object }[] };
    expect(list.tools.map((t) => t.name)).toEqual(["declare_steps", "step", "report", "spawn_agent", "linked_agents", "message_agent", "read_agent", "show_output", "output_guide", "read_node", "notes"]);
    expect(list.tools.every((t) => typeof t.inputSchema === "object")).toBe(true);
  });

  it("routes spawn_agent to the agent's sub-agent, a task required", async () => {
    const result = (await call("batman", "spawn_agent", { title: "Tests" })) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Give the sub-agent its task");
  });

  it("declares and marks the terminal's steps, saved in its payload", async () => {
    expect(textOf(await call("batman", "declare_steps", { steps: ["Plan", "Code"] }))).toBe("2 steps declared.");
    expect(textOf(await call("batman", "step", { title: "Plan", state: "done" }))).toBe("Plan: done.");
    expect(terminalOf(nodesStore.getState().nodes.batman)?.steps).toEqual([
      { title: "Plan", state: "fait" },
      { title: "Code", state: "a_venir" },
    ]);
  });

  it("answers mistakes with a readable error, the payload untouched", async () => {
    const before = terminalOf(nodesStore.getState().nodes.batman)?.steps;
    const wrong = (await call("batman", "step", { title: "Plan", state: "fini" })) as { isError?: boolean };
    expect(wrong.isError).toBe(true);
    expect((await call("batman", "declare_steps", {})) as { isError?: boolean }).toMatchObject({ isError: true });
    // Final review H1: a long title is refused before anything changes, not after.
    expect((await call("batman", "step", { title: "Implémentation du middleware d'authentification", state: "done" })) as { isError?: boolean }).toMatchObject({ isError: true });
    expect(textOf(await call("batman", "voler", {}))).toBe("Unknown tool: voler");
    expect(textOf(await call("gone", "step", { title: "Plan", state: "done" }))).toBe("This terminal is no longer on the canvas.");
    expect(textOf(await call("chef", "step", { title: "Plan", state: "done" }))).toBe("This tool is for agents.");
    expect(terminalOf(nodesStore.getState().nodes.batman)?.steps).toEqual(before);
  });

  it("says there is no mission to report to, outside one", async () => {
    expect(textOf(await call("batman", "report", { summary: "Fait", status: "done" }))).toBe("No mission under way: nothing to pass on.");
  });
});

describe("the fleet's tools (spec orchestrateur §7.2)", () => {
  const plan = {
    name: "Auth",
    task: "Ajoute l'authentification",
    subtasks: [
      { title: "Login", brief: "Fais le login", agent: "batman", budget_min: 20 },
      { title: "API", brief: "Fais l'API", agent: "new", budget_min: 30 },
    ],
  };

  it("lists them for the fleet only, and each side refuses the other's", async () => {
    const list = (await answer({ callId: 1, nodeId: "chef", method: "tools/list", params: {} })) as { tools: { name: string }[] };
    // The babysitter's: it plans, then adds and orders the board's cards, looks, and may stop the mission (spec babysitter Fleet).
    expect(list.tools.map((t) => t.name)).toEqual(["mission", "propose_plan", "add_tasks", "queue", "prioritize", "tickets", "board", "team", "stop_mission", "clean_up_mission", "remote_control", "spawn_agent", "output_guide", "read_node", "notes"]);
    expect(textOf(await call("batman", "propose_plan", plan))).toBe("This tool is for the fleet.");
    // The cleanup is the Fleet's too: no agent calls it.
    expect(textOf(await call("batman", "clean_up_mission", {}))).toBe("This tool is for the fleet.");
    expect(textOf(await call("chef", "report", { summary: "x", status: "done" }))).toBe("This tool is for agents.");
    expect(textOf(await call("batman", "board", {}))).toBe("This tool is for the fleet.");
  });

  it("offers a Codex fleet no Remote Control, which is Claude's", async () => {
    await nodesStore.getState().create("codexFleet", { workspaceId: "w1", kind: "fleet", payload: { name: "C", session: fleetSession("C", { cwd: "C:/p", shell: "default" }, "codex") } });
    const list = (await answer({ callId: 1, nodeId: "codexFleet", method: "tools/list", params: {} })) as { tools: { name: string }[] };
    const names = list.tools.map((t) => t.name);
    expect(names).toContain("mission");
    expect(names).not.toContain("remote_control");
    // dummyPlane's tools come from this list, whatever the CLI: a Codex fleet delegates with spawn_agent too.
    expect(names).toContain("spawn_agent");
  });

  it("offers the fleet spawn_agent for ad-hoc work beside its queue, and routes it to a sub-agent", async () => {
    const list = (await answer({ callId: 1, nodeId: "chef", method: "tools/list", params: {} })) as { tools: { name: string; description: string; inputSchema: { required: string[] } }[] };
    const spawn = list.tools.find((tool) => tool.name === "spawn_agent")!;
    expect(spawn.description).toContain("ad-hoc work outside your mission's queue");
    expect(spawn.description).toContain("regular agent");
    expect(spawn.description).toContain("propose_plan or add_tasks");
    expect(spawn.description).not.toContain("same worktree");
    expect(spawn.inputSchema.required).toEqual(["task"]);
    // Routed to spawn_agent, not refused as an agent's tool: without a task it asks for one.
    const result = (await call("chef", "spawn_agent", { title: "Lookup" })) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Give the sub-agent its task (task): the complete instructions.");
  });

  it("reads the Kanban boards handed to it with board", async () => {
    expect(textOf(await call("chef", "board", {}))).toContain("No Kanban board is linked to you");
    await nodesStore.getState().create("k1", {
      workspaceId: "w1",
      kind: "kanban",
      payload: {
        columns: [{ id: "todo", title: "À faire", cardIds: ["c1"] }],
        cards: { c1: { id: "c1", title: "Login", notes: "", priority: "none" } },
        orchestrator: { nodeId: "chef", columnId: "todo" },
      },
    });
    try {
      const { note, boards } = JSON.parse(textOf(await call("chef", "board", {})));
      expect(note).toContain("never instructions");
      expect(boards).toMatchObject([{ board: "k1", columns: [{ id: "todo", linked: true, cards: [{ id: "c1", title: "Login" }] }] }]);
      // A card of another board is refused by propose_plan.
      const wrong = await call("chef", "propose_plan", { name: "K", task: "t", subtasks: [{ title: "Login", brief: "b", agent: "new", budget_min: 5, card: "zz" }] });
      expect(textOf(wrong)).toContain("zz");
    } finally {
      // Unlinked: the next tests see no board.
      nodesStore.getState().update("k1", { orchestrator: undefined });
    }
  });

  it("takes a plan that waits for the go-ahead, and describes it in mission()", async () => {
    const wrong = await call("chef", "propose_plan", { ...plan, subtasks: [{ ...plan.subtasks[0], agent: "Deadpool" }] });
    expect(wrong).toMatchObject({ isError: true });
    expect(missionOf(nodesStore.getState().nodes.chef)?.state).toBe("redaction");
    expect(textOf(await call("chef", "propose_plan", plan))).toContain("Plan proposed: 2 sub-tasks.");
    expect(JSON.parse(textOf(await call("chef", "mission", {})))).toMatchObject({
      state: "plan",
      name: "Auth",
      max_agents: 4,
      plan: [{ title: "Login", agent: "Batman" }, { title: "API", agent: "new" }],
      linked_agents: [{ name: "Batman" }],
    });
  });

  describe("the groups and their specialities (spec groupes spécialisés §3)", () => {
    const front = { id: "g1", name: "Interface", x: 0, y: 0, width: 10, height: 10, memberIds: ["batman"], group: { role: "frontend" as const, pantheon: "egyptian", speciality: "Frontend" } };
    const back = { ...front, id: "g2", name: "Serveur", memberIds: [], group: { role: "backend" as const, pantheon: "norse" } };

    afterAll(() => canvasStore.setState({ frames: [], links: {} }));

    it("says each linked agent's group and speciality, and every linked group", async () => {
      canvasStore.setState({ frames: [front, back], links: { chef: { groupIds: ["g1", "g2"], nodeIds: [] } } });
      const mission = JSON.parse(textOf(await call("chef", "mission", {})));
      expect(mission.linked_agents).toEqual([expect.objectContaining({ name: "Batman", group: "Interface", speciality: "Frontend" })]);
      expect(mission.linked_groups).toEqual([{ name: "Interface", speciality: "Frontend" }, { name: "Serveur", speciality: null }]);
    });

    it("sends a new agent to a linked group and says so in the plan, refusing an unknown one", async () => {
      canvasStore.setState({ frames: [front, back], links: { chef: { groupIds: ["g1", "g2"], nodeIds: [] } } });
      const sub = { title: "Style", brief: "Fais le style", agent: "new", budget_min: 10 };
      expect(await call("chef", "propose_plan", { ...plan, subtasks: [{ ...sub, group: "Deadpool" }] })).toMatchObject({ isError: true });
      await call("chef", "propose_plan", { ...plan, subtasks: [{ ...sub, group: "interface" }, plan.subtasks[1]] });
      expect(missionOf(nodesStore.getState().nodes.chef)?.plan?.[0].group).toEqual({ id: "g1", name: "Interface" });
      expect(JSON.parse(textOf(await call("chef", "mission", {}))).plan.map((s: { group: unknown }) => s.group)).toEqual(["Interface", null]);
      await call("chef", "propose_plan", plan);
    });

    it("keeps today's answers for an agent outside any group, with nulls added", async () => {
      canvasStore.setState({ frames: [], links: {} });
      const mission = JSON.parse(textOf(await call("chef", "mission", {})));
      expect(mission.linked_agents).toEqual([expect.objectContaining({ name: "Batman", group: null, speciality: null })]);
      expect(mission.linked_groups).toEqual([]);
    });
  });

  describe("a workspace not on screen whose scene is known (spec mission de nuit §6.1)", () => {
    it("reads its linked agents and groups as on screen", async () => {
      await nodesStore.getState().create("ailleurs", { workspaceId: "w8", kind: "fleet", payload: { name: "Ailleurs" } });
      rememberScene("w8", [{ id: "g", type: "frame", name: "Interface", isDeleted: false, frameId: null, x: 0, y: 0, width: 1, height: 1, customData: { dummyplane: { kind: "group", role: "frontend", pantheon: "norse", speciality: "Frontend" } } }, { id: "ailleurs", type: "embeddable", isDeleted: false, frameId: null, x: 0, y: 0, width: 1, height: 1, customData: { kind: STORED_FLEET_KIND } }, { id: "a", type: "arrow", isDeleted: false, frameId: null, startBinding: { elementId: "ailleurs" }, endBinding: { elementId: "g" } }] as never, {} as never, {}, []);
      const mission = JSON.parse(textOf(await call("ailleurs", "mission", {})));
      expect(mission.linked_groups).toEqual([{ name: "Interface", speciality: "Frontend" }]);
      expect(mission.linked_agents).toEqual(expect.any(Array));
      expect(mission.linked_agents_note).toBeNull();
      expect(textOf(await call("ailleurs", "propose_plan", plan))).toContain("Plan proposed");
      forgetScene("w8");
    });
  });

  describe("the queue (spec mission de nuit §4)", () => {
    const task = { title: "Docs", brief: "Écris la doc", budget_min: 10 };

    it("adds tasks beyond the team, says how many wait and reads them back", async () => {
      await nodesStore.getState().create("file", { workspaceId: "w1", kind: "fleet", payload: { name: "File" } });
      expect(textOf(await call("file", "add_tasks", { tasks: [task, { ...task, title: "Tests", level: "low" }] }))).toBe("2 tasks added. Waiting: 2.");
      expect(JSON.parse(textOf(await call("file", "queue", {})))).toEqual({
        waiting: [
          { title: "Docs", brief: "Écris la doc", budget_min: 10, level: null, group: null, card: null },
          { title: "Tests", brief: "Écris la doc", budget_min: 10, level: "low", group: null, card: null },
        ],
        active_agents: 0,
        max_agents: 4,
      });
      expect(JSON.parse(textOf(await call("file", "mission", {})))).toMatchObject({ queue_waiting: 2, active_agents: null });
    });

    it("refuses what a plan would refuse, and a finished mission", async () => {
      expect(await call("file", "add_tasks", { tasks: [{ ...task, title: "docs" }] })).toMatchObject({ isError: true });
      expect(textOf(await call("batman", "add_tasks", { tasks: [task] }))).toBe("This tool is for the fleet.");
      setMission("file", { state: "terminee" });
      expect(textOf(await call("file", "add_tasks", { tasks: [{ ...task, title: "Autre" }] }))).toContain("finished");
    });

    it("takes a plan longer than Max agents and says the rest waits in the queue", async () => {
      await nodesStore.getState().create("long", { workspaceId: "w1", kind: "fleet", payload: { name: "Long" } });
      const subtasks = ["A", "B", "C", "D", "E"].map((title) => ({ title, brief: "b", agent: "new", budget_min: 10 }));
      expect(textOf(await call("long", "propose_plan", { name: "Long", task: "t", subtasks }))).toContain(
        "Plan proposed: 5 sub-tasks. The first 4 start at the go-ahead, the rest wait in the queue for a seat.",
      );
      expect(textOf(await call("long", "propose_plan", { name: "Long", task: "t", subtasks: subtasks.slice(0, 4) }))).not.toContain("go-ahead, the rest");
    });

    it("says next_task needs a formed team", async () => {
      await nodesStore.getState().create("seul", { workspaceId: "w1", kind: "fleet", payload: { name: "Seul" } });
      expect(textOf(await call("seul", "next_task", { agent: "Batman" }))).toBe("The team is not formed yet.");
    });
  });

  it("takes each sub-task's level and says whether the router is on (spec maj §3)", async () => {
    setMission("chef", { router: true });
    expect(textOf(await call("chef", "propose_plan", plan))).toContain("level");
    const leveled = { ...plan, subtasks: plan.subtasks.map((s, i) => ({ ...s, level: i === 0 ? "low" : "extrême" })) };
    expect(textOf(await call("chef", "propose_plan", leveled))).toContain("Plan proposed");
    expect(JSON.parse(textOf(await call("chef", "mission", {})))).toMatchObject({
      router: true,
      plan: [
        { level: "low", model: "Haiku 5.5" },
        { level: "extreme", model: "Fable 5.1" },
      ],
    });
    setMission("chef", { router: undefined });
    expect(JSON.parse(textOf(await call("chef", "mission", {})))).toMatchObject({ router: false, plan: [{ level: "low", model: null }, {}] });
  });

  it("turns Remote Control on or off for its agents or itself, and gives the links (spec maj §2)", async () => {
    vi.mocked(setRemoteControl).mockImplementation(async (id, on) => (on ? { on: true, url: `https://claude.ai/code/session_${id}` } : { on: false }));
    terminalStatusStore.getState().set("batman", { state: "running" });
    terminalStatusStore.getState().set("chef", { state: "running" });
    expect(textOf(await call("chef", "remote_control", { on: true, agents: ["all", "me"] }))).toBe(
      "Batman: on — https://claude.ai/code/session_batman\nYou: on — https://claude.ai/code/session_chef",
    );
    expect(textOf(await call("chef", "remote_control", { on: false, agents: ["batman"] }))).toBe("Batman: off");
    vi.mocked(setRemoteControl).mockResolvedValueOnce({ error: "Remote Control requires a claude.ai subscription" });
    expect(textOf(await call("chef", "remote_control", { on: true, agents: ["Batman"] }))).toBe("Batman: failed — Remote Control requires a claude.ai subscription");
    // In a turn, it is typed at the end of it: "me" is always in its own turn (final review maj §2).
    vi.mocked(setRemoteControl).mockResolvedValue({ later: true });
    expect(textOf(await call("chef", "remote_control", { on: true, agents: ["Batman", "moi"] }))).toBe(
      "Batman: at the end of its turn\nYou: at the end of your turn — the link will show in your header",
    );
    terminalStatusStore.getState().set("batman", { state: "stopped" });
    vi.mocked(setRemoteControl).mockResolvedValueOnce({ on: true });
    expect(textOf(await call("chef", "remote_control", { on: true, agents: ["Batman"] }))).toBe("Batman: on at its next start");
    vi.mocked(setRemoteControl).mockClear();
    expect(await call("chef", "remote_control", { on: true, agents: ["Deadpool"] })).toMatchObject({ isError: true });
    expect(await call("chef", "remote_control", { agents: ["Batman"] })).toMatchObject({ isError: true });
    expect(setRemoteControl).not.toHaveBeenCalled();
  });

  it("says so when its workspace is not on screen, instead of finding no linked agent (final review H2)", async () => {
    await nodesStore.getState().create("loin", { workspaceId: "w9", kind: "fleet", payload: { name: "Loin" } });
    const hidden = JSON.parse(textOf(await call("loin", "mission", {})));
    expect(hidden.linked_agents).toBeNull();
    expect(hidden.linked_groups).toBeNull();
    expect(hidden.linked_agents_note).toBe("unknown: the fleet's workspace is not on screen");
    expect(textOf(await call("loin", "propose_plan", plan))).toContain("not on screen");
    expect(textOf(await call("loin", "propose_plan", { ...plan, subtasks: [plan.subtasks[1]] }))).toContain("Plan proposed: 1 sub-task.");
    // Its groups are as unknown as its agents: refused, not told that the group does not exist.
    expect(textOf(await call("loin", "propose_plan", { ...plan, subtasks: [{ ...plan.subtasks[1], group: "Interface" }] }))).toContain("not on screen");
  });

  describe("once the team is formed, for a mission run the old way (no Manager: saved before Managers existed)", () => {
    beforeAll(() =>
      setMission("chef", {
        state: "en_cours",
        branch: "dummyplane/auth",
        members: [{ nodeId: "batman", name: "Batman", task: "Login", budgetMin: 20, linked: true, branch: "dummyplane/auth-batman", worktree: "C:/w/batman", sentAt: Date.now() }],
      }),
    );

    it("lists the team's tools for the Fleet, which runs it to its end", async () => {
      const list = (await answer({ callId: 1, nodeId: "chef", method: "tools/list", params: {} })) as { tools: { name: string }[] };
      expect(list.tools.map((t) => t.name)).toEqual([
        "mission", "propose_plan", "add_tasks", "queue", "prioritize", "next_task", "tickets", "board", "team",
        "read_output", "write", "extend", "interrupt", "reassign", "merge", "finish", "stop_mission", "clean_up_mission", "remote_control",
        "spawn_agent", "output_guide", "read_node", "notes",
      ]);
      expect(JSON.parse(textOf(await call("chef", "mission", {})))).toMatchObject({ runs: "fleet", manager: null, board: null });
    });

    it("says each member's group and speciality, to choose who takes a sub-task over (spec groupes spécialisés §3)", async () => {
      const front = { id: "g1", name: "Interface", x: 0, y: 0, width: 10, height: 10, memberIds: ["batman"], group: { role: "frontend" as const, pantheon: "egyptian", speciality: "Frontend" } };
      canvasStore.setState({ frames: [front] });
      expect(JSON.parse(textOf(await call("chef", "team", {})))[0]).toMatchObject({ name: "Batman", group: "Interface", speciality: "Frontend" });
      canvasStore.setState({ frames: [] });
      expect(JSON.parse(textOf(await call("chef", "team", {})))[0]).toMatchObject({ group: null, speciality: null });
    });

    it("does not say an agent has no group when its canvas is out of sight (final review)", async () => {
      workspacesStore.setState({ activeId: "w2" });
      const [batman] = JSON.parse(textOf(await call("chef", "team", {})));
      workspacesStore.setState({ activeId: "w1" });
      expect(batman.name).toBe("Batman");
      expect(batman).not.toHaveProperty("group");
      expect(batman).not.toHaveProperty("speciality");
    });

    it("counts the agents at work against Max agents in mission() and queue()", async () => {
      terminalStatusStore.getState().set("batman", { state: "running" });
      try {
        expect(JSON.parse(textOf(await call("chef", "mission", {})))).toMatchObject({ max_agents: 4, active_agents: 1 });
        expect(JSON.parse(textOf(await call("chef", "queue", {})))).toMatchObject({ max_agents: 4, active_agents: 1 });
        // Stopped after its sub-task was typed, it is at work no more.
        terminalStatusStore.getState().set("batman", { state: "stopped" });
        expect(JSON.parse(textOf(await call("chef", "mission", {})))).toMatchObject({ active_agents: 0 });
      } finally {
        terminalStatusStore.getState().set("batman", { state: "stopped" });
      }
    });

    it("reports the team and reads an agent's terminal", async () => {
      expect(JSON.parse(textOf(await call("chef", "team", {})))).toEqual([
        expect.objectContaining({ name: "Batman", subtask: "Login", time: "0 / 20 min", report: null, merged: false, handed_to: null, overdue: 0, model: null }),
      ]);
      expect(textOf(await call("chef", "read_output", { agent: "BATMAN", lines: 2 }))).toBe("ligne 1\nligne 2");
      expect(terminalText).toHaveBeenCalledWith("batman", 2);
      expect(await call("chef", "read_output", { agent: "Deadpool" })).toMatchObject({ isError: true });
    });

    it("writes to an agent that runs, never into a dialog meant for the user", async () => {
      terminalStatusStore.getState().set("batman", { state: "stopped" });
      expect(textOf(await call("chef", "write", { agent: "Batman", text: "Relance" }))).toBe("Batman is stopped.");
      terminalStatusStore.getState().set("batman", { state: "running" });
      agentActivityStore.getState().apply({ nodeId: "batman", activity: "waiting", since: 0 });
      expect(await call("chef", "write", { agent: "Batman", text: "Relance" })).toMatchObject({ isError: true });
      agentActivityStore.getState().apply({ nodeId: "batman", activity: "idle", since: 0 });
      expect(textOf(await call("chef", "write", { agent: "Batman", text: "Relance\nles tests" }))).toBe("Written to Batman.");
      expect(ptySendText).toHaveBeenCalledWith("batman", "Relance les tests");
    });

    it("takes an agent's report to its fleet", async () => {
      expect(await call("batman", "report", { summary: "Fait", status: "fini" })).toMatchObject({ isError: true });
      expect(textOf(await call("batman", "report", { summary: "Login fait", status: "done" }))).toBe("Report passed on to the fleet.");
      expect(missionOf(nodesStore.getState().nodes.chef)?.members[0].report).toMatchObject({ summary: "Login fait", status: "termine" });
      expect(notify).toHaveBeenCalledWith("chef", "Batman reported (done): Login fait");
    });

    it("keeps what an agent leaves to check by hand (spec mission de nuit §6.2)", async () => {
      await call("batman", "report", { summary: "Fait", status: "done", check: "Le bouton\nsur Windows 10" });
      expect(missionOf(nodesStore.getState().nodes.chef)?.members[0].report?.check).toBe("Le bouton sur Windows 10");
    });

    it("records a report no fleet hears, and says so (spec première version §5.4)", async () => {
      const unheard = "Report saved, but the fleet is closed: nobody will read it for now.";
      vi.mocked(notify).mockClear();
      terminalStatusStore.getState().set("chef", { state: "stopped" });
      expect(textOf(await call("batman", "report", { summary: "Fini", status: "done" }))).toBe(unheard);
      expect(missionOf(nodesStore.getState().nodes.chef)?.members[0].report).toMatchObject({ summary: "Fini" });
      terminalStatusStore.getState().set("chef", { state: "running" });
      setFleetClosed("chef", true);
      expect(textOf(await call("batman", "report", { summary: "Fini encore", status: "done" }))).toBe(unheard);
      setFleetClosed("chef", false);
      // Queued all the same: it hears them when it runs again (final review R3).
      expect(notify).toHaveBeenCalledWith("chef", "Batman reported (done): Fini");
      expect(notify).toHaveBeenCalledWith("chef", "Batman reported (done): Fini encore");
    });

    it("keeps an agent's merged branch merged when it reports again (final review H2)", async () => {
      updateMember("chef", "batman", { merged: true });
      await call("batman", "report", { summary: "Vérifié", status: "done" });
      expect(missionOf(nodesStore.getState().nodes.chef)?.members[0]).toMatchObject({ merged: true, report: { summary: "Vérifié" } });
    });

    it("extends an agent's target only within the real time left of the night (spec mission de nuit §3)", async () => {
      setMission("chef", { overnight: true, budgetMin: 30, startedAt: Date.now() });
      // Batman reported earlier in this file: still at work here, its whole budget counts.
      updateMember("chef", "batman", { report: undefined });
      expect(textOf(await call("chef", "extend", { agent: "Batman", minutes: 20 }))).toBe("30 min left in the night.");
      updateMember("chef", "batman", { overdue: 1 });
      expect(textOf(await call("chef", "extend", { agent: "Batman", minutes: 10 }))).toBe("Batman: +10 min, budget 30 min.");
      expect(missionOf(nodesStore.getState().nodes.chef)?.members[0]).toMatchObject({ extraMin: 10 });
      expect(missionOf(nodesStore.getState().nodes.chef)?.members[0].overdue).toBeUndefined();
      // The fleet reads the time with its extensions, and what is left (final review H3).
      expect(JSON.parse(textOf(await call("chef", "team", {})))[0]).toMatchObject({ time: "0 / 30 min" });
      expect(JSON.parse(textOf(await call("chef", "mission", {})))).toMatchObject({ away_min: 30, left_min: 30, elapsed_min: 0 });
      expect(await call("chef", "extend", { agent: "Batman", minutes: 0 })).toMatchObject({ isError: true });
      setMission("chef", { overnight: undefined, budgetMin: undefined, startedAt: undefined });
    });

    it("interrupts an agent's turn like « Pause » (spec §7.2)", async () => {
      expect(textOf(await call("chef", "interrupt", { agent: "Batman" }))).toBe('Batman\'s turn interrupted. write "continue" resumes it.');
      expect(pauseAgents).toHaveBeenCalledWith(["batman"]);
      vi.mocked(pauseAgents).mockResolvedValueOnce(0);
      expect(textOf(await call("chef", "interrupt", { agent: "Batman" }))).toBe("Batman is not at work: nothing to interrupt.");
    });

    it("hands a sub-task over through dummyPlane (spec §7.2)", async () => {
      expect(textOf(await call("chef", "reassign", { subtask: "login", agent: "new" }))).toBe('"Login" goes to Aquaman.');
      expect(reassignTask).toHaveBeenCalledWith("chef", "batman", "nouveau");
      expect(await call("chef", "reassign", { subtask: "Paiement", agent: "new" })).toMatchObject({ isError: true });
    });

    it("merges and ends the mission through dummyPlane; no new plan meanwhile", async () => {
      expect(textOf(await call("chef", "merge", {}))).toBe("Branch dummyplane/auth :\nBatman : merged");
      expect(await call("chef", "propose_plan", plan)).toMatchObject({ isError: true });
      expect(await call("chef", "finish", {})).toMatchObject({ isError: true });
      expect(textOf(await call("chef", "finish", { summary: "Fini" }))).toContain("Mission finished");
      expect(endMission).toHaveBeenCalledWith("chef", "Fini");
    });
  });
});

describe("a mission its Manager runs (spec babysitter Fleet)", () => {
  const member = (nodeId: string, name: string, task: string) => ({ nodeId, name, task, budgetMin: 20, linked: false, branch: `dummyplane/auth-${nodeId}`, worktree: `C:/w/${nodeId}`, sentAt: Date.now() });
  const lines = (nodeId: string) => vi.mocked(notify).mock.calls.filter(([id]) => id === nodeId).map(([, line]) => line);
  const terminal = (name: string, extra: Record<string, unknown> = {}) => ({ title: name, name, agent: "claude" as const, cwd: "C:/code", shell: "default" as const, command: "", ...extra });

  beforeAll(async () => {
    await nodesStore.getState().create("bossboard", {
      workspaceId: "w1",
      kind: "kanban",
      payload: {
        columns: [
          { id: "todo", title: "To do", cardIds: ["c1"] },
          { id: "doing", title: "In progress", cardIds: [] },
          { id: "done", title: "Done", cardIds: [] },
        ],
        cards: { c1: { id: "c1", title: "Docs", notes: "", priority: "none" } },
        orchestrator: { nodeId: "babysitter", columnId: "todo" },
      },
    });
    await nodesStore.getState().create("babysitter", {
      workspaceId: "w1",
      kind: "fleet",
      payload: {
        name: "Chef",
        mission: {
          state: "en_cours",
          maxAgents: 1,
          name: "Auth",
          branch: "dummyplane/auth",
          manager: "boss",
          board: "bossboard",
          boardMade: true,
          plan: [{ title: "Login", brief: "b", agent: "nouveau", budgetMin: 20 }],
          queue: [{ title: "Docs", brief: "d", budgetMin: 10, card: "c1" }],
          members: [member("robin", "Robin", "Login")],
        },
      },
    });
    await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: terminal("Manager", { role: "manager", fleet: "babysitter" }) });
    await nodesStore.getState().create("robin", { workspaceId: "w1", kind: "terminal", payload: terminal("Robin", { spawnedBy: "boss" }) });
    for (const id of ["babysitter", "boss", "robin"]) terminalStatusStore.getState().set(id, { state: "running" });
  });

  it("lists the Manager its own tools: the team's and the board's, no spawn_agent nor report", async () => {
    const list = (await answer({ callId: 1, nodeId: "boss", method: "tools/list", params: {} })) as { tools: { name: string }[] };
    expect(list.tools.map((t) => t.name)).toEqual([
      "mission", "add_tasks", "queue", "next_task", "board", "move_card", "team", "read_output", "write", "extend",
      "interrupt", "reassign", "merge", "finish", "need_user", "output_guide", "read_node", "notes",
    ]);
    expect(textOf(await call("boss", "report", { summary: "x", status: "done" }))).toContain("not the Manager's");
    expect(textOf(await call("boss", "spawn_agent", { task: "x" }))).toContain("not the Manager's");
    expect(textOf(await call("boss", "propose_plan", {}))).toBe("This tool is for the fleet.");
    expect(textOf(await call("boss", "clean_up_mission", {}))).toBe("This tool is for the fleet.");
    expect(textOf(await call("robin", "move_card", { card: "c1", column: "Done" }))).toBe("This tool is for a mission's Manager.");
    expect(textOf(await call("babysitter", "need_user", { reason: "x" }))).toBe("This tool is for a mission's Manager.");
  });

  it("lists the Fleet no team tool while its Manager runs the mission, and refuses them", async () => {
    const list = (await answer({ callId: 1, nodeId: "babysitter", method: "tools/list", params: {} })) as { tools: { name: string }[] };
    expect(list.tools.map((t) => t.name)).not.toContain("write");
    expect(list.tools.map((t) => t.name)).not.toContain("finish");
    expect(textOf(await call("babysitter", "write", { agent: "Robin", text: "x" }))).toContain("Manager, the Manager, runs this mission's team");
    expect(textOf(await call("babysitter", "merge", {}))).toContain("runs this mission's team");
    expect(JSON.parse(textOf(await call("babysitter", "mission", {})))).toMatchObject({ runs: "manager", manager: "Manager", board: "bossboard" });
    // Looking is the Fleet's: the team and the queue, read-only.
    expect(JSON.parse(textOf(await call("babysitter", "team", {})))[0]).toMatchObject({ name: "Robin", subtask: "Login" });
  });

  it("takes a team agent's report to its Manager, once, and never to the Fleet", async () => {
    vi.mocked(notify).mockClear();
    expect(textOf(await call("robin", "report", { summary: "Login fait", status: "done" }))).toBe("Report passed on to Manager.");
    expect(lines("boss")).toEqual(["Robin reported (done): Login fait"]);
    expect(lines("babysitter")).toEqual([]);
  });

  it("tells the Fleet one line when the Manager is stuck, and one when the board is finished", async () => {
    vi.mocked(notify).mockClear();
    expect(textOf(await call("boss", "need_user", { reason: "A merge conflict\nin auth.ts" }))).toContain("Passed on to Chef");
    expect(lines("babysitter")).toEqual(["Manager needs the user: A merge conflict in auth.ts"]);
    vi.mocked(endMission).mockImplementationOnce((fleetId: string, summary: string) => setMission(fleetId, { summary }));
    expect(textOf(await call("boss", "finish", { summary: "Login and docs\ndone." }))).toContain("Mission finished");
    expect(endMission).toHaveBeenCalledWith("babysitter", "Login and docs\ndone.");
    expect(lines("babysitter")).toEqual(["Manager needs the user: A merge conflict in auth.ts", "The board is finished: Login and docs done."]);
    setMission("babysitter", { summary: undefined });
  });

  it("adds the Fleet's tasks as cards in the board's to-do column, and tells the Manager", async () => {
    vi.mocked(notify).mockClear();
    const added = await call("babysitter", "add_tasks", { tasks: [{ title: "Tests", brief: "Write the tests", budget_min: 15 }] });
    expect(textOf(added)).toContain("1 task added");
    const board = nodesStore.getState().nodes.bossboard.payload as { columns: { id: string; cardIds: string[] }[]; cards: Record<string, { title: string; notes: string }> };
    const todo = board.columns.find((c) => c.id === "todo")!;
    const card = todo.cardIds.find((id) => board.cards[id].title === "Tests")!;
    expect(board.cards[card].notes).toBe("Write the tests");
    expect(missionOf(nodesStore.getState().nodes.babysitter)?.queue?.find((task) => task.title === "Tests")?.card).toBe(card);
    expect(lines("boss")).toEqual(['Chef added 1 card to the board: "Tests". They wait in the queue: a new agent takes each as a seat frees up.']);
    expect(lines("babysitter")).toEqual([]);
  });

  it("reorders the queue and the to-do column for the Fleet, and the Manager hears the new order", async () => {
    vi.mocked(notify).mockClear();
    expect(textOf(await call("babysitter", "prioritize", { task: "tests", position: 1, priority: "high" }))).toBe('"Tests" is number 1 of 2 in the queue. "Tests": priority high.');
    const mission = missionOf(nodesStore.getState().nodes.babysitter)!;
    expect(mission.queue?.map((t) => t.title)).toEqual(["Tests", "Docs"]);
    const board = nodesStore.getState().nodes.bossboard.payload as { columns: { id: string; cardIds: string[] }[]; cards: Record<string, { priority: string }> };
    const todo = board.columns.find((c) => c.id === "todo")!.cardIds;
    expect(todo).toEqual([mission.queue![0].card, "c1"]);
    expect(board.cards[mission.queue![0].card!].priority).toBe("high");
    expect(lines("boss")).toEqual(['Chef reordered the queue: "Tests", "Docs".']);
    expect(await call("babysitter", "prioritize", { task: "Nope", position: 1 })).toMatchObject({ isError: true });
  });

  it("lets the Manager move a card by the column's title", async () => {
    expect(textOf(await call("boss", "move_card", { card: "c1", column: "in progress" }))).toBe('"Docs" moved to In progress.');
    expect(await call("boss", "move_card", { card: "zz", column: "Done" })).toMatchObject({ isError: true });
  });

  it("stops the mission for the Fleet, the Manager told", async () => {
    vi.mocked(notify).mockClear();
    expect(await call("babysitter", "stop_mission", {})).toMatchObject({ isError: true });
    expect(textOf(await call("babysitter", "stop_mission", { reason: "The user changed their mind" }))).toContain("Mission stopped");
    expect(endMission).toHaveBeenCalledWith("babysitter", "Stopped by Chef: The user changed their mind");
    expect(lines("boss")).toEqual(["Chef stopped the mission: The user changed their mind"]);
  });

  it("gives a Codex Fleet and its Codex Manager the same tools, Remote Control aside (Claude's)", async () => {
    await nodesStore.getState().create("codexSitter", {
      workspaceId: "w1",
      kind: "fleet",
      payload: { name: "C", session: fleetSession("C", { cwd: "C:/p", shell: "default" }, "codex"), mission: { state: "en_cours", maxAgents: 2, manager: "codexBoss", members: [] } },
    });
    await nodesStore.getState().create("codexBoss", { workspaceId: "w1", kind: "terminal", payload: terminal("Manager", { agent: "codex", role: "manager", fleet: "codexSitter" }) });
    const names = async (id: string) => ((await answer({ callId: 1, nodeId: id, method: "tools/list", params: {} })) as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(await names("codexSitter")).toEqual(["mission", "propose_plan", "add_tasks", "queue", "prioritize", "tickets", "board", "team", "stop_mission", "clean_up_mission", "spawn_agent", "output_guide", "read_node", "notes"]);
    expect(await names("codexBoss")).toEqual(await names("boss"));
  });

  it("gives Remote Control the Manager too, by its name", async () => {
    vi.mocked(setRemoteControl).mockResolvedValue({ on: true, url: "https://claude.ai/x" } as never);
    expect(textOf(await call("babysitter", "remote_control", { on: true, agents: ["manager"] }))).toContain("Manager: on");
    expect(setRemoteControl).toHaveBeenCalledWith("boss", true);
  });
});

it("answers a failed step with its accent in French (backlog R5c)", async () => {
  expect(textOf(await call("batman", "step", { title: "Plan", state: "failed" }))).toBe("Plan: failed.");
});

describe("the English protocol (spec première version §7.1)", () => {
  it("still takes French values, and tells a former name what it became", async () => {
    expect(textOf(await call("batman", "step", { title: "Plan", state: "en_cours" }))).toBe("Plan: in_progress.");
    const old = await call("batman", "rendre_compte", { resume: "x", statut: "termine" });
    expect(old).toMatchObject({ isError: true });
    expect(textOf(old)).toBe("Tool renamed: use report.");
  });

  it("describes its tools and answers in English when the interface is in English", async () => {
    try {
      const list = (await answer({ callId: 1, nodeId: "batman", method: "tools/list", params: {} })) as { tools: { name: string; description: string }[] };
      expect(list.tools[0].description).toContain("Declare your task's steps");
      expect(textOf(await call("batman", "declare_steps", { steps: ["Plan"] }))).toBe("1 step declared.");
      expect(textOf(await call("batman", "voler", {}))).toBe("Unknown tool: voler");
    } finally {
    }
  });
});

describe("every call gets its reply, even under load or a failing reply", () => {
  const stepCall = (callId: number, nodeId: string): McpCall => ({ callId, nodeId, method: "tools/call", params: { name: "step", arguments: { title: "Plan", state: "done" } } });

  it("answers 8 agents calling 25 times at once, each call once", async () => {
    const replies = new Map<number, unknown>();
    const calls = Array.from({ length: 200 }, (_, i) => stepCall(i, i % 2 ? "batman" : "chef"));
    // The reply path is slow and out of order, as under a busy page.
    const reply = async (callId: number, result: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, (callId * 7) % 13));
      replies.set(callId, result);
    };
    await Promise.all(calls.map((c) => handleCall(c, reply)));
    expect(replies.size).toBe(200);
    expect([...replies.values()].every((r) => (r as { content: unknown[] }).content.length > 0)).toBe(true);
  });

  it("turns an answer JSON cannot carry into a readable error", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(replyable(cyclic)).toMatchObject({ isError: true });
    expect(replyable(undefined)).toMatchObject({ isError: true });
    expect(replyable({ content: [] })).toEqual({ content: [] });
  });

  it("replies with a readable error when a tool's answer cannot be sent as JSON", async () => {
    const replies: unknown[] = [];
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const reply = async (_id: number, result: unknown) => void replies.push(result);
    await handleCall({ callId: 1, nodeId: "batman", method: "tools/call", params: { name: "step", arguments: { title: "Plan", state: "done" } } }, reply);
    expect(replies).toHaveLength(1);
    const bad = vi.fn(async (_id: number, result: unknown) => {
      if (result === cyclic) throw new Error("not serializable");
      replies.push(result);
    });
    await handleCall({ callId: 2, nodeId: "batman", method: "tools/call", params: { name: "step", arguments: cyclic } }, bad);
    expect(replies).toHaveLength(2);
    expect(replies[1]).toMatchObject({ isError: true });
  });

  it("tries a reply that failed once more, in a form that cannot fail", async () => {
    const seen: unknown[] = [];
    let first = true;
    const reply = async (_id: number, result: unknown) => {
      if (first) {
        first = false;
        throw new Error("ipc hiccup");
      }
      seen.push(result);
    };
    await handleCall(stepCall(1, "batman"), reply);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ isError: true });
  });
});
