import { describe, expect, it } from "vitest";
import { readTerminalPayload } from "@/nodes/types";
import { STORED_FLEET_ROLE } from "@/ipc/pty";
import { buildSpawnSpec, canResume, defaultTitle, newConversation, newTerminalPayload, fleetSession, relaunchMode, switchedAgent } from "./launch";

const base = { title: "", cwd: "C:\\code\\dummyplane", agent: "shell" as const, command: "", shell: "default" as const };

describe("defaultTitle", () => {
  it("names the terminal after the agent and the folder", () => {
    expect(defaultTitle("claude", "C:\\code\\dummyplane\\")).toBe("Claude · dummyplane");
    expect(defaultTitle("shell", "/home/me/api")).toBe("Shell · api");
    expect(defaultTitle("aider", "")).toBe("Aider");
  });
});

describe("newTerminalPayload", () => {
  it("fills a blank title, trims the custom command and keeps the given name", () => {
    const payload = newTerminalPayload({ ...base, agent: "custom", command: "  npm run dev " }, "Cyborg");
    expect(payload.title).toBe("Custom · dummyplane");
    expect(payload.command).toBe("npm run dev");
    expect(payload.name).toBe("Cyborg");
    expect(payload.claudeSessionId).toBeUndefined();
  });

  it("gives every Claude terminal its own session id", () => {
    const a = newTerminalPayload({ ...base, agent: "claude", title: "Agent" });
    const b = newTerminalPayload({ ...base, agent: "claude", title: "Agent" });
    expect(a.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.claudeSessionId).not.toBe(b.claudeSessionId);
    expect(a.title).toBe("Agent");
  });

  it("keeps the Ollama model and mode", () => {
    const payload = newTerminalPayload({ ...base, agent: "ollama", ollama: { model: "llama3", mode: "chat" } });
    expect(payload.ollama).toEqual({ model: "llama3", mode: "chat" });
  });
});

describe("a Codex terminal", () => {
  const codex = newTerminalPayload({ ...base, agent: "codex", title: "Codex" }, "Raven");
  const THREAD = "01a1c9a1-5e88-7920-b099-408693fc32af";

  it("starts as an agent of dummyPlane with no conversation yet: Codex names it once saved", () => {
    expect(codex.claudeSessionId).toBeUndefined();
    expect(buildSpawnSpec(codex, "new")).toMatchObject({ agent: "codex", codex: { role: "agent" } });
    expect(buildSpawnSpec(codex, "new").claude).toBeUndefined();
    expect(canResume(codex)).toBe(false);
    expect(relaunchMode(codex)).toBe("new");
  });

  it("resumes the thread Codex saved, and a new conversation forgets it", () => {
    const saved = { ...codex, codexSessionId: THREAD };
    expect(canResume(saved)).toBe(true);
    expect(relaunchMode(saved)).toBe("resume");
    expect(buildSpawnSpec(saved, "resume").codex?.sessionId).toBe(THREAD);
    expect(buildSpawnSpec(saved, "new").codex?.sessionId).toBeUndefined();
    expect({ ...saved, ...newConversation() }.codexSessionId).toBeUndefined();
    expect(switchedAgent(saved, "claude").codexSessionId).toBeUndefined();
  });

  it("carries a fleet's role, its night and Linear, never a model of Claude's", () => {
    const fleet = { ...fleetSession("Fleet", { cwd: "C:/p", shell: "default" }, "codex"), permission: "work" as const, linear: true as const };
    expect(fleet.role).toBe(STORED_FLEET_ROLE);
    expect(buildSpawnSpec(fleet, "new").codex).toEqual({ role: STORED_FLEET_ROLE, permission: "work", linear: true });
    expect(buildSpawnSpec({ ...codex, model: "sonnet" }, "new").codex?.model).toBeUndefined();
    expect(buildSpawnSpec({ ...codex, model: "claude-opus-5-5" }, "new").codex?.model).toBeUndefined();
    expect(buildSpawnSpec({ ...codex, model: "gpt-5.6-luna" }, "new").codex?.model).toBe("gpt-5.6-luna");
  });

  it("keeps its thread and a Codex fleet keeps its session when read back", () => {
    expect(readTerminalPayload({ ...codex, codexSessionId: THREAD })?.codexSessionId).toBe(THREAD);
  });
});

describe("a one-shot command", () => {
  const input = { title: "t", cwd: "C:/a", agent: "custom", command: "npm i", shell: "cmd" } as const;

  it("keeps the mark on the payload, only when asked", () => {
    expect(newTerminalPayload({ ...input, oneShot: true }).oneShot).toBe(true);
    expect("oneShot" in newTerminalPayload(input)).toBe(false);
  });

  it("survives a restart", () => {
    expect(readTerminalPayload({ ...input, name: "", oneShot: true })?.oneShot).toBe(true);
    expect(readTerminalPayload({ ...input, name: "" })?.oneShot).toBeUndefined();
  });

  it("is dropped when the terminal becomes another agent", () => {
    const change = switchedAgent(newTerminalPayload({ ...input, oneShot: true }), "codex");
    expect("oneShot" in change).toBe(true);
    expect(change.oneShot).toBeUndefined();
  });
});

describe("buildSpawnSpec", () => {
  it("passes Claude options with the requested mode", () => {
    const payload = newTerminalPayload({ ...base, agent: "claude", title: "Agent" });
    expect(buildSpawnSpec(payload, "resume")).toEqual({
      cwd: base.cwd,
      shell: "default",
      agent: "claude",
      command: "",
      claude: { mode: "resume", sessionId: payload.claudeSessionId, title: "Agent", role: "agent" },
    });
  });

  it("starts Claude with Remote Control, under the agent's name, when it is on", () => {
    const payload = { ...newTerminalPayload({ ...base, agent: "claude", title: "Agent" }, "Batman"), remoteControl: true };
    expect(buildSpawnSpec(payload, "new").claude?.remoteControl).toBe("Batman");
    expect(buildSpawnSpec({ ...payload, name: "" }, "new").claude?.remoteControl).toBe("Agent");
  });

  it("starts Claude on the model the router chose", () => {
    const payload = { ...newTerminalPayload({ ...base, agent: "claude", title: "Agent" }), model: "claude-haiku-5-5" };
    expect(buildSpawnSpec(payload, "new").claude?.model).toBe("claude-haiku-5-5");
    expect(buildSpawnSpec({ ...payload, model: undefined }, "new").claude).not.toHaveProperty("model");
  });

  it("starts Claude at the effort the edit panel chose, and gives no level when none is chosen", () => {
    const payload = { ...newTerminalPayload({ ...base, agent: "claude", title: "Agent" }), effort: "max" as const };
    expect(buildSpawnSpec(payload, "resume").claude?.effort).toBe("max");
    expect(buildSpawnSpec({ ...payload, effort: undefined }, "new").claude).not.toHaveProperty("effort");
    // Claude's levels mean nothing to Codex.
    expect(buildSpawnSpec({ ...payload, agent: "codex" }, "new").codex).not.toHaveProperty("effort");
  });

  it("passes Ollama options", () => {
    const payload = newTerminalPayload({ ...base, agent: "ollama", ollama: { model: "llama3", mode: "code" } });
    expect(buildSpawnSpec(payload, "new").ollama).toEqual({ model: "llama3", mode: "code" });
  });

  it("sends nothing agent-specific for a shell", () => {
    const spec = buildSpawnSpec(newTerminalPayload(base), "new");
    expect(spec.claude).toBeUndefined();
    expect(spec.ollama).toBeUndefined();
  });
});

describe("a new conversation (final review H1)", () => {
  it("gets its own id and drops the steps of the previous one", () => {
    const patch = newConversation();
    expect(patch.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect("steps" in patch && patch.steps === undefined).toBe(true);
    // Its last report was of the previous conversation: the card and the status no longer say Done.
    expect("lastReport" in patch && patch.lastReport === undefined).toBe(true);
  });

  it("drops the steps when the terminal switches agent, a conversation id given to Claude if it has none", () => {
    const base = { title: "", name: "Batman", agent: "codex" as const, cwd: "C:/code", shell: "default" as const, command: "", steps: [{ title: "Plan", state: "fait" as const }] };
    expect(switchedAgent(base, "shell")).toEqual({ agent: "shell", steps: undefined });
    expect(switchedAgent(base, "shell")).toHaveProperty("lastReport", undefined);
    const claude = switchedAgent(base, "claude");
    expect(claude).toMatchObject({ agent: "claude", steps: undefined });
    expect(claude.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(switchedAgent({ ...base, claudeSessionId: "s1" }, "claude")).toEqual({ agent: "claude", steps: undefined });
  });
});

describe("fleetSession", () => {
  it("is Claude in the project folder, launched with the fleet's role", () => {
    const session = fleetSession("Chef", { cwd: "C:/code", shell: "pwsh" });
    expect(session).toMatchObject({ title: "Chef", name: "Chef", agent: "claude", cwd: "C:/code", shell: "pwsh", role: "orchestrator" });
    expect(buildSpawnSpec(session, "new").claude).toEqual({ mode: "new", sessionId: session.claudeSessionId, title: "Chef", role: "orchestrator" });
    expect(buildSpawnSpec({ ...session, role: undefined }, "new").claude?.role).toBe("agent");
  });
});
