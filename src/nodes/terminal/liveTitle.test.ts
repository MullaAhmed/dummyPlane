import { afterEach, expect, it } from "vitest";
import { terminalStatusStore } from "@/store/terminalStatus";
import { forgetLiveTitle, liveTitleOf, setLiveTitle } from "./liveTitle";

afterEach(() => {
  forgetLiveTitle("t1");
  terminalStatusStore.setState({ statuses: {} });
});

it("keeps the title a running program sets, trimmed, and clears it when the program sets none", () => {
  terminalStatusStore.getState().set("t1", { state: "running" });
  setLiveTitle("t1", "  ✳ Fix the login ");
  expect(liveTitleOf("t1")).toBe("✳ Fix the login");
  setLiveTitle("t1", "");
  expect(liveTitleOf("t1")).toBeUndefined();
});

it("ignores a title while nothing runs: it comes from a stopped terminal's restored screen", () => {
  setLiveTitle("t1", "Claude Code");
  expect(liveTitleOf("t1")).toBeUndefined();
});

it("forgets the title once the process stops: it is no longer what the terminal shows", () => {
  terminalStatusStore.getState().set("t1", { state: "running" });
  setLiveTitle("t1", "Claude Code");
  terminalStatusStore.getState().set("t1", { state: "exited", code: 0 });
  expect(liveTitleOf("t1")).toBeUndefined();
});
