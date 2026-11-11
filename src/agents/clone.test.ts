import { describe, expect, it } from "vitest";
import type { TerminalPayload } from "@/nodes/types";
import { cloneTerminalPayload } from "./clone";

const claude: TerminalPayload = {
  title: "Claude · api",
  name: "Batman",
  agent: "claude",
  cwd: "C:/api",
  shell: "cmd",
  command: "",
  claudeSessionId: "s1",
};

describe("cloneTerminalPayload", () => {
  it("keeps agent, folder and shell; gives a new name and a new conversation", () => {
    const copy = cloneTerminalPayload(claude, "Superman");
    expect(copy).toMatchObject({ title: "Claude · api", agent: "claude", cwd: "C:/api", shell: "cmd", name: "Superman" });
    expect(copy.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(copy.claudeSessionId).not.toBe("s1");
  });

  it("gives no conversation to other agents", () => {
    const copy = cloneTerminalPayload({ ...claude, agent: "codex", claudeSessionId: undefined }, "Aquaman");
    expect(copy.claudeSessionId).toBeUndefined();
  });
});

it("leaves the source's steps behind: they belong to its conversation (final review H1)", () => {
  const copy = cloneTerminalPayload({ ...claude, steps: [{ title: "Plan", state: "en_cours" }] }, "Superman");
  expect(copy.steps).toBeUndefined();
});

it("leaves the router's model and Remote Control behind: they were the source's", () => {
  const copy = cloneTerminalPayload({ ...claude, model: "claude-haiku-5-5", remoteControl: true }, "Superman");
  expect(copy.model).toBeUndefined();
  expect(copy.remoteControl).toBeUndefined();
});

it("copies a one-shot terminal as a plain shell: an install never runs again unasked (review)", () => {
  const install: TerminalPayload = { ...claude, agent: "custom", command: "irm https://x | iex", oneShot: true, claudeSessionId: undefined };
  const copy = cloneTerminalPayload(install, "Superman");
  expect(copy).toMatchObject({ agent: "shell", command: "", cwd: "C:/api", shell: "cmd" });
  expect(copy.oneShot).toBeUndefined();
});

it("leaves a mission's permissions to its own agents: a copy asks as usual (review)", () => {
  const copy = cloneTerminalPayload({ ...claude, permission: "work" }, "Superman");
  expect(copy.permission).toBeUndefined();
});

it("starts a minimized terminal's copy open, with no report of its own", () => {
  const copy = cloneTerminalPayload({ ...claude, minimized: true, expandedHeight: 520, lastReport: { status: "done", summary: "Shipped" } }, "Superman");
  expect(copy.minimized).toBeUndefined();
  expect(copy.expandedHeight).toBeUndefined();
  expect(copy.lastReport).toBeUndefined();
});

it("leaves a sub-agent's spawner and task behind: a copy was asked nothing", () => {
  const copy = cloneTerminalPayload({ ...claude, spawnedBy: "batman", task: "Write the tests" }, "Superman");
  expect(copy.spawnedBy).toBeUndefined();
  expect(copy.task).toBeUndefined();
});
