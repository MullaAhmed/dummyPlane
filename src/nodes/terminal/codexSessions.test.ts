// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fleetSession, newTerminalPayload } from "./launch";
import { nodesStore, sessionOf } from "@/store/nodes";
import { rememberCodexSession } from "./codexSessions";

const THREAD = "01a1c9a1-5e88-7920-b099-408693fc32af";
const options = { cwd: "C:/p", shell: "default" as const };

beforeEach(() => {
  mockIPC(() => undefined);
  nodesStore.setState({ nodes: {} } as never);
});

describe("the conversation Codex saved", () => {
  it("is kept by its terminal, and by a Codex fleet's session", async () => {
    await nodesStore.getState().create("a", { workspaceId: "w", kind: "terminal", payload: newTerminalPayload({ ...options, title: "", agent: "codex", command: "" }) });
    await nodesStore.getState().create("f", { workspaceId: "w", kind: "fleet", payload: { name: "Fleet", session: fleetSession("Fleet", options, "codex") } });
    rememberCodexSession("a", THREAD);
    rememberCodexSession("f", THREAD);
    expect(sessionOf(nodesStore.getState().nodes.a)?.codexSessionId).toBe(THREAD);
    expect(sessionOf(nodesStore.getState().nodes.f)?.codexSessionId).toBe(THREAD);
  });

  it("is ignored by a terminal that no longer runs Codex", async () => {
    await nodesStore.getState().create("c", { workspaceId: "w", kind: "terminal", payload: newTerminalPayload({ ...options, title: "", agent: "claude", command: "" }) });
    rememberCodexSession("c", THREAD);
    expect(sessionOf(nodesStore.getState().nodes.c)?.codexSessionId).toBeUndefined();
    rememberCodexSession("gone", THREAD);
  });
});
