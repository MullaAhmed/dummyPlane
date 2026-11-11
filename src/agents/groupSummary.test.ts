import { describe, expect, it } from "vitest";
import type { AgentState } from "./agentState";
import { agentsText, countsText, groupsText, livingAgents, membersIn, waitingText } from "./groupSummary";

describe("countsText", () => {
  it("shows the members and those at work", () => {
    expect(countsText(4, 2)).toBe("4 · 2 working");
  });

  it("says idle when nobody works", () => {
    expect(countsText(3, 0)).toBe("3 · idle");
    expect(countsText(0, 0)).toBe("0 · idle");
  });
});

describe("livingAgents", () => {
  it("names the members still running, in group order", () => {
    const names: Record<string, string> = { a: "Batman", b: "Superman", c: "Aquaman" };
    expect(livingAgents(["a", "b", "c"], (id) => names[id], (id) => id !== "b")).toEqual(["Batman", "Aquaman"]);
  });
});

describe("waitingText", () => {
  it("adds the members waiting for an answer, in amber", () => {
    expect(waitingText(1)).toBe("· 1 waiting");
    expect(waitingText(3)).toBe("· 3 waiting");
    expect(waitingText(0)).toBeNull();
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
  });
});
