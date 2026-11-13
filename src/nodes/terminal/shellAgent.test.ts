// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { AgentProcessEvent } from "@/ipc/pty";
import { nodesStore, sessionOf } from "@/store/nodes";
import { readTerminalPayload, type TerminalPayload } from "@/nodes/types";
import { buildSpawnSpec, defaultTitle, launchSettingsOf, relaunchMode, switchedAgent } from "./launch";
import { agentStartedInShell, applyShellAgent, leaveShellAgent, shellAgentPatch } from "./shellAgent";

const ID = "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10";
const OTHER_ID = "6c1f0e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

/** A Shell terminal as "New console" makes one: named after its folder, started with the shell's settings. */
const shellIn = (cwd: string, patch: Partial<TerminalPayload> = {}): TerminalPayload => {
  const payload: TerminalPayload = { title: defaultTitle("shell", cwd), name: "Batman", agent: "shell", cwd, shell: "powershell", command: "", ...patch };
  return { ...payload, launched: launchSettingsOf(payload) };
};

const sighting = (patch: Partial<AgentProcessEvent> = {}): AgentProcessEvent => ({ nodeId: "t1", agent: "claude", pid: 4242, ...patch });

/** What the backend was asked for, by command. */
let calls: { cmd: string; args: unknown }[];
let snapshot: AgentProcessEvent[];

beforeEach(() => {
  calls = [];
  snapshot = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    return cmd === "agent_process_snapshot" ? snapshot : undefined;
  });
  nodesStore.setState({ nodes: {} } as never);
});

async function terminal(payload: TerminalPayload, id = "t1") {
  await nodesStore.getState().create(id, { workspaceId: "w", kind: "terminal", payload });
}
const session = (id = "t1") => sessionOf(nodesStore.getState().nodes[id]);

describe("an agent started by hand in a Shell terminal", () => {
  it("makes it that agent's terminal, keeping its folder, name and place, and starting nothing", async () => {
    const before = shellIn("D:/work/api");
    await terminal(before);
    expect(agentStartedInShell("t1", sighting({ sessionId: ID, cwd: "D:\\work\\api" }))).toBe(true);
    const after = session()!;
    expect(after).toMatchObject({
      agent: "claude",
      cwd: "D:/work/api",
      name: "Batman",
      shell: "powershell",
      claudeSessionId: ID,
      fromShell: true,
      // Named after its agent now, as it would be if it had been made as one.
      title: "Claude · api",
    });
    // The process runs on as it started: its launch is the one kept, and no process was touched.
    expect(after.launched).toEqual(before.launched);
    expect(calls.map((call) => call.cmd).filter((cmd) => cmd.startsWith("pty_"))).toEqual([]);
  });

  it("is told by its terminal as any agent of the launch menu started without options", async () => {
    for (const agent of ["claude", "codex", "gemini", "qwen", "cursor", "opencode", "aider"] as const) {
      nodesStore.setState({ nodes: {} } as never);
      await terminal(shellIn("D:/work/api"));
      expect(agentStartedInShell("t1", sighting({ agent }))).toBe(true);
      expect(session()).toMatchObject({ agent, fromShell: true });
    }
  });

  it("never becomes Ollama, a custom command or a shell: none is found by its program", async () => {
    await terminal(shellIn("D:/work/api"));
    for (const agent of ["ollama", "custom", "shell"] as const) {
      expect(agentStartedInShell("t1", sighting({ agent }))).toBe(false);
      expect(session()?.agent).toBe("shell");
    }
  });

  it("keeps a title the user gave", async () => {
    await terminal(shellIn("D:/work/api", { title: "Fix the login" }));
    agentStartedInShell("t1", sighting());
    expect(session()?.title).toBe("Fix the login");
  });

  it("starts a new conversation at its next launch when the conversation it runs is not known", async () => {
    await terminal(shellIn("D:/work/api"));
    agentStartedInShell("t1", sighting());
    const claude = session()!;
    // Never one it could not name: a conversation of its own, which Rust starts as a new one while it has no transcript.
    expect(claude.claudeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(claude.claudeSessionId).not.toBe(ID);
  });

  it("resumes the conversation it runs, in the folder it runs in, at its next launch", async () => {
    await terminal(shellIn("D:/work/api"));
    agentStartedInShell("t1", sighting({ sessionId: ID }));
    const claude = session()!;
    expect(relaunchMode(claude)).toBe("resume");
    const spec = buildSpawnSpec(claude, relaunchMode(claude));
    expect(spec).toMatchObject({ agent: "claude", cwd: "D:/work/api", shell: "powershell" });
    expect(spec.claude).toMatchObject({ mode: "resume", sessionId: ID, title: "Claude · api" });
  });

  it("takes the folder Claude runs in when the shell changed folder before it started, with its conversation", async () => {
    await terminal(shellIn("D:/work/api"));
    agentStartedInShell("t1", sighting({ sessionId: ID, cwd: "D:\\work\\upload" }));
    const claude = session()!;
    expect(claude.cwd).toBe("D:\\work\\upload");
    expect(claude.title).toBe("Claude · upload");
    // The Claude that runs started from the shell with this folder: no restart is offered to take it there.
    expect(claude.launched?.cwd).toBe("D:\\work\\upload");
    expect(buildSpawnSpec(claude, "resume").cwd).toBe("D:\\work\\upload");
  });

  it("leaves a folder it cannot take alone: without a conversation to go with it, or a mission's", async () => {
    await terminal(shellIn("D:/work/api"));
    agentStartedInShell("t1", sighting({ cwd: "D:\\work\\upload" }));
    expect(session()?.cwd).toBe("D:/work/api");
    const patch = shellAgentPatch(shellIn("D:/work/api"), { agent: "claude", sessionId: ID, cwd: "D:\\work\\upload" }, true);
    expect(patch.cwd).toBeUndefined();
    expect(patch.claudeSessionId).toBe(ID);
  });

  it("is the same folder under another spelling, so it moves nothing", async () => {
    const patch = shellAgentPatch(shellIn("D:/work/api"), { agent: "claude", sessionId: ID, cwd: "d:\\Work\\API\\" }, false);
    expect(patch.cwd).toBeUndefined();
    expect(patch.launched).toBeUndefined();
  });

  it("keeps the thread Codex runs, when its command line named one", async () => {
    await terminal(shellIn("D:/work/api"));
    agentStartedInShell("t1", sighting({ agent: "codex", sessionId: ID }));
    const codex = session()!;
    expect(codex.codexSessionId).toBe(ID);
    expect(buildSpawnSpec(codex, relaunchMode(codex)).codex?.sessionId).toBe(ID);
  });

  it("starts Codex anew when it ran no thread it could name", async () => {
    await terminal(shellIn("D:/work/api"));
    agentStartedInShell("t1", sighting({ agent: "codex" }));
    const codex = session()!;
    expect(relaunchMode(codex)).toBe("new");
    expect(buildSpawnSpec(codex, "new").codex?.sessionId).toBeUndefined();
  });

  it("is saved with the node, so the terminal is an agent's after a restart of the app too", async () => {
    await terminal(shellIn("D:/work/api"));
    agentStartedInShell("t1", sighting({ sessionId: ID }));
    const saved = readTerminalPayload(JSON.parse(JSON.stringify(session())));
    expect(saved).toMatchObject({ agent: "claude", claudeSessionId: ID, fromShell: true });
  });
});

describe("a terminal that is not a shell", () => {
  it("is left as it is: an agent terminal has its agent already", async () => {
    const claude: TerminalPayload = { title: "Claude · api", name: "Robin", agent: "claude", cwd: "D:/work/api", shell: "default", command: "", claudeSessionId: OTHER_ID };
    await terminal(claude);
    expect(agentStartedInShell("t1", sighting({ agent: "codex", sessionId: ID }))).toBe(false);
    expect(agentStartedInShell("t1", sighting({ sessionId: ID }))).toBe(false);
    expect(session()).toEqual(claude);
  });

  it("is left as it is when it is a mission's or a spawned agent, or a Fleet or Manager", async () => {
    await terminal(shellIn("D:/work/api", { spawnedBy: "t0" }), "spawned");
    await terminal(shellIn("D:/work/api", { role: "manager", fleet: "f1" }), "manager");
    await nodesStore.getState().create("f1", { workspaceId: "w", kind: "fleet", payload: { name: "Fleet" } });
    for (const id of ["spawned", "manager", "f1", "gone"]) {
      expect(agentStartedInShell(id, sighting({ nodeId: id }))).toBe(false);
    }
    expect(session("spawned")?.agent).toBe("shell");
    expect(session("manager")?.agent).toBe("shell");
  });
});

describe("a terminal that became an agent's in its shell", () => {
  async function converted() {
    await terminal(shellIn("D:/work/api"));
    agentStartedInShell("t1", sighting({ sessionId: ID }));
  }

  it("takes the next agent the user runs in that shell", async () => {
    await converted();
    expect(agentStartedInShell("t1", sighting({ agent: "codex", pid: 5000, sessionId: OTHER_ID }))).toBe(true);
    expect(session()).toMatchObject({ agent: "codex", codexSessionId: OTHER_ID, fromShell: true });
  });

  it("follows the conversation of the same agent run again, and ignores the one it holds", async () => {
    await converted();
    expect(agentStartedInShell("t1", sighting({ pid: 5000, sessionId: ID }))).toBe(false);
    expect(agentStartedInShell("t1", sighting({ pid: 5000 }))).toBe(false);
    expect(agentStartedInShell("t1", sighting({ pid: 5000, sessionId: OTHER_ID }))).toBe(true);
    expect(session()).toMatchObject({ agent: "claude", claudeSessionId: OTHER_ID, cwd: "D:/work/api", title: "Claude · api" });
    // What it kept of the terminal is intact: the launch of its process above all.
    expect(session()?.launched).toBeDefined();
  });

  it("is not changed by an agent the user chose for it by hand", async () => {
    await terminal({ ...shellIn("D:/work/api"), agent: "gemini" });
    expect(agentStartedInShell("t1", sighting({ agent: "claude", sessionId: ID }))).toBe(false);
    expect(session()?.agent).toBe("gemini");
  });

  it("stops following the shell once the agent is chosen by hand", async () => {
    await converted();
    expect(switchedAgent(session()!, "shell")).toMatchObject({ agent: "shell", fromShell: undefined });
  });
});

describe("an agent that started while the page was loading, or the terminal was not on screen", () => {
  it("is applied when the terminal reattaches to its process", async () => {
    await terminal(shellIn("D:/work/api"));
    snapshot = [sighting({ sessionId: ID }), sighting({ nodeId: "t2", agent: "codex" })];
    await applyShellAgent("t1");
    expect(session()).toMatchObject({ agent: "claude", claudeSessionId: ID, fromShell: true });
  });

  it("asks nothing for an agent terminal", async () => {
    await terminal({ ...shellIn("D:/work/api"), agent: "claude", claudeSessionId: ID });
    await applyShellAgent("t1");
    expect(calls.map((call) => call.cmd)).not.toContain("agent_process_snapshot");
  });

  it("changes nothing for a shell no agent runs in", async () => {
    await terminal(shellIn("D:/work/api"));
    await applyShellAgent("t1");
    expect(session()?.agent).toBe("shell");
  });
});

describe("turning it back to a shell", () => {
  it("tells the backend not to report that process again", () => {
    leaveShellAgent("t1");
    expect(calls).toEqual([{ cmd: "agent_process_dismiss", args: { nodeId: "t1" } }]);
  });
});
