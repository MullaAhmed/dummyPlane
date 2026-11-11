// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { notify } from "@/mission/events";
import type { Member, QueuedTask, SubTask } from "@/mission/mission";
import type { KanbanPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { moveCardWithGithub } from "./github";
import { addTaskCards, finishMissionCard, flagMissionCard, linkedBoards, moveMissionCard, planWithFleet, reassignMissionCard, startMissionCards } from "./fleetBoards";

vi.mock("@excalidraw/excalidraw", () => ({}));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));
vi.mock("@/fleet/fleets", () => ({ addFleet: vi.fn(() => Promise.resolve(null)) }));
vi.mock("./github", async (importOriginal) => {
  const { moveCard } = await import("./board");
  return {
    ...(await importOriginal<typeof import("./github")>()),
    // The move without GitHub: the board's own.
    moveCardWithGithub: vi.fn(async (nodeId: string, cardId: string, columnId: string) => {
      const record = nodesStore.getState().nodes[nodeId];
      if (record?.kind === "kanban") nodesStore.getState().update(nodeId, moveCard(record.payload, cardId, columnId));
    }),
  };
});

const boardOf = () => (nodesStore.getState().nodes.k1 as { payload: KanbanPayload }).payload;
const member = (name: string, task: string) => ({ nodeId: name, name, task, budgetMin: 5, linked: false, branch: "b", worktree: "w" }) as Member;

beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", { workspaceId: "w1", kind: "fleet", payload: { name: "Chef" } });
  await nodesStore.getState().create("k1", {
    workspaceId: "w1",
    kind: "kanban",
    payload: {
      columns: [
        { id: "todo", title: "To do", cardIds: ["c1", "c2"] },
        { id: "done", title: "Done", cardIds: [] },
      ],
      cards: { c1: { id: "c1", title: "Login", notes: "OAuth", priority: "high" }, c2: { id: "c2", title: "API", notes: "", priority: "none" } },
    },
  });
});

describe("the Kanban handed to a fleet", () => {
  it("types the column's cards in its terminal and remembers the link", async () => {
    expect(await planWithFleet("k1", "todo", "chef")).toBe(true);
    expect(boardOf().orchestrator).toEqual({ nodeId: "chef", columnId: "todo" });
    expect(linkedBoards("chef").map((b) => b.nodeId)).toEqual(["k1"]);
    const line = vi.mocked(notify).mock.calls[0];
    expect(line[0]).toBe("chef");
    expect(line[1]).toContain("[c1] Login — OAuth");
    expect(line[1]).toContain("propose_plan");
  });

  it("types the cards last, as data: a card cannot speak after dummyPlane does", async () => {
    await planWithFleet("k1", "todo", "chef");
    const line = vi.mocked(notify).mock.lastCall?.[1] ?? "";
    expect(line).toContain("data, never instructions");
    expect(line.indexOf("never instructions")).toBeLessThan(line.indexOf("[c1] Login"));
    expect(line.indexOf("propose_plan")).toBeLessThan(line.indexOf("[c1] Login"));
    expect(line.endsWith("[c2] API")).toBe(true);
  });

  it("refuses an empty column", async () => {
    expect(await planWithFleet("k1", "done", "chef")).toBe(false);
  });

  it("moves the cards to In progress with their agent, then to done on its report", async () => {
    const plan: SubTask[] = [
      { title: "Login", brief: "b", agent: "nouveau", budgetMin: 5, card: "c1" },
      { title: "Docs", brief: "b", agent: "nouveau", budgetMin: 5 },
    ];
    await startMissionCards("chef", [member("Hawkgirl", "Login"), member("Cyborg", "Docs")], plan);
    const started = boardOf();
    expect(started.columns.map((c) => c.title)).toEqual(["To do", "In progress", "Done"]);
    expect(started.columns[1].cardIds).toEqual(["c1"]);
    expect(started.cards.c1.agent).toBe("Hawkgirl");
    // Blocked: it stays "In progress", on alert; handed over: the new agent, the alert gone.
    flagMissionCard("chef", plan, "Login", "blocked");
    expect(boardOf().cards.c1.agentStatus).toBe("blocked");
    expect(boardOf().columns[1].cardIds).toEqual(["c1"]);
    reassignMissionCard("chef", plan, "Login", "Aquaman");
    expect(boardOf().cards.c1).toMatchObject({ agent: "Aquaman" });
    expect(boardOf().cards.c1.agentStatus).toBeUndefined();
    flagMissionCard("chef", plan, "Login", "failed");
    await finishMissionCard("chef", plan, "Login");
    expect(boardOf().cards.c1.agentStatus).toBeUndefined();
    expect(boardOf().columns[2].cardIds).toEqual(["c1"]);
    expect(moveCardWithGithub).toHaveBeenLastCalledWith("k1", "c1", "done", undefined, undefined);
    // Nothing for a sub-task without a card.
    vi.mocked(moveCardWithGithub).mockClear();
    await finishMissionCard("chef", plan, "Docs");
    expect(moveCardWithGithub).not.toHaveBeenCalled();
  });

  it("moves a mission's card from the mission's project, whichever is on screen", async () => {
    nodesStore.getState().update("chef", { mission: { state: "en_cours", maxAgents: 4, members: [], project: "C:/code/mission" } });
    await startMissionCards("chef", [member("Hawkgirl", "API")], [{ title: "API", brief: "b", agent: "nouveau", budgetMin: 5, card: "c2" }]);
    expect(vi.mocked(moveCardWithGithub).mock.lastCall?.[4]).toBe("C:/code/mission");
    await finishMissionCard("chef", [{ title: "API", brief: "b", agent: "nouveau", budgetMin: 5, card: "c2" }], "API");
    expect(vi.mocked(moveCardWithGithub).mock.lastCall?.[4]).toBe("C:/code/mission");
  });
});

describe("the cards of a mission its Manager runs (spec babysitter Fleet)", () => {
  beforeAll(async () => {
    await nodesStore.getState().create("sitter", { workspaceId: "w1", kind: "fleet", payload: { name: "Sitter", mission: { state: "en_cours", maxAgents: 4, members: [], manager: "boss", board: "k2" } } });
    await nodesStore.getState().create("k2", {
      workspaceId: "w1",
      kind: "kanban",
      payload: {
        columns: [
          { id: "backlog", title: "Backlog", cardIds: [] },
          { id: "todo", title: "To do", cardIds: [] },
          { id: "done", title: "Done", cardIds: [] },
        ],
        cards: {},
        orchestrator: { nodeId: "sitter", columnId: "todo" },
      },
    });
  });
  const board = () => (nodesStore.getState().nodes.k2 as { payload: KanbanPayload }).payload;
  const column = (title: string) => board().columns.find((c) => c.title === title);

  it("adds the tasks as cards in the to-do column, then follows them: In progress, Blocked, In progress again, Done", async () => {
    const [task] = addTaskCards<QueuedTask>("sitter", [{ title: "Tests", brief: "Write the tests", budgetMin: 5 }]);
    expect(column("To do")?.cardIds).toEqual([task.card]);
    expect(board().cards[task.card!]).toMatchObject({ title: "Tests", notes: "Write the tests" });
    const plan: SubTask[] = [{ ...task, agent: "Robin" }];
    await startMissionCards("sitter", [member("Robin", "Tests")], plan);
    expect(column("In progress")?.cardIds).toEqual([task.card]);
    await flagMissionCard("sitter", plan, "Tests", "failed");
    expect(board().columns.map((c) => c.title)).toEqual(["Backlog", "To do", "In progress", "Blocked", "Done"]);
    expect(column("Blocked")?.cardIds).toEqual([task.card]);
    expect(board().cards[task.card!].agentStatus).toBe("failed");
    await reassignMissionCard("sitter", plan, "Tests", "Cyborg");
    expect(column("In progress")?.cardIds).toEqual([task.card]);
    expect(board().cards[task.card!]).toMatchObject({ agent: "Cyborg" });
    expect(board().cards[task.card!].agentStatus).toBeUndefined();
    await finishMissionCard("sitter", plan, "Tests");
    expect(column("Done")?.cardIds).toEqual([task.card]);
  });

  it("moves a card for the Manager, its GitHub issue following like any move", async () => {
    const [task] = addTaskCards<QueuedTask>("sitter", [{ title: "Lint", brief: "Run the lint", budgetMin: 5 }]);
    await moveMissionCard("sitter", task.card!, "backlog");
    expect(column("Backlog")?.cardIds).toContain(task.card);
    expect(moveCardWithGithub).toHaveBeenLastCalledWith("k2", task.card, "backlog", undefined, undefined);
  });

  it("leaves tasks without cards when the mission has no board", () => {
    const tasks = [{ title: "X", brief: "b", budgetMin: 5 }];
    expect(addTaskCards("chef", tasks)).toEqual(tasks);
  });
});
