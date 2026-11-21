// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { nodesStore, sessionOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { markLaunch, usageStore } from "@/usage/usageStore";
import { fleetSession, newTerminalPayload } from "./launch";
import { followClaudeConversation, installClaudeConversations } from "./claudeSessions";

const FOLDER = "D:\\Projects\\opensession\\BOS-Mono\\backend";
const LAUNCHED = "27a40a50-ead2-480a-81db-c7973e2e74fb";
const RESUMED = "bbc8f863-cf35-4134-bad3-28b4e8c89ba9";
const options = { cwd: FOLDER, shell: "default" as const };

/** A status line as Claude Code sends it: the conversation it runs, and the folder it was launched in. */
const status = (sessionId: string, folder: string | null = FOLDER) => ({ session_id: sessionId, workspace: folder === null ? {} : { project_dir: folder } });
const report = (nodeId: string, sessionId: string, at: number, folder?: string | null) =>
  usageStore.getState().apply({ nodeId, status: status(sessionId, folder) }, at);
const conversationOf = (nodeId: string) => sessionOf(nodesStore.getState().nodes[nodeId])?.claudeSessionId;

async function claudeTerminal(nodeId: string, claudeSessionId = LAUNCHED) {
  const payload = { ...newTerminalPayload({ ...options, title: "", agent: "claude", command: "" }), claudeSessionId };
  await nodesStore.getState().create(nodeId, { workspaceId: "w", kind: "terminal", payload });
  terminalStatusStore.getState().set(nodeId, { state: "running" });
  markLaunch(nodeId, 100);
}

let uninstall: () => void;

beforeEach(() => {
  mockIPC(() => undefined);
  nodesStore.setState({ nodes: {} } as never);
  usageStore.setState({ sessions: {}, limits: null, launchedAt: {} });
  uninstall = installClaudeConversations();
});

afterEach(() => uninstall());

describe("the conversation a terminal's Claude runs", () => {
  it("is kept once a /resume in it picks another one, so the next Resume takes it up (bug 16 Nov)", async () => {
    await claudeTerminal("n");
    report("n", LAUNCHED, 200);
    expect(conversationOf("n")).toBe(LAUNCHED);
    // `/resume` in the running Claude, which picks the conversation the new launch had replaced.
    report("n", RESUMED, 300);
    expect(conversationOf("n")).toBe(RESUMED);
  });

  it("is kept after a /clear, and by a fleet's session too", async () => {
    await claudeTerminal("n");
    const cleared = "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10";
    report("n", cleared, 200);
    expect(conversationOf("n")).toBe(cleared);
    await nodesStore.getState().create("f", { workspaceId: "w", kind: "fleet", payload: { name: "Fleet", session: fleetSession("Fleet", options) } });
    terminalStatusStore.getState().set("f", { state: "running" });
    markLaunch("f", 100);
    report("f", RESUMED, 200);
    expect(conversationOf("f")).toBe(RESUMED);
  });

  it("is not taken from a report of the process a restart replaced, nor while the restart is under way", async () => {
    await claudeTerminal("n");
    // The old process's report, from before this launch.
    report("n", RESUMED, 50);
    expect(conversationOf("n")).toBe(LAUNCHED);
    terminalStatusStore.getState().restart("n", 1);
    try {
      report("n", RESUMED, 300);
      expect(conversationOf("n")).toBe(LAUNCHED);
    } finally {
      terminalStatusStore.getState().restart("n", -1);
    }
  });

  it("is not taken from a Claude that runs in another folder, nor one that says none", async () => {
    await claudeTerminal("n");
    report("n", RESUMED, 200, "D:\\Projects\\elsewhere");
    expect(conversationOf("n")).toBe(LAUNCHED);
    report("n", RESUMED, 300, null);
    expect(conversationOf("n")).toBe(LAUNCHED);
    // The same folder, written another way, is the terminal's.
    report("n", RESUMED, 400, "d:/projects/opensession/bos-mono/backend/");
    expect(conversationOf("n")).toBe(RESUMED);
  });

  it("leaves the new conversation of an account changed while it runs alone", async () => {
    await claudeTerminal("n");
    const launched = { cwd: FOLDER, shell: "default" as const, command: "", model: "", effort: "", permission: "", accountId: "" };
    const next = "0b9c4b5e-6f1a-4c39-9d2e-8f6c2d1a7e10";
    // Its Edit panel gave it another profile: the next launch starts a new conversation there.
    nodesStore.getState().update("n", { launched, accountId: "work", claudeSessionId: next });
    report("n", RESUMED, 200);
    expect(conversationOf("n")).toBe(next);
    // Back on the profile it runs with: it follows again.
    nodesStore.getState().update("n", { accountId: undefined });
    report("n", LAUNCHED, 300);
    expect(conversationOf("n")).toBe(LAUNCHED);
  });

  it("leaves a stopped terminal, another agent and an id no launch could take alone", async () => {
    await claudeTerminal("n");
    terminalStatusStore.getState().set("n", { state: "exited", code: 0 });
    expect(followClaudeConversation("n", { sessionId: RESUMED, folder: FOLDER })).toBe(false);
    terminalStatusStore.getState().set("n", { state: "running" });
    expect(followClaudeConversation("n", { sessionId: "not-a-conversation", folder: FOLDER })).toBe(false);
    expect(conversationOf("n")).toBe(LAUNCHED);
    const codex = newTerminalPayload({ ...options, title: "", agent: "codex", command: "" });
    await nodesStore.getState().create("c", { workspaceId: "w", kind: "terminal", payload: codex });
    terminalStatusStore.getState().set("c", { state: "running" });
    expect(followClaudeConversation("c", { sessionId: RESUMED, folder: FOLDER })).toBe(false);
    expect(followClaudeConversation("gone", { sessionId: RESUMED, folder: FOLDER })).toBe(false);
  });
});
