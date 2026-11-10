// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { recentStore, rememberFunction } from "./recent";

beforeEach(() => {
  recentStore.setState({ ids: [] });
  localStorage.clear();
});

it("keeps the last three functions run, most recent first, each once, across restarts (retours J8b)", () => {
  for (const id of ["canvas.fit", "workspace.new", "canvas.fit", "terminal.rename", "agent.console"]) rememberFunction(id);
  expect(recentStore.getState().ids).toEqual(["agent.console", "terminal.rename", "canvas.fit"]);
  expect(JSON.parse(localStorage.getItem("dummyplane.recentFunctions")!)).toEqual(["agent.console", "terminal.rename", "canvas.fit"]);
});

it("never remembers the palette's own commands", () => {
  rememberFunction("palette.goTo");
  rememberFunction("palette.functions");
  expect(recentStore.getState().ids).toEqual([]);
});

it("reads a stored id that is a name of every object as itself, not as what an object has under it", async () => {
  localStorage.setItem("dummyplane.recentFunctions", JSON.stringify(["constructor", "toString", "__proto__"]));
  vi.resetModules();
  const fresh = await import("./recent");
  expect(fresh.recentStore.getState().ids).toEqual(["constructor", "toString", "__proto__"]);
  fresh.rememberFunction("canvas.fit");
  expect(JSON.parse(localStorage.getItem("dummyplane.recentFunctions")!)).toEqual(["canvas.fit", "constructor", "toString"]);
});

it("reads the ids a list saved before the fleet was renamed holds as their new ids, each once", async () => {
  // What an older build saved: the fleet's commands were called orchestrator's.
  localStorage.setItem("dummyplane.recentFunctions", JSON.stringify(["orchestrator.write", "canvas.fit", "group.orchestrate", "orchestrator.write"]));
  vi.resetModules();
  const fresh = await import("./recent");
  expect(fresh.recentStore.getState().ids).toEqual(["fleet.write", "canvas.fit", "group.linkFleet"]);
  fresh.rememberFunction("agent.fleet");
  expect(JSON.parse(localStorage.getItem("dummyplane.recentFunctions")!)).toEqual(["agent.fleet", "fleet.write", "canvas.fit"]);
});
