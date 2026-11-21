// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { modelRouterStore } from "@/app/modelRouterSetting";
import type { Member, Mission, QueuedTask, SubTask } from "@/mission/mission";
import type { KanbanCard, KanbanPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { fleetTool, managerTool } from "./fleetTools";
import { MAX_ANSWER_CHARS } from "./compact";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/mission/launch", () => ({ endMission: vi.fn(), mergeMission: vi.fn(), reassignTask: vi.fn(), deliveryPending: vi.fn(() => false) }));
vi.mock("@/agents/broadcast", () => ({ pauseAgents: vi.fn() }));
vi.mock("@/agents/remoteControl", () => ({ setRemoteControl: vi.fn() }));
vi.mock("@/nodes/terminal/registry", () => ({ terminalText: vi.fn(() => ""), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity), freshText: vi.fn(() => "") }));

/**
 * `mission`, `team`, `queue` and `board` overflowed Claude Code's limit of 25,000 tokens ten times in the sessions of
 * 10 to 13 November (65 to 128 KB for one mission), and came back as a path to a file. Their answers must stay under
 * `MAX_ANSWER_CHARS` (`./compact.ts`: a third of the smallest answer refused, under the 10,000 tokens Claude Code warns
 * from) for a big mission: 15 agents with long reports, a plan and a queue of 15 long briefs, a board of 60 cards
 * whose notes are GitHub issues' bodies; and even for one far bigger, where the end of the list is left out and counted.
 */

const session = { title: "Chef", name: "Chef", agent: "claude" as const, cwd: "C:/p", shell: "default" as const, command: "", role: "orchestrator" as const };
const textOf = (result: { content: { text: string }[] }) => result.content[0].text;

/** A text of `size` characters in lines, ending in `end`: what a brief, a report or an issue's body looks like, and where to look for its end. */
const prose = (what: string, size: number, end: string) => `${`${what}: write the code, then the tests, then say what changed and why.\n`.repeat(Math.ceil(size / 60)).slice(0, size)}${end}`;

const NAMES = ["Batman", "Robin", "Thor", "Hulk", "Storm", "Rogue", "Cyclops", "Ironman", "Flash", "Aquaman", "Shazam", "Zatanna", "Vision", "Wasp", "Beast", "Gambit", "Colossus", "Nightcrawler", "Jubilee", "Psylocke"];
const nameOf = (i: number) => (i < NAMES.length ? NAMES[i] : `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`);
const titleOf = (i: number) => `Sub-task ${i + 1}: ${"x".repeat(40)}`;

const steps = Array.from({ length: 12 }, (_, i) => ({ title: `Step ${i + 1}`, state: i < 6 ? ("fait" as const) : i === 6 ? ("en_cours" as const) : ("a_venir" as const) }));

function members(count: number): Member[] {
  return Array.from({ length: count }, (_, i) => ({
    nodeId: `m${i}`,
    name: nameOf(i),
    task: titleOf(i),
    budgetMin: 30,
    linked: false,
    branch: `dummyplane/auth-${nameOf(i).toLowerCase()}`,
    worktree: `C:/w/${i}`,
    sentAt: 1,
    done: ["An earlier sub-task of its own", "Another one"],
    report: { summary: prose(`report ${i}`, 4_000, `END-OF-REPORT-${i}`), status: "termine" as const, at: 2 },
  }));
}
const plan = (count: number): SubTask[] => Array.from({ length: count }, (_, i) => ({ title: titleOf(i), brief: prose(`brief ${i}`, 3_000, `END-OF-BRIEF-${i}`), agent: "nouveau", budgetMin: 30 }));
const queued = (count: number): QueuedTask[] => Array.from({ length: count }, (_, i) => ({ title: `Waiting ${i + 1}`, brief: prose(`queued ${i}`, 3_000, `END-OF-QUEUED-${i}`), budgetMin: 30 }));
const board = (count: number): KanbanPayload => {
  const cards: Record<string, KanbanCard> = {};
  for (let i = 0; i < count; i++) {
    cards[`c${i}`] = {
      id: `c${i}`,
      title: `Fix the issue number ${i + 1}`,
      notes: prose(`issue ${i}`, 3_000, `END-OF-NOTES-${i}`),
      priority: i % 3 === 0 ? "high" : "none",
      github: { repo: "me/app", number: i + 1, url: `https://github.com/me/app/issues/${i + 1}`, state: "open" },
    };
  }
  return {
    columns: [
      { id: "todo", title: "To do", cardIds: Object.keys(cards).slice(0, Math.ceil(count / 2)) },
      { id: "doing", title: "In progress", cardIds: Object.keys(cards).slice(Math.ceil(count / 2)) },
      { id: "done", title: "Done", cardIds: [] },
    ],
    cards,
    orchestrator: { nodeId: "chef", columnId: "todo" },
  };
};

/** A mission a Manager runs, `agents` of them already at work, with `cards` on its board. */
async function setup({ agents, subtasks = agents, waiting = agents, cards }: { agents: number; subtasks?: number; waiting?: number; cards: number }) {
  const team = members(agents);
  const mission: Mission = {
    state: "en_cours",
    maxAgents: 4,
    name: "Auth",
    task: prose("the user's task", 6_000, "END-OF-TASK"),
    startedAt: Date.now(),
    branch: "dummyplane/auth",
    manager: "boss",
    board: "k1",
    plan: plan(subtasks),
    queue: queued(waiting),
    members: team,
  };
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef", session, mission } });
  await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: { title: "Manager", name: "Manager", agent: "claude", cwd: "C:/p", shell: "default", command: "", role: "manager", fleet: "chef" } });
  await nodesStore.getState().create("k1", { workspaceId: "w1", kind: "kanban", payload: board(cards) });
  for (const m of team) {
    await nodesStore.getState().create(m.nodeId, { workspaceId: "w1", kind: "terminal", payload: { title: m.name, name: m.name, agent: "claude", cwd: m.worktree, shell: "default", command: "", steps } });
  }
}

beforeEach(() => {
  modelRouterStore.setState({ on: false, levels: {} });
  mockIPC(() => undefined);
});

describe("a big mission's answers stay short", () => {
  it("the fixture is as big as the ones that overflowed: a pretty-printed team of it alone is well past the limit", async () => {
    await setup({ agents: 15, cards: 60 });
    const raw = JSON.stringify(nodesStore.getState().nodes.chef.payload, null, 2);
    expect(raw.length).toBeGreaterThan(5 * MAX_ANSWER_CHARS);
  });

  it("mission, team, queue and board, the Fleet's and the Manager's, answer within MAX_ANSWER_CHARS", async () => {
    await setup({ agents: 15, cards: 60 });
    const answers = {
      "fleet mission": await fleetTool("chef", "mission", {}),
      "fleet team": await fleetTool("chef", "equipe", {}),
      "fleet queue": await fleetTool("chef", "queue", {}),
      "fleet board": await fleetTool("chef", "board", {}),
      "manager mission": await managerTool("boss", "mission", {}),
      "manager team": await managerTool("boss", "equipe", {}),
      "manager queue": await managerTool("boss", "queue", {}),
      "manager board": await managerTool("boss", "board", {}),
    };
    for (const [name, answer] of Object.entries(answers)) {
      expect(answer.isError, name).not.toBe(true);
      expect(textOf(answer).length, name).toBeLessThan(MAX_ANSWER_CHARS);
      // Still the JSON it was: an agent parses it.
      expect(() => JSON.parse(textOf(answer)), name).not.toThrow();
    }
  });

  it("team gives a line per agent: its name, sub-task, state, steps reached, time and its report cut short, with how to read it whole", async () => {
    await setup({ agents: 15, cards: 0 });
    const list = JSON.parse(textOf(await fleetTool("chef", "equipe", {}))) as { name: string; subtask: string; state: string; progress: string; time: string; merged: boolean; report: { status: string; summary: string } }[];
    expect(list).toHaveLength(15);
    expect(list[2]).toMatchObject({ name: "Thor", subtask: titleOf(2), state: "stopped", progress: "6/12, now: Step 7", time: "0 / 30 min", merged: false, report: { status: "done" } });
    expect(list[2].report.summary).toContain('team agent="Thor"');
    expect(list[2].report.summary).not.toContain("END-OF-REPORT-2");
    // One line each: no agent takes more than a few hundred characters.
    expect(textOf(await fleetTool("chef", "equipe", {})).split("\n").every((line) => line.length < 800)).toBe(true);
  });

  it("team with agent gives that agent alone, whole: its steps, finished sub-tasks, branch and the end of its report", async () => {
    await setup({ agents: 15, cards: 0 });
    const text = textOf(await managerTool("boss", "equipe", { agent: "thor" }));
    const one = JSON.parse(text);
    expect(one).toMatchObject({ name: "Thor", branch: "dummyplane/auth-thor", finished: ["An earlier sub-task of its own", "Another one"], steps: expect.arrayContaining(["Step 7: in_progress"]) });
    expect(one.report.summary).toContain("END-OF-REPORT-2");
    expect(text).not.toContain("END-OF-REPORT-3");
    const unknown = await fleetTool("chef", "equipe", { agent: "Deadpool" });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain("Batman");
  });

  it("mission cuts each brief of the plan and says how to read it; subtask gives one whole, or names the titles", async () => {
    await setup({ agents: 15, cards: 0 });
    const mission = JSON.parse(textOf(await fleetTool("chef", "mission", {})));
    expect(mission.plan).toHaveLength(15);
    expect(mission.plan[4].brief).toContain(`mission subtask="${titleOf(4)}"`);
    expect(mission.plan[4].brief).not.toContain("END-OF-BRIEF-4");
    // The user's task is cut as well, a few paragraphs of it kept.
    expect(mission.task.length).toBeLessThan(2_000);
    expect(mission).toMatchObject({ queue_waiting: 15, max_agents: 4 });
    const one = JSON.parse(textOf(await managerTool("boss", "mission", { subtask: titleOf(4) })));
    expect(one).toMatchObject({ title: titleOf(4), agent: "new" });
    expect(one.brief).toContain("END-OF-BRIEF-4");
    // The start of a title is enough when it fits one sub-task only.
    expect(JSON.parse(textOf(await fleetTool("chef", "mission", { subtask: "Sub-task 15" }))).title).toBe(titleOf(14));
    const unknown = await fleetTool("chef", "mission", { subtask: "Nothing" });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain(`"${titleOf(0)}"`);
  });

  it("queue cuts each brief; task gives one whole, or names what waits", async () => {
    await setup({ agents: 3, waiting: 15, cards: 0 });
    const queue = JSON.parse(textOf(await fleetTool("chef", "queue", {})));
    expect(queue.waiting).toHaveLength(15);
    expect(queue.waiting[3].brief).toContain('queue task="Waiting 4"');
    expect(queue.waiting[3].brief).not.toContain("END-OF-QUEUED-3");
    expect(queue).toMatchObject({ max_agents: 4 });
    const one = JSON.parse(textOf(await managerTool("boss", "queue", { task: "waiting 4" })));
    expect(one.brief).toContain("END-OF-QUEUED-3");
    const unknown = await managerTool("boss", "queue", { task: "Nothing" });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain('"Waiting 1"');
  });

  it("board gives a line per card (id, title, notes cut short, priority, issue), the fields at their default left out; card gives one whole", async () => {
    await setup({ agents: 3, cards: 60 });
    const { note, boards } = JSON.parse(textOf(await managerTool("boss", "board", {})));
    // Said once for the whole board, not on each card: sixty of them would not fit.
    expect(note).toContain("Notes ending in … (+N) are cut short: board with card (a card's id or title) reads one whole.");
    const cards = boards[0].columns.flatMap((column: { cards: unknown[] }) => column.cards) as { id: string; title: string; notes: string; priority?: string; issue: string; due?: string; agent?: string }[];
    expect(cards).toHaveLength(60);
    expect(cards[3]).toMatchObject({ id: "c3", title: "Fix the issue number 4", priority: "high", issue: "me/app#4 open" });
    expect(cards[3].notes).toMatch(/… \(\+\d+\)$/);
    expect(cards[3].notes).not.toContain("END-OF-NOTES-3");
    expect(cards[1]).not.toHaveProperty("priority");
    expect(cards[1]).not.toHaveProperty("due");
    expect(cards[1]).not.toHaveProperty("agent");
    // A card read alone: whole, its issue's link, and its column; by its id or by its title.
    const byId = JSON.parse(textOf(await fleetTool("chef", "board", { card: "c3" })));
    expect(byId).toMatchObject({ board: "k1", column: "To do", card: { id: "c3", github: { url: "https://github.com/me/app/issues/4" } } });
    expect(byId.card.notes).toContain("END-OF-NOTES-3");
    expect(JSON.parse(textOf(await managerTool("boss", "board", { card: "fix the issue number 40" }))).card.id).toBe("c39");
    const unknown = await managerTool("boss", "board", { card: "zz" });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain('No card "zz"');
  });

  it("a mission far bigger still answers within the limit: the end of each list is left out, counted, with the call that reads it", async () => {
    await setup({ agents: 150, subtasks: 150, waiting: 150, cards: 500 });
    const team = JSON.parse(textOf(await fleetTool("chef", "equipe", {}))) as { name?: string; left_out?: string }[];
    const mission = JSON.parse(textOf(await fleetTool("chef", "mission", {})));
    const queue = JSON.parse(textOf(await fleetTool("chef", "queue", {})));
    const { boards } = JSON.parse(textOf(await fleetTool("chef", "board", {})));
    for (const text of [await fleetTool("chef", "equipe", {}), await fleetTool("chef", "mission", {}), await fleetTool("chef", "queue", {}), await fleetTool("chef", "board", {})].map(textOf)) {
      expect(text.length).toBeLessThan(MAX_ANSWER_CHARS);
    }
    const last = team[team.length - 1];
    expect(last.left_out).toMatch(/^\d+ more agents left out to keep this answer short: team agent="<name>"\.$/);
    expect(boards[0].cards_left_out).toMatch(/^\d+ more cards left out to keep this answer short: board card="<id>"\.$/);
    expect(team.length - 1 + Number(last.left_out?.split(" ")[0])).toBe(150);
    expect(mission.plan_left_out).toContain("sub-tasks left out");
    expect(mission.plan.length + Number(mission.plan_left_out.split(" ")[0])).toBe(150);
    expect(queue.waiting_left_out).toContain("tasks left out");
    expect(boards[0].cards_left_out).toContain("cards left out");
    const shown = boards[0].columns.reduce((n: number, column: { cards: unknown[] }) => n + column.cards.length, 0);
    expect(shown + Number(boards[0].cards_left_out.split(" ")[0])).toBe(500);
  });

  it("tells an agent how to ask for detail in the tools' own descriptions", async () => {
    const { managerTools } = await import("./fleetTools");
    const tool = (name: string) => managerTools().find((t) => t.name === name) as { description: string; inputSchema: { properties: Record<string, unknown> } };
    expect(tool("team").inputSchema.properties).toHaveProperty("agent");
    expect(tool("mission").inputSchema.properties).toHaveProperty("subtask");
    expect(tool("queue").inputSchema.properties).toHaveProperty("task");
    expect(tool("board").inputSchema.properties).toHaveProperty("card");
    expect(tool("team").description).toContain("agent (an agent's name)");
    expect(tool("board").description).toContain("card (a card's id or title)");
  });
});
