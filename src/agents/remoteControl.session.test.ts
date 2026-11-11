// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { mockIPC } from "@tauri-apps/api/mocks";
import { ptySendText, ptyWrite } from "@/ipc/pty";
import { freshText } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { remoteActions } from "./RemoteButton";
import { remoteDeps, remoteStore, setRemoteControl, setRemoteControlAll } from "./remoteControl";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/ipc/pty", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/ipc/pty")>()), ptySendText: vi.fn(), ptyWrite: vi.fn() }));
vi.mock("@/nodes/terminal/registry", () => ({ freshText: vi.fn(), terminalText: vi.fn(() => "  /remote-control is active · https://claude.ai/code/session_OLD") }));

const URL = "https://claude.ai/code/session_NEW";
const PROMPT = ["──────────────────────", "❯ ", "──────────────────────"];
const ACTIVE = ["❯ /remote-control", "  /remote-control is active · Continue here, on your phone, or at", `  ${URL}`, ...PROMPT].join("\n");
const DISCONNECTED = ["❯ /remote-control", "  ⎿  Remote Control disconnected.", ...PROMPT].join("\n");
const menu = (choice: number) =>
  [
    "▔▔▔▔▔▔▔▔▔▔",
    "   Remote Control",
    `   This session is available at ${URL}.`,
    ...["Disconnect this session", "Show QR code", "Continue"].map((label, i) => (i === choice ? `   ❯ ${label}` : `     ${label}`)),
    "   Enter to select · Esc to continue",
  ].join("\n");

/** Claude Code as seen in the app: /remote-control turns it on, or opens its menu when on. */
let screen = "";
let typed: string[] = [];
function fakeClaude() {
  let on = false;
  let choice: number | null = null;
  screen = ["  Claude Code v2.1.304", ...PROMPT].join("\n");
  typed = [];
  vi.mocked(freshText).mockImplementation(() => screen);
  vi.mocked(ptySendText).mockImplementation(async (_id, text) => {
    typed.push(text);
    if (text !== "/remote-control") return;
    if (!on) {
      on = true;
      screen = ACTIVE;
    } else {
      choice = 2;
      screen = menu(choice);
    }
  });
  vi.mocked(ptyWrite).mockImplementation(async (_id, keys) => {
    typed.push(keys);
    if (choice === null) return;
    if (keys === "\x1b[A") choice = Math.max(0, choice - 1);
    if (keys === "\x1b") choice = null;
    if (keys === "\r" && choice === 0) {
      on = false;
      choice = null;
      screen = DISCONNECTED;
      return;
    }
    screen = choice === null ? ACTIVE : menu(choice);
  });
}

beforeEach(async () => {
  mockIPC(() => undefined);
  remoteDeps.sleep = () => Promise.resolve();
  fakeClaude();
  await nodesStore.getState().create("batman", {
    workspaceId: "w1",
    kind: "terminal",
    payload: { title: "Batman", name: "Batman", agent: "claude", cwd: "C:/code", shell: "default", command: "" },
  });
  terminalStatusStore.getState().set("batman", { state: "running" });
  agentActivityStore.getState().apply({ nodeId: "batman", activity: "idle", since: 0 });
  remoteStore.getState().set("batman", null);
});

describe("setRemoteControl on a running session", () => {
  it("reads the session's own screen, not what an earlier run left in the terminal", async () => {
    expect(await setRemoteControl("batman", true)).toEqual({ on: true, url: URL });
    expect(typed).toEqual(["/remote-control"]);
    expect(remoteStore.getState().links.batman).toEqual({ state: "on", url: URL });
    expect(terminalOf(nodesStore.getState().nodes.batman)?.remoteControl).toBe(true);
  });

  it("waits for the end of the agent's turn: Enter would answer its dialog (final review maj §2)", async () => {
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "waiting", since: 1 });
    expect(await setRemoteControl("batman", true)).toEqual({ later: true });
    expect(typed).toEqual([]);
    expect(remoteStore.getState().links.batman?.state).toBe("pending");
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "working", since: 2 });
    expect(typed).toEqual([]);
    agentActivityStore.getState().apply({ nodeId: "batman", activity: "idle", since: 3 });
    await vi.waitFor(() => expect(remoteStore.getState().links.batman).toEqual({ state: "on", url: URL }));
    expect(typed).toEqual(["/remote-control"]);
  });

  it("runs one flow at a time per session, the last wish winning (final review maj §2)", async () => {
    const results = await Promise.all([setRemoteControl("batman", true), setRemoteControl("batman", false)]);
    expect(results).toEqual([{ on: true, url: URL }, { on: false }]);
    expect(typed).toEqual(["/remote-control", "/remote-control", "\x1b[A", "\x1b[A", "\r"]);
    expect(remoteStore.getState().links.batman).toBeUndefined();
    expect(terminalOf(nodesStore.getState().nodes.batman)?.remoteControl).toBeUndefined();
  });
});

describe("links and toasts (backlog 27 oct)", () => {
  it("shows an error, not an active session, when a started session shows no link in time", async () => {
    await setRemoteControl("batman", true);
    screen = ["  Claude Code v2.1.304", ...PROMPT].join(String.fromCharCode(10));
    terminalStatusStore.getState().set("batman", { state: "stopped" });
    terminalStatusStore.getState().set("batman", { state: "running" });
    await vi.waitFor(() => expect(remoteStore.getState().links.batman?.state).toBe("error"));
  });

  it("forgets the link of a node removed from the canvas", async () => {
    remoteStore.getState().set("batman", { state: "on", url: URL });
    terminalStatusStore.getState().remove("batman");
    expect(remoteStore.getState().links.batman).toBeUndefined();
  });

  it("says « next start » for a stopped session in a group, not « turned on »", async () => {
    terminalStatusStore.getState().set("batman", { state: "stopped" });
    await setRemoteControlAll(["batman"], true);
    expect(vi.mocked(toast).mock.calls.map((c) => c[0]).join("|")).toContain("next start");
  });

  it("offers Cut and Retry while the state is an error", () => {
    expect(remoteActions({ state: "error", error: "x" }, false)).toEqual(["turnOff", "retry"]);
    expect(remoteActions(undefined, false)).toEqual(["turnOn"]);
    expect(remoteActions({ state: "on" }, true)).toEqual(["turnOff"]);
  });
});
