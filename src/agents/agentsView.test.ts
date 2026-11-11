import { describe, expect, it } from "vitest";
import type { SceneFrame } from "@/canvas/groups";
import { filterCounts, PANEL_FILTERS, panelSections, panelStateOf, type PanelAgent } from "./agentsView";

const agent = (id: string, state: PanelAgent["state"]): PanelAgent => ({ id, name: id, agent: "claude", state, since: 0 });
const frame = (id: string, memberIds: string[], role: "backend" | "docs" | null = "backend"): SceneFrame => ({
  id,
  name: id.toUpperCase(),
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  group: role ? { role, pantheon: "greek" } : null,
  memberIds,
});

describe("panelStateOf", () => {
  it("takes the activity of a running agent, active (like its pill) while unknown", () => {
    expect(panelStateOf({ state: "running" }, { activity: "waiting", since: 1 })).toBe("waiting");
    expect(panelStateOf({ state: "running" }, { activity: "idle", since: 1 })).toBe("idle");
    expect(panelStateOf({ state: "running" })).toBe("active");
  });

  it("calls an agent that starts active: it has no filter of its own", () => {
    expect(panelStateOf({ state: "starting" })).toBe("active");
  });

  it("rests a running agent whose activity is unknown but whose report stands, as its pill does; at work, it works", () => {
    expect(panelStateOf({ state: "running" }, undefined, "done")).toBe("idle");
    expect(panelStateOf({ state: "running" }, undefined, "blocked")).toBe("idle");
    expect(panelStateOf({ state: "running" }, { activity: "working", since: 1 }, "done")).toBe("working");
    expect(panelStateOf({ state: "running" }, { activity: "waiting", since: 1 }, "done")).toBe("waiting");
  });

  it("calls every other process state stopped", () => {
    expect(panelStateOf({ state: "stopped" }, { activity: "working", since: 1 })).toBe("stopped");
    expect(panelStateOf({ state: "exited", code: 0 })).toBe("stopped");
    expect(panelStateOf({ state: "error", message: "x" })).toBe("stopped");
    expect(panelStateOf({ state: "stopped" }, undefined, "done")).toBe("stopped");
  });

  it("stops an agent that exited (its shell runs on, busy or not), as its pill says Agent exited", () => {
    expect(panelStateOf({ state: "running" }, { activity: "working", since: 1, left: true })).toBe("stopped");
    expect(panelStateOf({ state: "running" }, { activity: "idle", since: 1, left: true })).toBe("stopped");
  });

  it("never puts a plain shell at work nor waiting: it is active while it runs", () => {
    expect(panelStateOf({ state: "running" }, { activity: "working", since: 1 }, undefined, false)).toBe("active");
    expect(panelStateOf({ state: "running" }, { activity: "idle", since: 1 }, undefined, false)).toBe("idle");
    expect(panelStateOf({ state: "stopped" }, undefined, undefined, false)).toBe("stopped");
  });
});

it("has exactly four filters: All, Waiting, Working, Done", () => {
  expect(PANEL_FILTERS.map((f) => f.id)).toEqual(["all", "waiting", "working", "done"]);
  expect(PANEL_FILTERS.map((f) => f.label)).toEqual(["All", "Waiting", "Working", "Done"]);
});

describe("panelSections", () => {
  const agents = [agent("a", "working"), agent("b", "idle"), agent("c", "waiting"), agent("d", "stopped")];
  const frames = [frame("g1", ["a", "b"]), frame("plain", ["c"], null), frame("g2", ["d"], "docs")];

  it("heads each section with its members and those at work, whatever the filter (as the group's canvas label)", () => {
    const team = [agent("a", "working"), agent("b", "working"), agent("c", "waiting"), agent("d", "idle")];
    const [section] = panelSections(team, [frame("g1", ["a", "b", "c", "d"])], "waiting");
    expect(section.agents.map((a) => a.id)).toEqual(["c"]);
    expect([section.members, section.working]).toEqual([4, 2]);
  });

  it("lists each group in scene order, then the agents outside groups", () => {
    const sections = panelSections(agents, frames, "all");
    expect(sections.map((s) => [s.id, s.name, s.agents.map((a) => a.id)])).toEqual([
      ["g1", "G1", ["a", "b"]],
      ["g2", "G2", ["d"]],
      [null, "No group", ["c"]],
    ]);
    expect(sections[0].color).toBe("#AA88D2");
    expect(sections[2].color).toBeNull();
  });

  it("keeps only the agents of the filter and drops empty sections", () => {
    expect(panelSections(agents, frames, "working").map((s) => [s.id, s.agents.map((a) => a.id)])).toEqual([["g1", ["a"]]]);
    expect(panelSections(agents, frames, "waiting").map((s) => s.id)).toEqual([null]);
  });

  it("shows under Done the agents that rest or ended, and the active ones under All alone", () => {
    expect(panelSections(agents, frames, "done").map((s) => [s.id, s.agents.map((a) => a.id)])).toEqual([
      ["g1", ["b"]],
      ["g2", ["d"]],
    ]);
    const unknown = [agent("e", "active")];
    expect(panelSections(unknown, [], "done")).toEqual([]);
    expect(panelSections(unknown, [], "working")).toEqual([]);
    expect(panelSections(unknown, [], "all")[0].agents.map((a) => a.id)).toEqual(["e"]);
  });
});

describe("filterCounts", () => {
  it("counts the agents of each filter: Done is every agent that rests or ended", () => {
    expect(filterCounts([agent("a", "working"), agent("b", "working"), agent("c", "stopped")])).toEqual({ all: 3, waiting: 0, working: 2, done: 1 });
    expect(
      filterCounts([agent("a", "idle"), agent("b", "stopped"), agent("c", "waiting"), agent("d", "active"), agent("e", "working"), agent("f", "idle")]),
    ).toEqual({ all: 6, waiting: 1, working: 1, done: 3 });
  });

  it("counts nobody under the filters when nobody runs, an agent of unknown activity under All alone", () => {
    expect(filterCounts([])).toEqual({ all: 0, waiting: 0, working: 0, done: 0 });
    expect(filterCounts([agent("a", "active")])).toEqual({ all: 1, waiting: 0, working: 0, done: 0 });
  });
});
