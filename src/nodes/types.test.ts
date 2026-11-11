import { describe, expect, it } from "vitest";
import { MAX_STORED_TASK, readFilePayload, readFleetPayload, readOutputPayload, readTerminalPayload } from "./types";

describe("readTerminalPayload", () => {
  it("reads a payload saved before agents and names existed", () => {
    expect(readTerminalPayload({ title: "Claude Code · api", cwd: "C:/api", preset: "claude", command: "", shell: "cmd", claudeSessionId: "s1" })).toEqual({
      title: "Claude Code · api",
      name: "",
      agent: "claude",
      cwd: "C:/api",
      shell: "cmd",
      command: "",
      claudeSessionId: "s1",
    });
  });

  it("keeps a current payload as it is", () => {
    const payload = {
      title: "Ollama · api",
      name: "Batman",
      agent: "ollama",
      cwd: "C:/api",
      shell: "powershell",
      command: "",
      ollama: { model: "llama3", mode: "code" },
    };
    expect(readTerminalPayload(payload)).toEqual(payload);
  });

  it("keeps the model router's switch only when it is on, so it survives a reload", () => {
    const batman = { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" };
    expect(readTerminalPayload({ ...batman, router: true })?.router).toBe(true);
    expect(readTerminalPayload({ ...batman, router: false })).toEqual(batman);
    expect(readTerminalPayload({ ...batman, router: "on" })).toEqual(batman);
    // Through the saved form too: what the canvas stores is what it reads back.
    expect(readTerminalPayload(JSON.parse(JSON.stringify({ ...batman, model: "claude-haiku-5-5", router: true })))).toEqual({ ...batman, model: "claude-haiku-5-5", router: true });
  });

  it("keeps an agent's message bar open only when it was opened", () => {
    const batman = { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" };
    expect(readTerminalPayload({ ...batman, inputOpen: true })?.inputOpen).toBe(true);
    expect(readTerminalPayload({ ...batman, inputOpen: false })).toEqual(batman);
    expect(readTerminalPayload({ ...batman, inputOpen: "yes" })).toEqual(batman);
  });

  it("keeps a sub-agent's task across a restart, its start only, and no empty one", () => {
    const robin = { title: "Tests", name: "Robin", agent: "claude", cwd: "C:/code", shell: "default", command: "", spawnedBy: "batman", task: "Write the tests" };
    expect(readTerminalPayload(robin)).toEqual(robin);
    expect(readTerminalPayload({ ...robin, task: "x".repeat(MAX_STORED_TASK + 50) })?.task).toHaveLength(MAX_STORED_TASK);
    expect(readTerminalPayload({ ...robin, task: "  " })?.task).toBeUndefined();
    expect(readTerminalPayload({ ...robin, task: 42 })?.task).toBeUndefined();
  });

  it("rejects what cannot be launched", () => {
    expect(readTerminalPayload(null)).toBeNull();
    expect(readTerminalPayload({ agent: "vim", cwd: "C:/" })).toBeNull();
    expect(readTerminalPayload({ agent: "shell" })).toBeNull();
    expect(readTerminalPayload({ agent: "shell", cwd: "C:/", shell: "zsh" })?.shell).toBe("default");
  });
});

describe("readFleetPayload", () => {
  it("keeps the given name and names the others Fleet", () => {
    expect(readFleetPayload({ name: "Chef" })).toEqual({ name: "Chef" });
    expect(readFleetPayload({ name: "  " })).toEqual({ name: "Fleet" });
    expect(readFleetPayload({})).toEqual({ name: "Fleet" });
    expect(readFleetPayload(null)).toEqual({ name: "Fleet" });
  });

  it("reads the former default names as Fleet, its session's too, and keeps a chosen one", () => {
    const session = { agent: "claude", cwd: "D:/p", name: "Orchestrator", title: "Orchestrator" };
    const read = readFleetPayload({ name: "Orchestrator", session });
    expect(read.name).toBe("Fleet");
    expect(read.session).toMatchObject({ name: "Fleet", title: "Fleet", role: "orchestrator" });
    expect(readFleetPayload({ name: "Orchestrateur" }).name).toBe("Fleet");
    expect(readFleetPayload({ name: "Orchestrator of Atlas" }).name).toBe("Orchestrator of Atlas");
  });

  it("keeps its message field open only when it was opened", () => {
    expect(readFleetPayload({ name: "Chef", inputOpen: true })).toEqual({ name: "Chef", inputOpen: true });
    expect(readFleetPayload({ name: "Chef", inputOpen: false })).toEqual({ name: "Chef" });
    expect(readFleetPayload({ name: "Chef", inputOpen: "yes" })).toEqual({ name: "Chef" });
  });
});

describe("a fleet's session", () => {
  const session = { title: "Chef", name: "Chef", agent: "claude", cwd: "C:/code", shell: "default", command: "", claudeSessionId: "s1", role: "orchestrator" };

  it("reads it back as the fleet's Claude session", () => {
    expect(readFleetPayload({ name: "Chef", session })).toEqual({ name: "Chef", session });
    expect(readTerminalPayload(session)?.role).toBe("orchestrator"); // The stored role, see STORED_FLEET_ROLE.
  });

  it("keeps the model the router chose", () => {
    expect(readTerminalPayload({ ...session, model: "claude-haiku-5-5" })?.model).toBe("claude-haiku-5-5");
    expect(readTerminalPayload({ ...session, model: 4 })?.model).toBeUndefined();
  });

  it("keeps an effort level Claude Code knows, and drops any other", () => {
    expect(readTerminalPayload({ ...session, effort: "xhigh" })?.effort).toBe("xhigh");
    expect(readTerminalPayload({ ...session, effort: "ultra; rm -rf /" })?.effort).toBeUndefined();
    expect(readTerminalPayload({ ...session, effort: 3 })?.effort).toBeUndefined();
  });

  it("still reads the stored title a saved canvas holds, though the edit panel no longer edits it", () => {
    expect(readTerminalPayload({ ...session, title: "Review of api" })?.title).toBe("Review of api");
  });

  it("keeps Remote Control on", () => {
    expect(readTerminalPayload({ ...session, remoteControl: true })?.remoteControl).toBe(true);
    expect(readTerminalPayload({ ...session, remoteControl: "oui" })?.remoteControl).toBeUndefined();
  });

  it("drops a session that is not Claude's or cannot launch", () => {
    expect(readFleetPayload({ name: "Chef", session: { ...session, agent: "shell" } })).toEqual({ name: "Chef" });
    expect(readFleetPayload({ name: "Chef", session: 3 })).toEqual({ name: "Chef" });
  });
});

it("keeps a fleet's night through a restart: it still waits for nobody, and still reads Linear", () => {
  const session = { title: "Fleet", name: "Fleet", agent: "claude", cwd: "C:/p", shell: "default", command: "", role: "orchestrator", permission: "edits", linear: true };
  expect(readFleetPayload({ name: "Fleet", session }).session).toMatchObject({ permission: "edits", linear: true });
  expect(readFleetPayload({ name: "Fleet", session: { ...session, linear: "yes" } }).session).not.toHaveProperty("linear");
});

it("reads a fleet's mission with it", () => {
  const mission = { state: "plan", maxAgents: 4, name: "Auth", members: [] };
  expect(readFleetPayload({ name: "Chef", mission })).toEqual({ name: "Chef", mission });
  expect(readFleetPayload({ name: "Chef", mission: { state: "?" } })).toEqual({ name: "Chef" });
});

describe("readFilePayload", () => {
  it("keeps a usable path", () => {
    expect(readFilePayload({ path: "docs/a.md", extra: 1 })).toEqual({ path: "docs/a.md" });
  });

  it("refuses a missing, blank or non-text path", () => {
    expect(readFilePayload(null)).toBeNull();
    expect(readFilePayload({})).toBeNull();
    expect(readFilePayload({ path: "  " })).toBeNull();
    expect(readFilePayload({ path: 3 })).toBeNull();
  });
});

describe("a minimized terminal (./terminal/minimize.ts)", () => {
  const terminal = { title: "T", name: "Batman", agent: "claude", cwd: "C:/api", shell: "default", command: "" };

  it("reads back that it is minimized, the height it expands to and its agent's last report", () => {
    const saved = { ...terminal, minimized: true, expandedHeight: 520, lastReport: { status: "done", summary: "All good" } };
    expect(readTerminalPayload(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    for (const status of ["blocked", "failed"]) {
      expect(readTerminalPayload({ ...terminal, lastReport: { status, summary: "Needs a key" } })?.lastReport).toEqual({ status, summary: "Needs a key" });
    }
  });

  it("drops what it cannot use", () => {
    for (const minimized of [false, "yes", 1]) expect(readTerminalPayload({ ...terminal, minimized })).not.toHaveProperty("minimized");
    for (const expandedHeight of [0, -1, Number.NaN, Infinity, "500", null]) {
      expect(readTerminalPayload({ ...terminal, expandedHeight })).not.toHaveProperty("expandedHeight");
    }
    const reports = [null, "done", { status: "termine", summary: "x" }, { status: "done" }, { status: "done", summary: 3 }, { summary: "x" }];
    for (const lastReport of reports) expect(readTerminalPayload({ ...terminal, lastReport })).not.toHaveProperty("lastReport");
    expect(readTerminalPayload({ ...terminal, minimized: "yes", expandedHeight: -1, lastReport: "done" })).toEqual(terminal);
  });
});

describe("readOutputPayload", () => {
  it("reads what an agent showed, and fills what a payload lacks", () => {
    const ui = 'root = Stack([Text("x")])';
    expect(readOutputPayload({ title: "Tests", source: "t1", ui, updatedAt: 3 })).toEqual({ title: "Tests", source: "t1", ui, updatedAt: 3 });
    expect(readOutputPayload({ ui })).toEqual({ title: "", source: "", ui, updatedAt: 0 });
    expect(readOutputPayload({ title: "x", source: 3, ui, updatedAt: Number.NaN })).toEqual({ title: "x", source: "", ui, updatedAt: 0 });
  });

  it("refuses a payload without content", () => {
    for (const raw of [null, "x", {}, { title: "T", ui: 3 }]) expect(readOutputPayload(raw)).toBeNull();
  });
});

describe("a report written in OpenUI Lang", () => {
  it("keeps its program beside its text, and drops a program that is not a string", () => {
    const base = { title: "T", name: "N", agent: "claude", cwd: "C:/", shell: "default", command: "" };
    const ui = 'root = Stack([Text("ok")])';
    expect(readTerminalPayload({ ...base, lastReport: { status: "done", summary: "ok", ui } })?.lastReport).toEqual({ status: "done", summary: "ok", ui });
    expect(readTerminalPayload({ ...base, lastReport: { status: "done", summary: "ok", ui: 4 } })?.lastReport).toEqual({ status: "done", summary: "ok" });
  });
});
