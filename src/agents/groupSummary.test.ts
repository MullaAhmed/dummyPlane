import { describe, expect, it } from "vitest";
import type { AgentState } from "./agentState";
import { agentsText, countsText, groupsText, livingAgents, membersIn, summaryParts } from "./groupSummary";

const counts = (members: number, waiting: number, working: number, ready: number) => ({ members, waiting, working, ready });

describe("countsText", () => {
  it("shows the members and those at work", () => {
    expect(countsText(counts(4, 0, 2, 2))).toBe("4 · 2 working");
  });

  it("puts who waits for the user before who works: the most urgent state first", () => {
    expect(countsText(counts(3, 1, 0, 2))).toBe("3 · 1 waiting");
    expect(countsText(counts(4, 1, 2, 1))).toBe("4 · 1 waiting · 2 working");
  });

  it("says ready only when nobody waits or works: every member at rest, else how many", () => {
    expect(countsText(counts(3, 0, 0, 3))).toBe("3 · ready");
    expect(countsText(counts(3, 0, 0, 2))).toBe("3 · 2 ready");
    // Nobody at rest: every member exited, or none is an agent: the count says no state it cannot back.
    expect(countsText(counts(3, 0, 0, 0))).toBe("3");
    expect(countsText(counts(0, 0, 0, 0))).toBe("0");
  });

  it("never says idle, the internal word", () => {
    for (const c of [counts(3, 0, 0, 3), counts(3, 1, 1, 1), counts(2, 0, 0, 0)]) expect(countsText(c)).not.toMatch(/idle/i);
  });
});

describe("summaryParts", () => {
  it("marks the waiting part, which the label draws in the wait tone", () => {
    expect(summaryParts(counts(4, 1, 2, 1))).toEqual([{ text: "4" }, { text: "1 waiting", waiting: true }, { text: "2 working" }]);
  });
});

describe("livingAgents", () => {
  it("names the members still running, in group order", () => {
    const names: Record<string, string> = { a: "Batman", b: "Superman", c: "Aquaman" };
    expect(livingAgents(["a", "b", "c"], (id) => names[id], (id) => id !== "b")).toEqual(["Batman", "Aquaman"]);
  });
});

describe("agentsText / groupsText", () => {
  it("counts with the singular", () => {
    expect(agentsText(1)).toBe("1 agent");
    expect(agentsText(8)).toBe("8 agents");
    expect(groupsText(0)).toBe("0 groups");
    expect(groupsText(2)).toBe("2 groups");
  });
});

describe("membersIn", () => {
  it("counts the members in the state, read as every count reads them", () => {
    // b stopped, d's agent exited, e is a plain shell (null): none of them is at work.
    const states: Record<string, AgentState | null> = { a: "working", b: "stopped", c: "waiting", d: "left", e: null };
    expect(membersIn(["a", "b", "c", "d", "e"], "working", (id) => states[id])).toBe(1);
    expect(membersIn(["a", "b", "c", "d", "e"], "waiting", (id) => states[id])).toBe(1);
    // Several states at once (the "ready" of a label counts a turn over and a report in).
    const rest: Record<string, AgentState | null> = { a: "ready", b: "done", c: "working", d: "stopped", e: null };
    expect(membersIn(["a", "b", "c", "d", "e"], ["ready", "done"], (id) => rest[id])).toBe(2);
  });
});
