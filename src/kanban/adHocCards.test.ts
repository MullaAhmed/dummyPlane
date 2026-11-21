// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { readMission, type Mission } from "@/mission/mission";
import { missionOf } from "@/mission/store";
import { report } from "@/mcp/agentTools";
import type { KanbanPayload, TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { adHocReported, cardAdHocAgent } from "./adHocCards";

vi.mock("@excalidraw/excalidraw", () => ({ newElementWith: (e: object, fields: object) => ({ ...e, ...fields }) }));
// What a report does to a terminal's card and canvas is not under test here.
vi.mock("@/nodes/terminal/minimize", () => ({ onAgentReported: vi.fn() }));
vi.mock("@/mission/events", () => ({ notify: vi.fn() }));

const terminal = (name: string, extra: Partial<TerminalPayload> = {}): TerminalPayload => ({ title: name, name, agent: "claude", cwd: "C:/code/wt", shell: "pwsh", command: "", ...extra });

const board = (titles: string[] = ["To do", "In progress", "Done"]): KanbanPayload => ({
  columns: titles.map((title, i) => ({ id: `c${i}`, title, cardIds: i === 0 ? ["plan"] : [] })),
  cards: { plan: { id: "plan", title: "A planned task", notes: "", priority: "none" } },
});

const mission = (extra: Partial<Mission> = {}): Mission => ({ state: "en_cours", maxAgents: 4, members: [], name: "Auth", board: "board", manager: "boss", ...extra });

async function world(missionExtra: Partial<Mission> | null = {}, boardTitles?: string[]) {
  await nodesStore.getState().create("fleet", { workspaceId: "w1", kind: "fleet", payload: { name: "Fleet", session: terminal("Fleet", { role: "orchestrator" }), ...(missionExtra ? { mission: mission(missionExtra) } : {}) } });
  await nodesStore.getState().create("board", { workspaceId: "w1", kind: "kanban", payload: board(boardTitles) });
  await nodesStore.getState().create("boss", { workspaceId: "w1", kind: "terminal", payload: terminal("Manager", { role: "manager", fleet: "fleet", spawnedBy: "fleet" }) });
  await nodesStore.getState().create("thor", { workspaceId: "w1", kind: "terminal", payload: terminal("Thor", { spawnedBy: "boss" }) });
  await nodesStore.getState().create("loose", { workspaceId: "w1", kind: "terminal", payload: terminal("Loose") });
}

const kanban = (id = "board") => {
  const record = nodesStore.getState().nodes[id];
  return record?.kind === "kanban" ? record.payload : (undefined as never);
};
const columnTitleOf = (cardId: string, id = "board") => kanban(id).columns.find((c) => c.cardIds.includes(cardId))?.title;
const cardsOf = (id = "board") => Object.values(kanban(id).cards);
const adHocCards = () => missionOf(nodesStore.getState().nodes.fleet)?.adHoc ?? [];

/** `nodeId`, opened by `parentId` with spawn_agent, as spawn.ts hands it over. */
async function spawned(parentId: string, nodeId: string, name = nodeId, task = "Look up the router") {
  await nodesStore.getState().create(nodeId, { workspaceId: "w1", kind: "terminal", payload: terminal(name, { spawnedBy: parentId, task }) });
  cardAdHocAgent(parentId, { nodeId, name, title: `Title of ${name}`, task });
}

beforeEach(() => {
  mockIPC(() => undefined);
  vi.clearAllMocks();
  nodesStore.getState().forgetWorkspace("w1");
  nodesStore.setState({ nodes: {} });
});

describe("the card of an agent a Fleet opens beside its running mission", () => {
  it("goes up in the In progress column of the mission's board, titled by the task, its agent the chip, its notes saying it is ad hoc", async () => {
    await world();
    await spawned("fleet", "robin", "Robin", "Look up the\nrouter");
    const card = cardsOf().find((c) => c.title === "Title of Robin")!;
    expect(card).toBeDefined();
    expect(columnTitleOf(card.id)).toBe("In progress");
    expect(card.agent).toBe("Robin");
    expect(card.notes).toBe("Ad hoc, outside the plan: opened by Fleet with spawn_agent. Look up the router");
    // The planned task's card is as it was.
    expect(columnTitleOf("plan")).toBe("To do");
    expect(adHocCards()).toEqual([{ nodeId: "robin", board: "board", card: card.id }]);
  });

  it("is made for every ad-hoc agent, one each, and for what descends from them while the mission runs", async () => {
    await world();
    await spawned("fleet", "robin");
    await spawned("fleet", "flash");
    await spawned("robin", "kid");
    await spawned("kid", "grandkid");
    expect(cardsOf().filter((c) => c.agent)).toHaveLength(4);
    expect(adHocCards().map((c) => c.nodeId)).toEqual(["robin", "flash", "kid", "grandkid"]);
  });

  it("makes the In progress column when the board has none, before the done column", async () => {
    await world({}, ["To do", "Done"]);
    await spawned("fleet", "robin");
    expect(kanban().columns.map((c) => c.title)).toEqual(["To do", "In progress", "Done"]);
    expect(columnTitleOf(adHocCards()[0].card)).toBe("In progress");
  });

  it("is made while the mission launches too", async () => {
    await world({ state: "lancement" });
    await spawned("fleet", "robin");
    expect(adHocCards()).toHaveLength(1);
  });

  it("is never made when no mission runs: planning, finished, a Fleet with no mission", async () => {
    for (const state of ["redaction", "plan", "terminee"] as const) {
      nodesStore.setState({ nodes: {} });
      await world({ state });
      await spawned("fleet", "robin");
      expect(cardsOf()).toHaveLength(1);
      expect(adHocCards()).toEqual([]);
    }
    nodesStore.setState({ nodes: {} });
    await world(null);
    await spawned("fleet", "robin");
    expect(cardsOf()).toHaveLength(1);
  });

  it("is never made for a mission's own Manager, its team, or what they open: the plan's, not beside it", async () => {
    await world();
    await spawned("boss", "robin");
    await spawned("thor", "kid");
    expect(cardsOf()).toHaveLength(1);
    expect(adHocCards()).toEqual([]);
  });

  it("is never made for an agent no Fleet is over", async () => {
    await world();
    await spawned("loose", "robin");
    expect(cardsOf()).toHaveLength(1);
  });

  it("is never made for an agent of the plan: a linked agent the mission names is a member", async () => {
    const member = { nodeId: "linked", name: "Linked", task: "t", budgetMin: 30, linked: true, branch: "b", worktree: "w" };
    await world({ members: [member] });
    await nodesStore.getState().create("linked", { workspaceId: "w1", kind: "terminal", payload: terminal("Linked", { spawnedBy: "fleet" }) });
    await spawned("linked", "kid");
    expect(cardsOf()).toHaveLength(1);
  });

  it("is never made on a board the mission does not run: the Fleet's other boards, or a mission with no board", async () => {
    await world({ board: undefined });
    // A board handed to the Fleet, though no mission's own.
    nodesStore.getState().update("board", { orchestrator: { nodeId: "fleet", columnId: "c0" } });
    await spawned("fleet", "robin");
    expect(cardsOf()).toHaveLength(1);
    expect(adHocCards()).toEqual([]);
    // The mission names a board that is no longer there.
    nodesStore.setState({ nodes: {} });
    await world({ board: "gone" });
    await spawned("fleet", "robin");
    expect(cardsOf()).toHaveLength(1);
    expect(adHocCards()).toEqual([]);
  });
});

describe("the card follows the agent's report", () => {
  it("goes to Done on done, the chip kept", async () => {
    await world();
    await spawned("fleet", "robin", "Robin");
    const card = adHocCards()[0].card;
    await adHocReported("robin", "termine");
    expect(columnTitleOf(card)).toBe("Done");
    expect(kanban().cards[card]).toMatchObject({ agent: "Robin" });
    expect(kanban().cards[card].agentStatus).toBeUndefined();
  });

  it("goes to the Blocked column on blocked or failed, made before the done column, the chip on alert; done again clears it", async () => {
    await world();
    await spawned("fleet", "robin", "Robin");
    await spawned("fleet", "flash", "Flash");
    const [robin, flash] = adHocCards().map((c) => c.card);
    await adHocReported("robin", "bloque");
    await adHocReported("flash", "echec");
    expect(kanban().columns.map((c) => c.title)).toEqual(["To do", "In progress", "Blocked", "Done"]);
    expect(columnTitleOf(robin)).toBe("Blocked");
    expect(columnTitleOf(flash)).toBe("Blocked");
    expect(kanban().cards[robin].agentStatus).toBe("blocked");
    expect(kanban().cards[flash].agentStatus).toBe("failed");
    await adHocReported("robin", "termine");
    expect(columnTitleOf(robin)).toBe("Done");
    expect(kanban().cards[robin].agentStatus).toBeUndefined();
  });

  it("moves nothing for an agent that has no card: a member, an agent the Fleet is not over, a card the user took off", async () => {
    await world();
    await spawned("fleet", "robin", "Robin");
    const before = kanban();
    await adHocReported("thor", "termine");
    await adHocReported("loose", "bloque");
    expect(kanban()).toBe(before);
    // The user took the card off the board: it is not made again.
    nodesStore.getState().update("board", { cards: {}, columns: before.columns.map((c) => ({ ...c, cardIds: [] })) });
    await adHocReported("robin", "termine");
    expect(Object.keys(kanban().cards)).toEqual([]);
  });

  it("is moved by the agent's own report tool call, whoever hears it", async () => {
    await world();
    await spawned("fleet", "robin", "Robin");
    const card = adHocCards()[0].card;
    report("robin", { statut: "bloque", resume: "Needs the API key" });
    await vi.waitFor(() => expect(columnTitleOf(card)).toBe("Blocked"));
    report("robin", { statut: "termine", resume: "Done with the key" });
    await vi.waitFor(() => expect(columnTitleOf(card)).toBe("Done"));
    // A report the tool refuses moves nothing.
    report("robin", { statut: "unknown", resume: "?" });
    expect(columnTitleOf(card)).toBe("Done");
  });

  it("is found again after a restart: the mission is read back from its JSON, and the report moves the card", async () => {
    await world();
    await spawned("fleet", "robin", "Robin");
    const card = adHocCards()[0].card;
    const saved = readMission(JSON.parse(JSON.stringify(missionOf(nodesStore.getState().nodes.fleet))));
    expect(saved?.adHoc).toEqual([{ nodeId: "robin", board: "board", card }]);
    nodesStore.getState().update("fleet", { mission: { ...saved!, adHoc: saved!.adHoc } });
    await adHocReported("robin", "termine");
    expect(columnTitleOf(card)).toBe("Done");
  });

  it("is not made nor moved by a mission read from a damaged save", () => {
    const saved = readMission({ state: "en_cours", maxAgents: 4, members: [], adHoc: [{ nodeId: "a", board: "b", card: "c" }, { nodeId: 3 }, "x", null] });
    expect(saved?.adHoc).toEqual([{ nodeId: "a", board: "b", card: "c" }]);
    expect(readMission({ state: "en_cours", maxAgents: 4, members: [], adHoc: "no" })).not.toHaveProperty("adHoc");
  });
});
