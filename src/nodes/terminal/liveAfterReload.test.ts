// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { TerminalPayload } from "@/nodes/types";
import { nodesStore } from "@/store/nodes";
import { statusOf, terminalStatusStore } from "@/store/terminalStatus";
import { disposeTerminal, relaunchTerminal, resumeTerminal, setLivePtys } from "./registry";

// The real registry and session: a restart kills the process, waits for its exit and spawns the new one through IPC.
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    unicode = { activeVersion: "" };
    loadAddon() {}
    open() {}
    write(_data: unknown, callback?: () => void) {
      callback?.();
    }
    registerMarker() {
      return { line: 0, isDisposed: false, dispose() {} };
    }
    resize() {}
    dispose() {}
    onWriteParsed() {}
    onData() {}
    onKey() {}
    onResize() {}
    attachCustomKeyEventHandler() {}
  },
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class {} }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const payload: TerminalPayload = { title: "Shell", name: "Storm", agent: "shell", cwd: "C:/code", shell: "default", command: "" };

/** What Rust runs, and the terminal commands it was sent. */
let running: Set<string>;
let calls: string[];

beforeEach(() => {
  running = new Set();
  calls = [];
  mockIPC((cmd, args) => {
    const nodeId = (args as { nodeId?: string }).nodeId ?? "";
    if (cmd.startsWith("pty_")) calls.push(cmd);
    if (cmd === "pty_spawn") {
      // `claim_start`: a second start of a terminal that runs is refused.
      if (running.has(nodeId)) throw { kind: "invalidInput", message: `terminal ${nodeId} is already running` };
      running.add(nodeId);
      return 7;
    }
    // Its exit follows, as boot's pty-exit handler records it.
    if (cmd === "pty_kill" && running.delete(nodeId)) setTimeout(() => terminalStatusStore.getState().set(nodeId, { state: "exited", code: null }), 1);
    return null;
  });
});

afterEach(async () => {
  disposeTerminal("live");
  await new Promise((resolve) => setTimeout(resolve, 5));
  setLivePtys([]);
  clearMocks();
  nodesStore.setState({ nodes: {} });
  terminalStatusStore.setState({ statuses: {}, restarts: {} });
});

it("restarts a terminal whose process still runs in Rust since the page reloaded, never shown again since, by stopping that process first", async () => {
  await nodesStore.getState().create("live", { workspaceId: "w", kind: "terminal", payload });
  // The page reloaded (its crash notice's Reload): the process runs on in Rust, its node not mounted yet.
  running.add("live");
  setLivePtys(["live"]);
  // A finished sub-agent woken by new work, a mission's relaunch, its agents panel's restart.
  await relaunchTerminal("live", payload, "new");
  expect(calls).toEqual(["pty_kill", "pty_spawn"]);
  expect(statusOf("live").state).toBe("running");
});

it("resumes such a terminal the same way", async () => {
  await nodesStore.getState().create("live", { workspaceId: "w", kind: "terminal", payload });
  running.add("live");
  setLivePtys(["live"]);
  resumeTerminal("live");
  await vi.waitFor(() => expect(calls).toEqual(["pty_kill", "pty_spawn"]));
  await vi.waitFor(() => expect(statusOf("live").state).toBe("running"));
});
