import { describe, expect, it } from "vitest";
import { readKanbanPayload, type KanbanPayload } from "@/nodes/types";
import {
  blockedColumn,
  boardView,
  doneTarget,
  flagCard,
  inProgressColumn,
  setCardAgent,
  linkedTo,
  linkFleet,
  planRequest,
  startCard,
  todoColumnOf,
  withBlockedColumn,
  withInProgressColumn,
  withTaskCards,
  type RequestTexts,
} from "./missionLink";

const ids = () => {
  let n = 0;
  return () => `new${++n}`;
};

function board(): KanbanPayload {
  return {
    columns: [
      { id: "todo", title: "To do", cardIds: ["a", "b"] },
      { id: "done", title: "Done", cardIds: [] },
    ],
    cards: {
      a: { id: "a", title: "Login", notes: "OAuth\nGitHub", priority: "high", due: "2026-11-02", github: { repo: "me/app", number: 12, url: "u", state: "open" } },
      b: { id: "b", title: "Logout", notes: "", priority: "none" },
    },
  };
}

const texts: RequestTexts = {
  request: (column, count, cards) => `PLAN ${column} (${count}): ${cards}`,
  priorities: { low: "low", medium: "medium", high: "high" },
  due: (date) => `due ${date}`,
  issue: (number, repo) => `#${number} ${repo}`,
};

describe("linkFleet", () => {
  it("remembers the column and its fleet", () => {
    const linked = linkFleet(board(), "orc", "todo");
    expect(linked.orchestrator).toEqual({ nodeId: "orc", columnId: "todo" });
    expect(linkedTo(linked, "orc")).toBe(true);
    expect(linkedTo(linked, "other")).toBe(false);
  });

  it("ignores an unknown column", () => {
    const b = board();
    expect(linkFleet(b, "orc", "nope")).toBe(b);
  });

  it("survives a save, and a broken link is dropped", () => {
    const saved = JSON.parse(JSON.stringify(linkFleet(board(), "orc", "todo")));
    expect(readKanbanPayload(saved).orchestrator).toEqual({ nodeId: "orc", columnId: "todo" });
    expect(readKanbanPayload({ ...saved, orchestrator: { nodeId: 3 } }).orchestrator).toBeUndefined();
    expect(readKanbanPayload({ ...saved, orchestrator: "orc" }).orchestrator).toBeUndefined();
  });

  it("reads a card's agent chip", () => {
    const raw = JSON.parse(JSON.stringify(board()));
    raw.cards.a.agent = "Hawkgirl";
    raw.cards.b.agent = 4;
    const read = readKanbanPayload(raw);
    expect(read.cards.a.agent).toBe("Hawkgirl");
    expect(read.cards.b.agent).toBeUndefined();
  });

  it("reads a chip's alert, never without an agent", () => {
    const raw = JSON.parse(JSON.stringify(board()));
    raw.cards.a = { ...raw.cards.a, agent: "Hawkgirl", agentStatus: "blocked" };
    raw.cards.b = { ...raw.cards.b, agentStatus: "failed" };
    const read = readKanbanPayload(raw);
    expect(read.cards.a.agentStatus).toBe("blocked");
    expect(read.cards.b.agentStatus).toBeUndefined();
    raw.cards.a.agentStatus = "weird";
    expect(readKanbanPayload(raw).cards.a.agentStatus).toBeUndefined();
  });
});

describe("planRequest", () => {
  it("lists the column's cards on one line, with their details", () => {
    const text = planRequest(board(), "todo", texts)!;
    expect(text).not.toMatch(/\n/);
    expect(text).toBe("PLAN To do (2): 1) [a] Login — OAuth GitHub — high — due 2026-11-02 — #12 me/app | 2) [b] Logout");
  });

  it("cuts long notes", () => {
    const b = board();
    b.cards.b.notes = "x".repeat(1000);
    expect(planRequest(b, "todo", texts)!.length).toBeLessThan(500);
  });

  it("is null for an empty or unknown column", () => {
    expect(planRequest(board(), "done", texts)).toBeNull();
    expect(planRequest(board(), "nope", texts)).toBeNull();
  });
});

describe("startCard", () => {
  it("creates In progress before the done column and sets the agent chip", () => {
    const started = startCard(board(), "a", "Hawkgirl", "In progress", ids())!;
    expect(started.columnId).toBe("new1");
    expect(started.board.columns.map((c) => c.title)).toEqual(["To do", "In progress", "Done"]);
    expect(started.board.cards.a.agent).toBe("Hawkgirl");
    // The move is the caller's (GitHub follows it).
    expect(started.board.columns[0].cardIds).toContain("a");
  });

  it("reuses an existing in-progress column, whatever its case", () => {
    const b = board();
    b.columns.splice(1, 0, { id: "doing", title: "In Progress", cardIds: [] });
    expect(inProgressColumn(b)?.id).toBe("doing");
    expect(startCard(b, "a", "Hawkgirl", "In progress", ids())!.columnId).toBe("doing");
    expect(withInProgressColumn(b, "In progress").board).toBe(b);
  });

  it("is null for an unknown card", () => {
    expect(startCard(board(), "zzz", "Hawkgirl", "In progress")).toBeNull();
  });

  it("adds the column at the end of a board without columns", () => {
    const placed = withInProgressColumn({ columns: [], cards: {} }, "In progress", ids());
    expect(placed.board.columns).toEqual([{ id: "new1", title: "In progress", cardIds: [] }]);
  });
});

describe("the agent chip", () => {
  it("names the agent a sub-task went to, its alert cleared", () => {
    const flagged = flagCard(setCardAgent(board(), "a", "Hawkgirl"), "a", "failed");
    expect(flagged.cards.a).toMatchObject({ agent: "Hawkgirl", agentStatus: "failed" });
    const handed = setCardAgent(flagged, "a", "Cyborg");
    expect(handed.cards.a.agent).toBe("Cyborg");
    expect(handed.cards.a).not.toHaveProperty("agentStatus");
    expect(setCardAgent(board(), "zzz", "Cyborg").cards).toEqual(board().cards);
  });

  it("goes on alert for blocked or failed, the card staying in its column", () => {
    const started = startCard(board(), "a", "Hawkgirl", "In progress", ids())!.board;
    const blocked = flagCard(started, "a", "blocked");
    expect(blocked.cards.a.agentStatus).toBe("blocked");
    expect(blocked.columns).toBe(started.columns);
    expect(flagCard(blocked, "a", "blocked")).toBe(blocked);
    expect(flagCard(blocked, "a", "failed").cards.a.agentStatus).toBe("failed");
  });

  it("flags only a card with an agent", () => {
    const b = board();
    expect(flagCard(b, "a", "blocked")).toBe(b);
    expect(flagCard(b, "zzz", "blocked")).toBe(b);
  });

  it("is cleared when the card starts again", () => {
    const flagged = flagCard(setCardAgent(board(), "a", "Hawkgirl"), "a", "blocked");
    expect(startCard(flagged, "a", "Hawkgirl", "In progress", ids())!.board.cards.a).not.toHaveProperty("agentStatus");
  });
});

describe("doneTarget", () => {
  it("is the done column, until the card is in it", () => {
    const b = board();
    expect(doneTarget(b, "a")).toBe("done");
    b.columns[0].cardIds = ["b"];
    b.columns[1].cardIds = ["a"];
    expect(doneTarget(b, "a")).toBeNull();
    expect(doneTarget(b, "zzz")).toBeNull();
  });
});

describe("boardView", () => {
  it("gives columns and cards with their ids, the linked column marked", () => {
    const view = boardView("k1", linkFleet(board(), "orc", "todo"));
    expect(view.board).toBe("k1");
    expect(view.columns[0]).toMatchObject({ id: "todo", linked: true });
    expect(view.columns[1].linked).toBe(false);
    expect(view.columns[0].cards[0]).toEqual({
      id: "a",
      title: "Login",
      notes: "OAuth\nGitHub",
      priority: "high",
      due: "2026-11-02",
      github: { repo: "me/app", number: 12, url: "u", state: "open" },
      agent: null,
      agent_status: null,
    });
    expect(view.columns[0].cards[1].github).toBeNull();
  });
});

describe("a mission's cards on the board its Manager runs (spec babysitter Fleet)", () => {
  it("takes the column handed to the fleet as the to-do, else the first one", () => {
    expect(todoColumnOf(board(), "chef")?.id).toBe("todo");
    const handed = linkFleet(board(), "chef", "done");
    expect(todoColumnOf(handed, "chef")?.id).toBe("done");
    expect(todoColumnOf(handed, "other")?.id).toBe("todo");
    expect(todoColumnOf({ columns: [], cards: {} }, "chef")).toBeUndefined();
  });

  it("makes a card for each task without one, its brief as notes, in order, at the end of the to-do", () => {
    const tasks = [
      { title: "Login", brief: "already a card", card: "a" },
      { title: "API", brief: "Build the API\nthen test it" },
      { title: "Docs", brief: "Write the docs" },
    ];
    const { board: next, tasks: carded } = withTaskCards(board(), "todo", tasks, ids());
    expect(carded.map((t) => t.card)).toEqual(["a", "new1", "new2"]);
    expect(next.columns[0].cardIds).toEqual(["a", "b", "new1", "new2"]);
    expect(next.cards.new1).toEqual({ id: "new1", title: "API", notes: "Build the API then test it", priority: "none" });
    // Each task keeps its own fields.
    expect(carded[1]).toMatchObject({ title: "API", brief: "Build the API\nthen test it" });
  });

  it("makes a card again for a task whose card left the board, and nothing for an unknown column", () => {
    expect(withTaskCards(board(), "todo", [{ title: "Gone", brief: "b", card: "zz" }], ids()).tasks[0].card).toBe("new1");
    const same = board();
    expect(withTaskCards(same, "nope", [{ title: "X", brief: "b" }]).board).toBe(same);
  });

  it("puts a Blocked column before the done one, made once", () => {
    const placed = withBlockedColumn(board(), "Blocked", ids());
    expect(placed.board.columns.map((c) => c.title)).toEqual(["To do", "Blocked", "Done"]);
    expect(blockedColumn(placed.board)?.id).toBe(placed.columnId);
    expect(withBlockedColumn(placed.board, "Blocked", ids()).board).toBe(placed.board);
  });
});
