// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { ptySendText } from "@/ipc/pty";
import { typedAgo } from "@/nodes/terminal/registry";
import { remoteBusy } from "@/agents/remoteControl";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { installMissionEvents, notify, pendingEvents } from "./events";
import { whenReady } from "./ready";
import type { Member } from "./mission";

vi.mock("@/ipc/pty", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/ipc/pty")>()), ptySendText: vi.fn(() => Promise.resolve()) }));
vi.mock("@/nodes/terminal/registry", () => ({ freshText: vi.fn(() => ""), quietFor: vi.fn(() => 0), typedAgo: vi.fn(() => Infinity) }));
vi.mock("@/agents/remoteControl", () => ({ remoteBusy: vi.fn(() => false) }));
vi.mock("./ready", () => ({ whenReady: vi.fn(() => Promise.resolve(true)) }));

/** Lets the started fleet's readiness settle. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const member = (nodeId: string, name: string, sentAt?: number): Member => ({ nodeId, name, task: "t", budgetMin: 5, linked: false, branch: `dummyplane/m-${nodeId}`, worktree: "C:/w", sentAt });
const activity = (nodeId: string, value: "idle" | "working" | "waiting") => agentActivityStore.getState().apply({ nodeId, activity: value, since: 0 });
const status = (nodeId: string, state: "running" | "stopped" | "exited") =>
  terminalStatusStore.getState().set(nodeId, state === "exited" ? { state, code: 0 } : { state });
const sent = () => vi.mocked(ptySendText).mock.calls.map(([id, text]) => `${id}: ${text}`);

let uninstall: () => void;
beforeAll(async () => {
  mockIPC(() => undefined);
  await nodesStore.getState().create("chef", {
    workspaceId: "w1",
    kind: "fleet",
    payload: { name: "Chef", mission: { state: "en_cours", maxAgents: 4, members: [member("isis", "Isis", 1), member("horus", "Horus")] } },
  });
  uninstall = installMissionEvents();
});
afterAll(() => uninstall());
beforeEach(async () => {
  status("chef", "running");
  await tick();
  activity("chef", "idle");
  status("isis", "running");
  activity("isis", "working");
  vi.mocked(ptySendText).mockClear();
});

describe("events to the fleet (spec orchestrateur §7.5)", () => {
  it("holds a line while a Remote Control flow is typing in the fleet (backlog 27 oct)", async () => {
    vi.useFakeTimers();
    vi.mocked(remoteBusy).mockReturnValueOnce(true).mockReturnValue(false);
    notify("chef", "Isis a rendu compte");
    expect(sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent()).toEqual(["chef: [dummyPlane] Isis a rendu compte"]);
    vi.useRealTimers();
  });

  it("waits for the user to stop typing before it types a line (backlog H2)", async () => {
    vi.useFakeTimers();
    vi.mocked(typedAgo).mockReturnValueOnce(1000).mockReturnValue(Infinity);
    notify("chef", "Isis a rendu compte");
    expect(sent()).toEqual([]);
    await vi.advanceTimersByTimeAsync(4000);
    expect(sent()).toEqual(["chef: [dummyPlane] Isis a rendu compte"]);
    vi.useRealTimers();
  });

  it("types a line in a free fleet at once", () => {
    notify("chef", "Isis a rendu compte (termine) : fait");
    expect(sent()).toEqual(["chef: [dummyPlane] Isis a rendu compte (termine) : fait"]);
  });

  it("holds the lines while it waits for the user or is stopped, then sends them in order", async () => {
    activity("chef", "waiting");
    notify("chef", "un");
    notify("chef", "deux");
    expect(sent()).toEqual([]);
    expect(pendingEvents("chef")).toEqual(["un", "deux"]);
    activity("chef", "working");
    status("chef", "stopped");
    notify("chef", "trois");
    status("chef", "running");
    await tick();
    expect(sent()).toEqual(["chef: [dummyPlane] un", "chef: [dummyPlane] deux", "chef: [dummyPlane] trois"]);
    expect(pendingEvents("chef")).toEqual([]);
  });

  it("tells it when a member waits for the user or stops, once its sub-task is sent", () => {
    activity("isis", "waiting");
    status("isis", "exited");
    status("horus", "running");
    activity("horus", "waiting");
    expect(sent()).toEqual([
      "chef: [dummyPlane] Isis is waiting for the user (a dialog is open in its terminal).",
      "chef: [dummyPlane] Isis stopped: its terminal is no longer running.",
    ]);
  });

  it("tells it in English when the interface is (spec première version §7.1)", () => {
    try {
      activity("isis", "waiting");
      status("isis", "exited");
      expect(sent()).toEqual([
        "chef: [dummyPlane] Isis is waiting for the user (a dialog is open in its terminal).",
        "chef: [dummyPlane] Isis stopped: its terminal is no longer running.",
      ]);
    } finally {
    }
  });

  it("counts a member's terminal removed from the canvas as stopped", () => {
    terminalStatusStore.getState().remove("isis");
    expect(sent()).toEqual(["chef: [dummyPlane] Isis stopped: its terminal is no longer running."]);
  });

  it("waits for a restarted fleet's Claude to be up, never typing into its trust dialog (final review H2)", async () => {
    let up!: (ready: boolean) => void;
    vi.mocked(whenReady).mockImplementationOnce(() => new Promise((resolve) => (up = resolve)));
    status("chef", "stopped");
    status("chef", "running");
    notify("chef", "Isis a rendu compte");
    await tick();
    expect(sent()).toEqual([]);
    const calls = vi.mocked(whenReady).mock.calls;
    expect(calls[calls.length - 1][2]).toBe(false);
    up(true);
    await vi.waitFor(() => expect(sent()).toEqual(["chef: [dummyPlane] Isis a rendu compte"]));
  });

  it("puts back a line that could not be typed, for the fleet's next start (final review H2)", async () => {
    vi.mocked(ptySendText).mockRejectedValueOnce(new Error("NotFound"));
    notify("chef", "perdu ?");
    await tick();
    expect(pendingEvents("chef")).toEqual(["perdu ?"]);
    status("chef", "stopped");
    status("chef", "running");
    await vi.waitFor(() => expect(sent()).toEqual(["chef: [dummyPlane] perdu ?", "chef: [dummyPlane] perdu ?"]));
    expect(pendingEvents("chef")).toEqual([]);
  });
});
