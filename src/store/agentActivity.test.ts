import { beforeEach, describe, expect, it } from "vitest";
import { agentActivityStore } from "./agentActivity";

const state = () => agentActivityStore.getState();

it("keeps the message of a wait, from a change and from Rust's state", () => {
  state().apply({ nodeId: "m", activity: "waiting", since: 1, message: "May I?" });
  expect(state().activities.m.message).toBe("May I?");
  state().apply({ nodeId: "m", activity: "working", since: 2 });
  expect(state().activities.m.message).toBeUndefined();
  state().load([{ nodeId: "n", activity: "waiting", since: 1, message: "Still?" }]);
  expect(state().activities.n.message).toBe("Still?");
});

beforeEach(() => state().load([]));

describe("agent activity store", () => {
  it("applies each change from Rust", () => {
    state().apply({ nodeId: "a", activity: "working", since: 10 });
    state().apply({ nodeId: "a", activity: "waiting", since: 20 });
    expect(state().activities).toEqual({ a: { activity: "waiting", since: 20 } });
  });

  it("starts again from Rust's snapshot after a reload, dropping what it no longer runs", () => {
    state().apply({ nodeId: "gone", activity: "working", since: 1 });
    state().load([{ nodeId: "a", activity: "working", since: 5 }]);
    expect(state().activities).toEqual({ a: { activity: "working", since: 5 } });
  });

  it("drops an event older than the one it holds, and keeps a live event over an older snapshot", () => {
    state().apply({ nodeId: "a", activity: "waiting", since: 20 });
    state().apply({ nodeId: "a", activity: "working", since: 10 });
    expect(state().activities.a).toEqual({ activity: "waiting", since: 20 });
    state().load([{ nodeId: "a", activity: "working", since: 15 }]);
    expect(state().activities.a).toEqual({ activity: "waiting", since: 20 });
  });

  it("takes a new question during a wait even dated 1 ms earlier, and the agent keeps its place", () => {
    state().apply({ nodeId: "q", activity: "waiting", since: 20, message: "First?" });
    state().apply({ nodeId: "q", activity: "waiting", since: 19, message: "Second?" });
    expect(state().activities.q).toEqual({ activity: "waiting", since: 20, message: "Second?" });
    state().apply({ nodeId: "q", activity: "waiting", since: 21 });
    expect(state().activities.q).toEqual({ activity: "waiting", since: 20 });
  });

  it("does not take a later wait for the same one: an older event stays dropped", () => {
    state().apply({ nodeId: "w", activity: "waiting", since: 100 });
    state().apply({ nodeId: "w", activity: "waiting", since: 300, message: "Next?" });
    expect(state().activities.w).toEqual({ activity: "waiting", since: 300, message: "Next?" });
    state().apply({ nodeId: "w", activity: "working", since: 200 });
    expect(state().activities.w.activity).toBe("waiting");
  });

  it("takes the agent leaving its shell, then coming back, with no change of activity", () => {
    // Rust dates each flip anew (`flipped`): an idle Claude quit with Ctrl+D stays idle.
    state().apply({ nodeId: "l", activity: "idle", since: 100 });
    state().apply({ nodeId: "l", activity: "idle", since: 200, left: true });
    expect(state().activities.l).toEqual({ activity: "idle", since: 200, left: true });
    state().apply({ nodeId: "l", activity: "idle", since: 300 });
    expect(state().activities.l.left).toBeUndefined();
    // Its snapshot after a reload keeps it.
    state().load([{ nodeId: "l", activity: "working", since: 400, left: true }]);
    expect(state().activities.l.left).toBe(true);
  });

  it("forgets a terminal whose process exited", () => {
    state().apply({ nodeId: "a", activity: "idle", since: 1 });
    state().remove("a");
    expect(state().activities).toEqual({});
  });
});

describe("an agent a dialog holds (hold)", () => {
  const waiting = { activity: "waiting" as const, since: 100, message: "New MCP server found in this project: supabase" };

  it("waits whatever Rust reads of its output meanwhile, then shows Rust's latest once it lets go", () => {
    state().apply({ nodeId: "a", activity: "idle", since: 1 });
    state().hold("a", waiting);
    // Before Claude's first hook, its output alone says working or idle.
    state().apply({ nodeId: "a", activity: "working", since: 150 });
    state().apply({ nodeId: "a", activity: "idle", since: 160 });
    expect(state().activities.a).toEqual(waiting);
    // Another dialog in a row keeps its place.
    state().hold("a", { ...waiting, since: 200, message: "Select login method:" });
    expect(state().activities.a).toEqual({ ...waiting, message: "Select login method:" });
    state().hold("a", null);
    expect(state().activities.a).toEqual({ activity: "idle", since: 160 });
    expect(state().under).toEqual({});
    // Letting go twice changes nothing.
    state().hold("a", null);
    expect(state().activities.a).toEqual({ activity: "idle", since: 160 });
  });

  it("lets go of one Rust knew nothing of, of one whose terminal is gone, and across a reload's snapshot", () => {
    state().hold("b", waiting);
    state().hold("b", null);
    expect(state().activities).toEqual({});
    state().hold("c", waiting);
    state().remove("c");
    expect(state().activities).toEqual({});
    expect(state().under).toEqual({});
    state().hold("d", waiting);
    state().load([{ nodeId: "d", activity: "idle", since: 50 }]);
    expect(state().activities.d).toEqual(waiting);
    state().hold("d", null);
    expect(state().activities.d).toEqual({ activity: "idle", since: 50 });
  });
});
