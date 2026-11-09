// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
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
