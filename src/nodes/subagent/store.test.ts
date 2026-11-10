import { describe, expect, it } from "vitest";
import { createSubagentsStore, entryOfElement, MAX_LINES } from "./store";
import { parentLabel, subagentTitle } from "./title";

const info = { nodeId: "n1", agentId: "a1", agentType: "Explore", state: "running" as const };

describe("subagent nodes store", () => {
  it("merges what the backend sends of a subagent, keeping what a later event leaves out", () => {
    const store = createSubagentsStore();
    store.getState().upsert(info);
    store.getState().upsert({ ...info, description: "Find the hooks" });
    store.getState().append("a1", [{ kind: "text", text: "hi" }]);
    store.getState().upsert({ ...info, state: "done" });
    expect(store.getState().agents.a1).toMatchObject({ description: "Find the hooks", state: "done", lines: [{ kind: "text", text: "hi" }] });
  });

  it("keeps the newest lines only, and ignores lines of an unknown subagent", () => {
    const store = createSubagentsStore();
    store.getState().upsert(info);
    const many = Array.from({ length: MAX_LINES + 5 }, (_, i) => ({ kind: "text" as const, text: String(i) }));
    store.getState().append("a1", many);
    expect(store.getState().agents.a1.lines).toHaveLength(MAX_LINES);
    const kept = store.getState().agents.a1.lines;
    expect(kept[kept.length - 1].text).toBe(String(MAX_LINES + 4));
    store.getState().append("ghost", many);
    expect(store.getState().agents.ghost).toBeUndefined();
  });

  it("finds a node's subagent by its element, and forgets a session's subagents with their dismissals", () => {
    const store = createSubagentsStore();
    store.getState().upsert(info);
    store.getState().upsert({ ...info, agentId: "a2", parentAgentId: "a1" });
    store.getState().upsert({ ...info, nodeId: "n2", agentId: "b1" });
    store.getState().setElement("a1", "el-1");
    store.getState().dismiss("a2");
    expect(entryOfElement(store.getState().agents, "el-1")?.agentId).toBe("a1");
    expect(store.getState().forgetNode("n1").map((e) => e.agentId).sort()).toEqual(["a1", "a2"]);
    expect(Object.keys(store.getState().agents)).toEqual(["b1"]);
    expect(store.getState().dismissed).toEqual({});
    expect(store.getState().forgetNode("n1")).toEqual([]);
  });
});

describe("subagentTitle", () => {
  it("shows its type and what it was asked: the description first, else the prompt's first line", () => {
    expect(subagentTitle({ agentType: "Explore", description: "Find hooks", prompt: "long prompt" })).toBe("Explore · Find hooks");
    expect(subagentTitle({ agentType: "Plan", prompt: "Plan the work\nin detail" })).toBe("Plan · Plan the work");
    expect(subagentTitle({ agentType: "" })).toBe("subagent");
  });

  it("names its parent: the subagent that spawned it, else its terminal", () => {
    expect(parentLabel({ agentType: "general-purpose" }, "Aquaman", "terminal")).toBe("general-purpose");
    expect(parentLabel(undefined, "Aquaman", "terminal")).toBe("Aquaman");
    expect(parentLabel(undefined, "", "terminal")).toBe("terminal");
  });
});
